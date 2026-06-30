# iOS 全站 editorial 风格重设计 · 设计文档

> **状态:** 待评审(v2,已纳入 UI/UX 专家团队 16 项评审修订:must 10 + should 6)。
> **参考风格源:** `dailywork/.../cc-web-control/devflow-cross-platform-2-2-2.html`(editorial 开发者工具风)。
> **mockup 稿:** `dailywork/.../cc-web-control/ios-terminal-mockup.html`、`ios-dashboard-login-mockup.html`。
> **专家评审:** workflow `wf_bcfddbff-174`,综合 6.2/10,verdict `approved-with-revisions`(修完 must 即可进 writing-plans)。
> **关系:** 取代 tokens.css「方向 A 琥珀精修」(`2026-06-27-ui-redesign-amber-refine`);**作废** `2026-06-28-ios-mobile-support` 中的「badge 深色变体」与「深色 badge/waiting 视觉」MVP-1 项(砍深色 + 废 badge 双重失效,见 §10)。
> **后续:** 本 spec 评审通过后,由 writing-plans 生成分任务实施计划(遵循 TDD)。

---

## 1. 背景与目标

cc-web-control 已完成 iOS 功能适配(MVP-0/1:viewport/safe-area/PWA/止损键/快速回复),但视觉风格仍停留在「琥珀精修」的暖白柔和基调,缺乏产品级精致感。

目标:**全站统一一套 editorial 开发者工具风**(暖灰米底 + 暖橙强调 + 三字体栈 + alpha 层级质感),从「能用」进阶到「有原生 App 气质」。iOS 三页优先落地,桌面共用同一 Web 层顺带受益。

---

## 2. 设计总纲(四项已确认决策)

| 决策点 | 选择 | 含义 |
|---|---|---|
| **范围** | 全站统一,iOS 先行 | 三页共用 tokens.css/style.css/dashboard.css,令牌全站生效;iOS 作为首批精修对象 |
| **强调色** | 琥珀提饱和向燃橙靠 | `#d4a574` → `#d9651a`(暖橙,填色/装饰)。**文字/图标/按钮底用更深的 `--accent-2 #b54e0e`(达 WCAG AA)**——见 §4.1 语义分工 |
| **深色模式** | 砍掉,纯浅色 | 移除所有 `prefers-color-scheme: dark` 规则与令牌;`color-scheme: light` |
| **editorial 强度** | 克制借用 | 配色/字体/质感照搬;规格表装饰(编号/eyebrow/meta bar)按场景取舍;**serif 仅用于说明文(空状态/登录 lede),不进终端/列表主体** |

> **可达性总纲(v2 新增):** 配色决策受 WCAG 2.2 AA 约束——暖橙 `#d9651a` 仅作填色/装饰(对比度不足 AA),所有承载信息的小号文字/图标统一走 `--accent-2`;状态采用「色点 + 文字」双编码,不单靠颜色。

---

## 3. 设计 DNA 与参考映射

参考文件的视觉 DNA:

- **配色**:暖灰米底(`#f2f1ed`,非纯白)+ 燃橙强调;文字/边框用 alpha 透明度派生 3–4 层级,分隔低调
- **三字体混排**:mono(编号/标签/终端)+ serif(引语/lede)+ sans(主 UI)
- **规格表版式**:编号系统、eyebrow 小标签、section-head、mono meta
- **质感**:极少圆角(分层:小标签近直角 / 卡片 6px / 主容器 10px / 胶囊全圆)、1px 边框、微动效(脉冲点、live glow)

映射到 cc-web-control(DevFlow 三屏 ≡ 本项目三页):

| DevFlow | cc-web-control | editorial 落点 |
|---|---|---|
| 登录 | `login.html` | ◇ brand mark + serif lede + 暖橙主按钮 |
| 看板 | `dashboard.html` | 状态点 + waiting 高亮 + mono 编号 |
| 执行终端 | `index.html` | 暖灰终端卡 + 暖橙提示符/光标 + meta bar header |

---

## 4. tokens.css 新值

