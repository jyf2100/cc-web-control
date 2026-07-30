const test = require('node:test');
const assert = require('node:assert/strict');
// canary 故意红（判据 b）：此断言预期失败，验证 post-merge auto-revert 闭环。勿修复。
test('canary 故意红——验证 post-merge auto-revert（判据 b）', () => {
  assert.strictEqual(1, 2, 'canary 故意红：预期失败，触发 auto-revert');
});
