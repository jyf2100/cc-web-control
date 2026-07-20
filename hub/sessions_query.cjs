'use strict';

// 纯函数:hub 聚合看板的多 CLI 工具会话查询(无副作用、依赖注入 latest)。
// 输入 latest = aggregator.getLatest() => { machines:[{id,name,cli_tool,online,sessions:[...]}] }
// 每条 session 经 mergeDashboards 已带 cli_tool(缺省回退 'unknown')。
// 供 hub/server.cjs 的 GET /api/sessions(?group_by=cli_tool / ?cli_tool=)与
// GET /api/sessions/:machine 使用。CLI_TOOLS 为合法枚举(与 config.cjs 同源)。

const { CLI_TOOLS, normalizeCliTool } = require('./config.cjs');

// 把 latest 拍平为会话数组(每条带 machine/machineName/cli_tool)。离线机(sessions 已为 [])不产出。
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
//  - { groupBy: 'cli_tool' }            → { groups, total }
//  - { cliTool: '<enum>' }(非空)       → { sessions: [...] }(过滤后);非法枚举抛 InvalidCliToolError
//  - 否则                                → { sessions: [...] }(全部)
// cliTool 为空串/undefined 视作「不过滤」;groupBy 非 'cli_tool' 视作「不分组」(宽容,不抛错)。
function querySessions(latest, { groupBy, cliTool } = {}) {
  const sessions = flattenSessions(latest);
  if (typeof cliTool === 'string' && cliTool !== '') {
    if (!CLI_TOOLS.includes(cliTool)) throw new InvalidCliToolError(cliTool);
    return { sessions: filterByCliTool(sessions, cliTool) };
  }
  if (groupBy === 'cli_tool') {
    return groupByCliTool(sessions);
  }
  return { sessions };
}

module.exports = {
  CLI_TOOLS,
  flattenSessions,
  groupByCliTool,
  filterByCliTool,
  querySessions,
  InvalidCliToolError,
};
