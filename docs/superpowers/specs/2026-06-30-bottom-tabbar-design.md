# 控制台底部 Tab 导航重构 设计(修订版)

> 日期:2026-06-30(修订)· 分支:`feat/bottom-tabbar`
> 状态:经 UI/UX 专家团队(视觉排版 / 信息架构 / 响应式移动 / 无障碍 四视角)审核 + 用户三决策,修订原 spec
>
> **修订要点**:① header 保留极简 session 标识(原 spec 全删 meta)② 移动端 tab 在终端输入聚焦时折叠让位(原 spec 全尺寸常驻)③ 抽屉内三段分组 ④ 色彩与按钮语言收敛 ⑤ 顺带修 a11y 硬伤 ⑥ 实现用隐藏状态载体(client.js 零改)

## 1. 背景 / 问题

用户实际跑起来看了桌面/中屏/移动三档后反馈:**「控制台界面看起来很乱」**。UI/UX 专家团队四视角审核确认「乱」的根因:

1. **header 一行塞 6 类异质元素**(brand · live 点 · meta 信息行 · Session/Project 控件+刷新+启动 · nav 三链接 · 切换按钮),无视觉分组、无层级 → 桌面密度爆炸(视觉/IA/响应式三方共识,首要根因)
2. **桌面 vs 中屏(≤1100)体验割裂**:桌面控件外露、中屏全进抽屉,断点跳变突兀,缩放时控件「整体换一套」
3. **三套冲突的按钮语言**(28px 灰 btn / 胶囊 nav / 橙色 swap-btn)+ Sans/mono 字族无序交替
4. **暖橙强调色在 header 出现 4 处**(brand-mark / live 点 / swap / cur 高亮),喧宾夺主,live 状态色与 CTA 撞色
5. **28px 矮控件 + `.btn` 无 `:focus-visible`** → 同时违 WCAG 2.5.8(目标尺寸)与 2.4.11(焦点可见)
6. **登录 link 冗余**:已登录用户不需要;未登录被服务器 302 重定向到 `/login`,根本看不到该 header

## 2. 目标

- header 精简为 **brand + live 点 + 极简 session 标识**(全尺寸可见)
- **底部 tab bar**:`≥768` 全宽常驻;`≤768` 终端输入聚焦时自动折叠让位
- `#desktopControls` 功能并入「切换」抽屉(**三段分组**)
- 删除「登录」link
- **色彩收敛**(live 换状态色) + **按钮语言统一**
- **顺带修 a11y 硬伤**(对比度 / h1 / inert / focus / 目标尺寸 / aria)
- 清理因此冗余的响应式断点

## 3. 非目标(YAGNI)

- 不改 `switch_sheet` 抽屉核心交互(focus trap / Esc / ⌃C 已完成,仅补 inert 与三段分组)
- 不改终端镜像、tmux 轮询逻辑
- 不重做设计令牌(`tokens.css`),仅修正违规用法(如 `--fg-3` 误用于 placeholder)
- 看板页「切换」tab 仅跳回控制台并打开抽屉,不在看板内复刻抽屉
- client.js 不做参数化重构(改用隐藏状态载体,见 §4.5);参数化列后续优化

## 4. 结构变更

### 4.1 header(`index.html`)

```html
<header class="header">
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
```

- **保留极简 session 标识**(只 `s:NNn`,删 project 部分 —— project 在抽屉体现)。全尺寸可见,中屏/移动不丢「当前会话」信息(响应式 + IA 共识,推翻原 spec「全删 meta」)。
- **移除**:`.header-right`、`#desktopControls`、`<nav class="nav">`(含登录 link)、`#switchToggle`、meta 的 project 部分。
- **色彩收敛**:`.live-dot-text` 文字改 **Sans**(状态文案非数据)+ 状态色谱(`--working`/`--errored`),**不用 `--accent`**;`.live-dot-pulse` 点保留橙(装饰,有文字双编码)。一屏橙 ≤2 处(brand-mark 装饰 + tab active 指示条)。

### 4.2 底部 tab bar(`index.html`)

```html
<nav class="bottom-tabbar" aria-label="主导航">
  <a class="tab tab--active" href="/" aria-current="page">▤ 控制台</a>
  <a class="tab" href="/dashboard.html">◫ 看板</a>
  <button class="tab" type="button" id="switchTab"
          aria-haspopup="dialog" aria-expanded="false" aria-controls="switchSheet">⇄ 切换</button>
</nav>
```

- **`≥768px` 常驻**:全宽贴底,三 tab 等分(flex:1),图标在上 + 文字在下,`min-height:44px`,`padding-bottom:env(safe-area-inset-bottom)`。
- **active 态用顶部短指示条**(2-3px 高、`--accent-2`、宽约 tab 的 40%),**不整块染色**(避免与 brand-mark 抢橙)。
- **`≤768px` 折叠**:tab bar 常驻,但**终端输入区(input/textarea)聚焦时自动隐藏**(`.bottom-tabbar.is-hidden` → display:none),失焦恢复。键盘弹起时由现有 `--vh-available` 适配。这样移动端底部输入时不堆叠,非输入时导航完整(符合用户「移动折叠」决策,不引入 FAB 新组件,实现最简)。
- **页面跳转 tab 用 `<a>` + `aria-current="page"`**(不用 `role=tab`,避免 AT 误期望箭头键导航 —— a11y 专家要求);切换 tab 是 `<button>`,不持 active 态(控制台 tab 保持 active)。

