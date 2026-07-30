const test = require('node:test');
const assert = require('node:assert/strict');

// canary: 绿 smoke——验证 auto-merge 正常闭环(single-flight-auto-merge §8.1 判据 a)。
// trivial 必过断言,确保 dev loop + post-merge main 全量测试都绿。
test('canary: 绿 smoke——验证 auto-merge 正常闭环(判据 a)', () => {
  assert.ok(true, 'canary 绿 smoke:trivial passing,确保 dev loop + post-merge 都绿');
});
