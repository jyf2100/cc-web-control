# 7685 Hub 看板化 + 卡片跳转单机 — 设计

- 日期：2026-07-07
- 状态：设计稿（待用户复审 → writing-plans）
- 范围：7685 hub（多机 Fleet Dashboard）与 7684 单机共享 `public/`，纯 JS（Express + 原生前端 UMD `.cjs` + `node:test`）

## 1. 目标与范围

**目标**：7685 hub **只保留看板页** `/dashboard.html`；点击 agent 卡片**在新标签打开该机的 7684 单机实例并直达特定 session**，且自动登录（用户无需在 7684 再输 token）。

**不做**：
- 主 agent（hub 端 `setupMainAgent`）**不跑**——代码保留，`CC_WEB_HUB_MAIN_AGENT_ENABLED` 默认 `'0'`（`hub/main_agent_env.cjs:21` 已默认 OFF），无代码改动。
- 不重写看板扇出（fanout）多选交互，仅迁移其 DOM/JS 委托以适配新卡片结构。
- cookie 值仍为长期 AUTH_TOKEN（既有风险，列为 follow-up，本次不动）。

**关键决策**（已经用户确认）：
1. hub→7684 自动登录用**一次性短 TTL（15s）ticket**，长期 token 绝不出现在浏览器 URL/日志/Referer。
2. 卡片重构用 **Plan A**：`<li class="card-row">` 下 `<button>` 与 `<a>` **同级**（解决原 `<a>` 嵌交互元素的非法 ARIA 嵌套）。
3. 远程机器**全部自动跳**（`m` 必须在 registry 内才跳，不存在则拒）。

## 2. 架构总览

```
浏览器(已登录 hub, 持 cc_web_hub_auth cookie)
  │
  │ ① 点卡片 <a href="/jump?m=<id>&s=<session>" target="_blank">
  ▼
hub:7685  GET /jump   (requireAuth 校验 cc_web_hub_auth)
  │ ② 入口校验 m/s → registry.getSecret(m) 取 {url, token}
  │ ③ server-to-server POST ${url}/api/auth/ticket  (Authorization: Bearer <token>, 3s 超时)
  ▼
machine:7684  POST /api/auth/ticket   (requireAuth 校验 Bearer)
  │ ④ mint 32 字节 ticket → 内存 Map(15s TTL) → 返回 {ticket}
  ▼
hub:7685  ⑤ 302 → ${url}/login?ticket=<t>&next=/?session=<s>   (Cache-Control: no-store)
  ▼
浏览器跟随 302 到 machine:7684
  │
  ▼
machine:7684  GET /login?ticket=<t>&next=/?session=<s>
  │ ⑥ 查 Map → 未过期 → 立即删除(一次性) → Set-Cookie cc_web_auth → 302 next
  ▼
浏览器落在 machine:7684/?session=<s>  (已登录, 直达 session, 新标签)
```

长期 token 只在 ③（hub→machine 服务端 Bearer）出现，绝不出现在浏览器侧。ticket 出现在 302 Location（浏览器历史/server log），但 15s TTL + 一次性消费 + Referrer-Policy 收口。

## 3. 鉴权与跳转流

### 3.1 Cookie 名称参数化（CRITICAL 前置）

**为什么**：cookie 忽略端口（RFC 6265 §5.1.3），hub `:7685` 与单机 `:7684` 在 localhost 同 host，若同名 `cc_web_auth` 会互相覆盖 → 一边登录踢掉另一边。改名隔离。但 `auth.isAuthorized` 把 cookie 名写死（`auth.cjs:46`），hub 的 requireAuth/WS 鉴权都走它 → **只改写入侧会让 hub 认证全崩**。必须参数化读侧。

**契约**：
- 单机（7684）cookie 名 = `cc_web_auth`（不变）。
- hub（7685）cookie 名 = `cc_web_hub_auth`。
- `auth.isAuthorized` 签名参数化：

  ```js
  isAuthorized({ cookieHeader, authorizationHeader }, expectedToken, cookieName = 'cc_web_auth')
  ```

  - 默认 `'cc_web_auth'` → 单机两处调用（requireAuth / WS 鉴权）零改动，向后兼容。
  - hub 两处调用（`hub/server.cjs:160-163` requireAuth、`:415-421` WS 鉴权）显式传 `'cc_web_hub_auth'`。
  - `auth.cjs:46` `cookies.cc_web_auth` → `cookies[cookieName]`。
