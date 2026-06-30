const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../public/dashboard_render.cjs');

test('sortSessions waiting 排前', () => {
  assert.equal(R.sortSessions([{status:'idle'},{status:'waiting'}])[0].status, 'waiting');
});
test('sortSessions 同权重按 lastTs 倒序', () => {
  const s = R.sortSessions([{status:'working',lastTs:100},{status:'working',lastTs:200}]);
  assert.equal(s[0].lastTs, 200);
});
test('sortSessions 不修改入参', () => {
  const arr = [{status:'idle'}]; const sorted = R.sortSessions(arr);
  assert.equal(arr[0].status, 'idle'); assert.notEqual(arr, sorted);
});
test('renderSession 双编码 s-dot + s-status', () => {
  const html = R.renderSession({name:'x',status:'waiting'}, 0);
  assert.match(html, /class="s-dot s-dot--waiting"/);
  assert.match(html, /<span class="s-status">等待<\/span>/);
});
test('renderSession waiting 加 .waiting 高亮类', () => {
  assert.match(R.renderSession({name:'x',status:'waiting'},0), /class="session waiting"/);
});
test('renderSession 非 waiting 无 .waiting', () => {
  assert.doesNotMatch(R.renderSession({name:'x',status:'idle'},0), /waiting/);
});
test('renderSession unknown 虚线点 + 兜底标签', () => {
  const html = R.renderSession({name:'x',status:'bogus'},0);
  assert.match(html, /s-dot--unknown/); assert.match(html, />未知</);
});
test('renderSession s-id 1-based 补零', () => {
  assert.match(R.renderSession({},0), /s:01/);
  assert.match(R.renderSession({},9), /s:10/);
});
test('renderSession meta 合并 cwd + lastLine', () => {
  assert.match(R.renderSession({name:'x',status:'idle',cwd:'/a/b',lastLine:'继续吗?'},0), /~\/b · 继续吗\?/);
});
test('renderSession 无 lastLine 回退 relativeTime', () => {
  assert.match(R.renderSession({name:'x',status:'idle',lastTs:Date.now()-30000},0), /30s 前/);
});
test('renderSession name 在 data-session + aria-label 转义(XSS)', () => {
  const html = R.renderSession({name:'<x>',status:'idle'},0);
  assert.match(html, /data-session="&lt;x&gt;"/);
  assert.doesNotMatch(html, /data-session="<x>"/);
});
test('countWaiting 只数 waiting+errored', () => {
  assert.equal(R.countWaiting([{status:'waiting'},{status:'errored'},{status:'working'}]), 2);
});
test('renderState eyebrow + serif lede', () => {
  const html = R.renderState('ready','hi');
  assert.match(html, /class="eyebrow"/); assert.match(html, /\[ready\]/);
  assert.match(html, /class="lede">hi</);
});
test('escapeHtml 中和注入', () => {
  assert.equal(R.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(R.escapeHtml('a"b'), 'a&quot;b');
});
