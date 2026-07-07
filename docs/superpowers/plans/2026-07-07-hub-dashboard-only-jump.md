# 7685 Hub 看板化 + 卡片跳转单机 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7685 hub 仅保留看板页 `/dashboard.html`；点击 agent 卡片在新标签打开该机 7684 实例并直达特定 session，通过一次性 ticket 自动登录。

**Architecture:** hub 新增 `GET /jump` 鉴权跳转端点 → 服务端到服务端向目标机 `POST /api/auth/ticket` 换 15s 一次性 ticket → 302 到目标机 `/login?ticket=` → 目标机消费 ticket 设 cookie → 302 到 `/?session=`。卡片重构为 `<li class="card-row">` 下 `<button>` + `<a>` 同级（解决非法 ARIA 嵌套 + 适配新 href）。

**Tech Stack:** Express 4 + ws + 原生 JS（UMD `.cjs` 前端模块）+ `node:test`/`node:assert`。Node >=18。

## Global Constraints

- 纯 JS，无前端框架、无构建步骤、无 TypeScript。
- 测试：`node --test test/<file>.test.cjs`（单文件）/ `npm test`（全套件）。风格：`require('node:test')` + `require('node:assert/strict')` + `require('../<mod>.cjs')`。
- Cookie 名约定：单机 7684 = `cc_web_auth`（不变），hub 7685 = `cc_web_hub_auth`。单机侧代码与测试**不动** cookie 名。
- `auth.isAuthorized` 参数化为 `isAuthorized({cookieHeader, authorizationHeader}, expectedToken, cookieName='cc_web_auth')`，向后兼容。
- commit 消息：`<type>(<scope>): <desc>`，不加 Co-Authored-By（项目惯例，attribution 全局禁用）。每个任务结束提交一次。
- session 标识用 `s.name`（代码 base 无 `s.id`），`data-key` = `<m.id>/<s.name>`，分隔符 `/`。
- cookie 值仍为长期 AUTH_TOKEN（既有风险，本计划不动，spec §8 follow-up）。
- 主 agent 代码保留、默认关闭（`hub/main_agent_env.cjs:21`），本计划不动。

## File Structure

**后端**
- `auth.cjs` — 加 `cookieName` 参数（读写 cookie 名的唯一来源）
- `hub/server.cjs` — cookie 改名、`/jump` 端点、Referrer-Policy、`/` 路由、logout clearCookie
- `hub/config.cjs` — `validateMachine` SSRF 校验
- `hub/audit_log.cjs` — 复用（不改动），`/jump` 新建独立实例
- `server.cjs`（7684）— `POST /api/auth/ticket` mint、`GET /login` 消费 ticket + bug fix、Referrer-Policy、tickets Map
- `rate_limit.cjs` — 复用 `createRateLimiter`（不改动）

**前端**
- `public/board_render.cjs` — 新 `buildCardRow`（button+a 同级），`buildCardInner` 拆分
- `public/dashboard.js` — 5 处委托迁移、aria-pressed、空态文案、注释
- `public/dashboard.css` — `.card-row` flex、grid 列数、aria-pressed 选择器、.main safe-area、删 tabbar/switch-sheet 死代码
- `public/dashboard.html` — 删 tabbar、header 加 logout form

**测试**
- 改：`test/auth.test.cjs`、`test/hub-server.test.cjs`、`test/hub-server-main-agent.test.cjs`、`test/hub-static-cache.test.cjs`、`test/board_render.test.cjs`、`test/dashboard-dual-mode.test.cjs`、`test/switch_sheet.test.cjs`
- 新建：`test/hub-jump.test.cjs`、`test/ticket-auth.test.cjs`、`test/dashboard_style.test.cjs`、`test/tokens.test.cjs`
- 删除：`test/console_html.test.cjs`、`test/console_render.test.cjs`、`test/dashboard_tabbar.test.cjs`、`test/console_style.test.cjs`（拆分后删）

**删除**
- `public/console.html`、`public/console.js`、`public/console_render.cjs`

---

## Task 1: auth.isAuthorized cookie 名参数化

**Files:**
- Modify: `auth.cjs:38,46`
- Test: `test/auth.test.cjs`

**Interfaces:**
- Produces: `isAuthorized({cookieHeader, authorizationHeader}, expectedToken, cookieName='cc_web_auth')` — Task 2/6 依赖此签名传 `'cc_web_hub_auth'`

- [ ] **Step 1: 写失败测试**

在 `test/auth.test.cjs` 末尾追加：

```js
test('isAuthorized accepts custom cookie name (hub)', () => {
  const ok = auth.isAuthorized(
    { cookieHeader: 'cc_web_hub_auth=hubtok', authorizationHeader: '' },
    'hubtok',
    'cc_web_hub_auth'
  );
  assert.equal(ok, true);
});

test('isAuthorized default cookie name still works (single-machine)', () => {
  const ok = auth.isAuthorized(
    { cookieHeader: 'cc_web_auth=tok', authorizationHeader: '' },
    'tok'
  );
  assert.equal(ok, true);
});

test('isAuthorized ignores wrong-name cookie', () => {
  const ok = auth.isAuthorized(
    { cookieHeader: 'cc_web_auth=tok', authorizationHeader: '' },
    'tok',
    'cc_web_hub_auth'
  );
  assert.equal(ok, false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/auth.test.cjs`
Expected: 3 FAIL（custom cookie name 用例失败，因为 `cookies.cc_web_auth` 写死读不到 `cc_web_hub_auth`）

- [ ] **Step 3: 参数化实现**

改 `auth.cjs:38` 和 `:46`：

```js
function isAuthorized({ cookieHeader, authorizationHeader }, expectedToken, cookieName = 'cc_web_auth') {
  const token = typeof expectedToken === 'string' ? expectedToken : '';
  if (!token) return true; // auth disabled

  const bearer = extractBearerToken(authorizationHeader);
  if (bearer && safeEqual(bearer, token)) return true;

  const cookies = parseCookieHeader(cookieHeader);
  const cookieToken = cookies[cookieName];
  if (cookieToken && safeEqual(cookieToken, token)) return true;

  return false;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/auth.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add auth.cjs test/auth.test.cjs
git commit -m "feat(auth): isAuthorized 支持 cookieName 参数(为 hub 改名铺路)"
```

---

## Task 2: hub cookie 改名 cc_web_hub_auth

**Files:**
- Modify: `hub/server.cjs`（写 cookie ~:121、清 cookie ~:134、requireAuth ~:160-163、WS 鉴权 ~:415-421、logout clearCookie ~:134）
- Test: `test/hub-server.test.cjs`、`test/hub-server-main-agent.test.cjs`、`test/hub-static-cache.test.cjs`

