# Hub 看板重设计(摘要为中心 IA)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 hub 看板(`:7685/dashboard.html`)单卡信息架构从「6 字段平铺」重设计为「摘要为中心」——会话名主锚、摘要独占 2 行成视觉主角、机器名退到组标题,组标题增强为单机概览层。

**真值来源:** 本 plan 的所有 DOM 结构、CSS 数值、颜色均**逐字对齐已验收的高保真 demo** `/tmp/dashboard-redesign-demo.html`(2026-07-08 专家团队三视角修订:布局实测 Playwright / 信息架构 / 可访问性)。spec(`docs/superpowers/specs/2026-07-07-dashboard-redesign-design.md`)已据此 demo 订正。实现者可在任意时刻 `cat /tmp/dashboard-redesign-demo.html` 对照。

**Architecture:** 纯函数渲染真源 `public/board_render.cjs`(浏览器 + node:test 双跑),`buildCardInner` 加 `opts.mode`('hub'|'single')分支:hub 模式主锚反转为会话名、输出 `<div class="card__head">` 包裹层(状态点+会话名+sr-only+离线标签+时间)+ `<div class="card__last">` 摘要;删冗余 s-icon;离线卡补占位摘要 + `card__off` + `aria-disabled` + "Nh 前在线"。新增 `summarizeMachine` + `renderStatusCounts` 纯函数供组标题与顶栏共用「色谱圆点+数字」计数语言。`public/dashboard.js` 改造 fleet-summary 与组标题(不折叠 + 在线/离线标签 + 状态计数 + N 会话),`buildCardLi` 传 hub mode。`public/dashboard.css` 新增 `.card--hub`(flex column IA,清除状态染色/左缘条,只靠色点)+ 几何一致性(固定列宽 / 等高 / `flex:1 1 0%`)+ 多选与卡级 `:has()` 选中高亮 + a11y。`public/tokens.css` `--idle` 0.3→0.55。顺带清理已删 console.html 遗留死 CSS 与假阳性测试。

**Tech Stack:** 原生 JS(UMD `.cjs` 浏览器/Node 双跑)、Express、node:test(`node --test test/*.test.cjs`)、纯 CSS 消费 design tokens。

## Global Constraints

(spec 全局约束,每个 task 隐含遵守)

- **不动顶栏结构**:只统一 `fleet-summary` 状态计数呈现语言(色谱圆点+数字,无 `×` 无 emoji)
- **不改单机 `:7684` 卡片排版**:保留旧排版(`buildCardInner` 默认 `mode:'single'` = 旧行为;board_render 仅 hub 调用,single 为防御性保留)
- **不引入深色模式**:`tokens.css` 纯浅色
- **hub 卡不染色**:hub 卡清除 waiting-bg / errored 左缘条 / unknown dashed,**只靠色点**表达状态(errored 只玫红色点+环,不染色摘要、不加左缘条)
- **计数符号**:圆点+数字,**无 `×`、无 emoji**(用户明确「不要出现 X」)
- **对比度过 WCAG AA**:承载阅读的文字用 `--fg-2`(≈5.4:1),`--fg-3`(≈2:1)仅装饰;图形对比过 3:1(`--idle` 0.55)
- **计数自洽**:顶栏点和 = 总会话数(working/waiting/errored/idle/offline 五通道)
- **不变项(行为契约)**:`/jump` + 15s ticket 自动登录、hub/单机 cookie 隔离(`cc_web_hub_auth` vs `cc_web_auth`)、卡片 click 新标签跳转(`target="_blank"` + `rel="noopener noreferrer"`)、多选 + 扇出广播、Referrer-Policy same-origin
- **提交规范**:中文 conventional commit,attribution 全局已禁用,勿加 Co-Authored-By
- **测试命令**:`node --test test/*.test.cjs`(单文件 `node --test test/board_render.test.cjs`)

---

## Task 依赖与顺序

```
T1(buildCardInner hub DOM) ─┐
T2(summarizeMachine +       ├─→ T3(dashboard.js) ─→ T4(css .card--hub IA) ─→ T5(几何) ─→ T6(组标题/multi-select/:has()) ─→ T7(a11y/色点) ─→ T8(死CSS清理)
  renderStatusCounts) ──────┘
```

T1/T2 可并行;T3 依赖 T1+T2;T4–T7 顺序(都改 `.card`/CSS,后任依赖前任稳定的 class);T8 最后(独立清理,避免与功能改动冲突)。

---

## Task 1: buildCardInner hub 模式 DOM(card__head 包裹层 + 主锚反转 + 删 s-icon + sr-only + 离线占位)

**Files:**
- Modify: `public/board_render.cjs` — `buildCardInner`(L53–L86)+ `STATUS_META`/`DEFAULT_META`(L15–L22)加 `cn` 中文标签
- Test: `test/board_render.test.cjs` — 末尾追加 hub 模式测试块

**Interfaces:**
- Consumes: `TC.cleanSummary(str,60)`、`relativeTime(ts,now)`、`escapeHtml`、`statusMeta`(均已有)
- Produces: `buildCardInner(machine, session, opts)` 新增 `opts.mode`;hub 模式输出(对齐 demo L145–L148 / L198–L201):
  ```html
  <a class="card card--hub" data-status="…" href="/jump?m=&s=" target="_blank" rel="noopener noreferrer" [aria-disabled="true"]>
    <div class="card__head">
      <span class="s-dot s-dot--{status}"></span>
      <span class="card__name">{会话名}</span>
      <span class="sr-only">{中文状态}</span>
      [<span class="card__off">离线</span>]      <!-- 仅离线 -->
      <span class="card__time">{时间 | Nh 前在线}</span>
    </div>
    <div class="card__last">{摘要 | 主机离线,暂无实时状态。上次摘要:…}</div>
  </a>
  ```
  hub 模式**不输出** `<span class="s-icon">`;single(默认)保持旧行为(机器名主 + 会话副 + s-icon + span.card__last)
- 后续依赖:T3 `buildCardLi` 传 `{mode:'hub'}`;T4 CSS 锚 `.card--hub` / `.card__head` / `.card__off`

- [ ] **Step 1: 写失败测试 — hub DOM 契约(对齐 demo)**

追加到 `test/board_render.test.cjs` 末尾(L353 之后):

```javascript
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
    { name: 'sess-1', status: 'offline', lastLine: 'last output', lastTs: 7200000 },
    { mode: 'hub', now: 10000000 }
  );
  assert.match(html, /aria-disabled="true"/);                            // 离线不可激活语义
  assert.match(html, /<span class="card__off">离线<\/span>/);
  assert.match(html, /主机离线,暂无实时状态/);
  assert.match(html, /上次摘要:last output/);
  // lastTs=7200000,now=10000000 → diff=9280000ms ≈ 2.58h → "2h 前" + "在线" = "2h 前在线"
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — hub 测试报 `card--hub`/`card__head` 不匹配,`card__name` 仍是机器名(默认走 single)。

- [ ] **Step 3: STATUS_META / DEFAULT_META 加中文 `cn`**

替换 `public/board_render.cjs` L15–L22:

```javascript
  const STATUS_META = {
    working: { dot: 's-dot--working', icon: '▶', label: 'working', cn: '运行中' },
    idle:    { dot: 's-dot--idle',    icon: '⏸', label: 'idle',    cn: '空闲' },
    errored: { dot: 's-dot--errored', icon: '✕', label: 'errored', cn: '出错' },
    waiting: { dot: 's-dot--waiting', icon: '⏳', label: 'waiting', cn: '等待中' },
    offline: { dot: 's-dot--offline', icon: '⌽', label: 'offline', cn: '离线' },
  };
  const DEFAULT_META = { dot: 's-dot--unknown', icon: '?', label: 'unknown', cn: '未知' };