### 4.1 新令牌(完整,浅色唯一)

```css
/**
 * cc-web-control 设计令牌(单一事实来源)
 * 方向:editorial 开发者工具风(暖灰米 + 暖橙)。三页共用。纯浅色。
 * 语义分工:--accent 仅填色/装饰;--accent-2 用于所有文字/图标/按钮底(达 WCAG AA)。
 */
:root {
  /* 暖灰米底 */
  --bg: #f2f1ed;
  --bg-2: #f7f7f4;
  /* surface 层级 */
  --surface: #ebeae5;
  --surface-2: #e3e2dc;
  --surface-3: #d9d8d1;
  /* 暖黑前景 + alpha 派生层级 */
  --fg: #26251e;
  --fg-2: rgba(38,37,30,0.70);   /* 次文字 ~5.6:1 达 AA;承载真实信息 */
  --fg-3: rgba(38,37,30,0.35);   /* 仅装饰:placeholder/分隔符;禁止承载需阅读文字 */
  --fg-4: rgba(38,37,30,0.18);   /* 仅边框 */
  /* 边框:alpha 低调分隔 */
  --border: rgba(38,37,30,0.1);
  --border-2: rgba(38,37,30,0.2);
  /* 暖橙强调:双语义分工(v2 修订,达 WCAG AA) */
  --accent: #d9651a;     /* 仅大面积填色/装饰图形(brand mark 实心、live 点),不用于小号文字/图标 */
  --accent-2: #b54e0e;   /* 文字/图标/按钮底/focus outline 语义色(白字 5.17:1、on bg 4.58:1 达 AA) */
  --accent-bg: rgba(217,101,26,0.08);
  --accent-dim: rgba(217,101,26,0.25);
  /* 状态色谱:状态点用(与品牌暖橙拉开色相,避免与 CTA 语义混淆) */
  --waiting: #c08532;    /* 偏黄琥珀,区别于 accent 的 CTA 暖橙 */
  --working: #1f8a65;
  --idle: rgba(38,37,30,0.3);
  --errored: #c01a4b;    /* 偏紫玫红,增大与暖橙色相差 */
  --success: #1f8a65;
  /* 字体三栈 */
  --sans: system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Helvetica, Arial, sans-serif;
  --mono: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
  --serif: Georgia, 'Palatino Linotype', 'Book Antiqua', 'Iowan Old Style', 'Source Han Serif SC', 'Noto Serif SC', serif;
  /* 圆角分层(v2:新增 --r-xs) */
  --r-xs: 3px;     /* mono 小标签/eyebrow chip 近直角 */
  --r-sm: 6px;     /* 卡片 */
  --r: 10px;       /* 主容器 */
  --r-pill: 9999px;

  color-scheme: light;
}
/* 不再有 @media (prefers-color-scheme: dark) 块 */
```

**令牌使用硬约束(v2 新增):**
- `--accent`(`#d9651a`)**禁止**用于任何 ≤14px 文字、图标描边、按钮文字、focus 环——对比度仅 3.19:1,不达 AA。这些场景一律 `--accent-2`。
- `--fg-3`/`--fg-4` **禁止**承载需阅读的信息文字(仅 placeholder/分隔符/边框)。
- `.terminal-header` 标题等承载会话信息的文字,用 `--fg` 或 `--fg-2`,不得用 `--fg-3`。

### 4.2 新旧令牌迁移映射(全局批量替换)

旧令牌(琥珀版)→ 新令牌(editorial 版)。**所有引用点必须同步替换**:

| 旧 | 新 | 备注 |
|---|---|---|
| `--brand` | `--accent` 或 `--accent-2` | **按用途分**:填色/装饰→`--accent`;文字/图标/按钮底/边框→`--accent-2`(达 AA) |
| `--brand-strong` | `--accent-2` | 强调色深,文字/边框语义 |
| `--text` | `--fg` | 主文字 |
| `--muted` | `--fg-2` 或 `--fg-3` | 默认 `--fg-2`(status 字、control label、projects-empty、welcome/title、nav-link、状态文字 s-status);**占位/辅助语义用 `--fg-3`**(input placeholder、terminal-prompt、welcome p 辅助)。原则:承载真实信息用 fg-2,纯提示/分隔用 fg-3 |
| `--font` | `--sans` | UI 字体 |
| `--surface2` | `--surface-2` | 注意连字符 |
| `--r-lg` | `--r` | 取消 lg(14px→统一 10px);原用 `--r-lg` 处改 `--r` |
| `--working` | `--working`(改值) | `#d4a574` → `#1f8a65`(进行中改绿) |
| `--waiting` | `--waiting`(改值) | `#f59e0b` → `#c08532`(偏黄琥珀,**不再等于 accent**) |
| —(新增) | `--fg-3 / --fg-4 / --border-2 / --bg-2 / --surface-3 / --accent-2 / --accent-bg / --accent-dim / --success / --serif / --r-xs / --r-pill` | 新引入 |

**引用文件(v2 补全,含 JS)**:`public/style.css`、`public/dashboard.css`、`public/login.html`(内联 style)、**`public/client.js`**(实测 `:267` `var(--brand)`、`:269` `var(--brand-strong)` —— Yes/Continue 快捷回复按钮边框/文字,**改名后必须走 `var(--accent-2)`** 否则失效)、`public/modules/*.js`(全量 grep 核查)。

**client.js 逐行映射(必须):**
- `client.js:267` `'var(--brand)'` → `'var(--accent-2)'`(按钮文字/边框,达 AA)
- `client.js:269` `'var(--brand-strong)'` → `'var(--accent-2)'`

### 4.3 硬编码琥珀色清理

| 位置 | 现状 | 改为 |
|---|---|---|
| `style.css:115` `.control-input:focus` | `box-shadow: 0 0 0 3px rgba(212,165,116,0.35)` | 装饰 glow 保留暖橙:`0 0 0 3px var(--accent-dim)`;**另加 `:focus-visible` 不透明 outline(见 §6)** |
| `login.html:66` `input:focus` | `rgba(212,165,116,0.35)` | `var(--accent-dim)` glow + `:focus-visible` outline |
| `style.css:405` `.toast-success` | 硬编码 `#22c55e` | `var(--success)` |
| `dashboard.css:130-134` badge 浅色硬编码 | `#fef3c7` 等 | 改用状态点方案(见 §7.2),badge 大色块废弃 |

---

## 5. 清理深色规则

砍深色,纯浅色。逐项:

| 文件 | 位置 | 处理 |
|---|---|---|
| `public/tokens.css` | `@media (prefers-color-scheme: dark) { :root {...} }` 整块 | **删除** |
| `public/tokens.css` | `color-scheme: light dark` | 改 `color-scheme: light` |
| `public/style.css` | `457-465` `@media (prefers-color-scheme: dark)`(toast/command-palette shadow) | **删除** |
| `public/dashboard.css` | `:117` 注释「深色模式待 Phase 2 polish」 | 移除注释 |
| `public/index.html` | `:14` `<meta name="theme-color" content="#1c1815">` | 改 `#f2f1ed` |
| `public/dashboard.html` | `:14` 同上 | 改 `#f2f1ed` |
| `public/login.html` | `:13` 同上 | 改 `#f2f1ed` |
| `public/manifest.json` | `theme_color`/`background_color` 若为深色 | 改 `#f2f1ed` |

**浮层 shadow 复核(v2 should):** 删深色 shadow 块后,复核 toast(`style.css:386` `0 4px 12px rgba(0,0,0,0.15)`)与 command-palette(`:424` `0 8px 24px rgba(0,0,0,0.12)`)在新的暖灰米底 `#f2f1ed` 上是否仍浮起可辨——暖灰底比纯白略深,0.12/0.15 黑可能发飘,必要时上调到 0.15/0.18。§11 验收加「toast/palette 在新底色下浮起可辨」。

---

## 6. 组件令牌系统

