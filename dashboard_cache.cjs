/**
 * 多会话看板:全局单例轮询器(M5)
 *
 * 一个 setInterval 驱动所有会话的 jsonl 尾部读取(2s,M7),
 * 内存快照供 /api/dashboard 端点读取。
 * 数据流:listSessions(cwd) → slug 解析项目目录 → 最新 mtime jsonl(M2)
 *        → tail 读尾部 → parseStatus → 快照。
 * 任何环节失败 → unknown(M3 绝不抛)。
 */

const fs = require('fs');
const path = require('path');
const { readTailEvents } = require('./dashboard_tail.cjs');
const { resolveProjectDir, listProjectJsonls } = require('./dashboard_slug.cjs');
const { parseStatus } = require('./dashboard_parse.cjs');
const { normalizeState, StateTracker } = require('./session_status.cjs');

const DEFAULT_INTERVAL_MS = 2000;
const IDLE_THRESHOLD_S = 30;

function latestJsonlByMtime(files) {
  let latest = null;
  let latestMtime = -1;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latest = f;
      }
    } catch {
      /* skip unreadable */
    }
  }
  return latest;
}

class DashboardCache {
  constructor(opts = {}) {
    this.intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
    this.idleThresholdS = opts.idleThresholdS != null ? opts.idleThresholdS : IDLE_THRESHOLD_S;
    this.projectsDir = opts.projectsDir; // undefined → slug 用默认 ~/.claude/projects
    this._now = opts.nowFn || Date.now; // 注入确定性时钟(测试)
    // 结构化会话状态机(PRD):跟踪每会话规范状态(idle/running/awaiting-input/error)
    // + 最近变更时间 changedAt。状态从 jsonl 推断结果归一,与 tmux 文本无关(AC5)。
    this._stateTracker = opts.stateTracker || new StateTracker({ nowFn: this._now });
    this.snapshots = new Map(); // sessionName → { status, state, lastLine, lastTs, cachedAt, changedAt }
    this.sessions = [];
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setSessions(sessions) {
    this.sessions = Array.isArray(sessions)
      ? sessions.filter((s) => s && s.name)
      : [];
  }

  refresh() {
    const nowMs = this._now();
    const names = [];
    for (const s of this.sessions) {
      if (!s || !s.name) continue;
      const snap = this._compute(s, nowMs);
      // 结构化状态机:把 jsonl 推断 status 归一为规范 state,跟踪 changedAt(AC1/AC5)。
      // 每个会话(含 unknown)都 observe → changedAt 恒为有效数字(AC1:绝不 null)。
      const { changedAt } = this._stateTracker.observe(s.name, snap.status, nowMs);
      snap.changedAt = changedAt;
      this.snapshots.set(s.name, snap);
      names.push(s.name);
    }
    const keep = new Set(names);
    for (const key of [...this.snapshots.keys()]) {
      if (!keep.has(key)) this.snapshots.delete(key);
    }
    // 同步清理已消失会话的状态跟踪记录(防内存泄漏 + 复活误判)
    this._stateTracker.retain(names);
  }

  _compute(session, nowMs) {
    const unknown = { status: 'unknown', state: 'idle', lastLine: '', lastTs: null, cachedAt: nowMs };
    try {
      const dir = this.projectsDir
        ? resolveProjectDir(session.cwd, this.projectsDir)
        : resolveProjectDir(session.cwd);
      if (!dir) return unknown;
      // 有 claudeSessionId 绑定 → 精确定位该 jsonl(消除同 cwd 多 session 都取 mtime 最新)
      // 无绑定 → 降级 mtime 最新(向后兼容老 session / 非 wrapper 启动的 claude)
      let latest;
      if (session.claudeSessionId) {
        // realpath 边界(评审团 4 号 A):claudeSessionId 从磁盘绑定读出后被拼成路径,必须防
        // 穿越/符号链接越界。dir、bound 都 realpathSync(消解符号链接,让 macOS /tmp↔/private/tmp
        // 等不致误杀),relative 逃出 dir(以 .. 开头或跨卷绝对路径)→ bound 视为不可信。
        // 降级兜底(评审团 HIGH #2):bound 缺失(陈旧绑定 / --session-id 文件名映射破裂 / claude
        // 改存储格式)或越界 → 回落 mtime 最新,保持该 session 看板可见(与 #24 前 mtime 行为一致),
        // 而非硬 unknown(mtime 只读 dir 内真实文件,安全);仅 dir 本身不存在才 unknown。
        const bound = path.join(dir, session.claudeSessionId + '.jsonl');
        let realDir;
        try {
          realDir = fs.realpathSync(dir);
        } catch {
          return unknown;
        }
        let realBound = null;
        try {
          const rb = fs.realpathSync(bound);
          const rel = path.relative(realDir, rb);
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) realBound = rb;
        } catch {
          /* bound 不存在/不可读 → realBound 留空,降级 mtime */
        }
        latest = realBound || latestJsonlByMtime(listProjectJsonls(realDir));
        if (!latest) return unknown;
      } else {
        latest = latestJsonlByMtime(listProjectJsonls(dir));
        if (!latest) return unknown;
      }
      const parsed = parseStatus(readTailEvents(latest), nowMs, this.idleThresholdS);
      return { ...parsed, state: normalizeState(parsed.status), cachedAt: nowMs };
    } catch {
      return unknown;
    }
  }

