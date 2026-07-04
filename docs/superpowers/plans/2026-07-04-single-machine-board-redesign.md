# 单机多会话 看板重设计 Implementation Plan (Plan 1: 看板)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 :7685 看板(Fleet Dashboard)在「单机多会话」真实场景下呈现饱满专业 —— 会话名当主标题、lastLine 净化、时间分级、陈旧会话折叠、fleet summary 会话维度。

**Architecture:** 纯函数层(`terminal_cleaner.cjs` / `board_render.cjs`)先行 TDD,`dashboard.js`/`dashboard.css` 消费纯函数。单机判定 = 不同 `machine.id ≤ 1`。陈旧 = `waiting && lastTs > 24h`。多机维持现状 + 通用改进。

**Tech Stack:** 原生 JS + UMD 模块(`.cjs` dual-load 浏览器/node)、`node --test`、无框架、token 化 CSS。

**Spec:** `docs/superpowers/specs/2026-07-04-single-machine-board-redesign-design.md`(用户已确认)

**范围说明:** 本 plan = spec 的 §4-A(纯函数)+ §4-B(看板渲染)。spec §4-C(控制台 HERO)+ §4-D(抽屉)是 **Plan 2**(需先探索 `console.js`)。

**分支与提交策略:** 执行前**先建分支**(`git checkout -b feat/single-machine-board-redesign`,用户在 main)。每个 Task 末 commit 到该分支。是否 push/PR 由用户定。

**测试命令:** `node --test test/terminal_cleaner.test.cjs`(单文件,同步,严禁 run_in_background);全量 `node --test test/*.test.cjs`。现有 506 测试须保持绿。

---

## File Structure

| 文件 | 责任 | 本 plan 改动 |
|---|---|---|
| `public/terminal_cleaner.cjs` | 终端输出净化(cleanOutput) | **新增** `cleanSummary`(去 markdown + 截断) |
| `public/board_render.cjs` | 看板卡片纯函数 | `relativeTime` 加档 / 接入 TC / `isStale`+`partitionStale` / `sortCardsByRelevance` / `buildCardInner` 单机感知 / `flattenFleet` 透传 cwd |
| `public/console_render.cjs` | 控制台纯函数 | `relativeTime` 加档(与 board_render 同步) |
| `public/dashboard.html` | 看板页 | 加 `<script src="terminal_cleaner.cjs">` |
| `public/dashboard.js` | 看板渲染胶水 | `renderBoard` 单机判定 + 陈旧折叠;`renderFleetSummary` 会话维度 |
| `public/dashboard.css` | 看板样式 | `.card--single` / `.board-stale-group` / fleet summary 提权 |
| `test/terminal_cleaner.test.cjs` | cleanOutput 测试 | 加 cleanSummary 用例 |
| `test/board_render.test.cjs` | board_render 契约 | 更新 relativeTime / sortCards 改名 / 加 isStale/partitionStale/singleMachine/cleanSummary 用例 |
| `test/console_render.test.cjs` | console_render 契约 | 加 direct relativeTime 天档用例 |
| `test/console_style.test.cjs` | CSS/markup 契约 | 加 `.board-stale-group` / `.card--single` 契约 |

---

## Task 1: `cleanSummary` 纯函数(terminal_cleaner.cjs)

**Files:**
- Modify: `public/terminal_cleaner.cjs`
- Test: `test/terminal_cleaner.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/terminal_cleaner.test.cjs` 末尾:

```js
const { cleanSummary } = require('../public/terminal_cleaner.cjs');

test('cleanSummary: 去 markdown 标记(## 标题 / **粗** / `行内码`)', () => {
  assert.equal(cleanSummary('## 收尾完成 ✅ `memory → harness-memory`'), '收尾完成 ✅ memory → harness-memory');
  assert.equal(cleanSummary('全部测试通过(**73/73 绿**)'), '全部测试通过(73/73 绿)');
});

test('cleanSummary: 去列表符 / 引用 / 折叠空白', () => {
  assert.equal(cleanSummary('- 列表项'), '列表项');
  assert.equal(cleanSummary('> 引用文本'), '引用文本');
  assert.equal(cleanSummary('a   b\n\nc'), 'a b c');
});

test('cleanSummary: 截断 maxLen + 省略号(默认 60)', () => {
  assert.equal(cleanSummary('a'.repeat(100), 10), 'aaaaaaaaaa…');
  assert.equal(cleanSummary('a'.repeat(10), 60), 'aaaaaaaaaa'); // 未超不截
});

test('cleanSummary: null/undefined/非串 → 空串; ANSI 残留净化', () => {
  assert.equal(cleanSummary(null), '');
  assert.equal(cleanSummary(undefined), '');
  assert.equal(cleanSummary('\x1b[31mError: boom\x1b[0m'), 'Error: boom');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/terminal_cleaner.test.cjs`
Expected: FAIL — `cleanSummary is not a function`(尚未导出)

- [ ] **Step 3: Write minimal implementation**

在 `public/terminal_cleaner.cjs` 的 `cleanOutput` 函数后、`return` 前新增:

```js
  function cleanSummary(raw, maxLen) {
    if (raw == null) return '';
    const max = (typeof maxLen === 'number' && maxLen > 0) ? maxLen : 60;
    let s = cleanOutput(String(raw));
    // 去 markdown 行内/行首标记(保留文字内容)
    s = s
      .replace(/^#{1,6}\s+/gm, '')          // ## / ### 标题前缀
      .replace(/^\s{0,3}[-*+]\s+/gm, '')    // - * + 列表符
      .replace(/^\s{0,3}>\s?/gm, '')        // > 引用
      .replace(/\*\*(.+?)\*\*/g, '$1')      // **粗体**
      .replace(/__(.+?)__/g, '$1')          // __粗体__
      .replace(/`([^`]+)`/g, '$1');         // `行内码`
    // 折叠连续空白(含换行)为单空格
    s = s.replace(/\s+/g, ' ').trim();
    // 截断 + 省略号
    if (s.length > max) s = s.slice(0, max).trimEnd() + '…';
    return s;
  }
```

修改文件末尾的 return:

```js
  return { cleanOutput, cleanSummary };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/terminal_cleaner.test.cjs`
Expected: PASS(全部用例绿)

- [ ] **Step 5: Commit**

```bash
git add public/terminal_cleaner.cjs test/terminal_cleaner.test.cjs
git commit -m "feat(cleaner): 新增 cleanSummary 去 markdown 标记 + 截断"
```

---

## Task 2: `relativeTime` 加天/周/月档(board_render.cjs)

**Files:**
- Modify: `public/board_render.cjs:35-43`
- Test: `test/board_render.test.cjs:24-31`

- [ ] **Step 1: Write the failing test**

替换 `test/board_render.test.cjs` 的 `relativeTime` 测试(L24-31)为:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `3d 前` 等天档用例失败(现 `≥1h 一律 "Nh 前"`)

- [ ] **Step 3: Write minimal implementation**

替换 `public/board_render.cjs:35-43` 的 `relativeTime`:

```js
  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h 前`;        // <24h
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d 前`;      // <7d
    if (diff < 2592000000) return `${Math.floor(diff / 604800000)}w 前`;    // <30d
    return `${Math.floor(diff / 2592000000)}个月前`;                        // ≥30d
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/board_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/board_render.cjs test/board_render.test.cjs
git commit -m "feat(board): relativeTime 加天/周/月档(告别 633h 前)"
```

---

## Task 3: `relativeTime` 同步(console_render.cjs)

**Files:**
- Modify: `public/console_render.cjs:19-27`
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/console_render.test.cjs` 末尾(console_render 目前无 direct relativeTime 测试):

