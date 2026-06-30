# 控制台底部 Tab 导航重构 设计

> 日期:2026-06-30 · 分支:`feat/bottom-tabbar`
> 状态:设计已批准,待写实施计划(writing-plans)

## 1. 背景 / 问题

控制台页(`index.html`)header 当前承载:brand、live 点、meta 信息行、`#desktopControls`(Session/Project/启动控件)、主导航 `<nav>`(控制台/看板/登录)、切换按钮 `#switchToggle`。顶部信息密度高、拥挤。

用户反馈两点:

1. **「登录」link 多余** —— 已登录用户在控制台内不需要它;未登录用户被服务器强制 302 重定向到 `/login`(已验证根路径 `→ /login?next=%2F`),根本看不到该 header。
2. **导航 + 切换应移到底部 tab bar** —— app 风格,拇指可达,顶部留给 brand。

## 2. 目标

- header 精简为 **brand + live 点**(全尺寸)
- 新增**全尺寸底部 tab bar**:控制台 / 看板 / 切换
- `#desktopControls`(Session/Project/启动)**功能不丢**,挪进「切换」抽屉
- 删除「登录」link
- 清理因此冗余的响应式断点

## 3. 非目标(YAGNI)

- 不改 `switch_sheet` 抽屉的核心交互(focus trap / Esc / ⌃C 已完成)
- 不改终端镜像、tmux 轮询逻辑
- 不重做设计令牌(`tokens.css`)
- 看板页(`dashboard.html`)的「切换」tab 仅跳回控制台并打开抽屉,不在看板内复刻抽屉

## 4. 结构变更

### 4.1 header(`index.html`)

精简为:

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
  </div>
</header>
```

移除:`.header-right`、`#desktopControls`、`<nav class="nav">`(含登录 link)、`#switchToggle`、`.meta-inline`。

**meta(project·session)信息行移入抽屉顶部**(打开抽屉可见当前会话/项目),不在 header。

### 4.2 底部 tab bar(`index.html`)

`#app` 内、`.console-card` 之后新增(tab bar 全宽贴底,不被卡片限宽约束):

```html
<nav class="bottom-tabbar" aria-label="主导航">
  <a class="tab tab--active" href="/" aria-current="page">▤ 控制台</a>
  <a class="tab" href="/dashboard.html">◫ 看板</a>
  <button class="tab" type="button" id="switchTab"
          aria-haspopup="dialog" aria-expanded="false" aria-controls="switchSheet">⇄ 切换</button>
</nav>
```

- 控制台 tab:当前页(`tab--active`)
- 看板 tab:跳 `/dashboard.html`
- 切换 tab:`<button>`,触发 `switch_sheet` 抽屉;它不是页面,不持 active 态(控制台 tab 保持 active)

### 4.3 看板页同步(`dashboard.html`)

看板页加同一 `.bottom-tabbar`,**看板 tab 为 active**,保证导航闭环。看板页「切换」tab = 设置 `sessionStorage.setItem('openSwitchSheet','1')` 后跳 `/`,控制台 `init` 读取该标志、打开抽屉并清除标志。

### 4.4 `#app` 布局

```css
#app { display:flex; flex-direction:column; height:100dvh; min-height:0; }
.console-card { flex:1; min-height:0; /* 已有 */ }
.bottom-tabbar { flex-shrink:0; }
```

`.console-card` 占满中段(含 header + main),tab bar 固定底部一栏。

### 4.5 控件入抽屉(`switch_sheet.cjs` / `client.js`)

`#desktopControls` 删除,功能由抽屉承接:

- **Session 切换** → 抽屉「会话列表」(已存在 `buildSessionItems`)
- **Project 启动** → 抽屉「项目启动区」(已存在 `buildProjectItems` + `onLaunch`)
- **refreshSessions(刷新)** → 抽屉打开时自动 `loadSessions()`(并入 `createSwitchSheet` 的 onOpen 回调)
- **projectsEmpty(空状态)** → 抽屉项目区无项目时显示提示文字(并入 `buildProjectItems` 渲染:列表为空时渲染 `.switch-sheet-projects-empty`)

抽屉顶部新增当前会话/项目信息行(承接 header 移除的 meta)。

## 5. 组件与样式(`style.css`)

### 5.1 header 精简