新增/重写组件类。**引入方式(v2 should):推荐直接追加到 `tokens.css` 末尾(`:root` 之后)**,靠现有 `style.css`/`dashboard.css` 的 `@import url('tokens.css')` 链三页自动带载,**零 HTML 改动、无循环依赖**。「新建独立 `components.css` + 三页改 `<link>`」列为次选(额外改动面,且需保证加载顺序在 tokens 之后)。同时消除 `style.css:510` 现有「DRY 违反待 P3 合并」技术债。

- **brand mark**(◇ 旋转方块,v2 规格化):封装单一 `.brand-mark` + 尺寸 modifier(`.brand-mark--sm` 16px / `--md` 24px / `--lg` 30px)。`::before` 描边 + `::after` 实心,`transform: rotate(45deg)`,实心用 `--accent`(装饰图形 OK),描边按比例(`1.5px`@16 / `2.75px`@30)。替代 header 内 `logo.png`(`index.html:21-32`)与登录页 `.logo-mark`「cc」圆角块。**brand mark 旁必须保留可见文本品牌名**(可达性,见 §9)。`logo.png` 保留作 PWA/apple-touch-icon 素材,不再在 UI 内显示。
- **按钮**:
  - `.btn-primary`:**`--accent-2` 实心**(`#b54e0e`,白字 5.17:1 达 AA)、`--r`、移动 ≥44pt
  - `.btn-ghost`:透明底、`--accent-2` 字 + `--accent-dim` 描边、`--r`
  - 现有 `.btn`(`style.css:134-143`,28px/surface 底)降级为次要按钮,统一引用新令牌
- **输入(v2 成套属性)**:`.control-input` / `.token-input` / `.terminal-inline-input` / `.terminal-inline-textarea`:`--surface` 底 + `--border-2` 描边 + `--r`;`:focus` 改 `--accent-dim` glow。**统一输入属性(写此节,不散落各页)**:终端指令输入 `enterkeyhint="send" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false"`;token 输入追加 `autocomplete="off"`。
- **卡片**:`.terminal-view`(`style.css:189`)/ `.session`:`--surface` 底 + `1px solid var(--border)` + `--r`(10px)
- **状态系统(v2 双编码,替代 badge)**:状态呈现 = **`.s-dot` 色点(冗余通道)+ `.s-status` mono 文字(主通道),两者绑定不可省略**。
  - `.s-dot`:9px 圆点,`background` 按状态;类名约定供 JS 拼串:`.s-dot--waiting`/`--working`/`--errored`/`--idle`/`--unknown`(虚线点)。点配 `aria-label` 或 sr-only 文本(色盲冗余)。
  - `.s-status`:mono 状态字,**用 `--fg-2`(AA 达标),不强行染色**——色编码全靠点,文字靠内容(waiting/working/error/idle)承载语义,避免点与字同色又需各自达 AA 的矛盾。
  - **替代** dashboard.css 现有 `.badge` 大色块(`:130-134`,三重编码 bg+图标+文字,硬编码色与令牌脱节)。
- **胶囊**(`--r-pill`):`.nav-link` / `.stop-btn` / `.quick-reply-btn` / 粘贴按钮 / meta「切换」入口
- **meta bar**:mono 11px,`label(--fg-3) + val(--fg) + sep(--border-2)`,用于 header 重排(对话终端 project/session、看板 sessions 计数)。**信息冗余砍减(v2 should)**:对话终端 meta bar 不重复「waiting」计数(已由卡片左边框+排序表达),只留 `project ~/… · s:03`;看板 header 留 `看板 · N sessions`。
- **eyebrow**:mono 10–11px、**`--accent-2`**、`letter-spacing: 0.04em`、`--r-xs`(登录 `[ login ]`、空状态 `[ ready ]`)
- **serif lede**:仅 `.welcome-message p`、登录 `.lede`、看板空状态。其余主体强制 `--sans`/`--mono`
- **焦点指示(v2,统一)**:所有可交互元素用 `:focus-visible`(键盘可见、鼠标点击不显):`outline: 2px solid var(--accent-2); outline-offset: 2px;`(≥3:1 达标)。**删除 `login.html:64` 等处裸 `outline:none`**;box-shadow glow 仅作装饰补充,不作为唯一焦点指示。