```js
test('relativeTime: 秒/分/时/天/周/月档 + 无 ts 空串', () => {
  const now = 1000000;
  assert.equal(R.relativeTime(now - 30000, now), '30s 前');
  assert.equal(R.relativeTime(now - 7200000, now), '2h 前');
  assert.equal(R.relativeTime(now - 3 * 86400000, now), '3d 前');
  assert.equal(R.relativeTime(now - 14 * 86400000, now), '2w 前');
  assert.equal(R.relativeTime(now - 60 * 86400000, now), '2个月前');
  assert.equal(R.relativeTime(0, now), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — 天档用例失败(console_render relativeTime 仍是旧实现)

- [ ] **Step 3: Write minimal implementation**

替换 `public/console_render.cjs:19-27` 的 `relativeTime`(与 Task 2 完全一致):

```js
  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h 前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d 前`;
    if (diff < 2592000000) return `${Math.floor(diff / 604800000)}w 前`;
    return `${Math.floor(diff / 2592000000)}个月前`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/console_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): relativeTime 同步天/周/月档(与 board_render 一致)"
```

---

## Task 4: board_render 接入 TerminalCleaner + lastLine 净化

**Files:**
- Modify: `public/board_render.cjs`(UMD factory 签名 + buildCardInner)
- Modify: `public/dashboard.html:49`(加 script)
- Test: `test/board_render.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/board_render.test.cjs`:

```js
test('buildCardInner lastLine 经 cleanSummary:markdown 标记剥离', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'M1', online: true },
    { name: 's1', status: 'idle', lastLine: '## 收尾 ✅ `mem`' },
    {}
  );
  assert.match(html, /<span class="card__last">收尾 ✅ mem<\/span>/);
  assert.doesNotMatch(html, /card__last[^<]*##/); // 不残留 ## 标记
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `card__last` 仍含 `## 收尾 ✅ \`mem\``(未净化)

- [ ] **Step 3: Write minimal implementation**

3a. 改 `public/board_render.cjs` 顶部 UMD(对齐 console_render.cjs 写法,注入 TC):

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./terminal_cleaner.cjs'));
  } else {
    root.BoardRender = factory(root.TerminalCleaner || { cleanSummary: function (s) { return s; } });
  }
})(typeof window !== 'undefined' ? window : globalThis, function (TC) {
  'use strict';
```

3b. 改 `buildCardInner` 的 lastLine 行(原 L57-58):

```js
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(TC.cleanSummary ? TC.cleanSummary(lastRaw, 60) : lastRaw);
```

3c. 改 `public/dashboard.html`,在 `board_render.cjs` 之前加(原 L49 前插一行):

```html
    <script src="terminal_cleaner.cjs"></script>
    <script src="board_render.cjs"></script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/board_render.test.cjs`
Expected: PASS(含原有 XSS/escapeHtml 用例 —— factory 注入不影响,因测试经 require 走 module.exports 分支)

- [ ] **Step 5: Commit**

```bash
git add public/board_render.cjs public/dashboard.html test/board_render.test.cjs
git commit -m "feat(board): buildCardInner lastLine 经 cleanSummary 净化 markdown"
```

---

## Task 5: `isStale` + `partitionStale` 纯函数

**Files:**
- Modify: `public/board_render.cjs`
- Test: `test/board_render.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/board_render.test.cjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `B.isStale is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `public/board_render.cjs` 的 `STATUS_RANK` 定义前(原 L106 前)新增:

```js
  const STALE_MS = 24 * 60 * 60 * 1000; // 24h
  function isStale(card, now) {
    if (!card || card.status !== 'waiting') return false;
    if (!card.lastTs) return false;
    const n = now || Date.now();
    return (n - card.lastTs) > STALE_MS;
  }
  function partitionStale(cards, now) {
    const active = [], stale = [];
    for (const c of (cards || [])) {
      if (isStale(c, now)) stale.push(c); else active.push(c);
    }
    return { active: active, stale: stale };
  }
```

在 `return { ... }` 中加入导出(原 L138):

```js
  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, buildCardInner, flattenFleet, sortCardsErroredFirst, summarizeFleet, diffCards, isStale, partitionStale };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/board_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/board_render.cjs test/board_render.test.cjs
git commit -m "feat(board): 新增 isStale + partitionStale 纯函数(陈旧会话判定)"
```

---

## Task 6: `sortCardsByRelevance`(陈旧降权 + 时间二级排序)

**Files:**
- Modify: `public/board_render.cjs:106-114`
- Modify: `public/dashboard.js:136`
- Test: `test/board_render.test.cjs:78-89`

- [ ] **Step 1: Write the failing test**

替换 `test/board_render.test.cjs` 的两个 sortCards 测试(L78-89,原 `sortCardsErroredFirst`)为:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `B.sortCardsByRelevance is not a function`

- [ ] **Step 3: Write minimal implementation**

3a. 替换 `public/board_render.cjs:106-114`(`STATUS_RANK` + `sortCardsErroredFirst`)为:

```js
  const STATUS_RANK = { errored: 0, working: 1, waiting: 2, idle: 3, unknown: 4, offline: 5 };
  function rankOf(card, now) {
    if (!card) return 4;
    const base = STATUS_RANK[card.status];
    if (base == null) return 4;
    if (isStale(card, now)) return 4.5; // 陈旧 waiting 降到 unknown 之后
    return base;
  }
  function sortCardsByRelevance(cards, now) {
    return [...(cards || [])].sort((a, b) => {
      const ra = rankOf(a, now), rb = rankOf(b, now);
      if (ra !== rb) return ra - rb;
      const ta = (a && a.lastTs) || 0, tb = (b && b.lastTs) || 0;
      return tb - ta; // 同级:新→旧(lastTs 降序)
    });
  }
```

3b. 在 `return { ... }` 中将 `sortCardsErroredFirst` 改为 `sortCardsByRelevance`(最终 return 行):

```js
  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, buildCardInner, flattenFleet, sortCardsByRelevance, summarizeFleet, diffCards, isStale, partitionStale };
