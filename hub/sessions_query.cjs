'use strict';

// 纯函数:hub 聚合看板的多 CLI 工具会话查询 + 结构化状态机查询(无副作用、依赖注入 latest)。
// 输入 latest = aggregator.getLatest() => { machines:[{id,name,cli_tool,online,sessions:[...]}] }
// 每条 session 经 mergeDashboards 已带 cli_tool(缺省回退 'unknown')与结构化状态字段
// state(idle/running/awaiting-input/error)+ changed_at(透传自单机 /api/dashboard)。
// 供 hub/server.cjs 的:
//   GET /api/sessions(?group_by=cli_tool|status / ?cli_tool= / ?status=)与
//   GET /api/sessions/:machine / GET /api/sessions/:machine/:session/status 使用。
// CLI_TOOLS 为合法枚举(与 config.cjs 同源);SESSION_STATES 为合法状态枚举(session_status.cjs 同源)。

const { CLI_TOOLS, normalizeCliTool } = require('./config.cjs');
const { SESSION_STATES, normalizeState, InvalidStatusError } = require('../session_status.cjs');

// 把 latest 拍平为会话数组(每条带 machine/machineName/cli_tool/state/changed_at)。离线机(sessions 已为 [])不产出。
function flattenSessions(latest) {
  const out = [];
  for (const m of (latest && latest.machines) || []) {
    if (!m) continue;
    const cliTool = normalizeCliTool(m.cli_tool);
    for (const s of m.sessions || []) {
      if (!s) continue;
      out.push({
        machine: m.id,
        machineName: typeof m.name === 'string' ? m.name : m.id,
        name: s.name,
        status: s.status,
        // 规范状态:优先取上游 state;缺失则由 status 归一(防御老节点/未知)(AC1:绝不 null)
        state: normalizeState(s.state != null ? s.state : s.status),
        changed_at: typeof s.changed_at === 'number' ? s.changed_at : (s.lastTs || 0),
        cwd: s.cwd,
        lastLine: s.lastLine,
        lastTs: s.lastTs,
        attached: s.attached,
        cli_tool: normalizeCliTool(s.cli_tool || cliTool),
      });
    }
  }
  return out;
}

// 按规范状态分组(AC4 计数):返回 { groups: {每个枚举:count}, total }。
// groups 恒含全部 4 个 SESSION_STATES 键(未出现为 0)。
function groupByState(sessions) {
  const groups = {};
  for (const st of SESSION_STATES) groups[st] = 0;
  let total = 0;
  for (const s of sessions || []) {
    total++;
    const key = normalizeState(s && s.state);
    groups[key] += 1;
  }
  return { groups, total };
}

// 过滤:只留 state === want 的会话(want 须为合法枚举;非法交由调用方/InvalidStatusError)。
function filterByState(sessions, want) {
  const target = normalizeState(want);
  return (sessions || []).filter((s) => normalizeState(s && s.state) === target);
}

// 取单个会话的结构化状态(AC5:查询某节点当前状态 → {node_id, session, status, changed_at})。
// 找不到 → undefined(端点据此 404)。state 经 normalizeState 保证为 4 枚举之一(AC1)。
function findSessionStatus(latest, machineId, sessionName) {
  const flat = flattenSessions(latest);
  const hit = flat.find((s) => s && s.machine === machineId && s.name === sessionName);
  if (!hit) return undefined;
  return {
    node_id: machineId,
    session: sessionName,
    status: normalizeState(hit.state),
    changed_at: hit.changed_at || 0,
  };
}

// 按 cli_tool 计数:返回 { groups: {每个枚举值: count}, total }。groups 恒含全部 5 个枚举键。
function groupByCliTool(sessions) {
  const groups = {};
  for (const t of CLI_TOOLS) groups[t] = 0;
  let total = 0;
  for (const s of sessions || []) {
    total++;
    const key = normalizeCliTool(s && s.cli_tool);
    groups[key] += 1;
  }
  return { groups, total };
}

// 过滤:只留 cli_tool === tool 的会话(tool 须为合法枚举)。
function filterByCliTool(sessions, tool) {
  const want = normalizeCliTool(tool);
  return (sessions || []).filter((s) => normalizeCliTool(s && s.cli_tool) === want);
}

class InvalidCliToolError extends Error {
  constructor(value) {
    super(`invalid cli_tool "${value}"; allowed: ${CLI_TOOLS.join(', ')}`);
    this.name = 'InvalidCliToolError';
    this.allowed = CLI_TOOLS.slice();
    this.code = 'INVALID_CLI_TOOL';
  }
}

// 统一查询入口:
//  - { groupBy: 'cli_tool' }            → { groups:{cli→count}, total }
//  - { groupBy: 'status' }              → { groups:{state→count}, total }(结构化状态计数,AC4)
//  - { cliTool: '<enum>' }(非空)       → { sessions: [...] }(过滤后);非法枚举抛 InvalidCliToolError
//  - { status: '<enum>' }(非空)        → { sessions: [...] }(按规范状态过滤,AC4);非法抛 InvalidStatusError
//  - 否则                                → { sessions: [...] }(全部)
// cliTool/status 为空串/undefined 视作「不过滤」;groupBy 非 'cli_tool'/'status' 视作「不分组」(宽容,不抛错)。
// 过滤优先级:status 高于 cliTool(更具体的调度前提);二者同时给定时 status 先过滤(均须合法)。
function querySessions(latest, { groupBy, cliTool, status } = {}) {
  const sessions = flattenSessions(latest);
  // 结构化状态过滤(AC4):?status=awaiting-input 等。非法枚举 → 抛 InvalidStatusError(400)。
  if (typeof status === 'string' && status !== '') {
    if (!SESSION_STATES.includes(status)) throw new InvalidStatusError(status);
    const filtered = filterByState(sessions, status);
    // status 过滤后不再叠加 groupBy(过滤语义优先,结果即会话列表)
    return { sessions: filtered };
  }
  if (typeof cliTool === 'string' && cliTool !== '') {
    if (!CLI_TOOLS.includes(cliTool)) throw new InvalidCliToolError(cliTool);
    return { sessions: filterByCliTool(sessions, cliTool) };
  }
  if (groupBy === 'cli_tool') {
    return groupByCliTool(sessions);
  }
  if (groupBy === 'status') {
    return groupByState(sessions);
  }
  return { sessions };
}

module.exports = {
  CLI_TOOLS,
  SESSION_STATES,
  flattenSessions,
  groupByCliTool,
  filterByCliTool,
  groupByState,
  filterByState,
  findSessionStatus,
  querySessions,
  InvalidCliToolError,
  InvalidStatusError,
};
