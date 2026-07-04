const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../public/board_render.cjs');

// ---- escapeHtml / statusMeta / relativeTime(从 console_render.test.cjs 迁移,原样)----
test('escapeHtml 中和注入字符', () => {
  assert.equal(B.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(B.escapeHtml('a"b'), 'a&quot;b');
  assert.equal(B.escapeHtml('a&b'), 'a&amp;b');
});
test('escapeHtml null/undefined 兜底空串', () => {
  assert.equal(B.escapeHtml(null), '');
  assert.equal(B.escapeHtml(undefined), '');
});
test('statusMeta 已知状态返回 dot+icon+label', () => {
  const m = B.statusMeta('errored');
  assert.equal(m.dot, 's-dot--errored'); assert.equal(m.icon, '✕'); assert.equal(m.label, 'errored');
});
test('statusMeta 未知/undefined 回退 unknown', () => {
  assert.equal(B.statusMeta('bogus').dot, 's-dot--unknown');
  assert.equal(B.statusMeta(undefined).icon, '?');
  assert.equal(B.statusMeta('offline').icon, '⌽');
});
test('relativeTime <5s → now / 秒分时档 / 无 ts 空串', () => {
  assert.equal(B.relativeTime(Date.now() - 3000, Date.now()), 'now');
  const now = 1000000;
  assert.equal(B.relativeTime(now - 30000, now), '30s 前');
  assert.equal(B.relativeTime(now - 120000, now), '2m 前');
  assert.equal(B.relativeTime(now - 7200000, now), '2h 前');
  assert.equal(B.relativeTime(0, Date.now()), '');
});

// ---- buildCardHTML(改:click-to-navigate 的 <a>,无 select/无 ☐☑)----
test('buildCardHTML 输出 <a class="card"> 带 href + data-* + aria-label', () => {
  const html = B.buildCardHTML(
    { id: 'm1', name: 'machine-a', online: true },
    { name: 'ses-1', status: 'working', lastLine: 'building…' },
    { active: true, now: 1000000, lastTs: 980000 }
  );
  assert.match(html, /<li class="card-row" data-key="m1\/ses-1">/); // <li> wrapper + data-key
  assert.match(html, /<a[^>]*class="card[^"]* active"/);            // 卡片是 <a>(click-to-navigate)
  assert.match(html, /href="\/console\.html\?m=m1&amp;s=ses-1"/);   // 跳控制台 URL
  assert.match(html, /class="s-dot s-dot--working"/);
  assert.match(html, /data-machine="m1"/);
  assert.match(html, /data-session="ses-1"/);
  assert.match(html, /data-status="working"/);
  assert.match(html, /aria-label="machine-a \/ ses-1,working,/);
  assert.match(html, /<span class="card__time">20s 前<\/span>/);    // lastTs=980000,now=1000000 → 20s 前
});
test('buildCardHTML data-status 随 status 变化,缺省 unknown', () => {
  const m = { id: 'm1', name: 'M1' };
  assert.match(B.buildCardHTML(m, { name: 's1', status: 'errored' }, {}), /data-status="errored"/);
  assert.match(B.buildCardHTML(m, { name: 's1' }, {}), /data-status="unknown"/);
});
test('buildCardHTML 无 select 语义(看板纯监控,无 ☐/☑/card__selected)', () => {
  const html = B.buildCardHTML({ id: 'm1', name: 'a', online: true }, { name: 's', status: 'idle' }, {});
  assert.doesNotMatch(html, /card__select/);
  assert.doesNotMatch(html, /☐|☑/);
  assert.doesNotMatch(html, /card--selected/);
  assert.doesNotMatch(html, /已选/);
});
test('buildCardHTML 离线机器 lastLine 回退 (离线)', () => {
  const html = B.buildCardHTML({ id: 'm2', name: 'b', online: false }, { name: 's', status: 'idle', lastLine: '' });
  assert.match(html, /\(离线\)/);
});
test('buildCardHTML XSS: data-* HTML 转义 + href URL 编码(< → %3C)', () => {
  const html = B.buildCardHTML({ id: '<x>', name: '<x>', online: true }, { name: '<s>', status: 'idle' });
  assert.match(html, /data-machine="&lt;x&gt;"/);            // data-* 属性:HTML 转义
  assert.match(html, /data-session="&lt;s&gt;"/);            // data-session 同样转义
  assert.match(html, /href="\/console\.html\?m=%3Cx%3E/);    // href query:URL 编码(encodeURIComponent)
});
test('buildCardHTML: machine 缺 name → 回退到 id', () => {
  const html = B.buildCardHTML({ id: 'm1' }, { name: 's1', status: 'idle' }, {});
  assert.match(html, /<span class="card__name">m1<\/span>/);
});

// ---- sortCardsErroredFirst / summarizeFleet / diffCards(从 console_render.test.cjs 原样迁)----
test('sortCardsErroredFirst: errored 置顶 + 同级字典序 + 不改入参', () => {
  const cards = [{ name: 'a', status: 'working' }, { name: 'b', status: 'errored' }, { name: 'c', status: 'idle' }];
  assert.equal(B.sortCardsErroredFirst(cards)[0].name, 'b');
  assert.equal(cards[0].name, 'a'); // 不改入参
});
test('sortCardsErroredFirst: 全链 errored<working<waiting<idle + null 兜底', () => {
  const names = B.sortCardsErroredFirst([
    { status: 'idle', name: 'i' }, { status: 'working', name: 'w' },
    { status: 'errored', name: 'e' }, { status: 'waiting', name: 't' }, null,
  ]).map((c) => c && c.name);
  assert.deepEqual(names, ['e', 'w', 't', 'i', null]);
});
test('summarizeFleet: 计各状态 + online/total + 未识别 status 跳过', () => {
  const s = B.summarizeFleet([
    { id: 'a', online: true, sessions: [{ status: 'working' }, { status: 'errored' }] },
    { id: 'b', online: false, sessions: [{ status: 'idle' }] },
  ]);
  assert.equal(s.working, 1); assert.equal(s.errored, 1); assert.equal(s.online, 1); assert.equal(s.total, 2);
  assert.equal(B.summarizeFleet(null).total, 0);
});
test('diffCards: added/removed/全同/null 兜底', () => {
  assert.deepEqual(B.diffCards(['a', 'b'], ['a', 'b', 'c']).added, ['c']);
  assert.deepEqual(B.diffCards(['a', 'b'], ['a']).removed, ['b']);
  assert.deepEqual(B.diffCards(['a', 'b'], ['a', 'b']).added, []);
  assert.deepEqual(B.diffCards(null, null).added, []);
});
