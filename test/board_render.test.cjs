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
test('relativeTime <5s → now / 秒分时天周月档 / 无 ts 空串', () => {
  assert.equal(B.relativeTime(Date.now() - 3000, Date.now()), 'now');
  const now = 1000000;
  assert.equal(B.relativeTime(now - 30000, now), '30s 前');
  assert.equal(B.relativeTime(now - 120000, now), '2m 前');
  assert.equal(B.relativeTime(now - 7200000, now), '2h 前');
  assert.equal(B.relativeTime(now - 3 * 86400000, now), '3d 前');      // 3 天
  assert.equal(B.relativeTime(now - 14 * 86400000, now), '2w 前');     // 14 天 = 2 周
  assert.equal(B.relativeTime(now - 60 * 86400000, now), '2个月前');   // 60 天 = 2 月
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

// ---- flattenFleet(hub machines → 顶层 status 卡片;修复 sort bug)----
test('flattenFleet: status 提升至顶层 + offline→offline + key/name 形状 + lastTs null-safe', () => {
  const cards = B.flattenFleet([
    { id: 'm1', name: 'machine-a', online: true, sessions: [
      { name: 's1', status: 'errored', lastLine: 'boom', lastTs: 1000 },
      { name: 's2', status: 'working', lastLine: 'ok', lastTs: 2000 },
    ]},
    { id: 'm2', name: 'machine-b', online: false, sessions: [
      { name: 's3', status: 'idle', lastLine: '' },
    ]},
  ]);
  assert.equal(cards.length, 3);
  // 顶层 status(原 bug:status 嵌在 .session.status,sort 读不到)
  assert.equal(cards[0].status, 'errored');
  assert.equal(cards[1].status, 'working');
  assert.equal(cards[2].status, 'offline'); // 离线机 → 'offline'(忽略 session.status)
  // key / name 形状
  assert.equal(cards[0].key, 'm1/s1');
  assert.equal(cards[0].name, 'machine-a'); // m.name || m.id
  // lastTs null-safe
  assert.equal(cards[0].lastTs, 1000);
  assert.equal(cards[2].lastTs, 0); // s.lastTs 缺失 → 0
  // machine + session 字段仍在(供 buildCardInner)
  assert.equal(cards[0].machine.id, 'm1');
  assert.equal(cards[0].session.name, 's1');
  assert.equal(cards[0].session.status, 'errored');
});
test('flattenFleet: machines null/undefined → []', () => {
  assert.deepEqual(B.flattenFleet(null), []);
  assert.deepEqual(B.flattenFleet(undefined), []);
  assert.deepEqual(B.flattenFleet([]), []);
});
test('flattenFleet: 缺 session.status → unknown', () => {
  const cards = B.flattenFleet([{ id: 'm1', name: 'm', online: true, sessions: [{ name: 's', lastLine: '' }] }]);
  assert.equal(cards[0].status, 'unknown');
});

// 集成测试(原 sort bug 会被这条抓到:errored 必须冒到首位)
test('INTEGRATION: flattenFleet → sortCardsErroredFirst 把 errored 冒到首位', () => {
  const machines = [
    { id: 'm1', name: 'alpha', online: true, sessions: [
      { name: 's1', status: 'idle', lastLine: '', lastTs: 0 },
      { name: 's2', status: 'errored', lastLine: 'crash', lastTs: 0 },
    ]},
    { id: 'm2', name: 'beta', online: true, sessions: [
      { name: 's3', status: 'working', lastLine: 'running', lastTs: 0 },
    ]},
  ];
  const sorted = B.sortCardsErroredFirst(B.flattenFleet(machines));
  assert.equal(sorted[0].status, 'errored');
  assert.equal(sorted[0].key, 'm1/s2');
});

// ---- buildCardInner(仅 <a>…</a>,无 <li> 包裹)----
test('buildCardInner: 返回 <a>…</a>,不含 <li>', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'machine-a', online: true },
    { name: 'ses-1', status: 'working', lastLine: 'building…' },
    { lastTs: 980000, now: 1000000 }
  );
  assert.ok(html.indexOf('<a ') === 0, '应以 <a 起始(实际:' + html.slice(0, 10) + ')');
  assert.ok(html.lastIndexOf('</a>') === html.length - 4, '应以 </a> 结尾');
  assert.doesNotMatch(html, /<li/);
  assert.match(html, /class="card"/);
  assert.match(html, /data-machine="m1"/);
});
test('buildCardHTML = <li data-key> + buildCardInner 组合', () => {
  const full = B.buildCardHTML({ id: 'm1', name: 'a', online: true }, { name: 's1', status: 'idle' }, {});
  const inner = B.buildCardInner({ id: 'm1', name: 'a', online: true }, { name: 's1', status: 'idle' }, {});
  assert.match(full, /^<li class="card-row"/);
  assert.match(full, /<\/a><\/li>$/);
  assert.ok(full.indexOf(inner) > 0, 'buildCardHTML 必须包含 buildCardInner 输出');
});

test('buildCardInner lastLine 经 cleanSummary:markdown 标记剥离', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'M1', online: true },
    { name: 's1', status: 'idle', lastLine: '## 收尾 ✅ `mem`' },
    {}
  );
  assert.match(html, /<span class="card__last">收尾 ✅ mem<\/span>/);
  assert.doesNotMatch(html, /card__last[^<]*##/); // 不残留 ## 标记
});

test('isStale: waiting+>24h → true; 23h/无lastTs/非waiting → false', () => {
  const now = 1000000000;
  assert.equal(B.isStale({ status: 'waiting', lastTs: now - 25 * 3600000 }, now), true);  // 25h
  assert.equal(B.isStale({ status: 'waiting', lastTs: now - 23 * 3600000 }, now), false); // 23h
  assert.equal(B.isStale({ status: 'waiting', lastTs: 0 }, now), false);                  // 无 lastTs
  assert.equal(B.isStale({ status: 'working', lastTs: now - 100 * 86400000 }, now), false); // 非 waiting
  assert.equal(B.isStale(null, now), false);
});

test('partitionStale: 按 isStale 分 active/stale 两组', () => {
  const now = 1000000000;
  const { active, stale } = B.partitionStale([
    { status: 'waiting', lastTs: now - 25 * 3600000 },  // stale
    { status: 'working', lastTs: now - 1000 },           // active
    { status: 'waiting', lastTs: now - 1000 },           // active
  ], now);
  assert.equal(active.length, 2);
  assert.equal(stale.length, 1);
  assert.equal(B.partitionStale(null).active.length, 0);
});