```

- [ ] **Step 4: 实现 buildCardInner mode 分支(对齐 demo DOM)**

整体替换 `public/board_render.cjs` 的 `buildCardInner`(L53–L86):

```javascript
  // 看板卡片内层:click-to-navigate 的 <a>(跳 hub /jump?m=&s=,新标签打开目标单机控制台)。
  // opts.mode:'hub'(摘要为中心 IA,对齐 demo — card__head 包裹层,会话名主锚,无 s-icon,
  //   摘要 div 2 行 line-clamp,sr-only 状态,离线补 card__off + aria-disabled + "Nh 前在线" + 占位摘要)
  //   |'single'(默认,旧行为 — 机器名主锚 + 会话名副行 + s-icon,向后兼容)。
  // board_render 仅 hub 调用,single 防御性保留。data-status 留 a(供 CSS 按状态上色)。
  function buildCardInner(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const mode = o.mode === 'hub' ? 'hub' : 'single';
    const meta = statusMeta(s.status);
    const classes = ['card'];
    if (mode === 'hub') classes.push('card--hub');
    if (o.active) classes.push('active');
    const midRaw = m.id == null ? '' : m.id;
    const sessRaw = s.name == null ? '' : s.name;
    const st = escapeHtml(String(s.status || 'unknown'));
    const href = `/jump?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
    const label = `${m.name || m.id} / ${s.name}, ${meta.label}, 在新标签打开控制台`;

    if (mode === 'hub') {
      const name = escapeHtml(s.name || m.name || m.id);
      const offline = m.online === false;
      let lastText;
      if (offline) {
        const prev = s.lastLine
          ? '上次摘要:' + (TC.cleanSummary ? TC.cleanSummary(s.lastLine, 60) : s.lastLine)
          : '';
        lastText = '主机离线,暂无实时状态。' + prev;
      } else {
        const raw = s.lastLine || '';
        lastText = TC.cleanSummary ? TC.cleanSummary(raw, 60) : raw;
      }
      const last = escapeHtml(lastText);
      // 离线时间:有 lastTs → "Nh 前在线";无 lastTs → "长期离线"
      const timeRaw = offline
        ? (o.lastTs ? relativeTime(o.lastTs, o.now) + '在线' : '长期离线')
        : relativeTime(o.lastTs, o.now);
      const time = escapeHtml(timeRaw);
      const offTag = offline ? '<span class="card__off">离线</span>' : '';
      const ariaDis = offline ? ' aria-disabled="true"' : '';
      return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-status="${st}" aria-label="${escapeHtml(label)}"${ariaDis}>` +
        `<div class="card__head">` +
        `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
        `<span class="card__name">${name}</span>` +
        `<span class="sr-only">${meta.cn}</span>` +
        `${offTag}` +
        `<span class="card__time">${time}</span>` +
        `</div>` +
        `<div class="card__last">${last || '—'}</div>` +
        `</a>`;
    }

    // single(默认,旧行为):机器名主标题 + 会话名副行 + s-icon + 单行 span.card__last
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(TC.cleanSummary ? TC.cleanSummary(lastRaw, 60) : lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-status="${st}" aria-label="${escapeHtml(label)}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last || '—'}</span>` +
      `<span class="card__time">${time}</span>` +
      `</a>`;
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/board_render.test.cjs`
Expected: PASS — 全部(含新增 hub + 原有 single/集成)。

- [ ] **Step 6: Commit**

```bash
git add public/board_render.cjs test/board_render.test.cjs
git commit -m "feat(board_render): buildCardInner hub 模式(card__head 包裹 + 会话名主锚 + sr-only + 离线占位)"
```

---

## Task 2: 状态计数纯函数(summarizeMachine + renderStatusCounts)

**Files:**
- Modify: `public/board_render.cjs` — 新增 `summarizeMachine`、`renderStatusCounts`,加入 `return` 导出(L200)
- Test: `test/board_render.test.cjs` — 追加测试块

**Interfaces:**
- Consumes: cards 数组(每项 `.status`,来自 `flattenFleet`/`groupByMachine.cards`)
- Produces:
  - `summarizeMachine(cards)` → `{working,waiting,errored,idle,offline,unknown,total}`(total=cards.length;点和=total)
  - `renderStatusCounts(counts)` → 非零状态输出 `<span class="status-count" title="{中文}"><span class="s-dot s-dot--{status}" aria-hidden="true"></span>{n}</span>`,顺序 working/waiting/errored/idle/offline;全 0 → `''`;**无 emoji 无 `×`**(对齐 demo 的 `title="工作中"` 等中文语义)
- 后续依赖:T3 fleet-summary 与组标题调用

- [ ] **Step 1: 写失败测试**

追加到 `test/board_render.test.cjs` 末尾:

```javascript
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL — `B.summarizeMachine is not a function`。

- [ ] **Step 3: 实现两个纯函数**

在 `public/board_render.cjs` 的 `groupByMachine`(L197)之后、`return`(L200)之前插入:

```javascript
  // 单机维度状态计数:cards(每项 .status)→ 五通道 + total。点和 = total(供顶栏自洽校验)。
  function summarizeMachine(cards) {
    const c = { working: 0, waiting: 0, errored: 0, idle: 0, offline: 0, unknown: 0, total: 0 };
    for (const card of cards || []) {
      c.total++;
      const st = (card && card.status) || 'unknown';
      if (c[st] != null) c[st]++;
    }
    return c;
  }

  // 色谱圆点 + 数字计数 HTML(组标题 + 顶栏共用,对齐 demo title 中文语义)。
  // 无 emoji、无 ×。顺序 working/waiting/errored/idle/offline。非零才渲染;全 0 → ''。
  const COUNT_ORDER = [
    { key: 'working', cn: '工作中' },
    { key: 'waiting', cn: '等待用户' },
    { key: 'errored', cn: '出错' },
    { key: 'idle', cn: '空闲' },
    { key: 'offline', cn: '离线' },
  ];
  function renderStatusCounts(counts) {
    const c = counts || {};
    const parts = [];
    for (const item of COUNT_ORDER) {
      const n = c[item.key] || 0;
      if (n > 0) {
        parts.push('<span class="status-count" title="' + item.cn + '">' +
          '<span class="s-dot s-dot--' + item.key + '" aria-hidden="true"></span>' + n + '</span>');
      }
    }
    return parts.join('');
  }
```

- [ ] **Step 4: 导出新函数**

修改 `public/board_render.cjs` L200 的 `return`:

```javascript
  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, buildCardRow, buildCardInner, flattenFleet, sortCardsByRelevance, summarizeFleet, summarizeMachine, renderStatusCounts, isStale, partitionStale, groupByMachine };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/board_render.test.cjs`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add public/board_render.cjs test/board_render.test.cjs
git commit -m "feat(board_render): 加 summarizeMachine + renderStatusCounts(色谱圆点+数字计数)"
```

---

## Task 3: dashboard.js — fleet-summary 色谱计数 + 组标题(不折叠 + 在线/离线标签 + 状态计数)+ buildCardLi hub mode

**Files:**
- Modify: `public/dashboard.js`:
  - `buildCardLi`(L138)— opts 加 `mode:'hub'`
  - `renderFleetSummary`(L117–L132)— 用 `renderStatusCounts` + 机器文案
  - `renderBoard` 组标题段(L298–L328)— 去折叠 details/summary → 静态 div(对齐 demo L130–L140),加在线/离线标签 + 状态计数 + 「N 会话」;删 `prevOpen` 记忆逻辑
  - stale 区(L329–L343)— 删对 `prevOpen` 的引用(默认折叠)
- Test: 无纯函数新增(`renderStatusCounts`/`summarizeMachine` 已在 T2 覆盖);验证靠 T4–T6 CSS 锁 + 手动 Playwright

**Interfaces:**
- Consumes: T1 `buildCardInner` hub、T2 `summarizeMachine`+`renderStatusCounts`+`summarizeFleet`+`flattenFleet`
- Produces(对齐 demo):
  - 顶栏 `<span class="fleet-machine-text">N 机在线 · M 机离线 · K 会话</span><span class="fleet-counts">{renderStatusCounts}</span>`(demo L114–L121:count 在前,dots 在后)
  - 组标题 `<div class="machine-group__title"><span class="machine-group__name">…</span><span class="machine-group__status machine-group__status--online|offline">· 在线|· 离线</span><span class="machine-group__counts">{renderStatusCounts}</span><span class="machine-group__total">N 会话</span></div>`(demo L130–L139)
- 后续依赖:T6 锚 `.fleet-counts`/`.fleet-machine-text`/`.machine-group__title`/`.machine-group__status`/`.machine-group__counts`/`.machine-group__total`/`.status-count`

- [ ] **Step 1: buildCardLi 传 hub mode**

修改 `public/dashboard.js` L138 `BR.buildCardRow` 调用:

```javascript
        wrap.innerHTML = BR.buildCardRow(card.machine, card.session, {
            mode: 'hub', lastTs: card.lastTs, now: Date.now()
        });
```

- [ ] **Step 2: renderFleetSummary 改色谱计数(顺序:机器文案 → 圆点)**

整体替换 `public/dashboard.js` `renderFleetSummary`(L117–L132):

```javascript
    function renderFleetSummary(machines) {
        var msum = BR.summarizeFleet(machines);            // 机器维度 online/total
        var cards = BR.flattenFleet(machines);             // 离线机 session.status → 'offline'
        var c = BR.summarizeMachine(cards);                // 五通道会话计数(点和 = total)
        fleetSummary.hidden = false;                        // 错误恢复复位(原逻辑保留)
        var offlineMachines = msum.total - msum.online;
        var machineText = msum.online + ' 机在线'
            + (offlineMachines > 0 ? ' · ' + offlineMachines + ' 机离线' : '')
            + ' · ' + c.total + ' 会话';
        // demo L114–L121:机器文案在前,色谱圆点在后
        fleetSummary.innerHTML =
            '<span class="fleet-machine-text">' + machineText + '</span>' +
            '<span class="fleet-counts">' + BR.renderStatusCounts(c) + '</span>';
        var t = '(' + msum.online + ') CC 看板 · 多机';
        document.title = t;
        var titleEl2 = document.getElementById('title'); if (titleEl2) titleEl2.textContent = t;
    }
```

- [ ] **Step 3: renderBoard 组标题去折叠 + 在线/离线标签 + 计数(对齐 demo)**

整体替换 `public/dashboard.js` `renderBoard` 内 L298–L328(从「展开状态继承」注释到 active 分组循环的 `boardBody.appendChild(groupLi);`):

```javascript
        // 全量重建:每次轮询无条件清空 boardBody.innerHTML。
        boardBody.innerHTML = '';
        // 按机分节:每机 <li class="machine-group"><div.machine-group__title>…</div><ul.board-grid>…
        // spec §3 / demo L130–L140:组标题不折叠(去 details/summary/caret),机器名现为唯一锚点。
        var groups = BR.groupByMachine(partition.active);
        for (var gi = 0; gi < groups.length; gi++) {
            var g = groups[gi];
            var online = g.machine.online !== false;
            var groupLi = document.createElement('li');
            groupLi.className = 'machine-group' + (online ? '' : ' machine-group--offline');
            var title = document.createElement('div');
            title.className = 'machine-group__title';
            var counts = BR.summarizeMachine(g.cards);
            title.innerHTML =
                '<span class="machine-group__name">' + (g.machine.name || g.machine.id) + '</span>' +
                '<span class="machine-group__status machine-group__status--' + (online ? 'online' : 'offline') + '">' +
                (online ? '· 在线' : '· 离线') + '</span>' +
                '<span class="machine-group__counts">' + BR.renderStatusCounts(counts) + '</span>' +
                '<span class="machine-group__total">' + g.cards.length + ' 会话</span>';
            var grid = document.createElement('ul');
            grid.className = 'board-grid';
            for (var ci = 0; ci < g.cards.length; ci++) {
                grid.appendChild(buildCardLi(g.cards[ci]));
            }
            groupLi.appendChild(title);
            groupLi.appendChild(grid);
            boardBody.appendChild(groupLi);
        }
```

此替换**删除**原 `prevOpen`/`prevDetails` 展开记忆(L299–L301)—— 组不再折叠。

- [ ] **Step 4: stale 区删 prevOpen 引用(默认折叠)**

`public/dashboard.js` L333–L334 原引用 `prevOpen['__stale__']`(已删变量)。改为默认折叠:

```javascript
            var details2 = document.createElement('details');
            details2.dataset.mid = '__stale__';
            details2.open = false;   // 陈旧区默认折叠(spec §5:折叠到底部)
```

- [ ] **Step 5: board_render 测试无回归**

Run: `node --test test/board_render.test.cjs`
Expected: PASS(T1/T2 仍绿)。

- [ ] **Step 6: 手动验证(若有 hub 配置)**

`node server.cjs` → `http://localhost:7685/dashboard.html`,确认顶栏(机器文案 + 圆点计数,无 emoji)、组标题(静态一行:机器名 · 在线/离线 + 圆点计数 + N 会话)、卡片(会话名主锚,无 emoji,card__head 一行 + 摘要)。

- [ ] **Step 7: Commit**

```bash
git add public/dashboard.js
git commit -m "feat(dashboard): fleet-summary 色谱计数 + 组标题不折叠(在线/离线标签+状态计数+N会话)+ hub mode"
```

---

## Task 4: dashboard.css — `.card--hub` IA(flex column + card__head + 摘要 line-clamp + 清状态染色)

**Files:**
- Modify: `public/dashboard.css` — 在 `.card__last`(L169)之后新增 `.card--hub` IA 规则块(对齐 demo L75–L88)
- Test: `test/dashboard_style.test.cjs` — 追加 hub IA 断言

**Interfaces:**
- Consumes: T1 输出的 `.card--hub`/`.card__head`/`.card__name`/`.card__off`/`.card__time`/`.card__last`/`.sr-only`;tokens(`--fg`/`--fg-2`/`--fg-3`/`--surface`/`--surface-2`/`--accent-dim`/`--offline`/`--r-sm`/`--mono`)
- Produces(对齐 demo):
  - `.card--hub { display:flex; flex-direction:column; gap:7px; padding:12px 14px; ... }`(覆盖基础 `.card` 的 grid)
  - `.card--hub .card__head { display:flex; align-items:center; gap:8px }`
  - `.card--hub .card__name` 13.5px semibold `--fg`;`.card--hub .card__time` margin-left:auto 11px mono `--fg-2`;`.card--hub .card__off` 10px mono `--offline`
  - `.card--hub .card__last` 13px lh1.45 **min-height:38px**(离线摘要短也不塌) line-clamp:2 `--fg-2`
  - `.card--hub` 清除状态染色/左缘条:`background:var(--surface); box-shadow:none; border-style:solid`,并覆盖 `[data-status="waiting"]` bg / `[data-status="errored"]` 左缘条 / `[data-status="unknown"]` dashed
  - `.card--hub:hover { border-color:var(--accent-dim); background:var(--surface-2) }`
  - `.sr-only` 类定义(demo L99)

- [ ] **Step 1: 写失败测试 — hub IA(对齐 demo 数值)**

追加到 `test/dashboard_style.test.cjs` 末尾:

```javascript
// ============================================================
// Task 4:.card--hub IA(对齐 demo — flex column + card__head + line-clamp + 清状态染色)
// ============================================================
test('T4: .card--hub 用 flex column(非基础 grid)', () => {
  const rule = css.match(/\.card--hub\s*\{[^}]*\}/);
  assert.ok(rule, '.card--hub 规则应存在');
  assert.match(rule[0], /display:\s*flex/);
  assert.match(rule[0], /flex-direction:\s*column/);
});
test('T4: .card--hub .card__head flex 包裹层', () => {
  assert.match(css, /\.card--hub\s+\.card__head\s*\{[^}]*display:\s*flex/);
});
test('T4: hub 摘要 .card--hub .card__last line-clamp:2 + min-height:38 + --fg-2', () => {
  const rule = css.match(/\.card--hub\s+\.card__last\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /-webkit-line-clamp:\s*2/);
  assert.match(rule[0], /min-height:\s*38px/);
  assert.match(rule[0], /var\(--fg-2\)/);
  assert.ok(!/var\(--fg-3\)/.test(rule[0]), 'hub 摘要不应 --fg-3');
});
test('T4: hub 状态点 11px(.card--hub .s-dot)', () => {
  const rule = css.match(/\.card--hub\s+\.s-dot\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /width:\s*11px/);
  assert.match(rule[0], /height:\s*11px/);
});
test('T4: hub 清状态染色 — .card--hub[data-status="errored"] 无左缘条(box-shadow:none)', () => {
  // spec 非目标:errored 只靠色点,不加左缘条。基础 .card[data-status=errored] 有左缘条,hub 必须清。
  const rule = css.match(/\.card--hub\[data-status="errored"\]\s*\{[^}]*\}/);
  assert.ok(rule, '.card--hub[data-status=errored] 覆盖规则应存在');
  assert.match(rule[0], /box-shadow:\s*none/);
});
test('T4: .card--hub hover border+bg(demo L76)', () => {
  assert.match(css, /\.card--hub:hover\s*\{[^}]*border-color:\s*var\(--accent-dim\)/);
  assert.match(css, /\.card--hub:hover\s*\{[^}]*background:\s*var\(--surface-2\)/);
});
test('T4: .sr-only 类定义(色盲状态冗余,demo L99)', () => {
  assert.match(css, /\.sr-only\s*\{[^}]*position:\s*absolute/);
});
test('T4: .card__off 离线标签样式(demo L86)', () => {
  const rule = css.match(/\.card__off\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /var\(--offline\)/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/dashboard_style.test.cjs`
Expected: FAIL — `.card--hub` 等不存在。

- [ ] **Step 3: 实现 .card--hub IA(对齐 demo L75–L88, L99)**

在 `public/dashboard.css` `.card__last`(L169)之后、`/* card--single 已移除 */`(L171)之前插入:

```css
/* === hub 单卡 IA(摘要为中心,对齐 demo /tmp/dashboard-redesign-demo.html L75–L88)===
   board_render hub 模式输出 .card--hub(无 s-icon,card__head 包裹层,会话名主锚)。
   覆盖基础 .card 的 grid 为 flex column;清除状态染色/左缘条(spec:只靠色点)。
   几何(等高/等宽/列宽)见 Task 5;色点环/空心见 Task 7。*/
.card--hub {
  display: flex; flex-direction: column; gap: 7px; padding: 12px 14px;
  background: var(--surface); box-shadow: none; border-style: solid;
}
.card--hub .card__head { display: flex; align-items: center; gap: 8px; }
.card--hub .s-dot { width: 11px; height: 11px; flex-shrink: 0; }
.card--hub .card__name { font-weight: 600; font-size: 13.5px; color: var(--fg); }
.card--hub .card__off { font-family: var(--mono); font-size: 10px; color: var(--offline); margin-left: 6px; }
.card--hub .card__time { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--fg-2); flex-shrink: 0; }
.card--hub .card__last {
  color: var(--fg-2); font-size: 13px; line-height: 1.45; min-height: 38px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
/* hub 清状态染色:waiting 无底色 / errored 无左缘条 / unknown 实线(spec 非目标:只靠色点)*/
.card--hub[data-status="waiting"] { background: var(--surface); }
.card--hub[data-status="errored"] { box-shadow: none; }
.card--hub[data-status="unknown"] { border-style: solid; }
.card--hub:hover { border-color: var(--accent-dim); background: var(--surface-2); }
/* sr-only:色盲/低视力状态冗余(状态不唯一靠色,demo L99) */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/dashboard_style.test.cjs`
Expected: PASS(含 T4 + 原有)。

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.css test/dashboard_style.test.cjs
git commit -m "style(dashboard): .card--hub 摘要为中心 IA(flex column + card__head + line-clamp + 清状态染色)"
```

---

## Task 5: dashboard.css — 几何一致性(固定列宽 244px + 等高 104px + `.card` flex:1 1 0%)

**Files:**
- Modify: `public/dashboard.css`:
  - `.board-grid`(L145)— 列宽 `minmax(220px,1fr)` → `244px` + `grid-auto-rows:104px` + `align-items:stretch`(对齐 demo L64)
  - `.card-row`(L150)+ `.card-row > .card`(L152)— `flex:1 1 auto` → `flex:1 1 0%` + `min-width:0`;`.card-row` 加 `gap:8px`(demo L67)
  - `.card`(L153)— `align-items:center` → `stretch`(让 card-row stretch 传递到卡片高度)
  - `.board-stale-grid`(L192)— 同步 `244px` + `104px`
- Test: `test/dashboard_style.test.cjs` — 追加几何断言

**Interfaces:**
- Consumes: T4 `.card--hub`
- Produces: 所有卡片同高(104px)同宽(`flex:1 1 0%` 吃满列);spec §4/§7「卡片大小不一」真根因修复

**背景(spec §4/§7,demo L64/L75 实测):** `.card-row` 是 row 向 flex(`button.card__select` + `a.card`)。若 `.card` 用 `flex:1 1 auto`(basis=auto),离线卡内容少会缩到 ~106px、在线卡被摘要撑到 217px,眼睛把「变窄 + 内部留白」误读成「变矮」。`flex:1 1 0%`(basis=0)让 grow 吃满剩余主轴 → 所有卡同宽。等高靠 `grid-auto-rows:104px` + 两级 `align-items:stretch`(board-grid → card-row → card)。demo 实测 7 卡统一 217×104。

- [ ] **Step 1: 写失败测试**

追加到 `test/dashboard_style.test.cjs` 末尾:

```javascript
// ============================================================
// Task 5:几何一致性(spec §4/§7,demo L64/L67/L75)
// ============================================================
test('T5: .board-grid 固定列宽 244px(demo L64)', () => {
  assert.match(css, /\.board-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*244px\)/);
});
test('T5: .board-grid 等高 grid-auto-rows:104px', () => {
  assert.match(css, /\.board-grid\s*\{[^}]*grid-auto-rows:\s*104px/);
});
test('T5: .card-row > .card 用 flex:1 1 0%(等宽真根因)', () => {
  assert.match(css, /\.card-row\s*>\s*\.card\s*\{[^}]*flex:\s*1 1 0%/);
  assert.match(css, /\.card-row\s*>\s*\.card\s*\{[^}]*min-width:\s*0/);
});
test('T5: .card-row align-items:stretch + gap:8px(两级 stretch 传等高,demo L67)', () => {
  assert.match(css, /\.card-row\s*\{[^}]*align-items:\s*stretch/);
  assert.match(css, /\.card-row\s*\{[^}]*gap:\s*8px/);
});
```

- [ ] **Step 1b: 删除现有「卡片网格 auto-fill minmax」断言(与新 244px 冲突)**

`test/dashboard_style.test.cjs` 现有 L83–L85 测试锁 `minmax(220px,1fr)`:

```javascript
test('卡片网格 auto-fill minmax(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)/);
});
```

本 task 把 `.board-grid` 改为固定 `244px`(无 minmax),此断言会破。上面新增的 `T5: .board-grid 固定列宽 244px` 已覆盖该契约(且含 `auto-fill`)。**删除整条 L83–L85 测试**(含 `test(...)` 骨架),避免重复 + 冲突。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/dashboard_style.test.cjs`
Expected: FAIL — 新 T5 断言(`244px` / `flex:1 1 0%` / `gap:8px`)不匹配(L83-85 已删,不再报那条)。

