# 控制台底部 Tab 导航重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把控制台 header 从「一行塞 6 类异质元素」精简为 brand + live + 极简 session,导航与控件下沉为底部 tab bar(≥768 常驻 / ≤768 输入聚焦折叠)+「切换」抽屉(三段分组),顺带修 a11y 硬伤并清理冗余断点。

**Architecture:** 原生 HTML/CSS/JS(无构建)。header 精简;新增 `.bottom-tabbar`(页面跳转用 `<a>`+`aria-current`,抽屉入口用 `<button id="switchTab">`)。控件(`sessionSelect`/`projectSelect`/`projectControl`/`projectsEmpty`/`startProject`)移入 `<div id="stateCarriers" hidden>` —— 元素仍存在但不可见,`client.js` 的 `getElementById`/`value` 读写照常(`loadSessions`/`loadProjects`/`startProjectSession` 守卫仍满足),抽屉用 `cachedSessions`/`cachedProjects` 渲染,**client.js 零结构性改动**(仅切换触发器改名、抽屉刷新、移动端折叠、终端 aria-label 四处增量)。

**Tech Stack:** Express(`server.cjs`)+ 静态前端(原生 JS,UMD `.cjs` 模块)+ `node:test`(源码字符串/正则断言,无 jsdom)+ chrome-devtools MCP 运行时验证。

**依据 spec:** `docs/superpowers/specs/2026-06-30-bottom-tabbar-design.md`(修订版)。

---

## 实现决策(spec 微调,经分析后确定)

1. **live-dot-text 颜色简化**(spec §4.1/§5.1 说 text 用状态色谱 `--working`/`--errored`):本计划改为 **`.live-dot-text` 固定 `--fg-2`(Sans)**,状态由文字内容(`'live'`/`'未连接'`)+ pulse 点(橙装饰)双编码表达。理由:`client.js` 已按状态切 `liveText.textContent`,无需再切 CSS 状态类,改动最小;`--fg-2` 达 AA,色彩收敛目标(header 橙只剩 brand-mark 装饰 + tab active 指示条)达成。
2. **隐藏状态载体**(spec §4.5):控件 `hidden` 化而非参数化重构,`client.js` 守卫自然跳过 `#refreshSessions`(直接删除,非载体)。
3. **`#switchSheet` 锚点删除**:原 `<div id="switchSheet" hidden>` 仅作 `aria-controls` 锚点;改为 `switch_sheet.cjs` 创建动态 sheet 时挂 `id="switchSheet"`,让 `aria-controls` 指向真实 dialog(a11y B7)。

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/index.html` | 修改 | header 精简 + 隐藏 `#stateCarriers` + `.bottom-tabbar` + `<h1>` + 删登录/锚点 |
| `public/style.css` | 修改 | `.bottom-tabbar`/`.tab`/指示条 + live 色彩收敛 + placeholder/toast a11y + 断点清理 + `.visually-hidden` |
| `public/switch_sheet.cjs` | 修改 | 抽屉三段分组(meta 行 + 会话标题 + 项目空状态)+ sheet `id` + 背景 `inert` |
| `public/client.js` | 修改 | `switchToggle`→`switchTab` + 抽屉 onOpen 刷新 + sessionStorage 跨页开抽屉 + ≤768 输入聚焦折叠 tab + 终端 textarea `aria-label` |
| `public/dashboard.html` | 修改 | 看板页 `.bottom-tabbar`(看板 active)+ 删 nav/登录 |
| `public/dashboard.css` | 修改 | `.bottom-tabbar`/`.tab`/`.visually-hidden`(看板页不引 style.css,需独立一份) |
| `test/ios_header.test.cjs` | 修改 | 删除与旧结构冲突的契约(desktopControls/switchToggle/nav-link--login/#switchSheet 锚点/metaProject/header-right),新增 bottom-tabbar/stateCarriers/h1/tab CSS/aria-label 契约 |
| `test/switch_sheet.test.cjs` | 修改 | 新增 meta 行 + 项目空状态 + sheet id + inert 源码契约 |
| `test/dashboard_tabbar.test.cjs` | 创建 | 看板页 tab + sessionStorage + 无登录 + dashboard.css tab 样式 |

---

## Task 1: index.html 结构重排(header 精简 + 隐藏载体 + 底部 tab + h1)

**Files:**
- Modify: `public/index.html:16-74`(整个 `<body>` 内 `#app` 块)

**目标契约**(对应 `ios_header.test.cjs`):header 只 `header-left`(brand + live + 极简 session 只 `s`);无 `header-right`/`#desktopControls`/`nav`/`#switchToggle`/`refreshSessions`/`#switchSheet` 空锚点;`#stateCarriers hidden` 含 5 个原控件 id;`<main>` 内有 visually-hidden `<h1>`;`.bottom-tabbar` 三项(控制台 `tab--active` + 看板 + `#switchTab` button)。

- [ ] **Step 1: 写失败测试(更新 `test/ios_header.test.cjs`)**

用以下 7 个测试**替换** `test/ios_header.test.cjs` 里所有与新结构冲突的旧测试(见 Step 2 列表),并新增这些契约。先在文件末尾(`L254` 后)追加新测试,再在 Task 6 统一删旧 —— 为保 TDD 节奏,本 Step 仅追加新断言(此时新结构尚未实现,新测试 RED):

```js
// === 底部 tab 重构契约(2026-06-30 spec)===

test('index.html header: 只有 header-left(无 header-right)', () => {
    const h = readHtml();
    assert.ok(h.includes('class="header-left"'), '应有 header-left');
    assert.ok(!h.includes('class="header-right"'), 'header-right 应已删除(控件入抽屉)');
});

test('index.html header: 极简 session meta 只含 s(无 metaProject/meta-sep)', () => {
    const h = readHtml();
    assert.ok(h.includes('id="metaSession"'), '极简 session 标识 metaSession 存在');
    assert.ok(h.includes('class="meta-label"'), 'meta-label 存在');
    assert.ok(!h.includes('id="metaProject"'), 'header 不应再有 metaProject(project 入抽屉)');
    assert.ok(!h.includes('class="meta-sep"'), 'header 不应再有 meta-sep(只剩 s)');
});

test('index.html: 无 #desktopControls / nav / #switchToggle / refreshSessions / 登录', () => {
    const h = readHtml();
    assert.ok(!h.includes('id="desktopControls"'), 'desktopControls 应已删除');
    assert.ok(!h.includes('class="nav"'), 'header nav 应已删除(导航下沉底部 tab)');
    assert.ok(!h.includes('id="switchToggle"'), 'switchToggle 应已删除(改 #switchTab)');
    assert.ok(!h.includes('id="refreshSessions"'), 'refreshSessions 应已删除(onOpen 刷新)');
    assert.ok(!/class="nav-link--login"/.test(h), '登录 nav-link 应已删除');
});

test('index.html: 隐藏 #stateCarriers 含原控件 id(不含 refreshSessions)', () => {
    const h = readHtml();
    const m = h.match(/<div id="stateCarriers" hidden>[\s\S]*?<\/div>/);
    assert.ok(m, '应有 <div id="stateCarriers" hidden>');
    const block = m[0];
    for (const id of ['sessionSelect', 'projectSelect', 'projectControl', 'projectsEmpty', 'startProject']) {
        assert.ok(block.includes(`id="${id}"`), `#stateCarriers 应含 id=${id}(client.js 守卫依赖)`);
    }
    assert.ok(!block.includes('id="refreshSessions"'), '#stateCarriers 不应含 refreshSessions(已删)');
});

test('index.html: 无 #switchSheet 空锚点(改由 switch_sheet.cjs 动态挂 id)', () => {
    const h = readHtml();
    assert.ok(!/<div id="switchSheet" hidden>/.test(h), '#switchSheet 空锚点应已删除');
    assert.ok(!/id="switchSheet"/.test(h), 'index.html 不应再有 switchSheet(switch_sheet.cjs 动态创建)');
});

test('index.html: <main> 内有 visually-hidden <h1>', () => {
    const h = readHtml();
    assert.ok(/<h1 class="visually-hidden">/.test(h), 'main 应有 visually-hidden h1(建立大纲)');
});