### 4.3 看板页同步(`dashboard.html`)

看板页加同一 `.bottom-tabbar`,**看板 tab 为 active**。看板页「切换」tab = `sessionStorage.setItem('openSwitchSheet','1')` 后跳 `/`;控制台 `init` 读取该标志 → 打开抽屉 → **立即 `removeItem`**(无论是否成功打开,防残留)。

### 4.4 `#app` 布局

```css
#app { display:flex; flex-direction:column; height:100dvh; min-height:0; }
.console-card { flex:1; min-height:0; /* 已有 */ }
.bottom-tabbar { flex-shrink:0; }
```

### 4.5 控件入抽屉(三段分组 + 隐藏状态载体)

**抽屉三段分组**(否则「乱」会从 header 搬到抽屉 —— 视觉专家 P0-C):

1. **顶部 meta 行**(`.switch-sheet-meta`):`project · s:NNn`,mono 11px,fg-2
2. **会话列表**(复用 `buildSessionItems`):每项一个 `.switch-sheet-btn`,当前项高亮+disabled
3. **项目启动区**(复用 `buildProjectItems` + `onLaunch`):每项直达按钮;**空状态** `.switch-sheet-projects-empty`(无项目时提示)

**刷新并入 onOpen**:抽屉打开时自动 `loadSessions()`(去掉独立刷新按钮,消除位置误导)。`#refreshSessions` 按钮直接删除(不移入载体);`client.js` init 的 `if(refreshSessionsBtn)` 守卫自然跳过,无需改 JS。

**实现决策:隐藏状态载体**(非参数化):

`sessionSelect`/`projectSelect`/`projectControl`/`projectsEmpty`/`startProject` 移入 `<div id="stateCarriers" hidden>`,元素仍存在但不可见。

- **理由**:`client.js` 的 `loadSessions`(`if(!sessionSelect) return`)、`loadProjects`(`if(!projectSelect||!projectControl||!startProjectBtn) return`)、`startProjectSession`(`if(!projectSelect) return`)依赖这些 DOM。隐藏载体使 client.js **零改**(getElementById 仍找到它们,读写 value 正常),抽屉用 `cachedSessions`/`cachedProjects` 渲染。
- IA 专家担心的「桌面下拉 vs 抽屉双套控件状态不一致」:select 隐藏后用户唯一交互入口是抽屉,双套风险消解。
- **不采用参数化改造**(`startProjectSession(cwd?)` 等):风险与改动量更高,列后续优化备选。

抽屉打开时背景加 `inert`(补 `aria-modal` 跨 AT 缺陷,a11y B7)。

## 5. 组件与样式(`style.css`)

### 5.1 header 精简 + live 换状态色

- `.header` 去掉 `justify-content:space-between`(右侧已空,左对齐);padding 上下加大到呼吸。
- `.live-dot-text` 改 Sans + 状态色谱(`--working`/`--errored`,非 `--accent`);`.live-dot-pulse` 保留橙装饰。
- 删/收敛:`.header-right`、`#desktopControls`、`.swap-btn`、`.meta-inline` 的 project 部分。`.nav`(胶囊)规则删除。

### 5.2 `.bottom-tabbar` / `.tab` / 折叠

```css
.bottom-tabbar {
  display:flex; flex-shrink:0;
  background:var(--surface-2); border-top:1px solid var(--border);
  padding-bottom:env(safe-area-inset-bottom);
}
/* .bottom-tabbar.is-hidden 规则定义在 @media(≤768) 内(见 §7):JS 无条件在输入聚焦时加类,但仅 ≤768 隐藏;>768 即使有类也不影响 tab 显示 */
.tab {
  flex:1; min-height:44px; padding:8px 0;
  display:flex; flex-direction:column; align-items:center; gap:2px;
  background:none; border:none; color:var(--fg-2);
  font-family:var(--sans); font-size:11px; text-decoration:none; cursor:pointer;
  position:relative;
}
.tab--active { color:var(--accent-2); font-weight:600; }
.tab--active::before {   /* 顶部短指示条,不整块染色 */
  content:''; position:absolute; top:0; left:30%; right:30%; height:2px;
  background:var(--accent-2); border-radius:0 0 2px 2px;
}
.tab:focus-visible { outline:2px solid var(--accent-2); outline-offset:-2px; }
```

### 5.3 抽屉三段分组 + 色彩/按钮收敛