---

## 7. 三页改造点

### 7.1 对话终端(`index.html` + `style.css` + `client.js`)

- **header 重排**(375px 塞不下):brand 行(`◇ Roc-CC v2.4` + `live` 点)+ meta bar(`project ~/… · s:03` + 右侧「切换 ⌄」)。Session/Project 下拉 + 刷新 + 启动**折叠进「切换」入口**。
  - **「切换」sheet 契约(v2 critical,spec 钉死,实现留 plan):**
    - 触发器:`<button>`(非 span)、`min-height: 44pt`、`aria-haspopup="dialog"`、`aria-expanded`
    - 容器:**底部 sheet**(避开灵动岛/刘海,而非顶部下拉)
    - 交互:backdrop 遮罩 + 点外关闭 + `Esc`/`⌃C` 关闭 + `body` scroll lock + focus trap(Tab 循环)
    - Session 列表项 ≥44pt,支持 tap 一步切换
    - 桌面宽屏(`min-width:769px`)保留 inline 下拉直接操作,plan 验证断点切换不丢状态
- **terminal 卡片**:`--surface` + `1px border` + `--r`(10px);`.terminal-header` 改 mono(`terminal · s:03 · waiting`)+ 状态点;标题承载会话信息→`--fg`/`--fg-2`。
- **暖橙着色(v2 critical,渲染层改动,非纯 CSS):** 现状 `renderTerminal`(`client.js:300-301`)用 `textContent` 纯文本渲染,**CSS 无法定位行内符号**。二选一写入实现(本期定后不留「或 CSS 类」模糊):
  - **(a) 推荐本期:** 只着色提示符 `❯`(已是独立 DOM 节点,无需改渲染层),用 `--accent-2`;`✓`/`⚠` 等行内符号**留后续**;
  - **(b) 完整方案:** `renderTerminal` 每行包 `.term-line` span + 类着色,**需先解决 `textContent`→`innerHTML` 的 XSS 转义与 virtual_scroll 行 DOM 复用**。
  - 无论哪条,着色一律 `--accent-2`(`✓` 可用 `--success`),**禁止用 `--accent`**(对比度不达 AA)。
- **stop 键**(`style.css:224-234`):`--accent-2` 描边胶囊,放 `.terminal-head` 右侧,窄屏显示(现状 `@media 768` 显示,保留),≥44pt。
- **quick-reply**(`style.css:236-262`):`.quick-reply-btn` `--accent-2` 描边胶囊,Yes 实心主操作(`--accent-2` 底);浮现淡入。**≥44pt**(min-height + hit padding)。注:`client.js:267/269` 改 `var(--accent-2)`。
- **输入区**(`style.css:285-292`):`--surface` 输入框 + `--accent-dim` glow + `:focus-visible` outline;`padding-bottom: env(safe-area-inset-bottom)`(`:535-536` 保留);输入属性见 §6。
- **welcome 空状态**(`index.html:63-67`):eyebrow `[ ready ] · s:0n`,正文 `.welcome-message p` 改 serif lede。
- **桌面端**:宽屏展开 meta(下拉直接露出),窄屏才折叠——`@media (min-width:769px)` 还原直接操作。

### 7.2 看板(`dashboard.html` + `dashboard.css` + `dashboard.js`)

