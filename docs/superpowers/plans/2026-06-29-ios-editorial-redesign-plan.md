# iOS 全站 editorial 风格重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 cc-web-control 三页(index 对话终端 / dashboard 看板 / login 登录)从「琥珀精修」统一重设计为 editorial 开发者工具风(暖灰米底 + 暖橙强调 + 三字体栈),砍深色、令牌双语义分工(达 WCAG AA)、iOS 软键盘/触摸/可达性落地,从「能用」进阶到「原生 App 气质」。

**Architecture:** 单一事实来源 `tokens.css` 注入新令牌(纯浅色、`--accent` 装饰 / `--accent-2` 文字双语义),由 `style.css`、`dashboard.css` 各自 `@import`;`login.html` 直接 `<link>`。终端切换 sheet 与看板渲染逻辑因 `client.js`/`dashboard.js` 是不可测 IIFE,抽成 UMD `.cjs`(`session_switch.cjs`/`switch_sheet.cjs`/`dashboard_render.cjs`)走 `node --test`,浏览器侧挂 `window` 全局。组件类(brand mark / btn-primary / s-dot)追加 `tokens.css` 末尾组件区,零 HTML 改动自动带载。

**Tech Stack:** 纯原生 HTML/CSS/JS(无构建系统)+ `node:test` + tmux/WebSocket。测试基建:纯 `node --test test/*.test.cjs` + 手写最小 DOM stub(无 jsdom/playwright);DOM JS 逻辑分支用 stub 测,视觉项用 `grep` 硬门 + 真机人眼对照 mockup。

---

## 设计依据

- 主 spec(已通过专家评审 v2,must 10 + should 6 已纳):`docs/superpowers/specs/2026-06-29-ios-editorial-redesign-design.md`
- 风格参考:`dailywork/.../cc-web-control/devflow-cross-platform-2-2-2.html`、`ios-terminal-mockup.html`、`ios-dashboard-login-mockup.html`
- mockup 与 spec 冲突时以 spec 为准(权威):提示符 ❯、eyebrow、按钮底一律 `--accent-2`(mockup 误用 `--accent`,3.19:1 不达 AA)。

## 已核实的关键事实(plan 编排依据,跨领域风险消解)

- **dashboard.html 仅 `<link>` dashboard.css,不引 style.css**(实测 `dashboard.html:8`)。因此 `.nav/.nav-link` 不能「单一来源移到 style.css」——会致看板 nav 裸奔。**本 plan 决策:`.nav` 仍保留 dashboard.css 一份**(不删,不 DRY 合并到 style.css),仅做令牌迁移 + 触摸目标 44pt + `:focus-visible`。spec §6「消除 DRY」列为次选,此处以不破看板为优先。
- **multi_line_input.js:65 硬编码 `calc(100vh - ${totalInputHeight}px)`**(实测)。新增 `--vh-available` 应用 `#app` 后,terminalView 的 maxHeight 仍按 `100vh` 算 → 软键盘弹起输入区被挤。iOS 适配 Task 必须同步此行。
- **package.json: `"test": "node --test test/*.test.cjs"`,无 jsdom/playwright 依赖**(实测)。所有新测试用 `node:test` + 手写 stub(参考既有 `test/deadState.test.cjs`、`test/projectsView.test.cjs` 对 UMD 模块的测法)。不得引入 jsdom。
- **dashboard.html 脚本仅 `dashboard.js`(:36)**,新增 `dashboard_render.cjs` 必须插在 `dashboard.js` 之前;**index.html 脚本 :74-78,之后 `modules/main.js`(type=module)**,新增 UMD 插在 `client.js`(:78)之前。
- **令牌改名精确匹配**:`var(--surface2)`→`var(--surface-2)` 必须含右括号精确匹配(防误伤 `var(--surface)`);`--brand-strong` 须先于 `--brand` 替换;`client.js` 内 `'var(--brand)'` 是 JS 字面量,grep 须覆盖 `*.js`。
- **toast aria-live 容器(polite)+ 子(error assertive)嵌套**:VoiceOver 可能行为不一致 → 标为真机验证项(Task 8),不阻塞。

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `public/tokens.css` | 单一事实来源令牌 + 组件区(brand mark / btn-primary / btn-ghost / s-dot) | 整文件重写(Task 1)+ 末尾追加组件区(Task 2) |
| `public/style.css` | 对话终端页样式(header/terminal/quick-reply/toast/nav/切换 sheet) | 令牌迁移 + 重写多处(Task 3) |
| `public/client.js` | 终端交互(quick-reply/切换 sheet/visualViewport/meta bar/live 点) | 多处修改 + 新增 setup* 函数(Task 4/6/7) |
| `public/session_switch.cjs` | 切换会话副作用编排(UMD,可测) | 新建(Task 4) |
| `public/switch_sheet.cjs` | 切换 sheet 状态机 + DOM 构建(UMD,可测) | 新建(Task 4) |
| `public/dashboard.css` | 看板样式(session 卡片/s-dot/nav/空状态) | 整文件重写(Task 5) |
| `public/dashboard.js` | 看板轮询/渲染/DOM 绑定(IIFE,引用 dashboard_render) | 整文件重写(Task 5) |
| `public/dashboard_render.cjs` | 看板渲染纯逻辑(排序/拼串/状态映射,UMD) | 新建(Task 5) |
| `public/login.html` | 登录页(内联 style + DOM + 粘贴脚本) | 整文件重写(Task 6) |
| `public/index.html` | 对话终端页 DOM(header 重排/welcome/toast aria) | 多处修改(Task 7) |
| `public/modules/multi_line_input.js` | 多行输入高度计算 | 同步 --vh-available(Task 7) |
| `public/modules/toast_manager.js` | toast aria-live 按 type 切 | 修改(Task 8) |
| `public/manifest.json` | PWA theme/background_color | 修改(Task 1) |
| `test/tokens.test.cjs` | 旧令牌/深色/硬编码 grep 验收 | 新建(Task 1) |
| `test/session_switch.test.cjs` | switchSession 编排单测 | 新建(Task 4) |
| `test/switch_sheet.test.cjs` | handleTabTrap/shouldCloseOnKey/buildSessionItems 单测 | 新建(Task 4) |
| `test/dashboard_render.test.cjs` | 排序/renderSession/renderState 单测 | 新建(Task 5) |
| `test/a11y_motion_focus.test.cjs` | reduced-motion/focus-visible/字号 grep 断言 | 新建(Task 8) |
| `test/input_attrs.test.cjs` | 输入属性成套 grep 断言 | 新建(Task 8) |
| `docs/superpowers/specs/2026-06-28-ios-mobile-support-design.md` | 加作废标注 | 修改(Task 9) |

---

## Task 1: tokens.css 重构 + 砍深色 + 旧令牌迁移(全局,三页共用)

> **依赖:** 无(其余所有 Task 依赖本 Task)。本 Task 必须最先完成,否则新令牌未定义、下游 CSS 全白。

**Files:**
- Modify: `public/tokens.css`(:1-47 整文件)
- Modify: `public/style.css`(:66,:114-115,:454,:17,:383,:20/53/109/140/181/251/280/309/330/437/529,:73/81/150/207/241/261/291/449/453/514,:71/96/131/175/210/297/314/338/342/524)
- Modify: `public/dashboard.css`(:109,:113,:16,:19/79/163/208,:64,:74/171/183/189/202,:117)
- Modify: `public/login.html`(:13,:25/63/77,:27/51/61,:33,:73,:49,:52/53,:66,:80)
- Modify: `public/index.html`(:14)
- Modify: `public/dashboard.html`(:14)
- Modify: `public/manifest.json`(:9-10)
- Modify: `public/client.js`(:267,:269)
- Test: `test/tokens.test.cjs`(新建)

**Steps:**

