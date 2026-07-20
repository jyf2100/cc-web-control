'use strict';
// sessions_query 纯函数单测:hub 多 CLI 工具会话查询(拍平 / 分组计数 / 过滤 / 非法枚举)。
// 对应 PRD 验收 #1(cli_tool 透传)/ #3(group_by=cli_tool)/ #4(过滤 + 非法枚举 400)。
const test = require('node:test');
const assert = require('node:assert/strict');
const { flattenSessions, groupByCliTool, filterByCliTool, querySessions, InvalidCliToolError, CLI_TOOLS } = require('../hub/sessions_query.cjs');

// latest 形状对齐 aggregator.getLatest():{ machines:[{id,name,cli_tool,online,sessions:[...]}] }
// session 已由 mergeDashboards 打上 cli_tool(此处直接构造,模拟聚合后状态)。
const LATEST = {
  machines: [
    { id: 'mc1', name: 'A', cli_tool: 'claude-code', online: true, sessions: [
      { name: 's1', status: 'working', cli_tool: 'claude-code' },
      { name: 's2', status: 'idle', cli_tool: 'claude-code' },
      { name: 's3', status: 'idle', cli_tool: 'claude-code' },
    ] },
    { id: 'mc2', name: 'B', cli_tool: 'grok-build', online: true, sessions: [
      { name: 'g1', status: 'errored', cli_tool: 'grok-build' },
    ] },
    { id: 'mc3', name: 'C', cli_tool: 'unknown', online: false, sessions: [] },
  ],
};

test('flattenSessions: 拍平 + 每条带 machine/machineName/cli_tool(离线机 0 会话不产出)', () => {
  const flat = flattenSessions(LATEST);
  assert.equal(flat.length, 4); // mc1×3 + mc2×1;mc3 离线 sessions=[] → 0
  assert.equal(flat[0].machine, 'mc1');
  assert.equal(flat[0].machineName, 'A');
  assert.equal(flat[0].cli_tool, 'claude-code');
  assert.equal(flat[3].name, 'g1');
  assert.equal(flat[3].cli_tool, 'grok-build');
});

test('flattenSessions: session 缺 cli_tool → 回退 machine.cli_tool;都缺 → unknown', () => {
  const flat = flattenSessions({ machines: [
    { id: 'm', name: 'M', cli_tool: 'codex', online: true, sessions: [{ name: 'a' /* 无 cli_tool */ }] },
    { id: 'm2', name: 'M2', online: true, sessions: [{ name: 'b' /* 机也缺 */ }] },
  ] });
  assert.equal(flat[0].cli_tool, 'codex');     // 回退到 machine
  assert.equal(flat[1].cli_tool, 'unknown');   // 机也缺 → unknown
});

test('flattenSessions: null/空 latest → []', () => {
  assert.deepEqual(flattenSessions(null), []);
  assert.deepEqual(flattenSessions({}), []);
  assert.deepEqual(flattenSessions({ machines: [] }), []);
});

test('groupByCliTool: 每个枚举键都在(含 0 计数)+ total 正确', () => {
  const flat = flattenSessions(LATEST);
  const { groups, total } = groupByCliTool(flat);
  // 验收 #3:结构包含每个枚举值的会话计数
  assert.deepEqual(groups, { 'claude-code': 3, 'grok-build': 1, 'codex': 0, 'cursor': 0, 'unknown': 0 });
  assert.equal(total, 4);
  // groups 恒含全部 5 个枚举键(即便计数为 0)
  for (const t of CLI_TOOLS) assert.ok(t in groups, `缺枚举键 ${t}`);
});

test('querySessions(?group_by=cli_tool) → { groups, total }', () => {
  const r = querySessions(LATEST, { groupBy: 'cli_tool' });
  assert.deepEqual(r.groups, { 'claude-code': 3, 'grok-build': 1, 'codex': 0, 'cursor': 0, 'unknown': 0 });
  assert.equal(r.total, 4);
});

test('querySessions(?cli_tool=grok-build) → 仅该工具会话,零串标', () => {
  const r = querySessions(LATEST, { cliTool: 'grok-build' });
  assert.ok(Array.isArray(r.sessions));
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].name, 'g1');
  // 零串标:返回的每条都是 grok-build
  assert.ok(r.sessions.every((s) => s.cli_tool === 'grok-build'));
});

test('querySessions(?cli_tool=claude-code) → 3 条,过滤结果不含其它工具', () => {
  const r = querySessions(LATEST, { cliTool: 'claude-code' });
  assert.equal(r.sessions.length, 3);
  assert.ok(r.sessions.every((s) => s.cli_tool === 'claude-code'));
});

test('querySessions(无参) → 全部会话', () => {
  const r = querySessions(LATEST, {});
  assert.equal(r.sessions.length, 4);
});

test('querySessions(?cli_tool=) 空串 → 不过滤(返回全部,非 400)', () => {
  const r = querySessions(LATEST, { cliTool: '' });
  assert.equal(r.sessions.length, 4);
});

test('querySessions 非法 cli_tool → 抛 InvalidCliToolError(含 allowed 枚举列表)', () => {
  // 验收 #4:非法枚举值(如 foo)→ 错误消息含合法枚举列表
  assert.throws(() => querySessions(LATEST, { cliTool: 'foo' }), (e) => {
    assert.ok(e instanceof InvalidCliToolError);
    assert.equal(e.code, 'INVALID_CLI_TOOL');
    assert.deepEqual(e.allowed, CLI_TOOLS);
    assert.ok(/claude-code/.test(e.message) && /grok-build/.test(e.message));
    return true;
  });
});

test('filterByCliTool: 只留匹配;非枚举 tool 归一为 unknown 再过滤', () => {
  const flat = flattenSessions(LATEST);
  assert.equal(filterByCliTool(flat, 'grok-build').length, 1);
  assert.equal(filterByCliTool(flat, 'cursor').length, 0);
  // 非法 tool 经 normalizeCliTool → unknown,匹配 cli_tool=unknown 的(此处 0 条)
  assert.equal(filterByCliTool(flat, 'bogus').length, 0);
});

test('groupBy 未知值(非 cli_tool)→ 宽容返回会话列表(不抛错)', () => {
  const r = querySessions(LATEST, { groupBy: 'something-else' });
  assert.ok(Array.isArray(r.sessions));
  assert.equal(r.sessions.length, 4);
});