- **header**:brand 行 + meta bar(`看板 · N sessions`,不重复 waiting 计数)。
- **会话卡片流**:`.session-row` → `.session` 卡片(`--surface` + `--border` + `--r`,≥44pt)。
- **状态点替代 badge(v2 critical,必改 JS):** `dashboard.js` 的 render 模板(`:95-110`,实测 `:107` 拼 badge)**必须重写**:badge span → `.s-dot` span + `.s-status` 文字;`STATUS_ICON` emoji(`:36`)随 badge 废弃。§6 类名约定(`.s-dot--waiting` 等)供 JS 拼串。**点 + 文字双编码不可省略**(色盲冗余 + AA)。
- **waiting 高亮**:`--accent-bg` 轻底 + `inset 3px 0 0 var(--waiting)` 左边框 + 排序列最前(`dashboard.js` 排序配合);waiting 点 `--waiting`(`#c08532`)脉冲。
- **mono meta**:每行 `s-name`(sans 600)+ `s-meta`(mono,路径·末行/时间)+ `s-id`(mono `s:0n`)+ `s-status`(mono 状态字,`--fg-2`)。
- **空状态**(`#stateMessage`):serif lede + eyebrow。
- **iOS 触控**:`:active` 反馈、左滑操作露出「进入/停止」、下拉刷新、≥44pt(左滑/下拉刷新为增强项,可分期)。
- `<640px` 折叠末行预览(`dashboard.css:214-221` 已有,保留)。

### 7.3 登录(`login.html`)

- 内联 style 整体重写为新令牌(或抽到 `login.css`,建议统一进 `tokens.css` 末尾组件区)。
- **◇ brand mark**(`--lg`)替代 `.logo-mark`「cc」圆角块,旁保留可见「Roc-CC」文本。
- **eyebrow** `[ login ] · v2.4` + h1 + **serif lede**。
- **token 输入**(`:66` 改):`--mono` 字体 + `--surface` 底 + `--accent-dim` glow + `:focus-visible` outline(`--accent-2`)+ `letter-spacing` + 输入属性(§6,含 `autocomplete="off"`)。
- **按钮**:`--accent-2` 实心「登录」+ 「粘贴 token」描边次按钮(`navigator.clipboard.readText` 配合,失败静默)。**≥44pt**。
- **hint**:`--mono` 10.5px、`--fg-3`(纯提示)。

---

## 8. iOS 适配清单

> 多数已在 `2026-06-28-ios-mobile-support` 落地,此处标注本次需确认/新增项。

| 项 | 状态 | 本次动作 |
|---|---|---|
| `viewport-fit=cover`(三页) | ✅ 已有(`index.html:5`) | 保留 |
| `100dvh`(`#app`/`.terminal-view`) | ✅ 已有(`style.css:27-28,198`) | 保留 |
| `env(safe-area-inset-*)` | ✅ 部分有(`style.css:35,535-536`) | **扩展所有边缘**:横向 left/right 用 `max(基线, env(safe-area-inset-*))` 替代固定值(v2 should) |
| `theme-color` | ❌ 深色 `#1c1815` | 改 `#f2f1ed`(见 §5) |
| 软键盘 `visualViewport` | ❌ 未落地 | **本次纳入,契约化(v2 should)**:监听 `visualViewport` resize/scroll → 设 `--vh-available` 应用到 `#app`;focus 后 `requestAnimationFrame` → `scrollIntoView({block:'end', behavior: reduced-motion?'auto':'smooth'})`;quick-reply/input-bar 键盘弹起一并上推;status-bar-style 保留 `default`(避让状态栏文字)+ 说明理由 |
| 触摸目标 44pt | ⚠️ 部分 | **分层硬约束(v2 critical)**:(a) 主操作(send/Yes/启动/登录/Esc/⌃C)强制 ≥44×44pt;(b) 次级(nav-link/No/Continue/粘贴 token)`min-height:44px` + 视觉内缩/hit-area 透明 padding 扩展;(c) 相邻可点元素间距 ≥8px。修正与 mockup(26/32/36px)矛盾:用 `min-height` 而非固定 `height` |
| 字号 ≥16px(防 iOS 聚焦放大) | ⚠️ 仅 `.terminal-inline-input`(`:505-507`) | **全覆盖(v2 high)**:规则改「移动端所有可聚焦输入控件(input/textarea/contenteditable)≥16px」。待改:`style.css:328` `.terminal-inline-textarea`(14→16)、`login.html:62` token input(14→16)、mockup token-input(14→16)。区分「可聚焦」与「只读」:terminal-body 12.5px 不动 |
| `enterkeyhint="send"` 等 | ❌ | 输入属性成套(见 §6) |
| header 窄屏重排 | ❌ | meta bar + 折叠「切换」sheet(见 §7.1 契约) |