- [ ] **1.1 写失败测试(RED)。** 新建 `test/tokens.test.cjs`:
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const { execSync } = require('node:child_process');
  const fs = require('node:fs');

  const P = 'public';
  function grepCount(re) {
    try {
      const out = execSync(`grep -rlE '${re}' ${P}/ --include='*.css' --include='*.html' --include='*.js' | grep -v 'tokens.css' || true`, { encoding: 'utf8' });
      return out.trim().split('\\n').filter(Boolean).length;
    } catch { return -1; }
  }

  test('无旧令牌引用(含 JS)', () => {
    assert.equal(grepCount('\\-\\-(brand|brand-strong|text|muted|font|surface2|r-lg)\\b'), 0);
  });
  test('tokens.css 无深色 media + color-scheme: light', () => {
    const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
    assert.ok(!css.includes('prefers-color-scheme: dark'));
    assert.ok(css.includes('color-scheme: light'));
  });
  test('无琥珀硬编码 rgba(212,165,116)', () => {
    assert.equal(grepCount('212,\\s*165,\\s*116'), 0);
  });
  test('theme-color/manifest 改浅色 #f2f1ed', () => {
    for (const f of ['index.html','dashboard.html','login.html']) {
      assert.ok(fs.readFileSync(`${P}/${f}`,'utf8').includes('theme-color\" content=\"#f2f1ed\"'));
    }
    const m = fs.readFileSync(`${P}/manifest.json`,'utf8');
    assert.ok(m.includes('\"theme_color\": \"#f2f1ed\"') && m.includes('\"background_color\": \"#f2f1ed\"'));
  });
  test('关键新令牌齐全', () => {
    const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
    for (const tok of ['--accent: #d9651a','--accent-2: #b54e0e','--waiting: #c08532','--fg-2: rgba(38,37,30,0.70)','--r-xs: 3px','--serif:','--surface-3:','--bg-2:']) {
      assert.ok(css.includes(tok), '缺令牌 ' + tok);
    }
  });
  test('client.js 无 var(--brand)/var(--brand-strong)', () => {
    const js = fs.readFileSync(`${P}/client.js`,'utf8');
    assert.ok(!/var\\(--brand(-strong)?\\b/.test(js));
  });
  ```
- [ ] **1.2 跑测试验证失败。** `npm test` → `tokens.test.cjs` 各 test FAIL(旧令牌/深色/硬编码现状命中)。预期看到 `failing` 计数 ≥5。

- [ ] **1.3 重写 tokens.css。** 用 Write 整文件替换 `public/tokens.css` 为 spec §4.1 全新令牌:
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
    /* 暖橙强调:双语义分工(达 WCAG AA) */
    --accent: #d9651a;     /* 仅大面积填色/装饰图形,不用于小号文字/图标 */
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
    /* 圆角分层 */
    --r-xs: 3px;     /* mono 小标签/eyebrow chip 近直角 */
    --r-sm: 6px;     /* 卡片 */
    --r: 10px;       /* 主容器 */
    --r-pill: 9999px;

    color-scheme: light;
  }
  /* 不再有 @media (prefers-color-scheme: dark) 块 */
  ```

- [ ] **1.4 删深色块。** 删除 `public/style.css:457-465` 整段 `@media (prefers-color-scheme: dark)`(toast/command-palette shadow)。

- [ ] **1.5 改 theme-color/manifest。** `index.html:14`、`dashboard.html:14`、`login.html:13` 的 `theme-color` content 改 `#f2f1ed`;`manifest.json:9-10` `background_color`/`theme_color` 改 `#f2f1ed`。

- [ ] **1.6 client.js 令牌改名(精确)。** `client.js:267` `'var(--brand)'`→`'var(--accent-2)'`;`client.js:269` `'var(--brand-strong)'`→`'var(--accent-2)'`。注:本步**仅改这两行**——相邻的 `mk('No', 'var(--border)', ...)` 中 `var(--border)` 是新令牌(同名沿用),不在改名清单,保持不动。`mk` 工厂签名重构(改类驱动)在 Task 3.14,本步不改签名。
  ```js
            mk('Yes', 'var(--accent-2)', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'y', enter: true }]),
            mk('No', 'var(--border)', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'n', enter: true }]),
            mk('Continue', 'var(--accent-2)', [{ type: 'key', data: 'Enter' }])
  ```

- [ ] **1.7 style.css 令牌批量迁移。** 顺序很重要(先 brand-strong 后 brand;surface2 含右括号精确匹配):
  - `var(--brand-strong)` → `var(--accent-2)`(:454,replace_all)
  - `var(--brand)` → `var(--accent-2)`(:66,:114,replace_all)
  - `var(--surface2)` → `var(--surface-2)`(精确匹配含右括号,replace_all,10 处)
  - `var(--font)` → `var(--sans)`(replace_all,2 处)
  - `var(--text)` → `var(--fg)`(replace_all,11 处)
  - `var(--muted)` → `var(--fg-2)`(replace_all,11 处;默认承载信息→fg-2,本 Task 不逐处细分 fg-3,留 Task 3 人工复核)
  - `:115` `box-shadow: 0 0 0 3px rgba(212, 165, 116, 0.35)` → `box-shadow: 0 0 0 3px var(--accent-dim)`

- [ ] **1.8 dashboard.css 令牌批量迁移。** 同序:
  - `var(--brand)` → `var(--accent-2)`(:109,:113,replace_all)
  - `var(--font)` → `var(--sans)`(:16)
  - `var(--text)` → `var(--fg)`(replace_all,4 处)
  - `var(--surface2)` → `var(--surface-2)`(:64,精确含右括号)
  - `var(--muted)` → `var(--fg-2)`(replace_all,5 处)
  - `:117` 注释移除「深色模式待 Phase 2 polish」措辞,改为:`/* 徽章 5 状态(琥珀优先注意,三重编码:背景色 + 图标 + 文字)。badge 大色块将由状态点方案取代(见 spec §6/§7.2) */`

- [ ] **1.9 login.html 内联 style 令牌迁移。** 注:login.html 整体重写在 Task 6;本步只做令牌替换以保证 Task 1 grep 全绿(login 在 Task 6 前不会破,因新令牌已定义):
  - `var(--font)` → `var(--sans)`(:25,:63,:77)
  - `var(--text)` → `var(--fg)`(:27,:51,:61)
  - `var(--r-lg)` → `var(--r)`(:49)
  - `var(--muted)` → `var(--fg-2)`(:52,:53)
  - `:33` `background: var(--brand)` → `background: var(--accent)`(logo-mark 装饰图形)
  - `:73` `background: var(--brand)` → `background: var(--accent-2)`(按钮底,白字 AA)
  - `:66` `border-color: var(--brand); box-shadow: 0 0 0 3px rgba(212, 165, 116, 0.35)` → `border-color: var(--accent-2); box-shadow: 0 0 0 3px var(--accent-dim)`
  - `:80` `background: var(--brand-strong)` → `background: var(--accent-2)`

- [ ] **1.10 跑测试验证通过(GREEN)。** `npm test` → `tokens.test.cjs` 全 PASS。预期:无旧令牌、无深色、无硬编码、新令牌齐全。

- [ ] **1.11 人眼对照。** Chrome DevTools 开 index/dashboard/login,Console 无 CSS 变量警告;三页背景暖灰米 #f2f1ed(非纯白非黑);quick-reply Yes/Continue 边框深暖橙可见;toast/command-palette 在新底色阴影可辨(若发飘,上调 shadow 到 0.18——记为可选微调)。

- [ ] **1.12 commit。**
  ```bash
  git add public/tokens.css public/style.css public/dashboard.css public/login.html public/index.html public/dashboard.html public/manifest.json public/client.js test/tokens.test.cjs
  git commit -m "refactor(tokens): editorial 令牌重构 + 砍深色 + 旧令牌全局迁移"
  ```

---

## Task 2: tokens.css 末尾组件区(brand mark / btn / s-dot / eyebrow)

> **依赖:** Task 1。组件区是 Task 3-7 的 CSS 依赖。引入方式:追加 `tokens.css` 末尾,靠现有 `@import` 链三页自动带载,零 HTML 改动(spec §6 推荐)。

**Files:**
- Modify: `public/tokens.css`(末尾追加)

**Steps:**

- [ ] **2.1 追加组件区到 tokens.css 末尾。** 在 `:root {...}` 块之后(`/* 不再有 @media dark */` 注释之后)追加:
  ```css

  /* ============================================================
   * 组件区(三页共用,靠 style.css / dashboard.css 的 @import tokens.css 自动带载)
   * 设计依据:spec §6。零 HTML 改动。
   * ============================================================ */

  /* brand mark:◇ 旋转方块,::before 描边(--accent-2 达 AA)+ ::after 实心(--accent 装饰) */
  .brand-mark { position: relative; display: inline-block; flex-shrink: 0; }
  .brand-mark--sm { width: 16px; height: 16px; }
  .brand-mark--md { width: 24px; height: 24px; }
  .brand-mark--lg { width: 30px; height: 30px; }
  .brand-mark::before {
    content: ''; position: absolute; inset: 0;
    border: 1.5px solid var(--accent-2); transform: rotate(45deg);
  }
  .brand-mark--md::before { border-width: 2px; }
  .brand-mark--lg::before { border-width: 2.75px; }
  .brand-mark::after {
    content: ''; position: absolute; inset: 4px;
    background: var(--accent); transform: rotate(45deg);
  }

  /* 按钮 */
  .btn-primary {
    min-height: 44px; padding: 0 16px;
    border: 1px solid var(--accent-2); border-radius: var(--r);
    background: var(--accent-2); color: #ffffff;
    font-family: var(--sans); font-size: 14px; cursor: pointer;
  }
  .btn-primary:hover { filter: brightness(1.05); }
  .btn-primary:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  .btn-ghost {
    min-height: 44px; padding: 0 14px;
    border: 1px solid var(--accent-dim); border-radius: var(--r);
    background: transparent; color: var(--accent-2);
    font-family: var(--sans); font-size: 14px; cursor: pointer;
  }
  .btn-ghost:hover { background: var(--accent-bg); }
  .btn-ghost:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

  /* 状态点系统(spec §6 双编码):.s-dot 色点(冗余)+ .s-status 文字(主通道) */
  .s-dot {
    width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--idle);
  }
  .s-dot--waiting { background: var(--waiting); }
  .s-dot--working { background: var(--working); }
  .s-dot--errored { background: var(--errored); }
  .s-dot--idle    { background: var(--idle); }
  .s-dot--unknown { background: transparent; border: 1px dashed var(--fg-3); }
  .s-status {
    font-family: var(--mono); font-size: 10px; color: var(--fg-2); /* 不染色,文字靠内容承载语义 */
    letter-spacing: 0.02em; flex-shrink: 0;
  }

  /* eyebrow:mono · --accent-2(达 AA,非 --accent)· letter-spacing */
  .eyebrow {
    font-family: var(--mono); font-size: 11px; color: var(--accent-2);
    letter-spacing: 0.04em; text-transform: lowercase;
  }
  ```

- [ ] **2.2 验证带载链。** `grep -n '@import' public/style.css public/dashboard.css` → 两文件顶部均有 `@import url('tokens.css');`(实测 style.css:6、dashboard.css:5)。确认组件区随链带载。

- [ ] **2.3 commit。**
  ```bash
  git add public/tokens.css
  git commit -m "feat(tokens): 新增组件区 brand-mark/btn/s-dot/eyebrow(三页共用)"
  ```

---

## Task 3: 对话终端页样式 style.css(editorial 重写)

> **依赖:** Task 1、Task 2。本 Task 处理终端页视觉(header/terminal/quick-reply/toast/nav/❯着色/focus-visible/字号/reduced-motion)。切换 sheet 的 JS 在 Task 4,iOS visualViewport 在 Task 7。

**Files:**
- Modify: `public/style.css`(多处)
- Modify: `public/client.js`(:267-270 quick-reply 工厂)
- Test: 复用 `test/tokens.test.cjs`(grep 旧令牌清零)+ 新增 grep 断言并入 `test/a11y_motion_focus.test.cjs`(Task 8 建,本 Task 先手跑 grep)

**Steps:**

- [ ] **3.1 header 重排 CSS。** 替换 `public/style.css` 现有 `.header`(原 :31-45)、`.logo`/`.app-logo`/`.status`/`.control`/`.control-label`/`.control-input`(原 :47-116)为下方代码。新增 `.brand-row`/`.meta-bar`/`.swap`/`.live-dot` 类(DOM 由 Task 7 的 index.html 提供,此处 CSS 先就位):
  ```css
  /* ── header:brand 行 + meta bar 两行结构(375px 重排) ── */
  .header {
      display: flex; flex-direction: column; flex-shrink: 0;
      padding: max(8px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
      background-color: var(--surface); border-bottom: 1px solid var(--border);
  }
  .brand-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; padding: 4px 0 8px;
  }
  .logo {
      display: flex; align-items: center; gap: 9px;
      font-size: 16px; font-weight: 600; letter-spacing: -0.015em; color: var(--fg);
  }
  .logo .app-logo { display: none; }   /* logo.png 不再 UI 内显示,brand mark ◇ 替代 */
  .logo .brand-mark, .logo svg { color: var(--accent); }
  .header-actions { display: flex; align-items: center; gap: 12px; }

  /* meta bar:mono 11px,label(--fg-3)+val(--fg)+sep(--border-2) */
  .meta-bar {
      display: flex; align-items: center; gap: 8px; padding: 8px 0;
      border-top: 1px solid var(--border);
      font-family: var(--mono); font-size: 11px; color: var(--fg-2); overflow: hidden;
  }
  .meta-bar .meta-label { color: var(--fg-3); flex-shrink: 0; }
  .meta-bar .meta-val { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #metaProject.meta-val { flex: 1; }
  .meta-bar .meta-sep { color: var(--border-2); flex-shrink: 0; }
  .meta-bar .swap-btn {
      margin-left: auto; flex-shrink: 0; min-height: 44px; padding: 0 12px;
      border: 1px solid var(--accent-dim); border-radius: var(--r-pill);
      background: var(--accent-bg); color: var(--accent-2);
      font-family: var(--mono); font-size: 11px; cursor: pointer;
  }
  .meta-bar .swap-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

  /* live 点 */
  .live-dot { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; color: var(--accent-2); }
  .live-dot-pulse {
      width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
      box-shadow: 0 0 6px rgba(217, 101, 26, 0.5); animation: live-glow 2.4s ease-in-out infinite;
  }

  .status { font-size: 12px; color: var(--fg-2); padding: 4px 10px; background-color: var(--surface-2); border-radius: var(--r-pill); border: 1px solid var(--border); }
  .status.connected { color: var(--working); border-color: var(--working); background-color: var(--surface-2); }

  .control { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-2); }
  .control-label { user-select: none; }
  .control-input {
      height: 28px; padding: 0 8px; border: 1px solid var(--border-2); border-radius: var(--r);
      background: var(--surface); color: var(--fg);
  }
  .control-input:focus { border-color: var(--accent-2); box-shadow: 0 0 0 3px var(--accent-dim); outline: none; }
  .control-input:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  ```

- [ ] **3.2 welcome 空状态 + eyebrow + serif lede。** 替换 `.welcome-message` 块(原 :172-187):
  ```css
  .welcome-message { text-align: center; padding: 60px 20px; color: var(--fg-2); }
  .welcome-message .eyebrow { display: block; margin-bottom: 12px; }
  .welcome-message h2 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; color: var(--fg); margin-bottom: 12px; }
  .welcome-message p {
      font-family: var(--serif); font-size: 15px; line-height: 1.65; color: var(--fg-2);
      max-width: 340px; margin: 0 auto;
  }
  ```

- [ ] **3.3 terminal 卡片 + header mono + 标题 --fg。** 替换 `.terminal-view`(原 :189-199)、`.terminal-header`(原 :201-213)、`.terminal-header-title`(原 :215-221):
  ```css
  .terminal-view {
      width: 100%; border: 1px solid var(--border); border-radius: var(--r); overflow: hidden;
      background-color: var(--surface); display: flex; flex-direction: column;
      min-height: 420px; max-height: calc(100dvh - 130px);
  }
  .terminal-header {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 9px 12px; background: var(--surface-2); border-bottom: 1px solid var(--border);
      font-family: var(--mono); font-size: 11px; color: var(--fg-2); letter-spacing: 0.02em;
  }
  .terminal-header-title {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg);
  }
  ```

- [ ] **3.4 stop-btn 胶囊 + ≥44pt。** 替换 `.stop-controls`/`.stop-btn`(原 :223-234):
  ```css
  .stop-controls { display: none; gap: 8px; flex-shrink: 0; }
  .btn.stop-btn {
      height: auto; min-height: 44px; padding: 0 14px;
      font-family: var(--mono); font-size: 12px; color: var(--accent-2);
      background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--r-pill);
  }
  .btn.stop-btn:hover, .btn.stop-btn:active { background: var(--accent-dim); }
  .btn.stop-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  ```

- [ ] **3.5 quick-reply 胶囊 + ≥44pt + 浮现 + reduced-motion。** 替换 `.quick-reply`/`.quick-reply-btn`(原 :236-269):
  ```css
  .quick-reply {
      display: flex; gap: 8px; padding: 10px 14px;
      background: var(--bg-2); border-bottom: 1px solid var(--border);
      animation: qrIn 0.35s ease both;
  }
  @keyframes qrIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .quick-reply { animation: none; } }
  .quick-reply-btn {
      height: auto; min-height: 44px; padding: 0 14px;
      border: 1px solid var(--accent-dim); border-radius: var(--r-pill);
      background: var(--bg); color: var(--accent-2); font-size: 13px; cursor: pointer;
  }
  .quick-reply-btn--primary { background: var(--accent-2); color: #ffffff; border-color: var(--accent-2); }
  .quick-reply-btn:hover { background: var(--surface); }
  .quick-reply-btn--primary:hover { background: var(--accent-2); filter: brightness(1.05); }
  .quick-reply-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  @media (max-width: 768px) { .stop-controls { display: flex; } }
  ```

- [ ] **3.6 terminal-content + input-row + ❯ 着色(方案 a)。** 替换 `.terminal-content`(原 :271-283)、`.terminal-input-row`/`.terminal-prompt`(原 :285-299):
  ```css
  .terminal-content {
      margin: 0; padding: 12px 14px; overflow: auto; white-space: pre-wrap; word-break: break-word;
      font-family: var(--mono); font-size: 12.5px; line-height: 1.65; color: var(--fg);
      background-color: var(--surface); flex: 1;
  }
  .terminal-input-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
      border-top: 1px solid var(--border); background: var(--surface-2);
  }
  .terminal-prompt {
      font-family: var(--mono); font-size: 14px; font-weight: 600;
      color: var(--accent-2); user-select: none;
  }
  ```

- [ ] **3.7 inline 输入 ≥16px + :focus-visible + 删裸 outline。** 替换 `.terminal-inline-input`/`.terminal-inline-textarea`(原 :301-344):
  ```css
  .terminal-inline-input {
      flex: 1; border: none; background: transparent; font-family: var(--mono);
      font-size: 16px; line-height: 1.5; color: var(--fg); padding: 0;
  }
  .terminal-inline-input::placeholder { color: var(--fg-3); }
  .terminal-inline-input:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 4px; }
  .terminal-inline-textarea {
      flex: 1; border: none; background: transparent; font-family: var(--mono);
      font-size: 16px; line-height: 1.5; color: var(--fg); padding: 0;
      resize: none; overflow: hidden; field-sizing: content;
  }
  .terminal-inline-textarea::placeholder { color: var(--fg-3); }
  .terminal-line { min-height: 1.5em; }
  ```

- [ ] **3.8 scrollbar 令牌化。** 替换 `::-webkit-scrollbar*`(原 :350-366):
  ```css
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--fg-4); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-2); }
  ```

- [ ] **3.9 toast + 硬编码绿清理 + shadow 上调 + reduced-motion。** 替换 `.toast` 块(原 :377-412):
  ```css
  .toast {
      position: absolute; right: 0; padding: 10px 14px; border-radius: var(--r);
      font-size: 14px; font-family: var(--sans); line-height: 20px; max-width: 320px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18); pointer-events: auto; overflow: hidden;
      word-break: break-word; animation: toast-in 0.2s ease-out;
  }
  @keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes live-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
  .toast-info { background-color: var(--waiting); color: #ffffff; }
  .toast-success { background-color: var(--success); color: #ffffff; }
  .toast-error { background-color: var(--errored); color: #ffffff; }
  ```

- [ ] **3.10 command-palette + 删深色块(若 Task 1 未删则此处删)。** 替换 `.command-palette` 块(原 :414-465,深色 @media 块随之消失):
  ```css
  .command-palette {
      position: absolute; top: 100%; left: 0; right: 0;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--r);
      overflow-y: auto; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      z-index: 100; margin-top: 4px;
  }
  .command-palette[hidden] { display: none; }
  .palette-item {
      padding: 8px 14px; font-family: var(--mono); font-size: 13px; color: var(--fg);
      cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      width: max-content; min-width: 100%;
  }
  .palette-item:hover, .palette-item.selected { background-color: var(--surface-2); color: var(--accent-2); }
  /* 删除原 457-465 @media (prefers-color-scheme: dark) 块:砍深色 */
  ```

- [ ] **3.11 窄屏 @media 重写。** 替换 `@media (max-width:768px)` 块(原 :467-508),删冗余 `.terminal-inline-input font-size` 覆盖(全局已 16px):
  ```css
  @media (max-width: 768px) {
      .header { padding: 8px 14px; }
      .control-label { display: none; }
      #sessionSelect.control-input, #refreshSessions.btn { display: none; }
      .logo { font-size: 14px; gap: 8px; }
      .messages { padding: 10px; }
      .terminal-view { min-height: 280px; max-height: calc(100dvh - 100px); }
      .terminal-content { padding: 10px; font-size: 12px; }
      .terminal-input-row { padding: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
      /* 切换 sheet 触发器/inline 控件显隐见 Task 4 的 .switch-sheet 断点样式 */
  }
  ```

- [ ] **3.12 .nav 胶囊 + 触摸 44pt + 删 DRY 注释。** 替换 `.nav`/`.nav-link` 块(原 :510-532):
  ```css
  /* 统一胶囊导航(控制台页;看板页 dashboard.css 另有一份,dashboard.html 不引 style.css 故不合并) */
  .nav { display: flex; gap: 2px; background: var(--surface-2); border-radius: var(--r-pill); padding: 3px; }
  .nav-link {
      font-size: 12px; min-height: 44px; padding: 6px 14px; border-radius: var(--r-pill);
      text-decoration: none; color: var(--fg-2); display: inline-flex; align-items: center;
  }
  .nav-link:hover { color: var(--fg); }
  .nav-link.cur { background: var(--bg); color: var(--fg); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }
  .nav-link:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  ```

- [ ] **3.13 删重复 .terminal-input-row padding-bottom。** 删除原 :534-537 重复声明(safe-area 已并入 3.6 的 .terminal-input-row):
  ```css
  /* 删除:与 .terminal-input-row 重复声明 padding-bottom,已合并(safe-area 底部避让见 .terminal-input-row)。 */
  ```

- [ ] **3.14 client.js quick-reply 工厂改类驱动。** 替换 `client.js:254-270` `mk()` 与三次调用(令牌由 CSS class 承载,消除内联 borderColor 与令牌改名耦合):
  ```js
          const mk = (label, variant, actions) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'quick-reply-btn' + (variant === 'primary' ? ' quick-reply-btn--primary' : '');
              b.textContent = label;
              b.setAttribute('aria-label', `快捷回复 ${label}`);
              b.addEventListener('click', () => {
                  sendBatch(actions);
                  hideQuickReply();
              });
              return b;
          };
          bar.append(
              mk('Yes', 'primary', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'y', enter: true }]),
              mk('No', 'secondary', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'n', enter: true }]),
              mk('Continue', 'secondary', [{ type: 'key', data: 'Enter' }])
          );
  ```
  > 注:Task 1 已把 `'var(--brand)'`/`'var(--brand-strong)'` 改名;本步把 mk 从 `(label, accent, actions)` 改为 `(label, variant, actions)` 并移除内联 borderColor。确认 `mk(` 无其他调用点(实测仅 :266-270 一处 `bar.append`)。

- [ ] **3.15 跑测试 + grep 验收。** `npm test` → 全 PASS。手跑 grep:
  - `grep -nE '\-\-(brand|brand-strong|text|muted|font|surface2|r-lg)\b' public/style.css` → 空
  - `grep -nE 'rgba\(212,\s*165,\s*116\)' public/style.css` → 空
  - `grep -n '#22c55e' public/style.css` → 空
  - `grep -n 'prefers-color-scheme: dark' public/style.css` → 空
  - `grep -c 'focus-visible' public/style.css` → ≥6
  - `grep -n 'var(--serif)' public/style.css` → 仅命中 `.welcome-message p`

- [ ] **3.16 人眼对照 mockup。** DevTools 开 index.html 对照 `ios-terminal-mockup.html`:terminal 卡圆角 10px、header mono、❯ 暖橙、stop/quick-reply 胶囊、Yes 实心、welcome serif lede + eyebrow。

- [ ] **3.17 commit。**
  ```bash
  git add public/style.css public/client.js
  git commit -m "style(terminal): editorial 重写(header重排/terminal卡片/胶囊按钮/❯着色/focus-visible/≥16px/reduced-motion)"
  ```

---

## Task 4: 终端交互 client.js(切换 sheet + 切换编排,UMD 可测)

> **依赖:** Task 1、Task 3。client.js 是不可测 IIFE,切换逻辑必须抽 UMD `.cjs` 走 TDD。spec §7.1 critical 契约:<button> 触发器 + aria-haspopup/expanded + 底部 sheet + backdrop + Esc/⌃C 关闭 + body scroll lock + focus trap + Session 列表 ≥44pt。

**Files:**
- Create: `public/session_switch.cjs`
- Create: `public/switch_sheet.cjs`
- Create: `test/session_switch.test.cjs`
- Create: `test/switch_sheet.test.cjs`
- Modify: `public/index.html`(脚本加载顺序 + header 触发器 DOM)
- Modify: `public/style.css`(.switch-sheet 系列样式 + 断点)
- Modify: `public/client.js`(接入 sheet + sessionSelect.change 改调编排)

> **DOM id 约定(spec §7.1):** 触发器 `id="switchToggle"`(client.js setupSwitchSheet 用,见 Task 7)。本 Task 的 `switch_sheet.cjs` 是通用状态机,不绑死 DOM id;client.js 接入时绑定 switchToggle/switchSheet。

**Steps:**

- [ ] **4.1 写失败测试 session_switch(RED)。** 新建 `test/session_switch.test.cjs`:
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const { switchSession } = require('../public/session_switch.cjs');

  test('switchSession 扇出副作用并返回 true', () => {
    const calls = [];
    const deps = {
      setUrl: s => calls.push(['setUrl', s]),
      store: s => calls.push(['store', s]),
      updateUi: () => calls.push(['updateUi']),
      syncProject: () => calls.push(['syncProject']),
      clearOutput: () => calls.push(['clearOutput']),
      hideQuickReply: () => calls.push(['hideQuickReply']),
      connect: () => calls.push(['connect']),
      note: m => calls.push(['note', m]),
    };
    const r = switchSession({ target: 'b', current: 'a' }, deps);
    assert.equal(r, true);
    assert.deepEqual(calls.map(c => c[0]), ['setUrl','store','updateUi','syncProject','clearOutput','hideQuickReply','connect','note']);
  });

  test('target===current 返回 false 且不调任何 fn', () => {
    let threw = false;
    const deps = { setUrl:()=>{threw=true;}, store:()=>{threw=true;}, updateUi:()=>{threw=true;}, syncProject:()=>{threw=true;}, clearOutput:()=>{threw=true;}, hideQuickReply:()=>{threw=true;}, connect:()=>{threw=true;}, note:()=>{threw=true;} };
    const r = switchSession({ target: 'a', current: 'a' }, deps);
    assert.equal(r, false);
    assert.equal(threw, false);
  });

  test('空 target / 非法 ctx 安全降级返回 false', () => {
    assert.equal(switchSession({ target: '', current: 'a' }, {}), false);
    assert.equal(switchSession(null, {}), false);
  });

  test('deps 缺失 fn 不抛', () => {
    assert.doesNotThrow(() => switchSession({ target: 'b', current: 'a' }, {}));
    assert.doesNotThrow(() => switchSession({ target: 'b', current: 'a' }, { setUrl: 'notfn' }));
  });
  ```
- [ ] **4.2 跑验证失败。** `node --test test/session_switch.test.cjs` → FAIL(`Cannot find module '../public/session_switch.cjs'`)。

- [ ] **4.3 实现 session_switch.cjs。** 新建 `public/session_switch.cjs`(UMD,仿 deadState.cjs):
  ```js
  /**
   * session_switch.cjs — 切换会话的副作用编排(共享前后端,无 DOM 直接依赖)。
   * 把「切到某 session」的固定步骤封装,避免 select.change 与切换 sheet tap 两路行为分叉。
   * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.1。
   */
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) {
      module.exports = factory();
    } else {
      root.SessionSwitch = factory();
    }
  })(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    function switchSession(ctx, deps) {
      const target = ctx && typeof ctx.target === 'string' ? ctx.target.trim() : '';
      const current = ctx && typeof ctx.current === 'string' ? ctx.current : '';
      if (!target || target === current) return false;
      const d = deps && typeof deps === 'object' ? deps : {};
      if (typeof d.setUrl === 'function') d.setUrl(target);
      if (typeof d.store === 'function') d.store(target);
      if (typeof d.updateUi === 'function') d.updateUi();
      if (typeof d.syncProject === 'function') d.syncProject();
      if (typeof d.clearOutput === 'function') d.clearOutput();
      if (typeof d.hideQuickReply === 'function') d.hideQuickReply();
      if (typeof d.connect === 'function') d.connect();
      if (typeof d.note === 'function') d.note(`切换会话: ${target}`);
      return true;
    }
    return { switchSession };
  });
  ```
- [ ] **4.4 跑验证通过。** `node --test test/session_switch.test.cjs` → 全 PASS。

- [ ] **4.5 写失败测试 switch_sheet(RED)。** 新建 `test/switch_sheet.test.cjs`:
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const { handleTabTrap, shouldCloseOnKey, buildSessionItems } = require('../public/switch_sheet.cjs');

  test('handleTabTrap 末项 Tab 跳首', () => {
    const r = handleTabTrap({ key: 'Tab', shiftKey: false }, ['a','b','c'], 2);
    assert.equal(r.trap, true); assert.equal(r.focusIndex, 0);
  });
  test('handleTabTrap 首项 Shift+Tab 跳末', () => {
    const r = handleTabTrap({ key: 'Tab', shiftKey: true }, ['a','b','c'], 0);
    assert.equal(r.trap, true); assert.equal(r.focusIndex, 2);
  });
  test('handleTabTrap 中间项不 trap', () => {
    assert.equal(handleTabTrap({ key: 'Tab', shiftKey: false }, ['a','b','c'], 1).trap, false);
  });
  test('handleTabTrap 非 Tab / 空列表不 trap', () => {
    assert.equal(handleTabTrap({ key: 'Enter' }, ['a'], 0).trap, false);
    assert.equal(handleTabTrap({ key: 'Tab' }, [], 0).trap, false);
  });
  test('shouldCloseOnKey', () => {
    assert.equal(shouldCloseOnKey({ key: 'Escape' }), true);
    assert.equal(shouldCloseOnKey({ key: 'c', ctrlKey: true, view: { document: { getSelection: () => '' } } }), true);
    assert.equal(shouldCloseOnKey({ key: 'c', ctrlKey: true, view: { document: { getSelection: () => 'sel' } } }), false);
    assert.equal(shouldCloseOnKey({ key: 'Enter' }), false);
    assert.equal(shouldCloseOnKey(null), false);
  });
  test('buildSessionItems attached 排前 + isCurrent', () => {
    const items = buildSessionItems([{ name: 'b' }, { name: 'a', attached: true }], 'a');
    assert.equal(items[0].name, 'a'); assert.equal(items[0].attached, true);
    assert.equal(items.find(i => i.name === 'a').isCurrent, true);
    assert.equal(items.find(i => i.name === 'b').isCurrent, false);
  });
  test('buildSessionItems 非法降级', () => {
    assert.deepEqual(buildSessionItems(null, 'x'), []);
    assert.equal(buildSessionItems([{ name: 'ok' }, { bad: 1 }, 'x' ], 'ok').length, 1);
  });
  ```
