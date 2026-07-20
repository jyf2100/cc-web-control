'use strict';

/**
 * 单机维度「受监督自主运行」指标计数器(hub autonomy 面板的数据源)。
 *
 * 三项计数(均单调递增、仅观测、不改变 Claude 行为):
 *   commit        会话内 git commit 数(代码前进)
 *   rollback      会话内 git 回退/历史改写数(HEAD 后退语义:reset --hard / revert / rebase)
 *   intervention  用户主动打断 Claude 的次数(经本系统 WS 通道发送的 C-c / Esc)
 *
 * 数据来源(均为既有可观测信号,无新进程、不改 Claude):
 *   - commit/rollback:解析 Claude 会话 jsonl 尾部 assistant tool_use 事件中的 Bash 命令。
 *     复用 dashboard_tail/dashboard_slug 的「安全 mtime-latest」读取路径(只读项目目录内真实
 *     jsonl,绝不拼接不可信 claudeSessionId 路径 → 无穿越面)。lastTs 去重防 2s 轮询重复计数。
 *   - intervention:WS key 白名单中的 C-c(server.cjs 已限定)。recordIntervention 由 WS 层调用。
 *
 * 纯函数 + 依赖注入(对齐本仓测试风格):classifyGitCommand / scanGitActivity 无副作用,
 * AutonomyTracker 的 fs 读取经 inject 可替换。
 */

// —— 纯函数:分类单条 Bash 命令字符串 ——
// 返回 'commit' | 'rollback' | null。基于命令文本的启发式(v1,文档化):
//   commit   \bgit\s+commit\b           (含 --amend,仍算一次提交)
//   rollback \bgit\s+(reset|revert|rebase)\b
// 注:revert 创建反向提交(HEAD 前进),但语义上是「撤销」,归入 rollback;reset --hard /
//   reset <older> 直接令 HEAD 后退;rebase 改写历史。三者均为「自主行为回退」信号。
//   git checkout 切分支语义模糊,不计入(避免误报)。
const COMMIT_RE = /\bgit\s+commit\b/;
const ROLLBACK_RE = /\bgit\s+(?:reset|revert|rebase)\b/;

function classifyGitCommand(cmd) {
  const s = typeof cmd === 'string' ? cmd : '';
  if (!s) return null;
  // 先判 commit(二者互斥:同一条命令只算一类;reset/revert/rebase 不会同时含 commit)
  if (COMMIT_RE.test(s)) return 'commit';
  if (ROLLBACK_RE.test(s)) return 'rollback';
  return null;
}

// 从 assistant tool_use 事件里抽出 Bash 命令字符串(兼容 input.command / input.input 多种键)。
function extractBashCommand(event) {
  if (!event || event.type !== 'assistant' || !event.message) return null;
  const content = event.message.content;
  if (!Array.isArray(content)) return null;
  for (const b of content) {
    if (!b || b.type !== 'tool_use' || b.name !== 'Bash') continue;
    const input = b.input || {};
    // Claude Code Bash tool 的命令字段实证为 input.command;兼容 command/input 两种命名
    if (typeof input.command === 'string') return input.command;
    if (typeof input.input === 'string') return input.input;
  }
  return null;
}

