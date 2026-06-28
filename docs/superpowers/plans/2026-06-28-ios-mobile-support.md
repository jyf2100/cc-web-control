# iOS 手机支持 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 按任务执行。步骤用 checkbox(`- [ ]`)跟踪。每个任务结束前跑该任务的验证步骤 + 全量 `node --test test/*.test.cjs` 确保不回归。

**Goal:** 让 iPhone 能访问 cc-web-control:看多会话状态看板、进控制台发指令回车(轻度操作)、加主屏 PWA 全屏启动。核心场景是"手机上看 agent 跑没跑飞、回答 Claude 的 y/n 提问、必要时 Esc/Ctrl+C 止损",不是在手机上完整操作终端。

**Architecture:** 纯前端改造为主(viewport/软键盘/header/PWA/快捷回复),后端只加 rate-limit middleware + cookie maxAge(抽纯模块),网络复用现有 Cloudflare Tunnel(零接入代码)。三页共用 tokens.css 令牌系统。终端是 `<pre>` + tmux capture-pane 轮询 + textarea 回车模型(非 xterm.js),发送统一走 `client.js:71` 的 `sendBatch(actions)`,服务端 key 白名单在 `server.cjs:481`。

**Tech Stack:** Express(.cjs)、原生 JS(无框架)、tmux、WebSocket、PWA(manifest + apple meta)、node --test 后端测试、Playwright 前端验证。

**Spec:** `docs/superpowers/specs/2026-06-28-ios-mobile-support-design.md`

**品牌色(来自 tokens.css):** `--brand #d4a574`、深色 `--bg #1c1815`、`--brand-strong #c08e54`。

**测试约定:**
- 后端任务(rate-limit、cookie):严格 TDD,`node --test`,RED → GREEN → REFACTOR
- 前端 JS 逻辑:能抽纯函数的抽出来写 node --test;涉及 DOM/浏览器的用 Playwright MCP 验证
- 前端 CSS/HTML meta:Playwright DOM/CSS 断言 + 真机手动 checklist(见每任务)

---

## 评审修订要点(相对原版 v1)

原版 13 任务经工程/设计/产品三方评审(7/10、6/10、6/10),本版修订:

- **修 4 个硬伤:** Task 12(v16)抽 `lib/cookie_options.cjs` 而非 require server.cjs(后者无 `module.exports` 且自执行会起服务);Task 9(v14)复制逻辑写进 client.js IIFE 内复用闭包 `lastOutput`;Task 6(v10)删手动 maxHeight 改 scrollIntoView + virtualScroll.remeasure;Task 8(v8)撤全局 16px 改动。
- **加 4 个真需求:** 快捷回复(Yes/No/Continue,v12)、极简止损 Esc+Ctrl+C(v13)、等待状态 title 提示(v3)、WS 指数退避(v15)。
- **重排交付:** 三 Phase 一起做 → MVP-0(验证能连能看)→ MVP-1(打磨)→ MVP-2(控制台)。先验证真需求再投入控制台。
- **砍横屏提示**(原 Task 10):反模式,且依赖的"横屏更完整"没做 resize-pane 是空头支票。
- **小修正:** rate-limit 用 `req.ip` 不手写 XFF;cookie maxAge 默认 24h→4h;maskable 去掉(iOS 忽略);复制按钮放 terminalHeader;粘贴 confirm 改 toast;status-bar-style 用 default。

---

## 文件结构

| 文件 | 改动 | 责任 |
|---|---|---|
| `public/index.html` | 修改 | viewport-fit、PWA link/meta |
| `public/dashboard.html` | 修改 | viewport-fit、PWA link/meta |
| `public/login.html` | 修改 | viewport-fit、PWA link/meta、`min-height:100vh`→`100dvh` |
| `public/style.css` | 修改 | 三处 `100vh`→`100dvh`(含移动断点)、safe-area、header 重排、触摸目标、focus-visible |
| `public/dashboard.css` | 修改 | `#app` 100vh→dvh、badge 暗色变体、nav 触摸高度、:active、waiting 视觉优先 |
| `public/client.js` | 修改 | 软键盘适配、复制、粘贴 toast、快捷回复、Esc/Ctrl+C、WS 指数退避 |
| `public/dashboard.js` | 修改 | visibilitychange 暂停轮询、等待状态 title 提示 |
| `public/manifest.json` | 新建 | PWA manifest(无 maskable) |
| `public/apple-touch-icon.png` + `icon-192.png` + `icon-512.png` | 新建 | 图标(从零设计,方向 B) |
| `server.cjs` | 修改 | rate-limit middleware、cookie maxAge(引纯模块)、`require.main` 守卫 |
| `lib/rate_limit.cjs` | 新建 | 速率限制纯模块(可单测) |
| `lib/cookie_options.cjs` | 新建 | cookie 选项构造纯模块(可单测) |
| `test/rate_limit.test.cjs` | 新建 | rate-limit 单测 |
| `test/cookie_options.test.cjs` | 新建 | cookie maxAge 单测 |
| `docs/ios-access.md` | 新建 | Cloudflare Tunnel iPhone 访问指南(含命名隧道) |

---

## 执行顺序:MVP-0 → MVP-1 → MVP-2

- **MVP-0**(约 0.5-0.7 人天):viewport + 暂停轮询 + title 提示 + PWA meta + rate-limit + Tunnel 文档。**验证 iPhone 能连、看板能看、能加主屏。先验证你真的会用。**
- **MVP-1**(约 0.5 人天):看板打磨(深色 badge、触摸高度、waiting 视觉、focus-visible)+ 图标设计。
- **MVP-2**(约 1 人天):控制台可用(软键盘、header 重排、快捷回复、Esc/Ctrl+C、复制、WS 退避、cookie maxAge)。