- [ ] **4.6 跑验证失败。** `node --test test/switch_sheet.test.cjs` → FAIL(模块不存在)。

- [ ] **4.7 实现 switch_sheet.cjs。** 新建 `public/switch_sheet.cjs`(UMD;含纯函数 + DOM 构建 `createSwitchSheet`):
  ```js
  /**
   * switch_sheet.cjs — 切换 sheet 状态机 + DOM 构建。
   * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.1「切换 sheet 契约」。
   * 纯函数(handleTabTrap/shouldCloseOnKey/buildSessionItems)可 node --test;
   * createSwitchSheet 操作 document(仅浏览器调用)。
   */
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) {
      module.exports = factory();
    } else {
      root.SwitchSheet = factory();
    }
  })(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function handleTabTrap(e, focusables, activeIdx) {
      if (!e || e.key !== 'Tab' || !Array.isArray(focusables) || focusables.length === 0) {
        return { trap: false, focusIndex: -1 };
      }
      const last = focusables.length - 1;
      if (activeIdx < 0) return { trap: false, focusIndex: -1 };
      if (e.shiftKey) { if (activeIdx === 0) return { trap: true, focusIndex: last }; }
      else { if (activeIdx === last) return { trap: true, focusIndex: 0 }; }
      return { trap: false, focusIndex: -1 };
    }

    function shouldCloseOnKey(e) {
      if (!e) return false;
      if (e.key === 'Escape') return true;
      if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        try {
          const sel = (e.view && e.view.document) ? e.view.document.getSelection() : null;
          if (sel && String(sel).length > 0) return false;
        } catch { /* ignore */ }
        return true;
      }
      return false;
    }

    function buildSessionItems(sessions, current) {
      const list = Array.isArray(sessions) ? sessions : [];
      const cur = typeof current === 'string' ? current : '';
      const items = list
        .filter((s) => s && typeof s.name === 'string')
        .map((s) => ({ name: s.name, label: s.attached ? `${s.name} · attached` : s.name, attached: !!s.attached, isCurrent: s.name === cur }));
      items.sort((a, b) => (b.attached ? 1 : 0) - (a.attached ? 1 : 0));
      return items;
    }

    function createSwitchSheet(opts) {
      const doc = (typeof document !== 'undefined') ? document : null;
      if (!doc) return null;
      const trigger = opts && opts.trigger;
      const onPick = (opts && typeof opts.onPick === 'function') ? opts.onPick : () => {};
      const items = (opts && Array.isArray(opts.items)) ? opts.items : [];

      const backdrop = doc.createElement('div');
      backdrop.className = 'switch-sheet-backdrop'; backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true');
      const sheet = doc.createElement('div');
      sheet.className = 'switch-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
      sheet.setAttribute('aria-label', '切换会话'); sheet.hidden = true;
      const handle = doc.createElement('div');
      handle.className = 'switch-sheet-handle'; handle.setAttribute('aria-hidden', 'true'); sheet.appendChild(handle);
      const list = doc.createElement('ul');
      list.className = 'switch-sheet-list'; list.setAttribute('role', 'list');
      const itemEls = [];
      items.forEach((it) => {
        const li = doc.createElement('li');
        li.className = 'switch-sheet-item' + (it.isCurrent ? ' switch-sheet-item--current' : '');
        const btn = doc.createElement('button');
        btn.type = 'button'; btn.className = 'switch-sheet-btn';
        btn.setAttribute('aria-current', it.isCurrent ? 'true' : 'false');
        btn.textContent = it.label;             // textContent 防 HTML 注入
        if (it.isCurrent) btn.disabled = true;
        btn.addEventListener('click', () => { onPick(it.name); });
        li.appendChild(btn); list.appendChild(li); itemEls.push(btn);
      });
      sheet.appendChild(list);
      doc.body.appendChild(backdrop); doc.body.appendChild(sheet);

      let openState = false, savedOverflow = '', lastFocused = null;
      const focusables = () => Array.from(sheet.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
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
        backdrop.hidden = false; sheet.hidden = false; sheet.setAttribute('aria-hidden', 'false');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        doc.addEventListener('keydown', onKeydown, true);
        const fs = focusables(); if (fs.length) fs[0].focus({ preventScroll: true }); else sheet.focus();
      }
      function close() {
        if (!openState) return; openState = false;
        doc.body.style.overflow = savedOverflow;
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

    return { handleTabTrap, shouldCloseOnKey, buildSessionItems, createSwitchSheet };
  });
  ```