- Bearer token 路径不动（hub→machine 的 `AgentClient` 走 `Authorization: Bearer`，与 cookie 名无关）。
- **实施前必查**：`grep -rn "cc_web_auth" public/` 确认无前端 JS 读这个 cookie（预期无；docs/ 里的旧 plan 引用不影响 runtime）。

**牵连清单**（cookie 改名）：
- `auth.cjs:38,46`（签名 + 读 cookie 名）
- `hub/server.cjs:121`（写 cookie）、`:134`（清 cookie）、`:160-163`（requireAuth 传名）、`:415-421`（WS 鉴权传名）
- `test/auth.test.cjs:36`（签名变；新增 1 条 hub 名用例）
- `test/hub-server.test.cjs:44,100,165,188,230,300,316`（`cc_web_auth=hubtok` → `cc_web_hub_auth=hubtok`）
- `test/hub-server-main-agent.test.cjs:84,187`、`test/hub-static-cache.test.cjs:32,43`
- `README.md:294`
- 单机侧 `server.cjs:321,337`、单机 test/ **不动**。

### 3.2 hub `GET /jump` 端点（新建）

**为什么保留 GET**：原生 `<a href="/jump?m=&s=" target="_blank">` 是新标签直达的最小语义。改 POST 会破坏 `<a>` 直达，要求全局 JS 拦截 + fetch + window.open，退回 popup blocker 地狱。

**注册位置**：`hub/server.cjs:174`（`app.use(requireAuth)`）之后、`:180`（`app.get('/')`）之前。`/jump` **不**进 requireAuth 白名单（`hub/server.cjs:146-156`）——必须经鉴权 cookie。原评审"必须在登录页之前"是误解（GET /login 精确路径匹配，不拦 /jump）。

**入口校验**（按顺序）：
1. `m`：必填；`registry.getSecret(m)` 不存在 → 400 `unknown machine`（限定到 registry 已知集合，杜绝任意 URL 注入）。
2. `s`：必填；`isValidSessionName(s)`（`/^[A-Za-z0-9._-]{1,64}$/`，与 7684 `server.cjs:84` 一致）→ 否则 400（`s` 拼进 7684 Location 与日志，禁换行/路径分隔/空格）。
3. `next`：可选；走 `auth.normalizeNextPath` → 通过则 `encodeURIComponent` 拼到下游 ticket URL。

**fetch 下游 7684 `/api/auth/ticket`**：
- **不复用 `AgentClient` 现有方法**（`fetchDashboard`/`createSession`/`deleteSession` 均无超时，`hub/agent_client.cjs:18/31/44`）。
- **挂 `AbortSignal.timeout(3000)`**；失败**不重试**（一次性 URL，避免双消费）。
- **失败统一 502 `Bad Gateway`**（不回显 `ECONNREFUSED`/`ENOTFOUND`/401/超时——这些是内网探测信号）；详细进 `jumpAudit`。
- 审计：`startHub` 启动期新建独立 `jumpAudit = new AuditLog({ filePath: <dataDir>/jump-audit.jsonl })`（现有 `AuditLog` 实例只在 `setupMainAgent` 内，/jump 不可达）。失败记 `{ scope:'jump', event:'fetch_ticket_failed', detail:{ machine, session, code, msg } }`。

**拿到 ticket 后**：
- `res.header('Cache-Control', 'no-store')`（ticket 一次性，命中磁盘缓存会让"后退/前进"重放 → 7684 已消费 → 误导性"链接失效"）。
- `res.redirect(302, ${machineUrl}/login?ticket=${ticket}&next=${encNext})`。

**限流**：`jumpRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 })`，`check(req.ip)`。

**CSRF 残留风险（接受，理由见 §8）**。

### 3.3 7684 ticket 端点（mint + 消费分离）

**为什么**：hub `/jump` 是 GET（`<a target=_blank>` 不带 header），cookie 又跨 port 不通；ticket 是 hub 持 token 换一次性 cookie 注入的桥梁。