---

## 9. 可达性(v2 新增,WCAG 2.2 AA)

| 项 | 要求 |
|---|---|
| **对比度** | 正文 `--fg` on `--bg` 达 AAA(13.6:1);次文字 `--fg-2`(0.70)达 AA(~5.6:1);暖橙文字/图标一律 `--accent-2`(白字 5.17:1、on bg 4.58:1);`--accent`(`#d9651a`)禁止用于 ≤14px 文字/图标(3.19:1 不达 AA);`--fg-3`/`--fg-4` 不承载需阅读文字。**状态点对比度核对:**`working #1f8a65`=3.81:1 ✓、`errored #c01a4b`=5.32:1 ✓ 达图形 3:1;`--waiting #c08532` 作 9px 点/3px 左边框图形对比 ~2.80:1 略低于 3:1,靠脉冲动画 + `.s-status` 文字(主通道)+ `--accent-bg` 轻底三重冗余补偿(信息不单靠点色,符合双编码)。`--waiting` 保留 `#c08532` 因用户决策「实色以 mockup 为准」 |
| **色盲安全** | 状态**不单靠颜色**:`.s-dot` 色点 + `.s-status` 文字双编码;`unknown` 虚线点 + 文字(虚线与 idle 实心灰在 9px 区分弱,文字兜底) |
| **焦点可见性** | 全站 `:focus-visible` + `outline: 2px solid var(--accent-2)`(≥3:1);删除裸 `outline:none`;box-shadow glow 仅装饰 |
| **动效降级** | 所有 `@keyframes`(live glow / waiting 脉冲 / toast-in / quick-reply qrIn)在 `@media (prefers-reduced-motion: reduce)` 下 `animation: none`(脉冲点降静态实心、glow 降静态描边)。**注:废 badge 同时丢失了 `dashboard.css:146` 现有唯一脉冲降级,新动画必须自带降级** |
| **语义** | `.s-dot`/live 点配 `aria-label` 或 sr-only;`#toast-container` 加 `aria-live="polite"`(错误 toast `assertive`);brand mark 旁保留可见文本品牌名;「切换」触发器 `aria-haspopup="dialog"` + `aria-expanded`(见 §7.1) |
| **触摸目标** | 见 §8(主操作 ≥44pt,间距 ≥8px) |

---

## 10. 范围外与 spec 作废

**范围外(不做):**
- **不恢复深色模式**(明确砍;日后要回作新 spec)
- **不做左滑/下拉刷新完整手势系统**(看板可分期;本次只做静态视觉 + `:active` 反馈)
- **不改 PWA 图标素材**(`apple-touch-icon`/`icon-192/512` 保持 MVP-1 琥珀 ❯+光标条;brand mark ◇ 仅 UI 内)
- **不改后端/WS/tmux 逻辑**(纯前端样式 + 少量 client.js/dashboard.js 交互)
- **不引入构建系统**(原生 HTML/CSS/JS;组件复用靠 tokens.css 末尾组件区)

**作废声明(v2 critical):** `2026-06-28-ios-mobile-support` spec 中的「badge 深色变体」与「深色 badge/waiting 视觉」MVP-1 项,因本 spec **砍深色 + 废 badge 双重失效**,在此声明作废。需在 `2026-06-28-ios-mobile-support-design.md` 顶部加标注「⚠️ badge/深色相关 MVP-1 项已被 2026-06-29 editorial spec 取代」,避免两 spec 长期打架。

---

## 11. 验收标准