- [ ] **4.8 跑验证通过。** `node --test test/switch_sheet.test.cjs` → 全 PASS。

- [ ] **4.9 加 .switch-sheet 样式到 style.css 末尾。** 追加(spec §7.1 底部抽屉 + ≥44pt + reduced-motion):
  ```css
  /* === 切换 sheet(spec §7.1 底部抽屉)=== */
  .switch-sheet-backdrop { position: fixed; inset: 0; background: rgba(38, 37, 30, 0.35); z-index: 1000; border: none; }
  .switch-sheet {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
      background: var(--bg-2); border-top: 1px solid var(--border-2); border-radius: var(--r) var(--r) 0 0;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
      padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
      max-height: 70vh; overflow-y: auto; animation: sheetUp 0.25s ease both;
  }
  @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .switch-sheet-handle { width: 36px; height: 4px; border-radius: var(--r-pill); background: var(--border-2); margin: 0 auto 12px; }
  .switch-sheet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .switch-sheet-btn {
      width: 100%; min-height: 44px; padding: 0 14px; display: flex; align-items: center; gap: 8px;
      border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface); color: var(--fg);
      font-family: var(--mono); font-size: 13px; text-align: left; cursor: pointer;
  }
  .switch-sheet-btn:disabled, .switch-sheet-item--current .switch-sheet-btn {
      background: var(--accent-bg); border-color: var(--accent-dim); color: var(--accent-2); font-weight: 600;
  }
  .switch-sheet-btn:not(:disabled):active { background: var(--surface-2); }
  .switch-sheet-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .switch-sheet { animation: none; } }
  ```

- [ ] **4.10 index.html 加载 UMD + 触发器 DOM。** 在 `index.html:77`(deadState.cjs 之后、client.js 之前)插入两行:
  ```html
  <script src="session_switch.cjs"></script>
  <script src="switch_sheet.cjs"></script>
  ```
  header 内(DOM 重排在 Task 7,本步仅确认 switchToggle button 由 Task 7 提供;若 Task 7 未到位,本步可跳过接入,留 Task 7 统一)。**本步只加 script 标签**,接入 client.js 在 4.11。

- [ ] **4.11 client.js 接入切换 sheet + sessionSelect.change 改调编排。** 在 `client.js` init() 内 refreshSessions 绑定之后(约 :869-875 之后)新增装配;并把 `sessionSelect.addEventListener('change', ...)`(原 :876-894)改为调 `SessionSwitch.switchSession`:
  ```js
          // === 切换 sheet 装配(spec §7.1)===
          const switchTrigger = document.getElementById('switchToggle');
          if (switchTrigger && typeof SwitchSheet !== 'undefined' && SwitchSheet.createSwitchSheet) {
              switchTrigger.setAttribute('aria-haspopup', 'dialog');
              switchTrigger.setAttribute('aria-expanded', 'false');
              let sheetHandle = null;
              const rebuildSheet = () => {
                  if (sheetHandle) { sheetHandle.destroy(); sheetHandle = null; }
                  const items = SwitchSheet.buildSessionItems(cachedSessions, currentSession);
                  sheetHandle = SwitchSheet.createSwitchSheet({
                      trigger: switchTrigger, items,
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
                  });
              };
              switchTrigger.addEventListener('click', () => { rebuildSheet(); if (sheetHandle) sheetHandle.open(); });
          }
  ```
  sessionSelect.change 改调编排(保留 UMD 缺失兜底):
  ```js
          if (sessionSelect) {
              sessionSelect.addEventListener('change', () => {
                  const target = sessionSelect.value;
                  const switchSession = (typeof SessionSwitch !== 'undefined' && SessionSwitch.switchSession) || null;
                  if (switchSession) {
                      switchSession({ target, current: currentSession }, {
                          setUrl: setSessionInUrl, store: storeSession, updateUi: updateSessionUi,
                          syncProject: syncProjectSelect, clearOutput: () => { lastOutput = null; },
                          hideQuickReply, connect, note: showSystemNote,
                      });
                      currentSession = target;
                  } else {
                      if (!target || target === currentSession) return;
                      currentSession = target;
                      setSessionInUrl(currentSession); storeSession(currentSession); updateSessionUi();
                      syncProjectSelect(); lastOutput = null; hideQuickReply();
                      showSystemNote(`切换会话: ${currentSession}`); connect();
                  }
              });
          }
  ```

- [ ] **4.12 跑全量测试 + grep。** `npm test` → 全 PASS。`grep -rnE '\-\-(brand|brand-strong)\b' public/` → 空;`grep -rn 'rgba(212,165,116)' public/` → 空。

