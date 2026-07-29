'use strict';
// session_status.cjs 纯函数单测:规范会话状态枚举 + 归一 + changedAt 跟踪 + 非法枚举。
// 对应 PRD 验收:#1(枚举完备,绝不 null)、#2(状态可被行为触发→归一正确)、#5(结构化字段)。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_STATES,
  isValidState,
  normalizeState,
  StateTracker,
  InvalidStatusError,
} = require('../session_status.cjs');

test('SESSION_STATES 恰为 PRD 四态(idle/running/awaiting-input/error)', () => {
  assert.deepEqual([...SESSION_STATES], ['idle', 'running', 'awaiting-input', 'error']);
  assert.equal(Object.isFrozen(SESSION_STATES), true);
});

test('isValidState:四态 true,其余 false', () => {
  for (const s of SESSION_STATES) assert.equal(isValidState(s), true);
  assert.equal(isValidState('unknown'), false);
  assert.equal(isValidState('working'), false);
  assert.equal(isValidState(''), false);
  assert.equal(isValidState(null), false);
  assert.equal(isValidState(undefined), false);
  assert.equal(isValidState(123), false);
});

// AC2:每种 jsonl 推断行为 → 对应规范状态
test('normalizeState:jsonl 推断 → 规范枚举(AC2 行为映射)', () => {
  assert.equal(normalizeState('working'), 'running');       // 正在生成/执行
  assert.equal(normalizeState('waiting'), 'awaiting-input'); // end_turn 等待输入
  assert.equal(normalizeState('errored'), 'error');          // 出错
  assert.equal(normalizeState('idle'), 'idle');              // 空闲
  assert.equal(normalizeState('unknown'), 'idle');           // 无事件 → 空闲(非异常)
});

// AC1:归一结果恒属四态之一,绝不 null/undefined
test('normalizeState:任意输入(含 null/undefined/垃圾)恒返回四态之一(AC1)', () => {
  const cases = [null, undefined, '', 'bogus', {}, [], 42, 'WAITING', 'offline'];
  for (const c of cases) {
    const r = normalizeState(c);
    assert.ok(SESSION_STATES.includes(r), `normalizeState(${JSON.stringify(c)}) = ${r} 不在枚举内`);
  }
});

test('normalizeState:已是规范状态 → 直通', () => {
  for (const s of SESSION_STATES) assert.equal(normalizeState(s), s);
});

// StateTracker:changedAt 时序
test('StateTracker.observe:首次观察 → changedAt = now, state 归一', () => {
  let t = 1000;
  const tr = new StateTracker({ nowFn: () => t });
  const r = tr.observe('s1', 'working');
  assert.equal(r.state, 'running');
  assert.equal(r.changedAt, 1000);
});

test('StateTracker.observe:状态不变 → changedAt 沿用(AC5 最近变更时间)', () => {
  let t = 1000;
  const tr = new StateTracker({ nowFn: () => t });
  tr.observe('s1', 'working');          // changedAt=1000
  t = 5000;
  const r = tr.observe('s1', 'working'); // 仍 working → running,状态未变
  assert.equal(r.state, 'running');
  assert.equal(r.changedAt, 1000, '状态未变,changedAt 应沿用 1000');
});

test('StateTracker.observe:状态变化 → changedAt 刷新为当前 now', () => {
  let t = 1000;
  const tr = new StateTracker({ nowFn: () => t });
  tr.observe('s1', 'working');   // running @1000
  t = 3000;
  tr.observe('s1', 'idle');      // idle @3000
  t = 4000;
  const r = tr.observe('s1', 'idle'); // idle 不变
  assert.equal(r.state, 'idle');
  assert.equal(r.changedAt, 3000, '上次变化在 3000');
});

test('StateTracker.observe:支持显式 nowMs 覆盖(对齐刷新周期时钟)', () => {
  const tr = new StateTracker({ nowFn: () => 0 });
  const r = tr.observe('s1', 'errored', 7777);
  assert.equal(r.state, 'error');
  assert.equal(r.changedAt, 7777);
});

test('StateTracker.observe:多 key 各自独立 changedAt', () => {
  let t = 100;
  const tr = new StateTracker({ nowFn: () => t });
  tr.observe('a', 'working'); // running @100
  t = 200;
  tr.observe('b', 'waiting'); // awaiting-input @200
  assert.equal(tr.get('a').changedAt, 100);
  assert.equal(tr.get('b').changedAt, 200);
  assert.equal(tr.get('a').state, 'running');
  assert.equal(tr.get('b').state, 'awaiting-input');
});

test('StateTracker.retain:清理消失 key,保留存活 key 的 changedAt', () => {
  let t = 1000;
  const tr = new StateTracker({ nowFn: () => t });
  tr.observe('a', 'working');
  t = 2000;
  tr.observe('b', 'idle');
  tr.retain(['a']); // b 消失
  assert.equal(tr.get('a').changedAt, 1000);
  assert.equal(tr.get('b'), undefined);
});

test('StateTracker.get:未知 key → undefined', () => {
  const tr = new StateTracker();
  assert.equal(tr.get('nope'), undefined);
});

test('InvalidStatusError:含 allowed 枚举列表 + code', () => {
  assert.throws(() => { throw new InvalidStatusError('bogus'); }, (e) => {
    assert.ok(e instanceof InvalidStatusError);
    assert.equal(e.code, 'INVALID_STATUS');
    assert.deepEqual(e.allowed, [...SESSION_STATES]);
    assert.ok(/awaiting-input/.test(e.message));
    return true;
  });
});
