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

test('sortCardsErroredFirst: errored 永远置顶', () => {
  const cards = [
    { name: 'a', status: 'working' },
    { name: 'b', status: 'errored' },
    { name: 'c', status: 'idle' },
  ];
  assert.equal(R.sortCardsErroredFirst(cards)[0].name, 'b');
});
test('sortCardsErroredFirst: 同级按 name 字典序', () => {
  const cards = [{ name: 'b', status: 'working' }, { name: 'a', status: 'working' }];
  assert.equal(R.sortCardsErroredFirst(cards)[0].name, 'a');
});
test('sortCardsErroredFirst: 不修改入参', () => {
  const cards = [{ name: 'a', status: 'idle' }, { name: 'b', status: 'errored' }];
  const sorted = R.sortCardsErroredFirst(cards);
  assert.equal(cards[0].name, 'a');
  assert.notEqual(sorted, cards);
});
test('sortCardsErroredFirst: 全状态优先级链 errored<working<waiting<idle', () => {
  const cards = [
    { name: 'i', status: 'idle' }, { name: 'w', status: 'working' },
    { name: 'e', status: 'errored' }, { name: 't', status: 'waiting' },
  ];
  const names = R.sortCardsErroredFirst(cards).map((c) => c.name);
  assert.deepEqual(names, ['e', 'w', 't', 'i']);
});

test('summarizeFleet: 计各状态 + online/total', () => {
  const m = [
    { id: 'a', online: true, sessions: [{ status: 'working' }, { status: 'errored' }] },
    { id: 'b', online: false, sessions: [{ status: 'idle' }] },
  ];
  const s = R.summarizeFleet(m);
  assert.equal(s.working, 1);
  assert.equal(s.errored, 1);
  assert.equal(s.idle, 1);
  assert.equal(s.online, 1);
  assert.equal(s.total, 2);
});
test('summarizeFleet: 空/null 兜底', () => {
  assert.equal(R.summarizeFleet(null).total, 0);
  assert.equal(R.summarizeFleet([]).online, 0);
});

test('diffCards: 新增 key 进 added', () => {
  const r = R.diffCards(['a', 'b'], ['a', 'b', 'c']);
  assert.deepEqual(r.added, ['c']);
  assert.deepEqual(r.removed, []);
});
test('diffCards: 消失 key 进 removed', () => {
  const r = R.diffCards(['a', 'b'], ['a']);
  assert.deepEqual(r.removed, ['b']);
  assert.deepEqual(r.added, []);
});
test('diffCards: 全空返回空集', () => {
  const r = R.diffCards([], []);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
});
test('diffCards: null 兜底', () => {
  const r = R.diffCards(null, null);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
});

test('parseCallout: 空屏 → 隐藏', () => {
  assert.equal(R.parseCallout('', {}).show, false);
  assert.equal(R.parseCallout(null, {}).show, false);
});
test('parseCallout: 纯进度行(无关键词)→ 隐藏', () => {
  const r = R.parseCallout('building modules…\n80% done', {});
  assert.equal(r.show, false);
});
test('parseCallout: 含 error → 点亮 + 截断省略', () => {
  const longErr = 'x'.repeat(200);
  const r = R.parseCallout(`npm install\nError: ${longErr}`, { now: 1000 });
  assert.equal(r.show, true);
  assert.match(r.text, /Error:/);
  assert.ok(r.text.length <= 121); // 120 + 省略号
});
test('parseCallout: ANSI 残留被 strip', () => {
  const r = R.parseCallout('\x1b[31mError: boom\x1b[0m', { now: 1000 });
  assert.equal(r.show, true);
  assert.doesNotMatch(r.text, /\x1b/);
  assert.match(r.text, /Error: boom$/);
});
test('parseCallout: 文本变化时重置 ts', () => {
  const now = 5000;
  const r1 = R.parseCallout('Error: a', { lastText: '', lastChangeTs: 0, now });
  assert.equal(r1.ts, now);
  const r2 = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 1000, now });
  assert.equal(r2.ts, 1000); // 不变
});
test('parseCallout: 稳定<10s 显示 实时输出中', () => {
  const r = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 5000, now: 8000 });
  assert.equal(r.timeLabel, '实时输出中…');
});
test('parseCallout: 稳定>10s 显示相对时间', () => {
  const r = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 1000, now: 15000 });
  assert.match(r.timeLabel, /s 前/);
});
test('parseCallout: traceback/exception/panic/EACCES/errno 均触发', () => {
  for (const t of ['Traceback (most recent)', 'Exception in thread', 'panic: x', 'EACCES: permission', 'errno -2']) {
    assert.equal(R.parseCallout(t, { now: 1 }).show, true, `应触发: ${t}`);
  }
});
