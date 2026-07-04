# console Fleet Dashboard 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `console.html` 从硬编码 Tailwind 色的三区表格,重构为消费 `tokens.css` 的 Fleet Dashboard(卡片网格 + HERO 主控 + 常驻终端),并补 console.js 零覆盖的从零测试。

**Architecture:** 对齐 codebase 已有范本(`dashboard_render.cjs` / `terminal_cleaner.cjs` 的 UMD 纯模块),把 render/排序/diff/callout/摘要逻辑抽到新 `public/console_render.cjs`(可 `require` 纯函数测,免 jsdom);`console.js` 退化为 DOM/WS 粘合层,调用 `ConsoleRender.*`。CSS 删 `dashboard.css:121-150` 硬编码,用 token 重写。HTML 重排为 topbar/HERO/卡片网格 `<ul>`/终端四层 `.console-app`。

**Tech Stack:** 原生 JS(UMD 模块)、`node --test`、无新依赖(不引入 jsdom;DOM/WS 粘合靠 HTML/CSS grep + 纯函数覆盖)。

**Spec:** `docs/superpowers/specs/2026-07-03-console-fleet-dashboard-design.md`(v2)

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `public/console_render.cjs` | UMD 纯函数:escapeHtml / statusMeta / relativeTime / buildCardHTML / sortCardsErroredFirst / diffCards / parseCallout / summarizeFleet / nextBackoff | **新建** |
| `public/console.html` | DOM 结构:topbar(返回+摘要)/ HERO(L0-L3)/ 卡片网格 `<ul#board-body>` / 终端 / 融合输入;加载 `terminal_cleaner.cjs` + `console_render.cjs` | **重写** |
| `public/dashboard.css` | console 段 token 化(删 121-150 硬编码)+ `.console-app` flex + 卡片网格 + HERO + 浮层抽屉 + 连接态 + 空态 + 响应式 | **重写 console 段** |
| `public/console.js` | DOM/WS 粘合:renderBoard(调纯函数 + keyed-diff 应用 + 事件)、ensureWs(补重连)、广播融合、renderMaStatus/callout、poll | **重写** |
| `test/console_render.test.cjs` | 纯函数契约测试 | **新建** |
| `test/console_style.test.cjs` | CSS grep 断言(无硬编码色 + token 化 + flex 声明) | **新建** |
| `test/console_html.test.cjs` | HTML 结构/aria/脚本加载 grep 断言 | **新建** |

**不改**:`tokens.css`、`style.css`、`index.html`、`dashboard.html`、后端 `.cjs`、WS 协议、`ensureMaWs` 既有逻辑、`terminal_cleaner.cjs`。

**约定**
- 卡片 key = `${machine.id}/${session.name}`(与现 `selected` Set 一致)。
- 状态词沿用后端枚举:`working/idle/errored/waiting/unknown`;`offline` 由 `machine.online===false` 派生。
- 测试同步运行:`node --test test/*.test.cjs`(严禁 run_in_background)。
- commit 无 Co-Authored-By(全局禁用归属)。

---

## Task 1: console_render.cjs 骨架 + escapeHtml + statusMeta

**Files:**
- Create: `public/console_render.cjs`
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: 写失败测试**