- [ ] **Step 3: 改 .board-grid(对齐 demo L64)**

替换 `public/dashboard.css` L145:

```css
.board-grid { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill, 244px); grid-auto-rows:104px; gap:10px; align-items:stretch; }
```

- [ ] **Step 4: 改 .card-row / .card 等宽 + 两级 stretch + gap(对齐 demo L67/L75)**

替换 `public/dashboard.css` L150–L153 的 `.card-row` / `.card-row > .card__select` / `.card-row > .card` 三行,并把 `.card`(L153)的 `align-items:center` 改 `stretch`:

```css
.card-row { list-style:none; display:flex; align-items:stretch; gap:8px; }
.card-row > .card__select { flex:0 0 auto; }
.card-row > .card { flex:1 1 0%; min-width:0; }
```

`.card`(L153)规则块内 `align-items:center` → `align-items:stretch;`(其余保留)。

- [ ] **Step 5: 同步 stale-grid 固定列宽**

替换 `public/dashboard.css` L192:

```css
.board-stale-grid { display: grid; grid-template-columns: repeat(auto-fill, 244px); grid-auto-rows: 104px; gap: 10px; list-style: none; padding: 0; margin: 0; }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test test/dashboard_style.test.cjs`
Expected: PASS。

- [ ] **Step 7: Playwright 几何实测(7 卡同高同宽)**

