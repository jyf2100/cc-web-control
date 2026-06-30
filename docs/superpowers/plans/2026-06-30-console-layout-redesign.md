# 控制台布局重排实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把控制台页(`index.html`)从「header 全宽 + 终端 1100 居中不对齐、header 三段高高低低、终端卡片套卡片 5 道边框」重排为「单张 1100 居中卡片包裹 header+终端、桌面单行等高 header、移动/中屏折叠进抽屉」,两端整齐。

**Architecture:** 纯前端重布局,零后端改动。新增一层 `.console-card` 包裹容器(`max-width:1100px` 居中 + 边框/圆角/阴影),把 header 与终端收进同一张卡片 → 左右天然对齐(治「空挂」);header 从 `brand-row` / `meta-bar` / `nav` / `desktopControls` 四段折叠为桌面单行(`header-left`=brand+live+project meta,`header-right`=控件+nav+切换),所有控件等高 44px(治「高高低低」);移动端及中屏(≤1100px)仅留 brand+live+nav,Session/Project/启动 收进已有 `switch_sheet.cjs` 抽屉,并扩展抽屉加项目列表+启动入口(复用 `client.js` 的 `startProjectSession`,顺带治「移动端无法启动项目」死路)。终端去除自身外框,靠卡片边框 + 背景色差区隔。

**Tech Stack:** 原生 HTML/CSS/JS(无构建步骤);UMD `.cjs` 模块(`switch_sheet.cjs` 等,前后端共享)+ IIFE `client.js`(浏览器专属,不进 node 测试);`node:test` 单元测试,DOM 改动沿用项目既有的「读源码字符串 + 正则/includes 断言」范式(无 jsdom/playwright);纯前端视觉变更靠源码断言 + 三档断点视觉走查验证。

**关联 spec:** [`docs/superpowers/specs/2026-06-30-console-layout-redesign-design.md`](../specs/2026-06-30-console-layout-redesign-design.md)

---

## File Structure

| 文件 | 职责 | 本计划改动 |
|---|---|---|
| `public/tokens.css` | 设计令牌单一事实来源(三页共用) | 加 `--shadow-card` 卡片阴影令牌 |
| `public/switch_sheet.cjs` | 切换抽屉:纯函数 + `createSwitchSheet`(UMD) | 加 `buildProjectItems` 纯函数;`createSwitchSheet` 渲染项目区 + `onLaunch` 回调 |
| `public/client.js` | 终端镜像客户端(IIFE,浏览器专属) | 加模块级 `cachedProjects`;`rebuildSheet` 注入项目项 + `onLaunch` → `startProjectSession` |
| `public/index.html` | 控制台页 DOM | 加 `.console-card` 包裹;header 四段 → 单行(`header-left`/`header-right`);删 `brand-ver`;welcome p 去 serif |
| `public/style.css` | 控制台页样式 | 卡片容器;单行等高 header;终端去外框;移动/中屏折叠断点;`fg-3`→`fg-2` |
| `test/tokens.test.cjs` | 令牌回归 | 加 `--shadow-card` 断言 |
| `test/switch_sheet.test.cjs` | switch_sheet 纯函数回归 | 加 `buildProjectItems` 测试 + `createSwitchSheet` 源码契约断言 |
| `test/ios_header.test.cjs` | header DOM/CSS 契约回归 | 更新受重排影响的断言(brand-ver / meta 结构 / 1100 断点),加 client.js 集成断言 |

**不做(范围控制,沿用 spec):** 不改终端输入模型;不改 tmux/WebSocket;不做完整按键工具栏;不改看板/登录页;不改后端 `server.cjs`。

---

## Task 1: tokens.css 加 `--shadow-card` 卡片阴影令牌

**Files:**
- Modify: `public/tokens.css:41`(`--r-pill` 之后,`color-scheme` 之前)
- Test: `test/tokens.test.cjs`(末尾追加)

- [ ] **Step 1: 写失败测试**

追加到 `test/tokens.test.cjs` 末尾:

```js
test('tokens.css 含 --shadow-card 卡片阴影令牌', () => {
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  assert.ok(css.includes('--shadow-card'), 'tokens.css 应定义 --shadow-card(控制台卡片容器用)');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test test/tokens.test.cjs`
Expected: FAIL —— `--shadow-card 应定义` 断言失败(令牌尚不存在)。