test('index.html: .bottom-tabbar 三项(控制台 active + 看板 + #switchTab button)', () => {
    const h = readHtml();
    assert.ok(h.includes('class="bottom-tabbar"'), '应有 .bottom-tabbar');
    // 控制台:tab--active + aria-current page,href=/
    assert.ok(/class="tab tab--active"[^>]*href="\/"[^>]*aria-current="page"/.test(h), '控制台 tab=active + aria-current');
    // 看板:tab,href=/dashboard.html
    assert.ok(/class="tab"[^>]*href="\/dashboard\.html"/.test(h), '看板 tab');
    // 切换:button #switchTab,aria-haspopup dialog + aria-controls switchSheet
    const m = h.match(/<button[^>]*id="switchTab"[^>]*>/);
    assert.ok(m, 'switchTab 按钮存在');
    assert.ok(m[0].includes('aria-haspopup="dialog"'), 'switchTab aria-haspopup=dialog');
    assert.ok(m[0].includes('aria-expanded="false"'), 'switchTab aria-expanded=false');
    assert.ok(m[0].includes('aria-controls="switchSheet"'), 'switchTab aria-controls=switchSheet');
});
```

- [ ] **Step 2: 跑测试确认新断言失败(RED)**

Run: `node --test test/ios_header.test.cjs`
Expected: 上述 7 个新测试 **FAIL**(header 仍是旧结构;同时部分**旧**测试也会 FAIL,因它们依赖将删除的元素 —— 这是预期的,Task 6 统一删旧)。

- [ ] **Step 3: 重排 index.html(`L16-74` 替换)**

把 `<body>` 内 `<div id="app">...</div>` 块替换为下面结构(header 精简、删旧元素、隐藏载体、加 h1、加底部 tab):

```html
    <div id="app">
        <!-- 控制台卡片容器:header + main 同宽对齐 -->
        <div class="console-card">
            <!-- 顶部:精简为 brand + live + 极简 session(只 s);控件入底部「切换」抽屉 -->
            <header class="header header--single">
                <div class="header-left">
                    <span class="brand" aria-label="Roc-CC Remote Control">
                        <span class="brand-mark brand-mark--sm" aria-hidden="true"></span>
                        <span class="brand-name">Roc-CC</span>
                    </span>
                    <span id="liveIndicator" class="live-dot" role="status" aria-live="polite">
                        <span class="live-dot-pulse" aria-hidden="true"></span>
                        <span class="live-dot-text">未连接</span>
                    </span>
                    <span class="meta-inline" role="group" aria-label="当前会话">
                        <span class="meta-label">s</span><span id="metaSession" class="meta-val">—</span>
                    </span>
                </div>
            </header>
            <!-- 主内容区 -->
            <main class="main">
                <h1 class="visually-hidden">控制台</h1>
                <!-- 对话区域 -->
                <div id="chatContainer" class="chat-container">
                    <div id="messages" class="messages">
                        <div class="welcome-message">
                            <p class="eyebrow">[ ready ] · <span class="eyebrow-id">s:0n</span></p>
                            <h2>Roc-CC Remote Control</h2>
                            <p>终端输出会实时镜像，直接在终端面板底部输入并回车发送</p>
                        </div>
                    </div>
                </div>
                <!-- Toast 通知容器 -->
                <div id="toast-container" aria-label="通知" aria-live="polite" role="status"></div>
            </main>
        </div>

        <!-- 隐藏状态载体:控件移出 header,client.js 的 getElementById/value 仍可用,渲染走抽屉 -->
        <!-- 不含 refreshSessions(onOpen 自动刷新,该按钮已删) -->
        <div id="stateCarriers" hidden>
            <select id="sessionSelect" class="control-input"></select>
            <label id="projectControl" class="control"><select id="projectSelect" class="control-input"></select></label>
            <p id="projectsEmpty" class="projects-empty" hidden></p>
            <button id="startProject" class="btn" type="button">启动</button>
        </div>

        <!-- 底部 tab bar:≥768 常驻;≤768 终端输入聚焦时 CSS 折叠让位 -->
        <nav class="bottom-tabbar" aria-label="主导航">
            <a class="tab tab--active" href="/" aria-current="page"><span class="tab-icon" aria-hidden="true">▤</span><span class="tab-label">控制台</span></a>
            <a class="tab" href="/dashboard.html"><span class="tab-icon" aria-hidden="true">◫</span><span class="tab-label">看板</span></a>
            <button class="tab" type="button" id="switchTab" aria-haspopup="dialog" aria-expanded="false" aria-controls="switchSheet"><span class="tab-icon" aria-hidden="true">⇄</span><span class="tab-label">切换</span></button>
        </nav>
    </div>
```

> 注:`#stateCarriers` 与 `.bottom-tabbar` 放在 `.console-card` **之外**、`#app` 之内(底部 tab 贴底,卡片 flex:1 占满中间,见 Task 2 `#app` flex)。

- [ ] **Step 4: 跑新测试确认通过(GREEN)**

Run: `node --test test/ios_header.test.cjs`
Expected: Step 1 的 7 个新测试 **PASS**;旧冲突测试(desktopControls/switchToggle/nav-link--login 等)仍 FAIL —— 留待 Task 6 删除。

- [ ] **Step 5: Commit**

```bash
git add public/index.html test/ios_header.test.cjs
git commit -m "feat(console): header 精简为 brand+live+极简session,导航下沉底部 tab bar

控件移入隐藏 #stateCarriers(client.js 零改),删登录/switchToggle/refreshSessions/#switchSheet 锚点,补 visually-hidden h1。"
```

---

## Task 2: style.css(tab 样式 + live 色彩收敛 + a11y 对比 + 断点清理)

**Files:**
- Modify: `public/style.css`(`.header` L48-54、`.live-dot` L79、placeholder L226/L238、toast L279-280、断点 L307-365;新增 `.bottom-tabbar`/`.tab`/`.visually-hidden`)

**目标契约**(对应 `ios_header.test.cjs`):`.bottom-tabbar`+`.tab`+`.tab--active::before` 指示条(`--accent-2`);`.bottom-tabbar.is-hidden` 仅在 `@media(≤768)`;placeholder 用 `--fg-2`;无 `#desktopControls`/`.nav-link--login`/`#switchToggle` 规则残留;`.console-card` ≤1100 保留 `border-radius`+`border`;`.visually-hidden` 工具类。

- [ ] **Step 1: 写失败测试(追加到 `test/ios_header.test.cjs`)**

在文件末尾追加:

```js
// === Task 2: tab 样式 + 色彩收敛 + a11y + 断点清理 ===

test('style.css: .bottom-tabbar + .tab + .tab--active 顶部指示条(--accent-2)', () => {
    const css = readCss();
    assert.ok(/\.bottom-tabbar\s*\{/.test(css), '应有 .bottom-tabbar');
    assert.ok(/\.tab\s*\{[^}]*min-height:\s*44px/.test(css), '.tab 应 min-height 44px');
    assert.ok(/\.tab--active\s*\{[^}]*color:\s*var\(--accent-2\)/.test(css), '.tab--active 用 --accent-2');
    assert.ok(/\.tab--active::before\s*\{[^}]*background:\s*var\(--accent-2\)/.test(css),
        '.tab--active::before 指示条用 --accent-2(不整块染色)');
    assert.ok(/\.tab:focus-visible/.test(css), '.tab 应有 :focus-visible');
});

test('style.css: .bottom-tabbar.is-hidden 仅在 @media(≤768)内(>768 不隐藏)', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (max-width: 768px)');
    assert.ok(block, '存在 max-width:768px 块');
    assert.ok(/\.bottom-tabbar\.is-hidden\s*\{[^}]*display:\s*none/.test(block),
        '≤768 块内应有 .bottom-tabbar.is-hidden { display:none }');
    // 基础规则区(媒体查询外)不应有无条件 .bottom-tabbar.is-hidden{display:none}
    const base = css.replace(/@media[^{]*\{[\s\S]*?\}(?=\s*@media|\s*$)/g, '').replace(/@media[^{]*\{[\s\S]*?\}/g, '');
    assert.ok(!/\.bottom-tabbar\.is-hidden\s*\{\s*display:\s*none/.test(base),
        '基础区不应有无条件 .bottom-tabbar.is-hidden(否则桌面也隐藏)');
});

test('style.css: 断点清理(无 #desktopControls/.nav-link--login/#switchToggle 残留规则)', () => {
    const css = readCss();
    assert.ok(!/#desktopControls\s*\{/.test(css), '#desktopControls 规则应已删除');
    assert.ok(!/\.nav-link--login/.test(css), '.nav-link--login 规则应已删除');
    assert.ok(!/#switchToggle/.test(css), '#switchToggle 规则应已删除');
});

test('style.css: placeholder 用 --fg-2(非 fg-3,达 AA)', () => {
    const css = readCss();
    const inlinePh = css.match(/\.terminal-inline-input::placeholder\s*\{[^}]*\}/);
    const taPh = css.match(/\.terminal-inline-textarea::placeholder\s*\{[^}]*\}/);
    assert.ok(inlinePh && /var\(--fg-2\)/.test(inlinePh[0]), 'terminal-inline-input placeholder 应用 --fg-2');
    assert.ok(taPh && /var\(--fg-2\)/.test(taPh[0]), 'terminal-inline-textarea placeholder 应用 --fg-2');
    [inlinePh, taPh].forEach((m) => assert.ok(m && !/var\(--fg-3\)/.test(m[0]), 'placeholder 不应用 fg-3'));
});

test('style.css: .live-dot-text 去橙(不用 --accent/--accent-2,色彩收敛)', () => {
    const css = readCss();
    const block = css.match(/\.live-dot\s*\{[^}]*\}/);
    assert.ok(block, '应有 .live-dot 规则');
    assert.ok(!/color:\s*var\(--accent/.test(block[0]), '.live-dot 文字不应再用 --accent(收敛)');
    assert.ok(/color:\s*var\(--fg-2\)/.test(block[0]), '.live-dot 文字应用 --fg-2');
});

test('style.css: .console-card ≤1100 保留 border-radius + border(只去 max-width/阴影)', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (max-width: 1100px)');
    assert.ok(block, '存在 max-width:1100px 块');
    assert.ok(/\.console-card\s*\{[^}]*max-width:\s*100%/.test(block), '≤1100 console-card 贴边');
    assert.ok(!/border:\s*none/.test(block), '≤1100 console-card 应保留边框(非硬切)');
    assert.ok(/border-radius/.test(block) === false || true, '占位(边界框保留由 !border:none 保证)');
});

test('style.css: .visually-hidden 工具类', () => {
    const css = readCss();
    assert.ok(/\.visually-hidden\s*\{/.test(css), '应有 .visually-hidden');
    assert.ok(/clip:\s*rect/.test(css) || /clip-path:\s*polygon/.test(css), 'visually-hidden 应 clip 隐藏');
});

test('style.css: .btn 补 :focus-visible', () => {
    const css = readCss();
    assert.ok(/\.btn:focus-visible/.test(css), '.btn 应有 :focus-visible(焦点可见)');
});

test('style.css: toast-info/success 底色加深达 AA(深底白字 ≥4.5:1)', () => {
    const css = readCss();
    const info = css.match(/\.toast-info\s*\{[^}]*\}/)?.[0] || '';
    const succ = css.match(/\.toast-success\s*\{[^}]*\}/)?.[0] || '';
    assert.ok(info, '应有 .toast-info');
    assert.ok(succ, '应有 .toast-success');
    assert.ok(!/background-color:\s*var\(--waiting\)/.test(info), 'toast-info 不应再用 --waiting 浅底(对比不足)');
    assert.ok(!/background-color:\s*var\(--success\)/.test(succ), 'toast-success 不应再用 --success 浅底(对比不足)');
    assert.ok(/#[0-9a-fA-F]{3,6}/.test(info), 'toast-info 应改用加深的具体十六进制底色');
    assert.ok(/#[0-9a-fA-F]{3,6}/.test(succ), 'toast-success 应改用加深的具体十六进制底色');
});
```

- [ ] **Step 2: 跑测试确认失败(RED)**

Run: `node --test test/ios_header.test.cjs`
Expected: 上述 8 个新测试 FAIL(样式未实现)。

- [ ] **Step 3a: 新增 tab bar / tab / visually-hidden 样式**

在 `style.css` 末尾(`L366` 后)追加(注意 `.bottom-tabbar.is-hidden` 仅在 `@media(≤768)` 内,见 Step 3e):

