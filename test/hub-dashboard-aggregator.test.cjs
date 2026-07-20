const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeDashboards, DashboardAggregator } = require('../hub/dashboard_aggregator.cjs');

// input: 各机抓取结果 { machine:{id,name}, online, payload?, error? }

test('mergeDashboards 合并多机 + session 带 machine', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true,
      payload: { tmuxOk: true, sessions: [
        { name: 's1', cwd: '/a', status: 'working', lastLine: 'x', lastTs: 1, attached: false },
      ] } },
    { machine: { id: 'mc2', name: 'B' }, online: true,
      payload: { tmuxOk: true, sessions: [
        { name: 's2', cwd: '/b', status: 'idle', lastLine: '', lastTs: 2, attached: true },
      ] } },
  ]);
  assert.equal(merged.machines.length, 2);
  const mc1 = merged.machines.find((m) => m.id === 'mc1');
  assert.equal(mc1.online, true);
  assert.equal(mc1.sessions.length, 1);
  assert.equal(mc1.sessions[0].machine, 'mc1');
  assert.equal(mc1.sessions[0].name, 's1');
});

test('mergeDashboards 离线机 → online:false,sessions:[]', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: false, error: 'ECONNREFUSED' },
  ]);
  assert.equal(merged.machines[0].online, false);
  assert.deepEqual(merged.machines[0].sessions, []);
  assert.equal(merged.machines[0].lastError, 'ECONNREFUSED');
});

test('mergeDashboards payload 缺失 sessions → 安全降级空数组', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true, payload: { tmuxOk: true } },
  ]);
  assert.deepEqual(merged.machines[0].sessions, []);
});

test('mergeDashboards 空输入 → { machines: [] }', () => {
  assert.deepEqual(mergeDashboards([]), { machines: [] });
});

// —— DashboardAggregator 类(依赖注入 fetchOne + fake registry) ——

function fakeRegistry(machines) {
  const state = new Map(machines.map((m) => [m.id, { ...m, online: false, lastError: null }]));
  return {
    all() { return Array.from(state.values()).map(({ token, ...rest }) => rest); },
    getSecret(id) { const m = state.get(id); return m ? { id: m.id, name: m.name, url: m.url, token: m.token } : undefined; },
    setOnline(id, online, err) { const m = state.get(id); if (m) state.set(id, { ...m, online: !!online, lastError: online ? null : err }); },
  };
}

test('DashboardAggregator _tick 用 getSecret 取 token 调 fetchOne + 更新 online', async () => {
  const seen = [];
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new DashboardAggregator({
    registry: reg,
    fetchOne: async (secret) => { seen.push(secret); return { ok: true, payload: { tmuxOk: true, sessions: [] } }; },
    intervalMs: 999999,
  });
  await agg._tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].token, 't1'); // fetchOne 收到含 token 的 secret(来自 getSecret)
  assert.equal(agg.getLatest().machines[0].online, true);
  assert.equal(agg.getLatest().machines[0].sessions.length, 0);
});

test('DashboardAggregator fetchOne 失败 → online:false + lastError', async () => {
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new DashboardAggregator({
    registry: reg,
    fetchOne: async () => ({ ok: false, error: 'ECONNREFUSED' }),
    intervalMs: 999999,
  });
  await agg._tick();
  const latest = agg.getLatest();
  assert.equal(latest.machines[0].online, false);
  assert.equal(latest.machines[0].lastError, 'ECONNREFUSED');
});

test('DashboardAggregator fetchOne 抛异常 → 该机 online:false + lastError,不影响其它机', async () => {
  const reg = fakeRegistry([
    { id: 'mc1', name: 'A', url: 'http://1', token: 't1' },
    { id: 'mc2', name: 'B', url: 'http://2', token: 't2' },
  ]);
  const agg = new DashboardAggregator({
    registry: reg,
    fetchOne: async (secret) => { if (secret.id === 'mc1') throw new Error('boom'); return { ok: true, payload: { tmuxOk: true, sessions: [] } }; },
    intervalMs: 999999,
  });
  await agg._tick();
  const latest = agg.getLatest();
  const mc1 = latest.machines.find((m) => m.id === 'mc1');
  const mc2 = latest.machines.find((m) => m.id === 'mc2');
  assert.equal(mc1.online, false);
  assert.equal(mc1.lastError, 'boom');
  assert.equal(mc2.online, true); // 异常隔离,mc2 仍正常
});

// —— onResult 钩子(autonomy 增量检测消费;向后兼容:不传 = 无副作用) ——

test('DashboardAggregator onResult:每轮 _tick 后以原始 results 回调(含 payload)', async () => {
  const seen = [];
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new DashboardAggregator({
    registry: reg,
    fetchOne: async () => ({ ok: true, payload: { tmuxOk: true, sessions: [{ autonomy: { commits: 1, rollbacks: 0, interventions: 0 } }] } }),
    intervalMs: 999999,
    onResult: (results) => { seen.push(results); },
  });
  await agg._tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].machine.id, 'mc1');
  assert.equal(seen[0][0].online, true);
  assert.equal(seen[0][0].payload.sessions[0].autonomy.commits, 1);
});

test('DashboardAggregator 无 onResult → 行为不变(向后兼容)', async () => {
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new DashboardAggregator({
    registry: reg,
    fetchOne: async () => ({ ok: true, payload: { tmuxOk: true, sessions: [] } }),
    intervalMs: 999999,
  });
  await agg._tick(); // 不抛即通过
  assert.equal(agg.getLatest().machines[0].online, true);
});

test('DashboardAggregator onResult 抛错被吞,不影响聚合主流程', async () => {
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new DashboardAggregator({
    registry: reg,
    fetchOne: async () => ({ ok: true, payload: { tmuxOk: true, sessions: [] } }),
    intervalMs: 999999,
    onResult: () => { throw new Error('downstream boom'); },
  });
  await agg._tick(); // onResult 抛错被吞,_tick 正常 resolve
  assert.equal(agg.getLatest().machines[0].online, true);
});
