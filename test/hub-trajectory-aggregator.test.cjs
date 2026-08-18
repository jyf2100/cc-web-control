'use strict';
// hub/trajectory_aggregator.cjs 单测:验收 5(两机聚合、machine 归属、total=和)、
// 验收 7(机器过滤 / UTC 日期过滤边界)、离线机容错、轮询器 DI。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeTrajectories,
  queryTrajectories,
  parseDateFilter,
  TrajectoryAggregator,
  InvalidTrajectoryDateError,
} = require('../hub/trajectory_aggregator.cjs');

const T = (sessionId, mtime, extra = {}) => ({
  sessionId, path: `/data/${sessionId}.jsonl`, size: 100, mtime,
  messages: 3, firstUserSummary: 'q', oversize: false, ...extra,
});

// 2026-08-19 UTC 整天边界
const DAY_START = Date.parse('2026-08-19T00:00:00Z');
const DAY_END = Date.parse('2026-08-20T00:00:00Z');

const twoMachines = () => ([
  {
    machine: { id: 'mc1', name: 'A' }, online: true,
    payload: {
      trajectories: [T('s1', DAY_START), T('s2', DAY_START + 3600_000)],
      skipped: 1,
    },
  },
  {
    machine: { id: 'mc2', name: 'B' }, online: true,
    payload: { trajectories: [T('s3', DAY_END + 1000)], skipped: 0 },
  },
]);

test('验收5:两机聚合 → 2 个机器维度、total=两机之和、每条 machine 归属正确', () => {
  const merged = mergeTrajectories(twoMachines());
  assert.equal(merged.machines.length, 2);
  assert.equal(merged.total, 3);
  assert.deepEqual(merged.machines.map((m) => m.trajectories.map((t) => t.machine)),
    [['mc1', 'mc1'], ['mc2']]);
  assert.equal(merged.machines[0].skipped, 1, 'skipped 透传');
  assert.equal(merged.machines[0].count, 2);
});

test('离线机/缺 payload/畸形条目 → 不贡献轨迹,机器维度保留', () => {
  const merged = mergeTrajectories([
    { machine: { id: 'mc1', name: 'A' }, online: false },
    { machine: { id: 'mc2', name: 'B' }, online: true, payload: null },
    { machine: { id: 'mc3', name: 'C' }, online: true, payload: { trajectories: [null, 'x', T('ok', 1)] } },
  ]);
  assert.equal(merged.total, 1);
  assert.equal(merged.machines.length, 3);
  assert.equal(merged.machines[0].online, false);
  assert.equal(merged.machines[0].trajectories.length, 0);
  assert.equal(merged.machines[2].trajectories.length, 1);
});

test('验收7:按机器过滤 → 仅该机组保留,其它机组剔除', () => {
  const q = queryTrajectories(mergeTrajectories(twoMachines()), { machine: 'mc2' });
  assert.equal(q.machines.length, 1);
  assert.equal(q.machines[0].id, 'mc2');
  assert.equal(q.total, 1);
  assert.deepEqual(q.filters, { machine: 'mc2', date: null });
});

test('验收7:按日期过滤 → UTC 日闭开区间(含起点、不含次日起点)', () => {
  const q = queryTrajectories(mergeTrajectories(twoMachines()), { date: '2026-08-19' });
  // mc1 两条(s1 恰在 00:00:00.000Z 起点 → 含)计入;mc2 的 s3 在次日之后 → 不计
  assert.equal(q.total, 2);
  assert.ok(q.machines.some((m) => m.id === 'mc1' && m.count === 2));
  assert.ok(q.machines.some((m) => m.id === 'mc2' && m.count === 0), 'mc2 组保留但清空');
});

test('日期边界:次日 00:00:00.000Z 恰好归属次日(不含于前一日)', () => {
  const merged = mergeTrajectories([
    { machine: { id: 'mc1', name: 'A' }, online: true, payload: { trajectories: [
      T('at-end-excl', DAY_END),        // 次日起点 → 不属于 08-19
      T('at-end-minus1', DAY_END - 1),  // 前一日最后一 ms → 属于 08-19
    ] } },
  ]);
  const q = queryTrajectories(merged, { date: '2026-08-19' });
  assert.equal(q.total, 1);
  assert.equal(q.machines[0].trajectories[0].sessionId, 'at-end-minus1');
  const nextDay = queryTrajectories(merged, { date: '2026-08-20' });
  assert.equal(nextDay.total, 1);
  assert.equal(nextDay.machines[0].trajectories[0].sessionId, 'at-end-excl');
});

