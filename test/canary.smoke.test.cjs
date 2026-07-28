'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Canary smoke 测试:验证 dev-agent 在 cc-web-control dev loop 中
// 执行测试命令(node --test)的通道正常,不再出现 AbortError: Stream closed。
// 这是 #1105 根治(H3-patch)后的端到端 canary 探针,断言刻意保持 trivial。

test('canary: trivial 断言通过', () => {
  assert.ok(true);
});

test('canary: 基本算术与相等断言', () => {
  assert.equal(1 + 1, 2);
  assert.deepEqual([1, 2, 3].length, 3);
});

test('canary: node:test 上下文可用', (t) => {
  assert.ok(t, 'test context (t) 应为可用对象');
});