```

3c. 改 `public/dashboard.js:136` 调用方:

```js
        var sorted = BR.sortCardsByRelevance(BR.flattenFleet(payload.machines || []));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/board_render.test.cjs`
Expected: PASS

全量回归: `node --test test/*.test.cjs` —— 确认无其他文件引用旧名 `sortCardsErroredFirst`(若有,本步会暴露)。

- [ ] **Step 5: Commit**

```bash
git add public/board_render.cjs public/dashboard.js test/board_render.test.cjs
git commit -m "feat(board): sortCardsByRelevance 陈旧降权 + 同级按时间排序"
```

---

## Task 7: `buildCardInner` 单机感知 + `flattenFleet` 透传 cwd

**Files:**
- Modify: `public/board_render.cjs`(buildCardInner + flattenFleet)
- Test: `test/board_render.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/board_render.test.cjs`:

```js
test('buildCardInner singleMachine:true → card__name=会话名 + card--single class', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac-pro', online: true },
    { name: 'cc-web-control', status: 'working', cwd: '~/ws/cc-web-control' },
    { singleMachine: true }
  );
  assert.match(html, /class="card card--single"/);
  assert.match(html, /<span class="card__name">cc-web-control<\/span>/); // 会话名当主标题
  assert.match(html, /<span class="card__session">~\/ws\/cc-web-control<\/span>/); // cwd 副行
  assert.match(html, /data-machine="m1"/); // 导航属性保留
});

test('buildCardInner 默认(多机)→ card__name=机器名(现状不变)', () => {
  const html = B.buildCardInner(
    { id: 'm1', name: 'mac-pro', online: true },
    { name: 'cc-web-control', status: 'working' },
    {}
  );
  assert.match(html, /class="card"/); // 无 card--single
  assert.match(html, /<span class="card__name">mac-pro<\/span>/);
  assert.match(html, /<span class="card__session">cc-web-control<\/span>/);
});

test('flattenFleet 透传 session.cwd', () => {
  const cards = B.flattenFleet([{ id: 'm1', name: 'm', online: true, sessions: [{ name: 's', status: 'idle', cwd: '/proj' }] }]);
  assert.equal(cards[0].session.cwd, '/proj');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `singleMachine` 未实现 / `session.cwd` undefined

- [ ] **Step 3: Write minimal implementation**

3a. 改 `public/board_render.cjs` 的 `buildCardInner`(原 L47-75),在 `classes` 与各字段间加入单机感知:

```js
  function buildCardInner(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const classes = ['card'];
    if (o.active) classes.push('active');
    if (o.singleMachine) classes.push('card--single');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const mid = escapeHtml(m.id);
    // 单机:会话名当主标题,cwd 当副行;多机:机器名主标题,会话名副行(现状)
    const primaryName = o.singleMachine ? escapeHtml(s.name) : name;
    const secondary = o.singleMachine ? escapeHtml(s.cwd || '') : sess;
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(TC.cleanSummary ? TC.cleanSummary(lastRaw, 60) : lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    const label = escapeHtml(`${m.name || m.id} / ${s.name},${meta.label},${lastRaw ? lastRaw.slice(0, 40) : '无输出'}`);
    const midRaw = m.id == null ? '' : m.id;
    const sessRaw = s.name == null ? '' : s.name;
    const href = `/console.html?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
    return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" data-machine="${mid}" data-session="${sess}" data-status="${escapeHtml(s.status || 'unknown')}" aria-label="${label}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${primaryName}</span>` +
      `<span class="card__session">${secondary}</span>` +
      `<span class="card__last">${last || '—'}</span>` +
      `<span class="card__time">${time}</span>` +
      `</a>`;
  }
```

3b. 改 `flattenFleet`(原 L93-95 附近),session 对象加 `cwd`:

```js
          session: { name: s.name, status, lastLine: s.lastLine || '', cwd: s.cwd || '' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/board_render.test.cjs`
Expected: PASS(含 Task 4 的 cleanSummary 用例仍绿)

- [ ] **Step 5: Commit**

```bash
git add public/board_render.cjs test/board_render.test.cjs
git commit -m "feat(board): buildCardInner 单机感知(会话名主标题) + flattenFleet 透传 cwd"
```

---

## Task 8: `dashboard.js` renderBoard 单机判定 + 陈旧折叠 + fleet summary 会话维度

**Files:**
- Modify: `public/dashboard.js`(renderFleetSummary + renderBoard + detectMode)

> 本 task 改 DOM 胶水层。可测逻辑(isStale/partitionStale/singleMachine)已由 Task 5/7 纯函数覆盖。本 task 验证 = `node --test test/*.test.cjs` 全绿 + 浏览器手动 :7685。

- [ ] **Step 1: 改 `renderFleetSummary` 会话维度(单机)**

替换 `public/dashboard.js` 的 `renderFleetSummary`(原 L119-132)为:

```js
    function renderFleetSummary(machines, singleMachine, partition) {
        var s = BR.summarizeFleet(machines);
        fleetSummary.hidden = false;
        if (singleMachine && partition) {
            fleetSummary.innerHTML =
                '<span>' + partition.active.length + ' 活跃</span>' +
                '<span>' + partition.stale.length + ' 陈旧</span>' +
                '<span><span class="s-icon" aria-hidden="true">✕</span> ' + s.errored + ' 异常</span>';
        } else {
            fleetSummary.innerHTML =
                '<span><span class="s-icon" aria-hidden="true">▶</span> ' + s.working + '</span>' +
                '<span><span class="s-icon" aria-hidden="true">⏸</span> ' + s.idle + '</span>' +
                '<span><span class="s-icon" aria-hidden="true">✕</span> ' + s.errored + '</span>' +
                '<span>在线 ' + s.online + '/' + s.total + '</span>';
        }
        var t = '(' + s.online + ') CC 看板 · 多机';
        document.title = t;
        var titleEl2 = document.getElementById('title'); if (titleEl2) titleEl2.textContent = t;
    }
```

- [ ] **Step 2: 改 `renderBoard` 单机判定 + 陈旧折叠**

替换 `public/dashboard.js` 的 `renderBoard`(原 L133-176)为:

```js
    function buildCardLi(card, singleMachine) {
        var li = document.createElement('li');
        li.className = 'card-row'; li.dataset.key = card.key;
        li.innerHTML = BR.buildCardInner(card.machine, card.session, {
            lastTs: card.lastTs, now: Date.now(), singleMachine: singleMachine
        });
        return li;
    }
    function renderBoard(payload) {
        var machines = payload.machines || [];
        var flat = BR.flattenFleet(machines);
        var machineIds = {};
        for (var mi = 0; mi < machines.length; mi++) machineIds[machines[mi].id] = true;
        var singleMachine = Object.keys(machineIds).length <= 1;
        var sorted = BR.sortCardsByRelevance(flat);
        var partition = BR.partitionStale(sorted);
        if (!sorted.length) {
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
            cardByKey = new Map(); prevKeys = new Set();
            renderFleetSummary(machines, singleMachine, partition);
            return;
        }
        // 全量重建(单机规模无 diff 性能压力;保留 cardByKey 供 showBoardError 重置)
        boardBody.innerHTML = '';
        cardByKey = new Map();
        var renderCard = function (card) {
            var li = buildCardLi(card, singleMachine);
            cardByKey.set(card.key, li);
            return li;
        };
        for (var ai = 0; ai < partition.active.length; ai++) {
            boardBody.appendChild(renderCard(partition.active[ai]));
        }
        if (partition.stale.length) {
            var group = document.createElement('li');
            group.className = 'board-stale-group';
            var details = document.createElement('details'); // 默认 closed(折叠)
            var sum = document.createElement('summary');
            sum.textContent = partition.stale.length + ' 个陈旧会话(>24h)';
            details.appendChild(sum);
            var grid = document.createElement('ul');
            grid.className = 'board-grid board-stale-grid';
            for (var si = 0; si < partition.stale.length; si++) {
                grid.appendChild(renderCard(partition.stale[si]));
            }
            details.appendChild(grid);
            group.appendChild(details);
            boardBody.appendChild(group);
        }
        prevKeys = new Set(sorted.map(function (c) { return c.key; }));
        renderFleetSummary(machines, singleMachine, partition);
    }
```

- [ ] **Step 3: 修复 `detectMode` 的 renderFleetSummary 调用**

`public/dashboard.js` 的 `detectMode`(原 L246)调 `renderFleetSummary(data.machines || [])` —— 改为传单机判定 + partition:

```js
        var dmMachines = data.machines || [];
        var dmIds = {}; for (var i = 0; i < dmMachines.length; i++) dmIds[dmMachines[i].id] = true;
        var dmSingle = Object.keys(dmIds).length <= 1;
        renderBoard(data);
        renderFleetSummary(dmMachines, dmSingle, BR.partitionStale(BR.sortCardsByRelevance(BR.flattenFleet(dmMachines))));
```

- [ ] **Step 4: Run tests + 浏览器手动验证**

Run: `node --test test/*.test.cjs`
Expected: PASS(506 + 新增用例全绿)

浏览器手动(需登录态):
1. 打开 :7685/dashboard.html
2. 确认:卡片主标题为会话名(非 `mac-pro`)、lastLine 无 markdown 残留、时间为 `3w 前`/`6d 前` 而非 `633h 前`
3. 确认:陈旧会话折叠在「N 个陈旧会话(>24h)」`<details>` 内,默认收起
4. 确认:fleet summary 显示「N 活跃 · M 陈旧 · K 异常」

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.js
git commit -m "feat(dashboard): renderBoard 单机判定 + 陈旧折叠 + fleet summary 会话维度"
```

---

## Task 9: `dashboard.css` 单机卡片 + 陈旧折叠区 + fleet summary 提权 + 契约测试

**Files:**
- Modify: `public/dashboard.css`
- Test: `test/console_style.test.cjs`

- [ ] **Step 1: Write the failing test(CSS 契约)**

追加到 `test/console_style.test.cjs` 末尾:

```js
test('单机卡片 + 陈旧折叠区 + stale-grid CSS 契约', () => {
  assert.match(CONSOLE_SECTION, /\.card--single\b/);
  assert.match(CONSOLE_SECTION, /\.board-stale-group\b/);
  assert.match(CONSOLE_SECTION, /\.board-stale-grid\b/);
  assert.match(CONSOLE_SECTION, /\.board-stale-group[\s\S]*?grid-column:\s*1\s*\/\s*-1/); // 折叠区占整行
});
test('fleet summary 提权(字体 ≥ .9em,原 .85em)', () => {
  assert.match(CONSOLE_SECTION, /\.fleet-summary\s*\{[^}]*font-size:\s*\.9/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/console_style.test.cjs`
Expected: FAIL — `.card--single` / `.board-stale-group` 未定义

- [ ] **Step 3: Write minimal implementation**

在 `public/dashboard.css` 的 `.card__last` 规则后(原 L184 后,console 段内)追加:

```css
/* 单机卡片:会话名当主标题(字重/字号沿用 .card__name),锚点供契约测试 */
.card--single { /* 单机态标记,布局同 .card */ }

