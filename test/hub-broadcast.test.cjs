'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  broadcastCommand,
  interveneCommand,
  resolveBroadcastTargets,
  dedupTargets,
  buildOnlineMap,
  summarizeResults,
  BROADCAST_MAX_TARGETS,
} = require('../hub/broadcast.cjs');

// ── dedupTargets ──

test('dedupTargets:同 machine+session 去重,无效条目丢弃', () => {
  const out = dedupTargets([
    { machine: 'mc1', session: 'a' },
    { machine: 'mc1', session: 'a' }, // dup
    { machine: 'mc1', session: 'b' },
    { machine: 'mc2', session: 'a' },
    null,                        // invalid
    { session: 'x' },            // no machine
    { machine: 'mc3' },          // no session (null allowed → kept)
    { machine: 'mc3' },          // dup null session
  ]);
  assert.deepEqual(out, [
    { machine: 'mc1', session: 'a' },
    { machine: 'mc1', session: 'b' },
    { machine: 'mc2', session: 'a' },
    { machine: 'mc3', session: null },
  ]);
});

// ── resolveBroadcastTargets ──

test('resolveBroadcastTargets:显式 targets 优先(不查 dashboard)', () => {
  const out = resolveBroadcastTargets({
    targets: [{ machine: 'mc1', session: 's1' }],
    latestDashboard: { machines: [{ id: 'mc1', online: true, sessions: [{ name: 'other' }] }] },
    registrySnapshot: [{ id: 'mc2', online: true }],
  });
  assert.deepEqual(out, [{ machine: 'mc1', session: 's1' }]);
});

test('resolveBroadcastTargets:自动解析 — 在线机取 sessions,离线机占位 null', () => {
  const out = resolveBroadcastTargets({
    latestDashboard: {
      machines: [
        { id: 'mc1', online: true, sessions: [{ name: 's1' }, { name: 's2' }] },
        { id: 'mc2', online: false, sessions: [] },
        { id: 'mc3', online: true, sessions: [{ name: 'main' }] },
      ],
    },
    registrySnapshot: [
      { id: 'mc1', online: true },
      { id: 'mc2', online: false },
      { id: 'mc3', online: true },
    ],
  });
  assert.deepEqual(out, [
    { machine: 'mc1', session: 's1' },
    { machine: 'mc1', session: 's2' },
    { machine: 'mc2', session: null },  // 离线机占位
    { machine: 'mc3', session: 'main' },
  ]);
});

test('resolveBroadcastTargets:machines 过滤只解析指定机', () => {
  const out = resolveBroadcastTargets({
    machines: ['mc1'],
    latestDashboard: {
      machines: [
        { id: 'mc1', online: true, sessions: [{ name: 's1' }] },
        { id: 'mc2', online: true, sessions: [{ name: 's2' }] },
      ],
    },
    registrySnapshot: [
      { id: 'mc1', online: true },
      { id: 'mc2', online: true },
    ],
  });
  assert.deepEqual(out, [{ machine: 'mc1', session: 's1' }]);
});

test('resolveBroadcastTargets:无 registrySnapshot 时回退到 dashboard', () => {
  const out = resolveBroadcastTargets({
    latestDashboard: {
      machines: [{ id: 'mc1', online: true, sessions: [{ name: 's1' }] }],
    },
  });
  assert.deepEqual(out, [{ machine: 'mc1', session: 's1' }]);
});

test('resolveBroadcastTargets:空输入 → 空数组', () => {
  assert.deepEqual(resolveBroadcastTargets({}), []);
  assert.deepEqual(resolveBroadcastTargets({ targets: [], latestDashboard: { machines: [] } }), []);
});

// ── broadcastCommand ──

