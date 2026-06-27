# cc-web-control 整站界面重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 cc-web-control 三页(控制台 / 看板 / 登录)统一重设计为方向 A 琥珀精修,共享单一设计令牌源(tokens.css),浅色默认 + 深色跟随系统,后端零改动。

**Architecture:** 新建 `public/tokens.css` 作为全站令牌单一事实来源(`:root` 浅色 + `@media (prefers-color-scheme: dark)` 深色)。三页 CSS(style.css / dashboard.css / login.html 内联)改为 @import / link tokens.css 并消费变量。控制台与看板 header 加统一胶囊导航;登录页保持居中卡片(登录前无导航语义)。client.js / dashboard.js 的 DOM 锁定 id/class 全程保留不重命名。

**Tech Stack:** 纯静态 HTML/CSS(CSS 自定义属性),Express(`server.cjs`)服务 `public/` 静态文件,端口 7684。无构建步骤,无 JS 框架。后端测试:`node --test test/*.test.cjs`(10 个测试文件)。

**关于 TDD 的诚实说明:** 本计划是纯 CSS/HTML 重设计,没有可单元测试的行为函数(plan-eng-review 已确认)。传统 TDD(写失败测试 → 实现)不适用。每个任务用**验证步骤**替代:浏览器 DevTools 确认令牌应用、grep 锁定清单、后端测试套件跑通、真机/深色目检。这不是偷懒,是 CSS 没有可测行为这一事实的诚实处理。

**硬约束(DOM 锁定清单,绝不重命名):** 这些 id/class 被 client.js / dashboard.js 通过 `getElementById` / `className` 操纵。改名 = WebSocket 终端镜像或看板渲染立即断裂。

client.js(id):
`messages`、`connectionStatus`、`chatContainer`、`sessionSelect`、`refreshSessions`、`projectControl`、`projectSelect`、`startProject`、`logoFallback`(logoFallback 在 index.html 内联 onerror 里)

client.js(class,JS 创建/切换):
`connected`、`terminal-view`、`terminal-header`、`terminal-content`、`terminal-input-row`、`terminal-prompt`、`terminal-inline-input`、`terminal-inline-textarea`、`terminal-line`、`welcome-message`

dashboard.js(id):
`title`、`sessionList`、`stateMessage`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `public/tokens.css` | 新建 | 全站设计令牌单一来源(颜色/状态/字体/圆角,浅+深双主题) |
| `public/style.css` | 改 | 控制台样式:删 50+ 硬编码色,`@import tokens.css`,组件用变量,合并两处 dark 块 |
| `public/index.html` | 改 | 控制台:header 加统一胶囊导航,保留 client.js 锁定清单 |
| `public/login.html` | 改 | 登录:内联 `<style>` 改 link tokens.css + 极简样式,消费变量 |
| `public/dashboard.css` | 改 | 看板:硬编码色 → 变量,加胶囊导航样式 |
| `public/dashboard.html` | 改 | 看板:返回链接升级为胶囊导航,保留 dashboard.js 锁定清单 |
| `public/mockups/` | 删 | 临时 mockup,选型完成,实施验证后清理 |

---

### Task 1: 新建 tokens.css(令牌单一来源)

**Files:**
- Create: `public/tokens.css`

- [ ] **Step 1: 写 tokens.css 完整内容**

创建 `public/tokens.css`,内容如下(值来自 spec 第 3 节,已批准):

```css
/**
 * cc-web-control 设计令牌(单一事实来源)
 * 方向 A 琥珀精修。三页共用。浅色默认 + 深色跟随系统。
 */

:root {
  /* 颜色(浅色,默认) */
  --bg: #ffffff;
  --surface: #faf7f2;
  --surface2: #f3ece0;
  --border: #ece2d1;
  --text: #1a1a1a;
  --muted: #8a7f6f;
  --brand: #d4a574;
  --brand-strong: #c08e54;

  /* 状态色(5 状态徽章,浅深色共用,三重编码) */
  --waiting: #f59e0b;
  --working: #d4a574;
  --idle: #b8ad9a;
  --errored: #ef4444;

  /* 字体 */
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono: 'SF Mono', ui-monospace, Menlo, monospace;

  /* 圆角 */
  --r: 12px;
  --r-sm: 8px;
  --r-lg: 14px;

  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* 颜色(深色,暖调,替换原 style.css 冷蓝暗色) */
    --bg: #1c1815;
    --surface: #251f1a;
    --surface2: #2e2620;
    --border: #3d342b;
    --text: #f2ebe0;
    --muted: #a89b88;
    --brand: #d4a574;
    --brand-strong: #e6b785;
  }
}
```

