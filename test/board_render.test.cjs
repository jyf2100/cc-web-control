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

// ---- buildCardHTML(Plan A:<li.card-row> 同级 <button.card__select> + <a.card>;跳 /jump)----
test('buildCardHTML 输出 <li.card-row> + <a class="card"> 带 /jump href + data-* + aria-label', () => {
  const html = B.buildCardHTML(
    { id: 'm1', name: 'machine-a', online: true },
    { name: 'ses-1', status: 'working', lastLine: 'building…' },
    { active: true, now: 1000000, lastTs: 980000 }
  );
  // li 把 data-machine/session/key + role=group 上移到外层(Plan A:a 上不再有 data-machine/session/key)
  assert.match(html, /<li class="card-row"[^>]* data-machine="m1"[^>]* data-session="ses-1"[^>]* data-key="m1\/ses-1"[^>]* role="group"/);
  assert.match(html, /<a[^>]*class="card[^"]* active"/);            // 卡片是 <a>(click-to-navigate)
  assert.match(html, /href="\/jump\?m=m1&amp;s=ses-1"/);            // 跳 hub /jump 端点(Task 6)
  assert.match(html, /class="s-dot s-dot--working"/);
  assert.match(html, /data-status="working"/);
  // a 的 aria-label 用机器名/会话名/statusLabel/「在新标签打开控制台」,不含 lastLine
  assert.match(html, /aria-label="machine-a \/ ses-1, working, 在新标签打开控制台"/);
  assert.match(html, /<span class="card__time">20s 前<\/span>/);    // lastTs=980000,now=1000000 → 20s 前
});
test('buildCardHTML data-status 随 status 变化,缺省 unknown', () => {
  const m = { id: 'm1', name: 'M1' };
  assert.match(B.buildCardHTML(m, { name: 's1', status: 'errored' }, {}), /data-status="errored"/);
  assert.match(B.buildCardHTML(m, { name: 's1' }, {}), /data-status="unknown"/);
});
test('buildCardHTML card__select 是 <button>(非嵌套 checkbox),带 aria-pressed,初始 ☐ 未选', () => {
  const html = B.buildCardHTML({ id: 'm1', name: 'a', online: true }, { name: 's', status: 'idle' }, {});
  // Plan A:button + a 同级(button 在前),button 用原生 aria-pressed 替代嵌套 checkbox(ARIA 合规)
  assert.match(html, /<button class="card__select" type="button"[^>]* data-toggle="select"[^>]* aria-pressed="false"[^>]*>☐<\/button>/);
  assert.doesNotMatch(html, /role="checkbox"/);   // Plan A:不再嵌 checkbox
  assert.doesNotMatch(html, /aria-checked/);
  assert.doesNotMatch(html, /☑/);                 // 初始未选(JS toggle 才变 ☑)
  assert.doesNotMatch(html, /card--selected/);    // selected 由 JS 重建时加,非 buildCardInner
});
test('buildCardHTML card__select button 带可访问名 aria-label(读屏知所选机/会话)— P1 WCAG 4.1.2', () => {
  // button 与 a 同级,须有独立可访问名,否则读屏聚焦 button 只报「按钮」不知选哪台机。
  const html = B.buildCardHTML({ id: 'm1', name: 'machine-a', online: true }, { name: 'ses-1', status: 'idle' }, {});
  assert.match(html, /<button class="card__select"[^>]*aria-label="选择 machine-a \/ ses-1"/);
});
test('buildCardHTML 离线机器 lastLine 回退 (离线)', () => {
  const html = B.buildCardHTML({ id: 'm2', name: 'b', online: false }, { name: 's', status: 'idle', lastLine: '' });
  assert.match(html, /\(离线\)/);
});
test('buildCardHTML XSS: data-* HTML 转义 + href URL 编码(< → %3C)', () => {
  const html = B.buildCardHTML({ id: '<x>', name: '<x>', online: true }, { name: '<s>', status: 'idle' });
  assert.match(html, /data-machine="&lt;x&gt;"/);            // data-* 属性:HTML 转义
  assert.match(html, /data-session="&lt;s&gt;"/);            // data-session 同样转义
  assert.match(html, /href="\/jump\?m=%3Cx%3E/);             // href query:URL 编码(encodeURIComponent),跳 /jump
});
test('buildCardHTML: machine 缺 name → 回退到 id', () => {
  const html = B.buildCardHTML({ id: 'm1' }, { name: 's1', status: 'idle' }, {});
  assert.match(html, /<span class="card__name">m1<\/span>/);
});

// ---- sortCardsByRelevance / summarizeFleet(从 console_render.test.cjs 原样迁)----
test('sortCardsByRelevance: errored 置顶 + 同级按 lastTs 降序 + 不改入参', () => {
  const now = 1000000000;
  const cards = [
    { name: 'a', status: 'working', lastTs: 100 },
    { name: 'b', status: 'errored', lastTs: 50 },
    { name: 'c', status: 'working', lastTs: 200 },
  ];
  const sorted = B.sortCardsByRelevance(cards, now);
  assert.equal(sorted[0].name, 'b');  // errored 首
  assert.equal(sorted[1].name, 'c');  // working: lastTs 200 > 100
  assert.equal(sorted[2].name, 'a');
  assert.equal(cards[0].name, 'a');   // 不改入参
});

test('sortCardsByRelevance: 陈旧 waiting 降到活跃 waiting 与 idle 之后', () => {
  const now = 1000000000;
  const sorted = B.sortCardsByRelevance([
    { status: 'waiting', name: 'stale', lastTs: now - 25 * 3600000 }, // 陈旧 → rank 4.5
    { status: 'waiting', name: 'fresh', lastTs: now - 1000 },          // 活跃 → rank 2
    { status: 'idle', name: 'idle1', lastTs: 0 },                     // rank 3
  ], now);
  assert.equal(sorted[0].name, 'fresh');
  assert.equal(sorted[1].name, 'idle1');
  assert.equal(sorted[2].name, 'stale');
});

test('sortCardsByRelevance: 全链 errored<working<waiting<idle + null 兜底', () => {
  const now = 1000000000;
  const names = B.sortCardsByRelevance([
    { status: 'idle', name: 'i', lastTs: 0 }, { status: 'working', name: 'w', lastTs: 0 },
    { status: 'errored', name: 'e', lastTs: 0 }, { status: 'waiting', name: 't', lastTs: 0 }, null,
  ], now).map((c) => c && c.name);
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
test('INTEGRATION: flattenFleet → sortCardsByRelevance 把 errored 冒到首位', () => {
  const now = 1000000000;
  const machines = [
    { id: 'm1', name: 'alpha', online: true, sessions: [
      { name: 's1', status: 'idle', lastLine: '', lastTs: 0 },
      { name: 's2', status: 'errored', lastLine: 'crash', lastTs: 0 },
    ]},
    { id: 'm2', name: 'beta', online: true, sessions: [
      { name: 's3', status: 'working', lastLine: 'running', lastTs: 0 },
    ]},
  ];
  const sorted = B.sortCardsByRelevance(B.flattenFleet(machines), now);
  assert.equal(sorted[0].status, 'errored');
  assert.equal(sorted[0].key, 'm1/s2');
});

// ---- buildCardRow(Plan A:<li.card-row> 同级 button + a;button 在 a 之前)----
test('buildCardRow emits li.card-row with sibling button + a', () => {
  const html = B.buildCardRow(
    { id: 'm1', name: 'mac-pro' },
    { name: 'ses-1', status: 'working' },
    {}
  );
  assert.match(html, /<li class="card-row"[^>]* data-machine="m1"[^>]* data-session="ses-1"[^>]* data-key="m1\/ses-1"[^>]* role="group"/);
  assert.match(html, /<button class="card__select" type="button"[^>]* aria-pressed="false"/);
  assert.match(html, /<a class="card"[^>]* href="\/jump\?m=m1&amp;s=ses-1"[^>]* target="_blank"[^>]* rel="noopener noreferrer"/);
  // button 在 a 之前(同级,DOM 顺序)— Plan A 的核心结构契约
  const btnIdx = html.indexOf('class="card__select"');
  const aIdx = html.indexOf('class="card"');
  assert.ok(btnIdx > -1 && aIdx > btnIdx, 'button 应在 a 之前');
});

test('buildCardRow aria-label uses machine name, not port 7684', () => {
  const html = B.buildCardRow({ id: 'm1', name: 'mac-pro' }, { name: 'ses-1', status: 'idle' }, {});
  assert.ok(!/7684/.test(html));
  assert.match(html, /mac-pro/);
});

test('buildCardRow a aria-label excludes lastLine', () => {
  const html = B.buildCardRow(
    { id: 'm1', name: 'mac-pro' },
    { name: 'ses-1', status: 'working', lastLine: 'some output' },
    {}
  );
  // a 的 aria-label 不含 lastLine(避免 2s 轮询刷新干扰读屏)
  const aMatch = html.match(/<a class="card"[^>]*aria-label="([^"]*)"/);
  assert.ok(aMatch);
  assert.ok(!/some output/.test(aMatch[1]));
});

// ---- buildCardInner(Plan A:仅 <a>…</a>,无 <li> 包裹,无 .card__select,无 data-machine/session/key)----
test('buildCardInner: 返回 <a>…</a>,不含 <li> 不含 .card__select', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'machine-a', online: true },
    { name: 'ses-1', status: 'working', lastLine: 'building…' },
    { lastTs: 980000, now: 1000000 }
  );
  assert.ok(html.indexOf('<a ') === 0, '应以 <a 起始(实际:' + html.slice(0, 10) + ')');
  assert.ok(html.lastIndexOf('</a>') === html.length - 4, '应以 </a> 结尾');
  assert.doesNotMatch(html, /<li/);
  assert.match(html, /class="card"/);
  // Plan A:data-machine/session/key 上移到 <li>;data-status 仍留在 <a>
  assert.doesNotMatch(html, /data-machine=/);
  assert.doesNotMatch(html, /data-session=/);
  assert.doesNotMatch(html, /data-key=/);
  assert.match(html, /data-status="working"/);
  // buildCardInner 不再嵌 .card__select(已上移为 <button> 同级)
  assert.doesNotMatch(html, /card__select/);
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

test('buildCardInner: aria-label 不含 lastLine(避免 2s 轮询刷新干扰读屏)', () => {
  // Plan A:a 的 aria-label 只含 机器名/会话名/statusLabel/「在新标签打开控制台」,
  // lastLine 由 2s 轮询不断刷新,放 aria-label 会让读屏频繁打断用户。
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac' },
    { name: 'ses', status: 'waiting', lastLine: '## 收尾 `mem` some-output' },
    {}
  );
  const label = (html.match(/aria-label="([^"]*)"/) || [])[1];
  assert.ok(!label.includes('some-output'), 'aria-label 不应含 lastLine');
  assert.ok(!label.includes('##'), 'aria-label 不应含标题标记');
  assert.ok(!label.includes('`'), 'aria-label 不应含反引号');
});