`test/console_render.test.cjs`:
```js
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
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — `Cannot find module '../public/console_render.cjs'`

- [ ] **Step 3: 最小实现**

`public/console_render.cjs`:
```js
/**
 * Console render pure functions (shared between browser and tests).
 * 对齐范本:dashboard_render.cjs / terminal_cleaner.cjs(UMD)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ConsoleRender = factory();
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

  function statusMeta(status) {
    return STATUS_META[status] || DEFAULT_META;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { statusMeta, escapeHtml };
});
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_render.test.cjs`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): 新增 console_render UMD 纯模块骨架(escapeHtml/statusMeta)"
```

---

## Task 2: relativeTime + buildCardHTML

**Files:**
- Modify: `public/console_render.cjs`
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: 追加失败测试**

追加到 `test/console_render.test.cjs`:
```js
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
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — `R.relativeTime is not a function` / `R.buildCardHTML is not a function`

- [ ] **Step 3: 实现**

在 `public/console_render.cjs` 的工厂内(`escapeHtml` 之后、`return` 之前)追加,并在 `return` 加入导出:
```js
  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    return `${Math.floor(diff / 3600000)}h 前`;
  }

  function buildCardHTML(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const key = `${m.id}/${s.name}`;
    const classes = ['card'];
    if (o.active) classes.push('active');
    if (o.selected) classes.push('card--selected');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const last = escapeHtml(s.lastLine || (m.online === false ? '(离线)' : ''));
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    const label = escapeHtml(`${m.name || m.id} / ${s.name},${meta.label},${last ? last.slice(0, 40) : '无输出'}`);
    return `<li class="card-row" data-key="${escapeHtml(key)}">` +
      `<button type="button" class="${classes.join(' ')}" data-machine="${escapeHtml(m.id)}" data-session="${escapeHtml(s.name)}" aria-label="${label}">` +
      `<span class="card__select" role="checkbox" aria-checked="${o.selected ? 'true' : 'false'}" tabindex="-1" aria-hidden="true">☐</span>` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last}</span>` +
      `<span class="card__time">${time}</span>` +
      `</button></li>`;
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML };
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_render.test.cjs`
Expected: PASS(全部)

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): 加 relativeTime + buildCardHTML(双编码+aria+XSS 转义)"
```

---

## Task 3: sortCardsErroredFirst + summarizeFleet

**Files:**
- Modify: `public/console_render.cjs`
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: 追加失败测试**

```js
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
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — `R.sortCardsErroredFirst is not a function`

- [ ] **Step 3: 实现**

工厂内追加 + 导出:
```js
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

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet };
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): 加 sortCardsErroredFirst + summarizeFleet"
```

---

## Task 4: diffCards(keyed-diff 决策)

**Files:**
- Modify: `public/console_render.cjs`
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: 追加失败测试**

```js
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
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — `R.diffCards is not a function`

- [ ] **Step 3: 实现**

工厂内追加 + 导出:
```js
  function diffCards(prevKeys, nextKeys) {
    const prev = new Set(prevKeys || []);
    const next = new Set(nextKeys || []);
    const added = [];
    const removed = [];
    for (const k of next) if (!prev.has(k)) added.push(k);
    for (const k of prev) if (!next.has(k)) removed.push(k);
    return { added, removed };
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards };
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): 加 diffCards(keyed-diff 决策纯函数)"
```

---

## Task 5: parseCallout(默认隐藏 + 错误关键词)

**Files:**
- Modify: `public/console_render.cjs`(注入依赖 `terminal_cleaner.cjs`)
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: 追加失败测试**

```js
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
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — `R.parseCallout is not a function`

- [ ] **Step 3: 实现**

把 UMD 包裹改为注入 `TerminalCleaner`(node 端 require,浏览器端全局),工厂签名加 `TC` 形参:
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./terminal_cleaner.cjs'));
  } else {
    root.ConsoleRender = factory(root.TerminalCleaner || { cleanOutput: (s) => s });
  }
})(typeof window !== 'undefined' ? window : globalThis, function (TC) {
  'use strict';
  // ... 既有 statusMeta/escapeHtml/relativeTime/buildCardHTML/sortCardsErroredFirst/summarizeFleet/diffCards ...

  const stripAnsi = (s) => (TC && TC.cleanOutput ? TC.cleanOutput(s) : String(s || ''));
  const ERROR_RE = /\b(error|fail(?:ed)?|traceback|exception|EACCES|errno|panic|✕)\b/i;

  function parseCallout(rawScreen, state) {
    const st = state || {};
    const clean = stripAnsi(rawScreen || '');
    const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { show: false };
    const fullLast = lines[lines.length - 1];
    const text = fullLast.slice(0, 120);
    if (!ERROR_RE.test(text)) return { show: false };
    const now = st.now || Date.now();
    const ts = (text === st.lastText) ? (st.lastChangeTs || now) : now;
    const stableMs = ts ? now - ts : 0;
    const display = fullLast.length > 120 ? text + '…' : text;
    const timeLabel = stableMs > 10000 ? relativeTime(ts, now) : '实时输出中…';
    return { show: true, text: display, ts, timeLabel };
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards, parseCallout };
});
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): 加 parseCallout(默认隐藏+错误关键词触发+ANSI strip)"
```

---

## Task 6: nextBackoff(重连退避纯函数)

**Files:**
- Modify: `public/console_render.cjs`
- Test: `test/console_render.test.cjs`

- [ ] **Step 1: 追加失败测试**

```js
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
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_render.test.cjs`
Expected: FAIL — `R.nextBackoff is not a function`

- [ ] **Step 3: 实现**

工厂内追加 + 导出:
```js
  const BACKOFF_TABLE = [3000, 6000, 12000, 30000];
  function nextBackoff(attempt) {
    const i = attempt < 0 ? 0 : attempt;
    return BACKOFF_TABLE[Math.min(i, BACKOFF_TABLE.length - 1)];
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards, parseCallout, nextBackoff };
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_render.test.cjs`
Expected: PASS(全部 ≥ 30 tests)

- [ ] **Step 5: Commit**

```bash
git add public/console_render.cjs test/console_render.test.cjs
git commit -m "feat(console): 加 nextBackoff(指数退避 3→6→12→30s 封顶)"
```

---

## Task 7: dashboard.css console 段 token 化

**Files:**
- Modify: `public/dashboard.css:121-150`(删旧 + 写新)
- Test: `test/console_style.test.cjs`

- [ ] **Step 1: 写失败测试**

`test/console_style.test.cjs`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');
const CONSOLE_SECTION = css.slice(css.indexOf('===== 多机控制台'));

test('console 段无硬编码 Tailwind 状态色', () => {
  for (const hex of ['#34d399', '#fbbf24', '#f87171', '#94a3b8', '#64748b', '#22c55e', '#9ca3af', '#f59e0b', '#000', '#b45309']) {
    assert.ok(!CONSOLE_SECTION.includes(hex), `不应残留硬编码色 ${hex}`);
  }
});
test('console 段无白线 bug / 蓝选中行 / 琥珀广播底', () => {
  assert.ok(!/rgba\(255,\s*255,\s*255,\s*\.08\)/.test(CONSOLE_SECTION), '白线 bug 应清除');
  assert.ok(!/rgba\(96,\s*165,\s*250/.test(CONSOLE_SECTION), '蓝色选中行应改 token');
  assert.ok(!/rgba\(245,\s*158,\s*11/.test(CONSOLE_SECTION), '琥珀广播底应清除');
});
test('.console-app 是顶层 flex 列容器', () => {
  const m = CONSOLE_SECTION.match(/\.console-app\s*\{([^}]*)\}/);
  assert.ok(m, '.console-app 规则应存在');
  assert.match(m[1], /height:\s*100dvh/);
  assert.match(m[1], /display:\s*flex/);
  assert.match(m[1], /flex-direction:\s*column/);
  assert.match(m[1], /overflow:\s*hidden/);
});
test('终端色用局部 token --term-bg/--term-fg(非 #000)', () => {
  assert.match(CONSOLE_SECTION, /--term-bg:\s*#1a1815/);
  assert.match(CONSOLE_SECTION, /--term-fg:\s*#e8e6df/);
  assert.match(CONSOLE_SECTION, /background:\s*var\(--term-bg\)/);
  assert.match(CONSOLE_SECTION, /color:\s*var\(--term-fg\)/);
});
test('.s-dot--idle 加内描边满足非文本 3:1', () => {
  assert.match(CONSOLE_SECTION, /\.s-dot--idle\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--border-2\)/);
});
test('卡片网格 auto-fill minmax', () => {
  assert.match(CONSOLE_SECTION, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)/);
});
test('waiting 卡底用独立 --waiting-bg(非 --accent-bg)', () => {
  assert.match(CONSOLE_SECTION, /--waiting-bg:\s*rgba\(192,\s*133,\s*50,\s*0\.08\)/);
});
test('prefers-reduced-motion 降级存在', () => {
  assert.match(CONSOLE_SECTION, /prefers-reduced-motion:\s*reduce/);
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_style.test.cjs`
Expected: FAIL(各 token / flex 声明缺失)

- [ ] **Step 3: 重写 console 段**

把 `public/dashboard.css` 中从 `/* ===== 多机控制台三区布局(追加,不改现有规则) ===== */`(原 L121)起到 `.main-agent-panel.disabled { ... }` 规则之前的整段 console/主控规则**整体替换**为:
```css
/* ===== 多机控制台 Fleet Dashboard(token 化,删除原硬编码)===== */
.console-app {
  height: 100dvh; display: flex; flex-direction: column; overflow: hidden;
  --term-bg: #1a1815; --term-fg: #e8e6df;
  --waiting-bg: rgba(192, 133, 50, 0.08);
}
.console-app[data-disabled="true"] { opacity: .5; pointer-events: none; }

