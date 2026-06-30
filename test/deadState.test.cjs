const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDeadState, DEAD_HINT } = require('../public/deadState.cjs');

test('detectDeadState: 有 claude 历史绑定 → 提示(shouldHint true)', () => {
  const out = detectDeadState({ name: 'claude-foo', claudeSessionId: 'abc-123' });
  assert.equal(out.shouldHint, true);
  assert.equal(out.hint, DEAD_HINT);
});

test('detectDeadState: 无 claude 历史绑定(首次进入)→ 不提示', () => {
  const out = detectDeadState({ name: 'claude-foo', claudeSessionId: undefined });
  assert.equal(out.shouldHint, false);
  assert.equal(out.hint, '');
});

test('detectDeadState: 输入非法 → 安全降级不提示', () => {
  const out = detectDeadState(null);
  assert.equal(out.shouldHint, false);
  assert.equal(out.hint, '');
});

test('detectDeadState: claudeSessionId 为空字符串 → 不提示(假值等同无绑定)', () => {
  const out = detectDeadState({ name: 'claude-foo', claudeSessionId: '' });
  assert.equal(out.shouldHint, false);
  assert.equal(out.hint, '');
});

test('detectDeadState: 数组输入 → 安全降级不提示', () => {
  const out = detectDeadState([{ name: 'x', claudeSessionId: 'abc' }]);
  assert.equal(out.shouldHint, false);
  assert.equal(out.hint, '');
});