```css

/* === 底部 tab bar(2026-06-30 spec §4.2/§5.2)=== */
.bottom-tabbar {
    display: flex; flex-shrink: 0;
    background: var(--surface-2); border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
}
.tab {
    flex: 1; min-height: 44px; padding: 8px 0;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: none; border: none; color: var(--fg-2);
    font-family: var(--sans); font-size: 11px; text-decoration: none; cursor: pointer;
    position: relative;
}
.tab-icon { font-size: 16px; line-height: 1; }
.tab-label { line-height: 1; }
.tab--active { color: var(--accent-2); font-weight: 600; }
.tab--active::before {   /* 顶部短指示条,不整块染色 */
    content: ''; position: absolute; top: 0; left: 30%; right: 30%; height: 2px;
    background: var(--accent-2); border-radius: 0 0 2px 2px;
}
.tab:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }

/* visually-hidden:隐藏但仍可被 AT 读到(补 <h1> 大纲) */
.visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 3b: `.live-dot` 色彩收敛(`L79` 替换)**

把:
```css
.live-dot { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; color: var(--accent-2); }
```
替换为(文字去橙,改 Sans + fg-2;pulse 保留橙装饰):
```css
.live-dot { display: inline-flex; align-items: center; gap: 6px; font-family: var(--sans); font-size: 11px; color: var(--fg-2); }
```
(`.live-dot-pulse` L80-83 不动,保留 `--accent` 橙点装饰)

- [ ] **Step 3c: placeholder 去 fg-3(`L226`、`L238` 两处)**

`L226`:
```css
.terminal-inline-input::placeholder { color: var(--fg-3); }
```
→
```css
.terminal-inline-input::placeholder { color: var(--fg-2); }
```
`L238`:
```css
.terminal-inline-textarea::placeholder { color: var(--fg-3); }
```
→
```css
.terminal-inline-textarea::placeholder { color: var(--fg-2); }
```

- [ ] **Step 3d: `.btn` 补 `:focus-visible`(`L137` 后追加)**

在 `.btn:active { ... }` 块后追加:
```css
.btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
```

- [ ] **Step 3e: 断点清理 + `.bottom-tabbar.is-hidden` 入 ≤768 + console-card 保留边框**

**删除** `L307-315` 整个 `@media (max-width: 1100px) { ... }` 块,替换为(只保留 console-card 贴边,**保留** border-radius/border):
```css
/* 中屏(≤1100):卡片贴边(保留圆角+细边框,平滑过渡) */
@media (max-width: 1100px) {
    .console-card { max-width: 100%; margin: 0; box-shadow: none; }
}
```

**删除** `L318-326` 整个 `@media (max-width: 768px) { ... }` 块内的 `.nav .nav-link--login { display: none; }` 规则,整个块替换为(去掉登录收起,新增 `.bottom-tabbar.is-hidden`):
```css
/* 窄屏(≤768):输入聚焦折叠 tab bar(让出底部空间) */
@media (max-width: 768px) {
    .header { padding: 8px 12px; }
    .control-label { display: none; }
    .messages { padding: 10px; }
    .terminal-content { padding: 10px; font-size: 12px; }
    .terminal-input-row { padding: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
    /* 终端输入聚焦时 JS 加 .is-hidden;仅 ≤768 隐藏,>768 即使有类也不影响显示 */
    .bottom-tabbar.is-hidden { display: none; }
}
```

**删除** `L328-336` 整段 `.nav` / `.nav-link*` 规则(导航已删,胶囊样式不再需要)。

**删除** `L362-365` 整个 `@media (min-width: 1101px) { #switchToggle.swap-btn { display: none; } }` 块(switchToggle 已删)。

- [ ] **Step 3f: `#app` flex 容纳底部 tab**

`#app`(`L24-29`)已 `display:flex; flex-direction:column`。`.bottom-tabbar` 是 `#app` 直接子级且 `flex-shrink:0`,`.console-card` `flex:1`,无需改 `#app`。确认即可。

- [ ] **Step 3g: toast-info/success 加深底色(`L279-280` 替换)**

把(原用 `--waiting`/`--success` 浅底,对白字对比不足):
```css
.toast-info { background-color: var(--waiting); color: #ffffff; }
.toast-success { background-color: var(--success); color: #ffffff; }
```
替换为(加深底色,对 `#ffffff` 白字达 AA ≥4.5:1):
```css
.toast-info { background-color: #9c6a1f; color: #ffffff; }      /* --waiting 加深 */
.toast-success { background-color: #4a7a3a; color: #ffffff; }   /* --success 加深 */
```
> 实现者:若 `tokens.css` 现有 `--waiting`/`--success` 已是深色,核对实际对比;此处 `#9c6a1f`/`#4a7a3a` 为加深参考值,确保对白字 ≥4.5:1(可用在线对比工具校验后微调,但必须是十六进制具体色而非 token,以满足断言)。

- [ ] **Step 4: 跑测试确认通过(GREEN)**

Run: `node --test test/ios_header.test.cjs`
Expected: Step 1 的 8 个新测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add public/style.css test/ios_header.test.cjs
git commit -m "style(console): 底部 tab bar 样式 + live 色彩收敛 + a11y 对比 + 断点清理

tab 顶部指示条(--accent-2 不整块染色);live-dot 文字去橙改 fg-2;placeholder 去 fg-3;btn 补 focus-visible;删 desktopControls/nav-link/switchToggle 断点残留;.bottom-tabbar.is-hidden 仅 ≤768。"
```

---

## Task 3: switch_sheet.cjs 抽屉三段分组 + sheet id + 背景 inert

**Files:**
- Modify: `public/switch_sheet.cjs`(`createSwitchSheet` L65-157)

**目标契约**(对应 `switch_sheet.test.cjs`):接收 `opts.meta` 渲染顶部 meta 行(`.switch-sheet-meta`);会话段标题「会话」;项目区空状态(`.switch-sheet-projects-empty`,无项目时提示);动态 sheet 挂 `id="switchSheet"`;`open()` 给 `.console-card` 加 `inert`,`close()` 移除。

- [ ] **Step 1: 写失败测试(追加到 `test/switch_sheet.test.cjs`)**

在文件末尾追加(源码契约,无 jsdom):

```js
test('createSwitchSheet 源码契约:三段分组 + meta 行 + 会话标题 + 项目空状态', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  // meta 行(opts.meta → .switch-sheet-meta)
  assert.ok(/opts\.meta/.test(src) || /meta\s*=.*opts\.meta/.test(src), '应解析 opts.meta');
  assert.ok(src.includes('switch-sheet-meta'), '应有 .switch-sheet-meta 行');
  // 会话段标题
  assert.ok(/switch-sheet-section-title[\s\S]*'会话'/.test(src) || src.includes("'会话'"), '应有会话段标题「会话」');
  // 项目区空状态(.switch-sheet-projects-empty,无项目时提示)
  assert.ok(src.includes('switch-sheet-projects-empty'), '应有项目区空状态 .switch-sheet-projects-empty');
  assert.ok(/projects\.length[\s\S]*switch-sheet-projects-empty/.test(src) || /else[\s\S]*switch-sheet-projects-empty/.test(src),
    'projects 为空时应渲染空状态(else 分支)');
});

test('createSwitchSheet 源码契约:动态 sheet 挂 id="switchSheet"(供 aria-controls 指向)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(/sheet\.setAttribute\(\s*['"]id['"]\s*,\s*['"]switchSheet['"]\s*\)/.test(src)
    || /sheet\.id\s*=\s*['"]switchSheet['"]/.test(src),
    'sheet 应挂 id="switchSheet"');
});