- [ ] **4.13 人眼对照(真机/DevTools 390×844)。** 窄屏「切换」触发器可见;点开 → 底部 sheet 升起 + backdrop;Session 项 ≥44pt;点项切换 + 关闭;Esc/⌃C 关闭;Tab 在 sheet 内循环。桌面 ≥769px 触发器隐藏、inline 下拉可见(断点样式见 Task 7)。

- [ ] **4.14 commit。**
  ```bash
  git add public/session_switch.cjs public/switch_sheet.cjs public/index.html public/style.css public/client.js test/session_switch.test.cjs test/switch_sheet.test.cjs
  git commit -m "feat(terminal): 切换 sheet 底部抽屉 + 切换编排 UMD(spec §7.1 契约,focus trap/Esc/⌃C)"
  ```

---

## Task 5: 看板页(dashboard.css + dashboard.js + dashboard_render.cjs,s-dot 双编码)

> **依赖:** Task 1、Task 2。spec §7.2 critical:badge→`.s-dot`+`.s-status` 双编码(必改 JS),waiting 高亮 + 排序,空状态 serif。dashboard.js 是 IIFE,渲染逻辑抽 `dashboard_render.cjs` 走 TDD。

**Files:**
- Create: `public/dashboard_render.cjs`
- Create: `test/dashboard_render.test.cjs`
- Modify: `public/dashboard.html`(:36 脚本顺序)
- Modify: `public/dashboard.js`(整文件重写)
- Modify: `public/dashboard.css`(整文件重写)

> **前置核查(跨领域风险):** dashboard.html 仅 `<link>` dashboard.css(实测),**不引 style.css**。故本 Task 的 `.nav/.nav-link` 仍由 dashboard.css 定义(不删、不合并到 style.css),否则看板 nav 裸奔。`.brand-mark`/`.btn-primary`/`.s-dot` 来自 tokens.css 组件区(Task 2),dashboard.css `@import tokens.css` 自动带载。

**Steps:**

