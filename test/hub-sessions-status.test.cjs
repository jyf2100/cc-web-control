'use strict';
// hub sessions_query 结构化状态机单测:状态过滤 / 分组计数 / 单会话查询 / 非法枚举。
// 对应 PRD 验收:#1(枚举完备)、#4(按状态过滤)、#5(结构化字段 {node_id,status,changed_at})。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  flattenSessions,
  groupByState,
  filterByState,
  findSessionStatus,
  querySessions,
  InvalidStatusError,
  SESSION_STATES,
} = require('../hub/sessions_query.cjs');

// latest 形状对齐 aggregator.getLatest();session 已带结构化 state + changed_at(透传自单机)。
const LATEST = {
  machines: [
    { id: 'mc1', name: 'A', cli_tool: 'claude-code', online: true, sessions: [
      { name: 's1', status: 'working', state: 'running', changed_at: 100, cli_tool: 'claude-code' },
      { name: 's2', status: 'idle', state: 'idle', changed_at: 200, cli_tool: 'claude-code' },
      { name: 's3', status: 'waiting', state: 'awaiting-input', changed_at: 300, cli_tool: 'claude-code' },
    ] },
    { id: 'mc2', name: 'B', cli_tool: 'grok-build', online: true, sessions: [
      { name: 'g1', status: 'errored', state: 'error', changed_at: 400, cli_tool: 'grok-build' },
      { name: 'g2', status: 'waiting', state: 'awaiting-input', changed_at: 500, cli_tool: 'grok-build' },
    ] },
    { id: 'mc3', name: 'C', cli_tool: 'unknown', online: false, sessions: [] },
  ],
};

test('flattenSessions:每条带 state + changed_at(透传)', () => {
  const flat = flattenSessions(LATEST);
  assert.equal(flat.length, 5);
  assert.equal(flat[0].state, 'running');
  assert.equal(flat[0].changed_at, 100);
  assert.equal(flat[3].state, 'error');
  assert.equal(flat[3].changed_at, 400);
});

test('flattenSessions:缺 state → 由 status 归一(防御老节点)', () => {
  const flat = flattenSessions({ machines: [
    { id: 'm', name: 'M', online: true, sessions: [
      { name: 'a', status: 'working' /* 无 state */ },
      { name: 'b', status: 'errored' /* 无 state */ },
    ] },
  ] });
  assert.equal(flat[0].state, 'running');
  assert.equal(flat[1].state, 'error');
});

// AC4:按状态过滤
test('querySessions(?status=awaiting-input) → 仅该状态会话,零串标', () => {
  const r = querySessions(LATEST, { status: 'awaiting-input' });
  assert.ok(Array.isArray(r.sessions));
  assert.equal(r.sessions.length, 2);
  assert.ok(r.sessions.every((s) => s.state === 'awaiting-input'));
});

test('querySessions(?status=error) → 仅出错会话', () => {
  const r = querySessions(LATEST, { status: 'error' });
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].name, 'g1');
});

test('querySessions(?status=running) → 1 条', () => {
  assert.equal(querySessions(LATEST, { status: 'running' }).sessions.length, 1);
});

test('querySessions(?status=idle) → 1 条', () => {
  assert.equal(querySessions(LATEST, { status: 'idle' }).sessions.length, 1);
});

test('querySessions(?status=) 空串 → 不过滤(返回全部,非 400)', () => {
  assert.equal(querySessions(LATEST, { status: '' }).sessions.length, 5);
});

// AC4 计数:按状态分组
test('querySessions(?group_by=status) → { groups:四态计数, total }', () => {
  const r = querySessions(LATEST, { groupBy: 'status' });
  assert.deepEqual(r.groups, { idle: 1, running: 1, 'awaiting-input': 2, error: 1 });
  assert.equal(r.total, 5);
  // groups 恒含全部 4 枚举键
  for (const s of SESSION_STATES) assert.ok(s in r.groups, `缺枚举键 ${s}`);
});

test('groupByState:空 → 全 0', () => {
  const { groups, total } = groupByState([]);
  assert.deepEqual(groups, { idle: 0, running: 0, 'awaiting-input': 0, error: 0 });
  assert.equal(total, 0);
});

test('filterByState:直接函数也能用', () => {
  const flat = flattenSessions(LATEST);
  assert.equal(filterByState(flat, 'error').length, 1);
  assert.equal(filterByState(flat, 'awaiting-input').length, 2);
});

test('querySessions 非法 status → 抛 InvalidStatusError(含 allowed)', () => {
  assert.throws(() => querySessions(LATEST, { status: 'working' }), (e) => {
    assert.ok(e instanceof InvalidStatusError);
    assert.equal(e.code, 'INVALID_STATUS');
    assert.deepEqual(e.allowed, [...SESSION_STATES]);
    return true;
  });
});

test('querySessions status 优先于 groupBy(过滤语义优先,返回会话列表)', () => {
  const r = querySessions(LATEST, { status: 'error', groupBy: 'status' });
  assert.ok(Array.isArray(r.sessions));
  assert.equal(r.sessions.length, 1);
});

// AC5:结构化单会话查询 → {node_id, session, status, changed_at}
test('findSessionStatus:返回结构化状态字段(AC5)', () => {
  const r = findSessionStatus(LATEST, 'mc2', 'g1');
  assert.deepEqual(r, { node_id: 'mc2', session: 'g1', status: 'error', changed_at: 400 });
});

test('findSessionStatus:status 恒为 4 枚举之一(AC1)', () => {
  for (const m of LATEST.machines) {
    for (const s of (m.sessions || [])) {
      const r = findSessionStatus(LATEST, m.id, s.name);
      assert.ok(SESSION_STATES.includes(r.status), `${m.id}/${s.name} → ${r.status}`);
    }
  }
});

test('findSessionStatus:会话不存在 → undefined', () => {
  assert.equal(findSessionStatus(LATEST, 'mc1', 'nope'), undefined);
  assert.equal(findSessionStatus(LATEST, 'mcX', 's1'), undefined);
});
