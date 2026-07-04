# 控制台与看板功能分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 hub 的看板(监控)与控制台(操作)从「单页三合一融合」分离为两个独立页面,底部三项 tab 单机/hub 全局统一,`dashboard.html` 恢复为独立多机看板。

**Architecture:** 卡片网格渲染从 `console_render.cjs` 抽到新 UMD 纯模块 `board_render.cjs`(由看板页消费);`dashboard.html` 探测 `/api/global-dashboard` 自适配 hub/单机双模式;`console.html` 精简为 topbar + main-agent + 终端 + 切换抽屉,移除卡片网格;hub 移除 `/dashboard.html→/console.html` 重定向(bug 3 根治);广播入口从卡片多选改为切换抽屉多选模式。

**Tech Stack:** 原生 JS(无框架)、UMD 纯模块(`.cjs` 浏览器+Node 双跑)、Express(hub)、`node --test` 测试、editorial 设计 token(`tokens.css`)。

**Spec:** [docs/superpowers/specs/2026-07-04-console-dashboard-separation-design.md](../specs/2026-07-04-console-dashboard-separation-design.md)
**Mockup:** `.superpowers/brainstorm/14865-1783145190/content/separation-mockup.html`

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `public/board_render.cjs` | 卡片网格渲染纯函数(看板消费) | **新增** |
| `public/console_render.cjs` | main-agent callout + WS 退避(控制台消费) | 改(移除卡片函数) |
| `public/switch_sheet.cjs` | 切换抽屉模态状态机 | 改(`backdropRoot` 参数化) |
| `public/dashboard.html` | 看板页(双模式) | 改 |
| `public/dashboard.js` | 看板页逻辑(双模式 poll + 卡片 + 跳转 + stale) | 改 |
| `public/dashboard.css` | 看板/控制台共用样式 | 改(board-stale + unknown 对比度) |
| `public/console.html` | 控制台页(精简) | 改 |
| `public/console.js` | 控制台逻辑(移除 board + 抽屉 + 多选 + URL param) | 改 |
| `hub/server.cjs` | hub 路由 | 改(移除 dashboard 重定向) |
| `test/board_render.test.cjs` | 卡片纯函数测试 | **新增** |
| `test/dashboard-dual-mode.test.cjs` | 双模式探测测试 | **新增** |
| `test/console_render.test.cjs` | 移除已迁卡片测试 | 改 |
| `test/console_html.test.cjs` | console.html/js 契约 | 改 |
| `test/console_style.test.cjs` | a11y 契约 | 改 |
| `test/hub-server.test.cjs` | hub 路由契约 | 改 |

**边界纪律:** 单机 `index.html`/`client.js`/`dashboard.js` 的 session-list 逻辑不动;后端 API 不改(复用 `global-dashboard`/`machines`/`main-agent`)。

---

## Task 1: 抽取 `board_render.cjs` + 测试迁移(纯函数,独立)

**Files:**
- Create: `public/board_render.cjs`
- Create: `test/board_render.test.cjs`
- Modify: `public/console_render.cjs`
- Modify: `test/console_render.test.cjs`

**背景:** 卡片渲染(`buildCardHTML`/`updateCardNode`/`sortCardsErroredFirst`/`summarizeFleet`/`diffCards`/`statusMeta`/`escapeHtml`/`relativeTime`)归看板;`parseCallout`/`nextBackoff` 留控制台。看板卡片改 **click-to-navigate**(原生 `<a>`,可书签/中键),**删除 `select`(☐/☑)多选语义**(多选移到抽屉,Task 6)。

- [ ] **Step 1.1: 写 `test/board_render.test.cjs`(从 console_render.test.cjs 迁卡片类测试 + 改 select 断言)**

```js
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
  assert.match(html, /<a[^>]*class="card[^"]* active"/);            // 卡片是 <a>(click-to-navigate)
  assert.match(html, /href="\/console\.html\?m=m1&amp;s=ses-1"/);   // 跳控制台 URL
  assert.match(html, /class="s-dot s-dot--working"/);
  assert.match(html, /data-machine="m1"/);
  assert.match(html, /data-session="ses-1"/);
  assert.match(html, /data-status="working"/);
  assert.match(html, /aria-label="machine-a \/ ses-1,working,/);
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
test('buildCardHTML XSS: name/id 转义(含 href)', () => {
  const html = B.buildCardHTML({ id: '<x>', name: '<x>', online: true }, { name: '<s>', status: 'idle' });
  assert.match(html, /data-machine="&lt;x&gt;"/);
  assert.match(html, /href="\/console\.html\?m=&lt;x&gt;/);  // href 内也转义
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
```

- [ ] **Step 1.2: 运行测试,确认失败(board_render.cjs 不存在)**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `Cannot find module '../public/board_render.cjs'`

- [ ] **Step 1.3: 创建 `public/board_render.cjs`(卡片纯函数,删 select,卡片改 `<a>`)**