---

# MVP-0:验证手机能连 + 能看 + 能加主屏

## Task 1:viewport-fit + safe-area + 三页 dvh 统一

**Files:**
- Modify: `public/index.html:5`、`public/dashboard.html:5`、`public/login.html:5`
- Modify: `public/style.css`(`#app :24-28`、`.terminal-view :181`、移动断点 `:408-410`)
- Modify: `public/dashboard.css`(`#app` 约 `:26`)

- [ ] **Step 1:改三页 viewport meta**

三页 head 里 viewport meta 改为:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```
不加 `user-scalable=no`(无障碍合规)。

- [ ] **Step 2:style.css 三处 100vh → 100dvh**

`#app`(:24-28):
```css
#app {
  height: 100vh;      /* 旧浏览器兜底 */
  height: 100dvh;     /* iOS 15.4+ 动态视口,键盘弹出时正确收缩 */
}
```
`.terminal-view` 的 `max-height: calc(100vh - 130px)`(:181)改 `calc(100dvh - 130px)`。
移动断点 `.terminal-view` 的 `max-height: calc(100vh - 100px)`(:410)改 `calc(100dvh - 100px)`。**三处都要改,否则移动断点仍用 100vh,dvh 适配失效。**

- [ ] **Step 3:login.html + dashboard.css 同步 dvh**

`login.html:14` 的 `min-height: 100vh` 改 `min-height: 100vh; min-height: 100dvh;`。
`dashboard.css` 的 `#app { height: 100vh }`(约 :26)改 100dvh(同 Step 2 双行写法)。

- [ ] **Step 4:style.css + dashboard.css 加 safe-area padding**

`style.css` 末尾加:
```css
.header {
  padding-top: max(12px, env(safe-area-inset-top));
  padding-left: max(20px, env(safe-area-inset-left));
  padding-right: max(20px, env(safe-area-inset-right));
}
.terminal-input-row {
  padding-bottom: max(8px, env(safe-area-inset-bottom));
}
```
`dashboard.css` 的 `.header` 加 `padding-top: max(12px, env(safe-area-inset-top))`。

- [ ] **Step 5:Playwright 验证**

```js
async (page) => {
  const meta = await page.$eval('meta[name="viewport"]', el => el.content);
  return meta; // 应包含 viewport-fit=cover
}
```
三页都返回含 `viewport-fit=cover`。再断言 `#app` computed height 为动态值。

- [ ] **Step 6:commit**

```bash
git add public/*.html public/style.css public/dashboard.css
git commit -m "feat(ios): viewport-fit=cover + safe-area + 三页 100dvh 统一"
```

---

## Task 2:看板后台暂停轮询

**Files:**
- Modify: `public/dashboard.js`(`POLL_MS :7`、`loop :135-137`)

- [ ] **Step 1:改 loop 为可暂停**

`dashboard.js` IIFE 内(`:135` 的 `loop` 附近),替换为带 visibility 控制版本:
```js
var polling = true;

async function loop() {
    if (!polling) return;
    var ok = await poll();
    if (ok && polling) setTimeout(loop, POLL_MS);
}

document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        polling = false; // 后台暂停,省电 + 避免 fetch 堆积
    } else if (!polling) {
        polling = true;
        loop(); // 回前台立即刷新一次再恢复轮询
    }
});

loop();
```

- [ ] **Step 2:Playwright 黑盒验证后台暂停**

不用 mock `document.hidden`(WebKit 下原生 getter 不可配置会抛)。改为监听请求计数:
```js
async (page) => {
  let count = 0;
  page.on('request', req => { if (req.url().includes('/api/dashboard')) count++; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(5000);
  return count; // 触发 visibilitychange 后 5s 内不应有新 dashboard 请求(应接近 0)
}
```

- [ ] **Step 3:commit**

```bash
git add public/dashboard.js
git commit -m "feat(ios): 看板页面后台暂停 2s 轮询,回前台立即刷新"
```

---

## Task 3:等待状态 title 提示(新真需求)

**Files:**
- Modify: `public/dashboard.js`(poll 解析 sessions 处)

**为什么:** 个人开发者最痛的场景是 agent 跑长任务时卡住等输入,人不在电脑前完全不知道。iPhone 锁屏收不到推送(PWA 推送 iOS 不可靠),但标签页/主屏图标能反映 `document.title` 变化。零成本,Task 2 轮询的自然延伸。

- [ ] **Step 1:统计 waiting 会话数并改 title**

`dashboard.js` 渲染 sessions 后(`poll` 拿到的会话列表,字段名执行时核对,应为每项 `status`),加:
```js
function updateWaitingTitle(sessions) {
    var waiting = (sessions || []).filter(function (s) {
        return s && s.status === 'waiting';
    }).length;
    var base = 'CC Control';
    document.title = waiting > 0 ? '[' + waiting + ' 等待] ' + base : base;
}
```
在渲染 sessions 的位置调用 `updateWaitingTitle(sessions)`。首次加载也调一次。

- [ ] **Step 2:Playwright 验证 title 随状态变**

```js
async (page) => {
  await page.evaluate(() => {
    // 模拟 poll 回调拿到一个 waiting 会话
    window.__testSessions = [{ status: 'waiting', name: 'x' }];
  });
  // 触发一次渲染(若有暴露的刷新按钮就点,否则等下一轮轮询)
  await page.waitForTimeout(2500);
  return document.title; // 应包含 "等待"
}
```

- [ ] **Step 3:commit**

```bash
git add public/dashboard.js
git commit -m "feat(ios): 看板检测 waiting 会话,document.title 提示等待数量"
```