- [ ] **5.1 写失败测试(RED)。** 新建 `test/dashboard_render.test.cjs`:
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const R = require('../public/dashboard_render.cjs');

  test('sortSessions waiting 排前', () => {
    assert.equal(R.sortSessions([{status:'idle'},{status:'waiting'}])[0].status, 'waiting');
  });
  test('sortSessions 同权重按 lastTs 倒序', () => {
    const s = R.sortSessions([{status:'working',lastTs:100},{status:'working',lastTs:200}]);
    assert.equal(s[0].lastTs, 200);
  });
  test('sortSessions 不修改入参', () => {
    const arr = [{status:'idle'}]; const sorted = R.sortSessions(arr);
    assert.equal(arr[0].status, 'idle'); assert.notEqual(arr, sorted);
  });
  test('renderSession 双编码 s-dot + s-status', () => {
    const html = R.renderSession({name:'x',status:'waiting'}, 0);
    assert.match(html, /class="s-dot s-dot--waiting"/);
    assert.match(html, /<span class="s-status">等待<\/span>/);
  });
  test('renderSession waiting 加 .waiting 高亮类', () => {
    assert.match(R.renderSession({name:'x',status:'waiting'},0), /class="session waiting"/);
  });
  test('renderSession 非 waiting 无 .waiting', () => {
    assert.doesNotMatch(R.renderSession({name:'x',status:'idle'},0), /waiting/);
  });
  test('renderSession unknown 虚线点 + 兜底标签', () => {
    const html = R.renderSession({name:'x',status:'bogus'},0);
    assert.match(html, /s-dot--unknown/); assert.match(html, />未知</);
  });
  test('renderSession s-id 1-based 补零', () => {
    assert.match(R.renderSession({},0), /s:01/);
    assert.match(R.renderSession({},9), /s:10/);
  });
  test('renderSession meta 合并 cwd + lastLine', () => {
    assert.match(R.renderSession({name:'x',status:'idle',cwd:'/a/b',lastLine:'继续吗?'},0), /~\/b · 继续吗\?/);
  });
  test('renderSession 无 lastLine 回退 relativeTime', () => {
    assert.match(R.renderSession({name:'x',status:'idle',lastTs:Date.now()-30000},0), /30s 前/);
  });
  test('renderSession name 在 data-session + aria-label 转义(XSS)', () => {
    const html = R.renderSession({name:'<x>',status:'idle'},0);
    assert.match(html, /data-session="&lt;x&gt;"/);
    assert.doesNotMatch(html, /data-session="<x>"/);
  });
  test('countWaiting 只数 waiting+errored', () => {
    assert.equal(R.countWaiting([{status:'waiting'},{status:'errored'},{status:'working'}]), 2);
  });
  test('renderState eyebrow + serif lede', () => {
    const html = R.renderState('ready','hi');
    assert.match(html, /class="eyebrow"/); assert.match(html, /\[ready\]/);
    assert.match(html, /class="lede">hi</);
  });
  test('escapeHtml 中和注入', () => {
    assert.equal(R.escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(R.escapeHtml('a"b'), 'a&quot;b');
  });
  ```
- [ ] **5.2 跑验证失败。** `node --test test/dashboard_render.test.cjs` → FAIL(模块不存在)。

- [ ] **5.3 实现 dashboard_render.cjs。** 新建 `public/dashboard_render.cjs`(顶部 IIFE 包裹 + `window.CCDashboard` 浏览器挂载 + `module.exports` 测试导出):
  ```js
  /**
   * 看板渲染纯逻辑(无 DOM 依赖,供 node --test 单测)。
   * 浏览器经 window.CCDashboard 挂载(dashboard.js 使用);测试经 require。
   * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.2 / §6 状态系统。
   */
  (function (root, factory) {
    const api = factory();
    if (typeof window !== 'undefined') { window.CCDashboard = api; }
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  })(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    var STATUS_WEIGHT = { waiting: 0, errored: 0, working: 1, idle: 2, unknown: 3 };
    var STATUS_LABEL = { waiting: '等待', errored: '错误', working: '工作中', idle: '空闲', unknown: '未知' };
    var FALLBACK_WEIGHT = 3;
    var FALLBACK_STATUS_KEY = 'unknown';

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
    }
    function relativeTime(lastTs, nowTs) {
      if (!lastTs || typeof lastTs !== 'number') return '';
      var now = typeof nowTs === 'number' ? nowTs : Date.now();
      var ageS = Math.max(0, Math.round((now - lastTs) / 1000));
      if (ageS < 60) return ageS + 's 前';
      if (ageS < 3600) return Math.round(ageS / 60) + 'm 前';
      if (ageS < 86400) return Math.round(ageS / 3600) + 'h 前';
      return Math.round(ageS / 86400) + 'd 前';
    }
    function shortPath(p) {
      var parts = String(p).split('/');
      return parts[parts.length - 1] || p;
    }
    function sortSessions(sessions) {
      return sessions.slice().sort(function (a, b) {
        var wa = STATUS_WEIGHT[a.status] != null ? STATUS_WEIGHT[a.status] : FALLBACK_WEIGHT;
        var wb = STATUS_WEIGHT[b.status] != null ? STATUS_WEIGHT[b.status] : FALLBACK_WEIGHT;
        if (wa !== wb) return wa - wb;
        return (b.lastTs || 0) - (a.lastTs || 0);
      });
    }
    function countWaiting(sessions) {
      return sessions.filter(function (s) { return s.status === 'waiting' || s.status === 'errored'; }).length;
    }
    function renderSession(s, index) {
      var statusKey = STATUS_LABEL[s.status] ? s.status : FALLBACK_STATUS_KEY;
      var status = STATUS_LABEL[statusKey];
      var sid = 's:' + String(index + 1).padStart(2, '0');
      var metaParts = [];
      if (s.cwd) metaParts.push('~/' + escapeHtml(shortPath(s.cwd)));
      if (s.lastLine) { metaParts.push(escapeHtml(s.lastLine)); }
      else { var t = relativeTime(s.lastTs); if (t) metaParts.push(t); }
      var meta = metaParts.join(' · ');
      var waitingCls = statusKey === 'waiting' ? ' waiting' : '';
      return '<li class=\"session' + waitingCls + '\" data-session=\"' + escapeHtml(s.name)
        + '\" tabindex=\"0\" role=\"button\" aria-label=\"' + escapeHtml(s.name) + ' · ' + escapeHtml(status) + '\">'
        + '<span class=\"s-dot s-dot--' + escapeHtml(statusKey) + '\" aria-hidden=\"true\"></span>'
        + '<div class=\"s-main\">'
        + '<span class=\"s-name\">' + escapeHtml(s.name) + '</span>'
        + '<span class=\"s-meta\">' + meta + '</span>'
        + '</div>'
        + '<span class=\"s-status\">' + escapeHtml(status) + '</span>'
        + '<span class=\"s-id\">' + sid + '</span>'
        + '</li>';
    }
    function renderSessionList(sessions) {
      var sorted = sortSessions(sessions);
      return sorted.map(function (s, i) { return renderSession(s, i); }).join('');
    }
    function renderState(eyebrow, lede) {
      return '<p class=\"eyebrow\">[' + escapeHtml(eyebrow) + ']</p>'
        + '<p class=\"lede\">' + escapeHtml(lede) + '</p>';
    }
    return {
      STATUS_WEIGHT: STATUS_WEIGHT, STATUS_LABEL: STATUS_LABEL,
      escapeHtml: escapeHtml, relativeTime: relativeTime, shortPath: shortPath,
      sortSessions: sortSessions, countWaiting: countWaiting,
      renderSession: renderSession, renderSessionList: renderSessionList, renderState: renderState
    };
  });
  ```
- [ ] **5.4 跑验证通过。** `node --test test/dashboard_render.test.cjs` → 全 PASS。

- [ ] **5.5 dashboard.html 加载顺序 + theme-color。** 在 `dashboard.html:36` `<script src="dashboard.js">` **之前**插入:
  ```html
  <script src="dashboard_render.cjs"></script>
  ```
  (theme-color 已在 Task 1 改 #f2f1ed;本步仅核查存在。)

- [ ] **5.6 重写 dashboard.js。** 整文件替换为(IIFE,引用 `window.CCDashboard`,事件委托 `.session-row`→`.session`,空状态 serif):
  ```js
  /**
   * CC 看板:轮询 /api/dashboard 渲染会话状态列表。
   * 渲染逻辑真源:dashboard_render.cjs(浏览器经 window.CCDashboard 挂载,测试经 require)。
   * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.2。
   */
  (function () {
      'use strict';

      var R = window.CCDashboard;
      if (!R) { console.error('dashboard_render.cjs 未加载,看板无法渲染'); return; }
      var POLL_MS = 2000;
      var list = document.getElementById('sessionList');
      var stateMsg = document.getElementById('stateMessage');
      var titleEl = document.getElementById('title');
      var titleCountEl = document.getElementById('titleCount'); // 可选 header meta 锚点

      function goToSession(name) {
          if (!name) return;
          window.location.href = '/?session=' + encodeURIComponent(name);
      }
      function rowFromEvent(e) {
          return e.target.closest ? e.target.closest('.session') : null; // §7.2:210 .session-row → .session
      }
      list.addEventListener('click', function (e) {
          var row = rowFromEvent(e); if (!row) return;
          goToSession(row.getAttribute('data-session'));
      });
      list.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          var row = rowFromEvent(e); if (!row) return;
          e.preventDefault(); goToSession(row.getAttribute('data-session'));
      });

      function setTitle(waiting) {
          var t = waiting > 0 ? '(' + waiting + ') CC 看板' : 'CC 看板';
          if (titleEl) titleEl.textContent = t;
          document.title = t;
      }
      function setMeta(count) {
          if (titleCountEl) titleCountEl.textContent = count + ' sessions'; // §7.2:209 不重复 waiting 计数
      }
      function showState(eyebrow, lede) {
          list.innerHTML = '';
          stateMsg.hidden = false;
          stateMsg.innerHTML = R.renderState(eyebrow, lede);
      }
      function render(payload) {
          var sessions = (payload && payload.sessions) || [];
          var waiting = R.countWaiting(sessions);
          setTitle(waiting); setMeta(sessions.length);
          if (!payload || payload.tmuxOk === false) {
              showState('error', 'tmux 不可用,请确认 tmux 已安装并在 PATH 中。'); return;
          }
          if (sessions.length === 0) {
              showState('ready', '还没有会话。在主控制台启动一个会话,这里会显示状态。'); return;
          }
          stateMsg.hidden = true;
          list.innerHTML = R.renderSessionList(sessions);
      }
      async function poll() {
          try {
              var res = await fetch('/api/dashboard', { headers: { 'Accept': 'application/json' } });
              if (res.status === 401) { window.location.href = '/login?next=/dashboard.html'; return false; }
              if (!res.ok) { render({ tmuxOk: false, sessions: [] }); return true; }
              render(await res.json());
          } catch (e) { render({ tmuxOk: false, sessions: [] }); }
          return true;
      }
      var polling = true;
      async function loop() {
          if (!polling) return;
          var ok = await poll();
          if (ok && polling) setTimeout(loop, POLL_MS);
      }
      document.addEventListener('visibilitychange', function () {
          if (document.hidden) { polling = false; }
          else if (!polling) { polling = true; loop(); }
      });
      loop();
  })();
  ```

- [ ] **5.7 重写 dashboard.css。** 整文件替换为(令牌迁移 + badge→s-dot + `.session` 卡片 + waiting 高亮 + mono meta + serif 空状态 + `.nav` 保留 + <640px 折叠 .s-id):
  ```css
  /**
   * CC 看板样式(editorial 重设计,消费 tokens.css 令牌 + 组件区)。
   * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.2 / §6。
   * 注:.nav/.nav-link 本文件保留(dashboard.html 不引 style.css,合并会裸奔)。
   */
  @import url('tokens.css');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
      width: 100%; height: 100%; font-family: var(--sans); font-size: 14px;
      background-color: var(--bg); color: var(--fg);
  }
  #app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }

  .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: max(12px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
      background-color: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .logo { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; color: var(--fg); }
  .header-actions { display: flex; align-items: center; gap: 12px; }

  /* nav 保留(单一来源在本文件,触摸 44pt + :focus-visible) */
  .nav { display: flex; gap: 2px; background: var(--surface-2); border-radius: var(--r-pill); padding: 3px; }
  .nav-link {
      font-size: 12px; min-height: 44px; padding: 6px 14px; border-radius: var(--r-pill);
      text-decoration: none; color: var(--fg-2); display: inline-flex; align-items: center;
  }
  .nav-link.cur { background: var(--bg); color: var(--fg); font-weight: 600; }
  .nav-link:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

  .main { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .session-list { list-style: none; display: flex; flex-direction: column; gap: 9px; }

  /* 会话卡片:§7.2:210 + §6:172 */
  .session {
      position: relative; display: flex; align-items: center; gap: 11px; padding: 13px 14px;
      background-color: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
      min-height: 44px; cursor: pointer; transition: border-color 0.15s ease;
  }
  .session:hover { border-color: var(--border-2); }
  .session:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  .session:active { background-color: var(--surface-2); }

  /* waiting 高亮:§7.2:212(--accent-bg 轻底 + inset 3px 左边框 var(--waiting)) */
  .session.waiting {
      background-color: var(--accent-bg); border-color: var(--accent-dim);
      box-shadow: inset 3px 0 0 var(--waiting);
  }

  /* .s-dot 几何在 tokens.css 组件区;此处仅 waiting 脉冲(自带 reduced-motion 降级,§9:254) */
  .session.waiting .s-dot--waiting {
      background: var(--waiting); box-shadow: 0 0 0 4px rgba(192, 133, 50, 0.15);
      animation: dash-dot-pulse 1.6s ease-in-out infinite;
  }
  @keyframes dash-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @media (prefers-reduced-motion: reduce) { .session.waiting .s-dot--waiting { animation: none; } }

  .s-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .s-name {
      font-family: var(--sans); font-weight: 600; font-size: 14px; color: var(--fg);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .s-meta {
      font-family: var(--mono); font-size: 11px; color: var(--fg-3);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .s-id { font-family: var(--mono); font-size: 10px; color: var(--fg-3); flex-shrink: 0; }

  /* 空状态:§7.2:214 serif lede + eyebrow */
  .state-message { padding: 56px 24px; text-align: center; }
  .state-message .eyebrow { margin-bottom: 14px; }
  .state-message .lede { font-family: var(--serif); font-size: 14.5px; line-height: 1.65; color: var(--fg-2); }

  @media (max-width: 640px) {
      .s-id { display: none; }
      .session { flex-wrap: wrap; }
  }
  ```

- [ ] **5.8 跑全量测试 + grep。** `npm test` → 全 PASS(既有 `test/dashboard_binding|cache|parse|slug.test.cjs` 均 require 服务端 .cjs 模块,不依赖 dashboard.js 浏览器 IIFE,故重写 dashboard.js 不破坏既有测试)。grep 验证:
  - `grep -nE 'badge|session-row|session-preview|--font|--text|--muted|--brand' public/dashboard.css` → 无命中(注释除外)
  - `grep -rn 'STATUS_ICON\|badge-dot' public/dashboard.js` → 空(STATUS_ICON 随重写删除)

- [ ] **5.9 人眼对照 mockup。** 浏览器开 /dashboard.html:li.session 含 .s-dot(9px)+ .s-main(.s-name+.s-meta)+ .s-status + .s-id;waiting 卡暖橙左边框+轻底;空状态 serif。

- [ ] **5.10 commit。**
  ```bash
  git add public/dashboard_render.cjs public/dashboard.js public/dashboard.css public/dashboard.html test/dashboard_render.test.cjs
  git commit -m "feat(dashboard): badge→s-dot 双编码 + waiting 高亮 + serif 空状态 + 渲染逻辑 UMD"
  ```

---

## Task 6: 登录页 login.html 整体重写

> **依赖:** Task 1、Task 2。spec §7.3:◇ brand mark + serif lede + token 输入成套属性 + 粘贴 token。POST /login + next 参数脚本必须保留(后端契约)。

**Files:**
- Modify: `public/login.html`(整文件)
- Test: 结构/grep 断言并入 `test/tokens.test.cjs`(无 jsdom,用 fs 读文本断言;粘贴脚本逻辑用 stub 单测,新建 `test/login_paste.test.cjs`)

**Steps:**

- [ ] **6.1 写失败测试(RED)。** 扩展 `test/tokens.test.cjs` 加 login 结构断言(纯 fs 文本匹配,无 jsdom):
  ```js
  test('login.html 结构:brand-mark + eyebrow + 成套输入属性 + 主/ghost 按钮 + POST 契约', () => {
    const html = fs.readFileSync(`${P}/login.html`, 'utf8');
    assert.ok(!/var\(--(brand|brand-strong|text|muted|font|r-lg)\b/.test(html), '残留旧令牌');
    assert.ok(!/rgba\(212,\s*165,\s*116/.test(html), '残留琥珀硬编码');
    assert.ok(html.includes('brand-mark brand-mark--lg'));
    assert.ok(html.includes('Roc-CC'));                 // brand mark 旁可见文本(可达性)
    assert.ok(html.includes('[ login ]'));
    assert.ok(/id="token"[^>]*autocomplete="off"/.test(html));
    assert.ok(/enterkeyhint="go"/.test(html));
    assert.ok(html.includes('class="btn-primary"'));
    assert.ok(html.includes('id="pasteBtn"') && html.includes('btn-ghost'));
    assert.ok(/<form[^>]*method="POST"[^>]*action="\/login"/.test(html));
    assert.ok(html.includes('id="next"') && html.includes('name="next"'));
    // .token-input 基类无裸 outline:none
    const base = html.match(/\.token-input\s*\{[^}]*\}/)[0];
    assert.ok(!/outline:\s*none/.test(base));
  });
  ```
  新建 `test/login_paste.test.cjs`(粘贴脚本逻辑用最小 stub,抽离判定函数):
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  // 粘贴逻辑的真源在 login.html <script> 内(IIFE 不可 require)。
  // 此处用文本断言保证脚本契约存在,运行时行为靠真机/grep。
  const fs = require('node:fs');
  test('login.html 含粘贴脚本:clipboard.readText + 失败静默 + aria-disabled', () => {
    const html = fs.readFileSync('public/login.html', 'utf8');
    assert.ok(/navigator\.clipboard\.readText/.test(html));
    assert.ok(/\.catch\(function/.test(html));          // 失败静默
    assert.ok(/aria-disabled/.test(html));               // 弱化态
  });
  ```
- [ ] **6.2 跑验证失败。** `npm test` → login 结构断言 FAIL(现状无 brand-mark/eyebrow/pasteBtn)。

- [ ] **6.3 整体重写 login.html。** 用 Write 替换 `public/login.html` 为(spec §7.3 完整实现;brand-mark/.btn-primary/.btn-ghost/.eyebrow 由 tokens.css 组件区提供):
  ```html
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Roc-CC Remote Control - Login</title>
    <link rel="icon" href="icon-192.png">
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" href="apple-touch-icon.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Roc-CC">
    <meta name="theme-color" content="#f2f1ed">
    <link rel="stylesheet" href="tokens.css">
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; min-height: 100dvh;
        display: grid; place-items: center; padding: 24px;
        padding-left: max(24px, env(safe-area-inset-left));
        padding-right: max(24px, env(safe-area-inset-right));
        padding-bottom: max(24px, env(safe-area-inset-bottom));
        font-family: var(--sans); background-color: var(--bg); color: var(--fg);
        -webkit-font-smoothing: antialiased;
      }
      .login-card { width: 100%; max-width: 330px; text-align: left; }
      .l-eyebrow { font-family: var(--mono); font-size: 11px; color: var(--accent-2); letter-spacing: 0.04em; margin: 0 0 14px; }
      .brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
      .brand-name { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; color: var(--fg); }
      .brand-ver { font-family: var(--mono); font-size: 10px; color: var(--fg-3); margin-left: 2px; }
      h1 { margin: 0 0 10px; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; color: var(--fg); }
      .lede { font-family: var(--serif); font-size: 14.5px; line-height: 1.65; color: var(--fg-2); margin: 0 0 24px; }
      .field-label { display: block; font-family: var(--mono); font-size: 10px; color: var(--fg-3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 7px; }
      .token-input {
        width: 100%; padding: 12px 14px; font-family: var(--mono); font-size: 16px;
        background-color: var(--surface); border: 1px solid var(--border-2); border-radius: var(--r);
        color: var(--fg); letter-spacing: 0.06em; transition: box-shadow .15s ease, border-color .15s ease;
      }
      .token-input::placeholder { color: var(--fg-3); }
      .token-input:focus { border-color: var(--accent-dim); box-shadow: 0 0 0 3px var(--accent-dim); }
      .token-input:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
      .error { margin: 12px 0 0; font-family: var(--sans); font-size: 13px; color: var(--errored); }
      .login-actions { display: flex; gap: 8px; margin-top: 14px; }
      .login-actions .btn-primary { flex: 1; }
      .btn-ghost[aria-disabled="true"] { opacity: 0.45; pointer-events: none; }
      .l-hint { margin: 22px 0 0; font-family: var(--mono); font-size: 10.5px; line-height: 1.7; color: var(--fg-3); }
      .l-hint .k { color: var(--fg-2); }
      @media (max-width: 480px) { .login-card { max-width: 100%; } }
    </style>
  </head>
  <body>
    <main class="login-card">
      <p class="l-eyebrow">[ login ] · v2.4</p>
      <div class="brand-row">
        <span class="brand-mark brand-mark--lg" aria-hidden="true"></span>
        <span class="brand-name">Roc-CC</span>
        <span class="brand-ver">v2.4</span>
      </div>
      <h1>Roc-CC Remote Control</h1>
      <p class="lede">输入访问 token,连接你的 Claude Code 会话。</p>
      <form method="POST" action="/login" novalidate>
        <input id="next" name="next" type="hidden" value="/" />
        <label class="field-label" for="token">access token</label>
        <input id="token" name="token" class="token-input" type="password"
          autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
          inputmode="text" enterkeyhint="go" placeholder="粘贴或输入 token" required />
        <div class="login-actions">
          <button class="btn-primary" type="submit">登录</button>
          <button class="btn-ghost" id="pasteBtn" type="button" aria-label="从剪贴板粘贴 token">粘贴 token</button>
        </div>
      </form>
      <p class="l-hint">
        <span class="k">CC_WEB_AUTH_TOKEN</span> · 此服务可远程控制 tmux / Claude Code,<br>
        仅在可信设备与网络使用,妥善保管 token。
      </p>
    </main>
    <script>
      (function () {
        try {
          var url = new URL(window.location.href);
          var next = url.searchParams.get('next');
          if (next && typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
            var el = document.getElementById('next');
            if (el) el.value = next;
          }
        } catch (e) {}
        var pasteBtn = document.getElementById('pasteBtn');
        var tokenInput = document.getElementById('token');
        if (pasteBtn && tokenInput) {
          pasteBtn.addEventListener('click', function () {
            if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
              pasteBtn.setAttribute('aria-disabled', 'true');
              return;
            }
            navigator.clipboard.readText().then(function (text) {
              var val = (text || '').trim();
              if (val) { tokenInput.value = val; tokenInput.focus(); }
            }).catch(function () { /* 静默:权限被拒或非安全上下文,用户手动粘贴 */ });
          });
        }
      })();
    </script>
  </body>
  </html>
  ```
- [ ] **6.4 跑验证通过。** `npm test` → login 结构断言 + 粘贴脚本断言全 PASS。

- [ ] **6.5 grep 验收 + 人眼对照。** `grep -nE 'var\(--accent\)' public/login.html` → 空(login 内联文字/按钮全 --accent-2);`grep -nE '\-\-(brand|brand-strong|text|muted|font|r-lg)\b' public/login.html` → 空。对照 mockup 登录卡:◇ 30px + Roc-CC + v2.4;eyebrow [ login ];serif lede;token-input mono 16px + 暖橙 focus。

- [ ] **6.6 commit。**
  ```bash
  git add public/login.html test/login_paste.test.cjs test/tokens.test.cjs
  git commit -m "feat(login): editorial 重写(◇ brand mark+serif lede+成套输入属性+粘贴 token)"
  ```

---

## Task 7: iOS 适配 + index.html header 重排 + visualViewport

> **依赖:** Task 1、Task 2、Task 3、Task 4。spec §8:软键盘 visualViewport、触摸目标 44pt、字号 ≥16px;§7.1:header 重排 + 切换 sheet DOM。**跨领域风险:multi_line_input.js:65 硬编码 100vh 必须同步。**

**Files:**
- Modify: `public/index.html`(header :19-56 / welcome :63-67 / toast :70 / theme-color :14)
- Modify: `public/client.js`(inlineInput 属性 / setupVisualViewport / setupSwitchSheet / updateConnectionStatus / updateSessionUi)
- Modify: `public/modules/multi_line_input.js`(:65)
- Modify: `public/style.css`(#app --vh-available、断点切换 sheet 显隐)

**Steps:**

- [ ] **7.1 index.html header 重排。** 替换 `<header class="header">...</header>` 块(原 :19-56)为(brand 行 + meta bar + 切换 button + nav + 切换 sheet 容器):
  ```html
  <header class="header">
    <div class="brand-row">
      <span class="brand" aria-label="Roc-CC Remote Control">
        <span class="brand-mark brand-mark--sm" aria-hidden="true"></span>
        <span class="brand-name">Roc-CC</span>
        <span class="brand-ver">v2.4</span>
      </span>
      <span id="liveIndicator" class="live-dot" role="status" aria-live="polite">
        <span class="live-dot-pulse" aria-hidden="true"></span>
        <span class="live-dot-text">未连接</span>
      </span>
    </div>
    <div class="meta-bar" role="group" aria-label="会话信息">
      <span class="meta-label">project</span>
      <span id="metaProject" class="meta-val">—</span>
      <span class="meta-sep" aria-hidden="true">·</span>
      <span class="meta-label">s</span><span id="metaSession" class="meta-val">—</span>
      <button id="switchToggle" class="swap-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="switchSheet">切换 <span aria-hidden="true">⌄</span></button>
    </div>
    <nav class="nav" aria-label="主导航">
      <a class="nav-link cur" href="/" aria-current="page">控制台</a>
      <a class="nav-link" href="/dashboard.html">看板</a>
      <a class="nav-link" href="/login">登录</a>
    </nav>
    <!-- 切换 sheet 容器(switch_sheet.cjs createSwitchSheet 创建 backdrop+sheet 挂 body;
         此 #switchSheet 仅作 aria-controls 锚点,实际 sheet 由 JS 动态构建) -->
    <div id="switchSheet" hidden></div>
  </header>
  ```
  > 注:Task 4 的 switch_sheet.cjs 用 `createSwitchSheet` 自建 backdrop/sheet 挂 body,触发器 `switchToggle`。`aria-controls="switchSheet"` 指向锚点。原 `.controls`(Session/Project/刷新/启动)保留 DOM 但由 CSS 断点控制显隐——**确认各 id(sessionSelect/refreshSessions/projectSelect/projectControl/projectsEmpty/startProject)仍在 DOM 内**(client.js getElementById 不破)。把它们放回 header 内 inline 容器(桌面 ≥769 显示):
  ```html
  <div class="header-actions" id="desktopControls">
    <div class="controls">
      <label class="control"><span class="control-label">Session</span><select id="sessionSelect" class="control-input"></select></label>
      <button id="refreshSessions" class="btn" type="button">刷新</button>
      <label id="projectControl" class="control"><span class="control-label">Project</span><select id="projectSelect" class="control-input"></select></label>
      <p id="projectsEmpty" class="projects-empty" hidden></p>
      <button id="startProject" class="btn" type="button">启动</button>
    </div>
  </div>
  ```
  (放在 `</header>` 之前;原 `#connectionStatus` 删除——状态改由 live 点承载。)

- [ ] **7.2 index.html welcome + toast。** welcome(原 :63-67)加 eyebrow:`<p class="eyebrow">[ ready ] · <span class="eyebrow-id">s:0n</span></p>`(h2 之前);toast-container(原 :70)改:
  ```html
  <div id="toast-container" aria-label="通知" aria-live="polite" role="status"></div>
  ```

- [ ] **7.3 style.css #app --vh-available。** 替换 `#app`(原 :24-29):
  ```css
  #app {
      display: flex; flex-direction: column;
      height: 100vh; height: 100dvh;
      height: var(--vh-available, 100dvh);   /* visualViewport 写入,无 JS 回退 100dvh */
      min-height: 0;
  }
  ```

- [ ] **7.4 style.css 断点切换 sheet 显隐。** 在 Task 3.11 已重写的 `@media (max-width: 768px)` 块**内**追加一行(勿新建重复查询),并新增桌面断点块:
  ```css
  /* 在 Task 3.11 的 @media (max-width: 768px) 块内追加这一行(合并,不另起查询): */
  #desktopControls { display: none; }
  /* 文件末尾新增桌面断点块(条件不重复): */
  @media (min-width: 769px) {
      /* 桌面:还原 inline 下拉直接操作 */
      #switchToggle.swap-btn { display: none; }
  }
  ```

- [ ] **7.5 client.js inlineInput 输入属性成套。** 在 `client.js:197` inlineInput 创建后追加(已有 autocomplete/autocorrect/autocapitalize/spellcheck):
  ```js
          inlineInput.setAttribute('enterkeyhint', 'send');
          inlineInput.setAttribute('inputmode', 'text');
  ```

- [ ] **7.6 client.js setupVisualViewport + setupSwitchSheet + 调用。** 在 init() 内新增两函数(Task 4 已加 SwitchSheet UMD,此处 setupSwitchSheet 是 client.js 内联交互绑定,与 switch_sheet.cjs 的 createSwitchSheet 配合——实际项目用其一即可;此处采用 Task 4 的 createSwitchSheet 路径,setupSwitchSheet 仅做触发器 aria 初始化兜底):
  ```js
          /**
           * 软键盘 visualViewport 适配:resize/scroll → --vh-available 应用 #app。
           * visualViewport 不可用(旧浏览器/桌面)回退 100dvh(CSS var 兜底)。
           */
          function setupVisualViewport() {
              const vv = window.visualViewport;
              const app = document.getElementById('app');
              if (!vv || !app) return;
              const apply = () => {
                  app.style.setProperty('--vh-available', `${Math.round(vv.height)}px`);
              };
              vv.addEventListener('resize', apply);
              vv.addEventListener('scroll', apply);
              apply();
          }
          /**
           * 切换触发器 aria 初始化(switch_sheet.cjs createSwitchSheet 在 Task 4 接入时已设)。
           */
          function setupSwitchSheet() {
              const toggle = document.getElementById('switchToggle');
              if (toggle) {
                  toggle.setAttribute('aria-haspopup', 'dialog');
                  toggle.setAttribute('aria-expanded', 'false');
              }
          }
  ```
  在 `ensureTerminalView();`(约 :848)之后调用:
  ```js
          ensureTerminalView();
          setupVisualViewport();
          setupSwitchSheet();
          bindInlineInput();
  ```
  > 注:Task 4.11 已接入 createSwitchSheet 的 click/装配;若两处重复,以 Task 4 的 createSwitchSheet 为准,本步 setupSwitchSheet 仅做幂等 aria 初始化。

- [ ] **7.7 client.js focusInput rAF scrollIntoView。** 替换 focusInput(原 :529-538):
  ```js
          const prefersReducedMotion = () =>
              window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const focusInput = () => {
              if (!isConnected || inputEl.disabled) return;
              inputEl.focus({ preventScroll: true });
              requestAnimationFrame(() => {
                  try {
                      inputEl.scrollIntoView({ block: 'end', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                  } catch (e) {}
              });
          };
          contentEl.addEventListener('click', focusInput);
          viewEl.addEventListener('click', focusInput);
          viewEl.addEventListener('touchend', () => { setTimeout(focusInput, 0); }, { passive: true });
  ```

- [ ] **7.8 client.js updateConnectionStatus + updateSessionUi 同步 meta/live。** updateConnectionStatus(约 :144)同步 live 点文本(原 #connectionStatus 引用保留防御性判空);updateSessionUi(约 :628)同步 metaSession/metaProject:
  ```js
      function updateConnectionStatus(connected) {
          if (connectionStatus) {
              connectionStatus.textContent = connected ? '已连接' : '未连接';
              connectionStatus.classList.toggle('connected', connected);
          }
          const liveText = document.querySelector('.live-dot-text');
          if (liveText) liveText.textContent = connected ? 'live' : '未连接';
          if (terminalInputEl) terminalInputEl.disabled = !connected;
      }
  ```
  ```js
      function updateSessionUi() {
          if (terminalHeaderEl) {
              const titleEl = terminalHeaderEl.querySelector('.terminal-header-title');
              if (titleEl) titleEl.textContent = currentSession ? `Session: ${currentSession}` : 'Roc-CC Remote Control';
          }
          const metaSession = document.getElementById('metaSession');
          if (metaSession) {
              metaSession.textContent = currentSession
                  ? (currentSession.replace(/[^0-9]/g, '').padStart(2, '0') || '—') : '—';
          }
          const metaProject = document.getElementById('metaProject');
          if (metaProject) {
              const entry = Array.isArray(cachedSessions) ? cachedSessions.find(s => s && s.name === currentSession) : null;
              metaProject.textContent = (entry && entry.cwd) ? entry.cwd : '—';
          }
          if (sessionSelect && currentSession) sessionSelect.value = currentSession;
      }
  ```
  > 若 `connectionStatus` 现有声明指向已删 DOM,把顶部 `const connectionStatus = document.getElementById('connectionStatus');` 改为 `const connectionStatus = document.getElementById('connectionStatus'); // 可能 null(live 点承载)` —— 判空已覆盖。

- [ ] **7.9 multi_line_input.js 同步 --vh-available(跨领域风险)。** 修改 `public/modules/multi_line_input.js:65`,把 `100vh` 改读 visualViewport 高度(回退 100vh):
  ```js
          // 同步 --vh-available:软键盘弹起时按 visualViewport 可用高度收缩,避免输入区被挤
          const vh = (window.visualViewport && window.visualViewport.height)
              ? window.visualViewport.height
              : window.innerHeight;
          this.#terminalView.style.maxHeight = `calc(${vh}px - ${totalInputHeight}px)`;
  ```

- [ ] **7.10 跑全量测试 + grep。** `npm test` → 全 PASS。grep:
  - `grep -rn 'enterkeyhint\|inputmode' public/` → client.js(send/text)+ login.html(go/text)命中
  - `grep -rn 'min-height: 44' public/style.css public/dashboard.css` → .stop-btn/.quick-reply-btn/.swap-btn/.switch-sheet-btn/.nav-link/.session 命中

- [ ] **7.11 人眼/真机验证(5 种键盘状态)。** iPhone Safari 390×844:聚焦输入框不被键盘遮挡(visualViewport);切换 sheet 弹出/Esc 关/Tab 循环;桌面 ≥769 inline 控件显示;header brand 行 + live 点。

- [ ] **7.12 commit。**
  ```bash
  git add public/index.html public/client.js public/modules/multi_line_input.js public/style.css
  git commit -m "feat(ios): header 重排 + visualViewport 软键盘 + 触摸44pt + 输入属性成套 + multi_line_input 同步"
  ```

---

## Task 8: 可达性(reduced-motion / focus-visible / aria / toast)

> **依赖:** Task 1-7。spec §9:全站 `:focus-visible`、reduced-motion 降级、toast aria-live 按 type、容器 aria-live。本 Task 收口 grep 硬门 + 单测。

**Files:**
- Modify: `public/modules/toast_manager.js`(:35-43)
- Create: `test/a11y_motion_focus.test.cjs`
- Create: `test/input_attrs.test.cjs`

**Steps:**

- [ ] **8.1 toast_manager.js 按 type 切 aria-live。** 替换 `:35-43` show() 内 el 属性设置:
  ```js
          const el = document.createElement('div');
          el.className = `toast toast-${type}`;
          el.setAttribute('role', type === 'error' ? 'alert' : 'status');
          el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
          el.style.top = `${top}px`;
          el.style.width = `${this.#toastWidth}px`;
          el.style.height = `${height}px`;
          el.style.lineHeight = `${this.#toastLineHeight}px`;
          el.textContent = message;
  ```

- [ ] **8.2 写测试 a11y_motion_focus.test.cjs(RED→GREEN,部分已在 Task 3 落地,本 Task 收口断言)。** 新建:
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const fs = require('node:fs');
  const style = fs.readFileSync('public/style.css', 'utf8');
  const dash = fs.readFileSync('public/dashboard.css', 'utf8');

  test('style.css 无裸 outline:none(基类)', () => {
      // 允许 :focus 内 outline:none(装饰隐藏),不允许基类裸 outline:none
      // 注:此正则为启发式(先剥 :focus 块再查裸 outline),对复杂选择器边界可能漏判;最终以 Task 8.4 的 grep 'outline: ?none' + 人眼复核为准(仅 :focus 内允许)
      assert.ok(!/^[^{}]*\\{[^}]*outline:\\s*none/m.test(style.replace(/:focus[^{]*\\{[^}]*outline:\\s*none/g, '')));
  });
  test('style.css 含 :focus-visible', () => {
      assert.ok(style.includes(':focus-visible'));
  });
  test('reduced-motion 块含 animation:none(style.css)', () => {
      const m = style.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}/g) || [];
      const merged = m.join('\\n');
      assert.ok(/animation:\s*none/.test(merged));
  });
  test('reduced-motion 覆盖 waiting 脉冲(dashboard.css)', () => {
      const m = dash.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}/g) || [];
      assert.ok(/s-dot--waiting[\s\S]*animation:\s*none/.test(m.join('\\n')));
  });
  test('toast_manager.js 按 type 切 aria-live', () => {
      const tm = fs.readFileSync('public/modules/toast_manager.js', 'utf8');
      assert.ok(/type === 'error' \? 'alert' : 'status'/.test(tm));
      assert.ok(/type === 'error' \? 'assertive' : 'polite'/.test(tm));
  });
  ```
  新建 `test/input_attrs.test.cjs`:
  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const fs = require('node:fs');
  test('client.js inlineInput 输入属性成套', () => {
      const js = fs.readFileSync('public/client.js', 'utf8');
      assert.ok(/setAttribute\('enterkeyhint',\s*'send'\)/.test(js));
      assert.ok(/setAttribute\('inputmode',\s*'text'\)/.test(js));
  });
  test('login.html token 输入属性成套', () => {
      const html = fs.readFileSync('public/login.html', 'utf8');
      assert.ok(/enterkeyhint="go"/.test(html));
      assert.ok(/autocomplete="off"/.test(html));
      assert.ok(/autocapitalize="none"/.test(html));
  });
  ```
- [ ] **8.3 跑测试。** `npm test` → 全 PASS(Task 3/6/7 已落地大部分,本 Task 收口)。若 FAIL,补对应实现(裸 outline 残留/reduced-motion 缺失/toast 未切)。

- [ ] **8.4 grep 验收硬门。**
  - `grep -rn 'outline: *none' public/style.css public/login.html` → 仅允许在 `:focus` 内(基类为空)
  - `grep -rn 'focus-visible' public/` → style.css/dashboard.css/login.html 命中
  - `grep -rn 'prefers-reduced-motion' public/` → style.css + dashboard.css
  - `grep -n 'aria-live' public/index.html` → #toast-container polite + .live-dot polite
  - `grep -n 'aria-haspopup' public/index.html` → #switchToggle dialog

- [ ] **8.5 commit。**
  ```bash
  git add public/modules/toast_manager.js test/a11y_motion_focus.test.cjs test/input_attrs.test.cjs
  git commit -m "feat(a11y): toast aria-live 按 type + reduced-motion/focus-visible 收口断言"
  ```

---

## Task 9: 作废标注 + 全量验收 grep + 真机

> **依赖:** Task 1-8。spec §10/§11:作废 ios-mobile-support spec 的 badge/深色 MVP-1 项;跑全量 grep 硬门;真机对照 mockup。

**Files:**
- Modify: `docs/superpowers/specs/2026-06-28-ios-mobile-support-design.md`(顶部加标注)

**Steps:**

- [ ] **9.1 加作废标注。** 在 `docs/superpowers/specs/2026-06-28-ios-mobile-support-design.md` 顶部(标题下、第一个 `---` 前)插入:
  ```markdown
  > ⚠️ **部分作废:** 本 spec 中的「badge 深色变体」与「深色 badge/waiting 视觉」MVP-1 项,已被 [`2026-06-29-ios-editorial-redesign-design.md`](./2026-06-29-ios-editorial-redesign-design.md) **砍深色 + 废 badge** 双重取代,在此声明作废。其余 iOS 适配项(viewport/safe-area/PWA/止损键/快速回复)仍有效。
  ```

- [ ] **9.2 跑全量验收 grep(spec §11)。** 逐条跑,预期全部空输出或命中预期:
  ```bash
  # 1. 无旧令牌(含 JS、modules)
  grep -rE '\-\-(brand|brand-strong|text|muted|font|surface2|r-lg)\b' public/ --include='*.css' --include='*.html' --include='*.js' | grep -v tokens.css
  # 预期:空

  # 2. 无深色 media
  grep -rn 'prefers-color-scheme' public/ --include='*.css'
  # 预期:空

  # 3. 无琥珀硬编码
  grep -rnE '212, *165, *116|212,165,116' public/
  # 预期:空

  # 4. serif 引用点 ≤3 类
  grep -rn 'var(--serif)' public/ --include='*.css' --include='*.html'
  # 预期:welcome-message p、login .lede、dashboard .state-message .lede(3 处,符合)

  # 5. 触摸目标 min-height:44 全覆盖
  grep -rn 'min-height: 44' public/*.css
  # 预期:.stop-btn/.quick-reply-btn/.swap-btn/.switch-sheet-btn/.nav-link/.session/.btn-primary/.btn-ghost

  # 6. 无裸 outline:none 基类
  grep -rn 'outline: *none' public/style.css public/login.html
  # 预期:仅 :focus 内(基类空)
  ```

- [ ] **9.3 跑全量测试。** `npm test` → 全 PASS(原有 + 新增 tokens/session_switch/switch_sheet/dashboard_render/a11y_motion_focus/input_attrs/login_paste)。

- [ ] **9.4 真机对照清单(spec §11)。** iPhone Safari(390×844)+ 加主屏 standalone:
  - 三页视觉与 mockup 一致
  - 暖橙 #d9651a(--accent)不出现在 ≤14px 文字/图标/按钮字/focus 环(人工审查)
  - 桌面宽屏(≥769px)header 不退化(下拉直接可操作)
  - 软键盘 5 种状态(聚焦/失焦/拼音/表情/第三方键盘)输入框不被遮挡
  - 状态点 4 色 + unknown 虚线;waiting 脉冲 + 左边框;每卡同时含 .s-dot 与 .s-status
  - reduced-motion(macOS 减少动态效果):脉冲点静止、toast 无滑入
  - toast/palette 浮层在 #f2f1ed 底色下浮起可辨
  - **toast aria-live 容器(polite)+ 子(error assertive)嵌套**:VoiceOver 播报行为核查(若异常,降级:容器去 aria-live 仅子声明——记为可选回退)

- [ ] **9.5 commit。**
  ```bash
  git add docs/superpowers/specs/2026-06-28-ios-mobile-support-design.md
  git commit -m "docs: 作废 ios-mobile-support 的 badge/深色 MVP-1 项 + editorial 重设计全量验收"
  ```

---

## Self-Review(plan 自查结果)

**spec coverage(spec §4-§12 逐条 → Task):**
- §4.1 新令牌 + 双语义 → Task 1(令牌)+ Task 2(组件区)
- §4.2 旧→新迁移映射(含 client.js:267/269)→ Task 1
- §4.3 硬编码琥珀清理 → Task 1(style.css:115/login:66)+ Task 3(:405 绿)
- §5 砍深色(theme-color/manifest/@media)→ Task 1
- §6 组件系统(brand mark/btn/s-dot/eyebrow,追加 tokens.css 末尾)→ Task 2
- §7.1 终端(header 重排/切换 sheet/❯着色/stop/quick-reply/welcome)→ Task 3(CSS)+ Task 4(sheet JS)+ Task 7(index.html DOM)
- §7.2 看板(badge→双编码/waiting 高亮/mono meta/serif 空状态)→ Task 5
- §7.3 登录(brand mark/eyebrow/serif lede/token 输入/粘贴)→ Task 6
- §8 iOS(viewport 已有/visualViewport/44pt/字号16/输入属性)→ Task 7(+ multi_line_input 同步)
- §9 可达性(对比度/reduced-motion/focus-visible/aria/触摸)→ Task 2(对比度令牌)+ Task 3(focus-visible)+ Task 8(收口)
- §10 作废声明 → Task 9
- §11 验收 → Task 9(grep + 真机)
- §12 风险 → 各 Task risks 已内化(见下)

**placeholder scan:** 已搜 TBD/TODO/「类似」/「适当」——plan 内无残留;所有代码块为完整可落地代码(取自专家 changes.newCode,经 plan 编排去重 + 类型一致化)。

**type consistency:**
- 令牌名统一:`--accent-2`(非 --accent2)、`--surface-2`(非 --surface2)、`--fg-2/--fg-3`、`--accent-dim/--accent-bg`、`--waiting #c08532`。
- 函数名:`switchSession`(session_switch.cjs)、`handleTabTrap/shouldCloseOnKey/buildSessionItems/createSwitchSheet`(switch_sheet.cjs)、`setupVisualViewport/setupSwitchSheet`(client.js)、`renderSession/renderSessionList/renderState`(dashboard_render.cjs)。
- 类名:`.s-dot--waiting/--working/--errored/--idle/--unknown`、`.s-status`、`.s-name/.s-meta/.s-id/.s-main`、`.quick-reply-btn--primary`、`.brand-mark--sm/--md/--lg`、`.btn-primary/.btn-ghost`、`.session.waiting`、`.live-dot/.live-dot-pulse/.live-dot-text`。
- DOM id:`switchToggle`/`switchSheet`/`metaSession`/`metaProject`/`liveIndicator`/`pasteBtn`/`desktopControls`——跨 Task 一致(Task 4 sheet 用通用 createSwitchSheet,Task 7 提供 switchToggle 锚点)。

**任务边界无重叠、依赖顺序正确:** Task 1(tokens)先于一切 → Task 2(组件区)先于 3/5/6 → Task 3(style.css)先于 4(sheet JS 接入需 quick-reply 工厂改类)→ Task 5/6 并行(看板/登录独立)→ Task 7(index.html header 依赖 Task 3 CSS + Task 4 sheet)→ Task 8 收口 → Task 9 验收。

**残留风险(真机验证项,不阻塞):**
- toast aria-live 容器 polite + 子 error assertive 嵌套,VoiceOver 可能不一致 → Task 9.4 标真机验证,降级方案已备(容器去 aria-live)。
- visualViewport resize/focus 时机在部分 iOS 版本可能跳动 → Task 9.4 五种键盘状态测。
- --muted→--fg-2 默认兜底,style.css 11 处未逐处细分 fg-3(对比度都达 AA,只影响层级质感)→ 可后续 polish。