```js
/**
 * Board render pure functions(看板卡片网格,浏览器 + 测试双跑)。
 * 从 console_render.cjs 抽出;看板纯监控 click-to-navigate(无多选 ☐/☑)。
 * 对齐范本:dashboard_render.cjs / console_render.cjs(UMD)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoardRender = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATUS_META = {
    working: { dot: 's-dot--working', icon: '▶', label: 'working' },
    idle:    { dot: 's-dot--idle',    icon: '⏸', label: 'idle' },
    errored: { dot: 's-dot--errored', icon: '✕', label: 'errored' },
    waiting: { dot: 's-dot--waiting', icon: '⏳', label: 'waiting' },
    offline: { dot: 's-dot--offline', icon: '⌽', label: 'offline' },
  };
  const DEFAULT_META = { dot: 's-dot--unknown', icon: '?', label: 'unknown' };

  function statusMeta(status) { return STATUS_META[status] || DEFAULT_META; }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    return `${Math.floor(diff / 3600000)}h 前`;
  }

  // 看板卡片:click-to-navigate 的 <a>(跳 /console.html?m=&s=),无 select 多选语义。
  function buildCardHTML(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const key = `${m.id}/${s.name}`;
    const classes = ['card'];
    if (o.active) classes.push('active');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const mid = escapeHtml(m.id);
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    const label = escapeHtml(`${m.name || m.id} / ${s.name},${meta.label},${lastRaw ? lastRaw.slice(0, 40) : '无输出'}`);
    const href = `/console.html?m=${encodeURIComponent(m.id)}&s=${encodeURIComponent(s.name)}`;
    return `<li class="card-row" data-key="${escapeHtml(key)}">` +
      `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" data-machine="${mid}" data-session="${sess}" data-status="${escapeHtml(s.status || 'unknown')}" aria-label="${label}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last || '—'}</span>` +
      `<span class="card__time">${time}</span>` +
      `</a></li>`;
  }

  const STATUS_RANK = { errored: 0, working: 1, waiting: 2, idle: 3, unknown: 4, offline: 5 };
  function sortCardsErroredFirst(cards) {
    return [...(cards || [])].sort((a, b) => {
      const ra = STATUS_RANK[a && a.status] == null ? 4 : STATUS_RANK[a.status];
      const rb = STATUS_RANK[b && b.status] == null ? 4 : STATUS_RANK[b.status];
      if (ra !== rb) return ra - rb;
      return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
    });
  }

  function summarizeFleet(machines) {
    const c = { working: 0, idle: 0, errored: 0, waiting: 0, unknown: 0, offline: 0, online: 0, total: 0 };
    for (const m of machines || []) {
      c.total++;
      if (m && m.online !== false) c.online++;
      for (const s of (m && m.sessions) || []) {
        const st = (s && s.status) || 'unknown';
        if (c[st] != null) c[st]++;
      }
    }
    return c;
  }

  function diffCards(prevKeys, nextKeys) {
    const prev = new Set(prevKeys || []);
    const next = new Set(nextKeys || []);
    const added = [], removed = [];
    for (const k of next) if (!prev.has(k)) added.push(k);
    for (const k of prev) if (!next.has(k)) removed.push(k);
    return { added, removed };
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards };
});
```

- [ ] **Step 1.4: 运行 `test/board_render.test.cjs`,确认通过**

Run: `node --test test/board_render.test.cjs`
Expected: PASS(全部)

- [ ] **Step 1.5: 从 `public/console_render.cjs` 移除已迁卡片函数,只留 main-agent 相关**

移除:`STATUS_META`/`DEFAULT_META`/`statusMeta`/`escapeHtml`/`buildCardHTML`/`STATUS_RANK`/`sortCardsErroredFirst`/`summarizeFleet`/`diffCards`。保留:`relativeTime`(parseCallout 依赖)、`stripAnsi`/`ERROR_RE`/`parseCallout`/`nextBackoff`/`BACKOFF_TABLE`。改 `return` 仅导出保留项。

最终 `console_render.cjs` return 行:
```js
  return { relativeTime, parseCallout, nextBackoff };
```
(顶部 UMD factory 不变;`parseCallout` 内部仍用本文件的 `relativeTime` + `stripAnsi` + `ERROR_RE`,不需改逻辑。)

- [ ] **Step 1.6: 从 `test/console_render.test.cjs` 移除已迁测试,只留 parseCallout/nextBackoff**

删除:escapeHtml、statusMeta、relativeTime、buildCardHTML、sortCardsErroredFirst、summarizeFleet、diffCards 的所有 test 块。保留:所有 `parseCallout:*` test 与 `nextBackoff:*` test。

- [ ] **Step 1.7: 运行 board_render + console_render 测试,确认通过**

Run: `node --test test/board_render.test.cjs test/console_render.test.cjs`
Expected: 两个文件全 PASS。

> **注:** `console_html.test.cjs` 此刻会因 console.js 仍引用 `ConsoleRender.buildCardHTML` 等已删函数而失败 —— 这是预期中间态,Task 5/6 修复。**勿在 Task 1 强求全量绿**,本步只验 board/console_render 两文件。

- [ ] **Step 1.8: 提交**

```bash
git add public/board_render.cjs public/console_render.cjs test/board_render.test.cjs test/console_render.test.cjs
git commit -m "refactor: 抽取 board_render.cjs 卡片纯模块(看板用),console_render 留 main-agent"
```

---

## Task 2: `createSwitchSheet` backdropRoot 参数化(P1-1,独立)

**Files:**
- Modify: `public/switch_sheet.cjs:132`
- Test: `test/switch_sheet.test.cjs`

**背景:** `switch_sheet.cjs:132` 的 `backdropRoot` 写死 `.console-card`(单机控制台根)。hub 控制台根是 `.console-app`,需参数化,单机调用保持兼容。

- [ ] **Step 2.1: 写失败测试(`backdropRoot` 可注入)**

若 `test/switch_sheet.test.cjs` 已存在,追加;否则新增。jsdom-less 环境下 `createSwitchSheet` 返回 null,故用源码断言验证「读 opts + 默认回退 + 不写死」:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'switch_sheet.cjs'), 'utf8');