**mint：`POST /api/auth/ticket`**（hub→7684，带 `Authorization: Bearer <token>`）
- 位置：`server.cjs:367`（`requireAuth` 之后、`/api/config` 之前）。`requireAuth` 通过 Bearer 放行；未授权 → 401（不进限流/mint）。
- 鉴权直接复用 `auth.isAuthorized`（内部 `safeEqual` 时间安全），**不新写比较**。
- mint：
  - `const ticket = crypto.randomBytes(32).toString('base64url')`（256 bit 熵）。
  - 写入前 `tickets.size >= 1024` → 拒（429），让清扫回收。
  - `tickets.set(ticket, { expires: Date.now() + 15_000 })`。
  - 返回 `{ ticket }`。
- **DoS 防护**：模块级 `const tickets = new Map()` + `setInterval(() => { for ([k,v] of tickets) if (v.expires <= Date.now()) tickets.delete(k) }, 30_000).unref()`。
- 限流：`ticketRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 })`，key 用 `req.ip`（7684 `app.set('trust proxy',1)`，直连场景 `req.ip` 可被 `X-Forwarded-For` 伪造——内网部署可接受；公网部署应前置反代并设可信跳数，spec 注释此局限）。

**消费：`GET /login?ticket=...&next=...`**（浏览器顶层导航，hub 302 跳来）
- 位置：改 `server.cjs:287-293` 现有 GET /login。
- 消费流程（**关键：get→delete→check 三步无 await 间断**，锁死双消费窗口）：

  ```js
  const entry = tickets.get(ticket);
  if (entry) tickets.delete(ticket);            // 先 delete，再判断 expires，保证一次性
  if (!entry) return res.redirect('/login?next=' + encNext);   // 中性回登录，不泄露"已消费/已过期/不存在"
  if (entry.expires <= Date.now()) return res.redirect('/login?next=' + encNext);
  // 通过 → 设 cookie（与 POST /login 完全一致的选项：httpOnly/sameSite=lax/secure/path=/）
  res.cookie('cc_web_auth', token, { ... });
  res.redirect(nextPath || '/');
  ```

### 3.4 SSRF 校验

`hub/config.cjs:15-17 validateMachine` 现仅校验 url 非空。加：
1. `new URL(url)` 解析失败 → throw（try/catch 内）。
2. `protocol !== 'http:' && !== 'https:'` → throw（拒 `file:///`、`gopher://`）。
3. `hostname === '169.254.169.254'` → throw（云元数据高危）。
4. 不硬拒 loopback/私有网段（hub→各机通常走内网，硬拒会破坏合法本地编排）。

### 3.5 Referrer-Policy

ticket 进 302 Location → 浏览器对下一跳（7684 GET /login）的请求带 `Referer: hub:7685/jump?...&ticket=...` → 7684 access log 泄露 ticket。加全局中间件 `Referrer-Policy: same-origin`（跨 port 不算 same-origin，hub→7684 不发 Referer；单机运维内排查仍能看 Referer）。不用 `no-referrer`（过强）或 fragment（破坏 server 端一次性消费）。
- hub：`hub/server.cjs:62` 之后（urlencoded 之后、路由之前）。
- 7684：`server.cjs:70` 之后。

### 3.6 登出入口

tabbar 删除后 hub 无登出 UI。在 **`public/dashboard.html`** 的 header 末尾加：

```html
<form method="post" action="/logout" class="topbar-logout-form">
  <button type="submit" class="topbar-logout-btn">登出</button>
</form>
```

路由 `POST /logout`（`hub/server.cjs:132`）已存在并已挂 `requireSameOriginForUnsafeMethods`；唯一改动：`clearCookie('cc_web_auth')` → `clearCookie('cc_web_hub_auth')`。CSS 类由前端实施时落地。

### 3.7 7684 GET /login bug fix（顺手）

`server.cjs:287-293` 在 AUTH_TOKEN 未设时 `res.redirect('/')` 丢弃 `next`。改：`res.redirect(auth.normalizeNextPath(typeof req.query.next === 'string' ? req.query.next : '') || '/')`。与 §3.3 ticket 消费分支同点修复。

## 4. 看板卡片重构（Plan A）

### 4.1 新 DOM 骨架

```html
<li class="card-row"
    data-machine="<m.id>" data-session="<s.name>"
    data-status="<status>" data-key="<m.id>/<s.name>"
    role="group" aria-label="<m.name> / <s.name>">
  <button class="card__select" type="button"
          data-toggle="select" aria-pressed="false"
          aria-label="选择 <m.name> / <s.name>">☐</button>
  <a class="card"
     href="/jump?m=<m.id>&s=<s.name>"
     target="_blank" rel="noopener noreferrer"
     data-status="<status>"
     aria-label="<m.name> / <s.name>, <status>, 在新标签打开控制台">
    <span class="s-dot s-dot--<status>" aria-hidden="true"></span>
    <span class="s-icon" aria-hidden="true">…</span>
    <span class="card__name">…</span>
    <span class="card__session">…</span>
    <span class="card__last">…</span>
    <span class="card__time">…</span>
  </a>
</li>
```