**Interfaces:**
- Consumes: Task 1 的 `isAuthorized(..., cookieName)`
- Produces: hub 全站读写 `cc_web_hub_auth`

- [ ] **Step 1: 改 hub 测试的 cookie 名（红）**

`test/hub-server.test.cjs`：所有 `Cookie: 'cc_web_auth=hubtok'`（约 :44,100,165,188,300,316）→ `'cc_web_hub_auth=hubtok'`；`:230` 断言 `/cc_web_auth=hubtok/` → `/cc_web_hub_auth=hubtok/`。
`test/hub-server-main-agent.test.cjs:84,187`：`cc_web_auth=T` → `cc_web_hub_auth=T`。
`test/hub-static-cache.test.cjs:32,43`：`cc_web_auth=tok` → `cc_web_hub_auth=tok`。

```js
// 各处统一替换,示例(hub-server.test.cjs):
{ Cookie: 'cc_web_hub_auth=hubtok' }
assert.match(setCookie, /cc_web_hub_auth=hubtok/)
```

- [ ] **Step 2: 跑 hub 测试确认失败**

Run: `node --test test/hub-server.test.cjs test/hub-server-main-agent.test.cjs test/hub-static-cache.test.cjs`
Expected: FAIL（hub 实现仍写 cc_web_auth，测试期望 cc_web_hub_auth）

- [ ] **Step 3: 改 hub 实现改写 cookie 名**

`hub/server.cjs`：
- POST `/login` 成功处（~:121）：`res.cookie('cc_web_auth', token, {...})` → `res.cookie('cc_web_hub_auth', token, {...})`（cookie 选项 httpOnly/sameSite:'lax'/secure/path:'/' 不变）
- POST `/logout`（~:134）：`res.clearCookie('cc_web_auth', { path: '/' })` → `res.clearCookie('cc_web_hub_auth', { path: '/' })`
- `requireAuth`（~:160-163）：`auth.isAuthorized({ cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization }, hubToken)` → 加第三参 `,'cc_web_hub_auth'`
- WS 鉴权（~:415-421）：同上，`auth.isAuthorized(...)` 调用加 `,'cc_web_hub_auth'`

```js
// requireAuth 示例
const ok = auth.isAuthorized(
  { cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization },
  hubToken,
  'cc_web_hub_auth'
);
```

- [ ] **Step 4: 跑 hub 测试确认通过**

Run: `node --test test/hub-server.test.cjs test/hub-server-main-agent.test.cjs test/hub-static-cache.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add hub/server.cjs test/hub-server.test.cjs test/hub-server-main-agent.test.cjs test/hub-static-cache.test.cjs
git commit -m "feat(hub): cookie 改名 cc_web_hub_auth(隔离单机同 host 覆盖)"
```

---

## Task 3: 7684 POST /api/auth/ticket mint 端点

**Files:**
- Modify: `server.cjs`（模块级 tickets Map + 清扫 interval ~文件顶部 require 区后、ticketRateLimiter ~:38、`POST /api/auth/ticket` 端点 ~:367）
- Test: `test/ticket-auth.test.cjs`（新建）

**Interfaces:**
- Consumes: `auth.isAuthorized`（经 `requireAuth`，Bearer 门控）、`createRateLimiter`
- Produces: `POST /api/auth/ticket` 返回 `{ticket}`；模块级 `tickets` Map（Task 4 消费）

- [ ] **Step 1: 写失败测试**

新建 `test/ticket-auth.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const HOST = '127.0.0.1';
const TOKEN = 'test-ticket-token';

function req(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: HOST, port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function withServer(fn) {
  process.env.AUTH_TOKEN = TOKEN;
  const { startServer } = require('../server.cjs');
  const server = await startServer({ host: HOST, port: 0, authToken: TOKEN });
  const port = server.address().port;
  try { await fn(port); } finally { server.close(); delete process.env.AUTH_TOKEN; }
}

test('POST /api/auth/ticket requires Bearer', async () => {
  await withServer(async (port) => {
    const noAuth = await req(port, 'POST', '/api/auth/ticket');
    assert.equal(noAuth.status, 401);
  });
});

test('POST /api/auth/ticket rejects wrong token', async () => {
  await withServer(async (port) => {
    const wrong = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: 'Bearer wrong' },
    });
    assert.equal(wrong.status, 401);
  });
});

test('POST /api/auth/ticket mints a ticket with valid Bearer', async () => {
  await withServer(async (port) => {
    const ok = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(ok.status, 200);
    const parsed = JSON.parse(ok.body);
    assert.ok(parsed.ticket && parsed.ticket.length >= 40);
  });
});
```

> 注：`startServer` 的确切导出名与签名需对照 `server.cjs` 现有导出（若现导出为 `start()` 或直接 `app.listen`，调整测试为 `require('../server.cjs')` 顶层即启动 + `close`，或用现有 hub 测试里启动单机的同款 helper）。实施时先 `grep -n "module.exports\|listen\|startServer" server.cjs` 确认。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/ticket-auth.test.cjs`
Expected: FAIL（端点不存在，404 或连接错）

- [ ] **Step 3: 实现 mint 端点**

`server.cjs` 顶部（require 区之后）加模块级状态：

```js
const crypto = require('node:crypto');
const { createRateLimiter } = require('./rate_limit.cjs');

// 一次性 ticket 存储:mint 时写入,GET /login 消费时立即删除
const tickets = new Map();
const TICKET_TTL_MS = 15_000;
const TICKET_MAX = 1024;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.expires <= now) tickets.delete(k);
}, 30_000).unref();

const ticketRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
```

（`crypto` 若已 require 则不重复；`createRateLimiter` 若已 require 则不重复。）

在 `server.cjs` `app.use(requireAuth)`（~:365）之后、`/api/config`（~:368）之前加：

```js
app.post('/api/auth/ticket', (req, res) => {
  const { limited } = ticketRateLimiter.check(req.ip);
  if (limited) return res.status(429).type('text/plain').send('rate limited');
  // requireAuth 已校验 Bearer(通过 isAuthorized)
  if (tickets.size >= TICKET_MAX) {
    return res.status(503).type('json').send(JSON.stringify({ error: 'ticket capacity' }));
  }
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, { expires: Date.now() + TICKET_TTL_MS });
  res.type('json').send(JSON.stringify({ ticket }));
});
```

> 确认 `requireAuth` 白名单（`server.cjs` ~:341-363）不含 `/api/auth/*` —— `/api/auth/ticket` 天然要求 Bearer。若白名单用了前缀匹配 `/api/` 放行，需排除 `/api/auth/`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/ticket-auth.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server.cjs test/ticket-auth.test.cjs
git commit -m "feat(auth): 7684 新增 POST /api/auth/ticket mint 端点(一次性 ticket)"
```

---

## Task 4: 7684 GET /login 消费 ticket + next bug fix

**Files:**
- Modify: `server.cjs:287-293`（GET /login）
- Test: `test/ticket-auth.test.cjs`（扩充）

**Interfaces:**
- Consumes: Task 3 的 `tickets` Map、`auth.normalizeNextPath`
- Produces: `GET /login?ticket=&next=` 消费后设 `cc_web_auth` cookie + 302

- [ ] **Step 1: 写失败测试**

在 `test/ticket-auth.test.cjs` 追加：

```js
test('GET /login consumes ticket, sets cookie, redirects', async () => {
  await withServer(async (port) => {
    const minted = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = JSON.parse(minted.body);
    const consumed = await req(port, 'GET', `/login?ticket=${ticket}&next=/?session=s1`);
    assert.equal(consumed.status, 302);
    assert.equal(consumed.headers.location, '/?session=s1');
    const setCookie = consumed.headers['set-cookie'] || [];
    assert.ok(setCookie.some((c) => /^cc_web_auth=/.test(c)));
  });
});

test('GET /login rejects already-consumed ticket (one-time)', async () => {
  await withServer(async (port) => {
    const minted = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = JSON.parse(minted.body);
    await req(port, 'GET', `/login?ticket=${ticket}`);
    const second = await req(port, 'GET', `/login?ticket=${ticket}`);
    assert.equal(second.status, 302);
    // 中性回登录,不设 cookie
    const setCookie = second.headers['set-cookie'] || [];
    assert.ok(!setCookie.some((c) => /^cc_web_auth=[^;]+;/.test(c) && !/Max-Age=0/.test(c)));
  });
});

test('GET /login without AUTH_TOKEN preserves next (bug fix)', async () => {
  // auth disabled 场景:startServer 不传 token
  const { startServer } = require('../server.cjs');
  const server = await startServer({ host: HOST, port: 0, authToken: '' });
  const port = server.address().port;
  try {
    const r = await req(port, 'GET', '/login?next=/?session=s2');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/?session=s2');
  } finally { server.close(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/ticket-auth.test.cjs`
Expected: 新 3 条 FAIL（GET /login 现不消费 ticket、丢 next）

- [ ] **Step 3: 改 GET /login 消费 ticket + bug fix**

改 `server.cjs:287-293` GET /login handler：

```js
app.get('/login', (req, res) => {
  const nextPath = auth.normalizeNextPath(typeof req.query.next === 'string' ? req.query.next : '') || '/';

  // ticket 消费(hub /jump 跳来):get → delete → check,三步无 await,锁死双消费
  const ticketRaw = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  if (ticketRaw) {
    const entry = tickets.get(ticketRaw);
    if (entry) tickets.delete(ticketRaw);           // 先删,保证一次性
    if (!entry || entry.expires <= Date.now()) {
      return res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    // 消费成功 → 设 cookie(与 POST /login 同款选项)
    const token = String(req.app.locals.authToken || '');
    if (token) {
      res.cookie('cc_web_auth', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!(req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'),
        path: '/',
      });
    }
    return res.redirect(nextPath);
  }

  // AUTH_TOKEN 未设时不再丢 next(bug fix)
  res.sendFile('login.html', { root: publicDir });
});
```

> 现有"AUTH_TOKEN 未设 → `res.redirect('/')` 丢 next"的分支删掉，统一用上面的 `nextPath`。POST /login 设 cookie 的选项（httpOnly/sameSite/secure/path）需与此处一致——对照 `server.cjs:320-326` 现有 POST /login 的 `res.cookie` 选项复制，确保 token 变量名（`req.app.locals.authToken` 或模块级 `authToken`）与现有代码一致。实施时 `grep -n "res.cookie('cc_web_auth'" server.cjs` 对齐。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/ticket-auth.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server.cjs test/ticket-auth.test.cjs
git commit -m "feat(auth): GET /login 消费一次性 ticket + 修 next 丢弃 bug"
```

---

## Task 5: hub/config.cjs SSRF 校验

**Files:**
- Modify: `hub/config.cjs:15-17`（`validateMachine`）
- Test: 现有 config 测试或新建（`grep -n "validateMachine\|config" test/` 确认归属）

**Interfaces:**
- Produces: `validateMachine` 拒绝非 http/https + 拒 `169.254.169.254`

- [ ] **Step 1: 写失败测试**

`grep -rn "validateMachine\|require.*hub/config" test/` 找到现有 config 测试文件（若无，新建 `test/hub-config.test.cjs`）：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMachine } = require('../hub/config.cjs');

function expectThrow(id, url) {
  assert.throws(() => validateMachine({ id, name: id, url, token: 't' }), /url/i);
}

test('validateMachine accepts http/https', () => {
  assert.doesNotThrow(() => validateMachine({ id: 'm1', name: 'm1', url: 'http://127.0.0.1:7684', token: 't' }));
  assert.doesNotThrow(() => validateMachine({ id: 'm2', name: 'm2', url: 'https://host', token: 't' }));
});

test('validateMachine rejects non-http protocols (SSRF)', () => {
  expectThrow('f1', 'file:///etc/passwd');
  expectThrow('f2', 'gopher://x');
  expectThrow('f3', 'javascript:alert(1)');
});

test('validateMachine rejects malformed url', () => {
  expectThrow('f4', 'not a url');
});

test('validateMachine rejects cloud metadata IP', () => {
  expectThrow('f5', 'http://169.254.169.254/latest/meta-data');
});
```

> `validateMachine` 的确切导出名与签名需对照 `hub/config.cjs`（可能导出 `validateMachine` 或在 `loadConfig` 内联）。若内联，把校验抽成可导出函数再测。实施时先 `grep -n "validateMachine\|url" hub/config.cjs`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/hub-config.test.cjs`（或对应文件）
Expected: FAIL（现仅校验非空）

- [ ] **Step 3: 实现校验**

改 `hub/config.cjs:15-17` `validateMachine`：

```js
function validateMachine({ id, name, url, token }) {
  if (typeof id !== 'string' || !id) throw new Error(`machine id 缺失`);
  if (typeof name !== 'string' || !name) throw new Error(`machine "${id}": 缺 name`);
  if (typeof url !== 'string' || !url) throw new Error(`machine "${id}": 缺 url`);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`machine "${id}": url 非法`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`machine "${id}": url 须 http/https`);
  }
  if (parsed.hostname === '169.254.169.254') {
    throw new Error(`machine "${id}": url 拒云元数据地址`);
  }
  if (typeof token !== 'string' || !token) throw new Error(`machine "${id}": 缺 token`);
  return { id, name, url: parsed.href, token };
}
```

> `parsed.href` 会规范化 URL；若现有代码依赖保留原始 `url` 字符串，改成 `url`（不重新赋值）。其他字段校验对照现有 `validateMachine` 保留。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/hub-config.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add hub/config.cjs test/hub-config.test.cjs
git commit -m "feat(hub): validateMachine 加 SSRF 校验(限 http/https,拒元数据 IP)"
```

---

## Task 6: hub GET /jump 端点 + Referrer-Policy

**Files:**
- Modify: `hub/server.cjs`（Referrer-Policy ~:62、`jumpRateLimiter` + `jumpAudit` 在 `startHub` 内、`GET /jump` 注册 ~:175-180）
- Modify: `server.cjs:70`（7684 Referrer-Policy）
- Test: `test/hub-jump.test.cjs`（新建）

**Interfaces:**
- Consumes: Task 1 cookie 参数化、Task 5 SSRF（经 registry）、`registry.getSecret`、`createRateLimiter`、`AuditLog`、7684 `/api/auth/ticket`（Task 3）
- Produces: `GET /jump?m=&s=` → 302 到目标机 `/login?ticket=&next=`

- [ ] **Step 1: 写失败测试**

新建 `test/hub-jump.test.cjs`。复用 `test/hub-server.test.cjs` 里启动 hub 的 helper（`grep -n "startHub\|createHubApp\|app =" test/hub-server.test.cjs` 找启动方式）。骨架：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const HUB_TOKEN = 'hubtok';

function req(port, method, path, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject).end();
  });
}

// 用 hub-server.test.cjs 同款方式启动 hub(注入一台机器 registry)
async function withHub(fn) {
  // 实施时对照 test/hub-server.test.cjs 的启动 helper 复用
  const { startHub } = require('../hub/server.cjs');
  const server = await startHub({
    host: '127.0.0.1', port: 0, authToken: HUB_TOKEN,
    machines: [{ id: 'm1', name: 'mac-pro', url: 'http://127.0.0.1:7684', token: 'mtoken' }],
  });
  const port = server.address().port;
  try { await fn(port); } finally { server.close(); }
}

test('GET /jump requires auth', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=m1&s=ses-1');
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /\/login/);  // 未授权重定向登录
  });
});

test('GET /jump rejects missing m or s', async () => {
  await withHub(async (port) => {
    const h = { Cookie: 'cc_web_hub_auth=hubtok' };
    assert.equal((await req(port, 'GET', '/jump?m=m1', { headers: h })).status, 400);
    assert.equal((await req(port, 'GET', '/jump?s=ses-1', { headers: h })).status, 400);
  });
});

test('GET /jump rejects unknown machine', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=ghost&s=ses-1', { headers: { Cookie: 'cc_web_hub_auth=hubtok' } });
    assert.equal(r.status, 400);
  });
});

test('GET /jump rejects invalid session name', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=m1&s=bad session', { headers: { Cookie: 'cc_web_hub_auth=hubtok' } });
    assert.equal(r.status, 400);
  });
});
```

> `startHub` 签名与 machines 注入方式对照 `test/hub-server.test.cjs` 现有用例复用。`/jump` 调下游机器的 fetch 在单测里会失败（无真实 7684），故上游失败用例断言 502：

```js
test('GET /jump returns 502 when upstream unreachable', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=m1&s=ses-1', { headers: { Cookie: 'cc_web_hub_auth=hubtok' } });
    assert.equal(r.status, 502);
    // 中性文案,不泄露 ECONNREFUSED 等
    assert.ok(!/ECONNREFUSED|ENOTFOUND/.test(r.body));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/hub-jump.test.cjs`
Expected: FAIL（/jump 不存在，404）

- [ ] **Step 3: 实现 /jump + Referrer-Policy**

`hub/server.cjs` 顶部中间件区（`app.use(express.urlencoded(...))` 之后，~:62）加：

```js
app.use((req, res, next) => { res.setHeader('Referrer-Policy', 'same-origin'); next(); });
```

`startHub` 内（与 `aggregator` 同级）加：

```js
const { createRateLimiter } = require('./rate_limit.cjs');
const AuditLog = require('./audit_log.cjs');  // 若已 require 不重复
const jumpRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
const jumpAudit = new AuditLog({ filePath: require('node:path').join(dataDir, 'jump-audit.jsonl') });
```

在 `app.use(requireAuth)`（~:174）之后、`app.get('/')`（~:180）之前注册：

```js
const SESSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

app.get('/jump', (req, res) => {
  const { limited } = jumpRateLimiter.check(req.ip);
  if (limited) return res.status(429).type('text/plain').send('rate limited');

  const m = String(req.query.m || '');
  const s = String(req.query.s || '');
  if (!m || !s) return res.status(400).type('text/plain').send('missing m or s');
  if (!SESSION_RE.test(s)) return res.status(400).type('text/plain').send('bad session');

  const secret = registry.getSecret(m);
  if (!secret) return res.status(400).type('text/plain').send('unknown machine');

  const nextPath = auth.normalizeNextPath(typeof req.query.next === 'string' ? req.query.next : '') || `/?session=${encodeURIComponent(s)}`;
  const encNext = encodeURIComponent(nextPath);

  fetch(`${secret.url}/api/auth/ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret.token}` },
    signal: AbortSignal.timeout(3000),
  })
    .then((up) => {
      if (!up.ok) throw new Error('http_' + up.status);
      return up.json();
    })
    .then(({ ticket }) => {
      res.header('Cache-Control', 'no-store');
      res.redirect(302, `${secret.url}/login?ticket=${encodeURIComponent(ticket)}&next=${encNext}`);
    })
    .catch((e) => {
      jumpAudit.log({ scope: 'jump', runId: null, event: 'fetch_ticket_failed',
        detail: { machine: m, session: s, code: e.code || e.message } });
      res.status(502).type('text/plain').send('Bad Gateway');
    });
});
```

> `fetch` 是 Node 18+ 内置全局。`dataDir`、`registry` 变量名对照 `startHub` 现有解构。`AuditLog` 构造与 `.log` 签名对照 `hub/audit_log.cjs`（`grep -n "constructor\|log(" hub/audit_log.cjs`）。`/jump` **不**加入 requireAuth 白名单（`hub/server.cjs:146-156`）——必须经鉴权 cookie。

7684 Referrer-Policy：`server.cjs:70`（urlencoded 之后）同样加：

```js
app.use((req, res, next) => { res.setHeader('Referrer-Policy', 'same-origin'); next(); });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/hub-jump.test.cjs`
Expected: 全部 PASS（含 502 中性文案）

- [ ] **Step 5: 提交**

```bash
git add hub/server.cjs server.cjs test/hub-jump.test.cjs
git commit -m "feat(hub): GET /jump 跳转端点 + Referrer-Policy(新标签直达单机)"
```

---

## Task 7: board_render buildCardRow（Plan A DOM 结构）

**Files:**
- Modify: `public/board_render.cjs:48,69,75-77,88-93,183`
- Test: `test/board_render.test.cjs`

**Interfaces:**
- Produces: `buildCardRow(machine, session, opts)` → 完整 `<li class="card-row">` HTML 串（含同级 button + a）；`buildCardInner` 拆为只返回 `<a class="card">`（Task 8 的 dashboard.js 调用 `buildCardRow`）

- [ ] **Step 1: 写失败测试**

改 `test/board_render.test.cjs`。先 `grep -n "buildCardHTML\|buildCardInner\|card-row\|card__select\|aria-checked\|console.html" test/board_render.test.cjs` 看现有断言。新增/改：

```js
const BR = require('../public/board_render.cjs');

test('buildCardRow emits li.card-row with sibling button + a', () => {
  const html = BR.buildCardRow(
    { id: 'm1', name: 'mac-pro' },
    { name: 'ses-1', status: 'working' },
    {}
  );
  assert.match(html, /<li class="card-row"[^>]* data-machine="m1"[^>]* data-session="ses-1"[^>]* data-key="m1\/ses-1"[^>]* role="group"/);
  assert.match(html, /<button class="card__select" type="button"[^>]* aria-pressed="false"/);
  assert.match(html, /<a class="card"[^>]* href="\/jump\?m=m1&amp;s=ses-1"[^>]* target="_blank"[^>]* rel="noopener noreferrer"/);
  // button 在 a 之前(同级,DOM 顺序)
  const btnIdx = html.indexOf('class="card__select"');
  const aIdx = html.indexOf('class="card"');
  assert.ok(btnIdx > -1 && aIdx > btnIdx, 'button 应在 a 之前');
});

test('buildCardRow aria-label uses machine name, not port 7684', () => {
  const html = BR.buildCardRow({ id: 'm1', name: 'mac-pro' }, { name: 'ses-1', status: 'idle' }, {});
  assert.ok(!/7684/.test(html));
  assert.match(html, /mac-pro/);
});

test('buildCardRow a aria-label excludes lastLine', () => {
  const html = BR.buildCardRow(
    { id: 'm1', name: 'mac-pro' },
    { name: 'ses-1', status: 'working', lastLine: 'some output' },
    {}
  );
  // a 的 aria-label 不含 lastLine(避免 2s 轮询刷新干扰读屏)
  const aMatch = html.match(/<a class="card"[^>]*aria-label="([^"]*)"/);
  assert.ok(aMatch);
  assert.ok(!/some output/.test(aMatch[1]));
});
```

同时把现有 `board_render.test.cjs` 里断言 `role="checkbox"`/`aria-checked`/`href="/console.html` 的行（约 :45,:58-67,:77）改成本任务的 button+/jump/aria-pressed 契约（见 spec §6.2）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/board_render.test.cjs`
Expected: FAIL（buildCardRow 不存在；现有 console.html/aria-checked 断言与新契约冲突）

- [ ] **Step 3: 实现 buildCardRow + 拆分 buildCardInner**

改 `public/board_render.cjs`：

`:75` href：
```js
const href = `/jump?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
```

`:69` a 的 aria-label（去 lastCleanRaw，加"在新标签打开控制台"，不焊 7684）：
```js
const label = `${m.name || m.id} / ${s.name}, ${meta.label}, 在新标签打开控制台`;
```

`:51-85` `buildCardInner` 改为只返回 `<a class="card">`（移除内嵌的 `.card__select` span、移除 `data-machine`/`data-session`/`data-key`，保留 `data-status`）：
```js
function buildCardInner(machine, session, opts) {
  const midRaw = String(machine && machine.id != null ? machine.id : '');
  const sessRaw = String(session && session.name != null ? session.name : '');
  const href = `/jump?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
  const meta = statusMeta(session && session.status);
  const label = `${machine.name || machine.id} / ${session.name}, ${meta.label}, 在新标签打开控制台`;
  const st = escapeHtml(String(session && session.status || 'unknown'));
  // ... 其余 .s-dot/.s-icon/.card__name/.card__session/.card__last/.card__time 拼接保持
  return `<a class="card${opts && opts.active ? ' active' : ''}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-status="${st}" aria-label="${escapeHtml(label)}">…内容 spans…</a>`;
}
```

`:88-93` 新增 `buildCardRow`，保留 `buildCardHTML` 作 thin wrapper：
```js
function buildCardRow(machine, session, opts) {
  const mid = String(machine && machine.id != null ? machine.id : '');
  const sess = String(session && session.name != null ? session.name : '');
  const key = `${mid}/${sess}`;
  const st = escapeHtml(String(session && session.status || 'unknown'));
  const grpLabel = escapeHtml(`${machine.name || machine.id} / ${session.name}`);
  const togLabel = escapeHtml(`选择 ${machine.name || machine.id} / ${session.name}`);
  return `<li class="card-row" data-machine="${escapeHtml(mid)}" data-session="${escapeHtml(sess)}" data-status="${st}" data-key="${escapeHtml(key)}" role="group" aria-label="${grpLabel}"><button class="card__select" type="button" data-toggle="select" aria-pressed="false" aria-label="${togLabel}">☐</button>${buildCardInner(machine, session, opts)}</li>`;
}

function buildCardHTML(machine, session, opts) {
  return buildCardRow(machine, session, opts);
}
```

`:183` exports 加 `buildCardRow`。`:48` 注释更新为 button+a 同级、/jump。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/board_render.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add public/board_render.cjs test/board_render.test.cjs
git commit -m "feat(board): buildCardRow 输出 button+a 同级(Plan A,跳 /jump)"
```

---

## Task 8: dashboard.js 委托迁移（Plan A 行为）

**Files:**
- Modify: `public/dashboard.js:57,72,133-141,136,178-187,190,191-215,216-223(删),270-278,294,355`

**Interfaces:**
- Consumes: Task 7 的 `buildCardRow`、新 DOM（`data-key` 在 `<li class="card-row">`、button aria-pressed）

> **测试策略**：`dashboard.js` 是顶层 IIFE，加载即跑 `fetch`/`WebSocket`/`setInterval`，无 jsdom 基建（项目零前端测试依赖）。DOM 结构正确性由 Task 7 的 `buildCardRow` 单测兜底；本任务的委托行为用**手动 E2E 验证清单**确认（Step 4）。不抽纯函数委托（委托强依赖 `closest` + `selected` Map 副作用，抽取得不偿失，见 spec §6.5）。

- [ ] **Step 1: 改 click 委托（`:191-215`）**

```js
boardBody.addEventListener('click', function (e) {
  var tog = e.target.closest('[data-toggle="select"]');
  if (!tog) return;  // 其余区域放行 → <a href="/jump?m=&s=" target=_blank> 原生开新标签
  e.preventDefault();
  var row = tog.closest('.card-row');
  if (!row) return;
  var key = row.getAttribute('data-key');
  var card = row.querySelector('.card');
  if (selected.has(key)) {
    selected.delete(key);
    if (card) card.classList.remove('card--selected');
    tog.setAttribute('aria-pressed', 'false');
    tog.textContent = '☐';
  } else {
    if (selected.size >= 50) selected.clear();  // 上限保护保留
    selected.set(key, { machine: row.getAttribute('data-machine'), session: row.getAttribute('data-session') });
    if (card) card.classList.add('card--selected');
    tog.setAttribute('aria-pressed', 'true');
    tog.textContent = '☑';
  }
  persistSelected();
  renderFanout();
});
```

> 对照现有 `:191-215` 保留 `selected.size >= 50` 上限、`persistSelected()`、`renderFanout()` 调用。

- [ ] **Step 2: 改 reapplySelected / sel-clear / buildCardLi / 删 keydown**

`reapplySelected`（`:178-187`）：
```js
function reapplySelected() {
  var rows = boardBody.querySelectorAll('.card-row');
  Array.prototype.forEach.call(rows, function (row) {
    var key = row.getAttribute('data-key');
    if (selected.has(key)) {
      var card = row.querySelector('.card');
      var tog = row.querySelector('.card__select');
      if (card) card.classList.add('card--selected');
      if (tog) { tog.setAttribute('aria-pressed', 'true'); tog.textContent = '☑'; }
    }
  });
}
```

`sel-clear`（`:270-278`）：
```js
Array.prototype.forEach.call(boardBody.querySelectorAll('.card-row'), function (row) {
  var card = row.querySelector('.card');
  var tog = row.querySelector('.card__select');
  if (card) card.classList.remove('card--selected');
  if (tog) { tog.setAttribute('aria-pressed', 'false'); tog.textContent = '☐'; }
});
```

`buildCardLi`（`:133-141`）：`li.innerHTML = BR.buildCardInner(...)` → `li.innerHTML = BR.buildCardRow(card.machine, card.session, { active: ... })`；删除手动设 `li.dataset.key`（buildCardRow 已注入 data-key）。

`keydown` 委托（`:216-223` + 注释）：**整段删除**——`<button type="button">` 原生处理 Enter/Space。

- [ ] **Step 3: 改空态文案 + 注释**

`:294`：`暂无运行中的会话,在控制台启动一个。` → `暂无运行中的会话。请在某台被控机上启动 cc-web-control 进程。`
`:57`：`还没有会话。在主控制台启动一个会话,这里会显示状态。` → `在本机启动 cc-web-control 会话后,这里会显示状态。`
`:72,136,190,355` 注释：`/console.html?m=&s=` → `/jump?m=&s=`，"跳单机控制台" → "新标签开控制台"。

- [ ] **Step 4: 手动 E2E 验证**

```bash
# 1. 启动一台单机(7684)
AUTH_TOKEN=tok1 node server.cjs &

# 2. 启动 hub(7685),注册该机器
CC_WEB_HUB_AUTH_TOKEN=hubtok node hub/server.cjs &  # 或经 config.json

# 3. 浏览器打开 http://127.0.0.1:7685/dashboard.html,登录 hub
```

验证清单（逐项打勾）：
- [ ] 点卡片空白处（非 ☐）→ 新标签打开 `127.0.0.1:7684/?session=<s>`，已登录无需输 token
- [ ] 点 ☐ 按钮 → 该卡高亮（card--selected）、☐ 变 ☑、按钮 aria-pressed=true（DevTools 查看）；不触发跳转
- [ ] 选 2 张 → 底部扇出 bar 出现
- [ ] 点扇出"清空" → 所有卡取消高亮、☐ 复位、扇出 bar 消失
- [ ] 轮询刷新（等 2s）→ 已选卡片保持高亮 + ☑（reapplySelected 生效）
- [ ] Tab 键逐张聚焦卡片：先 ☐ 按钮、后卡片链接，顺序符合视觉
- [ ] ☐ 按钮原生响应 Enter/Space（无需 JS 模拟）

- [ ] **Step 5: 提交**

```bash
git add public/dashboard.js
git commit -m "feat(dashboard): 迁移多选委托到 .card-row + aria-pressed + 空态文案"
```

---

## Task 9: dashboard.css Plan A + 死代码 + safe-area

**Files:**
- Modify: `public/dashboard.css:33,82-101,169,170,181-186,282,311,313-349`
- Test: `test/dashboard_style.test.cjs`（新建）

**Interfaces:**
- Consumes: Task 7 的 button+a 同级 DOM

- [ ] **Step 1: 写 CSS 锁测试**

新建 `test/dashboard_style.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');

test('.card-row is flex (button + a 同行)', () => {
  assert.match(css, /\.card-row\s*{[^}]*display:\s*flex/);
  assert.match(css, /\.card-row\s*>\s*\.card\s*{[^}]*flex:\s*1/);
});

test('.card__select uses aria-pressed not aria-checked', () => {
  assert.match(css, /\.card__select\[aria-pressed="true"\]/);
  assert.ok(!/\.card__select\[aria-checked="true"\]/.test(css));
});

test('.card grid has 4 columns (card__select 移出后)', () => {
  assert.match(css, /\.card\s*{[^}]*grid-template-columns:\s*auto auto 1fr auto/);
});

test('.main has safe-area bottom padding', () => {
  assert.match(css, /\.main\s*{[^}]*env\(safe-area-inset-bottom\)/);
});

test('.ma-warn-line retained (P3 regression lock)', () => {
  assert.match(css, /\.ma-warn-line/);
});

test('tabbar and switch-sheet dead CSS removed', () => {
  assert.ok(!/\.bottom-tabbar/.test(css));
  assert.ok(!/\.switch-sheet-backdrop/.test(css));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/dashboard_style.test.cjs`
Expected: FAIL（flex/aria-pressed/safe-area 缺；tabbar/switch-sheet 还在）

- [ ] **Step 3: 改 CSS**

`public/dashboard.css`：
- `:33` `.main`：`padding: 16px 20px;` → `padding: 16px 20px calc(16px + env(safe-area-inset-bottom));`
- `:82-101` 整段（`.bottom-tabbar`/`.tab`/`.tab--active`/...）：**删除**
- `:169` `.card-row`：
  ```css
  .card-row { list-style: none; display: flex; align-items: stretch; }
  .card-row > .card__select { flex: 0 0 auto; }
  .card-row > .card { flex: 1 1 auto; min-width: 0; }
  ```
- `:170` `.card` grid：`grid-template-columns: auto auto auto 1fr auto;` → `grid-template-columns: auto auto 1fr auto;`（5 列减为 4 列）
- `:181` `.card__select { grid-column:1; grid-row:1; ... width:1.4em; }`：**删除整行**
- `:182-186` 各子元素 `grid-column` 前移 1 位：`.card .s-dot`→`grid-column:1`；`.card .s-icon`→`:2`；`.card__name`→`:3`；`.card__time`→`:4`；`.card__session`→`grid-column:3; grid-row:2`；`.card__last`（`1 / -1`）不变
- `:282` `.card__select[aria-checked="true"]` → `.card__select[aria-pressed="true"]`
- `:283` 注释 `tabindex=0 键盘可达` → `原生 button 键盘可达`
- `:311` `[hidden]` 兜底删 `.tab[hidden]`：`#main-agent-panel[hidden], .console-term[hidden], .tab[hidden]` → `#main-agent-panel[hidden], .console-term[hidden]`
- `:313-349` switch-sheet 模态整段：**删除**

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/dashboard_style.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add public/dashboard.css test/dashboard_style.test.cjs
git commit -m "style(dashboard): .card-row flex + aria-pressed + safe-area,删 tabbar/switch-sheet 死 CSS"
```

---

## Task 10: dashboard.html 删 tabbar + logout form

**Files:**
- Modify: `public/dashboard.html:44-47`（删 tabbar）、header 区（加 logout form）
- Test: 手动验证 + `test/publish_files.test.cjs`（可选反向断言）

- [ ] **Step 1: 删 tabbar**

`public/dashboard.html:44-47` `<nav class="bottom-tabbar" ...>...</nav>` 整段删除。

- [ ] **Step 2: header 加 logout form**

在 `<header>` 内（`<div id="hub-status">` 或同级 header 元素末尾）加：

```html
<form method="post" action="/logout" class="topbar-logout-form">
  <button type="submit" class="topbar-logout-btn">登出</button>
</form>
```

CSS（加到 `public/dashboard.css`，Task 9 已提交则追加到本任务或合并）：
```css
.topbar-logout-form { margin-left: auto; }
.topbar-logout-btn { min-height: 44px; min-width: 44px; padding: 0 12px; }
```

> header 的确切结构与 `<div id="hub-status">` 位置对照 `public/dashboard.html` 现有 `<header>`。logout 路由 `POST /logout`（`hub/server.cjs:132`）已存在并挂 same-origin 校验，cookie 名已在 Task 2 改为 `cc_web_hub_auth`。

- [ ] **Step 3: 验证**

Run: `node --test test/publish_files.test.cjs`（若存在 publish 文件清单测试，确认 dashboard.html 仍包含 + console.html 不在）
手动：启动 hub，确认看板顶部出现"登出"按钮，点击后回到 `/login`。

- [ ] **Step 4: 提交**

```bash
git add public/dashboard.html public/dashboard.css
git commit -m "feat(dashboard): 删 tabbar + header 加登出按钮"
```

---

## Task 11: 删除 console 页 + 牵连测试

**Files:**
- Delete: `public/console.html`、`public/console.js`、`public/console_render.cjs`、`test/console_html.test.cjs`、`test/console_render.test.cjs`、`test/dashboard_tabbar.test.cjs`

**Interfaces:**
- Consumes: Task 6（/jump 替代 console 跳转）、Task 7（board_render 不再依赖 console_render）

> 删除前确认 `grep -rn "require.*console_render\|console\.html\|console\.js" public/ hub/ bin/ *.cjs` 除注释外无 runtime 引用（预期：board_render.cjs 的注释参照、dashboard.js 注释，已在 Task 7/8 处理或随删）。

- [ ] **Step 1: 实施前核查**

```bash
grep -rn "cc_web_auth" public/          # 预期无前端 JS 读 cookie
grep -rn "console_render\|console\.html\|console\.js" public/ hub/ bin/ *.cjs
# 确认 test/console_scroll_layout.test.cjs / test/console_scroll_sticky.test.cjs 是否 readFileSync(console.*);若 yes,随删或迁
grep -n "console" test/console_scroll_layout.test.cjs test/console_scroll_sticky.test.cjs
```

- [ ] **Step 2: 删除文件**

```bash
git rm public/console.html public/console.js public/console_render.cjs
git rm test/console_html.test.cjs test/console_render.test.cjs test/dashboard_tabbar.test.cjs
```

（若 Step 1 发现 console_scroll_* 读 console 文件，一并 `git rm`。）

- [ ] **Step 3: 跑全套件确认无残留引用**

Run: `npm test`
Expected: 全部 PASS（删除的测试随被测代码消失；若 FAIL 为某测试仍引用 console 文件，按报错处理——迁或删）

- [ ] **Step 4: 提交**

```bash
git commit -m "chore: 删除 console 页及牵连测试(hub 仅保留看板)"
```

---

## Task 12: hub `/` → /dashboard.html 路由 + 牵连测试

**Files:**
- Modify: `hub/server.cjs:178-180`、`test/hub-server.test.cjs:294,303,310`、`test/hub-static-cache.test.cjs:33`、`test/dashboard-dual-mode.test.cjs:28`

- [ ] **Step 1: 改测试（红）**

`test/hub-server.test.cjs:294,303,310`：`/console.html` → `/dashboard.html`。
`test/hub-static-cache.test.cjs:33`：缓存列表 `['/console.js','/console.html','/dashboard_render.cjs']` → `['/dashboard.js','/dashboard.html','/dashboard_render.cjs']`。
`test/dashboard-dual-mode.test.cjs:28`：`/console\.html\?m=/` → `/\/jump\?m=/`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/hub-server.test.cjs test/hub-static-cache.test.cjs test/dashboard-dual-mode.test.cjs`
Expected: FAIL（实现仍指向 console.html）

- [ ] **Step 3: 改路由**

`hub/server.cjs:180`：`app.get('/', (req, res) => res.redirect('/console.html'))` → `res.redirect('/dashboard.html')`；同步改 `:178-179` 注释。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/hub-server.test.cjs test/hub-static-cache.test.cjs test/dashboard-dual-mode.test.cjs`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add hub/server.cjs test/hub-server.test.cjs test/hub-static-cache.test.cjs test/dashboard-dual-mode.test.cjs
git commit -m "feat(hub): 根路由 / 重定向 /dashboard.html"
```

---

## Task 13: console_style.test.cjs 拆分重组

**Files:**
- Delete: `test/console_style.test.cjs`（拆分后删）
- Create/Modify: `test/dashboard_style.test.cjs`（Task 9 已建，追加段）、`test/tokens.test.cjs`（新建）、`test/switch_sheet.test.cjs`（追加）、`test/board_render.test.cjs`（追加，Task 7 已改）

> 按 spec §6.1 拆分映射表逐段迁移。`console_style.test.cjs` 混了 5 类契约。

- [ ] **Step 1: 迁移非 console 依赖段**

按 spec §6.1：
- 读 `css` 的 dashboard CSS 段（卡片网格/`.ma-warn-line`/`[hidden]`/P6 focus-visible/P8 font-size 等）→ 追加到 `test/dashboard_style.test.cjs`
- 读 `tokens` 的段（P5 `--offline`/`--term-bg`/`--s-dot--idle` 描边/离线对比度）→ 新建 `test/tokens.test.cjs`
- 读 `switchSheetSrc` 的 a11y 段（role/aria-modal/inert/焦点陷阱/Esc）→ 追加到 `test/switch_sheet.test.cjs`
- buildCardHTML 输出 class 契约段 → 已在 Task 7 并入 `test/board_render.test.cjs`
- console 专属段（`.console-app`/`.console-hero`/读 console.html 的 trigger 44pt）→ **不迁，随删**

每段迁移时把 `readFileSync(console.html)`/`readFileSync(console.js)` 入参去掉，只保留各自 `css`/`tokens`/`switchSheetSrc` 读取。

`test/tokens.test.cjs` 骨架：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const tokens = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'tokens.css'), 'utf8');

test('P5 --offline token + offline contrast 4.5:1', () => {
  assert.match(tokens, /--offline:/);
  // ... 迁自 console_style :162-207
});

test('--term-bg/--term-fg defined', () => {
  assert.match(tokens, /--term-bg:/);
  assert.match(tokens, /--term-fg:/);
});
```

- [ ] **Step 2: 删 console_style.test.cjs**

```bash
git rm test/console_style.test.cjs
```

- [ ] **Step 3: 跑全套件确认拆分后覆盖不丢**

Run: `npm test`
Expected: 全部 PASS。逐项确认：dashboard_style/tokens/switch_sheet/board_render 各覆盖了原 console_style 的非 console 段。

- [ ] **Step 4: 提交**

```bash
git add test/dashboard_style.test.cjs test/tokens.test.cjs test/switch_sheet.test.cjs test/board_render.test.cjs
git commit -m "test: 拆分 console_style.test.cjs → dashboard_style/tokens/switch_sheet/board_render"
```

---

## Task 14: README + 全套件回归

**Files:**
- Modify: `README.md:294`（cookie 名）

- [ ] **Step 1: 改 README**

`README.md:294`：`cookie（cc_web_auth）` → `cookie（cc_web_hub_auth，hub）/ cc_web_auth（单机）`（对照上下文调整措辞）。

- [ ] **Step 2: 全套件回归**

Run: `npm test`
Expected: 全部 PASS，无 skip/timeout。

- [ ] **Step 3: 端到端冒烟**

按 Task 8 Step 4 的 E2E 清单完整跑一遍（启动单机 + hub、登录 hub、点卡片新标签直达单机 session、扇出多选、登出）。确认：
- [ ] hub 登录写 `cc_web_hub_auth`、单机登录写 `cc_web_auth`，同 localhost 不互染
- [ ] ticket 一次性（同 ticket 二次消费被拒）
- [ ] /jump 失败给中性 502（断开单机后测试）
- [ ] Referrer-Policy: same-origin 响应头存在（DevTools Network 确认）

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: README 同步 cookie 名(hub cc_web_hub_auth / 单机 cc_web_auth)"
```

---

## Self-Review

**1. Spec 覆盖**：
- §3.1 cookie 参数化 → Task 1, 2 ✓
- §3.2 /jump → Task 6 ✓
- §3.3 ticket mint/消费 → Task 3, 4 ✓
- §3.4 SSRF → Task 5 ✓
- §3.5 Referrer-Policy → Task 6 ✓
- §3.6 登出 → Task 10 ✓
- §3.7 bug fix → Task 4 ✓
- §4 卡片重构（DOM/JS/CSS/死代码/空态）→ Task 7, 8, 9, 10 ✓
- §5 删除与路由 → Task 11, 12 ✓
- §6 测试重组 → Task 13 + 各任务内嵌测试 ✓
- §9 实施前核查 → Task 11 Step 1、Task 14 Step 3 ✓
- §8 残留风险 → Global Constraints（cookie=token follow-up）+ Task 6（CSRF 决策已在 spec 记录）✓

**2. Placeholder 扫描**：无 TBD/TODO。几处标注"对照现有代码确认导出名/行号"（startHub/startServer 签名、AuditLog.log 签名、POST /login cookie 选项），这是对真实代码的核实指引（给出 grep 命令），非 placeholder——实施者按 grep 结果对齐。✓

**3. 类型/命名一致性**：
- `cookieName` 参数：Task 1 定义 → Task 2/6 使用 ✓
- `buildCardRow`：Task 7 定义 → Task 8 调用 ✓
- `data-key` 在 `<li class="card-row">`：Task 7 产出 → Task 8 读 `row.getAttribute('data-key')` ✓
- `aria-pressed`：Task 7 产出 → Task 8 setAttribute → Task 9 CSS 选择器 ✓
- ticket 端点 `/api/auth/ticket`：Task 3 实现 → Task 6 fetch 调用 ✓
- cookie 名 `cc_web_hub_auth`（hub）/ `cc_web_auth`（单机）：Task 2/6/10（hub）vs Task 4（单机）✓

无遗漏。