test('broadcastCommand:3 个在线目标全部 delivered', async () => {
  const calls = [];
  const getClient = (mid) => ({
    sendOneShot: async (session, msg) => {
      calls.push({ mid, session, msg });
      return { ok: true };
    },
  });
  const result = await broadcastCommand({
    targets: [
      { machine: 'mc1', session: 's1' },
      { machine: 'mc2', session: 's2' },
      { machine: 'mc3', session: 's3' },
    ],
    data: 'npm test',
    enter: true,
    getClient,
    getLatest: () => ({ machines: [
      { id: 'mc1', online: true }, { id: 'mc2', online: true }, { id: 'mc3', online: true },
    ] }),
  });
  assert.equal(calls.length, 3);
  assert.equal(result.results.length, 3);
  assert.ok(result.results.every((r) => r.status === 'delivered' && r.ok));
  assert.deepEqual(result.summary, { total: 3, delivered: 3, failed: 0, offline: 0, unknown: 0 });
  // 验证消息格式
  assert.deepEqual(calls[0].msg, { type: 'input', data: 'npm test', enter: true });
});

test('broadcastCommand:离线节点 → status:offline,不尝试连接(AC2)', async () => {
  const calls = [];
  const getClient = (mid) => ({
    sendOneShot: async () => { calls.push(mid); return { ok: true }; },
  });
  const result = await broadcastCommand({
    targets: [
      { machine: 'mc1', session: 's1' },
      { machine: 'mc2', session: 's2' },  // offline
      { machine: 'mc3', session: 's3' },
    ],
    data: 'go',
    getClient,
    getLatest: () => ({ machines: [
      { id: 'mc1', online: true },
      { id: 'mc2', online: false },  // ← 离线
      { id: 'mc3', online: true },
    ] }),
  });
  // mc2 不应被调用 sendOneShot
  assert.ok(!calls.includes('mc2'), '离线机不应尝试连接');
  assert.equal(calls.length, 2);
  const mc2Result = result.results.find((r) => r.machine === 'mc2');
  assert.equal(mc2Result.status, 'offline');
  assert.equal(mc2Result.ok, false);
  assert.equal(mc2Result.error, 'node offline');
  assert.deepEqual(result.summary, { total: 3, delivered: 2, failed: 0, offline: 1, unknown: 0 });
});

test('broadcastCommand:离线机占位(session:null)→ status:offline', async () => {
  const getClient = () => ({ sendOneShot: async () => ({ ok: true }) });
  const result = await broadcastCommand({
    targets: [{ machine: 'mc1', session: null }],
    data: 'x',
    getClient,
    getLatest: () => ({ machines: [{ id: 'mc1', online: false }] }),
  });
  assert.equal(result.results[0].status, 'offline');
  assert.equal(result.results[0].ok, false);
});

test('broadcastCommand:投递失败(tmux 会话不存在)→ status:failed + error(AC6)', async () => {
  const getClient = () => ({
    sendOneShot: async () => ({ ok: false, error: '会话不存在或无法读取: "s1"' }),
  });
  const result = await broadcastCommand({
    targets: [{ machine: 'mc1', session: 's1' }],
    data: 'x',
    getClient,
    getLatest: () => ({ machines: [{ id: 'mc1', online: true }] }),
  });
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].error, /会话不存在/);
});

test('broadcastCommand:未知 machine → status:unknown', async () => {
  const getClient = () => null;
  const result = await broadcastCommand({
    targets: [{ machine: 'ghost', session: 's1' }],
    data: 'x',
    getClient,
    getLatest: () => ({ machines: [{ id: 'ghost', online: true }] }),
  });
  assert.equal(result.results[0].status, 'unknown');
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].error, /unknown machine/);
});

test('broadcastCommand:sendOneShot 抛异常 → status:failed,不传播', async () => {
  const getClient = () => ({
    sendOneShot: async () => { throw new Error('ECONNREFUSED'); },
  });
  const result = await broadcastCommand({
    targets: [{ machine: 'mc1', session: 's1' }],
    data: 'x',
    getClient,
    getLatest: () => ({ machines: [{ id: 'mc1', online: true }] }),
  });
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].error, 'ECONNREFUSED');
});

test('broadcastCommand:单设备隔离 — 只向指定目标投递(AC4)', async () => {
  const received = [];
  const getClient = (mid) => ({
    sendOneShot: async (session) => { received.push({ mid, session }); return { ok: true }; },
  });
  await broadcastCommand({
    targets: [{ machine: 'mcA', session: 'sA' }],
    data: 'secret-A',
    getClient,
    getLatest: () => ({ machines: [{ id: 'mcA', online: true }, { id: 'mcB', online: true }] }),
  });
  // mcB 不在 targets 中,不应收到任何消息
  assert.ok(!received.some((r) => r.mid === 'mcB'), 'mcB 不应收到投递');
  assert.equal(received.length, 1);
  assert.equal(received[0].mid, 'mcA');
});

