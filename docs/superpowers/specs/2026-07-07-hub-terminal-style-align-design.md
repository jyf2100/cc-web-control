# 7685 Hub 终端风格对齐 7684 浅色 Editorial — 设计规格

> **状态:** 待实现(spec 已审,方案 2 已用户选定)
> **日期:** 2026-07-07
> **分支:** `feat/hub-terminal-style-align`
> **关联:** 用户请求「7685 的终端样式风格和 7684 的对齐」;`preview-terminal-align.html` 为本次设计预览

## 1. 背景

cc-web-control 两个前端:
- **7684 单机**:`public/index.html` + `public/style.css`(浅色 editorial)
- **7685 hub**:`public/console.html` + `public/dashboard.css`

7685 的终端区(`.console-term` / `#term-screen` / `#ma-screen`)用独立令牌 `--term-bg:#1a1815` / `--term-fg:#e8e6df`,渲染为**深色**终端屏;而页面其余部分(topbar / hero / 看板)是浅色 editorial。深色终端屏嵌在浅色页面中,边缘硬拼接,视觉突兀,与 7684 单机版终端(浅色、与页面融为一体)风格不一致。

**7684 终端**(`style.css` `.terminal-*` 体系,目标基准):
- `.terminal-content` 背景 `var(--surface)`(#ebeae5 暖灰米)、文字 `var(--fg)`(#26251e 暖黑)、mono `12.5px / line-height 1.65`
- `.terminal-header` / `.terminal-input-row` 有 `var(--surface-2)` 层次底
- `.terminal-prompt` 暖橙 `❯`(`client.js:234` `prompt.textContent = '❯'`)

**7685 终端**(`dashboard.css` `.console-term` 体系,待对齐):
- `#term-screen` / `#ma-screen` 背景 `var(--term-bg)` `#1a1815`、文字 `var(--term-fg)` `#e8e6df`、`.8em`、无 `line-height`
- `.term-header` / `.term-input-form` **无显式背景**(裸白,与深色屏硬拼接)
- 无输入提示符

## 2. 目标 / 非目标

**目标:**
- 7685 终端区(含 `#term-screen`、`#ma-screen`、输入行)视觉风格对齐 7684 浅色 editorial:暖灰米底 + 暖黑字 + 暖橙 `❯` 提示符 + 统一字号 / 行高 / 层次
- 保留 7685 多机专属功能(全屏 / 折叠 / fleet / hero / ma-screen / 终端输入)
- 不影响看板(`dashboard.html`)与 7684(`index.html`)

**非目标:**
- 不改变 7685 终端的交互范式(`#term-screen` 仍是 tmux 镜像 `<pre>` 屏,不改为 7684 的对话流 `.messages`)
- 不重命名 class / 不重构 DOM 结构(方案 3「深度改」已否决)
- 不调整 topbar / hero / 看板卡片样式

## 3. 现状与隔离分析

`dashboard.css` 被 `console.html` 与 `dashboard.html` 共用,但本次涉及的选择器**仅在 `console.html`**:

| 选择器 | `dashboard.html` 是否含 | 结论 |
|---|---|---|
| `.console-app`(`--term-*` 令牌定义点) | 否(根容器是 `#app`) | 改令牌只影响 console |
| `#term-screen` / `.console-term` / `#ma-screen` | 否(`grep` 确认) | 改这些只影响 console |
| `.term-input`(class)+ `#fanout-input`(看板扇出) | 是,但与 `#term-input`(id)选择器不冲突 | 互不干扰 |

- `index.html` / `style.css` 为独立文件,零影响。
- `console.js` 不依赖新增的 `.term-prompt`,且 `#term-input` 选择器不变 → **JS 零改动**。

## 4. 设计(方案 2 中等改)

### 4.1 `public/dashboard.css`

| 选择器(近似行号) | 现状 | 改为 |
|---|---|---|
| `.console-app`(~132) | `--term-bg:#1a1815; --term-fg:#e8e6df;` | `--term-bg:var(--surface); --term-fg:var(--fg);`(`--waiting-bg` 保留) |
| `.term-header`(~219) | 无背景 | 补 `background:var(--surface-2);` |
| `.term-input-form`(~230) | 无背景,`gap:6px` | 补 `background:var(--surface-2);`,`gap:8px` |
| `#term-screen`(~229) | `font-size:.8em; padding:8px 12px;` | `font-size:12.5px; line-height:1.65; padding:12px 14px;` |
| `#ma-screen`(~159) | `font-size:.8em;` + 令牌驱动底色 | 令牌浅化自动生效;补 `font-size:12.5px; line-height:1.65;` |
| `#term-input`(~231) | 仅 `font-size:16px;` | 补 `font-family:var(--mono); color:var(--fg); background:transparent; border:none;` |
| `.console-term[data-fullscreen="true"] #term-screen`(~243) | `font-size:.9em` | `font-size:14px;`(基准改 px 后同步) |
| **新增** `.term-prompt` | — | `color:var(--accent-2); font-weight:600; font-family:var(--mono); font-size:14px; user-select:none; flex-shrink:0;` |

### 4.2 `public/console.html`(`.term-input-form`,52–54 行)

`<input id="term-input">` 之前插入一个提示符:

```html
<span class="term-prompt" aria-hidden="true">❯</span>
```

最终 `.term-input-form` 形如:

```html
<form id="term-input-form" class="term-input-form">
  <span class="term-prompt" aria-hidden="true">❯</span>
  <input id="term-input" class="term-input" placeholder="输入(Enter 发送)…" aria-label="指令输入(Enter 发送给当前被控)" autocomplete="off" />
</form>
```

## 5. 边界态

- **全屏**(`.console-term[data-fullscreen="true"]`):`--term-*` 浅化后全屏 `#term-screen` 自动浅色;`~242` 顶栏 `background:var(--surface)` 已浅,一致。字号 `.9em → 14px` 同步。
- **折叠**(`[data-collapsed="true"]`):`#term-screen` / `.term-input-form` 为 `display:none`,不受影响。
- **`#ma-screen` 浅色化**:多机模式下主 agent 镜像与终端屏统一浅色,消除两块深色突兀区。

## 6. 可访问性(WCAG AA)

| 组合 | 对比度 | 达标 |
|---|---|---|
| `--fg #26251e` on `--surface #ebeae5` | ≈12:1 | AA ✅ |
| `--accent-2 #b54e0e` on `--surface-2 #e3e2dc` | 4.58:1+ | AA ✅ |
| `--fg-2` 次文字 on `--surface` | ~5.4:1 | AA ✅ |
| 输入框 placeholder(`--fg-3`,仅装饰) | — | 不承载需阅读文字(符合 `tokens.css` 注释约定) |

`❯` 提示符 `aria-hidden="true"`(装饰性,不读屏);输入框 `aria-label` 已存(`console.html:53`)。

## 7. 验证

项目无前端渲染单测(`test/*.test.cjs` 为后端逻辑)。验证手段:

1. **功能验证** — 启 7685 hub,访问 `/console.html?m=<machine>&s=<session>`:
   - 终端屏浅色(`#ebeae5` 底 + 暖黑字)
   - 输入框前出现暖橙 `❯`
   - `#ma-screen` 浅色,与终端屏一致
   - 全屏 / 折叠态正常
2. **隔离回归**:
   - `grep` 确认 `#term-screen` / `.console-term` / `#ma-screen` / `.console-app` 仍仅出现在 `console.html`
   - 访问 `/dashboard.html` 看板:扇出输入、会话卡片样式不变
   - 访问 7684 `/?session=...`:终端样式不变
3. **可选** — playwright before/after 截图(若 `file://` 沙箱限制解除,或起本地 http 服务)。

## 8. 风险

- **低**:改动集中在 2 文件、~20 行 CSS + 1 个 `<span>`,选择器隔离明确,无逻辑变更。
- **回归面**:仅 `console.html` 终端区;看板 / 7684 由选择器隔离保护。
- **px vs em**:改 `px` 后移动端缩放需确认(`#term-input` 锁 `16px` 已存,不受影响;`#term-screen` 非输入元素,无 iOS 聚焦放大问题)。

## 9. 文件清单

- 修改:`public/dashboard.css`(8 处选择器)
- 修改:`public/console.html`(1 处,加 `<span class="term-prompt">`)
- 新增(本 spec):`docs/superpowers/specs/2026-07-07-hub-terminal-style-align-design.md`

## 10. 未做 / 可选后续

- 若后续希望终端屏可切深色(只浅色化周边),可加 `[data-theme="dark"]` 或保留 `--term-*` 可切换 — 非本次范围。
- `preview-terminal-align.html`(本次设计预览)为临时产物,不入库;实现完成后可删。