- [ ] **Step 2: 临时验证令牌生效**

创建临时检查页 `public/_tokencheck.html`(验证后删):

```html
<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="tokens.css">
<style>body{background:var(--bg);color:var(--text);font-family:var(--font);padding:24px}
.s{display:inline-block;width:70px;height:40px;border:1px solid var(--border);border-radius:var(--r-sm);margin:4px;text-align:center;line-height:40px;font-size:11px}
</style></head><body>
<div class="s" style="background:var(--surface)">surface</div>
<div class="s" style="background:var(--surface2)">surface2</div>
<div class="s" style="background:var(--brand);color:#fff">brand</div>
<div class="s" style="background:var(--brand-strong);color:#fff">strong</div>
<div class="s" style="background:var(--waiting);color:#fff">waiting</div>
<div class="s" style="background:var(--errored);color:#fff">err</div>
</body></html>
```

浏览器开 `http://localhost:7684/_tokencheck.html`,确认 6 个色块显示。macOS 系统设置 → 外观 → 深色,刷新,确认色块变暖调深色(bg 暖黑,brand 不变)。

- [ ] **Step 3: 删临时检查页**

```bash
rm public/_tokencheck.html
```

- [ ] **Step 4: Commit**

```bash
git add public/tokens.css
git commit -m "feat: 新建 tokens.css 设计令牌单一来源(浅+深双主题)"
```

---

### Task 2: style.css 重构为令牌(控制台)

**Files:**
- Modify: `public/style.css`(541 行)

- [ ] **Step 1: 顶部 @import tokens.css**

在 `public/style.css` 最顶部(第 1 行注释块 `/** ... */` 之后、`* {}` 之前)加一行。`@import` 必须先于所有其他规则(CSS 规范):

```css
@import url('tokens.css');
```

- [ ] **Step 2: 替换硬编码颜色为令牌**

用编辑器查找替换,按下表把硬编码值换成变量。逐个确认,不要盲替(避免误伤 toast/scrollbar 等特殊值)。行号是当前 style.css 的参考位置,改动后会偏移:

| 硬编码值 | 替换为 | 参考位置 |
|----------|--------|----------|
| `background-color: #ffffff`(body/header/control-input/btn) | `var(--bg)` | 行 16, 32, 104, 119 |
| `color: #1a1a1a`(body/logo/welcome h2) | `var(--text)` | 行 17, 49, 160 |
| `#e5e5e5`(header/status/control 边框) | `var(--border)` | 行 33, 71 |
| `#f8fafc`(terminal-view/content 背景,btn hover) | `var(--surface)` | 行 127, 174, 201 |
| `#eef2f7`(terminal-header/input-row 背景) | `var(--surface2)` | 行 183, 211 |
| `#e5e7eb`(terminal 系列边框) | `var(--border)` | 行 171, 184, 210 |
| `#64748b` / `#666`(control/status/welcome 文本) | `var(--muted)` | 行 67, 92, 155 |
| `#475569`(terminal-prompt) | `var(--muted)` | 行 217 |
| `#94a3b8`(placeholder) | `var(--muted)` | 行 234, 238, 261 |
| `#0f172a` / `#111827`(terminal-content/input 文本,btn 文本) | `var(--text)` | 行 105, 200, 229, 250 |
| `#d4a574`(logo svg/app-logo) | `var(--brand)` | 行 62 |
| `#93c5fd`(control-input focus) | `var(--brand)` | 行 110 |
| `rgba(147, 197, 253, 0.35)`(focus shadow) | `rgba(212, 165, 116, 0.35)`(用 brand 的 rgb) | 行 111 |
| `#22c55e`(status connected color+border) | `var(--working)` | 行 75, 76 |
| `#f0fdf4`(status connected bg) | `var(--surface2)` | 行 77 |
| `#f5f5f5`(status bg) | `var(--surface2)` | 行 69 |
| `#f1f5f9` / `#e0f2fe`(palette hover/selected) | `var(--surface2)` | 行 130, 368, 372 |
| `#0369a1`(palette selected color) | `var(--brand-strong)` | 行 373 |
| `#3b82f6`(toast-info bg) | `var(--waiting)` | 行 319 |

替换后跑 `grep -nE '#[0-9a-fA-F]{3,6}' public/style.css`,应只剩:滚动条 thumb 的 `#d1d5db`/`#9ca3af`(中性灰,保留,滚动条非语义色)、toast/command-palette 的 shadow rgba(保留)。其他裸 hex 都应已令牌化。