test('isStale: waiting/unknown +>24h → true; 23h/无lastTs/其他状态 → false', () => {
  const now = 1000000000;
  assert.equal(B.isStale({ status: 'waiting', lastTs: now - 25 * 3600000 }, now), true);   // 25h waiting
  assert.equal(B.isStale({ status: 'unknown', lastTs: now - 25 * 3600000 }, now), true);   // 25h unknown(§1 痛点数据含 unknown)
  assert.equal(B.isStale({ status: 'waiting', lastTs: now - 23 * 3600000 }, now), false);  // 23h waiting
  assert.equal(B.isStale({ status: 'unknown', lastTs: now - 23 * 3600000 }, now), false);  // 23h unknown
  assert.equal(B.isStale({ status: 'waiting', lastTs: 0 }, now), false);                   // 无 lastTs
  assert.equal(B.isStale({ status: 'working', lastTs: now - 100 * 86400000 }, now), false); // 非 waiting/unknown
  assert.equal(B.isStale(null, now), false);
});

test('partitionStale: 按 isStale 分 active/stale 两组', () => {
  const now = 1000000000;
  const { active, stale } = B.partitionStale([
    { status: 'waiting', lastTs: now - 25 * 3600000 },  // stale(陈旧 waiting)
    { status: 'unknown', lastTs: now - 25 * 3600000 },  // stale(陈旧 unknown)
    { status: 'working', lastTs: now - 1000 },           // active
    { status: 'waiting', lastTs: now - 1000 },           // active
  ], now);
  assert.equal(active.length, 2);
  assert.equal(stale.length, 2);                          // waiting + unknown 陈旧
  assert.equal(B.partitionStale(null).active.length, 0);
});

