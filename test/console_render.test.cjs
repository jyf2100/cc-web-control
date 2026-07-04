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
  assert.match(html, /data-status="working"/);
});
test('buildCardHTML button 输出 data-status(随 status 变化,缺省 unknown)', () => {
  const m = { id: 'm1', name: 'M1' };
  let html = R.buildCardHTML(m, { name: 's1', status: 'errored' }, {});
  assert.match(html, /data-status="errored"/);
  html = R.buildCardHTML(m, { name: 's1', status: 'waiting' }, {});
  assert.match(html, /data-status="waiting"/);
  html = R.buildCardHTML(m, { name: 's1' }, {}); // status 缺省
  assert.match(html, /data-status="unknown"/);
});
test('buildCardHTML selected 加 card--selected + ☑ + aria-label 含已选', () => {
  const html = R.buildCardHTML({ id: 'm1', name: 'a', online: true }, { name: 's', status: 'idle' }, { selected: true });
  assert.match(html, /class="[^"]*card--selected/);
  assert.match(html, /☑/);
  assert.match(html, /aria-label="已选/);
});
test('buildCardHTML: card__select 为纯视觉指示器(无 role/tabindex,避免 button 内嵌套交互后代)', () => {
  const html = R.buildCardHTML({ id: 'm1', name: 'a', online: true }, { name: 's', status: 'idle' }, { selected: false });
  assert.match(html, /<span class="card__select" aria-hidden="true">☐<\/span>/);
  assert.doesNotMatch(html, /role="checkbox"/);
  assert.doesNotMatch(html, /tabindex="-1"/);
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
  // 空行分隔:Error 自成"最后非空块",块首即 Error 行(spec §9 块首算法)
  const r = R.parseCallout(`npm install\n\nError: ${longErr}`, { now: 1000 });
  assert.equal(r.show, true);
  assert.match(r.text, /Error:/);
  assert.ok(r.text.length <= 121); // 120 + 省略号
});
test('parseCallout: 多行错误栈 → 取块首(非栈尾噪音)', () => {
  const r = R.parseCallout('npm install\n\nError: ENOTEMPTY\n    at line 42\n    at line 17', { now: 1000 });
  assert.equal(r.show, true);
  assert.equal(r.text, 'Error: ENOTEMPTY');
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

test('nextBackoff: 退避表 3→6→12→30 秒', () => {
  assert.equal(R.nextBackoff(0), 3000);
  assert.equal(R.nextBackoff(1), 6000);
  assert.equal(R.nextBackoff(2), 12000);
  assert.equal(R.nextBackoff(3), 30000);
});
test('nextBackoff: 超出表上限封顶 30s', () => {
  assert.equal(R.nextBackoff(4), 30000);
  assert.equal(R.nextBackoff(99), 30000);
});
test('nextBackoff: 负参兜底首档', () => {
  assert.equal(R.nextBackoff(-1), 3000);
});

// ---- 业务边界补充(branch 覆盖) ----

test('relativeTime: 缺 now 参数走 Date.now() 兜底分支', () => {
  // 只传 ts,触发 `now || Date.now()` 的 falsy 分支;不锁具体值(依赖当前时刻),只验不抛 + 落在合理档位
  const out = R.relativeTime(Date.now() - 3000);
  assert.match(out, /^(now|\d+s 前|\d+m 前|\d+h 前)$/);
});

test('statusMeta: offline 命中已知表(锁 dot+icon 契约)', () => {
  const m = R.statusMeta('offline');
  assert.equal(m.dot, 's-dot--offline');
  assert.equal(m.icon, '⌽');
  assert.equal(m.label, 'offline');
});

test('statusMeta: undefined 回退 DEFAULT', () => {
  const m = R.statusMeta(undefined);
  assert.equal(m.dot, 's-dot--unknown');
  assert.equal(m.icon, '?');
  assert.equal(m.label, 'unknown');
});

test('buildCardHTML: active+selected 叠加 → class 顺序 active 在 selected 前', () => {
  const html = R.buildCardHTML(
    { id: 'm1', name: 'M1' },
    { name: 's1', status: 'errored' },
    { active: true, selected: true }
  );
  assert.match(html, /class="card active card--selected"/);
  assert.match(html, /data-status="errored"/);
  assert.doesNotMatch(html, /role="checkbox"/);
  assert.match(html, /aria-label="已选/);
});

test('buildCardHTML: 离线机器无 lastLine → 兜底 (离线)', () => {
  const html = R.buildCardHTML(
    { id: 'm1', online: false },
    { name: 's1', status: 'working' },
    {}
  );
  assert.match(html, /\(离线\)/);
});

test('buildCardHTML: machine 缺 name → 回退到 id', () => {
  const html = R.buildCardHTML({ id: 'm1' }, { name: 's1', status: 'idle' }, {});
  assert.match(html, /<span class="card__name">m1<\/span>/);
});

test('diffCards: 全同输入 → added/removed 均空(走两条循环的 false 分支)', () => {
  const r = R.diffCards(['a', 'b'], ['a', 'b']);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
});

test('parseCallout: text===lastText 但 lastChangeTs=0 → ts 走 now 兜底', () => {
  const now = 5000;
  const r = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 0, now });
  assert.equal(r.ts, now);            // 0 || now → now
  assert.equal(r.timeLabel, '实时输出中…'); // stableMs=0,未超 10s
});

test('sortCardsErroredFirst: null 元素兜底 rank 4 + 同 status 按名排', () => {
  const sorted = R.sortCardsErroredFirst([
    { status: 'working', name: 'b' },
    { status: 'errored', name: 'z' },
    null,
    { status: 'errored', name: 'a' },
  ]);
  assert.equal(sorted[0].name, 'a'); // errored(0) 优先,同级 a<z
  assert.equal(sorted[1].name, 'z');
  assert.equal(sorted[2].name, 'b'); // working(1) 次之
  assert.equal(sorted.length, 4);
  assert.equal(sorted[3], null);     // null 兜底 rank 4,排末位
});

test('summarizeFleet: online 未显式声明计为在线 + 未识别 status 被忽略', () => {
  const c = R.summarizeFleet([
    { id: 'm1', sessions: [{ status: 'bogus' }] }, // online 缺省→true;status 'bogus' 不在表→跳过
    { id: 'm2', online: true, sessions: [{ status: 'unknown' }] },
  ]);
  assert.equal(c.total, 2);
  assert.equal(c.online, 2);    // m1(online 缺省) + m2
  assert.equal(c.unknown, 1);   // 仅 m2 的 unknown session 计入
  assert.equal(c.bogus, undefined); // 未识别 status 不污染计数表
});