- `.header` 单行:`brand + live`,左对齐即可(不再 space-between,因右侧已空)
- 删除/收敛:`.header-right`、`#desktopControls`、旧 `.nav`(胶囊)、`.swap-btn`、`.meta-inline` 规则
  - `.meta-*` 规则可保留并复用于抽屉的 meta 行(改名/复用)

### 5.2 `.bottom-tabbar`

```css
.bottom-tabbar {
  display:flex; flex-shrink:0;
  background:var(--surface-2); border-top:1px solid var(--border);
  padding-bottom:env(safe-area-inset-bottom);
}
.tab {
  flex:1; min-height:44px; padding:8px 0;
  display:flex; flex-direction:column; align-items:center; gap:2px;
  background:none; border:none; color:var(--fg-2);
  font-family:var(--sans); font-size:11px; text-decoration:none; cursor:pointer;
}
.tab--active { color:var(--accent-2); font-weight:600; }
.tab:focus-visible { outline:2px solid var(--accent-2); outline-offset:-2px; }
@media (prefers-reduced-motion: reduce) { .tab { transition:none; } }
```

图标用文字符号 `▤ ◫ ⇄`,无需图片资源,三档视口一致。

### 5.3 抽屉扩展

- `.switch-sheet-meta`:抽屉顶部当前 project · session 信息行
- `.switch-sheet-projects-empty`:项目区无项目时的提示

## 6. 交互

| tab | 行为 |
|---|---|
| 控制台 | 当前页(`tab--active`);`href="/"` |
| 看板 | 跳 `/dashboard.html` |
| 切换 | 打开 `switch_sheet` 抽屉(`button`,不导航);控制台 tab 保持 active |

抽屉打开时:`loadSessions()`(刷新会话列表)→ 渲染当前 project/session meta 行 → 渲染会话列表 + 项目启动区(空则提示)。

`#switchTab` 的 `aria-expanded` 随抽屉开合由 `createSwitchSheet` 同步(沿用原 `#switchToggle` 的机制,改挂到 `#switchTab`)。

## 7. 断点清理(`style.css`)

因控件全尺寸都在抽屉、header 全尺寸只 brand+live,以下规则冗余,删除:

- `@media(max-width:1100px)` 中的 `#desktopControls{display:none}`、`.meta-inline{display:none}`、`#switchToggle.swap-btn{display:inline-flex}` —— 删(对应元素已不存在)
- `@media(max-width:768px)` 中的 `.nav .nav-link--login{display:none}` —— 删(登录 link 已不存在)
- `@media(min-width:1101px)` 的 `#switchToggle.swap-btn{display:none}` —— 删(`#switchToggle` 已不存在,改底部 tab)

**保留**:`@media(max-width:1100px)` 的 `.console-card` 窄屏贴边(`max-width:100%; margin:0; border-radius:0; border:none; box-shadow:none`)—— 与本次无关,窄屏全屏仍想要。

## 8. 测试策略

`test/ios_header.test.cjs` 更新 + 新增(源码字符串/正则断言,沿用现有模式):

- **HTML 契约**:header 只含 brand+live(无 `nav`/`#desktopControls`/`#switchToggle`/`.meta-inline`);存在 `.bottom-tabbar` 含三 tab(控制台/看板/`#switchTab`);无 `nav-link--login`
- **CSS 契约**:`#app` flex column;`.bottom-tabbar` 存在 + `env(safe-area-inset-bottom)`;`.tab` `flex:1` + `min-height:44px`;`.tab--active` 用 `--accent-2`
- **回归**:断言 `index.html` 无 `id="desktopControls"`、无 `nav-link--login`、无 `id="switchToggle"`;`style.css` 无 `#switchToggle` 残留规则
- **switch_sheet**:抽屉顶部 meta 行 + 项目区空状态 + onOpen 刷新回调(扩展 `test/switch_sheet.test.cjs`)

运行时验证(chrome-devtools 计算值):桌面/中屏/移动三档 + 抽屉打开含会话列表+项目区+meta。

## 9. 验收标准

- [ ] header 全尺寸只 brand + live
- [ ] 底部 tab bar 三 tab 全尺寸,控制台 `tab--active`
- [ ] 切换 tab 打开抽屉,含会话列表 + 项目启动区 + 当前 meta;打开时自动刷新会话
- [ ] 登录 link 不存在于 header
- [ ] 看板页有底部 tab(看板 active);其切换 tab 跳控制台并打开抽屉
- [ ] `npm test` 全绿
- [ ] 桌面/中屏/移动三档视口走查通过