.console-topbar { display:flex; align-items:center; gap:12px; padding:8px 16px; border-bottom:1px solid var(--border); }
.console-topbar .brand-mark { font-size:1.1em; }
.console-topbar h1 { font-size:1rem; margin:0; }
.console-topbar .topbar-back { color:var(--fg-2); text-decoration:none; font-size:.85em; }
.console-topbar .topbar-back:hover { color:var(--accent-2); }
.fleet-summary { margin-left:auto; display:flex; gap:10px; align-items:center; color:var(--fg-2); font-size:.85em; }
.fleet-summary .s-icon { font-size:.9em; }

.console-hero { position:relative; padding:10px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.console-hero .eyebrow { letter-spacing:.08em; text-transform:uppercase; font-size:.7em; color:var(--fg-2); }
.console-hero .hero-title { font-weight:600; font-size:1.05rem; }
.hero-l1 { display:flex; gap:14px; color:var(--fg-2); font-size:.85em; }
.hero-callout { flex-basis:100%; color:var(--fg-2); font-size:.8em; font-family:var(--mono); }
.hero-callout[hidden] { display:none; }
.ma-warn-line { color:var(--fg-2); font-size:.75em; }
#ma-screen { margin:0; max-height:0; overflow:auto; background:var(--term-bg); color:var(--term-fg); font-family:var(--mono); font-size:.8em; padding:0 8px; transition:max-height .2s ease; }
.console-hero[data-ma-open="true"] #ma-screen { max-height:240px; padding:8px; position:absolute; z-index:50; left:16px; right:16px; box-shadow:var(--shadow-card); border:1px solid var(--border); border-radius:var(--r-sm); }
.dot { display:inline-block; width:10px; height:10px; border-radius:50%; }
.dot.running { background:var(--working); }
.dot.stopped { background:var(--idle); }
.ma-btn { padding:2px 10px; }

.console-board { flex:1; min-height:0; overflow:auto; padding:12px 16px; }
.board-grid { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; }
.board-empty { grid-column:1/-1; padding:32px; text-align:center; color:var(--fg-2); }
.card-row { list-style:none; }
.card { position:relative; display:grid; grid-template-columns:auto auto 1fr auto; grid-template-rows:auto auto; align-items:center; gap:2px 8px; width:100%; padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); cursor:pointer; text-align:left; font:inherit; color:var(--fg); box-shadow:inset 3px 0 0 transparent; }
@media (hover:hover){ .card:hover { transform:translateY(-1px); } }
.card:focus-visible { outline:2px solid var(--accent-2); outline-offset:2px; }
.card.active { box-shadow:inset 3px 0 0 var(--accent-2); }
.card.card--selected { border-color:var(--accent-2); box-shadow:inset 0 0 0 2px var(--accent-2); }
.card[data-status="errored"] { box-shadow:inset 3px 0 0 var(--errored); }
.card[data-status="errored"].active { box-shadow:inset 3px 0 0 var(--errored), inset 0 0 0 2px var(--accent-2); }
.card[data-status="waiting"] { background:var(--waiting-bg); }
.card__select { font-size:.9em; color:var(--fg-2); user-select:none; }
.card__name { font-weight:600; font-size:.9em; }
.card__session { color:var(--fg-2); font-size:.75em; grid-column:3; }
.card__last { color:var(--fg-2); font-size:.75em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; grid-column:1/-1; max-width:100%; }
.card__time { color:var(--fg-2); font-size:.7em; grid-column:4; grid-row:1; }
.s-dot { display:inline-block; width:8px; height:8px; border-radius:50%; }
.s-dot--working { background:var(--working); }
.s-dot--idle { background:var(--idle); box-shadow:0 0 0 1px var(--border-2); }
.s-dot--errored { background:var(--errored); }
.s-dot--waiting { background:var(--waiting); }
.s-dot--offline, .s-dot--unknown { background:var(--fg-3); }
.s-icon[aria-hidden="true"] { color:var(--fg-2); }