- [ ] 三页在 iPhone Safari(390×844)+ 加主屏 standalone 下,视觉与 mockup 一致
- [ ] `tokens.css` 无 `@media dark`,`color-scheme: light`;全站无深色残留
- [ ] 全站无旧令牌引用(含 JS):`grep -rE '\-\-(brand|brand-strong|text|muted|font|surface2|r-lg)\b' public/` 为空(**含 `client.js`、`modules/*.js`**)
- [ ] 全站无 `rgba(212,165,116)` 硬编码(grep 为空)
- [ ] 暖橙 `#d9651a`(`--accent`)**不出现**在任何 ≤14px 文字/图标/按钮字/focus 环(人工审查)
- [ ] 桌面宽屏(≥769px)header 不退化(下拉直接可操作)
- [ ] 软键盘弹出输入框不被遮挡(visualViewport,真机 5 种键盘状态)
- [ ] 状态点 4 色 + unknown 虚线,waiting 暖橙脉冲 + 左边框高亮;**每卡同时含 `.s-dot` 与 `.s-status` 文字**
- [ ] serif 仅出现在 welcome/登录 lede/看板空状态(`grep '--serif'` 引用点 ≤ 3 类)
- [ ] 触摸目标:每可点元素 ≥44pt(主操作)或 min-height:44px+hit padding(次级),相邻间距 ≥8px
- [ ] 可达性:所有 `@keyframes` 有 `prefers-reduced-motion` 降级(`grep -A` 核查);全站 `:focus-visible` 不透明 outline ≥3:1;`#toast-container` 有 `aria-live`;无裸 `outline:none`
- [ ] toast/palette 浮层在 `#f2f1ed` 新底色下浮起可辨
- [ ] `2026-06-28-ios-mobile-support` spec 已加作废标注
- [ ] 现有测试全绿;视觉回归(见 §13 基建决策)

---

## 12. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| 令牌改名波及面广(含 JS:`client.js`/`dashboard.js`/`modules`) | **高** | 全局批量替换 + grep 验证旧令牌清零(§11);client.js:267/269、dashboard.js:107 逐行核验 |
| `--accent` 误用于文字(对比度不达 AA) | **高** | §4.1 硬约束 + §11 人工审查;`--accent-2` 作文字默认 |
| header 折叠「切换」sheet 是新交互(可达性/契约) | **高** | §7.1 spec 钉死契约(非甩 plan);桌面宽屏不折叠降风险;plan 验证 focus trap/Esc/断点 |
| 终端符号着色需改渲染层(`textContent`→`innerHTML`,XSS/virtual_scroll) | 中 | §7.1 本期只着色 `❯`(独立节点),`✓/⚠` 留后续,降实现风险 |
| 暖橙 `#d9651a` 与 errored/working 区分度 | 低 | v2 已拉开:waiting=`#c08532`(偏黄)、errored=`#c01a4b`(偏紫)、working 绿,色相足够 |
| 软键盘 visualViewport 在不同 iOS 版本时机差异 | 中 | 真机测 5 种键盘状态 |
| 砍深色丢失偏好深色用户 | 中 | 已确认接受;文档记录,日后可回 |
| 废 badge 丢失 `dashboard.css:146` 脉冲降级 | 中 | §9 新动画自带 `prefers-reduced-motion` 降级 |

---

## 13. 后续

本 spec 评审通过后,用 **writing-plans** skill 出分任务实施计划:

- 按层拆任务:① tokens 重构(含改名批量替换 + client.js/dashboard.js)→ ② 清理深色 + 浮层 shadow → ③ 组件系统(tokens.css 末尾)→ ④ 对话终端页(切换 sheet + ❯ 着色)→ ⑤ 看板页(dashboard.js 重写 + 双编码)→ ⑥ 登录页 → ⑦ iOS 适配(软键盘/触摸分层/字号)→ ⑧ 可达性(reduced-motion/focus-visible/aria)→ ⑨ 作废标注 + 验收 grep + 真机
- 每任务独立可提交,遵循 TDD
- **snapshot 基建决策(v2 should,二选一):** (a) 增列「snapshot 基建」为前置任务(新建 playwright 或手动截图 checklist);或 (b) **本期退一步**,视觉验收用「真机人眼对照 mockup + grep 旧令牌/硬编码清零」做硬门,snapshot 标后续。**推荐 (b)**(本仓库无既有 snapshot 基建,(a) 需额外搭脚手架,非本期重点)。
- 优先级:iOS 三页 > 桌面顺带;tokens/深色/组件/可达性是三页的前置依赖