  getSnapshots() {
    return [...this.snapshots.entries()].map(([name, snap]) => ({ name, ...snap }));
  }
}

let instance = null;
function getDashboardCache(opts) {
  if (!instance) instance = new DashboardCache(opts);
  return instance;
}

// 端点聚合纯函数:tmux 会话列表 + 缓存快照 → 看板 payload
// autonomyBySession(可选,第 4 参):{name → {commit,rollback,interventions}} —— 单机 autonomy 指标。
//   提供时给每个 session 挂 autonomy 字段(供 hub 聚合);不提供(undefined)→ 完全向后兼容,
//   payload 形状与无该参数时一致(既有调用方/测试不受影响)。
// 结构化状态机(PRD):每条 session 额外暴露规范 state(idle/running/awaiting-input/error)
//   + changed_at(最近变更 ms)。state 由 jsonl 推断 status 归一,不依赖 tmux 文本(AC1/AC5)。
//   normalizeState 已在文件顶部从 ./session_status.cjs 引入。
function buildDashboardPayload(sessions, snapshots, tmuxOk, autonomyBySession) {
  const snapMap = new Map((snapshots || []).map((s) => [s.name, s]));
  const hasAuto = autonomyBySession && typeof autonomyBySession === 'object';
  return {
    tmuxOk: !!tmuxOk,
    sessions: (sessions || []).map((s) => {
      const snap = snapMap.get(s.name) || { status: 'unknown', lastLine: '', lastTs: null };
      const out = {
        name: s.name,
        cwd: s.cwd || null,
        status: snap.status,
        // 规范状态:即便 snapshot 缺失也归一为 idle(AC1:绝不 null/undefined)
        state: normalizeState(snap.state != null ? snap.state : snap.status),
        changed_at: typeof snap.changedAt === 'number' ? snap.changedAt : (snap.cachedAt || 0),
        lastLine: snap.lastLine,
        lastTs: snap.lastTs,
        attached: !!s.attached,
      };
      if (hasAuto) {
        // autonomy 计数缺失补零;字段名沿用 interventions(复数,计数语义)
        const a = autonomyBySession[s.name] || { commits: 0, rollbacks: 0, interventions: 0 };
        out.autonomy = {
          commits: typeof a.commits === 'number' ? a.commits : 0,
          rollbacks: typeof a.rollbacks === 'number' ? a.rollbacks : 0,
          interventions: typeof a.interventions === 'number' ? a.interventions : 0,
        };
      }
      return out;
    }),
  };
}

module.exports = {
  DashboardCache,
  getDashboardCache,
  buildDashboardPayload,
  latestJsonlByMtime,
  DEFAULT_INTERVAL_MS,
  IDLE_THRESHOLD_S,
};