---

## Task 4:PWA manifest + apple meta(三页)

**Files:**
- Create: `public/manifest.json`
- Modify: 三页 head

- [ ] **Step 1:新建 manifest.json(无 maskable)**

```json
{
  "name": "CC Control",
  "short_name": "CC",
  "description": "Claude Code 多会话 Web 控制台",
  "display": "standalone",
  "background_color": "#1c1815",
  "theme_color": "#1c1815",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```
不写 maskable 项:`purpose: "maskable"` 是 Android/Chrome 概念,iOS 完全忽略,只看 apple-touch-icon 并自己裁圆角。iOS 图标由 `<link rel="apple-touch-icon">` 单独引(见 Step 2)。

- [ ] **Step 2:三页 head 加 PWA link/meta**

三页 `<head>` 在 viewport meta 后加(Task 9 产出图标后才完全生效,先挂 link):
```html
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="CC Control">
<meta name="theme-color" content="#1c1815">
```
status-bar-style 用 `default` 而非 `black-translucent`:工具型 app 可读性优先,default 让系统状态栏自适应黑底白字,避免 black-translucent 把状态栏文字叠到 header 内容上。safe-area padding(Task 1)兜底刘海。

- [ ] **Step 3:Playwright 验证**

```js
async (page) => {
  const has = await page.$('link[rel="manifest"]');
  const bar = await page.$eval('meta[name="apple-mobile-web-app-status-bar-style"]', el => el.content);
  return { manifest: has ? 'linked' : 'missing', bar }; // linked, default
}
```
三页都 `linked`。

- [ ] **Step 4:commit**

```bash
git add public/manifest.json public/*.html
git commit -m "feat(ios): PWA manifest + apple-touch-icon/meta,status-bar default"
```

---

## Task 5:登录速率限制(TDD)

**Files:**
- Create: `lib/rate_limit.cjs`
- Create: `test/rate_limit.test.cjs`
- Modify: `server.cjs`(`POST /login` handler `:278`)

- [ ] **Step 1:写失败测试**

`test/rate_limit.test.cjs`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../lib/rate_limit.cjs');

test('未超阈值允许', () => {
  const allow = createRateLimiter({ max: 3, windowMs: 1000 });
  assert.strictEqual(allow('1.2.3.4'), true);
  assert.strictEqual(allow('1.2.3.4'), true);
  assert.strictEqual(allow('1.2.3.4'), true);
});

test('超阈值拒绝', () => {
  const allow = createRateLimiter({ max: 2, windowMs: 1000 });
  allow('x'); allow('x');
  assert.strictEqual(allow('x'), false);
});

test('不同 IP 独立计数', () => {
  const allow = createRateLimiter({ max: 1, windowMs: 1000 });
  assert.strictEqual(allow('a'), true);
  assert.strictEqual(allow('b'), true);
  assert.strictEqual(allow('a'), false);
});