**字段口径**：本代码 base 会话由 **`s.name`** 唯一标识（无 `s.id`），`dashboard.js:144 keyOf(machineId, sessionName)` 以 `/` 拼接。沿用 `s.name` + `/` 分隔。

**设计决策**：
1. `<li role="group" aria-label="m.name / s.name">`：同级 button + a 共同构成一张逻辑卡片，`group` 保留语义聚合（WCAG 1.3.1）。读屏进 li 先播"分组：…/…"，再播 button、再播 link。
2. **button 在前、a 在后**（匹配视觉左☐右主卡）：DOM 顺序 = 视觉顺序 = Tab 顺序（WCAG 1.3.2 + 2.4.3）。
3. **`<button type="button" aria-pressed>` 取代 `<span role="checkbox" tabindex="0" aria-checked>`**：(a) 原生 button 自带 Enter/Space→click，无需 JS keydown 委托（WCAG 2.1.1）；(b) `aria-pressed` 是 toggle button 标准状态（WCAG 4.1.2），比 `role=checkbox` 更贴切（不提交表单、仅切换视觉选中）；(c) 去 `tabindex="0"`（button 默认可聚焦）。
4. **不焊死 "7684"**：aria-label 用 `m.name`，端口可配。
5. **a 的 aria-label 去 lastLine**：现 `board_render.cjs:69` 把 `lastCleanRaw` 拼进 label，每 2s 轮询刷新 → 读屏用户每 2s 听一次新 last line，严重干扰。砍掉，只保留稳定的 `m.name / s.name, status, 在新标签打开控制台`。
6. `target="_blank" rel="noopener noreferrer"`：看板常驻 + 控制台并行；`noopener` 防 reverse-tabnabbing。aria-label 末尾"在新标签打开控制台"提前告知读屏用户（WCAG G201 + 3.2.3）。
7. **不给 roving tabindex**：卡片网格是平铺列表，非复合组件。逐张 Tab 可达符合读屏预期。
8. **data-* 全挂 li**：`data-machine`/`data-session`/`data-status`/`data-key`。JS 委托用 `data-key` 一步取值，不再 `keyOf(...)` 拼接。`data-status` **同时挂 li 和 a**（冗余但无损，保现有 `.card[data-status=...]` CSS 选择器不动，最小风险）。

### 4.2 JS 委托迁移（5 处，`public/dashboard.js`）

核心：`closest('.card')` → `closest('.card-row')`；状态读 `data-key`；button/a 通过 `row.querySelector('.card')`/`row.querySelector('.card__select')` 定位。

| # | 位置 | 旧 | 新 |
|---|------|----|----|
| 1 | click 委托 `:191-215` | `tog.closest('.card')` + 读 a 上 data-machine/session | `tog.closest('.card-row')` → `row.dataset.key` → `row.querySelector('.card')` |
| 2 | reapplySelected `:178-187` | `querySelectorAll('.card')` + `a.querySelector('.card__select')` | `querySelectorAll('.card-row')` + `row.querySelector('.card'/'card__select')` |
| 3 | sel-clear `:270-278` | `querySelectorAll('.card--selected')` + `a.querySelector('.card__select')` | `querySelectorAll('.card-row')` + 反查 `.card`/`.card__select` |
| 4 | keydown 委托 `:218-223` | Enter/Space 拦截 → `.click()` | **整段删除**——button 原生处理 |
| 5 | buildCardLi `:133-141` | `li.innerHTML = BR.buildCardInner(...)` | `li.innerHTML = BR.buildCardRow(...)`（新函数，返回完整 li 含 button + a） |

`setAttribute('aria-checked', …)` 全仓 4 处（`:184,201,212,275`）→ `aria-pressed`。`selected.set(key, { machine, session })` 存储结构不变，fanout WS payload 不变。

### 4.3 CSS 改动（`public/dashboard.css`）