实现者打开 hub 看板(或本地 7 卡 mock),断言所有 `.card` `boundingClientRect.width` 一致、`height`≈104(spec §7 核心验收)。

- [ ] **Step 8: Commit**

```bash
git add public/dashboard.css test/dashboard_style.test.cjs
git commit -m "fix(dashboard): 卡片几何一致性(244px 固定列宽 + 104px 等高 + flex:1 1 0% 修等宽根因)"
```

---

## Task 6: dashboard.css — 组标题样式 + 多选 button 24×24 三态 + 卡级 :has() 选中高亮 + 离线机组弱化

**Files:**
- Modify: `public/dashboard.css`:
  - `.machine-group` 段(L245–L259)— 改静态标题(去 caret/summary 折叠态)+ 新增 `.machine-group__title`/`.machine-group__status(--online/--offline)`/`.machine-group__counts`/`.machine-group__total`/`.status-count`(对齐 demo L46–L61)
  - `.card__select` 段(L262–L265)— 改 24×24 + 三态颜色(demo L68–L72)+ `card-row:hover` 联动 + 卡级 `:has()` 高亮(demo L91)+ 离线机组弱化(demo L94–L96)
  - `.fleet-counts`/`.fleet-machine-text`/`.fleet-summary` 顶栏锚(demo L28–L32)