test('broadcastCommand:getLatest 为 null 时不做离线预判(全部尝试投递)', async () => {
  const calls = [];
  const getClient = (mid) => ({
    sendOneShot: async () => { calls.push(mid); return { ok: true }; },
  });
  await broadcastCommand({
    targets: [{ machine: 'mc1', session: 's1' }],
    data: 'x',
    getClient,
    // 不传 getLatest
  });
  assert.equal(calls.length, 1);
});

// ── interveneCommand ──

test('interveneCommand:正常单行注入 → delivered', async () => {
  let sentMsg = null;
  const getClient = () => ({
    sendOneShot: async (session, msg) => { sentMsg = msg; return { ok: true }; },
  });
  const r = await interveneCommand({
    machine: 'mc1', session: 's1', data: 'fix param to 42',
    getClient,
    getLatest: () => ({ machines: [{ id: 'mc1', online: true }] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.result.status, 'delivered');
  assert.deepEqual(sentMsg, { type: 'input', data: 'fix param to 42', enter: true });
});

test('interveneCommand:拒绝换行(防 tmux 注入)', async () => {
  const r = await interveneCommand({
    machine: 'mc1', session: 's1', data: 'line1\nline2',
    getClient: () => ({ sendOneShot: async () => ({ ok: true }) }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad_request');
  assert.match(r.error, /single-line/);
});

test('interveneCommand:拒绝 \r 换行', async () => {
  const r = await interveneCommand({
    machine: 'mc1', session: 's1', data: 'a\rb',
    getClient: () => ({ sendOneShot: async () => ({ ok: true }) }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad_request');
});

test('interveneCommand:缺字段 → bad_request', async () => {
  assert.equal((await interveneCommand({ data: 'x', getClient: () => null })).code, 'bad_request');
  assert.equal((await interveneCommand({ machine: 'mc1', data: 'x', getClient: () => null })).code, 'bad_request');
  assert.equal((await interveneCommand({ machine: 'mc1', session: 's1', getClient: () => null })).code, 'bad_request');
});

test('interveneCommand:离线节点 → offline', async () => {
  const r = await interveneCommand({
    machine: 'mc1', session: 's1', data: 'hi',
    getClient: () => ({ sendOneShot: async () => ({ ok: true }) }),
    getLatest: () => ({ machines: [{ id: 'mc1', online: false }] }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.result.status, 'offline');
});

test('interveneCommand:enter=false 透传', async () => {
  let sentMsg = null;
  const getClient = () => ({
    sendOneShot: async (session, msg) => { sentMsg = msg; return { ok: true }; },
  });
  await interveneCommand({
    machine: 'mc1', session: 's1', data: 'text', enter: false,
    getClient,
    getLatest: () => ({ machines: [{ id: 'mc1', online: true }] }),
  });
  assert.equal(sentMsg.enter, false);
});

// ── summarizeResults ──

test('summarizeResults:各类计数正确', () => {
  const summary = summarizeResults([
    { status: 'delivered' },
    { status: 'delivered' },
    { status: 'failed' },
    { status: 'offline' },
    { status: 'unknown' },
  ]);
  assert.deepEqual(summary, { total: 5, delivered: 2, failed: 1, offline: 1, unknown: 1 });
});

test('summarizeResults:空数组', () => {
  assert.deepEqual(summarizeResults([]), { total: 0, delivered: 0, failed: 0, offline: 0, unknown: 0 });
});

// ── buildOnlineMap ──

test('buildOnlineMap:从 dashboard 构建 machine→online 映射', () => {
  const map = buildOnlineMap({ machines: [
    { id: 'mc1', online: true },
    { id: 'mc2', online: false },
    { id: 'mc3' },  // online 未定义 → 视为 true
  ] });
  assert.equal(map.get('mc1'), true);
  assert.equal(map.get('mc2'), false);
  assert.equal(map.get('mc3'), true);  // undefined !== false
  assert.equal(map.get('mc4'), undefined);  // 不在列表
});