- `:169` `.card-row`：加 `display:flex; align-items:stretch` + `.card-row > .card__select { flex:0 0 auto }` + `.card-row > .card { flex:1 1 auto; min-width:0 }`（让 button + a 同行，a 撑满）。
- `:170` `.card` grid：`grid-template-columns` 从 5 列（auto auto auto 1fr auto）减为 4 列（auto auto 1fr auto，删首列 card__select 占位）；`:182-186` 各子元素 `grid-column` 前移 1 位。
- `:181` `.card__select { grid-column:1; ... width:1.4em }`：**删整行**（已不在 .card grid 内；几何由 `:280` 段 `min-width:44px; min-height:44px` 接管）。
- `:282` `.card__select[aria-checked="true"]` → `[aria-pressed="true"]`（否则选中态不变色）。
- `:33` `.main`：`padding:16px 20px` → `padding:16px 20px calc(16px + env(safe-area-inset-bottom))`（tabbar 删后 + fanout hidden 时，末张卡被 iOS home indicator 遮）。

### 4.4 死代码清理

- `public/dashboard.html:44-47`：`<nav class="bottom-tabbar">` 整段删。
- `public/dashboard.css:82-101`：`.bottom-tabbar/.tab/.tab-icon/.tab-label/.tab--active/.tab--active::before/.tab:focus-visible` 全段删。
- `public/dashboard.css:311`：`[hidden]` 兜底删 `.tab[hidden]`。
- `public/dashboard.css:313-349`：switch-sheet 模态（`.switch-sheet-backdrop/.switch-sheet/@keyframes sheetUp/...`）整段删（switch_sheet.cjs 只被 console.html 加载，dashboard.html `:49-52` 不加载）。
- 保留：`.visually-hidden`（`:103-106`，dashboard.html:27 用）；`style.css:306` switch-sheet 段（index.html 用）。

### 4.5 空态文案（`public/dashboard.js`）

- `:294`（hub）：`暂无运行中的会话,在控制台启动一个。` → `暂无运行中的会话。请在某台被控机上启动 cc-web-control 进程。`
- `:57`（单机）：`还没有会话。在主控制台启动一个会话,这里会显示状态。` → `在本机启动 cc-web-control 会话后,这里会显示状态。`

## 5. 删除与路由

**删除（整文件）**：
- `public/console.html`、`public/console.js`、`public/console_render.cjs`
- `test/console_html.test.cjs`、`test/console_render.test.cjs`、`test/dashboard_tabbar.test.cjs`、`test/console_style.test.cjs`（拆分后整删，内容迁 §6）

**保留（grep 已确认）**：
- `public/switch_sheet.cjs`（`public/index.html:76` 仍加载）、`public/session_switch.cjs`（`public/index.html:75`）
- `test/switch_sheet.test.cjs`、`test/ios_header.test.cjs`、`test/bin_entry.test.cjs`、`test/tmux_capture_history.test.cjs`（非 console.html 依赖）

**删除安全性**：`console_render.cjs` 的 `parseCallout`/`nextBackoff` 唯一代码消费者是被删的 `console.js`，hub 后端主 agent 代码零依赖；`console.html`/`console.js` runtime 引用仅在被删文件、注释、`hub/server.cjs:179-180` 路由、测试中。

**路由**：`hub/server.cjs:180` `app.get('/', …res.redirect('/console.html'))` → `/dashboard.html`（同步改 `:178-179` 注释、`dashboard.js:72,136,190,355` 注释、`board_render.cjs:48` 注释）。

## 6. 测试重组

### 6.1 `console_style.test.cjs` 拆分映射（252 行混测，逐段去向）