test('窗口过期后重置', async () => {
  const allow = createRateLimiter({ max: 1, windowMs: 50 });
  allow('c');
  assert.strictEqual(allow('c'), false);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(allow('c'), true);
});
```

- [ ] **Step 2:跑测试,确认失败**

```bash
node --test test/rate_limit.test.cjs
```
预期:找不到 `../lib/rate_limit.cjs`,失败。

- [ ] **Step 3:实现 rate_limit.cjs**

`lib/rate_limit.cjs`:
```js
// 按 key 滑动窗口速率限制(内存,单进程,轻量无锁)
function createRateLimiter({ max = 10, windowMs = 60000 } = {}) {
  const hits = new Map(); // key -> [timestamps]
  return function allow(key) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return false;
    }
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}
module.exports = { createRateLimiter };
```

- [ ] **Step 4:跑测试,确认通过**

```bash
node --test test/rate_limit.test.cjs
```
预期:4/4 通过。

- [ ] **Step 5:挂载到 server.cjs POST /login(用 req.ip)**

`server.cjs` 引入并创建 limiter:
```js
const { createRateLimiter } = require('./lib/rate_limit.cjs');
const loginLimiter = createRateLimiter({ max: 10, windowMs: 60000 });
```
`POST /login` handler(`:278`)开头限流。**用 `req.ip` 不手写 XFF split**:`app.set('trust proxy', 1)`(`:48`)已开,Express 在 trust proxy 下自动从 x-forwarded-for 取可信段,比手写解析更准(避免多跳取错段):
```js
if (!loginLimiter(req.ip || 'unknown')) {
  res.status(429).type('text/plain').send('Too many login attempts');
  return;
}
```

- [ ] **Step 6:全量测试 + 手动验证**

```bash
node --test test/*.test.cjs
```
手动:`for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:7684/login -d 'token=wrong'; done`,前 10 次 200/302,第 11 次应 429。

- [ ] **Step 7:commit**

```bash
git add lib/rate_limit.cjs test/rate_limit.test.cjs server.cjs
git commit -m "feat(ios): POST /login 速率限制,每 IP 每分钟 10 次防撞库(用 req.ip)"
```

---

## Task 6:Cloudflare Tunnel 访问文档

**Files:**
- Create: `docs/ios-access.md`

- [ ] **Step 1:写文档**

涵盖:
- Mac 运行 `scripts/restart_tunnel.sh`,拿到 `https://<random>.trycloudflare.com` URL 和打印的 token
- iPhone Safari 打开 URL → 登录页输 token
- 添加到主屏(分享 → 添加到主屏幕)
- **Quick Tunnel URL 每次脚本重启会变,iPhone 主屏图标点进去会是死链**(高频痛点,如实写明)
- **推荐用命名隧道固定域名**(避免每次换 URL):`cloudflared tunnel create` + 绑自己的域名 + `cloudflared tunnel route dns`,长期方案。给一行命令示例指向 cloudflared 官方文档
- 安全:token 即 `CC_WEB_AUTH_TOKEN`,定期轮换等价全设备登出
- 已知限制:standalone 模式断网打开会比浏览器 tab 更不友好(无 URL 栏提示);锁屏期间无法收到 agent 等待通知

- [ ] **Step 2:commit**

```bash
git add docs/ios-access.md
git commit -m "docs(ios): Cloudflare Tunnel iPhone 访问指南(含命名隧道固定域名)"
```

---

# MVP-1:看板打磨 + PWA 图标

## Task 7:看板深色 badge + nav 触摸高度 + :active + waiting 视觉优先

**Files:**
- Modify: `public/dashboard.css`(badge `.badge--*`、`.session-row`)
- Modify: `public/style.css` + `public/dashboard.css` 的 `.nav-link`

- [ ] **Step 1:badge 暗色变体(对比度 ≥ 4.5:1)**

`dashboard.css` 末尾加深色模式 badge:
```css
@media (prefers-color-scheme: dark) {
  .badge--waiting { background-color: #4a3618; color: #fcd34d; }
  .badge--errored { background-color: #4a1c1c; color: #fca5a5; }
  .badge--working { background-color: #3d2e1a; color: #e6c79c; }
  .badge--idle    { background-color: #2e2922; color: #b8ad9a; }
  .badge--unknown { background-color: transparent; color: #a89b88; border-color: #4a4239; }
}
```
实施时用 Chrome DevTools 或在线工具逐个验对比度,记录数值进 commit body。

- [ ] **Step 2:nav-link 触摸高度 44pt(两处 .nav)**

`style.css` 和 `dashboard.css` 的 `.nav-link` 都加:
```css
.nav-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
```

- [ ] **Step 3:.session-row :active 反馈**

`dashboard.css` `.session-row` 后加:
```css
.session-row:active {
  background-color: var(--surface2);
  transform: scale(0.99);
}
```

- [ ] **Step 4:waiting 卡片视觉优先(看板核心价值)**

看板核心价值是"谁在等我"。waiting 卡片要比 idle 更醒目。`dashboard.css` 加:
```css
.session-row[data-status="waiting"] {
  border-left: 3px solid var(--brand);
  background-color: var(--surface2);
}
```
渲染卡片时给 `<li class="session-row">` 加 `data-status="<status>"` 属性(执行时核对 `dashboard.js` 卡片渲染处补属性)。深色模式下 waiting badge 变暗黄后,这个 3px 琥珀竖条让"待处理"在列表里一眼跳出来。

- [ ] **Step 5:Playwright 验证**

```js
async (page) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  const bg = await page.$eval('.badge--waiting', el => getComputedStyle(el).backgroundColor);
  return bg; // 应非浅色,确认暗色变体生效
}
```

- [ ] **Step 6:commit**

```bash
git add public/dashboard.css public/style.css public/dashboard.js
git commit -m "feat(ios): 看板深色 badge + nav 44pt + 卡片 :active + waiting 视觉优先"
```

---

## Task 8:触摸目标 44pt + focus-visible

**Files:**
- Modify: `public/style.css`(`.btn`、`.control-input`、移动断点 `:390`)

- [ ] **Step 1:触摸目标 44pt**

768px 断点内加:
```css
@media (max-width: 768px) {
  .btn, .control-input { min-height: 44px; }
}
```

- [ ] **Step 2:撤掉全局 16px 字号改动(保持移动断点)**

**不要全局改 `.terminal-inline-textarea` 字号。** 移动端断点(`style.css:423`)已是 `font-size: 16px`,iOS 聚焦 <16px 才自动缩放,移动断点已覆盖防缩放。全局改会动桌面端排版(原 14px),无收益。确认 `:423` 仍是 16px 即可。

- [ ] **Step 3:focus-visible 焦点环(无障碍 + 键盘导航)**

`.session-row` 有 `:focus-visible` 但控件没有,不一致。`style.css` 加:
```css
.btn:focus-visible,
.control-input:focus-visible,
.terminal-inline-textarea:focus-visible,
.nav-link:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
```

- [ ] **Step 4:Playwright 验证**

```js
async (page) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const btnH = await page.$eval('.btn', el => getComputedStyle(el).minHeight);
  return btnH; // 44px
}
```

- [ ] **Step 5:commit**

```bash
git add public/style.css
git commit -m "feat(ios): 触摸目标 44pt + focus-visible 焦点环(撤全局字号改动)"
```

---

## Task 9:图标从零设计(方向 B:❯ + 光标竖条)

**Files:**
- Create: `public/apple-touch-icon.png`(180×180 起设计权重,导出 512)、`public/icon-192.png`、`public/icon-512.png`

**说明:** 设计任务,非 TDD。出 2-3 个方案给用户挑,定稿后产出变体。**限最多 2 轮定稿,定不下来用方案 B**,避免设计黑洞。

- [ ] **Step 1:出 2-3 个 SVG 方案**

基于品牌(琥珀 `#d4a574` + 深底 `#1c1815`),用 SVG 设计方案。主推方向:
- **B)终端 `❯` + 琥珀光标竖条 `▌`**:`❯` 是 zsh/fish 现代终端标志性 prompt,受众即开发者,认知精准;光标竖条用更亮的 `--brand-strong #e6b785` 做"等待输入"意象,呼应看板 waiting。一眼传达"终端/命令行"
- A)字母标 `CC`:太通用,跟无数 app 撞脸,识别度低
- C)抽象结合现有 `logo.png`:现有 logo 是 144×162 透明非方形,本身就是坏基底

把 SVG 渲染成 PNG 展示(用 `rsvg-convert` / `sips`,或直接给 SVG 在浏览器看)。

- [ ] **Step 2:用户挑方案(AskUserQuestion)**

从 A/B/C 选。**最多 2 轮**,超时默认 B。

- [ ] **Step 3:产出定稿 PNG 变体**

定稿后产出。**按 180×180 设计视觉权重再放大**(iOS apple-touch-icon 最佳 180,iOS 自动用作主屏图标;512 内部细节按 512 设计会偏小):
- `apple-touch-icon.png`:512×512,不透明,无圆角(iOS 自裁),**无 alpha 通道**。主体放进中心 ~70% 直径圆内(给 iOS 圆角裁切留边)
- `icon-192.png`:192×192
- `icon-512.png`:512×512

ImageMagick 命令(假决定稿为 icon.svg,底色已铺满):
```bash
convert -background "#1c1815" icon.svg -resize 512x512 -extent 512x512 public/apple-touch-icon.png
convert public/apple-touch-icon.png -resize 192x192 public/icon-192.png
cp public/apple-touch-icon.png public/icon-512.png
```
**不产出 icon-maskable**(manifest 无 maskable 项,iOS 忽略)。
确认无 alpha:`sips -g all public/apple-touch-icon.png`(`hasAlpha` 应为 `false`)。

- [ ] **Step 4:真机验证**

Safari 打开 dashboard 后看 apple-touch-icon 是否被识别,或加到主屏确认图标显示正确、无黑边、无透明填黑。

- [ ] **Step 5:commit**

```bash
git add public/apple-touch-icon.png public/icon-*.png
git commit -m "feat(ios): 从零设计 PWA 图标(方向 B 终端 prompt,180/192/512 变体)"
```

---

# MVP-2:控制台可用

## Task 10:软键盘适配(唯一阻断项)

**Files:**
- Modify: `public/client.js`(新增 visualViewport 监听、`focusInput :449`)
- 依赖:Task 1 已把 `#app`/`.terminal-view` 改 100dvh

**关键修正:** `.terminal-view` 不是贴底容器,它套在 `.chat-container`(flex:1 可滚动)里。原版手动给它设 `maxHeight = visualViewport.height` 反而让它比变矮的容器还大,产生内部滚动,输入框可能滚出可见区。**删掉手动 maxHeight,只做 scrollIntoView + virtualScroll 重测。**

- [ ] **Step 1:client.js 加 visualViewport 监听(只 scrollIntoView + remesure)**

终端初始化处加:
```js
function setupKeyboardViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
        var input = document.querySelector('.terminal-inline-textarea');
        if (input && document.activeElement === input) {
            input.scrollIntoView({ block: 'nearest' }); // nearest 比 end 安全,只在必要时滚
        }
        if (window.ccModules && window.ccModules.virtualScroll) {
            window.ccModules.virtualScroll.remeasure(); // 父高度变后虚拟列表重测,避免滚动错位
        }
    }
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
}
```
终端初始化末尾调用 `setupKeyboardViewport()`。**不要给 `.terminal-view` 设 inline maxHeight。**

- [ ] **Step 2:focusInput 去掉 preventScroll**

`client.js:449` 的 `focusInput` 里 `inputEl.focus({ preventScroll: true })` 改 `inputEl.focus()`,让浏览器把输入框滚进可见区。(`:365`、`:484` 的其他 focus 视情况,优先改 focusInput。)

- [ ] **Step 3:输入框 enterkeyhint + 关闭自动大写**

创建 textarea 处加:
```js
inputEl.enterKeyHint = 'send';
inputEl.setAttribute('autocapitalize', 'off');
inputEl.setAttribute('autocomplete', 'off');
inputEl.setAttribute('autocorrect', 'off');
inputEl.setAttribute('spellcheck', 'false');
```
输 Claude 指令以小写英文为主,iOS 默认首字母大写会烦。

- [ ] **Step 4:Playwright + 真机验证**

```js
async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const hint = await page.$eval('.terminal-inline-textarea', el => el.enterKeyHint);
  return hint; // 'send'
}
```
真机 checklist(iPhone Safari 打开控制台):
- 点终端唤起键盘,输入框不被遮挡、能看见自己输入
- 中文拼音 / 表情 / 第三方键盘(搜狗/百度)
- **外接键盘/蓝牙键盘**(visualViewport 不收缩,聚焦行为不同)
- **浮动小键盘**(双指捏合,键盘在屏幕中间,输入框可能没被遮)
- **横屏 + 软件键盘**(键盘占满全屏,确认至少能看见一行上下文 + 输入框)

- [ ] **Step 5:commit**

```bash
git add public/client.js
git commit -m "fix(ios): 软键盘适配 scrollIntoView + virtualScroll 重测,删手动 maxHeight"
```

---

## Task 11:header 真 IA 重排(两行布局)

**Files:**
- Modify: `public/index.html:29-48`(`.header-actions`)
- Modify: `public/style.css`(`.header`、`.header-actions`、768px 断点)

**关键修正:** 原版砍登录导航 + flex-wrap 不够,7 个控件(Session 下拉 + 刷新 + Project 下拉 + 启动 + 状态 + 3 导航)在 375px 下换行错乱、宽度互抢。做真正的信息架构,不是 flex-wrap 兜底。

- [ ] **Step 1:375px 两行布局**

375px 下手机端 header 真正需要的:第一行 logo + Session 下拉(占满剩余);第二行刷新 + 导航胶囊(控制台/看板)。**藏掉** Project 下拉、启动按钮、connectionStatus、登录导航(看板才是手机入口,登录靠 tunnel 后浏览器会话)。

`style.css` 768px 断点内加:
```css
@media (max-width: 768px) {
  .header { flex-wrap: wrap; gap: 8px; }
  .header-actions { width: 100%; flex-wrap: wrap; gap: 6px; align-items: center; }
  #sessionSelect { flex: 1; min-width: 0; }            /* Session 下拉占满 */
  #projectControl, #startProject, #connectionStatus,
  .nav-link[href="/login"], .nav-link[href$="/login"] { display: none; }
  #refreshSessions { flex: 0 0 auto; }
  .nav { flex: 1; display: flex; justify-content: flex-end; gap: 4px; }
}
```

- [ ] **Step 2:Playwright 验证不溢出 + 控件可见**

```js
async (page) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const overflow = await page.$eval('.header', el => el.scrollWidth > el.clientWidth);
  const sessionVisible = await page.$eval('#sessionSelect', el => getComputedStyle(el).display !== 'none');
  const refreshVisible = await page.$eval('#refreshSessions', el => getComputedStyle(el).display !== 'none');
  return { overflow: overflow ? 'OVERFLOW' : 'FIT', sessionVisible, refreshVisible };
  // FIT, true, true
}
```

- [ ] **Step 3:真机 checklist**

375px 宽下 header 两行、不横向溢出、不遮挡终端、Session 下拉和刷新可点、Project/启动/状态/登录不显示。

- [ ] **Step 4:commit**

```bash
git add public/index.html public/style.css
git commit -m "feat(ios): header 真 IA 两行重排,375px 藏次要控件不溢出"
```

---

## Task 12:快捷回复按钮(Yes / No / Continue)

**Files:**
- Modify: `public/client.js`(IIFE 内,`lastOutput` 更新处 `:503` 附近、`sendBatch :71`)

**为什么:** Claude Code 最高频的移动交互不是发新指令,是回答 Claude 的提问(确认 `y/n`、贴代码)。手机上点输入框、唤键盘、敲 `y`、找回车,反人类。检测到提示时浮胶囊按钮,一点直接注入,ROI 最高。

- [ ] **Step 1:client.js IIFE 内加快捷回复条**

在 IIFE 内(`sendBatch` 定义之后)加:
```js
var quickReplyBar = null;
function shouldShowQuickReply(text) {
    var tail = (text || '').slice(-500);
    return /y\/n|\[y\/n\]|\byes\b\/\bno\b|continue\?\s*\??/i.test(tail) || /\?\s*$/.test((text || '').trim());
}
function hideQuickReply() {
    if (quickReplyBar) { quickReplyBar.remove(); quickReplyBar = null; }
}
function showQuickReply() {
    if (quickReplyBar) return;
    quickReplyBar = document.createElement('div');
    quickReplyBar.id = 'quickReply';
    quickReplyBar.style.cssText = 'display:flex;gap:8px;padding:6px 0;justify-content:center;';
    function mk(label, color, actions) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = label;
        b.style.cssText = 'min-height:40px;background:' + color + ';';
        b.addEventListener('click', function () { sendBatch(actions); hideQuickReply(); });
        return b;
    }
    quickReplyBar.append(
        mk('Yes', 'var(--brand)', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'y', enter: true }]),
        mk('No', 'var(--surface2)', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'n', enter: true }]),
        mk('Continue', 'var(--brand-strong)', [{ type: 'key', data: 'Enter' }])
    );
    var inputRow = document.querySelector('.terminal-inline-input');
    var anchor = inputRow ? inputRow.parentElement : document.querySelector('.terminal-view');
    if (anchor && inputRow) anchor.insertBefore(quickReplyBar, inputRow);
    else if (anchor) anchor.appendChild(quickReplyBar);
}
function updateQuickReply() {
    if (shouldShowQuickReply(lastOutput)) showQuickReply(); else hideQuickReply();
}
```

- [ ] **Step 2:在 lastOutput 更新处触发**

`client.js:503` 的 `lastOutput = output;` 后加一行 `updateQuickReply();`。会话切换重置 lastOutput 的位置(`:584`、`:663`、`:679`、`:690`、`:745`)也加 `hideQuickReply();`(切走就藏)。

- [ ] **Step 3:Playwright + 真机验证**

```js
async (page) => {
  // 模拟 WS 推入一个含 y/n 的输出
  await page.evaluate(() => {
    // 触发渲染路径写入 lastOutput,或直接测 shouldShowQuickReply 纯逻辑
  });
  const bar = await page.$('#quickReply');
  return bar ? 'shown' : 'hidden';
}
```
把 `shouldShowQuickReply` 抽成纯函数可单测(可选)。真机:真实 Claude 会话里等一个 `? (y/n)` 提示,确认胶囊浮出,点 Yes 注入 `y` 回车。

- [ ] **Step 4:commit**

```bash
git add public/client.js
git commit -m "feat(ios): 快捷回复按钮(Yes/No/Continue),检测 y/n 提示一键注入"
```

---

## Task 13:极简止损 Esc + Ctrl+C

**Files:**
- Modify: `public/client.js`(IIFE 内,终端初始化处)
- 依赖:`server.cjs:481` 白名单已含 `'Escape'`、`'C-c'`,服务端零改动

**为什么:** 不做全键盘工具栏对,但 Claude Code 大量依赖 Ctrl+C 中断、Esc 退出。手机上 agent 跑飞了没这俩键就束手无策。挂 header 一行两个键堵住"无法止损"的体验黑洞。

- [ ] **Step 1:client.js 终端初始化处加止损条**

在终端块创建处(`terminalHeader` 初始化 `:164` 附近)加两个按钮:
```js
function setupStopControls() {
    var bar = document.createElement('div');
    bar.className = 'stop-controls';
    bar.style.cssText = 'display:flex;gap:6px;';
    function mk(label, keyData) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = label;
        b.style.cssText = 'min-height:36px;padding:0 10px;font-size:13px;';
        b.addEventListener('click', function () { sendBatch([{ type: 'key', data: keyData }]); });
        return b;
    }
    bar.append(mk('Esc', 'Escape'), mk('Ctrl+C', 'C-c'));
    var header = document.querySelector('.terminal-header');
    if (header) {
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'flex-end';
        header.appendChild(bar);
    }
}
```
终端初始化末尾调用 `setupStopControls()`。

- [ ] **Step 2:移动端默认显示,桌面端可选隐藏**

`style.css` 桌面默认可隐藏(键盘有 Esc/Ctrl),移动断点显示:
```css
.stop-controls { display: none; }
@media (max-width: 768px) { .stop-controls { display: flex; } }
```
(若希望桌面也常驻,去掉隐藏规则。)

- [ ] **Step 3:Playwright + 真机验证**

```js
async (page) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const esc = await page.$('.stop-controls button');
  return esc ? 'present' : 'missing';
}
```
真机:跑一个会话,点 Ctrl+C 确认中断当前 agent 操作,点 Esc 确认退出当前交互。

- [ ] **Step 4:commit**

```bash
git add public/client.js public/style.css
git commit -m "feat(ios): 极简止损 Esc + Ctrl+C 按钮(服务端白名单已支持)"
```

---

## Task 14:复制输出 + 粘贴 toast 提示

**Files:**
- Modify: `public/client.js`(IIFE 内,`terminalHeader :164`、`lastOutput :503`、`sendBatch :71`)

**关键修正:** 原版把复制按钮加进 `.header-actions` 会更挤,而且 `lastOutput` 是 IIFE 闭包内变量,外面读不到。复制按钮加进 `terminalHeader`(终端块内部,语义对),逻辑写进 IIFE 内复用闭包 `lastOutput`。粘贴 confirm 在移动 PWA 是反模式,改 toast。

- [ ] **Step 1:client.js terminalHeader 创建处加复制按钮**

终端块创建处(`:164` `terminalHeader` 初始化附近)加:
```js
var copyBtn = document.createElement('button');
copyBtn.type = 'button'; copyBtn.className = 'btn';
copyBtn.textContent = '复制'; copyBtn.title = '复制最新输出';
copyBtn.style.cssText = 'min-height:36px;padding:0 10px;font-size:13px;';
terminalHeader.appendChild(copyBtn);
copyBtn.addEventListener('click', function () {
    var text = lastOutput || '';
    if (!text) { toast('暂无输出可复制'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });
    } else {
        fallbackCopy(text);
    }
});
function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
}
```
**复用 IIFE 内已有的 `lastOutput`(`:28`)和 `toast`(执行时核对 toast 函数名)。不要在 IIFE 外重新声明 `var lastOutput`,否则永远读到空串。**

- [ ] **Step 2:多行粘贴改 toast(不用 confirm)**

textarea 的 `paste` 事件检测换行,改 toast 提示 + 让用户决定(确认发送或清掉),不用阻塞式 `confirm()`:
```js
inputEl.addEventListener('paste', function (e) {
    var data = (e.clipboardData || window.clipboardData).getData('text');
    if (data && data.indexOf('\n') !== -1) {
        toast('粘贴含换行,将作为多行发送(每个换行变成一个 Enter)');
    }
});
```
不 `preventDefault`,让粘贴正常发生(用户已主动粘贴),只提示后果。若要更强保护可加"3 秒内撤销",但 MVP 不做。

- [ ] **Step 3:Playwright + 真机验证**

```js
async (page) => {
  const hasBtn = await page.$eval('.terminal-header', el => !!el.querySelector('button'));
  return hasBtn ? 'copy btn in terminal-header' : 'missing';
}
```
真机:有输出时点复制确认写入剪贴板;复制含换行文本粘贴确认 toast 出现。

- [ ] **Step 4:commit**

```bash
git add public/client.js
git commit -m "feat(ios): 复制按钮进 terminal-header + 粘贴多行 toast 提示(闭包内绑定)"
```

---

## Task 15:WS 指数退避重连

**Files:**
- Modify: `public/client.js`(`RECONNECT_INTERVAL :12`、`scheduleReconnect :538-542`)

**为什么:** 原版固定 3s 重连。移动网络切基站、进地铁断网,固定 3s 会堆积重连风暴。指数退避 + online 立即重连是移动弱网刚需。

- [ ] **Step 1:改固定间隔为指数退避**

`client.js:12` 的 `const RECONNECT_INTERVAL = 3000;` 改为退避配置:
```js
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
var reconnectAttempts = 0;
```
`:538-542` 的重连逻辑改:
```js
if (reconnectTimer) return;
var delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
reconnectAttempts++;
reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs(); // 执行时核对实际重连调用名(:542 原调用)
}, delay);
```
WS 连接成功时(`onopen`)重置 `reconnectAttempts = 0;`。
加 online 立即重连:
```js
window.addEventListener('online', function () {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    connectWs();
});
```
执行时核对 `:542` 实际调用的连接函数名(`connectWs` 或其他),保持一致。

- [ ] **Step 2:Playwright 验证退避(可选,逻辑为主)**

退避是定时器行为,Playwright 难直接验。可断言 `reconnectAttempts` 在多次失败后递增、`onopen` 后归零(把退避纯函数化更易测)。重点靠真机断网重连验证。

- [ ] **Step 3:真机验证**

iPhone 进飞行模式再关掉,确认 WS 自动重连、看板恢复刷新;或锁屏 1 分钟回前台确认重连。

- [ ] **Step 4:commit**

```bash
git add public/client.js
git commit -m "fix(ios): WS 指数退避重连(1s→30s)+ online 立即重连,防弱网风暴"
```

---

## Task 16:cookie maxAge(TDD,抽纯模块)

**Files:**
- Create: `lib/cookie_options.cjs`
- Create: `test/cookie_options.test.cjs`
- Modify: `server.cjs`(cookie 设置 `:296-302`、加 `require.main` 守卫)

**关键修正:** 原版 `require('../server.cjs')` 测试会触发整个服务器启动(`:683` `void initAndAttachSession()` 无 `require.main` 守卫,且无 `module.exports`),占用 7684 端口、spawn tmux、开浏览器,而且 `buildCookieOptions` 根本导出不来。抽到 `lib/cookie_options.cjs` 独立模块(和 `lib/rate_limit.cjs` 同构),测试 require 它而非 server.cjs。默认 maxAge 24h → 4h(隧道场景 iPhone 丢了 24h 可访问偏长)。

- [ ] **Step 1:写失败测试**

`test/cookie_options.test.cjs`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildCookieOptions } = require('../lib/cookie_options.cjs');

test('maxAge 来自环境变量(秒)', () => {
  process.env.CC_WEB_SESSION_TTL = '3600';
  const opts = buildCookieOptions({ secure: true });
  assert.strictEqual(opts.maxAge, 3600 * 1000);
  delete process.env.CC_WEB_SESSION_TTL;
});

test('无环境变量默认 4h', () => {
  delete process.env.CC_WEB_SESSION_TTL;
  const opts = buildCookieOptions({ secure: true });
  assert.strictEqual(opts.maxAge, 4 * 60 * 60 * 1000);
});

test('secure 跟随请求,httpOnly + sameSite 固定', () => {
  const opts = buildCookieOptions({ secure: true });
  assert.strictEqual(opts.secure, true);
  assert.strictEqual(opts.httpOnly, true);
  assert.strictEqual(opts.sameSite, 'lax');
});
```