function parseTsMs(event) {
  if (!event || typeof event.timestamp !== 'string') return null;
  const ms = Date.parse(event.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 扫描 jsonl 事件,统计 ts > sinceTs 的新增 commit/rollback 数,返回累计增量 + 本批最大 ts。
 * 纯函数,无副作用。events 为 readTailEvents 读出的末尾事件数组。
 * 返回 { commits, rollbacks, maxTs }。maxTs 供调用方推进去重游标(无可用 ts 的事件不影响 maxTs)。
 */
function scanGitActivity(events, sinceTs) {
  const out = { commits: 0, rollbacks: 0, maxTs: null };
  if (!Array.isArray(events)) return out;
  const cutoff = typeof sinceTs === 'number' && sinceTs > 0 ? sinceTs : null;
  for (const e of events) {
    const ts = parseTsMs(e);
    // cutoff 去重:ts 未知的事件不参与计数(无法判断新旧,避免重启后重数整条 tail 的风险)
    if (ts === null) continue;
    if (cutoff !== null && ts <= cutoff) continue;
    const cmd = extractBashCommand(e);
    if (!cmd) continue;
    const kind = classifyGitCommand(cmd);
    if (kind === 'commit') out.commits++;
    else if (kind === 'rollback') out.rollbacks++;
    if (out.maxTs === null || ts > out.maxTs) out.maxTs = ts;
  }
  return out;
}

// —— 有状态跟踪器(单机内存,重启归零;hub 侧已持久化增量,故单机丢失无碍) ——
// fs 读取经依赖注入:默认接 dashboard 安全读取助手,测试可替换为内存 fake。
const { readTailEvents } = require('./dashboard_tail.cjs');
const { resolveProjectDir, listProjectJsonls } = require('./dashboard_slug.cjs');

function defaultResolveDir(cwd) { return resolveProjectDir(cwd); }
function defaultPickJsonl(dir) {
  // 安全 mtime-latest:只读 dir 内真实 jsonl(非递归,与 dashboard 一致),无路径拼接 → 无穿越面
  const files = listProjectJsonls(dir);
  if (!files || files.length === 0) return null;
  let best = null, bestMt = -1;
  for (const f of files) {
    try {
      const st = require('fs').statSync(f);
      if (st.mtimeMs > bestMt) { bestMt = st.mtimeMs; best = f; }
    } catch { /* skip */ }
  }
  return best;
}

class AutonomyTracker {
  constructor(opts = {}) {
    this._readTail = opts.readTail || readTailEvents;
    this._resolveDir = opts.resolveDir || defaultResolveDir;
    this._pickJsonl = opts.pickJsonl || defaultPickJsonl;
    // sessionName → { commits, rollbacks, interventions, lastTs }
    this._counts = new Map();
  }

  _ensure(name) {
    let c = this._counts.get(name);
    if (!c) {
      c = { commits: 0, rollbacks: 0, interventions: 0, lastTs: null };
      this._counts.set(name, c);
    }
    return c;
  }

  // WS 层收到打断键(C-c / Esc)时调用 → interventions +1
  recordIntervention(name) {
    if (typeof name !== 'string' || !name) return;
    this._ensure(name).interventions++;
  }

  // 扫描某会话 jsonl 尾部,累加 commit/rollback 单调计数,推进 lastTs 去重游标。绝不抛。
  scanSession(session) {
    try {
      if (!session || typeof session.cwd !== 'string' || !session.cwd) return;
      const name = session.name;
      if (typeof name !== 'string' || !name) return;
      const dir = this._resolveDir(session.cwd);
      if (!dir) return;
      const jsonl = this._pickJsonl(dir);
      if (!jsonl) return;
      const c = this._ensure(name);
      const delta = scanGitActivity(this._readTail(jsonl), c.lastTs);
      c.commits += delta.commits;
      c.rollbacks += delta.rollbacks;
      if (delta.maxTs !== null) c.lastTs = delta.maxTs;
    } catch {
      /* 任何读取/解析失败:静默,保持既有计数(绝不归零、绝不抛) */
    }
  }

  // 批量刷新(传入 tmux 会话列表,与 dashboardCache.setSessions 同源)
  tick(sessions) {
    if (!Array.isArray(sessions)) return;
    for (const s of sessions) this.scanSession(s);
  }

  // 清理已不存在的会话计数(与 dashboardCache 同步,防 stale 计数泄漏到 payload)
  retain(names) {
    const keep = new Set(Array.isArray(names) ? names : []);
    for (const n of [...this._counts.keys()]) {
      if (!keep.has(n)) this._counts.delete(n);
    }
  }

  // 供 buildDashboardPayload 合并:返回 {name → {commits,rollbacks,interventions}}
  // 仅包含 names 列表中的会话(其余不外泄),缺失补零。
  snapshot(names) {
    const out = {};
    for (const n of (Array.isArray(names) ? names : [])) {
      const c = this._counts.get(n);
      out[n] = c
        ? { commits: c.commits, rollbacks: c.rollbacks, interventions: c.interventions }
        : { commits: 0, rollbacks: 0, interventions: 0 };
    }
    return out;
  }
}

module.exports = {
  classifyGitCommand,
  extractBashCommand,
  scanGitActivity,
  AutonomyTracker,
};