- [ ] **Step 3: 加令牌**

在 `public/tokens.css` 的 `--r-pill: 9999px;` 行(`:41`)之后、`color-scheme: light;`(`:43`)之前插入:

```css
  /* 卡片阴影:控制台卡片容器(轻量 editorial 风,承载「包裹」视觉,不喧宾夺主) */
  --shadow-card: 0 1px 3px rgba(38, 37, 30, 0.06), 0 8px 24px rgba(38, 37, 30, 0.08);
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test test/tokens.test.cjs`
Expected: PASS(全部用例含新断言)。

- [ ] **Step 5: 提交**

```bash
git add public/tokens.css test/tokens.test.cjs
git commit -m "feat(tokens): 加 --shadow-card 卡片阴影令牌"
```

---

## Task 2: switch_sheet.cjs 加 `buildProjectItems` 纯函数(TDD)

**Files:**
- Modify: `public/switch_sheet.cjs:48`(`buildSessionItems` 之后)+ `:115`(导出)
- Test: `test/switch_sheet.test.cjs:3`(require 行)+ 末尾追加

- [ ] **Step 1: 写失败测试**

把 `test/switch_sheet.test.cjs:3` 的 require 改为同时引入 `buildProjectItems`:

```js
const { handleTabTrap, shouldCloseOnKey, buildSessionItems, buildProjectItems } = require('../public/switch_sheet.cjs');
```

在文件末尾追加:

```js
test('buildProjectItems 渲染 label(root 带后缀)+ isCurrent(去尾斜杠匹配 cwd)', () => {
  const projects = [
    { path: '/roots/a/foo', name: 'foo', root: 'A' },
    { path: '/roots/b/bar/', name: 'bar' },
  ];
  const items = buildProjectItems(projects, '/roots/b/bar');
  assert.equal(items.length, 2);
  assert.equal(items[0].path, '/roots/a/foo');
  assert.equal(items[0].label, 'foo (A)');
  assert.equal(items[1].label, 'bar');
  assert.equal(items.find(i => i.path === '/roots/b/bar/').isCurrent, true);
  assert.equal(items.find(i => i.path === '/roots/a/foo').isCurrent, false);
});
test('buildProjectItems 非法降级', () => {
  assert.deepEqual(buildProjectItems(null, 'x'), []);
  assert.equal(buildProjectItems([{ path: '/p', name: 'p' }, { bad: 1 }, 'x' ], '/p').length, 1);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test test/switch_sheet.test.cjs`
Expected: FAIL —— `buildProjectItems is not a function`(导出尚无该函数)。

- [ ] **Step 3: 实现 `buildProjectItems`**

在 `public/switch_sheet.cjs` 的 `buildSessionItems` 函数(`:40-48`)之后插入。归一化逻辑对齐 `client.js` 的 `syncProjectSelect`(`:689` 去尾斜杠比较),避免 cwd 尾斜杠不一致漏匹配:

```js
  function buildProjectItems(projects, currentCwd) {
    const list = Array.isArray(projects) ? projects : [];
    const normPath = (v) => String(v).replace(/[/\\]+$/, '');
    const cur = normPath(typeof currentCwd === 'string' ? currentCwd : '');
    return list
      .filter((p) => p && typeof p.path === 'string' && typeof p.name === 'string')
      .map((p) => ({
        path: p.path,
        label: p.root ? `${p.name} (${p.root})` : p.name,
        isCurrent: normPath(p.path) === cur,
      }));
  }
```

把文件末尾的导出(`:115`)改为:

```js
  return { handleTabTrap, shouldCloseOnKey, buildSessionItems, buildProjectItems, createSwitchSheet };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test test/switch_sheet.test.cjs`
Expected: PASS(含两个新用例)。

- [ ] **Step 5: 提交**

```bash
git add public/switch_sheet.cjs test/switch_sheet.test.cjs
git commit -m "feat(switch_sheet): buildProjectItems 纯函数(项目列表归一化+isCurrent)"
```

---

## Task 3: switch_sheet.cjs `createSwitchSheet` 渲染项目区 + `onLaunch` 回调

