const test = require('node:test');
const assert = require('node:assert/strict');

test('canary: 绿 smoke——验证 auto-merge 正常闭环（判据 a）', () => {
  assert.ok(true, 'canary 绿 smoke：trivial passing，确保 dev loop + post-merge 都绿');
});
