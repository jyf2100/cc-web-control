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
    this.snapshots = new Map(); // sessionName → { status, lastLine, lastTs, cachedAt }
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
    const nowMs = Date.now();
    for (const s of this.sessions) {
      this.snapshots.set(s.name, this._compute(s, nowMs));
    }
    const names = new Set(this.sessions.map((s) => s.name));
    for (const key of [...this.snapshots.keys()]) {
      if (!names.has(key)) this.snapshots.delete(key);
    }
  }

  _compute(session, nowMs) {
    const unknown = { status: 'unknown', lastLine: '', lastTs: null, cachedAt: nowMs };
    try {
      const dir = this.projectsDir
        ? resolveProjectDir(session.cwd, this.projectsDir)
        : resolveProjectDir(session.cwd);
      if (!dir) return unknown;
      // 有 claudeSessionId 绑定 → 精确定位该 jsonl(消除同 cwd 多 session 都取 mtime 最新)
      // 无绑定 → 降级 mtime 最新(向后兼容老 session / 非 wrapper 启动的 claude)
      let latest;
      if (session.claudeSessionId) {
        const bound = path.join(dir, session.claudeSessionId + '.jsonl');
        latest = fs.existsSync(bound) ? bound : null;
        if (!latest) return unknown;
      } else {
        latest = latestJsonlByMtime(listProjectJsonls(dir));
        if (!latest) return unknown;
      }
      const parsed = parseStatus(readTailEvents(latest), nowMs, this.idleThresholdS);
      return { ...parsed, cachedAt: nowMs };
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
function buildDashboardPayload(sessions, snapshots, tmuxOk) {
  const snapMap = new Map((snapshots || []).map((s) => [s.name, s]));
  return {
    tmuxOk: !!tmuxOk,
    sessions: (sessions || []).map((s) => {
      const snap = snapMap.get(s.name) || { status: 'unknown', lastLine: '', lastTs: null };
      return {
        name: s.name,
        cwd: s.cwd || null,
        status: snap.status,
        lastLine: snap.lastLine,
        lastTs: snap.lastTs,
        attached: !!s.attached,
      };
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