- [ ] **Step 2:跑测试,确认失败**

```bash
node --test test/cookie_options.test.cjs
```
预期:找不到 `../lib/cookie_options.cjs`,失败。

- [ ] **Step 3:实现 lib/cookie_options.cjs**

`lib/cookie_options.cjs`:
```js
// cookie 选项构造纯函数(可单测,不引 server.cjs)
function buildCookieOptions({ secure }) {
  const ttlSec = parseInt(process.env.CC_WEB_SESSION_TTL || '', 10);
  const maxAge = (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 4 * 60 * 60) * 1000;
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    maxAge: maxAge
  };
}
module.exports = { buildCookieOptions };
```

- [ ] **Step 4:跑测试,确认通过**

```bash
node --test test/cookie_options.test.cjs
```
预期:3/3 通过。

- [ ] **Step 5:server.cjs 引入纯模块 + 加 require.main 守卫**

`server.cjs` 顶部引入:
```js
const { buildCookieOptions } = require('./lib/cookie_options.cjs');
```
`:296-302` 的 cookie 设置改用:
```js
res.cookie('cc_web_auth', token, buildCookieOptions({ secure }));
```
(`secure` 变量在 `:296` 已算好,沿用。)
给 `:683` 的自执行加守卫,防未来再踩 require 起服务的坑:
```js
if (require.main === module) {
  void initAndAttachSession();
}
```