**Files:**
- Modify: `public/switch_sheet.cjs:50-113`(`createSwitchSheet` 内)
- Test: `test/switch_sheet.test.cjs`(末尾追加源码契约断言)

> 说明:`createSwitchSheet` 操作 `document`,node 环境无 DOM,沿用项目惯例(浏览器代码不跑运行时测试),用「读源码字符串」断言契约。

- [ ] **Step 1: 写失败测试**

在 `test/switch_sheet.test.cjs` 顶部 require 区补一行 `fs`:

```js
const fs = require('node:fs');
```

文件末尾追加:

```js
test('createSwitchSheet 源码契约:支持 projects 渲染 + onLaunch 回调', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(src.includes('onLaunch'), 'createSwitchSheet 应接受 onLaunch 回调');
  assert.ok(src.includes('switch-sheet-projects'), '应有项目区容器 .switch-sheet-projects');
  assert.ok(src.includes('switch-sheet-section-title'), '项目区应有分组标题');
  assert.ok(/projects\.forEach/.test(src), '应遍历 projects 渲染项目项');
  assert.ok(/onLaunch\(/.test(src), '项目项点击应调用 onLaunch(path)');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test test/switch_sheet.test.cjs`
Expected: FAIL —— 源码尚无 `onLaunch` / `switch-sheet-projects` 等。

- [ ] **Step 3: 扩展 `createSwitchSheet`**

`public/switch_sheet.cjs` `createSwitchSheet` 内,在 `const onPick = ...`(`:54`)、`const items = ...`(`:55`)之后追加选项解构:

```js
    const onLaunch = (opts && typeof opts.onLaunch === 'function') ? opts.onLaunch : () => {};
    const projects = (opts && Array.isArray(opts.projects)) ? opts.projects : [];
```

在 `sheet.appendChild(list);`(`:78`)之后、`doc.body.appendChild(backdrop);`(`:79`)之前,插入项目区渲染:

```js
    if (projects.length) {
      const projWrap = doc.createElement('div');
      projWrap.className = 'switch-sheet-projects';
      const projTitle = doc.createElement('p');
      projTitle.className = 'switch-sheet-section-title';
      projTitle.textContent = '项目';            // textContent 防 HTML 注入
      projWrap.appendChild(projTitle);
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
      sheet.appendChild(projWrap);
    }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test test/switch_sheet.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add public/switch_sheet.cjs test/switch_sheet.test.cjs
git commit -m "feat(switch_sheet): createSwitchSheet 渲染项目区 + onLaunch 启动回调"
```

---

## Task 4: client.js 缓存 `cachedProjects` 并向抽屉注入项目项 + `onLaunch`

**Files:**
- Modify: `public/client.js:38`(模块级状态)、`loadProjects`(`:765-808`)、`rebuildSheet`(`:941-960`)
- Test: `test/ios_header.test.cjs`(末尾追加 client.js 集成断言)

> 集成方案(spec「项目+启动需接现有 projectSelect/startProject 数据流」风险的落实):项目列表数据不来自 `projectsView.cjs`(它只做显隐决策),而来自 `client.js` `loadProjects` 拿到的 `/api/projects` → `data.projects`(`[{path,name,root?}]`,见 `:788-802`)。加模块级 `cachedProjects`(类比已有 `cachedSessions`),`rebuildSheet` 时喂给抽屉;`onLaunch` 把选中 path 写回 `projectSelect.value` 后调既有的 `startProjectSession`(`:810`),复用而非重写。

- [ ] **Step 1: 写失败测试**

在 `test/ios_header.test.cjs` 末尾追加:

```js
test('client.js: cachedProjects 缓存 + switch_sheet 注入 projects/onLaunch', () => {
    const js = readClient();
    assert.ok(/let\s+cachedProjects\b/.test(js), '应有模块级 cachedProjects');
    assert.ok(js.includes('SwitchSheet.buildProjectItems'), 'rebuildSheet 应构建项目项');
    assert.ok(js.includes('projects: projectItems'), 'createSwitchSheet 应传入 projects');
    assert.ok(/onLaunch\s*:/.test(js), 'createSwitchSheet 应注入 onLaunch');
    // onLaunch 应写回 projectSelect.value 并复用 startProjectSession
    assert.ok(/onLaunch[\s\S]*projectSelect\.value\s*=/.test(js), 'onLaunch 应写回 projectSelect.value');
    assert.ok(/onLaunch[\s\S]*startProjectSession\(\)/.test(js), 'onLaunch 应复用 startProjectSession');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test test/ios_header.test.cjs`