// ---- buildCardInner 永远机器维度(:7685 多机 hub)+ card__select + flattenFleet 透传 cwd ----
// singleMachine 分支已移除(:7685 是多机 hub,07-04 spec 错把它当单机的产物,见
// docs/superpowers/specs/2026-07-04-7685-hub-gap-audit.md §1)。永远机器名主标题 + 会话名副行。
test('buildCardInner → card__name=机器名 + 会话名副行(永远机器维度)', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac-pro', online: true },
    { name: 'cc-web-control', status: 'working' },
    {}
  );
  assert.match(html, /class="card"/); // 无 card--single
  assert.doesNotMatch(html, /card--single/);
  assert.match(html, /<span class="card__name">mac-pro<\/span>/);
  assert.match(html, /<span class="card__session">cc-web-control<\/span>/);
});

test('buildCardInner 废弃 singleMachine 参数被忽略 → 仍机器名(防御旧调用方)', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac-pro', online: true },
    { name: 'cc-web-control', status: 'working', cwd: '~/ws/cc-web-control' },
    { singleMachine: true } // 废弃参数,应被忽略
  );
  assert.match(html, /<span class="card__name">mac-pro<\/span>/); // 仍机器名,非会话名
  assert.match(html, /<span class="card__session">cc-web-control<\/span>/); // 会话名副行,非 cwd
  assert.doesNotMatch(html, /card--single/);
  // Plan A:buildCardInner 的 <a> 不再带 data-machine/session/key(上移到 <li>)
  assert.doesNotMatch(html, /data-machine=/);
});