- Modify: `test/dashboard_style.test.cjs` — 追加 T6 断言;**改现有 L125** `.card__select min-height:44` → `24`(SC 2.5.8 命中区,对齐 demo L68)

**Interfaces:**
- Consumes: T3 输出的 `.machine-group__title/__status/__counts/__total`/`.fleet-counts`/`.fleet-machine-text`;T2 `.status-count`(嵌套 s-dot)
- Produces(对齐 demo):组标题静态排版本;多选 button 24×24 三态 + hover 联动 + 卡级选中高亮;离线机组 cursor not-allowed + hover 抑制

**⚠️ Breaking:** `.card__select` 由 44px → 24px(对齐 demo L68 + spec §8 SC 2.5.8)。现有测试 L125 锁 44px 需同步改 24px。44→24 是 demo 定标(spec §1「24×24 命中区」),满足 WCAG 2.2 SC 2.5.8(最小 24×24)。

- [ ] **Step 1: 写失败测试**

追加到 `test/dashboard_style.test.cjs` 末尾:

```javascript
// ============================================================
// Task 6:组标题 + 多选 button 24×24 + 卡级 :has() + 离线机组(对齐 demo)
// ============================================================
test('T6: 组标题静态容器 .machine-group__title 存在(不折叠)', () => {
  assert.match(css, /\.machine-group__title\s*\{/);
});
test('T6: 组标题在线/离线标签 .machine-group__status', () => {
  assert.match(css, /\.machine-group__status--online/);
  assert.match(css, /\.machine-group__status--offline/);
});
test('T6: 组标题计数容器 .machine-group__counts + .machine-group__total(N 会话)', () => {
  assert.match(css, /\.machine-group__counts\s*\{/);
  assert.match(css, /\.machine-group__total\s*\{[^}]*margin-left:\s*auto/);
});
test('T6: .status-count inline-flex(色谱圆点+数字,demo L54)', () => {
  assert.match(css, /\.status-count\s*\{[^}]*display:\s*inline-flex/);
});
test('T6: .card__select 24×24 命中区(demo L68,SC 2.5.8)', () => {
  const rule = css.match(/\.card__select\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /min-height:\s*24px/);
  assert.match(rule[0], /min-width:\s*24px/);
});
test('T6: .card__select 默认 --fg-3 / hover --fg-2 / 选中 --fg + --accent-dim 边框(demo L68–L71)', () => {
  const base = css.match(/\.card__select\s*\{[^}]*\}/);
  assert.match(base[0], /var\(--fg-3\)/);
  assert.match(css, /\.card__select:hover\s*\{[^}]*var\(--fg-2\)/);
  const sel = css.match(/\.card__select\[aria-pressed="true"\]\s*\{[^}]*\}/);
  assert.match(sel[0], /var\(--fg\)/);
  assert.match(sel[0], /var\(--accent-dim\)/);
});
test('T6: 卡级 :has() 选中高亮(demo L91)', () => {
  assert.match(css, /\.card-row:has\(\.card__select\[aria-pressed="true"\]\)\s+\.card\s*\{[^}]*border-color:\s*var\(--accent\)/);
  assert.match(css, /\.card-row:has\(\.card__select\[aria-pressed="true"\]\)\s+\.card\s*\{[^}]*background:\s*var\(--accent-bg\)/);
});
test('T6: 离线机组 cursor:not-allowed + hover 抑制(demo L94–L95)', () => {
  assert.match(css, /\.machine-group--offline\s+\.card\s*\{[^}]*cursor:\s*not-allowed/);
  assert.match(css, /\.machine-group--offline\s+\.card:hover\s*\{[^}]*background:\s*var\(--surface\)/);
});
test('T6: .fleet-machine-text + .fleet-counts 顶栏锚', () => {
  assert.match(css, /\.fleet-machine-text\s*\{/);
  assert.match(css, /\.fleet-counts\s*\{/);
});
```