- `.switch-sheet-meta`:顶部 meta 行(mono 11px fg-2)。
- `.switch-sheet-projects-empty`:项目区空状态。
- 会话/项目段用 `.switch-sheet-section-title` 分隔(已有「项目」标题,补「会话」标题)。
- 抽屉内 `.switch-sheet-btn` 保持 44px;active 态用 `--accent-bg` 不整块橙。

## 6. 交互

| tab | 行为 |
|---|---|
| 控制台 | 当前页(`tab--active` `aria-current="page"`);`href="/"` |
| 看板 | 跳 `/dashboard.html` |
| 切换 | 打开 `switch_sheet` 抽屉(`button`,不导航);控制台 tab 保持 active |

抽屉打开:`loadSessions()`(刷新)→ 渲染 meta 行 → 会话列表 → 项目启动区(空则提示)→ 背景 `inert`。关闭:移除 `inert`、焦点回归 `#switchTab`。

`≤768`:终端 input/textarea `focus` → `.bottom-tabbar` 加 `is-hidden`;`blur` → 移除。

## 7. 断点清理(`style.css`)

删除(对应元素已不存在或重构):
- `@media(≤1100)` 的 `#desktopControls{display:none}`、`.meta-inline{display:none}`、`#switchToggle.swap-btn{display:inline-flex}`
- `@media(≤768)` 的 `.nav .nav-link--login{display:none}`
- `@media(>1100)` 的 `#switchToggle.swap-btn{display:none}`

**新增**(`@media(≤768)` 内):

```css
.bottom-tabbar.is-hidden { display:none; }   /* 终端输入聚焦时 JS 加类;仅 ≤768 生效,>768 不隐藏 */
```

JS 无条件在终端 input/textarea `focus` 时加 `.is-hidden`、`blur` 移除;CSS 媒体查询控制仅移动端隐藏。

**保留**:`@media(≤1100)` 的 `.console-card` 窄屏贴边(去 max-width/阴影,但**保留圆角与细边框**,视觉专家 P2-G,平滑过渡而非硬切)。

## 8. 无障碍(顺带修硬伤)

- **对比度**:placeholder 改 `--fg-2`(达 AA,原 `--fg-3` 仅 2.5:1 违例);toast info/success 加深底色达 AA(`--waiting`/`--success` 加深)。
- **补 `<h1>`**:`<main>` 顶部加 visually-hidden `<h1>控制台</h1>`(建立大纲)。
- **抽屉背景 `inert`**:open 时给 `.console-card` 加 `inert`,补 `aria-modal` 跨 AT 缺陷。
- **`aria-controls` 指向真实 dialog**:动态 sheet 加 `id="switchSheet"`,删空锚点 div。
- **目标尺寸 + focus**:控件统一 44px;`.btn` 补 `:focus-visible`。
- **终端 input 加 `aria-label`**(如「命令输入」),placeholder 不作 label。
- **tab 语义**:页面跳转用 `<a>` + `aria-current="page"`(不用 `role=tab`)。

## 9. 测试策略

`test/ios_header.test.cjs` 更新 + `test/switch_sheet.test.cjs` 扩展 + 新建 `test/dashboard_tabbar.test.cjs`(源码字符串/正则断言):

- **HTML 契约**:header 只 brand+live+极简 session(无 nav/desktopControls/switchToggle);`.bottom-tabbar` 三 tab;无 `nav-link--login`;`#stateCarriers hidden` 含原控件 id;补 `<h1>`;终端 input 有 aria-label。
- **CSS 契约**:`.bottom-tabbar`+`.tab`+`--accent-2` active 指示条;`.bottom-tabbar.is-hidden`;断点清理无残留;placeholder 用 `--fg-2`。
- **switch_sheet**:抽屉 meta 行 + 项目区空状态 + `inert` 切换源码契约。
- **client.js**:`switchTab` 装配(原 switchToggle)+ sessionStorage `openSwitchSheet` 检测 + `≤768` 输入聚焦隐藏 tab bar。
- **回归**:无 `id="desktopControls"`/`nav-link--login`/`id="switchToggle"` 残留。

运行时验证(chrome-devtools 计算值):桌面/中屏/移动三档 + 抽屉三段 + 移动端输入聚焦 tab 隐藏 + a11y 对比度。

## 10. 验收标准

- [ ] header 全尺寸只 brand + live + 极简 session 标识
- [ ] `≥768` 底部三 tab(控制台 active,顶部指示条);`≤768` 终端输入聚焦时 tab 隐藏让位
- [ ] 切换 tab 打开抽屉,含 meta 行 + 会话列表 + 项目启动区(空状态);打开自动刷新;背景 inert
- [ ] 登录 link 不存在
- [ ] 看板页底部 tab(看板 active);其切换 tab 跳控制台开抽屉
- [ ] 色彩收敛:live 用状态色,一屏橙 ≤2 处
- [ ] a11y:placeholder/toast 对比达 AA;有 `<h1>`;控件 44px+focus;终端 input 有 aria-label;aria-controls 指向真实 dialog
- [ ] `npm test` 全绿
- [ ] 桌面/中屏/移动三档视口走查通过