- [ ] **Step 6:全量测试**

```bash
node --test test/*.test.cjs
```
全绿。确认 server.cjs 直接 `node server.cjs` 仍正常启动(`require.main === module` 守卫不影响直接运行)。

- [ ] **Step 7:commit**

```bash
git add lib/cookie_options.cjs test/cookie_options.test.cjs server.cjs
git commit -m "feat(ios): cookie maxAge 抽纯模块(默认 4h 可配)+ server.cjs require.main 守卫"
```

---

## 收尾

- [ ] 全量测试:`node --test test/*.test.cjs`,全绿
- [ ] 真机端到端 checklist:
  - Mac 跑 tunnel → iPhone 加主屏 → 看板看状态 → waiting 卡片琥珀竖条醒目 → title 显示"[N 等待]"
  - 点进控制台 → 发指令回车 → 快捷回复检测 y/n 浮胶囊 → 点 Yes 注入
  - 跑飞时点 Ctrl+C 中断、Esc 退出
  - 点复制按钮写剪贴板;粘贴含换行文本 toast 提示
  - 软键盘 5 种状态 + 外接键盘 + 浮动键盘 + 横屏满屏,输入框不遮挡
  - 锁屏回前台 WS 指数退避重连恢复
  - **真实 Claude 会话下测**:agent 输出 ANSI/超长/UTF-8 中文,`<pre>` 渲染正常
  - **弱网/隧道延迟测**:Cloudflare 加一跳,WS 轮询不堆积
  - **多设备同时在线**:Mac 看板 + iPhone 同时连,不往同一会话同时发指令
- [ ] **显式记录 capture-pane 无 scrollback**:`tmux capture-pane -p` 只抓可见屏,手机竖屏 80 列被截断、横屏切换/锁屏回前台后历史输出无法上滚。这是接受的物理限制(不做 resize-pane),文档 `docs/ios-access.md` 注明
- [ ] 若用 worktree 执行,用 superpowers:finishing-a-development-branch 收尾