- [ ] **Step 2: 改现有 L125 断言 44→24 + 删 L182-188 组折叠 focus 测试**

(a)`test/dashboard_style.test.cjs` L125(「三页面样式」聚合测试内):

```javascript
  assert.match(css, /\.card__select\b[^}]*min-height:\s*24/);   // 触摸目标改 24×24(SC 2.5.8,demo L68)
```

(b)**删除整条** L182–L188 `P6:机分组 summary(普通组)有 :focus-visible` 测试:

```javascript
test('P6:机分组 summary(普通组)有 :focus-visible(原仅 stale-group 有)(迁自 console_style)', () => {
  assert.match(css, /\.machine-group\s*>\s*details\s*>\s*summary:focus-visible[\s\S]*?outline/);
});
```

理由:本 task Step 4 把普通组 `.machine-group` 从 `<details><summary>` 折叠态改为静态 `<div class="machine-group__title">`(spec §3 不折叠)。CSS 规则 `.machine-group > details > summary:focus-visible`(L250)随之删除,该测试失锚。stale 区仍用 `<details><summary>`,其 `:focus-visible`(L188 `.board-stale-group > details > summary:focus-visible`)保留不受影响。

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/dashboard_style.test.cjs`
Expected: FAIL(T6 断言 + 改后的 L125)。

- [ ] **Step 4: 改组标题段(对齐 demo L46–L61)**

整体替换 `public/dashboard.css` L245–L259(从 `.machine-group{margin-bottom:14px}` 到 `.machine-group .board-grid{margin-top:4px}`):

```css
/* === 三页面:看板按机分节(spec §3 / demo L46–L61 — 组标题增强,不折叠)=== */
.machine-group { margin-bottom: 26px; }
.machine-group__title {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 6px 2px 10px; border-bottom: 1px solid var(--border); margin-bottom: 14px;
}
.machine-group__name { font-weight: 600; font-size: 14px; color: var(--fg); }
.machine-group__status { font-family: var(--mono); font-size: 11px; }
.machine-group__status--online { color: var(--working); }
.machine-group__status--offline { color: var(--offline); }
.machine-group__counts { display: inline-flex; align-items: center; gap: 11px; margin-left: 4px; }
.machine-group__total { margin-left: auto; font-size: 12px; color: var(--fg-2); font-family: var(--mono); }
/* 状态计数:色谱圆点 + 数字(无 emoji 无 ×,demo L54)*/
.status-count { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 11px; color: var(--fg-2); }
.status-count .s-dot { width: 7px; height: 7px; }
.status-count .s-dot--offline { border-width: 1.2px; }   /* 8→7px 小点用细边 */
/* P5:离线机组弱化(机名 --fg-2 已达 AA) */
.machine-group--offline .machine-group__name { color: var(--fg-2); font-weight: 400; }
.machine-group .board-grid { margin-top: 4px; }
```

- [ ] **Step 5: 改 .card__select 24×24 三态 + 联动 + :has() + 离线机组(对齐 demo L68–L96)**

整体替换 `public/dashboard.css` L261–L265 的 `.card__select` 段:

```css
/* 卡片多选交互态(demo L68–L72 — 24×24 命中区,默认 --fg-3,hover --fg-2,选中 --fg + --accent-dim 边框)。
   选中由 JS 加 aria-pressed=true;卡级 :has() 高亮防漏看(demo L91)。*/
.card__select {
  border: 1px solid transparent; background: transparent; color: var(--fg-3);
  cursor: pointer; font-size: 13px; line-height: 1; padding: 0 5px; border-radius: var(--r-sm);
  align-self: flex-start; margin-top: 10px; min-height: 24px; min-width: 24px;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
}
.card-row:hover .card__select { color: var(--fg-2); }
.card__select:hover { color: var(--fg-2); background: var(--accent-bg); }
.card__select[aria-pressed="true"] { color: var(--fg); background: var(--accent-bg); border-color: var(--accent-dim); }
.card__select:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
/* 卡级选中高亮(demo L91 — 只写小按钮会被漏看,曾误判卡片消失)*/
.card-row:has(.card__select[aria-pressed="true"]) .card { border-color: var(--accent); background: var(--accent-bg); }
/* 离线机组弱化:抑制可点击感,hover 压回默认(demo L94–L96)*/
.machine-group--offline .card { cursor: not-allowed; }
.machine-group--offline .card:hover { border-color: var(--border); background: var(--surface); }
.machine-group--offline .card__last { color: var(--fg-2); }
/* 顶栏 fleet 计数 + 机器文案锚(demo L28–L32)。.fleet-summary 基础几何(font-size:.95em /
   display:flex / gap:10px / color:--fg-2)已在 L124 console 段定义,且被 L108 测试锁定
   (font-size:\.9 正则匹配 .95em)。此处**不重定义** .fleet-summary —— 只补子元素锚,避免破 L108。*/
.fleet-machine-text { color: var(--fg-2); font-family: var(--mono); }
.fleet-counts { display: inline-flex; align-items: center; gap: 12px; }
.fleet-counts .status-count .s-dot { width: 8px; height: 8px; }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test test/dashboard_style.test.cjs`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add public/dashboard.css test/dashboard_style.test.cjs
git commit -m "style(dashboard): 组标题静态化 + 多选 24×24 三态 + 卡级 :has() 高亮 + 离线机组弱化"
```

---

## Task 7: a11y — 色点(working/errored 环 + offline 空心)+ tokens `--idle` 0.55 + reduced-motion