test('机器 + 日期组合过滤', () => {
  const q = queryTrajectories(mergeTrajectories(twoMachines()), { machine: 'mc1', date: '2026-08-19' });
  assert.equal(q.total, 2);
  const none = queryTrajectories(mergeTrajectories(twoMachines()), { machine: 'mc1', date: '2026-08-21' });
  assert.equal(none.total, 0);
});

test('非法 date → throw InvalidTrajectoryDateError(格式错/不可解析)', () => {
  assert.throws(() => parseDateFilter('2026-8-19'), InvalidTrajectoryDateError);
  assert.throws(() => parseDateFilter('not-a-date'), InvalidTrajectoryDateError);
  assert.throws(() => queryTrajectories(mergeTrajectories([]), { date: '2026-13-99' }), (e) => e.code === 'INVALID_TRAJECTORY_DATE');
  assert.equal(parseDateFilter(''), null);
  assert.equal(parseDateFilter(undefined), null);
  assert.equal(parseDateFilter('2026-08-19'), DAY_START);
});

test('机器过滤不存在的 id → 空(不报错)', () => {
  const q = queryTrajectories(mergeTrajectories(twoMachines()), { machine: 'nobody' });
  assert.equal(q.machines.length, 0);
  assert.equal(q.total, 0);
});

// —— TrajectoryAggregator 轮询器(DI fetchOne + fake registry,同 audit-aggregator 测试范式)——
function fakeRegistry(machines) {
  const state = new Map(machines.map((m) => [m.id, { ...m, online: false, lastError: null }]));
  return {
    all() { return Array.from(state.values()).map(({ token, ...rest }) => rest); },
    getSecret(id) { const m = state.get(id); return m ? { id: m.id, name: m.name, url: m.url, token: m.token } : undefined; },
  };
}

test('TrajectoryAggregator _tick:fetchOne(secret) 收 token,合并到 getLatest', async () => {
  const seen = [];
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new TrajectoryAggregator({
    registry: reg,
    intervalMs: 999999,
    fetchOne: async (secret) => {
      seen.push({ id: secret.id, token: secret.token });
      return { ok: true, payload: { trajectories: [T('x', 5)], skipped: 2 } };
    },
  });
  await agg._tick();
  assert.deepEqual(seen, [{ id: 'mc1', token: 't1' }]);
  const latest = agg.getLatest();
  assert.equal(latest.total, 1);
  assert.equal(latest.machines[0].trajectories[0].machine, 'mc1');
  assert.equal(latest.machines[0].skipped, 2);
});

test('TrajectoryAggregator:fetchOne 抛错/失败 → 该机 online:false 空清单,不拖垮其它机', async () => {
  const reg = fakeRegistry([
    { id: 'mc1', name: 'A', url: 'http://1', token: 't1' },
    { id: 'mc2', name: 'B', url: 'http://2', token: 't2' },
  ]);
  const agg = new TrajectoryAggregator({
    registry: reg,
    intervalMs: 999999,
    fetchOne: async (secret) => {
      if (secret.id === 'mc1') throw new Error('boom');
      return { ok: false, error: '404' }; // 旧版单机无端点
    },
  });
  await agg._tick();
  const latest = agg.getLatest();
  assert.equal(latest.total, 0);
  assert.equal(latest.machines.length, 2);
  assert.ok(latest.machines.every((m) => m.trajectories.length === 0));
});

test('TrajectoryAggregator:start/stop 幂等不抛', () => {
  const reg = fakeRegistry([]);
  const agg = new TrajectoryAggregator({ registry: reg, intervalMs: 10, fetchOne: async () => ({ ok: true, payload: { trajectories: [] } }) });
  agg.start();
  agg.start();
  agg.stop();
  agg.stop();
  assert.equal(agg.getLatest().total, 0);
});
