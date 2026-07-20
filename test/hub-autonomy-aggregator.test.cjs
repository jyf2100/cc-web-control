const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AutonomyAggregator, computeDeltas, summarizeMachineAutonomy, summarizeResults,
} = require('../hub/autonomy_aggregator.cjs');
const { AutonomyStore } = require('../hub/autonomy_store.cjs');

const NOW = 1_700_000_000_000;

// —— summarizeMachineAutonomy ——

test('summarizeMachineAutonomy: 多会话求和,兼容 intervention/interventions', () => {
  const sum = summarizeMachineAutonomy({
    sessions: [
      { autonomy: { commit: 2, rollback: 1, intervention: 3 } },
      { autonomy: { commit: 1, rollback: 0, interventions: 2 } }, // 复数键
      { autonomy: { commit: 5 } }, // 部分字段
    ],
  });
  assert.deepEqual(sum, { commit: 8, rollback: 1, intervention: 5 });
});

test('summarizeMachineAutonomy: 无 sessions / 无 autonomy → null', () => {
  assert.equal(summarizeMachineAutonomy({ sessions: [] }), null);
  assert.equal(summarizeMachineAutonomy({ sessions: [{ name: 's', status: 'idle' }] }), null);
  assert.equal(summarizeMachineAutonomy(null), null);
});

// —— summarizeResults ——

test('summarizeResults: 仅 online 且有 autonomy 的机器纳入', () => {
  const sums = summarizeResults([
    { machine: { id: 'm1', name: 'A' }, online: true, payload: { sessions: [{ autonomy: { commit: 1, rollback: 0, intervention: 0 } }] } },
    { machine: { id: 'm2', name: 'B' }, online: true, payload: { sessions: [{ status: 'idle' }] } }, // 无 autonomy → 跳过
    { machine: { id: 'm3', name: 'C' }, online: false, payload: { sessions: [{ autonomy: { commit: 9 } }] } }, // 离线 → 跳过
  ]);
  assert.deepEqual(Object.keys(sums), ['m1']);
  assert.equal(sums.m1.commit, 1);
});

test('summarizeResults: 非数组 → {}', () => {
  assert.deepEqual(summarizeResults(undefined), {});
});

// —— computeDeltas ——

test('computeDeltas: 正增量落成事件,个数=delta', () => {
  const prev = { m1: { commit: 1, rollback: 0, intervention: 0 } };
  const curr = { m1: { commit: 3, rollback: 2, intervention: 1 } };
  const { events, nextPrev } = computeDeltas(prev, curr, NOW);
  assert.equal(events.length, 5); // 2 commit + 2 rollback + 1 intervention
  assert.equal(events.filter((e) => e.type === 'commit').length, 2);
  assert.equal(events.filter((e) => e.type === 'rollback').length, 2);
  assert.equal(events.filter((e) => e.type === 'intervention').length, 1);
  assert.equal(events[0].ts, NOW);
  assert.equal(events[0].machine, 'm1');
  assert.deepEqual(nextPrev.m1, curr.m1);
});

test('computeDeltas: 新机器首次出现 = 全量增量(prev 视作 0)', () => {
  const { events, nextPrev } = computeDeltas({}, { m1: { commit: 4, rollback: 1, intervention: 2 } }, NOW);
  assert.equal(events.length, 7);
  assert.deepEqual(nextPrev.m1, { commit: 4, rollback: 1, intervention: 2 });
});

test('computeDeltas: 无变化 → 无事件,nextPrev 跟随', () => {
  const prev = { m1: { commit: 2, rollback: 1, intervention: 0 } };
  const r = computeDeltas(prev, { m1: { commit: 2, rollback: 1, intervention: 0 } }, NOW);
  assert.equal(r.events.length, 0);
  assert.deepEqual(r.nextPrev.m1, { commit: 2, rollback: 1, intervention: 0 });
});

test('computeDeltas: 单机重启计数归零(reset)→ 不产负事件,rebase 到 curr', () => {
  const prev = { m1: { commit: 5, rollback: 2, intervention: 1 } };
  const curr = { m1: { commit: 0, rollback: 0, intervention: 0 } };
  const r = computeDeltas(prev, curr, NOW);
  assert.equal(r.events.length, 0); // 绝不产负增量
  assert.deepEqual(r.nextPrev.m1, { commit: 0, rollback: 0, intervention: 0 });
});

