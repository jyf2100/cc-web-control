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

test('relativeTime <5s → now', () => {
  assert.equal(R.relativeTime(Date.now() - 3000, Date.now()), 'now');
});
test('relativeTime 秒/分/时档', () => {
  const now = 1000000;
  assert.equal(R.relativeTime(now - 30000, now), '30s 前');
  assert.equal(R.relativeTime(now - 120000, now), '2m 前');
  assert.equal(R.relativeTime(now - 7200000, now), '2h 前');
});
test('relativeTime 无 ts 空串', () => {
  assert.equal(R.relativeTime(0, Date.now()), '');
  assert.equal(R.relativeTime(null, Date.now()), '');
});

test('buildCardHTML 含 s-dot 变体 + 图标 + aria-label', () => {
  const html = R.buildCardHTML(
    { id: 'm1', name: 'machine-a', online: true },
    { name: 'ses-1', status: 'working', lastLine: 'building…' },
    { active: true, selected: false, now: 1000000, lastTs: 980000 }
  );
  assert.match(html, /class="[^"]*card[^"]* active"/);
  assert.match(html, /class="s-dot s-dot--working"/);
  assert.match(html, /<span class="s-icon" aria-hidden="true">▶<\/span>/);
  assert.match(html, /aria-label="machine-a \/ ses-1,working,/);
  assert.match(html, /data-machine="m1"/);
  assert.match(html, /data-session="ses-1"/);
});
test('buildCardHTML selected 加 card--selected', () => {
  const html = R.buildCardHTML({ id: 'm1', name: 'a', online: true }, { name: 's', status: 'idle' }, { selected: true });
  assert.match(html, /class="[^"]*card--selected/);
  assert.match(html, /aria-checked="true"/);
});
test('buildCardHTML 离线机器 lastLine 回退 (离线)', () => {
  const html = R.buildCardHTML({ id: 'm2', name: 'b', online: false }, { name: 's', status: 'idle', lastLine: '' });
  assert.match(html, /\(离线\)/);
});
test('buildCardHTML XSS: name 转义', () => {
  const html = R.buildCardHTML({ id: '<x>', name: '<x>', online: true }, { name: '<s>', status: 'idle' });
  assert.doesNotMatch(html, /data-machine="<x>"/);
  assert.match(html, /data-machine="&lt;x&gt;"/);
});