**Files:**
- Modify: `public/tokens.css` — `--idle`(L31)`0.3` → `0.55`
- Modify: `public/dashboard.css`:
  - `.s-dot--working`(tokens 已有 bg)— 加环 `box-shadow:0 0 0 3px rgba(31,138,101,.18)`(demo L80)
  - `.s-dot--errored` — 加环 `rgba(192,26,75,.20)`(demo L82)
  - `.s-dot--offline`(L196)— 改空心环 `background:transparent;border:1.5px solid var(--offline)`(demo L84)
  - `prefers-reduced-motion`(L239–L242)— 补 `.card__select`(demo L106)
- Test: `test/dashboard_style.test.cjs` — 追加 T7 断言

**Interfaces:**
- Consumes: tokens 全局(`--idle` 三页共用 —— spec §8 决策11 明确要改)
- Produces: idle 色点对比过 3:1;working/errored 活跃环;offline 空心环(与 idle 实心形状区分,不靠 alpha);reduced-motion 禁多选过渡

- [ ] **Step 1: 写失败测试**

追加到 `test/dashboard_style.test.cjs` 末尾:

```javascript
// ============================================================
// Task 7:a11y(色点环/空心 + --idle 对比度 + reduced-motion,对齐 demo)
// ============================================================
test('T7: tokens --idle 提至 ≥0.55(图形对比过 3:1)', () => {
  const tokens = require('node:fs').readFileSync(require('path').join(__dirname, '..', 'public', 'tokens.css'), 'utf8');
  const m = tokens.match(/--idle:\s*rgba\(38,\s*37,\s*30,\s*(0?\.\d+)\)/);
  assert.ok(m, '--idle 规则应存在');
  assert.ok(parseFloat(m[1]) >= 0.5, '--idle alpha 应 ≥ 0.5(实得 ' + m[1] + ')');
});
test('T7: .s-dot--working 活跃环 rgba(demo L80)', () => {
  const rule = css.match(/\.s-dot--working\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /box-shadow:[^}]*rgba\(31,\s*138,\s*101/);
});
test('T7: .s-dot--errored 活跃环 rgba(demo L82)', () => {
  const rule = css.match(/\.s-dot--errored\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /box-shadow:[^}]*rgba\(192,\s*26,\s*75/);
});
test('T7: .s-dot--offline 空心环(与 idle 实心形状区分,demo L84)', () => {
  const rule = css.match(/\.s-dot--offline\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /background:\s*transparent/);
  assert.match(rule[0], /border[^}]*var\(--offline\)/);
});
test('T7: reduced-motion 覆盖 .card__select(demo L106)', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\.card__select[\s\S]*?transition:\s*none/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/dashboard_style.test.cjs`
Expected: FAIL — `--idle` 仍 0.3;色点环/空心未加。

- [ ] **Step 3: 改 tokens.css --idle(对齐 demo L14)**

替换 `public/tokens.css` L31:

```css
  --idle: rgba(38,37,30,0.55);   /* 图形对比过 WCAG 3:1(原 0.3 不足;spec §8 决策11) */
```

- [ ] **Step 4: 加 working/errored 环 + offline 空心(对齐 demo L80–L84)**

在 `public/dashboard.css` 的 `.s-dot--offline`(L196)所在的状态点增强段,改为(替换 L194–L198 的 `.s-dot--idle`/`.s-dot--offline`/`.s-icon` 三行):

```css
/* 状态点增强(demo L80–L84):working/errored 同色环(活跃更跳但克制);idle 实心;offline 空心环(形状区分,不靠 alpha)*/
.s-dot--working { box-shadow: 0 0 0 3px rgba(31,138,101,0.18); }
.s-dot--errored { box-shadow: 0 0 0 3px rgba(192,26,75,0.20); }
.s-dot--idle { box-shadow: 0 0 0 1.5px var(--fg-2); }   /* idle 描边达非文本 3:1(保留原 P5 修正)*/
.s-dot--offline { background: transparent; border: 1.5px solid var(--offline); box-sizing: border-box; }
.s-icon[aria-hidden="true"] { color: var(--fg-2); }
.s-icon { font-variant-emoji: text; }
```

注:`.s-dot--idle` 原 `box-shadow:0 0 0 1.5px var(--fg-2)` 保留(描边达 3:1);`--idle` 0.55 后实心更明显,描边仍作冗余。

- [ ] **Step 5: 补 reduced-motion .card__select(对齐 demo L106)**

替换 `public/dashboard.css` L239–L242:

```css
@media (prefers-reduced-motion: reduce) {
  .card, .card__select, #ma-screen { transition: none; }
  .card:hover { transform: none; }
}
```

- [ ] **Step 6: 跑全量测试确认绿**

Run: `node --test test/*.test.cjs`
Expected: PASS(`#ma-screen` 在 T8 前仍存,reduced-motion 引用不报错)。

- [ ] **Step 7: Commit**

```bash
git add public/tokens.css public/dashboard.css test/dashboard_style.test.cjs
git commit -m "fix(a11y): 色点环/空心 + --idle 0.55 + reduced-motion 覆盖多选按钮"
```

---

## Task 8(⚠️ 可选 fast-follow,非本 plan 阻塞):死 CSS 清理

> **本 task 为 deferred。T1–T7 完成 = plan 完成态(见末尾验收)。**
>
> 死 CSS 清理是 spec「顺带」目标,与 IA 重设计(摘要为中心)正交。基线全绿(603 pass),而本 task 牵连 **10+ 条现有测试**:`.ma-warn-line`(L27-29/L95-102)、`--term-bg/--term-fg`(L68-77)、`--waiting-bg`(L86-88)、`#ma-screen`(L126-128)、`.console-term`(L128/L135)、`.ma-btn`(L148-150)、`.topbar-back`(L195-197)、`#term-input`(L192-194/L217-221)、显隐 `[hidden]`(L134-136)。删 CSS 须**逐条同步删/改对应断言**,工作量与回归风险均高于 T1–T7。
>
> **建议:拆为独立 PR 单独评审,不在本次 subagent 流程内强制执行。** 下方保留完整清理清单 + 测试映射表供独立 PR 使用。subagent 执行本 plan 时**可跳过 T8**。

**Files(独立 PR 时):**
- Modify: `public/dashboard.css` — 删除已删 console.html 遗留死 CSS
- Modify: `test/dashboard_style.test.cjs` — 删除/改锚锁死 CSS 的假阳性断言
- Test: 全量 `node --test test/*.test.cjs` 保持绿

**Interfaces:**
- Consumes: dashboard.html + 动态 JS 注入的 class 白名单
- Produces: dashboard.css 仅保留实际使用的规则

**⚠️ 高风险。** 实现者必须先建立 class 白名单,逐一核对每条删除规则不在白名单内。

**死 CSS → 测试映射表(独立 PR 须同步处理):**

| 死 CSS(dashboard.css) | 锁它的测试(dashboard_style.test.cjs) |
|---|---|
| `.console-topbar` L118–123(含 `.topbar-back`) | L195–197(`.topbar-back:focus-visible`) |
| `.console-hero` 全段 L127–136(含 `.ma-warn-line`) | L27–29、L95–102(`.ma-warn-line`) |
| `.dot`/`.dot.running`/`.dot.stopped` L139–141 | 无(零风险,可先删) |
| `.ma-btn` L142 | L148–150(`.ma-btn min-height:44`) |
| `.console-term` 全段 L200–227(含 `#term-input`) | L68–77(`--term-bg/--term-fg`)、L128(`.console-term flex:1`)、L135(`.console-term[hidden]`)、L192–194/L217–221(`#term-input`) |
| L294 `#main-agent-panel[hidden], .console-term[hidden]` | L134–136(显隐兜底,保留 `.fanout-bar[hidden]` L139) |
| `.console-app` L111–115(`--term-bg/--term-fg/--waiting-bg` 宿主) | L68–77、L86–88 —— ⚠️ **token 宿主,删须先迁移 token 或同步删基础 `.card[data-status=waiting]`(L162)引用** |
| `#ma-screen` L138 + L286 | L126–128 |
| 移动端 `.console-hero` 媒体查询 L228–237 | 无(随 `.console-hero` 删) |