test('computeDeltas: 机器从 curr 消失 → nextPrev 保留旧值(防回来重数)', () => {
  const prev = { m1: { commit: 5, rollback: 0, intervention: 0 } };
  const r = computeDeltas(prev, {}, NOW); // curr 不含 m1
  assert.equal(r.events.length, 0);
  assert.deepEqual(r.nextPrev.m1, { commit: 5, rollback: 0, intervention: 0 });
});

test('computeDeltas: reset 后再增长正常计数', () => {
  let prev = { m1: { commit: 5, rollback: 0, intervention: 0 } };
  // 重启归零
  let r = computeDeltas(prev, { m1: { commit: 0, rollback: 0, intervention: 0 } }, NOW);
  prev = r.nextPrev;
  assert.equal(r.events.length, 0);
  // 重新累积到 3
  r = computeDeltas(prev, { m1: { commit: 3, rollback: 0, intervention: 0 } }, NOW);
  assert.equal(r.events.length, 3); // 0→3 正常 +3
});

// —— AutonomyAggregator(类) ——

function newStore() { return new AutonomyStore({ fsImpl: null, now: () => NOW }); }

test('AutonomyAggregator.ingest: 首次全量 + 后续增量 + 落 store', () => {
  const store = newStore();
  const agg = new AutonomyAggregator({ store, now: () => NOW });
  // 首次:m1 commit=2 → 2 个事件
  let ev = agg.ingest({ m1: { commit: 2, rollback: 0, intervention: 1 } }, NOW);
  assert.equal(ev.length, 3);
  assert.equal(store.events().length, 3);
  // 第二次:m1 commit=2→3(+1), intervention 不变 → 1 个事件
  ev = agg.ingest({ m1: { commit: 3, rollback: 0, intervention: 1 } }, NOW);
  assert.equal(ev.length, 1);
  assert.equal(store.events().length, 4);
});

test('AutonomyAggregator.ingest: reset 不产事件,rebase 后正常', () => {
  const store = newStore();
  const agg = new AutonomyAggregator({ store, now: () => NOW });
  agg.ingest({ m1: { commit: 5, rollback: 0, intervention: 0 } }, NOW);
  const ev = agg.ingest({ m1: { commit: 0, rollback: 0, intervention: 0 } }, NOW); // reset
  assert.equal(ev.length, 0);
  // 再增长
  const ev2 = agg.ingest({ m1: { commit: 2, rollback: 0, intervention: 0 } }, NOW);
  assert.equal(ev2.length, 2);
});

test('AutonomyAggregator.ingest: 空 sums 不抛、无事件', () => {
  const store = newStore();
  const agg = new AutonomyAggregator({ store, now: () => NOW });
  assert.equal(agg.ingest({}, NOW).length, 0);
  assert.equal(agg.ingest(undefined, NOW).length, 0);
});

test('AutonomyAggregator: 缺 store 抛错(契约)', () => {
  assert.throws(() => new AutonomyAggregator({}), /requires a store/);
});

// —— 端到端:results → summarizeResults → ingest → store.aggregate ——

test('e2e: results 流入 → aggregate 输出每机三项计数', () => {
  const store = newStore();
  const agg = new AutonomyAggregator({ store, now: () => NOW });
  const results1 = [
    { machine: { id: 'm1', name: 'A' }, online: true, payload: { sessions: [
      { autonomy: { commit: 2, rollback: 0, intervention: 1 } }] } },
    { machine: { id: 'm2', name: 'B' }, online: true, payload: { sessions: [
      { autonomy: { commit: 0, rollback: 1, intervention: 0 } }] } },
  ];
  agg.ingest(summarizeResults(results1), NOW);
  // 下一轮:m1 rollback +1(发生了一次 git rollback)
  const results2 = [
    { machine: { id: 'm1', name: 'A' }, online: true, payload: { sessions: [
      { autonomy: { commit: 2, rollback: 1, intervention: 1 } }] } },
    { machine: { id: 'm2', name: 'B' }, online: true, payload: { sessions: [
      { autonomy: { commit: 0, rollback: 1, intervention: 0 } }] } },
  ];
  agg.ingest(summarizeResults(results2), NOW);
  const a = store.aggregate(3600_000, NOW, [
    { id: 'm1', name: 'A', online: true },
    { id: 'm2', name: 'B', online: true },
  ]);
  const m1 = a.machines.find((x) => x.id === 'm1');
  assert.equal(m1.commit, 2);
  assert.equal(m1.rollback, 1);
  assert.equal(m1.intervention, 1);
  const m2 = a.machines.find((x) => x.id === 'm2');
  assert.equal(m2.rollback, 1);
});