/* 陈旧会话折叠区:占整行,<details> 默认收起 */
.board-stale-group { grid-column: 1 / -1; list-style: none; margin-top: 4px; }
.board-stale-group > details > summary {
  min-height: 44px; display: flex; align-items: center; cursor: pointer;
  color: var(--fg-2); font-size: .8em; padding: 8px 12px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r);
  list-style: none;
}
.board-stale-group > details > summary::-webkit-details-marker { display: none; }
.board-stale-group > details[open] > summary { margin-bottom: 8px; }
.board-stale-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; list-style: none; padding: 0; margin: 0; }
```

修改 `.fleet-summary`(原 L144)提权字体:

```css
.fleet-summary { margin-left:auto; display:flex; gap:10px; align-items:center; color:var(--fg-2); font-size:.95em; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/console_style.test.cjs`
Expected: PASS

全量回归: `node --test test/*.test.cjs` —— 全绿。

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.css test/console_style.test.cjs
git commit -m "style(dashboard): 单机卡片锚点 + 陈旧折叠区样式 + fleet summary 提权"
```

---

## Self-Review

**1. Spec coverage(spec §4-A/§4-B → task 映射):**
- A1 cleanSummary → Task 1 ✅
- A2 relativeTime 双模块 → Task 2 + Task 3 ✅
- A3 board_render 接入 cleanSummary → Task 4 ✅
- A4 sortCardsByRelevance → Task 6 ✅
- A5 buildCardInner 单机感知 → Task 7 ✅
- A6 isStale → Task 5 ✅(partitionStale 为 B1 折叠所需,一并 Task 5)
- B1 dashboard.js 单机+折叠 → Task 8 ✅
- B2 fleet summary 会话维度 → Task 8 ✅
- B3 dashboard.css → Task 9 ✅
- C(控制台 HERO)/ D(抽屉)→ **Plan 2**(本 plan 范围外,已声明)

**2. Placeholder scan:** 无 TBD/TODO;每步含完整代码与命令。✅

**3. Type/signature consistency:**
- `isStale(card, now)` / `partitionStale(cards, now)` / `sortCardsByRelevance(cards, now)` —— Task 5/6/8 调用签名一致 ✅
- `buildCardInner(machine, session, opts)` opts 新增 `singleMachine` —— Task 4/7/8 一致 ✅
- `flattenFleet` session 加 `cwd` —— Task 7 定义,Task 8 消费 ✅
- `renderFleetSummary(machines, singleMachine, partition)` —— Task 8 定义并调用 ✅
- `TC.cleanSummary(raw, maxLen)` —— Task 1 定义,Task 4/7 消费 ✅

无悬空引用。