**dashboard.html 实际引用(白名单,不可删):** `#app` `.header` `.logo` `.app-logo` `#title` `#fleet-summary`/`.fleet-summary` `#board-stale`/`.board-stale` `.topbar-logout-form` `.topbar-logout-btn` `.main` `.visually-hidden` `#sessionList`/`.session-list` `#board-body`/`.board-body` `#stateMessage`/`.state-message` `.eyebrow` `.lede` `#fanout-bar`/`.fanout-bar` `.sel-count` `.sel-clear` `.term-input` `.term-badge` `.bc-result`

**dashboard.js / board_render.cjs 动态注入(白名单):** `.card-row` `.card__select` `.card`/`.card--hub`/`.card--selected`/`.active` `.s-dot`(+各 `--*`) `.card__head` `.card__name` `.card__time` `.card__last` `.card__off` `.sr-only` `.machine-group`/`--offline` `.machine-group__title/__name/__status/--online/--offline/__counts/__total` `.status-count` `.fleet-counts` `.fleet-machine-text` `.board-empty` `.board-grid` `.board-stale-group` `.board-stale-grid` `.session`/`.session--flash`/`.session.waiting` `.s-main` `.s-name` `.s-meta` `.s-id`

**确认死 CSS(可删):** `.console-app` `.console-hero`(.disabled 及其内 eyebrow/hero-title/hero-l1/hero-callout/ma-warn-line) `.console-topbar` `.topbar-back` `.dot`/`.dot.running`/`.dot.stopped` `.ma-btn` `.console-term` 全段(term-header/#term-target/term-collapse-btn/term-fullscreen-btn/#term-screen/term-input-form/#term-input/term-prompt) `#ma-screen`(两处) `#main-agent-panel[hidden]`/`.console-term[hidden]`/`.tab[hidden]` 移动端 `.console-hero` 媒体查询

**⚠️ 保留(易误删):** `.console-board`(L144)自身可删,但其后 `.board-grid`/`.board-body`/`.board-empty`/`.card-row`/`.card` 全段是 dashboard 在用,必须保留。`.fleet-summary`(L124)/`.board-stale`(L104)保留。`.term-badge`(L217)/`.bc-result`(L282)是 fanout 用,保留。`.s-dot--*`(T7 改过)保留。

- [ ] **Step 1: 全量基线(清理前绿)**

Run: `node --test test/*.test.cjs`
Expected: PASS — 记录测试数作回归基线。

- [ ] **Step 2: 删除 dashboard.css 死 CSS 段**

按「确认死 CSS」清单删除:
- `.console-app`(L111–L115)
- `.console-hero.disabled`(L116)
- `.console-topbar` 全段(L118–L123)
- `.console-hero` 全段(L127–L133)
- `.ma-warn-line`(L136)
- `#ma-screen`(L138)
- `.dot`/`.dot.running`/`.dot.stopped`(L139–L141)
- `.ma-btn`(L142)
- `.console-term` 全段(L200–L227)
- `#ma-screen` 重复块(L286)
- `#main-agent-panel[hidden], .console-term[hidden], .tab[hidden]`(L294 整行)
- 移动端 `.console-hero` 媒体查询(L228–L237 内的 `.console-hero` 规则)

**保留:** `.console-board`(L144)自身可删,但其后 `.board-grid`/`.board-body`/`.board-empty`/`.card-row`/`.card` 等保留。`.fleet-summary`(L124)/`.board-stale` 保留。`.term-badge`(L217)/`.bc-result`(L282)保留。

- [ ] **Step 3: 清理 dashboard_style.test.cjs 假阳性断言**

删除/改写以下锁死 CSS 的测试:
- `'.ma-warn-line retained'`(L27–L29)— 删
- `'.ma-btn 触摸目标 ≥44px'`(L148–L150)— 删
- 「三页面样式」聚合测试(L120–L129)内的 `#ma-screen flex/max-height`(L126–L127)+ `.console-term flex:1` (L128)— 从 assert 列表移除
- `'P3 回归防护:.ma-warn-line'`(L95–L102)— 删
- 「显隐兜底」测试(L131–L140)内的 `#main-agent-panel[hidden]`/`.console-term[hidden]`/`.tab[hidden]`(L134–L136)— 移除,仅保留 `.fanout-bar[hidden]`(L139)
- `'#term-input 显式 font-size:16px'`(L217–L221)— 删
- `'.topbar-back 有 :focus-visible'`(L195–L197)— 删

保留:所有 `.card`/`.card-row`/`.card__select`/`.machine-group`/`.fanout-bar`/`.board-grid`/`.fleet-summary`/`.s-dot` 相关活断言。

- [ ] **Step 4: 跑全量测试确认绿**

Run: `node --test test/*.test.cjs`
Expected: PASS — 测试数 ≤ 基线(删了假阳性),无 FAIL。

- [ ] **Step 5: 手动核对 dashboard 渲染无裸奔**

打开 `:7685/dashboard.html`,确认顶栏/看板/扇出 bar/组标题/卡片视觉与 T6 完成态一致(死 CSS 删除不应改变渲染 —— 这些 class 本就无对应 HTML)。

- [ ] **Step 6: Commit**

```bash
git add public/dashboard.css test/dashboard_style.test.cjs
git commit -m "chore(dashboard): 清理已删 console.html 遗留死 CSS + 假阳性测试断言"
```

---

## 完成态验收(全部 task 后)

- [ ] `node --test test/*.test.cjs` 全绿
- [ ] hub 看板(`:7685`)Playwright 实测(对照 `/tmp/dashboard-redesign-demo.html`):
  - 顶栏:机器文案「N 机在线 · M 机离线 · K 会话」+ 色谱圆点计数,点和 = 会话总数,无 emoji 无 ×
  - 组标题:静态一行(不折叠),机器名 + · 在线/· 离线 + 圆点计数 + 「N 会话」(推右)
  - 卡片:`card__head` 一行(状态点 + 会话名 + sr-only + 时间),摘要 2 行,所有卡同高(≈104px)同宽
  - 状态点:working/errored 同色环;idle 实心;offline 空心环
  - 离线卡:「离线」标签 + 「Nh 前在线」+ 占位摘要 + `aria-disabled` + cursor not-allowed
  - 多选:24×24 button,点选后卡级 `:has()` 高亮(border + accent-bg)+ button 加边框
  - errored 卡:只靠玫红色点 + 环(摘要不染色、无左缘条、无底色)
  - 单机 `:7684`:旧排版不变(机器名主 + 会话名副行)
- [ ] 不变项契约未破:`/jump` 新标签跳转、多选扇出广播、cookie 隔离