| 段（行） | 内容 | 去向 |
|---|---|---|
| `:9` 读 console.html | 被测对象入参 | 随删 |
| `:12-30` console CSS 段/Tailwind 色/白线 bug | console 专属 | 删（CSS 段随 console 删） |
| `:31-43` `.console-app`/终端色 token | console 容器/token | token 段迁 `tokens.test.cjs`；`.console-app` 删 |
| `:44-58` 卡片网格/waiting-bg/reduced-motion/errored+selected | dashboard CSS | 迁 `dashboard_style.test.cjs` |
| `:59-67` buildCardHTML 输出 class 齐全 | board_render 契约 | 迁 `board_render.test.cjs` |
| `:68-75` `.ma-warn-line` 安全警告 | **CSS-only，保留** | 迁 `dashboard_style.test.cjs` |
| `:76-79` 抽屉 trigger 44pt | 读 console.html | 删（switch_sheet.test.cjs 已覆盖 7684 侧） |
| `:80-90` switch-sheet a11y（role/aria-modal/inert/焦点陷阱/Esc） | 读 switchSheetSrc | 迁 `switch_sheet.test.cjs` |
| `:91-107` switch-sheet 模态 CSS | 读 css | 迁 `dashboard_style.test.cjs` |
| `:108-160` stale 折叠/fleet summary/[hidden] 兜底/.main flex | dashboard CSS | 迁 `dashboard_style.test.cjs` |
| `:125-134` `.card__select[aria-checked]` | dashboard CSS | 迁 `dashboard_style.test.cjs`，**`:129` 改 `[aria-pressed="true"]`** |
| `:162-207` P5 `--offline` token + 离线对比度 | tokens.css 契约 | 迁 `tokens.test.cjs` |
| `:209-251` P6 :focus-visible / P8 input font-size | dashboard CSS | 迁 `dashboard_style.test.cjs` |

### 6.2 board_render.test.cjs 新契约

- `:43`：`<li class="card-row" data-key=…>` → 加 `data-machine/data-session/data-status`（data-* 上提 li）。
- `:45,:77`：`href="/console.html?m=…&s=…"` → **`href="/jump?m=…&s=…"`**（卡片点击跳 /jump，非 dashboard.html）。
- `:47-49`：data-machine/session/status 改查 `<li class="card-row">`。
- `:58-67`：`<span role="checkbox" aria-checked="false">` → **`<button type="button" aria-pressed="false">`**（无 role/aria-checked/tabindex）。
- 新增结构契约：`buildCardRow` 返回 li 内含**同级** button.card__select + a.card（兄弟，非嵌套）。

### 6.3 新增测试

| 文件 | 覆盖契约 |
|---|---|
| `test/hub-jump.test.cjs`（新建） | /jump 鉴权（无 cookie→login）、缺 m/缺 s→400、m 不在 registry→400、s 非法→400、上游 ticket 端点超时/非 2xx/网络错→502 中性、成功→302 带 ticket、rate-limit |
| `test/ticket-auth.test.cjs`（新建，7684） | `POST /api/auth/ticket`：Bearer 门控（无/错→401）、限流、Map 上限 1024；`GET /login?ticket=`：成功设 cookie+302、ticket 不存在/过期/重复消费→拒（一次性）、next 非法→normalizeNextPath 拒、AUTH_TOKEN 未设保留 next 回归 |
| `test/dashboard_style.test.cjs`（新建） | §6.1 迁入的 dashboard.css 层契约 |
| `test/tokens.test.cjs`（新建） | §6.1 迁入的 tokens.css 层契约 |
| cookie 隔离（新增 1 条，并入 hub-server.test.cjs） | hub 设 cc_web_hub_auth、7684 设 cc_web_auth，同 localhost 不互染 |

### 6.4 其他改动测试

- `test/hub-server.test.cjs:294,303,310`：`/console.html` → `/dashboard.html`（路由）。
- `test/hub-static-cache.test.cjs:33`：缓存列表 `['/console.js','/console.html',...]` → `['/dashboard.js','/dashboard.html','/dashboard_render.cjs']`。
- `test/dashboard-dual-mode.test.cjs:28`：`/console\.html\?m=/` → `/\/jump\?m=/`。

### 6.5 JS 行为测试兜底（dashboard.js IIFE 无法 require）

**首选**：jsdom 集成测试——加载 dashboard.html 模板 + 注入 4 个 `<script>`，stub `fetch` 返回固定 `/api/global-dashboard` payload，`dispatchEvent` 触发 `.card__select` click，断言 `aria-pressed` false→true、`selected.size` 0→1、`sessionStorage` 写入；再 click 回 false；sel-clear / reapply 同理。
**不抽纯函数委托**：委托逻辑强依赖 `e.target.closest` 与 `selected` Map 副作用，抽纯函数得 mock 一堆上下文，得不偿失。
**实施时评估**：若 jsdom polyfill（fetch/WebSocket/IndexedDB/matchMedia）成本过高，退化为手测（Task 8 E2E）兜底。

## 7. 改动清单汇总

### 删除（7 文件）
`public/console.html`、`public/console.js`、`public/console_render.cjs`、`test/console_html.test.cjs`、`test/console_render.test.cjs`、`test/dashboard_tabbar.test.cjs`、`test/console_style.test.cjs`