test('createSwitchSheet backdropRoot 可经 opts 注入(默认 .console-card 兼容单机)', () => {
  assert.match(src, /opts\.backdropRoot/);                            // 读 opts
  assert.match(src, /\.console-card/);                                // 默认回退单机根
  assert.doesNotMatch(src, /querySelector\(['"]\.console-card['"]\)/); // 不再写死
});
```

- [ ] **Step 2.2: 运行,确认失败**

Run: `node --test test/switch_sheet.test.cjs`
Expected: FAIL(源码仍写死 `doc.querySelector('.console-card')`)

- [ ] **Step 2.3: 改 `public/switch_sheet.cjs` 第 132 行**

old:
```js
    const backdropRoot = () => doc.querySelector('.console-card');
```
new:
```js
    const rootSel = (opts && typeof opts.backdropRoot === 'string' && opts.backdropRoot) || '.console-card';
    const backdropRoot = () => doc.querySelector(rootSel);
```

- [ ] **Step 2.4: 运行,确认通过**

Run: `node --test test/switch_sheet.test.cjs`
Expected: PASS

- [ ] **Step 2.5: 提交**

```bash
git add public/switch_sheet.cjs test/switch_sheet.test.cjs
git commit -m "refactor: createSwitchSheet backdropRoot 参数化(为 hub .console-app 抽屉铺路)"
```

---

## Task 3: hub 路由反转 —— 移除 `/dashboard.html` 重定向(bug 3 根治)

**Files:**
- Modify: `hub/server.cjs`(删 `/dashboard.html` 重定向路由)
- Test: `test/hub-server.test.cjs`

- [ ] **Step 3.1: 改 `test/hub-server.test.cjs` —— `/dashboard.html` 直服(不再 302)**

先 Read `test/hub-server.test.cjs` 确认其 fetch 辅助(supertest 还是自建 app)。找到任何断言「`/dashboard.html` → 302/重定向到 `/console.html`」的测试,反转为 200。若无此类断言,新增:

```js
test('GET /dashboard.html 直服 HTML(不再重定向到 /console.html)', async () => {
  const res = await fetchHub('/dashboard.html'); // 沿用文件内已有 fetch 辅助;若无,见下方说明
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<!DOCTYPE html>/i);
  assert.match(body, /board-body|sessionList|console-app|fleet-summary/); // dashboard.html 内容
});
```
(若 `hub-server.test.cjs` 用自建 `app.listen` + `fetch`,沿用其启动方式;关键断言:`status===200` 且 body 是 HTML。同时删除/反转任何「`/dashboard.html` → 302」旧测试。)

- [ ] **Step 3.2: 运行,确认失败**

Run: `node --test test/hub-server.test.cjs`
Expected: FAIL(仍 302)

- [ ] **Step 3.3: 移除 `hub/server.cjs` 的 `/dashboard.html` 重定向路由**

删除整行 `app.get('/dashboard.html', (req, res) => res.redirect('/console.html'));`(及其上方注释)。**保留** `app.get('/', (req, res) => res.redirect('/console.html'));`(hub 入口仍直达控制台)。删除后 `dashboard.html` 由 `express.static` 直服。

- [ ] **Step 3.4: 运行,确认通过**

Run: `node --test test/hub-server.test.cjs`
Expected: PASS

- [ ] **Step 3.5: 提交**

```bash
git add hub/server.cjs test/hub-server.test.cjs
git commit -m "fix: 移除 hub /dashboard.html 重定向,恢复独立多机看板(bug 3 根治)"
```

---

## Task 4: `dashboard.html` 双模式 + 看板卡片网格(P0/P1-2/P0-2/P2-3/P2-5)

**Files:**
- Modify: `public/dashboard.html`
- Modify: `public/dashboard.js`
- Modify: `public/dashboard.css`
- Create: `test/dashboard-dual-mode.test.cjs`

**背景:** `dashboard.html` 探测 `/api/global-dashboard`:200→hub(卡片网格 `board_render`,poll 2s,卡片 click-to-navigate 跳 console);404→单机(session-list 原样)。hub topbar 显 fleet 摘要 + board-stale;hub title 带 fleet 数;unknown 点对比度修。

- [ ] **Step 4.1: 写 `test/dashboard-dual-mode.test.cjs`(探测分发逻辑)**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

test('dashboard.html 双模式:加载 board_render(hub)+ dashboard_render(单机)', () => {
  assert.match(html, /board_render\.cjs/);
  assert.match(html, /dashboard_render\.cjs/);
});
test('dashboard.html hub 模式卡片网格挂点 + fleet 摘要 + board-stale', () => {
  assert.match(html, /id="board-body"/);
  assert.match(html, /id="fleet-summary"/);
  assert.match(html, /board-stale/);
});
test('dashboard.html 底部 tab 含切换(aria-haspopup)', () => {
  assert.match(html, /aria-haspopup="dialog"/);
});
test('dashboard.js 探测 global-dashboard 分发 hub/单机', () => {
  assert.match(js, /\/api\/global-dashboard/);
  assert.match(js, /404|status\s*===\s*404/);  // 404 → 单机 fallback
});
test('dashboard.js hub 卡片跳控制台(click-to-navigate)', () => {
  assert.match(js, /\/console\.html\?m=/);
});
test('dashboard.js hub title 带 fleet 数', () => {
  assert.match(js, /多机|fleet|online/);
});
```

- [ ] **Step 4.2: 运行,确认失败**

Run: `node --test test/dashboard-dual-mode.test.cjs`
Expected: FAIL(dashboard.html 尚无 board-body/fleet-summary;dashboard.js 无探测)

- [ ] **Step 4.3: 改 `public/dashboard.html`(双模式挂点)**

先 Read 当前 `dashboard.html` 全文(46 行)。在 `<header class="logo">` 后加 hub fleet 摘要 + board-stale;`<main>` 内加 hub 卡片网格容器(与单机 sessionList 共存,dashboard.js 显隐分发);底部 tab 切换跳 hub 控制台。修改后关键结构:

```html
        <header class="header">
            <div class="logo">
                <img class="app-logo" src="logo.png" alt="Roc-CC" width="24" height="24" onerror="this.hidden=true;">
                <span id="title">CC 看板</span>
            </div>
            <div id="fleet-summary" class="fleet-summary" aria-live="polite" hidden></div>
            <span id="board-stale" class="board-stale" aria-live="polite" hidden></span>
        </header>
        <main class="main">
            <h1 class="visually-hidden">CC 看板</h1>
            <!-- 单机模式:session-list(dashboard_render 渲染) -->
            <ul id="sessionList" class="session-list" aria-label="会话列表"></ul>
            <!-- hub 模式:卡片网格(board_render 渲染) -->
            <ul id="board-body" class="board-grid" aria-label="机器会话看板" hidden></ul>
            <div id="stateMessage" class="state-message" hidden></div>
        </main>

        <nav class="bottom-tabbar" aria-label="主导航">
            <a class="tab" id="tab-console" href="/"><span class="tab-icon" aria-hidden="true">▤</span><span class="tab-label">控制台</span></a>
            <a class="tab tab--active" href="/dashboard.html" aria-current="page"><span class="tab-icon" aria-hidden="true">◫</span><span class="tab-label">看板</span></a>
            <button class="tab" type="button" id="switchTab" aria-haspopup="dialog" aria-expanded="false"><span class="tab-icon" aria-hidden="true">⇄</span><span class="tab-label">切换</span></button>
        </nav>
```

切换 tab 内联脚本改为双模式跳转 + 加载 board_render:

```html
    <script>
        // 看板页「切换」tab:写跨页标志后跳控制台(hub→/console.html,单机→/),由控制台 init 检测开抽屉
        document.getElementById('switchTab').addEventListener('click', function () {
            sessionStorage.setItem('openSwitchSheet', '1');
            var isHubMode = document.getElementById('board-body') && !document.getElementById('board-body').hidden;
            window.location.href = isHubMode ? '/console.html' : '/';
        });
    </script>
    <script src="board_render.cjs"></script>
    <script src="dashboard_render.cjs"></script>
    <script src="dashboard.js"></script>
```

- [ ] **Step 4.4: 改 `public/dashboard.js`(双模式探测 + hub 卡片 + 跳转 + stale + title)**

先 Read 当前 `dashboard.js`(91 行)确认 IIFE 结构与 `loop()`/`poll`/`render`/`setTitle`/`showState` 名字。在 IIFE 内、与单机 `loop()` 并列插入 hub 分支(用 `window.BoardRender`):

```js
    // ---- 双模式探测:hub(global-dashboard 200)→ 卡片网格;否则单机 session-list ----
    var BR = window.BoardRender;
    var boardBody = document.getElementById('board-body');
    var fleetSummary = document.getElementById('fleet-summary');
    var boardStale = document.getElementById('board-stale');
    var prevKeys = new Set();
    var pollFailCount = 0;
    var lastPollOkTs = 0;

    function flattenCards(payload) {
        var cards = [];
        for (var i = 0; i < (payload.machines || []).length; i++) {
            var m = payload.machines[i];
            var online = m.online !== false;
            for (var j = 0; j < (m.sessions || []).length; j++) {
                var s = m.sessions[j];
                cards.push({
                    machine: m,
                    session: { name: s.name, status: online ? (s.status || 'unknown') : 'offline', lastLine: s.lastLine || '' },
                    key: m.id + '/' + s.name, name: m.name || m.id, lastTs: s.lastTs || 0
                });
            }
        }
        return cards;
    }
    function renderFleetSummary(machines) {
        var s = BR.summarizeFleet(machines);
        fleetSummary.innerHTML =
            '<span><span class="s-icon" aria-hidden="true">▶</span> ' + s.working + '</span>' +
            '<span><span class="s-icon" aria-hidden="true">⏸</span> ' + s.idle + '</span>' +
            '<span><span class="s-icon" aria-hidden="true">✕</span> ' + s.errored + '</span>' +
            '<span>在线 ' + s.online + '/' + s.total + '</span>';
        var t = '(' + s.online + ') CC 看板 · 多机';
        document.title = t;
        var titleEl2 = document.getElementById('title'); if (titleEl2) titleEl2.textContent = t;
    }
    function renderBoard(payload) {
        var sorted = BR.sortCardsErroredFirst(flattenCards(payload));
        if (!sorted.length) {
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
            prevKeys = new Set(); renderFleetSummary(payload.machines || []); return;
        }
        var nextKeys = sorted.map(function (c) { return c.key; });
        var diff = BR.diffCards(prevKeys, nextKeys);
        var cssEsc = function (s) { return String(s).replace(/["\\]/g, '\\$&'); };
        for (var k = 0; k < diff.removed.length; k++) {
            var n = boardBody.querySelector('[data-key="' + cssEsc(diff.removed[k]) + '"]'); if (n) n.remove();
        }
        for (var c = 0; c < sorted.length; c++) {
            var card = sorted[c];
            if (!boardBody.querySelector('[data-key="' + cssEsc(card.key) + '"]')) {
                var li = document.createElement('li');
                li.className = 'card-row'; li.dataset.key = card.key;
                li.innerHTML = BR.buildCardHTML(card.machine, card.session, { lastTs: card.lastTs, now: Date.now() })
                    .match(/<a[\s\S]*<\/a>/)[0].replace('<a', '<a'); // 取 <a> 包裹作为 li 内容
                boardBody.appendChild(li);
            }
        }
        for (var r = 0; r < sorted.length; r++) { // 重排到 errored-first 顺序
            var e = boardBody.querySelector('[data-key="' + cssEsc(sorted[r].key) + '"]'); if (e) boardBody.appendChild(e);
        }
        prevKeys = new Set(nextKeys);
        renderFleetSummary(payload.machines || []);
    }
    // 卡片 click-to-navigate 由 <a href> 原生处理(无需 JS 拦截);中键/书签均可用
    async function pollHub() {
        var ok = false;
        try {
            var res = await fetch('/api/global-dashboard');
            if (res.ok) { renderBoard(await res.json()); ok = true; }
        } catch (e) {}
        pollFailCount = ok ? 0 : pollFailCount + 1;
        if (ok) lastPollOkTs = Date.now();
        if (pollFailCount > 2 && lastPollOkTs && (Math.floor((Date.now() - lastPollOkTs) / 1000)) > 10) {
            var ago = Math.floor((Date.now() - lastPollOkTs) / 1000);
            boardStale.hidden = false; boardStale.textContent = '数据 ' + ago + 's 前';
        } else {
            boardStale.hidden = true;
        }
    }
    var hubPolling = false;
    async function hubLoop() {
        if (!hubPolling) return;
        await pollHub();
        if (hubPolling) setTimeout(hubLoop, 2000);
    }

    async function detectMode() {
        try {
            var probe = await fetch('/api/global-dashboard');
            if (probe.ok) {
                boardBody.hidden = false;
                fleetSummary.hidden = false;
                document.getElementById('sessionList').hidden = true;
                hubPolling = true; hubLoop();
                return;
            }
        } catch (e) {}
        // 404/网络 → 单机模式:跑现有 loop()
        loop();
    }
```

**改 IIFE 末尾:** 把原 `loop();`(L90)改为 `detectMode();`。原 `loop`/`poll`/`render`/`setTitle`/`showState`(单机)保留不动,作为 404 fallback。

- [ ] **Step 4.5: 改 `public/dashboard.css` —— board-stale + unknown 对比度(P0-2/P2-3)**

先 Read `dashboard.css` 确认 `.fleet-summary` 是否已存在。在合适位置追加:

```css
/* hub 看板 topbar fleet 摘要 + stale(双模式新增) */
.fleet-summary { margin-left: auto; display: flex; gap: 10px; align-items: center; color: var(--fg-2); font-size: .85em; }
.fleet-summary .s-icon { font-size: .9em; }
.board-stale { color: var(--accent-2); font-size: .8em; font-weight: 600; }
.board-stale[hidden] { display: none; }
/* unknown 描边达 SC 1.4.11 非文字 3:1(原 --fg-3 约 1.5:1) */
.s-dot--unknown { box-shadow: 0 0 0 1.5px var(--fg-2); }
```

- [ ] **Step 4.6: 运行测试,确认通过**

Run: `node --test test/dashboard-dual-mode.test.cjs`
Expected: PASS。再 `node --test test/dashboard.test.cjs`(若存在,确认单机测试未破坏)。

- [ ] **Step 4.7: 提交**

```bash
git add public/dashboard.html public/dashboard.js public/dashboard.css test/dashboard-dual-mode.test.cjs
git commit -m "feat: dashboard.html 双模式(hub 卡片看板 + 单机 session-list)+ board-stale + unknown 对比度"
```

---

## Task 5: `console.html` 精简(移除 board)+ 底部 tab + 抽屉挂点(P1-1/P2-6)

**Files:**
- Modify: `public/console.html`
- Modify: `test/console_html.test.cjs`

- [ ] **Step 5.1: 改 `test/console_html.test.cjs` 契约 —— console.html 无 board、有 tab/抽屉、加载 switch_sheet**

先 Read `test/console_html.test.cjs`(111 行)。替换原 L27-30「卡片网格 board-body」测试为:

```js
test('console.html 移除卡片网格(无 board-body/.console-board)', () => {
  assert.doesNotMatch(html, /id="board-body"/);
  assert.doesNotMatch(html, /class="console-board"/);
});
// 新增:底部三项 tab + 切换抽屉 trigger + 加载 switch_sheet.cjs
test('console.html 含底部三项 tab(控制台 active/看板/切换)', () => {
  assert.match(html, /class="bottom-tabbar"/);
  assert.match(html, /tab--active/);
  assert.match(html, /id="switchTab"/);
});
test('console.html 加载 switch_sheet.cjs(抽屉模态)', () => {
  assert.ok(html.indexOf('switch_sheet.cjs') > 0, '应加载 switch_sheet.cjs');
});
```

改 L9-17「脚本顺序」测试:加入 `switch_sheet.cjs` 在 `console_render.cjs` 之后、`console.js` 之前:

```js
test('加载 terminal_cleaner + console_render + switch_sheet + console.js(顺序)', () => {
  const idxTC = html.indexOf('terminal_cleaner.cjs');
  const idxCR = html.indexOf('console_render.cjs');
  const idxSS = html.indexOf('switch_sheet.cjs');
  const idxJS = html.indexOf('console.js');
  assert.ok(idxTC > 0 && idxCR > 0 && idxSS > 0 && idxJS > 0);
  assert.ok(idxTC < idxCR && idxCR < idxSS && idxSS < idxJS);
});
```

**注:** L53-55「console.js 引用 ConsoleRender 卡片函数」、L60-66「renderBoard/board-empty」、L88-91「summarizeFleet/hero-l1」、L100-102「poll stale」这些 JS 断言在 Task 6 改 console.js 后会失效 —— **本步先注释/删除这些块**(Task 6 会重写为抽屉/URL param 断言)。本步只保留 HTML 结构、终端、main-agent、广播融合相关断言。

- [ ] **Step 5.2: 运行,确认失败**

Run: `node --test test/console_html.test.cjs`
Expected: FAIL(console.html 仍有 board-body、无 tab/switch_sheet)

- [ ] **Step 5.3: 改 `public/console.html`**

先 Read `console.html` 全文。:
(a) **删除**整个 `<section class="console-board">...</section>`(含 `<ul id="board-body">`)。
(b) 在终端 section 之后、`</div><!-- /.console-app -->` 之前加底部 tab:

```html
    <!-- 底部三项 tab(控制台 active/看板/切换),与单机全局统一 -->
    <nav class="bottom-tabbar" aria-label="主导航">
      <a class="tab tab--active" href="/console.html" aria-current="page"><span class="tab-icon" aria-hidden="true">▤</span><span class="tab-label">控制台</span></a>
      <a class="tab" href="/dashboard.html"><span class="tab-icon" aria-hidden="true">◫</span><span class="tab-label">看板</span></a>
      <button class="tab" type="button" id="switchTab" aria-haspopup="dialog" aria-expanded="false"><span class="tab-icon" aria-hidden="true">⇄</span><span class="tab-label">切换</span></button>
    </nav>
```

(c) **改 script 加载顺序**:在 `console_render.cjs` 之后、`console.js` 之前加 `switch_sheet.cjs`:

```html
  <script src="terminal_cleaner.cjs"></script>
  <script src="console_render.cjs"></script>
  <script src="switch_sheet.cjs"></script>
  <script src="console.js"></script>
```

(d) topbar 的 `#fleet-summary` 保留(P1-2:控制台 topbar 改显当前机告警,复用此挂点,id 不变,内容由 console.js 改写)。

- [ ] **Step 5.4: 运行 `console_html.test.cjs` 的 HTML 部分**

Run: `node --test test/console_html.test.cjs`
Expected: HTML 结构断言 PASS;JS 断言(console.js 仍引用 ConsoleRender 卡片)此刻仍失败 —— 预期,Task 6 修复。

- [ ] **Step 5.5: 提交**

```bash
git add public/console.html test/console_html.test.cjs
git commit -m "refactor: console.html 移除卡片网格 + 底部三项 tab + 抽屉挂点"
```

---

## Task 6: `console.js` 重构 —— 移除 board + 切换抽屉 + 多选广播 + URL param(P0-1/P1-2/P1-3/P2-4)

**Files:**
- Modify: `public/console.js`(大改)
- Modify: `test/console_html.test.cjs`(JS 断言重写)
- Modify: `test/console_style.test.cjs`(抽屉 a11y)

**背景:** console.js 移除卡片网格/global-dashboard poll/fleet 摘要(归看板);保留终端 WS/main-agent/广播逻辑/全屏/折叠;新增切换抽屉(`createSwitchSheet`,`/api/machines` 按需,多选模式 → 广播)、URL `?m=&s=` 读取 + 失败兜底、跨页 `openSwitchSheet` flag、topbar 当前机告警(WS)。

- [ ] **Step 6.1: 重写 `test/console_html.test.cjs` 的 JS 断言(移除 board,加抽屉/URL/flag)**

替换原 L53-66、L88-91、L100-102 的 JS 断言为:

```js
test('console.js 不再渲染卡片(无 buildCardHTML/renderBoard/global-dashboard)', () => {
  assert.doesNotMatch(js, /ConsoleRender\.(buildCardHTML|sortCardsErroredFirst|diffCards|summarizeFleet)/);
  assert.doesNotMatch(js, /function renderBoard/);
  assert.doesNotMatch(js, /\/api\/global-dashboard/);  // 控制台不 poll 看板数据
});
test('console.js 切换抽屉:createSwitchSheet + /api/machines 按需', () => {
  assert.match(js, /createSwitchSheet/);
  assert.match(js, /\/api\/machines/);
  assert.match(js, /backdropRoot:\s*['"].console-app['"]/);  // hub 根
});
test('console.js 多选广播(抽屉 selected.size >= 2 扇出)', () => {
  assert.match(js, /selected\.size/);
  assert.match(js, /type:\s*['"]broadcast['"]/);
  assert.match(js, /多选|multiSelect/);  // 多选模式开关
});
test('console.js URL ?m=&s= 读取自动 attach', () => {
  assert.match(js, /URLSearchParams/);
  assert.match(js, /['"]m['"]/);
  assert.match(js, /['"]s['"]/);
});
test('console.js 跨页 openSwitchSheet flag 检测开抽屉', () => {
  assert.match(js, /openSwitchSheet/);
  assert.match(js, /sessionStorage/);
});
test('console.js 保留终端/main-agent(ensureWs / main-agent poll / parseCallout / nextBackoff)', () => {
  assert.match(js, /function ensureWs/);
  assert.match(js, /\/api\/main-agent\/status/);
  assert.match(js, /parseCallout/);
  assert.match(js, /nextBackoff/);
});
```
保留 WS 重连/断线/广播融合/refreshBroadcast、ma-toggle、visualViewport/折叠相关断言(L68-110)。

- [ ] **Step 6.2: 运行,确认失败**

Run: `node --test test/console_html.test.cjs`
Expected: FAIL(console.js 仍是旧版)

- [ ] **Step 6.3: 重构 `public/console.js`**

先 Read `console.js`(452 行)全文。

**(a) 移除(board/看板职责,迁走)**:删 `boardBody`(L22)、`prevKeys`(L143)、`flattenCards`(L145-155)、`cssEsc`(L157)、`updateCardNode`(L161-195)、`renderBoard`(L197-243)、`renderFleetSummary`(L245-252)、`renderHeroL1`(L303-320)、`boardBody` click 监听(L386-399)、`boardBody` keydown 监听(L400-416);`poll()`(L261-275)删除 global-dashboard 分支,只保留 main-agent poll;`renderMaStatus` 内移除 `renderHeroL1()` 调用(L294)。`lastBoardMachines`/`lastPayload` 删除。

**(b) 保留(终端/main-agent)**:`ensureWs`/`attachTarget`/`setTermState`/`scheduleTermReconnect`/`sendWhenOpen`/`termForm submit`(广播分支 L131-134)/`refreshBroadcast`/`selected` Set/`renderMaStatus`/`renderMaCallout`/`ensureMaWs`/`maAction`/全屏/折叠/visualViewport。

**(c) 新增(切换抽屉 + URL param + flag + topbar 告警)** —— 在 IIFE 内 `setInterval(poll, 2000); poll(); ensureWs();` 之前插入:

```js
  // ---- 切换抽屉(createSwitchSheet,数据 /api/machines 按需,多选 → 广播)----
  const switchTab = document.getElementById('switchTab');
  let switchSheet = null;
  let multiSelectMode = false;

  async function openSwitchSheet() {
    if (!window.SwitchSheet || !switchTab) return;
    let machines = [];
    try { const r = await fetch('/api/machines'); if (r.ok) machines = (await r.json()).machines || []; } catch {}
    // 扁平化 machine/session
    const items = [];
    for (const m of machines) {
      const online = m.online !== false;
      for (const s of (m.sessions || [])) {
        items.push({
          machine: m.id, session: s.name,
          label: `${m.name || m.id} / ${s.name}${online ? '' : ' · 离线'}`,
          key: `${m.id}/${s.name}`,
        });
      }
    }
    if (!switchSheet) {
      switchSheet = window.SwitchSheet.createSwitchSheet({
        trigger: switchTab,
        backdropRoot: '.console-app',
        // 不用 onPick:交互全在 renderMachineItems 内(支持多选不关闭)
      });
    }
    renderMachineItems(items);
    switchSheet.open();
    switchTab.setAttribute('aria-expanded', 'true');
  }

  // 渲染机器项到 sheet(单选 attach+关 / 多选 toggle selected);每次 toggle 重建列表刷新选中态
  function renderMachineItems(items) {
    const sheetEl = document.getElementById('switchSheet'); // createSwitchSheet 注入的根元素
    if (!sheetEl) return;
    const old = sheetEl.querySelector('.switch-sheet-machines'); if (old) old.remove();
    const oldToggle = sheetEl.querySelector('.switch-sheet-multitoggle'); if (oldToggle) oldToggle.remove();
    const wrap = document.createElement('div'); wrap.className = 'switch-sheet-machines';
    const title = document.createElement('p'); title.className = 'switch-sheet-section-title';
    title.textContent = multiSelectMode ? `机器(已选 ${selected.size} · 扇出)` : '机器';
    wrap.appendChild(title);
    const list = document.createElement('ul'); list.className = 'switch-sheet-list'; list.setAttribute('role', 'list');
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'switch-sheet-projects-empty';
      empty.textContent = '暂无机器'; wrap.appendChild(empty);
    } else {
      items.forEach((it) => {
        const isSel = selected.has(it.key);
        const li = document.createElement('li'); li.className = 'switch-sheet-item';
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'switch-sheet-btn';
        btn.setAttribute('aria-pressed', String(isSel));
        btn.textContent = (multiSelectMode ? (isSel ? '☑ ' : '☐ ') : '') + it.label;
        btn.addEventListener('click', () => {
          if (multiSelectMode) {
            selected.has(it.key) ? selected.delete(it.key) : selected.add(it.key);
            refreshBroadcast();
            renderMachineItems(items); // 重建刷新选中态
            return;
          }
          attachTarget({ machine: it.machine, session: it.session });
          if (switchSheet) switchSheet.close();
        });
        li.appendChild(btn); list.appendChild(li);
      });
    }
    wrap.appendChild(list); sheetEl.appendChild(wrap);
    // 多选模式开关
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'switch-sheet-btn switch-sheet-multitoggle';
    toggle.textContent = multiSelectMode ? '✓ 多选模式(广播)' : '切多选模式';
    toggle.addEventListener('click', () => { multiSelectMode = !multiSelectMode; renderMachineItems(items); });
    sheetEl.appendChild(toggle);
  }

  if (switchTab) switchTab.addEventListener('click', openSwitchSheet);

  // ---- URL ?m=&s= 读取 + 失败兜底 ----
  const params = new URLSearchParams(location.search);
  const urlM = params.get('m'), urlS = params.get('s');
  function tryAttachFromUrl() {
    if (!urlM || !urlS) return;
    fetch('/api/machines').then((r) => r.ok ? r.json() : { machines: [] }).then((d) => {
      const found = (d.machines || []).some((m) => m.id === urlM && (m.sessions || []).some((s) => s.name === urlS));
      if (found) attachTarget({ machine: urlM, session: urlS });
      else {
        termScreen.textContent = `机器 ${urlM} 未注册或会话 ${urlS} 不存在。点底部「切换」选择机器。`;
        setTermState('disconnected');
      }
    }).catch(() => { /* 网络失败:静默,WS 后续重试 */ });
  }

  // ---- 跨页 openSwitchSheet flag(看板「切换」tab 写入)----
  if (sessionStorage.getItem('openSwitchSheet') === '1') {
    sessionStorage.removeItem('openSwitchSheet');
    setTimeout(openSwitchSheet, 300); // 等 createSwitchSheet 可用
  }

  // ---- topbar 当前机告警(替代旧 fleet 摘要;复用 #fleet-summary 挂点)----
  function renderTopbarAlert() {
    if (!fleetSummary) return;
    if (!currentTarget) { fleetSummary.innerHTML = '<span>未选机器</span>'; return; }
    fleetSummary.innerHTML = `<span>${currentTarget.machine} / ${currentTarget.session}</span>`;
  }
```

**(d) 接线:** 在 `attachTarget`(原 L118-125)末尾加 `renderTopbarAlert();`;在 `setTermState` 的 disconnected/live 分支加 `renderTopbarAlert();`。`poll()` 简化后只调 `renderMaStatus()`(无 `renderHeroL1`)。把 `fleetSummary`/`currentTarget` 作为 IIFE 内变量(`currentTarget` 已存在于 attachTarget,确认其名;`fleetSummary = document.getElementById('fleet-summary')`)。

**(e) 入口:** 末尾 `setInterval(poll, 2000); poll(); ensureWs();` 后加 `tryAttachFromUrl(); renderTopbarAlert();`。

> **实现注意(给执行者):**
> - `renderMachineItems` 多选 toggle 后 **必须** `renderMachineItems(items)` 重建(刷新 ☐/☑ 与 aria-pressed),勿用陈旧闭包。
> - `createSwitchSheet` 的 `onPick` 契约:不用于多选(多选全在 `renderMachineItems` 内,单选走显式 `switchSheet.close()`)。若 `createSwitchSheet` 要求 `onPick`,传一个空实现或单选 attach。
> - `createSwitchSheet` 注入的根元素 id:先 Read `switch_sheet.cjs` 确认其创建的容器 id/选择器(可能不是 `switchSheet`),`renderMachineItems` 用实际选择器定位。若 id 为 `switchSheet` 则照用;否则改。
> - `currentTarget` 是 attachTarget 设置的当前 attach 目标对象(含 machine/session),执行时确认变量名。

- [ ] **Step 6.4: 改 `test/console_style.test.cjs` —— 抽屉 a11y(触摸目标/对比度/reduced-motion)**

先 Read `test/console_style.test.cjs` 确认 css/html/switchSheetSrc 读取变量。新增/确保断言:

```js
test('切换抽屉 trigger 44pt 触摸目标 + aria-haspopup', () => {
  assert.match(html, /id="switchTab"[^>]*aria-haspopup="dialog"/);
  assert.match(css, /\.tab\b[\s\S]*?min-height:\s*44/);  // 复用 .tab 44pt
});
test('switch-sheet a11y:role=dialog + aria-modal + inert 背景', () => {
  assert.match(switchSheetSrc, /role="dialog"/);
  assert.match(switchSheetSrc, /aria-modal="true"/);
  assert.match(switchSheetSrc, /setAttribute\(['"]inert['"]/);
});
test('switch-sheet 焦点陷阱 + Esc/Ctrl-C 关闭 + focus return', () => {
  assert.match(switchSheetSrc, /handleTabTrap/);
  assert.match(switchSheetSrc, /shouldCloseOnKey/);
  assert.match(switchSheetSrc, /lastFocused\.focus/);
});
```
(`switchSheetSrc` = `fs.readFileSync('public/switch_sheet.cjs')`;沿用文件已有的读取变量。)

- [ ] **Step 6.5: 运行测试,确认通过**

Run: `node --test test/console_html.test.cjs test/console_style.test.cjs`
Expected: PASS

- [ ] **Step 6.6: 提交**

```bash
git add public/console.js test/console_html.test.cjs test/console_style.test.cjs
git commit -m "feat: console.js 移除卡片网格 + 切换抽屉(多选广播)+ URL param + 跨页 flag + topbar 告警"
```

---

## Task 7: 全量回归 + 收尾

**Files:** 无新增(验证)

- [ ] **Step 7.1: 全量测试绿**

Run: `node --test test/*.test.cjs`
Expected: 全 PASS。若有偶发失败(如 `hub-server-main-agent.test.cjs` 的 cleanup_probe_failed),单独重跑确认偶发:`node --test test/hub-server-main-agent.test.cjs`。

- [ ] **Step 7.2: 手动验证(启动 hub,双页分离)**

```bash
# 启动 hub(需 CC_WEB_HUB_TOKEN;由用户启动或 ! 前缀)
node hub/server.cjs
```
浏览器打开 `http://127.0.0.1:7685/dashboard.html`(看板:卡片网格 + fleet 摘要)+ `http://127.0.0.1:7685/console.html`(控制台:main-agent + 终端 + 抽屉)。验证:
- 看板卡片点击 → 跳 `/console.html?m=&s=` 并自动 attach
- 控制台「切换」tab → 抽屉弹出(模态/backdrop/Esc)
- 抽屉「多选模式」→ 选 ≥2 → 终端 Enter 扇出广播
- 看板「切换」tab → 跳控制台并自动开抽屉
- 终端全屏/折叠仍正常(Task 5 保留)
- 单机 `node server.cjs`(7684)看板/控制台不受影响

- [ ] **Step 7.3: 提交残留(若工作区仍有未入库改动)**

```bash
git status   # 确认无残留;若有,按文件归类提交
```

- [ ] **Step 7.4: PR(可选,用户指示时)**

```bash
git push -u origin feat/console-fleet-dashboard
gh pr create --title "feat: 控制台与看板功能分离(hub 双页 + 全局 tab 统一)" --body "$(cat <<'EOF'
## 变更
- hub 看板(/dashboard.html 卡片网格)与控制台(/console.html main-agent+终端)分离
- 底部三项 tab(控制台/看板/切换)单机/hub 全局统一
- board_render.cjs 抽取(卡片纯模块,看板消费)
- dashboard.html 双模式(global-dashboard 探测:hub 卡片 / 单机 session-list)
- 移除 hub /dashboard.html 重定向(bug 3 根治)
- 切换抽屉复用 createSwitchSheet(模态)+ 多选广播
- P2:board-stale、unknown 对比度、双模式 title、?m= 兜底

## 测试
- node --test test/*.test.cjs 全绿
- 手动:hub 双页跳转/抽屉多选广播/单机不受影响

## Spec
docs/superpowers/specs/2026-07-04-console-dashboard-separation-design.md
EOF
)"
```
（PR body 不加 Generated 署名 —— 全局禁用。）

---

## Self-Review

**1. Spec 覆盖:**
- §3.1 两页职责 → Task 4(看板)+ Task 5/6(控制台)✓
- §3.2 切换抽屉(复用 createSwitchSheet,backdropRoot) → Task 2 + Task 6 ✓
- §3.3 卡片跳转 + 兜底 → Task 4(click-to-navigate)+ Task 6(`?m=` 兜底)✓
- §3.4 广播/多选/跨页 flag → Task 6 ✓
- §4.1 board_render 删 select → Task 1 ✓
- §4.2 dashboard.html 双模式 → Task 4 ✓
- §4.3 console.html 精简 → Task 5 ✓
- §6 数据流 → Task 4(看板 poll)+ Task 6(控制台零 poll / 抽屉 /api/machines)✓
- §7 hub 路由反转 → Task 3 ✓
- §8 错误处理(board-stale/兜底/unknown/title) → Task 4 + Task 6 ✓
- §9 测试策略 → Task 1/3/4/5/6 + Task 7 全量 ✓

**2. 占位符扫描:** 无 TBD/TODO;每个 code step 都有完整代码或精确「移除 X 行/新增 Y」指令。

**3. 类型/命名一致性:** `board_render.cjs` 导出 `{ statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards }` —— Task 1 测试与 Task 4 `dashboard.js`(BR.*)调用一致。`createSwitchSheet({ backdropRoot: '.console-app' })` —— Task 2 参数化与 Task 6 调用一致。`selected` Set 在 Task 6 抽屉多选与广播分支一致。

**4. 已知风险(执行者注意):**
- Task 6 Step 6.3 的 `renderMachineItems` 多选闭包:`isSel` 通过「toggle 后重建列表」刷新,执行时务必每次 toggle 都 `renderMachineItems(items)`,勿用陈旧闭包。
- `createSwitchSheet` 注入的根元素 id/选择器:执行时先 Read `switch_sheet.cjs` 确认,`renderMachineItems` 用实际选择器定位(计划假设 id=`switchSheet`,需核实)。
- Task 4 `dashboard.js` 探测时序:首次 `detectMode()` 期间显示 loading(现有 stateMessage),避免空屏;执行时确认 sessionList/boardBody 初始 hidden 态正确。
- Task 1 Step 1.7:`console_html.test.cjs` 在 Task 1 后会暂时失败(console.js 仍引用已删的 ConsoleRender 卡片函数)—— 预期中间态,Task 5/6 修复。**勿在 Task 1 强求全量绿。**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-04-console-dashboard-separation.md`. Two execution options:

**1. Subagent-Driven(推荐)** — 每个 Task 派一个 fresh subagent,任务间两阶段评审(spec 合规 + 代码质量),快速迭代。

**2. Inline Execution** — 本会话内按 executing-plans 批量执行 + 检查点。

Which approach?