Expected: FAIL —— client.js 尚无 `cachedProjects` 等。

- [ ] **Step 3: 实现**

**(a)** `public/client.js:38`(`let cachedSessions = [];` 之后)加模块级缓存:

```js
    // 最近一次 /api/projects 的项目列表,供切换抽屉渲染项目区 + 启动入口
    let cachedProjects = [];
```

**(b)** `loadProjects`(`:765-808`)内,在 `const projects = data && Array.isArray(data.projects) ? data.projects : [];`(`:789`)之后缓存(空列表也缓存,避免抽屉显示陈旧数据):

```js
            cachedProjects = projects;
```

**(c)** `rebuildSheet`(`:941-960`)改为同时构建项目项 + 注入 `onLaunch`。把现有:

```js
                const items = SwitchSheet.buildSessionItems(cachedSessions, currentSession);
                sheetHandle = SwitchSheet.createSwitchSheet({
                    trigger: switchTrigger, items,
                    onPick: (name) => {
```

替换为(在 `items` 之后加 `projectItems`,在 `createSwitchSheet` 选项里加 `projects` 与 `onLaunch`):

```js
                const items = SwitchSheet.buildSessionItems(cachedSessions, currentSession);
                const curEntry = Array.isArray(cachedSessions) ? cachedSessions.find(s => s && s.name === currentSession) : null;
                const projectItems = SwitchSheet.buildProjectItems(cachedProjects, curEntry && curEntry.cwd);
                sheetHandle = SwitchSheet.createSwitchSheet({
                    trigger: switchTrigger, items,
                    projects: projectItems,
                    onPick: (name) => {
```

并在 `onPick` 回调块之后(即 `createSwitchSheet({...})` 的选项对象内,`switchTrigger.addEventListener('click', ...)` 之前)追加 `onLaunch`:

```js
                    onLaunch: (cwd) => {
                        if (sheetHandle) sheetHandle.close();
                        if (projectSelect) projectSelect.value = cwd;
                        startProjectSession();
                    },
                });
```

> 注意闭合:`createSwitchSheet({ ... onPick, onLaunch });` 结束后才接 `switchTrigger.addEventListener`。实现时核对原 `:944-959` 的括号结构,保持 `rebuildSheet` 其余部分不变。

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test test/ios_header.test.cjs`
Expected: PASS(含新集成断言)。

- [ ] **Step 5: 提交**

```bash
git add public/client.js test/ios_header.test.cjs
git commit -m "feat(client): 抽屉注入项目项+onLaunch,缓存 cachedProjects 复用启动逻辑"
```

---

## Task 5: index.html + style.css 卡片容器 + 桌面单行等高 header + 终端去外框 + welcome 去 serif

**Files:**
- Modify: `public/index.html:17-71`(`#app` 整块)
- Modify: `public/style.css`(删 `.brand-row`/`.meta-bar`/`.logo` 旧段、改 `.header`、改 `.messages`/`.terminal-view`/`.welcome-message p`、加卡片+单行新规则)
- Test: `test/ios_header.test.cjs`(更新 brand-ver / meta 结构断言)

- [ ] **Step 1: 写失败测试(反映新 DOM 契约)**

`test/ios_header.test.cjs` 中:

(a) 删除 `brand-ver` 断言 —— 把 `:11-17` 的 test 整体替换为:

```js
test('index.html header: brand 区 + brand-mark--sm + brand-name,无 brand-ver', () => {
    const h = readHtml();
    assert.ok(h.includes('class="brand"') || h.includes('class="header-left"'), 'header 有 brand 区');
    assert.ok(h.includes('class="brand-mark brand-mark--sm"'));
    assert.ok(h.includes('class="brand-name"'));
    assert.ok(!h.includes('class="brand-ver"'), 'brand-ver v2.4 应删除');
});
```