test('flattenFleet 透传 session.cwd', () => {
  const cards = B.flattenFleet([{ id: 'm1', name: 'm', online: true, sessions: [{ name: 's', status: 'idle', cwd: '/proj' }] }]);
  assert.equal(cards[0].session.cwd, '/proj');
});

// ---- groupByMachine(按机分节,离线机排末尾)----
test('groupByMachine 按 machine.id 分组,保留组内顺序', () => {
  const cards = [
    { machine: { id: 'A', online: true },  session: { name: 's1' }, key: 'A/s1' },
    { machine: { id: 'B', online: true },  session: { name: 's2' }, key: 'B/s2' },
    { machine: { id: 'A', online: true },  session: { name: 's3' }, key: 'A/s3' },
  ];
  const groups = B.groupByMachine(cards);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].machine.id, 'A');
  assert.deepEqual(groups[0].cards.map(c => c.key), ['A/s1', 'A/s3']);
  assert.equal(groups[1].machine.id, 'B');
});
test('groupByMachine 离线机组排末尾', () => {
  const cards = [
    { machine: { id: 'off', online: false }, session: { name: 's' }, key: 'off/s' },
    { machine: { id: 'on', online: true },   session: { name: 's' }, key: 'on/s' },
  ];
  const groups = B.groupByMachine(cards);
  assert.equal(groups[0].machine.id, 'on');
  assert.equal(groups[1].machine.id, 'off');
});
test('groupByMachine null/空 → []', () => {
  assert.deepEqual(B.groupByMachine(null), []);
  assert.deepEqual(B.groupByMachine([]), []);
});

// ---- buildCardInner hub 模式(摘要为中心 IA,对齐 demo /tmp/dashboard-redesign-demo.html)----
test('buildCardInner hub:card--hub class + card__head 包裹层 + 会话名主锚 + 无 s-icon', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac-pro', online: true },
    { name: 'sess-1', status: 'working', lastLine: 'building…' },
    { mode: 'hub', lastTs: 980000, now: 1000000 }
  );
  assert.match(html, /class="card card--hub"/);
  assert.match(html, /<div class="card__head">/);                       // head 包裹层(demo 结构)
  assert.match(html, /<span class="card__name">sess-1<\/span>/);        // 会话名主锚(非机器名)
  assert.doesNotMatch(html, /s-icon/);                                   // hub 删 s-icon
  assert.match(html, /<div class="card__last">building…<\/div>/);       // 摘要 div(非 span)
});