.console-term { display:flex; flex-direction:column; border-top:1px solid var(--border); flex:0 0 40vh; min-height:180px; }
#term-target { padding:4px 16px; font-size:.8em; color:var(--fg-2); display:flex; align-items:center; gap:6px; border-bottom:1px solid var(--border); }
#term-target[data-state="disconnected"] { color:var(--errored); }
#term-screen { margin:0; flex:1; min-height:0; padding:8px 12px; background:var(--term-bg); color:var(--term-fg); font-family:var(--mono); font-size:.8em; overflow:auto; white-space:pre-wrap; }
.term-input-form { display:flex; gap:6px; padding:6px 16px; border-top:1px solid var(--border); align-items:center; }
#term-input { flex:1; }
#term-input:disabled { opacity:.5; }
.term-badge { font-size:.75em; background:var(--accent-dim); color:var(--accent-2); padding:2px 8px; border-radius:var(--r-pill); }
#bc-result { font-size:.75em; color:var(--fg-2); }

@media (max-width: 768px) {
  .console-hero .hero-l1, .console-hero .eyebrow { display:none; }
  .console-term { flex-basis:38vh; }
}
@media (hover: none) { .card:active { background:var(--surface-2); } }
@media (prefers-reduced-motion: reduce) {
  .card, #ma-screen { transition:none; }
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_style.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.css test/console_style.test.cjs
git commit -m "feat(console): dashboard.css console 段 token 化(删硬编码+flex+卡片网格+连接态)"
```

---

## Task 8: console.html DOM 重构

**Files:**
- Modify: `public/console.html`(整体重写 body)
- Test: `test/console_html.test.cjs`

- [ ] **Step 1: 写失败测试**

`test/console_html.test.cjs`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');

test('加载 terminal_cleaner + console_render 脚本(顺序)', () => {
  const idxTC = html.indexOf('terminal_cleaner.cjs');
  const idxCR = html.indexOf('console_render.cjs');
  const idxJS = html.indexOf('console.js');
  assert.ok(idxTC > 0, '应加载 terminal_cleaner.cjs');
  assert.ok(idxCR > 0, '应加载 console_render.cjs');
  assert.ok(idxTC < idxCR, 'terminal_cleaner 须在 console_render 前');
  assert.ok(idxCR < idxJS, 'console_render 须在 console.js 前');
});
test('顶层 .console-app 容器(非 #app)', () => {
  assert.match(html, /class="console-app"/);
  assert.doesNotMatch(html, /id="app"/);
});
test('topbar 含返回入口 + fleet 摘要挂点', () => {
  assert.match(html, /class="console-topbar"/);
  assert.match(html, /href="\/dashboard\.html"/);
  assert.match(html, /id="fleet-summary"/);
});
test('卡片网格是 <ul id="board-body">(非 table)', () => {
  assert.match(html, /<ul[^>]*id="board-body"/);
  assert.doesNotMatch(html, /<table id="global-board"/);
});
test('HERO L2 callout 默认 hidden', () => {
  assert.match(html, /id="hero-callout"[^>]*hidden/);
});
test('终端 term-target 支持 data-state + 融合输入', () => {
  assert.match(html, /id="term-target"/);
  assert.match(html, /id="term-input"/);
  assert.match(html, /id="term-input-form"/);
});
test('废弃广播栏已移除(单输入融合)', () => {
  assert.doesNotMatch(html, /id="broadcast-bar"/);
  assert.doesNotMatch(html, /id="bc-send"/);
  assert.doesNotMatch(html, /id="bc-input"/);
});
test('保留功能挂点(ma-* / hub-status / bc-result)', () => {
  for (const id of ['hub-status', 'main-agent-panel', 'ma-status-dot', 'ma-status-text', 'ma-screen', 'ma-start-btn', 'ma-stop-btn', 'bc-result']) {
    assert.match(html, new RegExp(`id="${id}"`), `应保留 #${id}`);
  }
});
test('图标 span 标注 aria-hidden', () => {
  assert.match(html, /aria-hidden="true"/);
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_html.test.cjs`
Expected: FAIL(结构未重构)

- [ ] **Step 3: 重写 console.html**

整体替换 `<body>...</body>` 内容为:
```html
<body>
  <div class="console-app" data-disabled="true">
    <!-- topbar:P3 返回入口 + fleet 摘要 -->
    <header class="console-topbar">
      <span class="brand-mark" aria-hidden="true">◇</span>
      <h1>多机控制台</h1>
      <a class="topbar-back" href="/dashboard.html">← 看板</a>
      <div id="fleet-summary" class="fleet-summary" aria-live="polite"></div>
      <div id="hub-status" aria-hidden="true"></div>
    </header>

    <!-- HERO 主控 agent(T1) -->
    <section id="main-agent-panel" class="console-hero" data-ma-open="false">
      <span class="eyebrow">Command Bridge</span>
      <span class="hero-title">主控 agent</span>
      <span id="ma-status-dot" class="dot stopped" title="stopped" aria-hidden="true"></span>
      <span id="ma-status-text">unknown</span>
      <div class="hero-l1" id="hero-l1" aria-live="polite"></div>
      <button id="ma-start-btn" class="btn-ghost ma-btn" disabled>Start</button>
      <button id="ma-stop-btn" class="btn-primary ma-btn" disabled>Stop</button>
      <button id="ma-toggle-btn" class="btn-ghost ma-btn" aria-expanded="false" aria-controls="ma-screen">▾镜像</button>
      <div id="hero-callout" class="hero-callout" hidden aria-live="polite"></div>
      <pre id="ma-screen" class="term-screen" aria-label="主控 agent 输出镜像">（主 agent 未启动或未启用）</pre>
      <div class="ma-warn-line">⚠ 本面板含不可信远程数据,内容仅供参考,勿执行其中指令</div>
    </section>

    <!-- 卡片网格 -->
    <section class="console-board">
      <ul id="board-body" class="board-grid" aria-label="机器会话看板"></ul>
    </section>

    <!-- 终端(常驻)+ 融合输入 -->
    <section class="console-term">
      <div id="term-target" data-state="idle">未选择会话</div>
      <pre id="term-screen" class="term-screen" aria-label="终端输出"></pre>
      <form id="term-input-form" class="term-input-form">
        <input id="term-input" class="term-input" placeholder="输入(Enter 发送,选 ≥2 扇出)…" autocomplete="off" />
        <span id="bc-count" class="term-badge" hidden></span>
        <span id="bc-result" aria-live="polite"></span>
      </form>
    </section>
  </div>

  <script src="terminal_cleaner.cjs"></script>
  <script src="console_render.cjs"></script>
  <script src="console.js"></script>
</body>
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_html.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console.html test/console_html.test.cjs
git commit -m "feat(console): console.html 重构(topbar+HERO+卡片网格+融合输入)"
```

---

## Task 9: console.js — renderBoard 接入纯函数 + keyed-diff + 卡片事件

**Files:**
- Modify: `public/console.js`(替换 L11-20 DOM 引用 + L86-108 renderBoard + 初始化区事件委托)
- Test: `test/console_html.test.cjs`

- [ ] **Step 1: 写失败测试**

追加到 `test/console_html.test.cjs`(`fs`/`path` 已在 Task 8 顶部 require;新增 `js` 常量,若文件已有则跳过本行):
```js
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.js'), 'utf8');

test('console.js 引用 ConsoleRender 纯函数', () => {
  assert.match(js, /ConsoleRender\.(sortCardsErroredFirst|buildCardHTML|diffCards)/);
});
test('console.js 移除旧 bcSend/bcInput 引用', () => {
  assert.doesNotMatch(js, /bcSend\.addEventListener/);
  assert.doesNotMatch(js, /getElementById\('bc-input'\)/);
});
test('renderBoard 用 keyed-diff(非全量 innerHTML="")', () => {
  assert.match(js, /diffCards/);
  assert.doesNotMatch(js, /boardBody\.innerHTML\s*=\s*''/);
});
test('空态渲染 board-empty', () => {
  assert.match(js, /board-empty/);
});
```
> 注:第一条 `const js` 行是占位笔误,实际文件中只保留第二条(`__dirname`)。实现者删除占位行。

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_html.test.cjs`
Expected: FAIL

- [ ] **Step 3: 实现**

1. 替换头部 DOM 引用块(原 L11-20)为:
```js
  const CR = window.ConsoleRender;
  const boardBody = document.getElementById('board-body');
  const termTarget = document.getElementById('term-target');
  const termScreen = document.getElementById('term-screen');
  const termInput = document.getElementById('term-input');
  const termForm = document.getElementById('term-input-form');
  const bcCount = document.getElementById('bc-count');
  const bcResult = document.getElementById('bc-result');
  const fleetSummary = document.getElementById('fleet-summary');
  const heroCallout = document.getElementById('hero-callout');
  const maToggleBtn = document.getElementById('ma-toggle-btn');
  let lastPayload = null;
  let lastBoardMachines = [];
```
2. 用如下替换原 `renderBoard`(L86-108):
```js
  let prevKeys = new Set();

  function flattenCards(payload) {
    const cards = [];
    for (const m of payload.machines || []) {
      const online = m.online !== false;
      for (const s of m.sessions || []) {
        const status = online ? (s.status || 'unknown') : 'offline';
        cards.push({ machine: m, session: { ...s, status }, key: `${m.id}/${s.name}`, name: m.name || m.id, lastTs: s.lastTs || 0 });
      }
    }
    return cards;
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function renderBoard(payload) {
    lastPayload = payload;
    lastBoardMachines = payload.machines || [];
    const sorted = CR.sortCardsErroredFirst(flattenCards(payload));

    if (!sorted.length) {
      boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
      prevKeys = new Set();
      refreshBroadcast();
      renderFleetSummary(lastBoardMachines);
      return;
    }

    const nextKeys = sorted.map((c) => c.key);
    const diff = CR.diffCards(prevKeys, nextKeys);
    for (const key of diff.removed) {
      const node = boardBody.querySelector(`[data-key="${cssEsc(key)}"]`);
      if (node) node.remove();
    }
    for (const c of sorted) {
      let li = boardBody.querySelector(`[data-key="${cssEsc(c.key)}"]`);
      const btnHtml = CR.buildCardHTML(c.machine, c.session, {
        active: currentTarget && currentTarget.machine === c.machine.id && currentTarget.session === c.session.name,
        selected: selected.has(c.key),
        lastTs: c.lastTs,
        now: Date.now(),
      }).match(/<button[\s\S]*<\/button>/)[0];
      if (!li) {
        li = document.createElement('li');
        li.className = 'card-row';
        li.dataset.key = c.key;
        boardBody.appendChild(li);
      }
      li.innerHTML = btnHtml;
      li.querySelector('.card').dataset.status = c.session.status;
    }
    // 按 sorted 顺序重排(appendChild 移动已存在节点,不重建 → 保留 scrollTop/focus)
    for (const c of sorted) {
      const li = boardBody.querySelector(`[data-key="${cssEsc(c.key)}"]`);
      if (li) boardBody.appendChild(li);
    }
    prevKeys = new Set(nextKeys);
    refreshBroadcast();
    renderFleetSummary(lastBoardMachines);
  }

  function renderFleetSummary(machines) {
    const s = CR.summarizeFleet(machines);
    fleetSummary.innerHTML =
      `<span><span class="s-icon" aria-hidden="true">▶</span> ${s.working}</span>` +
      `<span><span class="s-icon" aria-hidden="true">⏸</span> ${s.idle}</span>` +
      `<span><span class="s-icon" aria-hidden="true">✕</span> ${s.errored}</span>` +
      `<span>在线 ${s.online}/${s.total}</span>`;
  }
```
3. 事件委托(在 IIFE 初始化区,原 `ensureWs()` 调用前插入):
```js
  boardBody.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const machine = card.dataset.machine, session = card.dataset.session;
    const key = `${machine}/${session}`;
    if (e.target.closest('.card__select')) {
      e.stopPropagation();
      selected.has(key) ? selected.delete(key) : selected.add(key);
      refreshBroadcast();
      if (lastPayload) renderBoard(lastPayload);
      return;
    }
    attachTarget({ machine, session });
  });
  boardBody.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      attachTarget({ machine: card.dataset.machine, session: card.dataset.session });
    }
  });
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_html.test.cjs test/console_render.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console.js test/console_html.test.cjs
git commit -m "feat(console): renderBoard 接入纯函数 + keyed-diff + 事件委托(键盘可达)"
```

---

## Task 10: console.js — ensureWs 重连 + 断线态 + 广播融合单输入

**Files:**
- Modify: `public/console.js`(替换 L32-61 ensureWs + L79-84 termForm submit + L110-122 refreshBroadcast/bcSend)
- Test: `test/console_html.test.cjs`

- [ ] **Step 1: 写失败测试**

追加到 `test/console_html.test.cjs`:
```js
test('ensureWs 补 onclose/onerror + 重连', () => {
  assert.match(js, /ws\.onclose\s*=/);
  assert.match(js, /ws\.onerror\s*=/);
  assert.match(js, /nextBackoff/);
});
test('断线态切 term-target data-state + 禁用输入', () => {
  assert.match(js, /data-state="disconnected"/);
  assert.match(js, /termInput\.disabled\s*=\s*true/);
});
test('广播融合:term-input 按 selected.size 分发', () => {
  assert.match(js, /selected\.size/);
  assert.match(js, /type:\s*'broadcast'/);
  assert.match(js, /type:\s*'input'/);
});
test('refreshBroadcast 切输入条广播态 + 徽章', () => {
  assert.match(js, /bcCount\.hidden\s*=\s*selected\.size\s*<\s*2/);
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_html.test.cjs`
Expected: FAIL

- [ ] **Step 3: 实现**

替换原 `ensureWs`(L32-61)为:
```js
  let termReconnectTimer = null;
  let termBackoff = 0;
  let reconnectedOnce = false;

  function setTermState(state) {
    termTarget.dataset.state = state;
    if (state === 'disconnected') {
      termTarget.textContent = (currentTarget ? `${currentTarget.machine} / ${currentTarget.session} · ` : '') + '● 断线,重连中…';
      termInput.disabled = true;
    } else if (state === 'live') {
      termInput.disabled = false;
      if (currentTarget) termTarget.textContent = `${currentTarget.machine} / ${currentTarget.session}`;
    }
  }

  function ensureWs() {
    if (ws && ws.readyState <= 1) return ws;
    ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { termScreen.textContent += '\n[协议错误] 非 JSON 帧'; return; }
      const isCurrent = currentTarget && msg.target &&
        msg.target.machine === currentTarget.machine && msg.target.session === currentTarget.session;
      if (msg.type === 'init' && isCurrent) {
        termScreen.textContent = msg.data || '';
        termScreen.scrollTop = termScreen.scrollHeight;
      } else if (msg.type === 'output' && isCurrent) {
        termScreen.textContent += msg.data || '';
        termScreen.scrollTop = termScreen.scrollHeight;
      } else if (msg.type === 'error' && isCurrent) {
        termScreen.textContent += `\n[错误] ${msg.data}`;
      } else if (msg.type === 'broadcast_result') {
        const arr = Array.isArray(msg.results) ? msg.results : [];
        const okN = arr.filter((r) => r.ok).length;
        bcResult.textContent = `成功 ${okN}/${arr.length}`;
      }
    };
    ws.onopen = () => {
      termBackoff = 0;
      if (termReconnectTimer) { clearTimeout(termReconnectTimer); termReconnectTimer = null; }
      if (currentTarget) {
        setTermState('live');
        sendWhenOpen({ type: 'attach', target: currentTarget });
        if (reconnectedOnce) termScreen.textContent += '\n[已重连]';
      }
      reconnectedOnce = true;
    };
    ws.onclose = () => { scheduleTermReconnect(); };
    ws.onerror = () => { scheduleTermReconnect(); };
    return ws;
  }

  function scheduleTermReconnect() {
    if (currentTarget) setTermState('disconnected');
    const delay = CR.nextBackoff(termBackoff++);
    termReconnectTimer = setTimeout(() => {
      termReconnectTimer = null;
      if (!ws || ws.readyState > 1) ensureWs();
    }, delay);
  }
```

替换原 `termForm.addEventListener('submit', ...)`(L79-84)为:
```js
  termForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!termInput.value) return;
    ensureWs();
    if (selected.size >= 2) {
      const targets = Array.from(selected).map((k) => { const [machine, session] = k.split('/'); return { machine, session }; });
      bcResult.textContent = '扇出中…';
      sendWhenOpen({ type: 'broadcast', targets, data: termInput.value, enter: true });
    } else if (currentTarget) {
      sendWhenOpen({ type: 'input', target: currentTarget, data: termInput.value, enter: true });
    } else {
      return;
    }
    termInput.value = '';
  });
```

替换原 `refreshBroadcast`(L110-113)+ **删除**原 `bcSend.addEventListener('click', ...)`(L115-122,`bcSend` 已不存在):
```js
  function refreshBroadcast() {
    const broadcasting = selected.size >= 2;
    bcCount.hidden = !broadcasting;
    bcCount.textContent = broadcasting ? `扇出 ${selected.size}` : '';
    termInput.placeholder = broadcasting ? `给 ${selected.size} 个会话发同一条指令…` : '输入(Enter 发送)…';
  }
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_html.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/console.js test/console_html.test.cjs
git commit -m "feat(console): ensureWs 补重连+断线态;广播融合单输入按 selected.size 分发"
```

---

## Task 11: console.js — HERO L1/L2/L3 + renderMaCallout + poll 摘要 + 镜像 toggle

**Files:**
- Modify: `public/console.js`(renderMaStatus L136-153 扩展 + 加 renderMaCallout/renderHeroL1 + maToggle 绑定 + poll stale)
- Test: `test/console_html.test.cjs`

- [ ] **Step 1: 写失败测试**

追加到 `test/console_html.test.cjs`:
```js
test('renderMaStatus 写 hero-l1 健康摘要', () => {
  assert.match(js, /hero-l1|heroL1/);
  assert.match(js, /summarizeFleet/);
});
test('renderMaCallout 调 parseCallout + 默认隐藏', () => {
  assert.match(js, /parseCallout/);
  assert.match(js, /heroCallout\.hidden\s*=/);
});
test('ma-toggle 切 data-ma-open + aria-expanded', () => {
  assert.match(js, /data-ma-open/);
  assert.match(js, /aria-expanded/);
});
test('poll stale 检测:连续失败标陈旧', () => {
  assert.match(js, /pollFailCount|数据.*前/);
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `node --test test/console_html.test.cjs`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `renderMaStatus`(原 L136-153)末尾追加两行:
```js
    renderHeroL1();
    renderMaCallout();
```
2. 新增模块级状态 + 函数(放在 `renderMaStatus` 之后):
```js
  let calloutState = { lastText: '', lastChangeTs: 0 };
  let pollFailCount = 0;
  let lastPollOkTs = 0;

  function renderHeroL1() {
    const s = CR.summarizeFleet(lastBoardMachines);
    document.getElementById('hero-l1').innerHTML =
      `<span><span class="s-icon" aria-hidden="true">▶</span> ${s.working} working</span>` +
      `<span><span class="s-icon" aria-hidden="true">⏸</span> ${s.idle} idle</span>` +
      `<span><span class="s-icon" aria-hidden="true">✕</span> ${s.errored} errored</span>`;
  }

  function renderMaCallout() {
    const r = CR.parseCallout(maScreen.textContent, { ...calloutState, now: Date.now() });
    if (!r.show) { heroCallout.hidden = true; return; }
    heroCallout.hidden = false;
    heroCallout.textContent = `⚠ ${r.text} · ${r.timeLabel}`;
    calloutState = { lastText: r.text, lastChangeTs: r.ts };
  }
```
3. `poll`(原 L124-134)替换为(加 stale 检测):
```js
  async function poll() {
    let boardOk = false;
    try {
      const res = await fetch('/api/global-dashboard');
      if (res.ok) { const p = await res.json(); renderBoard(p); boardOk = true; }
    } catch {}
    try {
      const r = await fetch('/api/main-agent/status');
      if (r.ok) maStatus = await r.json();
    } catch {}
    pollFailCount = boardOk ? 0 : pollFailCount + 1;
    if (boardOk) lastPollOkTs = Date.now();
    renderMaStatus();
    if (pollFailCount > 2 && lastPollOkTs) {
      const ago = Math.floor((Date.now() - lastPollOkTs) / 1000);
      if (ago > 10) maText.textContent = `数据 ${ago}s 前`;
    }
  }
```
4. 镜像 toggle 绑定 + callout 定时刷新(在 `setInterval(poll, 2000)` 附近):
```js
  maToggleBtn.addEventListener('click', () => {
    const open = maPanel.dataset.maOpen === 'true';
    maPanel.dataset.maOpen = String(!open);
    maToggleBtn.setAttribute('aria-expanded', String(!open));
  });
  setInterval(renderMaCallout, 30000); // 相对时间刷新
```

- [ ] **Step 4: 跑测试看通过**

Run: `node --test test/console_html.test.cjs test/console_render.test.cjs test/console_style.test.cjs`
Expected: PASS(全部)

- [ ] **Step 5: Commit**

```bash
git add public/console.js test/console_html.test.cjs
git commit -m "feat(console): HERO L1 摘要 + L2 callout(默认隐藏+关键词)+ L3 镜像 toggle + poll stale"
```

---

## Task 12: 最终 review + 全套测试 + 手动 smoke

**Files:** 全部

- [ ] **Step 1: 全套测试**

Run: `node --test test/*.test.cjs`
Expected: 全部 PASS,无回归(尤其 `console_scroll_layout`/`dashboard_*` 既有测试仍绿)。

- [ ] **Step 2: 覆盖率核验**

Run: `node --test --experimental-test-coverage test/console_render.test.cjs test/console_style.test.cjs test/console_html.test.cjs`
Expected: console_render.cjs 纯函数覆盖率 ≥80%(branch + line)。若不足,补 `parseCallout`/`diffCards` 边界用例。

- [ ] **Step 3: CSS grep 全套再确认**

Run: `node --test test/console_style.test.cjs`
Expected: PASS(无硬编码色残留)。

- [ ] **Step 4: 手动 smoke 清单**

启动 `node server.cjs`,浏览器打开 `/console.html`,逐项验证:
- [ ] 卡片网格显示,errored 卡左 `--errored` 色条 + 置顶
- [ ] 点卡片 / Tab 聚焦后 Enter → 终端切换 target
- [ ] 多选圈点击不触发 attach(stopPropagation),≥2 选时输入条变广播态 + 徽章
- [ ] 终端断网(停 hub WS)→ `#term-target` 转 `data-state=disconnected` + "● 断线,重连中…" + 输入禁用;恢复后 `[已重连]`
- [ ] HERO Start/Stop 生效;`▾镜像` 展开浮层 `#ma-screen`
- [ ] callout 在主控输出含 "Error" 时点亮,纯进度行隐藏
- [ ] 移动竖屏(devtools):HERO 收起、键盘弹起不顶死
- [ ] topbar "← 看板" 跳 `/dashboard.html`
- [ ] 无控制台报错;脚本顺序加载 `terminal_cleaner → console_render → console.js`

- [ ] **Step 5: 终结 commit**

```bash
git add -A
git commit -m "test(console): greenfield 测试补齐 + smoke 通过(覆盖 ≥80%)"
```

---

## Self-Review(plan 自检)

**1. Spec coverage**(对照 spec v2):
- §3.2 硬编码迁移 → Task 7 ✅
- §5.1 topbar 返回 → Task 8 ✅
- §5.2 卡片(键盘/左色条/selected/空态)→ Task 2 + Task 7 + Task 9 + Task 8 ✅
- §5.3 errored-first → Task 3 ✅
- §5.4 终端 + 广播融合 → Task 8 + Task 10 ✅
- §5.5 ensureWs 重连(C3)→ Task 6 + Task 10 ✅
- §5.6 HERO L1/L2/L3 → Task 8 + Task 11 ✅
- §6 配色 + flex 声明 → Task 7 ✅
- §7 状态四重编码 → Task 1 + Task 2 ✅
- §8 交互(事件隔离)→ Task 9 ✅
- §9 callout 解析 → Task 5 ✅
- §10 改动清单(3 文件 + 测试)→ 全覆盖 ✅
- §12 测试策略 → Task 1-6 + Task 7 + Task 8 + Task 12 ✅

**2. Placeholder scan**:所有 code step 含完整代码,无 TBD/TODO/"add error handling" 等空泛指令。✅

**3. Type consistency**:`flattenCards.card.key` 与 `buildCardHTML` 的 `data-key`、`selected` Set 的 `"machine/session"` 一致;`statusMeta.dot` 类名与 Task 7 CSS `.s-dot--*` 一致;`nextBackoff` 表与 Task 6 测试一致;`setTermState` 的 `'disconnected'/'live'/'idle'` 与 `#term-target` 初始 `data-state="idle"`(Task 8)一致。✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-03-console-fleet-dashboard.md`. Two execution options:**

**1. Subagent-Driven(推荐)** — 每个 task 派一个新子代理实现,task 间两阶段审查(先 spec 符合度,后代码质量),快速迭代。

**2. Inline Execution** — 本会话内用 executing-plans 批量执行,带 checkpoint 审查。

**哪种?**
