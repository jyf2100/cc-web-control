'use strict';
// 单元:hub/agent_lifecycle.cjs —— 6 状态机 + 迁移映射(AC1/AC7/AC8 的纯函数基础)。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STATES, TRANSITIONS,
  isValidState, isValidEvent, canTransition, applyTransition,
} = require('../hub/agent_lifecycle.cjs');

test('STATES 恰为 6 个 WorkBuddy Lite 范式状态', () => {
  assert.deepEqual([...STATES], [
    'queued', 'planning', 'running', 'pending_approval', 'completed', 'failed',
  ]);
});

// AC1:合法/非法状态识别(纯函数,同步,远快于 100ms)。
test('AC1: isValidState 合法状态识别', () => {
  for (const s of STATES) assert.equal(isValidState(s), true, `${s} 应合法`);
  assert.equal(isValidState('foo'), false);
  assert.equal(isValidState(''), false);
  assert.equal(isValidState(null), false);
  assert.equal(isValidState(undefined), false);
  assert.equal(isValidState(123), false);
  assert.equal(isValidState('QUEUED'), false); // 大小写敏感
});

test('isValidEvent 覆盖 PRD 9 类迁移事件', () => {
  const expected = ['enqueue', 'start_plan', 'plan_done', 'request_approval', 'approve', 'deny', 'complete', 'fail', 'retry'];
  for (const e of expected) assert.equal(isValidEvent(e), true, `${e} 应合法`);
  assert.equal(isValidEvent('bogus'), false);
});

// AC7:failed + retry → queued。
test('AC7: applyTransition failed --retry--> queued', () => {
  const r = applyTransition('failed', 'retry');
  assert.equal(r.ok, true);
  assert.equal(r.to, 'queued');
});

// AC8:completed + start_plan → 非法(start_plan.from=[queued],不含 completed)。
test('AC8: applyTransition completed --start_plan--> 拒绝', () => {
  const r = applyTransition('completed', 'start_plan');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'illegal transition');
  assert.match(r.error, /illegal transition/);
});

test('applyTransition 未知事件 → invalid event', () => {
  const r = applyTransition('queued', 'bogus');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid event');
});

// 终态语义:completed 不可经任何事件迁出;failed 仅可经 retry 回 queued。
test('completed 为终态:所有非 enqueue 事件均不可从 completed 迁出', () => {
  for (const ev of Object.keys(TRANSITIONS)) {
    const r = applyTransition('completed', ev);
    assert.equal(r.ok, false, `${ev} 不应能从 completed 迁出`);
  }
});

test('failed 仅 retry 可迁出,其余事件均拒绝', () => {
  for (const ev of Object.keys(TRANSITIONS)) {
    const r = applyTransition('failed', ev);
    if (ev === 'retry') {
      assert.equal(r.ok, true);
      assert.equal(r.to, 'queued');
    } else {
      assert.equal(r.ok, false, `${ev} 不应能从 failed 迁出`);
    }
  }
});

// 迁移映射逐条钉死(防回归):覆盖 PRD 的 from→to 全集。
test('迁移映射 from→to 与 PRD 一致', () => {
  assert.equal(TRANSITIONS.enqueue.to, 'queued');
  assert.equal(TRANSITIONS.start_plan.to, 'planning');
  assert.equal(TRANSITIONS.plan_done.to, 'running');
  assert.equal(TRANSITIONS.request_approval.to, 'pending_approval');
  assert.equal(TRANSITIONS.approve.to, 'running');
  assert.equal(TRANSITIONS.deny.to, 'failed');
  assert.equal(TRANSITIONS.complete.to, 'completed');
  assert.equal(TRANSITIONS.fail.to, 'failed');
  assert.equal(TRANSITIONS.retry.to, 'queued');
});

// canTransition:enqueue 仅在「无前置状态」(新建)时合法。
test('canTransition: enqueue 仅当 fromState==null 合法', () => {
  assert.equal(canTransition(null, 'enqueue'), true);
  assert.equal(canTransition(undefined, 'enqueue'), true);
  assert.equal(canTransition('queued', 'enqueue'), false); // 已存在的 agent 不能再 enqueue
});

// 典型正向链路:queued → planning → running → pending_approval → (approve) → running → completed。
test('典型正向链路可逐步迁移', () => {
  let s = applyTransition(null, 'enqueue').to;       // queued
  assert.equal(s, 'queued');
  s = applyTransition(s, 'start_plan').to;           // planning
  assert.equal(s, 'planning');
  s = applyTransition(s, 'plan_done').to;            // running
  assert.equal(s, 'running');
  s = applyTransition(s, 'request_approval').to;     // pending_approval
  assert.equal(s, 'pending_approval');
  s = applyTransition(s, 'approve').to;              // running
  assert.equal(s, 'running');
  s = applyTransition(s, 'complete').to;             // completed
  assert.equal(s, 'completed');
});

// applyTransition 不改入参(纯函数)。
test('applyTransition 无副作用:不改入参状态字符串', () => {
  const before = 'queued';
  applyTransition(before, 'start_plan');
  assert.equal(before, 'queued');
});

// AC1 100ms 时效:批量校验远快于 100ms。
test('AC1 时效:1000 次 isValidState 远快于 100ms', () => {
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) isValidState(i % 2 ? 'queued' : 'foo');
  const dt = Date.now() - t0;
  assert.ok(dt < 100, `isValidState 1000 次耗时 ${dt}ms 应 < 100ms`);
});