test('buildCardInner hub:加 sr-only 中文状态(色盲冗余,状态不唯一靠色)', () => {
  const cases = [
    ['working', '运行中'], ['waiting', '等待中'], ['errored', '出错'],
    ['idle', '空闲'], ['offline', '离线'],
  ];
  for (const [st, cn] of cases) {
    const html = B.buildCardInner({ id: 'm', name: 'a', online: true }, { name: 's', status: st }, { mode: 'hub' });
    assert.match(html, new RegExp('<span class="sr-only">' + cn + '</span>'), `status=${st} 应有 sr-only「${cn}」`);
  }
});

test('buildCardInner hub 离线卡:card__off + aria-disabled + "前在线" 时间 + 占位摘要', () => {
  const html = B.buildCardInner(
    { id: 'm2', name: 'off-machine', online: false },
    { name: 'sess-1', status: 'offline', lastLine: 'last output' },
    { mode: 'hub', lastTs: 720000, now: 10000000 }
  );
  assert.match(html, /aria-disabled="true"/);                            // 离线不可激活语义
  assert.match(html, /<span class="card__off">离线<\/span>/);
  assert.match(html, /主机离线,暂无实时状态/);
  assert.match(html, /上次摘要:last output/);
  // lastTs=720000,now=10000000 → diff=9280000ms ≈ 2.58h → "2h 前" + "在线" = "2h 前在线"
  assert.match(html, /<span class="card__time">2h 前在线<\/span>/);
});

test('buildCardInner hub 离线卡无 lastLine:固定占位文案,不残「上次摘要:」', () => {
  const html = B.buildCardInner(
    { id: 'm2', name: 'off', online: false },
    { name: 's', status: 'offline', lastLine: '' },
    { mode: 'hub' }
  );
  assert.match(html, /主机离线,暂无实时状态。/);
  assert.doesNotMatch(html, /上次摘要/);
});

test('buildCardInner 默认 single 模式仍机器名主锚 + 保留 s-icon(向后兼容,无 card--hub/card__head)', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac-pro', online: true },
    { name: 'sess', status: 'working' },
    {} // 不传 mode → 默认 single(旧行为)
  );
  assert.doesNotMatch(html, /card--hub/);
  assert.doesNotMatch(html, /card__head/);
  assert.match(html, /<span class="card__name">mac-pro<\/span>/);        // 仍机器名
  assert.match(html, /s-icon/);                                          // single 保留 s-icon
  assert.doesNotMatch(html, /sr-only/);
});

// ---- summarizeMachine / renderStatusCounts(组标题 + 顶栏共用的色谱圆点+数字计数)----
test('summarizeMachine: 五通道计数 + total = 点和', () => {
  const c = B.summarizeMachine([
    { status: 'working' }, { status: 'working' },
    { status: 'waiting' }, { status: 'errored' },
    { status: 'idle' }, { status: 'offline' }, { status: 'offline' },
  ]);
  assert.equal(c.working, 2);
  assert.equal(c.waiting, 1);
  assert.equal(c.errored, 1);
  assert.equal(c.idle, 1);
  assert.equal(c.offline, 2);
  assert.equal(c.total, 7);
  assert.equal(c.working + c.waiting + c.errored + c.idle + c.offline + (c.unknown || 0), 7);
});

test('summarizeMachine: null/空 → 全 0', () => {
  assert.equal(B.summarizeMachine(null).total, 0);
  assert.equal(B.summarizeMachine([]).working, 0);
});

test('renderStatusCounts: 嵌套 s-dot + 数字,非零项带中文 title,无 emoji 无 ×', () => {
  const html = B.renderStatusCounts({ working: 2, waiting: 1, errored: 0, idle: 1, offline: 2, unknown: 0, total: 6 });
  assert.match(html, /class="status-count"[^>]*title="工作中"[^>]*>[\s\S]*?s-dot--working[\s\S]*?<\/span>2/);
  assert.match(html, /title="等待用户"[\s\S]*?<\/span>1/);
  assert.match(html, /title="空闲"[\s\S]*?<\/span>1/);
  assert.match(html, /title="离线"[\s\S]*?<\/span>2/);
  assert.ok(!/errored/.test(html), 'errored=0 不渲染');
  assert.ok(!/✕|▶|⏸|⏳|⌽|×/.test(html), '无 emoji 无 ×');
});

test('renderStatusCounts: 全 0 → 空串', () => {
  assert.equal(B.renderStatusCounts({ working: 0, waiting: 0, errored: 0, idle: 0, offline: 0, unknown: 0, total: 0 }), '');
});
