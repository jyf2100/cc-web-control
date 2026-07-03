const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/console_render.cjs');

test('escapeHtml 中和注入字符', () => {
  assert.equal(R.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(R.escapeHtml('a"b'), 'a&quot;b');
  assert.equal(R.escapeHtml('a&b'), 'a&amp;b');
});
test('escapeHtml null/undefined 兜底空串', () => {
  assert.equal(R.escapeHtml(null), '');
  assert.equal(R.escapeHtml(undefined), '');
});

test('statusMeta 已知状态返回 dot+icon+label', () => {
  const m = R.statusMeta('errored');
  assert.equal(m.dot, 's-dot--errored');
  assert.equal(m.icon, '✕');
  assert.equal(m.label, 'errored');
});
test('statusMeta 未知状态回退 unknown', () => {
  const m = R.statusMeta('bogus');
  assert.equal(m.dot, 's-dot--unknown');
  assert.equal(m.icon, '?');
  assert.equal(m.label, 'unknown');
});