(b) meta 断言不再要求独立 `.meta-bar` —— 把 `:28-35` 的 test 替换为(保留 `metaProject`/`metaSession`/`meta-label`/`meta-sep` id/class,但允许并入单行 `meta-inline`):

```js
test('index.html header: project/session meta 元素齐全(metaProject/metaSession/meta-label/meta-sep)', () => {
    const h = readHtml();
    assert.ok(h.includes('id="metaProject"'));
    assert.ok(h.includes('id="metaSession"'));
    assert.ok(h.includes('class="meta-label"'));
    assert.ok(h.includes('class="meta-sep"'));
});
```

(c) 在文件末尾追加卡片容器 + 单行 header 契约断言:

```js
test('index.html: .console-card 卡片包裹 header + main', () => {
    const h = readHtml();
    assert.ok(h.includes('class="console-card"'), '应有 .console-card 包裹容器');
    const cardStart = h.indexOf('class="console-card"');
    const cardOpen = h.lastIndexOf('<div', cardStart);
    const headerIdx = h.indexOf('<header', cardStart);
    const mainIdx = h.indexOf('class="main"', cardStart);
    assert.ok(headerIdx > cardOpen, 'header 在 console-card 内');
    assert.ok(mainIdx > cardOpen, 'main 在 console-card 内');
});

test('index.html header: 单行结构 header-left + header-right', () => {
    const h = readHtml();
    assert.ok(h.includes('class="header-left"'));
    assert.ok(h.includes('class="header-right"'));
});

test('style.css: .console-card 限宽 1100 + 阴影 + 圆角', () => {
    const css = readCss();
    const block = css.match(/\.console-card\s*\{[^}]*\}/);
    assert.ok(block, '应有 .console-card 规则');
    assert.ok(/max-width:\s*1100px/.test(block[0]));
    assert.ok(/box-shadow:\s*var\(--shadow-card\)/.test(block[0]));
    assert.ok(/border-radius:\s*var\(--r\)/.test(block[0]));
});

test('style.css: header 单行 flex-direction row', () => {
    const css = readCss();
    const block = css.match(/\.header\s*\{[^}]*\}/);
    assert.ok(block && /flex-direction:\s*row/.test(block[0]), 'header 应为单行(row)');
});

test('style.css: .terminal-view 去外框(无 border,纳入卡片)', () => {
    const css = readCss();
    const block = css.match(/\.terminal-view\s*\{[^}]*\}/);
    assert.ok(block && /border:\s*none/.test(block[0]), 'terminal-view 应 border:none(卡片已有边框)');
});

test('style.css: welcome-message p 去 serif(用 sans)', () => {
    const css = readCss();
    const block = css.match(/\.welcome-message\s+p\s*\{[^}]*\}/);
    assert.ok(block && /font-family:\s*var\(--sans\)/.test(block[0]), 'welcome p 应用 sans(终端页字体收敛)');
    assert.ok(block && !/var\(--serif\)/.test(block[0]), 'welcome p 不应再用 serif');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test test/ios_header.test.cjs`
Expected: FAIL —— 缺 `.console-card` / `header-left` / 终端 `border:none` 等(旧 DOM/CSS 不满足新契约)。

- [ ] **Step 3a: 重排 `public/index.html` 的 `#app`(`:17-71`)**

把整个 `<div id="app"> ... </div>` 替换为:

```html
    <div id="app">
        <!-- 控制台卡片容器:header + main 同宽对齐,治「空挂」 -->
        <div class="console-card">
            <!-- 顶部导航:桌面单行等高 -->
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
                    <span class="meta-inline" role="group" aria-label="会话信息">
                        <span class="meta-label">project</span>
                        <span id="metaProject" class="meta-val">—</span>
                        <span class="meta-sep" aria-hidden="true">·</span>
                        <span class="meta-label">s</span><span id="metaSession" class="meta-val">—</span>
                    </span>
                </div>
                <div class="header-right">
                    <div class="header-actions" id="desktopControls">
                        <div class="controls">
                            <label class="control"><span class="control-label">Session</span><select id="sessionSelect" class="control-input"></select></label>
                            <button id="refreshSessions" class="btn" type="button">刷新</button>
                            <label id="projectControl" class="control"><span class="control-label">Project</span><select id="projectSelect" class="control-input"></select></label>
                            <p id="projectsEmpty" class="projects-empty" hidden></p>
                            <button id="startProject" class="btn" type="button">启动</button>
                        </div>
                    </div>
                    <nav class="nav" aria-label="主导航">
                        <a class="nav-link cur" href="/" aria-current="page">控制台</a>
                        <a class="nav-link" href="/dashboard.html">看板</a>
                        <a class="nav-link nav-link--login" href="/login">登录</a>
                    </nav>
                    <button id="switchToggle" class="swap-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="switchSheet">切换 <span aria-hidden="true">⌄</span></button>
                </div>
            </header>
            <!-- 切换 sheet 容器(switch_sheet.cjs createSwitchSheet 创建 backdrop+sheet 挂 body;此 #switchSheet 仅作 aria-controls 锚点) -->
            <div id="switchSheet" hidden></div>
            <!-- 主内容区 -->
            <main class="main">
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
    </div>
```

- [ ] **Step 3b: 改 `public/style.css`**

**(b1)** 卡片容器 —— 在 `#app { ... }`(`:24-29`)之后插入:

```css
/* ── 控制台卡片容器:header+main 同宽对齐,治「空挂」── */
.console-card {
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    box-shadow: var(--shadow-card);
    overflow: hidden;
}
```

**(b2)** header 单行等高 —— 把 `.header { ... }`(`:32-36`)整块替换为:

```css
/* ── header:桌面单行等高(治「高高低低」);移动/中屏折叠见 Task 6 断点 ── */
.header {
    display: flex; flex-direction: row; align-items: center; justify-content: space-between;
    gap: 12px; flex-shrink: 0;
    padding: 8px max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left));
    padding-top: max(8px, env(safe-area-inset-top));
    background-color: var(--surface-2); border-bottom: 1px solid var(--border);
}
.header-left, .header-right { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 15px; font-weight: 600; color: var(--fg); }
.brand-name { letter-spacing: -0.015em; }
```

**(b3)** 删除旧的 `.brand-row`(`:37-40`)与 `.logo`(`:41-46`)两段(单行结构已由 `.header-left/right` 取代)。`.header-actions`(`:47`)保留(`#desktopControls` 仍带此 class),改为极简规则:

```css
.header-actions { display: flex; align-items: center; gap: 8px; }
```

**(b4)** meta 并入单行 —— 把 `.meta-bar { ... }`(`:50-65`)整块及其子选择器替换为(删 `border-top`,改容器为 `meta-inline`,`meta-label` 由 `--fg-3` 改 `--fg-2` 达 AA):

```css
/* meta:并入单行的等高 mono 信息行(WCAG:meta-label 用 fg-2 达 AA,守 tokens 契约) */
.meta-inline {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;
    font-family: var(--mono); font-size: 11px; color: var(--fg-2);
}
.meta-inline .meta-label { color: var(--fg-2); flex-shrink: 0; }
.meta-inline .meta-val { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.meta-inline .meta-sep { color: var(--border-2); flex-shrink: 0; }
```

`.swap-btn` 原挂在 `.meta-bar` 下(`:59-64`),现移入 `.header-right`,独立成规则(断点显隐见 Task 6):

```css
.swap-btn {
    flex-shrink: 0; min-height: 44px; padding: 0 12px;
    border: 1px solid var(--accent-dim); border-radius: var(--r-pill);
    background: var(--accent-bg); color: var(--accent-2);
    font-family: var(--mono); font-size: 11px; cursor: pointer;
}
.swap-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
```

**(b5)** `.messages` 去限宽(卡片已限宽居中)—— 把 `.messages { ... }`(`:141-145`)替换为:

```css
.messages {
    flex: 1;
    margin: 0;
    padding: 20px;
}
```

**(b6)** welcome p 去 serif —— 把 `.welcome-message p { ... }`(`:150-153`)替换为:

```css
.welcome-message p {
    font-family: var(--sans); font-size: 14px; line-height: 1.6; color: var(--fg-2);
    max-width: 340px; margin: 0 auto;
}
```

**(b7)** 终端去外框 —— 把 `.terminal-view { ... }`(`:155-159`)替换为(`flex:1` 填满卡片,去 border/radius/min-height 固定值):