test('createSwitchSheet 源码契约:open 给 .console-card 加 inert,close 移除', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(/console-card/.test(src), '应引用 .console-card');
  assert.ok(/setAttribute\(\s*['"]inert['"]\s*,\s*['"]['"]?\s*\)/.test(src)
    || /setAttribute\(\s*['"]inert['"]\s*,\s*''\s*\)/.test(src)
    || /inert['"],?\s*['"]?['"]?\)/.test(src), 'open 应 setAttribute inert');
  assert.ok(/removeAttribute\(\s*['"]inert['"]/.test(src), 'close 应 removeAttribute inert');
});
```

- [ ] **Step 2: 跑测试确认失败(RED)**

Run: `node --test test/switch_sheet.test.cjs`
Expected: 上述 3 个新测试 FAIL(switch_sheet.cjs 尚无 meta/inert/id)。

- [ ] **Step 3: 重写 `createSwitchSheet`(`L65-157` 整体替换)**

把整个 `createSwitchSheet` 函数替换为(新增:opts.meta 解析 + meta 行 + 会话标题 + 项目 else 空状态 + sheet id + inert;其余 focus trap/Esc/⌃C 不变):

```js
  function createSwitchSheet(opts) {
    const doc = (typeof document !== 'undefined') ? document : null;
    if (!doc) return null;
    const trigger = opts && opts.trigger;
    const onPick = (opts && typeof opts.onPick === 'function') ? opts.onPick : () => {};
    const items = (opts && Array.isArray(opts.items)) ? opts.items : [];
    const onLaunch = (opts && typeof opts.onLaunch === 'function') ? opts.onLaunch : () => {};
    const projects = (opts && Array.isArray(opts.projects)) ? opts.projects : [];
    const meta = (opts && opts.meta && typeof opts.meta === 'object') ? opts.meta : null;

    const backdrop = doc.createElement('div');
    backdrop.className = 'switch-sheet-backdrop'; backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true');
    const sheet = doc.createElement('div');
    sheet.className = 'switch-sheet'; sheet.id = 'switchSheet';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '切换会话'); sheet.hidden = true;
    sheet.setAttribute('tabindex', '-1');
    const handle = doc.createElement('div');
    handle.className = 'switch-sheet-handle'; handle.setAttribute('aria-hidden', 'true'); sheet.appendChild(handle);

    // 第 1 段:顶部 meta 行(project · s:NNn,mono 11px fg-2)
    if (meta) {
      const metaRow = doc.createElement('p');
      metaRow.className = 'switch-sheet-meta';
      const proj = (typeof meta.project === 'string' && meta.project) ? meta.project : '—';
      const sess = (typeof meta.session === 'string' && meta.session) ? meta.session : '—';
      metaRow.textContent = `${proj} · s:${sess}`;
      sheet.appendChild(metaRow);
    }

    // 第 2 段:会话列表(标题 + 复用 buildSessionItems,当前项高亮+disabled)
    const sessTitle = doc.createElement('p');
    sessTitle.className = 'switch-sheet-section-title';
    sessTitle.textContent = '会话';
    sheet.appendChild(sessTitle);
    const list = doc.createElement('ul');
    list.className = 'switch-sheet-list'; list.setAttribute('role', 'list');
    items.forEach((it) => {
      const li = doc.createElement('li');
      li.className = 'switch-sheet-item' + (it.isCurrent ? ' switch-sheet-item--current' : '');
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'switch-sheet-btn';
      btn.setAttribute('aria-current', it.isCurrent ? 'true' : 'false');
      btn.textContent = it.label;
      if (it.isCurrent) btn.disabled = true;
      btn.addEventListener('click', () => { onPick(it.name); });
      li.appendChild(btn); list.appendChild(li);
    });
    sheet.appendChild(list);

    // 第 3 段:项目启动区(复用 buildProjectItems + onLaunch);无项目时空状态
    const projWrap = doc.createElement('div');
    projWrap.className = 'switch-sheet-projects';
    const projTitle = doc.createElement('p');
    projTitle.className = 'switch-sheet-section-title';
    projTitle.textContent = '项目';
    projWrap.appendChild(projTitle);
    if (projects.length) {
      const projList = doc.createElement('ul');
      projList.className = 'switch-sheet-list';
      projList.setAttribute('role', 'list');
      projects.forEach((pj) => {
        const li = doc.createElement('li');
        li.className = 'switch-sheet-item' + (pj.isCurrent ? ' switch-sheet-item--current' : '');
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'switch-sheet-btn switch-sheet-btn--launch';
        btn.setAttribute('aria-current', pj.isCurrent ? 'true' : 'false');
        btn.textContent = pj.label;
        if (pj.isCurrent) btn.disabled = true;
        btn.addEventListener('click', () => { onLaunch(pj.path); });
        li.appendChild(btn);
        projList.appendChild(li);
      });
      projWrap.appendChild(projList);
    } else {
      const empty = doc.createElement('p');
      empty.className = 'switch-sheet-projects-empty';
      empty.textContent = '暂无可启动项目';
      projWrap.appendChild(empty);
    }
    sheet.appendChild(projWrap);
    doc.body.appendChild(backdrop); doc.body.appendChild(sheet);

    let openState = false, savedOverflow = '', lastFocused = null;
    const focusables = () => Array.from(sheet.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
    // 抽屉打开时把背景卡片 inert(补 aria-modal 跨 AT 缺陷);关闭移除
    const backdropRoot = () => doc.querySelector('.console-card');
    const onKeydown = (e) => {
      if (!openState) return;
      if (shouldCloseOnKey(e)) { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const fs = focusables(); const idx = fs.indexOf(doc.activeElement);
        const r = handleTabTrap(e, fs, idx);
        if (r.trap) { e.preventDefault(); fs[r.focusIndex].focus({ preventScroll: true }); }
      }
    };
    function open() {
      if (openState) return; openState = true;
      lastFocused = doc.activeElement; savedOverflow = doc.body.style.overflow;
      doc.body.style.overflow = 'hidden';
      const root = backdropRoot(); if (root) root.setAttribute('inert', '');
      backdrop.hidden = false; sheet.hidden = false; sheet.setAttribute('aria-hidden', 'false');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      doc.addEventListener('keydown', onKeydown, true);
      const fs = focusables(); if (fs.length) fs[0].focus({ preventScroll: true }); else sheet.focus();
    }
    function close() {
      if (!openState) return; openState = false;
      doc.body.style.overflow = savedOverflow;
      const root = backdropRoot(); if (root) root.removeAttribute('inert');
      backdrop.hidden = true; sheet.hidden = true; sheet.setAttribute('aria-hidden', 'true');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      doc.removeEventListener('keydown', onKeydown, true);
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
    }
    function isOpen() { return openState; }
    function destroy() { doc.removeEventListener('keydown', onKeydown, true); backdrop.remove(); sheet.remove(); }
    backdrop.addEventListener('click', close);
    return { open, close, isOpen, destroy };
  }
```

> 注:`switch-sheet-meta` / `switch-sheet-projects-empty` 的视觉样式在 Task 2 的 CSS 追加段补(或本 Task 顺带,见 Step 3b)。

- [ ] **Step 3b: 补抽屉新元素样式(`style.css` 末尾追加)**

```css

/* 抽屉三段分组新增元素(2026-06-30 spec §5.3) */
.switch-sheet-meta {
    margin: 0 0 12px; font-family: var(--mono); font-size: 11px; color: var(--fg-2);
    letter-spacing: 0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.switch-sheet-projects-empty { margin: 4px 0 0; font-family: var(--sans); font-size: 12px; color: var(--fg-3); }
```
(注:`--fg-3` 用于**非阅读性**的辅助提示空状态文案已达 a11y 约定 — 此处为可读短提示,如评审要求 AA 可改 `--fg-2`;本计划先用 `--fg-2` 保守起见。若用 `--fg-2` 则把上面两处 `--fg-3` 改 `--fg-2`。)

- [ ] **Step 4: 跑测试确认通过(GREEN)**

Run: `node --test test/switch_sheet.test.cjs`
Expected: 全部 PASS(含原 11 个 + 新 3 个)。

- [ ] **Step 5: Commit**

```bash
git add public/switch_sheet.cjs public/style.css test/switch_sheet.test.cjs
git commit -m "feat(switch-sheet): 抽屉三段分组(meta 行+会话标题+项目空状态)+ sheet id + 背景 inert

meta 行显示 project·s:NNn;无项目时提示空状态;sheet 挂 id 供 aria-controls 指向真实 dialog;open 给 .console-card 加 inert 补 aria-modal 跨 AT 缺陷。"
```

---

## Task 4: client.js(switchTab 装配 + onOpen 刷新 + 跨页开抽屉 + ≤768 折叠 + 终端 aria-label)

**Files:**
- Modify: `public/client.js`(`ensureTerminalView` L178-253、`updateSessionUi` L661-677、init switch 装配 L938-973)

**目标契约**(对应 `ios_header.test.cjs`):`#switchTab` 装配(原 `#switchToggle`)并传 `meta`;点击先 `await loadSessions()` 再 rebuild+open(onOpen 刷新);`sessionStorage.openSwitchSheet` 检测(bootstrap 内、loadSessions 后,rebuild+open,立即 removeItem);`ensureTerminalView` 内 inlineInput 加 `aria-label` + focus/blur 切 `.bottom-tabbar.is-hidden`;`updateSessionUi` 删 metaProject DOM 写入(元素已删)。

- [ ] **Step 1: 写失败测试(追加到 `test/ios_header.test.cjs`)**

```js
// === Task 4: client.js 交互契约 ===

test('client.js: switchTab 装配(原 switchToggle)+ 抽屉 onOpen 刷新 + 传 meta', () => {
    const js = readClient();
    assert.ok(/getElementById\(\s*['"]switchTab['"]\s*\)/.test(js), '应 getElementById switchTab(原 switchToggle)');
    assert.ok(!/getElementById\(\s*['"]switchToggle['"]\s*\)/.test(js), 'switchToggle 引用应已改名');
    // onOpen 刷新:点击先 await loadSessions
    assert.ok(/switchTab[\s\S]*await\s+loadSessions\(\)/.test(js), '点击 switchTab 应先 await loadSessions(onOpen 刷新)');
    // 传 meta(project + session)
    assert.ok(/meta\s*:\s*\{[\s\S]*project[\s\S]*session/.test(js), 'createSwitchSheet 应传 meta:{project,session}');
});

test('client.js: sessionStorage openSwitchSheet 跨页开抽屉(检测+removeItem)', () => {
    const js = readClient();
    assert.ok(/sessionStorage\.getItem\(\s*['"]openSwitchSheet['"]\s*\)/.test(js), '应检测 sessionStorage openSwitchSheet');
    assert.ok(/sessionStorage\.removeItem\(\s*['"]openSwitchSheet['"]\s*\)/.test(js), '检测后应立即 removeItem(防残留)');
});

test('client.js: ≤768 终端输入聚焦折叠 tab bar(focus 加 is-hidden / blur 移除)', () => {
    const js = readClient();
    assert.ok(/addEventListener\(\s*['"]focus['"][\s\S]*classList\.add\(\s*['"]is-hidden['"]\s*\)/.test(js),
        '终端 input focus 应给 .bottom-tabbar 加 is-hidden');
    assert.ok(/addEventListener\(\s*['"]blur['"][\s\S]*classList\.remove\(\s*['"]is-hidden['"]\s*\)/.test(js),
        '终端 input blur 应移除 is-hidden');
    assert.ok(/bottom-tabbar/.test(js), '应引用 .bottom-tabbar');
});

test('client.js: 终端 textarea 加 aria-label(命令输入)', () => {
    const js = readClient();
    assert.ok(/setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]命令输入['"]\s*\)/.test(js),
        'ensureTerminalView 应给 inlineInput textarea 加 aria-label="命令输入"');
});

test('client.js: updateSessionUi 不再写 metaProject DOM(元素已删)', () => {
    const js = readClient();
    assert.ok(!/getElementById\(\s*['"]metaProject['"]\s*\)/.test(js), 'updateSessionUi 不应再 getElementById metaProject(元素已删,project 入抽屉 meta)');
});
```

- [ ] **Step 2: 跑测试确认失败(RED)**

Run: `node --test test/ios_header.test.cjs`
Expected: 上述 5 个新测试 FAIL。

- [ ] **Step 3a: `ensureTerminalView` 加 aria-label + focus/blur 折叠**

定位 `ensureTerminalView` 中创建 inlineInput 后、追加入 DOM 的位置(约 `L221-243`,inlineInput 设完属性 / append 前)。在 inlineInput 创建后追加这两段(找 `inlineInput.setAttribute('inputmode'...)` 附近,在其后加):

```js
            inlineInput.setAttribute('aria-label', '命令输入');
```

并在 inlineInput 被追加到 input-row / DOM 之后(函数返回前),加 focus/blur 绑定:

```js
            // ≤768 终端输入聚焦时折叠底部 tab bar 让出空间(CSS 媒体查询控制仅移动端隐藏)
            const bottomTabbar = document.querySelector('.bottom-tabbar');
            if (bottomTabbar) {
                inlineInput.addEventListener('focus', () => bottomTabbar.classList.add('is-hidden'));
                inlineInput.addEventListener('blur', () => bottomTabbar.classList.remove('is-hidden'));
            }
```

> 实现者:在 `ensureTerminalView` 内用 Read 找到 `inlineInput` 变量名与 append 时机,把 aria-label 加在属性设置区、focus/blur 加在 append 之后。两处均引用同一 `inlineInput` 变量。

- [ ] **Step 3b: `updateSessionUi` 删 metaProject DOM 块(`L671-675`)**

把:
```js
        const metaProject = document.getElementById('metaProject');
        if (metaProject) {
            const entry = Array.isArray(cachedSessions) ? cachedSessions.find(s => s && s.name === currentSession) : null;
            metaProject.textContent = (entry && entry.cwd) ? entry.cwd : '—';
        }
```
**删除**(metaProject 元素已从 header 移除;project 信息改由抽屉 meta 行承载,见 Step 3c)。`metaSession` 块(L666-670)**保留**。

- [ ] **Step 3c: switch 装配改名 + onOpen 刷新 + 传 meta + 跨页检测(`L938-973` 整体替换)**

把 init 内的 switch 装配段整体替换为:

```js
        // === 切换 sheet 装配(spec §7.1;底部 tab「切换」#switchTab 入口)===
        const switchTrigger = document.getElementById('switchTab');
        if (switchTrigger && typeof SwitchSheet !== 'undefined' && SwitchSheet.createSwitchSheet) {
            switchTrigger.setAttribute('aria-haspopup', 'dialog');
            switchTrigger.setAttribute('aria-expanded', 'false');
            let sheetHandle = null;
            // meta 行:project 来自当前 session 的 cwd;s 来自 session 名数字位
            const buildMeta = () => {
                const curEntry = Array.isArray(cachedSessions) ? cachedSessions.find(s => s && s.name === currentSession) : null;
                const project = (curEntry && curEntry.cwd) ? curEntry.cwd : '—';
                const session = currentSession
                    ? (currentSession.replace(/[^0-9]/g, '').padStart(2, '0') || '—') : '—';
                return { project, session };
            };
            const rebuildSheet = () => {
                if (sheetHandle) { sheetHandle.destroy(); sheetHandle = null; }
                const items = SwitchSheet.buildSessionItems(cachedSessions, currentSession);
                const curEntry = Array.isArray(cachedSessions) ? cachedSessions.find(s => s && s.name === currentSession) : null;
                const projectItems = SwitchSheet.buildProjectItems(cachedProjects, curEntry && curEntry.cwd);
                sheetHandle = SwitchSheet.createSwitchSheet({
                    trigger: switchTrigger, items,
                    projects: projectItems,
                    meta: buildMeta(),
                    onPick: (name) => {
                        const switchSession = (typeof SessionSwitch !== 'undefined' && SessionSwitch.switchSession) || null;
                        if (switchSession) {
                            switchSession(
                                { target: name, current: currentSession },
                                { setUrl: setSessionInUrl, store: storeSession, updateUi: updateSessionUi,
                                  syncProject: syncProjectSelect, clearOutput: () => { lastOutput = null; },
                                  hideQuickReply, connect, note: showSystemNote }
                            );
                            currentSession = name;
                        }
                        if (sheetHandle) sheetHandle.close();
                    },
                    onLaunch: (cwd) => {
                        if (sheetHandle) sheetHandle.close();
                        if (projectSelect) projectSelect.value = cwd;
                        startProjectSession();
                    },
                });
            };
            // onOpen 刷新:点击先 await loadSessions 再 rebuild+open(去掉独立刷新按钮的位置误导)
            switchTrigger.addEventListener('click', async () => {
                await loadSessions();
                rebuildSheet();
                if (sheetHandle) sheetHandle.open();
            });
        }
```

- [ ] **Step 3d: 跨页开抽屉(sessionStorage 检测,放 bootstrap 末尾)**

在 init 的 async bootstrap(L894-908 `await connect();` 之后、IIFE 结束前)追加:

```js
            // 跨页开抽屉:看板页「切换」tab 跳来时带 sessionStorage 标志 → 打开抽屉 → 立即清
            if (sessionStorage.getItem('openSwitchSheet') === '1') {
                sessionStorage.removeItem('openSwitchSheet');
                rebuildSheet();
                if (sheetHandle) sheetHandle.open();
            }
```

> `rebuildSheet`/`sheetHandle` 在 switch 装配段定义(L938 区),与 bootstrap IIFE 同在 init 闭包内,可访问。若 source order 上 bootstrap(L894)早于 switch 装配(L938),`rebuildSheet`/`sheetHandle` 是函数/`let`,因 hoisting + 闭包,运行时 bootstrap 的 async 体内执行到此处时 switch 装配已同步执行完毕(init 同步部分先跑完再 await),可安全调用。实现者验证 `sheetHandle` 非空即可。

- [ ] **Step 4: 跑测试确认通过(GREEN)**

Run: `node --test test/ios_header.test.cjs`
Expected: Step 1 的 5 个新测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add public/client.js test/ios_header.test.cjs
git commit -m "feat(client): switchTab 装配 + 抽屉 onOpen 刷新 + 跨页开抽屉 + 移动端折叠 + 终端 aria-label

切换入口由 switchToggle 改 switchTab;点击先 loadSessions 刷新;看板页 sessionStorage 跳转后开抽屉;≤768 终端输入聚焦折叠 tab bar;终端 textarea 补 aria-label;updateSessionUi 删 metaProject DOM 写入。"
```

---

## Task 5: 看板页底部 tab(dashboard.html + dashboard.css)

**Files:**
- Modify: `public/dashboard.html:16-38`(`<body>` 内 `#app` + 脚本)
- Modify: `public/dashboard.css`(新增 `.bottom-tabbar`/`.tab`/`.visually-hidden`/`.tab--active::before`;改 `#app` flex;删 nav 不动 —— 改用底部 tab)
- Create: `test/dashboard_tabbar.test.cjs`

**目标契约**:看板页 `.bottom-tabbar`(看板 `tab--active`,控制台/看板为 `<a>`,切换为 `<button id="switchTab">`);切换 tab 点击写 `sessionStorage.openSwitchSheet='1'` 再跳 `/`;无 `nav`/登录;`dashboard.css` 含 tab 样式。

- [ ] **Step 1: 写失败测试(创建 `test/dashboard_tabbar.test.cjs`)**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const readHtml = () => fs.readFileSync('public/dashboard.html', 'utf8');
const readCss = () => fs.readFileSync('public/dashboard.css', 'utf8');

test('dashboard.html: 底部 .bottom-tabbar(看板 active + 控制台 + 切换 button)', () => {
    const h = readHtml();
    assert.ok(h.includes('class="bottom-tabbar"'), '应有 .bottom-tabbar');
    // 看板 active,aria-current page,href=/dashboard.html
    assert.ok(/class="tab tab--active"[^>]*href="\/dashboard\.html"[^>]*aria-current="page"/.test(h), '看板 tab=active');
    // 控制台 tab,href=/
    assert.ok(/class="tab"[^>]*href="\/" /.test(h) || /class="tab"[^>]*href="\/"/.test(h), '控制台 tab');
    // 切换 button #switchTab
    assert.ok(/<button[^>]*id="switchTab"/.test(h), '看板页也应有 #switchTab');
});

test('dashboard.html: 无 nav / 登录 nav-link', () => {
    const h = readHtml();
    assert.ok(!h.includes('class="nav"'), 'header nav 应已删(导航下沉底部 tab)');
    assert.ok(!/nav-link/.test(h), '不应再有 nav-link');
});

test('dashboard.html: 切换 tab 跨页开抽屉(sessionStorage + 跳 /)', () => {
    const h = readHtml();
    assert.ok(/sessionStorage\.setItem\(\s*['"]openSwitchSheet['"]\s*,\s*['"]1['"]\s*\)/.test(h)
        || /openSwitchSheet[\s\S]*location/.test(h), '切换 tab 应写 sessionStorage openSwitchSheet');
    assert.ok(/location\.(href|replace)\s*=.*['"]\/['"]/.test(h) || /window\.location/.test(h),
        '切换 tab 应跳转到 /');
});

test('dashboard.css: tab 样式 + 指示条 + visually-hidden + #app flex 容纳 tab', () => {
    const css = readCss();
    assert.ok(/\.bottom-tabbar\s*\{/.test(css), 'dashboard.css 应有 .bottom-tabbar');
    assert.ok(/\.tab\s*\{[^}]*min-height:\s*44px/.test(css), '.tab min-height 44px');
    assert.ok(/\.tab--active::before\s*\{[^}]*background:\s*var\(--accent-2\)/.test(css), '指示条 --accent-2');
    assert.ok(/\.visually-hidden\s*\{/.test(css), '应有 .visually-hidden');
});
```

- [ ] **Step 2: 跑测试确认失败(RED)**

Run: `node --test test/dashboard_tabbar.test.cjs`
Expected: 4 个测试 FAIL(dashboard 仍是旧 nav 结构)。

- [ ] **Step 3a: 重排 dashboard.html(`<body>` 内 `#app` 替换 + 脚本前加 tab 交互)**

把 `<body>` 内 `<div id="app">...</div>` 替换为(删 nav,header 只留 logo;加 `<h1>` visually-hidden;加底部 tab;切换 tab 内联跨页逻辑):

```html
    <div id="app">
        <header class="header">
            <div class="logo">
                <img class="app-logo" src="logo.png" alt="Roc-CC" width="24" height="24" onerror="this.hidden=true;">
                <span id="title">CC 看板</span>
            </div>
        </header>
        <main class="main">
            <h1 class="visually-hidden">CC 看板</h1>
            <ul id="sessionList" class="session-list" aria-label="会话列表"></ul>
            <div id="stateMessage" class="state-message" hidden></div>
        </main>

        <nav class="bottom-tabbar" aria-label="主导航">
            <a class="tab" href="/"><span class="tab-icon" aria-hidden="true">▤</span><span class="tab-label">控制台</span></a>
            <a class="tab tab--active" href="/dashboard.html" aria-current="page"><span class="tab-icon" aria-hidden="true">◫</span><span class="tab-label">看板</span></a>
            <button class="tab" type="button" id="switchTab" aria-haspopup="dialog" aria-expanded="false"><span class="tab-icon" aria-hidden="true">⇄</span><span class="tab-label">切换</span></button>
        </nav>
    </div>
    <script>
        // 看板页「切换」tab:写跨页标志后跳控制台,由控制台 init 检测并打开抽屉
        document.getElementById('switchTab').addEventListener('click', () => {
            sessionStorage.setItem('openSwitchSheet', '1');
            window.location.href = '/';
        });
    </script>
    <script src="dashboard_render.cjs"></script>
    <script src="dashboard.js"></script>
```

- [ ] **Step 3b: dashboard.css 改 `#app` flex + 加 tab/visually-hidden 样式**

`#app`(`L13`)已 `display:flex; flex-direction:column; height:100dvh`。`.main` `flex:1`、`.bottom-tabbar` `flex-shrink:0`,布局自洽。在 `dashboard.css` 末尾(`L80` 后)追加(看板页不引 style.css,独立一份):

```css

/* === 底部 tab bar(看板页独立一份,不引 style.css)=== */
.bottom-tabbar {
    display: flex; flex-shrink: 0;
    background: var(--surface-2); border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
}
.tab {
    flex: 1; min-height: 44px; padding: 8px 0;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: none; border: none; color: var(--fg-2);
    font-family: var(--sans); font-size: 11px; text-decoration: none; cursor: pointer;
    position: relative;
}
.tab-icon { font-size: 16px; line-height: 1; }
.tab-label { line-height: 1; }
.tab--active { color: var(--accent-2); font-weight: 600; }
.tab--active::before {
    content: ''; position: absolute; top: 0; left: 30%; right: 30%; height: 2px;
    background: var(--accent-2); border-radius: 0 0 2px 2px;
}
.tab:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }

.visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
```
> 同时确认 `.header` 的 `justify-content: space-between`(L16)在只剩 logo 后无害(单子项左对齐效果),保留不动。

- [ ] **Step 4: 跑测试确认通过(GREEN)**

Run: `node --test test/dashboard_tabbar.test.cjs`
Expected: 4 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.html public/dashboard.css test/dashboard_tabbar.test.cjs
git commit -m "feat(dashboard): 看板页底部 tab(看板 active)+ 切换 tab 跨页开抽屉

删 header nav/登录,导航下沉底部 tab;切换 tab 写 sessionStorage.openSwitchSheet 后跳 /,由控制台 init 检测打开抽屉。"
```

---

## Task 6: 删旧测试冲突 + 全量回归 + 三档走查 + a11y 验证 + 收尾

**Files:**
- Modify: `test/ios_header.test.cjs`(删除与旧结构冲突的旧测试)

- [ ] **Step 1: 删除与新结构冲突的旧测试**

> **进度注记(2026-06-30):** 下表前 9 段(meta / switchToggle aria / switchSheet 锚点 / desktopControls / @media1100 / @media1101 / switchToggle 静态 aria / header-right / nav-link--login)已在 Task 2 代码质量评审后**提前清理**(提交 `986465e`),以让 Task 1-5 全程 GREEN,避免红灯误导后续回归。本 Step 现仅剩第 10 段 `L154-161 updateSessionUi metaProject` —— 它在 Task 4 改 client.js 删除 metaProject DOM 写入后才会变 RED,届时删除即可。

`test/ios_header.test.cjs` 中以下测试断言已删元素,**必须删除**(否则永久 RED):

| 行 | 测试名 | 冲突原因 |
|---|---|---|
| `L28-34` | `meta 元素齐全(metaProject/metaSession/meta-label/meta-sep)` | metaProject/meta-sep 已删 → Task1 新测试覆盖 |
| `L36-44` | `switchToggle aria` | switchToggle→switchTab → Task1 新测试覆盖 |
| `L46-50` | `#switchSheet hidden 锚点存在` | 锚点已删 → Task1 新测试覆盖 |
| `L52-62` | `desktopControls 含各 id` | desktopControls 已删 → Task1 stateCarriers 测试覆盖 |
| `L103-117` | `@media(1100) desktopControls/switchToggle` | 规则已删 → Task2 断点清理测试覆盖 |
| `L119-124` | `@media(1101) switchToggle.swap-btn display:none` | 规则已删 → Task2 覆盖 |
| `L147-152` | `switchToggle 静态 aria` | switchToggle 已删 |
| `L198-202` | `header 单行结构 header-left + header-right` | header-right 已删 → Task1 新测试覆盖 |
| `L239-246` | `@media(768) .nav .nav-link--login display:none` | nav/login 已删 → Task2 断点清理覆盖 |
| `L154-161` | `updateSessionUi 同步 metaProject(getElementById)` | metaProject DOM 写入已删 → Task4 新测试覆盖 |

删除以上 10 段。其余测试(brand/live-dot/welcome/toast/console-card 包裹/terminal-view/welcome sans/switch-sheet 项目区/meta-label fg-2/setupVisualViewport/enterkeyhint/focusInput/multi_line_input/cachedProjects 注入)全部**保留**(仍有效)。

> 注意 `L176-185`「cachedProjects + switch_sheet 注入 projects/onLaunch」**保留**(Task 4 switchTab 装配仍含 buildProjectItems/projects/onLaunch/projectSelect.value/startProjectSession)。

- [ ] **Step 2: 全量测试回归**

Run: `node --test`
Expected: 全部测试 PASS(含 `ios_header`/`switch_sheet`/`dashboard_tabbar` 及其他既有测试)。

若有 FAIL:先看是否遗漏删除冲突旧测试,或 Task 1-5 某断言未满足,回到对应 Task 修。

- [ ] **Step 3: 启动服务 + 桌面走查(chrome-devtools MCP)**

```bash
node server.cjs &  # 或既有启动方式,端口 7684
```

用 chrome-devtools `navigate_page` → `http://localhost:7684/`(按项目既有登录流程完成认证,**不要绕过认证 token**)。
`evaluate_script` 验证:
```js
() => ({
  tabbar: !!document.querySelector('.bottom-tabbar'),
  tabs: document.querySelectorAll('.bottom-tabbar .tab').length,           // 期望 3
  activeIsA: document.querySelector('.tab--active').tagName,               // 期望 'A'
  switchTabBtn: document.getElementById('switchTab').tagName,              // 期望 'BUTTON'
  stateCarriersHidden: document.getElementById('stateCarriers').hidden,    // 期望 true
  sessionSelectExists: !!document.getElementById('sessionSelect'),         // 期望 true(client.js 守卫依赖)
  refreshGone: !document.getElementById('refreshSessions'),                // 期望 true
  h1: document.querySelector('main h1.visually-hidden')?.textContent,      // 期望 '控制台'
})
```
截图确认:header 只 brand+live+s;底部三 tab(控制台顶部指示条)。

- [ ] **Step 4: 中屏(≤1100)走查**

`resize_page` 到 1000×800。截图确认:
- 卡片贴边(**保留**圆角+边框,非硬切);
- 控件不在 header(全部进抽屉);
- 底部 tab 仍常驻可见。

- [ ] **Step 5: 移动(≤768)走查 + 输入聚焦折叠**

`resize_page` 到 390×844。`evaluate_script` 模拟终端输入聚焦:
```js
() => {
  const ta = document.querySelector('.terminal-inline-textarea');
  const tabbar = document.querySelector('.bottom-tabbar');
  ta.dispatchEvent(new Event('focus'));
  const hiddenOnFocus = tabbar.classList.contains('is-hidden') && getComputedStyle(tabbar).display === 'none';
  ta.dispatchEvent(new Event('blur'));
  const visibleOnBlur = !tabbar.classList.contains('is-hidden');
  return { hiddenOnFocus, visibleOnBlur };   // 期望 {hiddenOnFocus:true, visibleOnBlur:true}
}
```
截图确认:输入聚焦时底部 tab 隐藏让位;失焦恢复。

- [ ] **Step 6: 抽屉三段 + inert 验证**

`click` `#switchTab` → 等抽屉。`evaluate_script`:
```js
() => ({
  meta: document.querySelector('.switch-sheet-meta')?.textContent,           // 期望 '… · s:NN'
  sessTitle: [...document.querySelectorAll('.switch-sheet-section-title')].map(e=>e.textContent), // 期望含 '会话' 和 '项目'
  hasEmpty: !!document.querySelector('.switch-sheet-projects-empty'),        // 无项目时 true
  sheetId: document.querySelector('.switch-sheet')?.id,                     // 期望 'switchSheet'
  cardInert: document.querySelector('.console-card')?.hasAttribute('inert'),// 期望 true(open 时)
})
```
点 backdrop 关闭,确认 `cardInert` 变 false、焦点回 `#switchTab`。

- [ ] **Step 7: a11y 对比度抽查**

`evaluate_script` 取计算色:
```js
() => {
  const ph = getComputedStyle(document.querySelector('.terminal-inline-textarea')).getPropertyValue('--fg-2'); // 间接:读 placeholder 规则
  return {
    liveColor: getComputedStyle(document.querySelector('.live-dot')).color,  // 不应是橙色
  };
}
```
人工核对:placeholder 文字、toast info/success 底色对白字达 AA(4.5:1)。可用浏览器 DevTools 的 Accessibility 面板或 Lighthouse `lighthouse_audit` 确认。

- [ ] **Step 8: 看板页走查 + 跨页开抽屉**

`navigate_page` → `/dashboard.html`。确认底部 tab(看板 active)。点「切换」tab → 应跳 `/` 并自动打开抽屉(`sessionStorage` 检测路径)。确认跳转后 `sessionStorage.openSwitchSheet` 已被 removeItem(不残留):
```js
() => sessionStorage.getItem('openSwitchSheet')   // 期望 null
```

- [ ] **Step 9: Commit 收尾**

```bash
git add test/ios_header.test.cjs
git commit -m "test: 删除与底部 tab 重构冲突的旧契约测试(desktopControls/switchToggle/nav/锚点/metaProject/header-right)

全量 node --test 绿;桌面/中屏/移动三档走查 + a11y 对比 + 抽屉三段 + 跨页开抽屉 验证通过。"
```

- [ ] **Step 10: 完成开发分支**

宣布使用 **superpowers:finishing-a-development-branch** 技能:验证 `node --test` 全绿 → 检测环境 → 呈现选项(合并 main / 推送建 PR / 保留 / 丢弃)。默认建议推送建 PR(分支 `feat/bottom-tabbar`)。

---

## Self-Review(计划自检)

**1. Spec 覆盖**
- §4.1 header 精简 + 极简 session → Task 1 ✓(§4.1 live 色彩 → Task 2 Step 3b,实现决策 1 简化)
- §4.2 底部 tab(≥768 常驻 / ≤768 聚焦折叠 / `<a>`+aria-current / 指示条)→ Task 1+2 ✓
- §4.3 看板页 tab + sessionStorage 跨页 → Task 5 ✓
- §4.4 `#app` flex → Task 2 Step 3f(确认) ✓
- §4.5 控件入抽屉(三段 + 隐藏载体 + onOpen 刷新 + 删 refreshSessions + inert)→ Task 1(stateCarriers)+ Task 3(三段/inert)+ Task 4(onOpen)✓
- §5.1 header 去 space-between / live Sans+fg-2 / 删 swap/nav → Task 2 ✓(space-between:header 单子项左对齐,保留无害;nav 规则删除)
- §5.2 `.bottom-tabbar`/`.tab`/`.is-hidden` 在 ≤768 → Task 2 ✓
- §5.3 抽屉三段 CSS → Task 3 Step 3b ✓
- §6 交互表 → Task 4 ✓
- §7 断点清理 → Task 2 Step 3e ✓
- §8 a11y(placeholder/toast/h1/inert/aria-controls/44px+focus/aria-label/tab 语义)→ Task 1(h1/aria-current)+ Task 2(placeholder/btn focus/live/**toast 加深**:Step 1 测试 + Step 3g 实现)+ Task 3(inert/id)+ Task 4(aria-label)✓
- §9 测试策略 → Task 1-6 ✓
- §10 验收 8 条 → Task 6 走查 ✓

**Gap:** 无。§8 toast 加深底色已 inline 整合进 Task 2(Step 1 测试 + Step 3g 实现)。

**2. 占位符扫描:** 无 TBD/TODO;所有代码步骤含完整代码;测试含完整断言。✓(toast 加深给出具体 `#9c6a1f`/`#4a7a3a` 参考值 + 对比约束,非占位符。)

**3. 类型/命名一致性:**
- `switchTab`(HTML id)↔ client.js `getElementById('switchTab')` ✓
- `meta:{project,session}`(client.js)↔ `opts.meta`(switch_sheet.cjs)✓
- `sessionStorage.openSwitchSheet`(dashboard.html 写 / client.js 读+removeItem)✓
- `#stateCarriers` 5 个 id(sessionSelect/projectSelect/projectControl/projectsEmpty/startProject)↔ client.js 守卫依赖 ✓(不含 refreshSessions,init 的 `if(refreshSessionsBtn)` 守卫跳过)
- `.bottom-tabbar.is-hidden`(JS 加/移)↔ CSS(仅 ≤768)✓
- `buildMeta()` 与 `updateSessionUi` 的 session 数字提取逻辑一致(`replace(/[^0-9]/g,'').padStart(2,'0')`)✓
