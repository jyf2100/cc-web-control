'use strict';
// 单元:hub/agent_state_store.cjs —— AC1/AC2/AC3/AC4/AC7/AC8。
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentStateStore } = require('../hub/agent_state_store.cjs');

// 收集日志的 fake logger(AC1:断言含「invalid state」字样)。
function captureLog() {
  const errors = [];
  return { errors, log: { error: (m) => errors.push(String(m)), warn() {}, info() {}, debug() {} } };
}

function makeStore({ now } = {}) {
  let t = typeof now === 'number' ? now : 0;
  const logger = captureLog();
  const store = new AgentStateStore({ nowFn: () => t, log: logger.log });
  return { store, logger, tick: (ms) => { t += ms; } };
}

// AC1:合法状态 queued 可加载;非法状态 foo → 拒绝 + 含「invalid state」日志。
test('AC1: 合法状态加载,非法状态拒绝并输出 invalid state 日志', () => {
  const { store, logger } = makeStore();

  const ok = store.register({ agent_id: 'a1', machine: 'm1', state: 'queued' });
  assert.equal(ok.ok, true);
  assert.equal(ok.agent.state, 'queued');

  const bad = store.register({ agent_id: 'a2', machine: 'm1', state: 'foo' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'invalid state');
  assert.ok(logger.errors.some((e) => e.includes('invalid state')), '应输出含 invalid state 的错误日志');
  // 拒绝加载:agent 不在 store
  assert.equal(store.get('a2'), undefined);
  assert.equal(store.all().length, 1); // 仅 a1
});

// AC2:6 台单机各 1 个 agent,分别覆盖 6 状态 → groupByState 恰好 6 组各 1。
test('AC2: 6 机各 1 agent 覆盖 6 状态 → 看板 6 组各计数 1', () => {
  const { store } = makeStore();
  const states = ['queued', 'planning', 'running', 'pending_approval', 'completed', 'failed'];
  states.forEach((st, i) => {
    store.register({ agent_id: `a${i}`, machine: `m${i}`, state: st });
  });
  const g = store.groupByState();
  assert.equal(g.total, 6);
  for (const st of states) {
    assert.equal(g.groups[st], 1, `${st} 组计数应为 1`);
  }
  // groups 恒含全部 6 键
  assert.deepEqual(Object.keys(g.groups).sort(), [...states].sort());
});

// AC3:迁移可观测 + 事件日志字段(timestamp/agent_id/from/to/trigger),timestamp ms 精度。
test('AC3: queued→running 迁移记事件,字段齐全 + ms 精度', () => {
  const { store, tick } = makeStore({ now: 1000 });
  store.register({ agent_id: 'a1', machine: 'm1', state: 'queued' });
  tick(500); // now=1500
  const r = store.transition('a1', 'start_plan'); // queued→planning
  assert.equal(r.ok, true);
  tick(500); // now=2000
  const r2 = store.transition('a1', 'plan_done'); // planning→running
  assert.equal(r2.ok, true);
  assert.equal(store.get('a1').state, 'running');

  const events = store.getEventLog();
  assert.equal(events.length, 2);
  const last = events[events.length - 1];
  // 字段完备(AC3)
  assert.equal(typeof last.timestamp, 'number');
  assert.equal(last.agent_id, 'a1');
  assert.equal(last.from, 'planning');
  assert.equal(last.to, 'running');
  assert.equal(last.trigger, 'plan_done'); // trigger 默认取 event 名
  // ms 精度:timestamp 恰为注入时钟值(整数 ms)
  assert.equal(last.timestamp, 2000);
});

// AC3 补:trigger 可显式覆盖(如命令来源标记)。
test('AC3: trigger 可显式覆盖事件名', () => {
  const { store } = makeStore();
  store.register({ agent_id: 'a1', machine: 'm1', state: 'queued' });
  store.transition('a1', 'start_plan', 'operator:plan');
  const last = store.getEventLog().slice(-1)[0];
  assert.equal(last.trigger, 'operator:plan');
});

// AC4:3 台单机各 2 个不同状态 agent(共 6)→ 按 agent_id 区分,不合并。
test('AC4: 3 机各 2 agent → 6 个独立 agent 按 agent_id 区分,不合并', () => {
  const { store } = makeStore();
  // m1: queued + running ;m2: planning + failed ;m3: pending_approval + completed
  store.register({ agent_id: 'm1-a', machine: 'm1', state: 'queued' });
  store.register({ agent_id: 'm1-b', machine: 'm1', state: 'running' });
  store.register({ agent_id: 'm2-a', machine: 'm2', state: 'planning' });
  store.register({ agent_id: 'm2-b', machine: 'm2', state: 'failed' });
  store.register({ agent_id: 'm3-a', machine: 'm3', state: 'pending_approval' });
  store.register({ agent_id: 'm3-b', machine: 'm3', state: 'completed' });

  const g = store.groupByState();
  assert.equal(g.total, 6);
  // 每状态恰好 1 个(6 agent 分布在 6 不同状态)
  for (const st of ['queued', 'planning', 'running', 'pending_approval', 'completed', 'failed']) {
    assert.equal(g.groups[st], 1, `${st} 应 1 个`);
  }
  // 同机两 agent 状态不同也不合并:byState 列表中 agent_id 各异
  const allIds = store.all().map((a) => a.agent_id).sort();
  assert.deepEqual(allIds, ['m1-a', 'm1-b', 'm2-a', 'm2-b', 'm3-a', 'm3-b']);
  // 同机两 agent 机器标签一致
  assert.equal(store.get('m1-a').machine, 'm1');
  assert.equal(store.get('m1-b').machine, 'm1');
});

// AC4 补:聚合计数合法(两种来源均合法)——1 机 2 running + 1 机 0 → running 组 = 2。
test('AC4: running 组计数=2 可来自单机多 agent', () => {
  const { store } = makeStore();
  store.register({ agent_id: 'x1', machine: 'm1', state: 'running' });
  store.register({ agent_id: 'x2', machine: 'm1', state: 'running' });
  store.register({ agent_id: 'y1', machine: 'm2', state: 'queued' });
  const g = store.groupByState();
  assert.equal(g.groups.running, 2);
  assert.equal(g.groups.queued, 1);
});

// AC7:failed agent 接收 retry → ≤1s(同步)迁回 queued + 事件日志引用原 agent_id。
test('AC7: failed --retry--> queued 即时迁移 + 事件引用原 agent_id', () => {
  const { store } = makeStore({ now: 5000 });
  store.register({ agent_id: 'a9', machine: 'm1', state: 'failed' });
  const t0 = Date.now();
  const r = store.transition('a9', 'retry');
  const dt = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.equal(r.to, 'queued');
  assert.equal(store.get('a9').state, 'queued');
  assert.ok(dt < 1000, `retry 迁移耗时 ${dt}ms 应 < 1s(内存同步)`);

  // 事件日志新增 retry 记录,引用原 failed agent_id
  const retryEvents = store.getEventLog().filter((e) => e.trigger === 'retry');
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].agent_id, 'a9');
  assert.equal(retryEvents[0].from, 'failed');
  assert.equal(retryEvents[0].to, 'queued');
});