- [ ] **Step 3: 合并两处 @media (prefers-color-scheme: dark) 块**

style.css 现有两处 dark 块:行 376-400(toast/command-palette)和 439-541(主体)。令牌现在经 tokens.css 的 `@media` 自动切换,这两块里用令牌的属性已自动跟随。把这两块**整块删除**,替换为下面的精简块(只保留令牌覆盖不到的 shadow):

```css
@media (prefers-color-scheme: dark) {
    .toast {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .command-palette {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
}
```

- [ ] **Step 4: 字体栈替换为令牌**

- 所有 `font-family: 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace`(行 197, 215, 226, 247, 354)替换为 `font-family: var(--mono)`。
- 行 14 的 `font-family: -apple-system, BlinkMacSystemFont, ...` 替换为 `font-family: var(--font)`。
- 行 303 `.toast` 的 font-family 替换为 `var(--font)`。

- [ ] **Step 5: 验证令牌应用 + 深色**

启动服务 `node server.cjs`(或确认已在跑)。浏览器开 `http://localhost:7684/`,F12 → Elements → 选 `<html>` → Computed 面板,确认 `--bg`、`--brand`、`--surface` 等变量已定义。系统切深色,刷新,确认控制台变暖调深色(bg 暖黑 #1c1815 系,不是原冷蓝 #0d1117)。

- [ ] **Step 6: 终端镜像回归(锁定清单功能性验证)**

控制台连一个 tmux 会话,在终端面板底部输入框打字回车,确认 Claude Code 有响应。这一步验证 client.js 的 DOM 操作(terminal-content / terminal-inline-input 等 class)没被样式改动打断。

- [ ] **Step 7: Commit**

```bash
git add public/style.css
git commit -m "refactor: style.css 重构为令牌系统,合并 dark 块"
```

---

### Task 3: index.html 加统一胶囊导航

**Files:**
- Modify: `public/index.html`(header-actions 区域,行 29-43)
- Modify: `public/style.css`(末尾加 nav 样式)

- [ ] **Step 1: header-actions 里加胶囊导航**

在 `public/index.html` 的 `<span id="connectionStatus" ...>` 之后、`</div>`(header-actions 闭合,行 43)之前,插入:

```html
                <nav class="nav">
                    <a class="nav-link cur" href="/">控制台</a>
                    <a class="nav-link" href="/DASHURL">看板</a>
                    <a class="nav-link" href="/login">登录</a>
                </nav>
```

把 `/DASHURL` 替换为看板实际路径。看板 slug 由 `dashboard_slug.cjs` 决定,实施前先确认:在 server 运行时看实际路由,或读 `dashboard_slug.cjs` 看默认 slug。不要保留 `/DASHURL` 字面量。

**不要动** `.controls`、`#sessionSelect`、`#refreshSessions`、`#projectControl`、`#projectSelect`、`#startProject`、`#connectionStatus` 任何一个。

- [ ] **Step 2: style.css 末尾加 nav 样式**

```css
/* 统一胶囊导航(控制台 + 看板共用样式,DRY 违反待 P3 components.css 合并) */
.nav {
    display: flex;
    gap: 2px;
    background: var(--surface2);
    border-radius: var(--r-sm);
    padding: 3px;
}

.nav-link {
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    text-decoration: none;
    color: var(--muted);
}

.nav-link.cur {
    background: var(--bg);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 3: 验证导航 + 锁定清单 grep**

浏览器开控制台,确认 header 右侧出现胶囊导航(控制台高亮)。点"看板"/"登录"跳转正常。系统切深色,导航胶囊跟随。

锁定清单 grep(id 必须全在 index.html):

```bash
for id in messages connectionStatus chatContainer sessionSelect refreshSessions projectControl projectSelect startProject logoFallback; do
  grep -q "id=\"$id\"" public/index.html && echo "OK: $id" || echo "FAIL: $id"
done
```

Expected: 全部 OK。任何 FAIL = 停下,恢复该 id。

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: 控制台 header 加统一胶囊导航"
```

---

### Task 4: login.html 消费令牌

**Files:**
- Modify: `public/login.html`(行 8-20 内联 `<style>`,行 23 card 内)

登录页保持居中卡片设计,**不加**胶囊导航(登录前无导航语义;spec 第 4 节的"统一 header"对登录页体现为令牌统一,而非物理 header)。

- [ ] **Step 1: 替换 `<head>` 里的 style 块**

把 login.html 行 8-20 的 `<style>...</style>` 整块替换为:

```html
  <link rel="stylesheet" href="tokens.css">
  <style>
    body { font-family: var(--font); margin: 0; padding: 24px; background: var(--bg); color: var(--text); }
    .card { max-width: 340px; margin: 8vh auto; padding: 28px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); text-align: center; }
    .card .logo-mark { width: 44px; height: 44px; margin: 0 auto 14px; border-radius: 9px; background: var(--brand); color: #fff; font-weight: 700; font-size: 17px; display: flex; align-items: center; justify-content: center; }
    h1 { margin: 0 0 4px; font-size: 17px; }
    p { margin: 0 0 20px; font-size: 12px; color: var(--muted); line-height: 1.45; }
    label { display: block; margin-top: 14px; font-size: 13px; color: var(--muted); text-align: left; }
    input { width: 100%; margin-top: 8px; padding: 11px 14px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 14px; box-sizing: border-box; }
    input:focus { border-color: var(--brand); outline: none; }
    button { width: 100%; margin-top: 14px; padding: 11px; border-radius: var(--r-sm); border: 1px solid var(--brand); background: var(--brand); color: #fff; font-size: 14px; cursor: pointer; }
    .hint { font-size: 12px; color: var(--muted); }
    .error { margin-top: 12px; color: var(--errored); }
  </style>
```

- [ ] **Step 2: card 顶部加 logo 方块**

把 login.html `<div class="card">`(行 23)之后、`<h1>`(行 24)之前,插入:

```html
    <div class="logo-mark">cc</div>
```

- [ ] **Step 3: 验证登录页**

浏览器开 `http://localhost:7684/login`,确认:居中卡片、cc logo 方块(琥珀底白字)、令牌输入框、登录按钮(琥珀底)。系统切深色,确认登录卡变暖调深色,文字可读,输入框边框可见。

- [ ] **Step 4: Commit**

```bash
git add public/login.html
git commit -m "refactor: login.html 消费 tokens.css 令牌,加 logo mark"
```

---

### Task 5: dashboard.css/html 对齐令牌 + 胶囊导航

**Files:**
- Modify: `public/dashboard.css`(硬编码色 → 变量,加 nav 样式)
- Modify: `public/dashboard.html`(返回链接升级为胶囊导航)

- [ ] **Step 1: dashboard.css 顶部 @import**

在 `public/dashboard.css` 第 3 行(注释块后、`* {}` 前)加:

```css
@import url('tokens.css');
```

- [ ] **Step 2: 替换 dashboard.css 硬编码**

按下表替换(行号参考):

| 硬编码值 | 替换为 | 参考位置 |
|----------|--------|----------|
| `background-color: #ffffff`(body/header) | `var(--bg)` | 行 16, 31 |
| `background-color: #ffffff`(session-row) | `var(--surface)` | 行 88 |
| `color: #1a1a1a`(body/session-name/state-message strong) | `var(--text)` | 行 17, 143, 188 |
| `color: #666`(link/session-meta/preview/state-message) | `var(--muted)` | 行 59, 152, 163, 182 |
| `border: 1px solid #e5e5e5`(header/session-row) | `var(--border)` | 行 32, 89 |
| `background-color: #f5f5f5`(link hover) | `var(--surface2)` | 行 66 |
| `border-color: #d4a574`(session-row hover) | `var(--brand)` | 行 94 |
| `color: #9ca3af`(preview arrow) | `var(--muted)` | 行 169 |
| `#ccc`(badge--unknown dashed) | `var(--border)` | 行 114 |
| `#4b5563`(badge--idle color) | `var(--muted)` | 行 113 |
| `#f3f4f6`(badge--idle bg) | `var(--surface2)` | 行 113 |
| font-family(行 14) | `var(--font)` | 行 14 |

**徽章 5 状态的浅色配色保留**(行 110-114:`#fef3c7`/`#7c2d12` 等)。spec 第 5.2 节明确"徽章系统已基本就位",这些是状态语义色,不强改。深色下若对比度不足,后续微调。

- [ ] **Step 3: dashboard.css 末尾加 nav 样式(与 style.css 同款)**

把 Task 3 Step 2 的 `.nav` / `.nav-link` / `.nav-link.cur` 三段样式复制到 dashboard.css 末尾。这是已知的 DRY 违反,记录在 TODOS.md 的 P3"Component class sharing"项,后续 components.css 合并。

- [ ] **Step 4: dashboard.html 返回链接升级为胶囊导航**

把 dashboard.html 行 17-19 的:

```html
            <div class="header-actions">
                <a class="link" href="/">主控制台</a>
            </div>
```

替换为:

```html
            <div class="header-actions">
                <nav class="nav">
                    <a class="nav-link" href="/">控制台</a>
                    <a class="nav-link cur" href="#">看板</a>
                    <a class="nav-link" href="/login">登录</a>
                </nav>
            </div>
```

看板当前页用 `href="#"` + `cur`(已在看板页,无需跳转)。**不要动** `#title`、`#sessionList`、`#stateMessage`(dashboard.js 依赖)。

- [ ] **Step 5: 验证看板页**

浏览器开看板(控制台胶囊点"看板",或直接 URL)。确认:会话卡片、5 状态徽章、hover 琥珀边框、胶囊导航(看板高亮)。系统切深色,看板变暖调深色,徽章可读。

- [ ] **Step 6: Commit**

```bash
git add public/dashboard.css public/dashboard.html
git commit -m "refactor: dashboard 对齐 tokens.css 令牌,加胶囊导航"
```

---

### Task 6: 后端回归 + 锁定清单回归 + 真机 + 清理 mockups

**Files:**
- Run: `node --test test/*.test.cjs`
- Delete: `public/mockups/`

- [ ] **Step 1: 后端测试套件回归**

```bash
node --test test/*.test.cjs
```

Expected: 全部 PASS(10 个文件:dashboard_cache, dashboard_tail, auth, terminal_model, dashboard_slug, claude_launch, pretext_measurer, tmux_actions, virtual_scroll, terminal_cleaner)。本次纯前端改动不应影响后端。任何 FAIL = 停下,对比改动排查(最可能是误改了被测试引用的文件)。

- [ ] **Step 2: 锁定清单 grep 回归**

```bash
# client.js id 必须全在 index.html
for id in messages connectionStatus chatContainer sessionSelect refreshSessions projectControl projectSelect startProject logoFallback; do
  grep -q "id=\"$id\"" public/index.html && echo "OK id: $id" || echo "FAIL id: $id"
done
# client.js class 必须在 style.css 有定义(client.js 用 className= 赋值这些 class)
for cls in connected terminal-view terminal-header terminal-content terminal-input-row terminal-prompt terminal-inline-input terminal-inline-textarea terminal-line welcome-message; do
  grep -q "\.$cls" public/style.css && echo "OK cls: $cls" || echo "FAIL cls: $cls"
done
# dashboard.js id 必须全在 dashboard.html
for id in title sessionList stateMessage; do
  grep -q "id=\"$id\"" public/dashboard.html && echo "OK did: $id" || echo "FAIL did: $id"
done
```

Expected: 全部 OK。任何 FAIL = 该标识符被误改/误删,从 git 恢复。

- [ ] **Step 3: 三页真机 + 深色目检**

经 cloudflared 隧道在手机开三页(控制台 / 看板 / 登录),确认:移动端布局正常(≤640px 看板折叠预览行)、徽章可读、控制台终端可输入发送。桌面系统切深色模式,三页都变暖调深色不破,文字对比度够。

- [ ] **Step 4: 删 mockups**

```bash
git rm -r public/mockups/
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: ui-redesign 收尾,删 mockups,回归通过"
```

---

## Self-Review(写计划后自检)

**1. Spec coverage(spec 各节 → 任务):**
- 第 3 节 设计令牌 → Task 1 ✓
- 第 5.1 节 控制台 + 第 4 节 统一 header → Task 2(样式)+ Task 3(导航)✓
- 第 5.3 节 登录 → Task 4 ✓
- 第 5.2 节 看板 + 第 4 节 header → Task 5 ✓
- 第 6 节 落地范围(tokens.css 新建 / style.css / index.html / login.html / dashboard.* / mockups 清理)→ Task 1-6 全覆盖 ✓
- 第 7 节 YAGNI(无手动主题切换)→ 计划无 [data-theme] JS,深色纯 @media ✓
- 第 8 节 测试(grep 锁定清单 / 后端套件 / 真机深色)→ Task 6 ✓
- 第 9 节 风险(锁定清单改名 / tokens link 漏 / 深色不破)→ Task 2 Step 5-6 / Task 6 Step 2-3 验证 ✓

**2. Placeholder scan:** 无 TBD/TODO/"implement later"。`/DASHURL` 是实施时确认项(明确标注"读 dashboard_slug.cjs 确认,不要保留字面量"),徽章配色明确"保留现状",均为实施确认而非占位。

**3. Type consistency:** 令牌名(`--bg`/`--surface`/`--brand`/`--r-sm` 等)Task 1 定义,Task 2/4/5 全部一致引用。nav class(`.nav`/`.nav-link`/`.nav-link.cur`)Task 3 定义,Task 5 复制同款。锁定清单 id/class 在开头 + Task 3/5/6 一致。