### 修改
- **auth.cjs**：`:38`（签名加 cookieName）、`:46`（读 cookieName）
- **hub/server.cjs**：`:62`（Referrer-Policy）、`:121`（写 cc_web_hub_auth）、`:134`（清 cc_web_hub_auth）、`:160-163`（requireAuth 传名）、`:174-180`（注册 /jump + `/`→/dashboard.html）、`:415-421`（WS 鉴权传名）、`POST /logout` clearCookie 改名、startHub opts 加 jumpRateLimiter/jumpAudit
- **server.cjs（7684）**：`:38`（ticketRateLimiter）、`:70`（Referrer-Policy）、`:287-293`（GET /login 消费 ticket + bug fix）、`:367`（POST /api/auth/ticket）、模块级 tickets Map + 清扫 interval
- **hub/config.cjs**：`:15-17`（SSRF 校验）
- **public/board_render.cjs**：`:48,69,75,76,77,88-93,183`（新 buildCardRow、button+a 同级、aria-pressed、href=/jump、aria-label 去 lastLine）
- **public/dashboard.js**：`:57,72,133-141,136,178-187,190,191-215,218-223(删),270-278,294,355`
- **public/dashboard.css**：`:33,82-101,169,170,181-186,282,311,313-349`
- **public/dashboard.html**：`:44-47`（删 tabbar）、header 加 logout form
- **测试**：`auth.test.cjs`、`hub-server.test.cjs`、`hub-server-main-agent.test.cjs`、`hub-static-cache.test.cjs`、`board_render.test.cjs`、`dashboard-dual-mode.test.cjs`、`switch_sheet.test.cjs`、`README.md:294`

### 新增（5 文件）
`test/hub-jump.test.cjs`、`test/ticket-auth.test.cjs`、`test/dashboard_style.test.cjs`、`test/tokens.test.cjs`、dashboard.html logout form

## 8. 已知残留风险（接受，附理由）

1. **GET /jump 的 CSRF**：GET 有副作用（mint ticket + 302 链设 cookie）。但：(a) SameSite=Lax cookie 对 `<img>` 等 subresource **不发**，攻击者塞 img 拿不到鉴权 cookie → requireAuth 重定向 login；(b) 顶层导航（`<a>`/`window.location`）受害者立刻在地址栏看到目标 URL；(c) `m` 必须 registry 内，攻击者只能引导受害者跳到其本就能跳的机器；(d) 后果=切到用户本就能控制的机器。综合可接受。加 `Cache-Control: no-store` 兜底。保留 GET 以保原生新标签直达。
2. **cookie 值仍是长期 AUTH_TOKEN**（既有，非本次引入）：ticket 模型本可根治（cookie 改 opaque session id），本次不修（scope 蔓延），列为 follow-up。
3. **cookie 改名强制 hub 用户重登**：升级即生效（旧 cc_web_auth 不再被读）。不做双名兼容（双名会抵消改名收益）。升级公告写明。
4. **7684 trust proxy 直连伪造 IP**：ticket 端点限流按 `req.ip`，直连无反代时可被 `X-Forwarded-For` 伪造。内网部署可接受；公网部署应前置反代并设可信跳数。

## 9. 实施前核查项

1. `grep -rn "cc_web_auth" public/`：确认无前端 JS 读 cookie（预期无）。
2. `test/console_scroll_layout.test.cjs`、`test/console_scroll_sticky.test.cjs`：grep 是否 `readFileSync(console.html/console.js/console_render.cjs)`；若 yes，随删或迁。
3. dashboard.css `===== 多机控制台` 段（console 专属规则如 `.console-app/.console-topbar/.console-hero/.console-term/#ma-screen`）的迁移边界：随 console 删，保留部分由 `dashboard_style.test.cjs` 覆盖。
4. dashboard.html logout 按钮的 CSS 类落地（`topbar-logout-form/btn`）。

## 10. 不做（YAGNI）

- 不改单机侧 cookie 名、不改单机 test/ 的 `cc_web_auth`。
- 不引入 CSRF token 中间件（GET /jump 风险已论证可接受）。
- 不把 cookie 值改 opaque session id（follow-up）。
- 不给卡片网格加 roving tabindex。
- 不抽 dashboard 选择逻辑为纯函数模块（jsdom 集成测试足够）。