// AC8:completed agent 接收 start_plan(非法)→ 拒绝 + 保留原状态。
test('AC8: completed --start_plan--> 拒绝,保留 completed', () => {
  const { store, logger } = makeStore();
  store.register({ agent_id: 'a8', machine: 'm1', state: 'completed' });
  const before = store.getEventLog().length;
  const r = store.transition('a8', 'start_plan');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'illegal transition');
  // 保留原状态
  assert.equal(store.get('a8').state, 'completed');
  // 非法迁移不产生新事件
  assert.equal(store.getEventLog().length, before);
  assert.ok(logger.errors.some((e) => /illegal transition/.test(e)));
});

// ingestReport(单机上报告):检测状态变化记 'report' 事件(AC3 迁移可观测的另一来源)。
test('ingestReport: 同 agent 状态变化 → 记 report 迁移事件', () => {
  const { store } = makeStore({ now: 100 });
  // 第一轮上报:queued
  store.ingestReport('m1', [{ agent_id: 'a1', state: 'queued' }]);
  assert.equal(store.get('a1').state, 'queued');
  assert.equal(store.getEventLog().length, 0); // 首次上报无变化,不记事件
  // 第二轮上报:running(变化)→ 记 report 事件
  store.ingestReport('m1', [{ agent_id: 'a1', state: 'running' }]);
  const ev = store.getEventLog().slice(-1)[0];
  assert.equal(ev.from, 'queued');
  assert.equal(ev.to, 'running');
  assert.equal(ev.trigger, 'report');
  assert.equal(ev.machine, 'm1');
});

// ingestReport:跳过非法状态(AC1 在批量上报路径同样生效)。
test('ingestReport: 跳过非法状态,不影响同批合法 agent', () => {
  const { store } = makeStore();
  const results = store.ingestReport('m1', [
    { agent_id: 'good', state: 'queued' },
    { agent_id: 'bad', state: 'nope' },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(store.get('good').state, 'queued');
  assert.equal(store.get('bad'), undefined);
});

// messageCount 由单机上报(hub 看板显示对话条数,AC5 联动)。
test('register/ingestReport 携带 messageCount,可读出', () => {
  const { store } = makeStore();
  store.register({ agent_id: 'a1', machine: 'm1', state: 'queued', messageCount: 7 });
  assert.equal(store.get('a1').messageCount, 7);
  store.ingestReport('m1', [{ agent_id: 'a1', state: 'running', messageCount: 9 }]);
  assert.equal(store.get('a1').messageCount, 9);
});

// immutability:get/all/groupByState/getEventLog 返回拷贝,改不影响内部。
test('immutability: 对外返回为拷贝,突变不污染 store', () => {
  const { store } = makeStore();
  store.register({ agent_id: 'a1', machine: 'm1', state: 'queued' });
  const a = store.get('a1');
  a.state = 'completed';
  assert.equal(store.get('a1').state, 'queued', 'get 返回拷贝,内部未变');
  const ev0 = store.getEventLog();
  store.transition('a1', 'start_plan');
  ev0.push({ fake: true });
  assert.equal(store.getEventLog().length, 1, 'getEventLog 返回拷贝');
});