```css
.terminal-view {
    width: 100%; border: none; border-radius: 0; overflow: hidden;
    background-color: var(--surface); display: flex; flex-direction: column;
    flex: 1; min-height: 0;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test test/ios_header.test.cjs`
Expected: PASS(新 DOM/CSS 契约全部满足)。

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/style.css test/ios_header.test.cjs
git commit -m "feat(console): 卡片容器包裹+桌面单行等高 header,终端去外框/welcome 去 serif"
```

---

## Task 6: 移动/中屏折叠断点 + switch_sheet 项目区样式

**Files:**
- Modify: `public/style.css:286-336`(底部媒体查询区)
- Test: `test/ios_header.test.cjs`(更新断点断言:768/769 → 1100/1101)

> spec 风险:中屏(768-1100px)单行拥挤 → 中屏断点(≤1100)也折叠控件进抽屉,不只移动端。

- [ ] **Step 1: 写失败测试(更新断点契约)**

`test/ios_header.test.cjs` 中,把 `:104-119`(max-width:768 含 `#desktopControls display:none`)与 `:121-127`(min-width:769 含 `#switchToggle.swap-btn display:none`)两个 test 替换为新断点:

```js
test('style.css @media (max-width:1100px) 块含 #desktopControls display:none(中屏+移动折叠)', () => {
    const css = readCss();
    const head = '@media (max-width: 1100px) {\n';
    const start = css.indexOf(head);
    assert.ok(start >= 0, '存在多行 max-width:1100px 媒体查询块');
    const braceOpen = css.indexOf('{', start);
    let depth = 0, i = braceOpen;
    for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const block = css.slice(start, i);
    assert.ok(/#desktopControls\s*\{[^}]*display:\s*none/.test(block), '≤1100 时 desktopControls 应隐藏');
    assert.ok(/#switchToggle\.swap-btn\s*\{[^}]*display:\s*inline-flex/.test(block), '≤1100 时切换入口应显示');
});

test('style.css @media (min-width:1101px) 含 #switchToggle.swap-btn display:none(桌面控件外露)', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (min-width: 1101px)');
    assert.ok(block, '存在 min-width:1101px 媒体查询');
    assert.ok(/#switchToggle\.swap-btn\s*\{[^}]*display:\s*none/.test(block));
});
```

末尾追加 switch_sheet 项目区样式契约:

```js
test('style.css: switch-sheet 项目区分组 + 启动按钮样式', () => {
    const css = readCss();
    assert.ok(css.includes('.switch-sheet-projects'), '应有项目区容器样式');
    assert.ok(css.includes('.switch-sheet-section-title'), '应有分组标题样式');
    assert.ok(css.includes('.switch-sheet-btn--launch'), '应有启动按钮样式');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `node --test test/ios_header.test.cjs`
Expected: FAIL —— 断点仍是 768/769,无 1100/1101 块,无项目区样式。

- [ ] **Step 3: 重排 `public/style.css` 底部媒体查询(`:286-336`)**

把整个底部区段(从 `@media (max-width: 768px) {`(`:286`)到文件末尾的 `@media (min-width: 769px) { #switchToggle.swap-btn { display: none; } }`(`:333-336`))替换为:

```css
/* === switch_sheet 项目区(spec §4 抽屉扩展)=== */
.switch-sheet-projects { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.switch-sheet-section-title {
    margin: 0 0 8px; font-family: var(--mono); font-size: 11px; color: var(--fg-2);
    letter-spacing: 0.04em; text-transform: lowercase;
}
.switch-sheet-btn--launch::before {
    content: '↗'; display: inline-block; margin-right: 6px; color: var(--accent-2);
}

/* === 折叠断点:中屏(≤1100)即折叠控件进抽屉,不只移动端 === */
@media (max-width: 1100px) {
    /* 控件收进「切换」抽屉,header 精简为 brand+live+nav */
    #desktopControls { display: none; }
    .meta-inline { display: none; }
    #switchToggle.swap-btn { display: inline-flex; }
    /* 卡片贴边:窄屏不浪费空间 */
    .console-card { max-width: 100%; margin: 0; border-radius: 0; border: none; box-shadow: none; }
}

/* 桌面(>1100):控件外露,抽屉入口隐藏 */
@media (min-width: 1101px) {
    #switchToggle.swap-btn { display: none; }
}

/* 窄屏(≤768)细节收缩 */
@media (max-width: 768px) {
    .header { padding: 8px 12px; }
    .control-label { display: none; }
    .messages { padding: 10px; }
    .terminal-content { padding: 10px; font-size: 12px; }
    .terminal-input-row { padding: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
    /* 移动端登录入口收起(spec §4:登录收起) */
    .nav-link--login { display: none; }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `node --test test/ios_header.test.cjs`
Expected: PASS(新断点 + 项目区样式契约满足)。

- [ ] **Step 5: 提交**

```bash
git add public/style.css test/ios_header.test.cjs
git commit -m "feat(console): 中屏(≤1100)折叠控件进抽屉+卡片贴边,switch_sheet 项目区样式"
```

---

## Task 7: WCAG 收尾核对 + 全量测试 + 三档视觉走查

**Files:**
- Read-only 核对:`public/style.css`(确认无 `--fg-3` 承载阅读文字)、`public/tokens.css`
- 全量:`npm test`

> spec §5:`meta-label` 等 `--fg-3`→`--fg-2` 已在 Task 5(b4)完成;本任务做交叉核对(无其它读文字残留 fg-3)+ 全量绿 + 视觉走查。

- [ ] **Step 1: 写核对测试(防 fg-3 回流到阅读文字)**

在 `test/ios_header.test.cjs` 末尾追加:

```js
test('style.css: 阅读文字 meta-label 不用 fg-3(WCAG AA)', () => {
    const css = readCss();
    const block = css.match(/\.meta-inline\s+\.meta-label\s*\{[^}]*\}/);
    assert.ok(block, '应有 .meta-inline .meta-label 规则');
    assert.ok(!/var\(--fg-3\)/.test(block[0]), 'meta-label 不应用 fg-3(禁承载阅读文字)');
    assert.ok(/var\(--fg-2\)/.test(block[0]), 'meta-label 应用 fg-2(达 AA)');
});
```

- [ ] **Step 2: 运行测试,确认通过(实现已在 Task 5 完成)**

Run: `node --test test/ios_header.test.cjs`
Expected: PASS。若 FAIL,回到 Task 5(b4)核对 `.meta-inline .meta-label` 用的是 `--fg-2`。

- [ ] **Step 3: 全量测试**

Run: `npm test`
Expected: 全部 test/*.test.cjs PASS。重点关注 `tokens.test.cjs`(无旧令牌回流)、`ios_header.test.cjs`、`switch_sheet.test.cjs`、`session_switch.test.cjs`(未改,应仍绿)。

- [ ] **Step 4: 三档断点视觉走查(手动,记录到提交说明)**

启动本地服务后,浏览器 DevTools 切三档视口核对:

- **桌面 >1100px(如 1440):** `.console-card` 居中 1100,header 与终端左右对齐(治空挂);header 单行等高,brand+live+project 在左,Session/Project/启动+nav 在右;终端无外框,靠卡片边框区隔;切换按钮隐藏。
- **中屏 768-1100(如 900):** 卡片贴边;header 仅 brand+live+nav;控件隐藏,「切换 ⌄」显示;点开抽屉见会话列表 + 项目列表 + 启动入口。
- **移动 ≤768(如 375):** 同中屏折叠;登录入口收起;输入区 safe-area 底距正常;终端字体 12px。

走查通过后,在后续提交(或合并说明)记录三档结果。

- [ ] **Step 5: 提交核对测试**

```bash
git add test/ios_header.test.cjs
git commit -m "test(console): 防阅读文字回流 fg-3 的 WCAG 核对断言"
```

---

## 完成判据

- [ ] 7 个任务全部提交,`npm test` 全绿。
- [ ] 桌面/中屏/移动三档视觉走查:卡片对齐、header 单行等高、移动抽屉含项目+启动。
- [ ] WCAG:`meta-label` 达 AA(无 fg-3 承载阅读文字)。
- [ ] 无范围越界:未改 `server.cjs` / 看板页 / 登录页 / 终端输入模型。
