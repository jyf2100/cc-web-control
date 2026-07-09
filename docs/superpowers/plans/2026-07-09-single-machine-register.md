# 单机反向注册 + hub 自动发现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单机启动时主动经反向 WebSocket 向 hub 注册，hub 运行时动态发现机器（连接即在线、断开即下线、重连自愈），数据通道（看板轮询 + 出站 WS 终端）完全不变。

**Architecture:** 新增两条独立链路：单机侧 `RegisterClient`（主动连 hub 的 WS client，带退避分叉自愈）与 hub 侧 `AgentRegistrar`（接受注册连接、动态增删 `MachineRegistry`、回连失败反馈）。现有 hub→单机的轮询与出站 WS 零改动，`DashboardAggregator` 仍 `registry.all()` 自动覆盖动态机器。`hub-machines.json` 走 deprecate 窗口（种子并存 + WARN）。

**Tech Stack:** Node.js >=18，CommonJS（`.cjs`，`require`/`module.exports`），express ^4，ws ^8，测试用内置 `node:test` + `node:assert/strict`。零新依赖。

## Global Constraints

- 所有新代码 CommonJS：文件首行 `'use strict';`，`require`/`module.exports`，不引入新 npm 依赖（仅 express/ws/Node 内置）。
- id 校验复用 `hub/config.cjs` 的 `ID_RE = /^[A-Za-z0-9._-]{1,32}$/`（禁 `/`）。
- 机器校验复用 `hub/config.cjs` 的 `validateMachine(raw, index)`（含 `169.254.169.254` SSRF 防护）。
- 鉴权失败统一 `ws.close(1008, 'Unauthorized')`（与现有浏览器 WS 一致，`hub/server.cjs:485`）。
- 退避常量：短退避 base 500ms、×2、封顶 30000ms；鉴权拒绝长退避 5min、连续 3 次后停止；所有退避叠加 ±20% jitter。
- 不可变风格：registry 增删用新对象替换 `_byId` 条目，不就地突变。
- 文件 <800 行，中文注释对齐现有风格。
- 测试：`node --test test/*.test.cjs`；端口用 `0`（随机）；异步等待用固定 `setTimeout`（无 fake clock）；重连测试只断言「timer 已调度」不等真实退避。
- 配置变更需重启单机生效（不支持热重载）。

---

## File Structure

**新建：**
- `register_client.cjs`（根目录）— 单机反向注册 WS client。导出 `RegisterClient` 类 + 常量。独立可测（不依赖 server.cjs）。
- `hub/register_server.cjs` — hub 侧注册处理器。导出 `AgentRegistrar` 类 + 常量。独立可测。
- `test/register-client.test.cjs`、`test/hub-register-server.test.cjs`、`test/hub-register-e2e.test.cjs`

**修改：**
- `hub/registry.cjs` — 加 `add(machine, conn)` / `remove(id)`；`all()`/`getById()` 剥离 `conn`。
- `config_loader.cjs` — `SINGLE_SCHEMA` 加 5 字段、`HUB_SCHEMA` 加 1 字段。
- `hub/server.cjs` — WS connection 路径分流到 `AgentRegistrar`；启动期 machines 保留作种子 + deprecate WARN；`fetchOne` 失败回送 unreachable；`close()` 清理 registrar。
- `hub/server_entry.cjs` — 传 `registerToken`；`machinesFile` 保留（deprecate）。
- `server.cjs` — 解构新 CFG 字段；条件启动 `RegisterClient`；SIGINT 关闭纳入。
- `config.example.json`、`README.md` — 字段同步 + 部署流程 + 安全说明。

---

### Task 1: MachineRegistry 动态增删

**Files:**
- Modify: `hub/registry.cjs:4-38`
- Test: `test/hub-registry.test.cjs`（追加用例）

**Interfaces:**
- Produces: `MachineRegistry.prototype.add(machine, conn)`、`.remove(id)`；`all()`/`getById()` 对外不含 `token` 与 `conn`；`getSecret(id)` 不变（含 token、不含 conn）。

- [ ] **Step 1: 写失败测试** — 追加到 `test/hub-registry.test.cjs` 末尾（`module.exports` 或文件末尾的最后一个 `test(...)` 之后）

```js
test('MachineRegistry 动态 add/remove + conn 不外泄', () => {
  const r = new MachineRegistry([]); // 空
  const fakeConn = { alive: true };
  r.add({ id: 'dyn1', name: 'D1', url: 'http://h:1', token: 'secret' }, fakeConn);

  assert.equal(r.all().length, 1);
  const snap = r.all()[0];
  assert.equal(snap.id, 'dyn1');
  assert.equal(snap.token, undefined, 'all() 不含 token');
  assert.equal(snap.conn, undefined, 'all() 不含 conn');
  assert.equal(snap.online, false, 'add 后 online 初值 false（交 aggregator）');

  assert.deepEqual(r.getSecret('dyn1'), { id: 'dyn1', name: 'D1', url: 'http://h:1', token: 'secret' }, 'getSecret 含 token、不含 conn');

  // 重复 id 覆盖
  r.add({ id: 'dyn1', name: 'D1-new', url: 'http://h:2', token: 'secret2' }, { alive: true });
  assert.equal(r.all().length, 1);
  assert.equal(r.getById('dyn1').name, 'D1-new');

  r.remove('dyn1');
  assert.equal(r.all().length, 0);
  assert.equal(r.getSecret('dyn1'), undefined);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `node --test test/hub-registry.test.cjs`
Expected: FAIL — `r.add is not a function`

- [ ] **Step 3: 实现** — 改 `hub/registry.cjs`

把 `all()` 与 `getById()` 的解构改为剥离 `conn`，并新增 `add`/`remove`：

```js
  all() {
    return Array.from(this._byId.values()).map(({ token, conn, ...rest }) => rest);
  }

  getById(id) {
    const m = this._byId.get(id);
    if (!m) return undefined;
    const { token, conn, ...rest } = m;
    return rest;
  }
```

在 `setOnline` 之前新增：

```js
  // 运行时注册:单机反向 WS 连上时调用。conn 为注册连接句柄(仅用于下线感知,不外泄)。
  add(machine, conn = null) {
    this._byId.set(machine.id, { ...machine, online: false, lastError: null, conn });
  }

  // 运行时下线:注册连接断开时调用。
  remove(id) {
    this._byId.delete(id);
  }
```

`getSecret`（现有 `hub/registry.cjs:34-37`）已只取 `{id,name,url,token}`，不动。

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/hub-registry.test.cjs`
Expected: PASS（全文件绿，含原有用例）

- [ ] **Step 5: Commit**

```bash
git add hub/registry.cjs test/hub-registry.test.cjs
git commit -m "feat(hub): MachineRegistry 支持运行时 add/remove + conn 不外泄"
```

---

### Task 2: config_loader 新增字段

**Files:**
- Modify: `config_loader.cjs:166-202`（SINGLE_SCHEMA、HUB_SCHEMA）
- Test: `test/config_loader.test.cjs`（追加用例）

**Interfaces:**
- Produces: 单机配置新增 `hubUrl`/`hubToken`/`hubRegisterToken`/`machineId`/`publicUrl`（env `CC_WEB_HUB_URL`/`CC_WEB_HUB_TOKEN`/`CC_WEB_HUB_REGISTER_TOKEN`/`CC_WEB_MACHINE_ID`/`CC_WEB_PUBLIC_URL`）；hub 配置新增 `hubRegisterToken`（env `CC_WEB_HUB_REGISTER_TOKEN`）。

- [ ] **Step 1: 写失败测试** — 追加到 `test/config_loader.test.cjs`

```js
test('SINGLE_SCHEMA 含 hub 注册字段(env 覆盖 + 默认空串)', () => {
  const f = writeTmp(JSON.stringify({ machineId: 'box-1' }));
  const { config } = loadConfig({
    schema: SINGLE_SCHEMA,
    defaultFilePath: f,
    argv: [],
    env: { CC_WEB_HUB_URL: 'http://hub:7685', CC_WEB_HUB_TOKEN: 'tok', CC_WEB_HUB_REGISTER_TOKEN: 'reg', CC_WEB_PUBLIC_URL: 'http://10.0.0.5:7684' },
  });
  assert.equal(config.hubUrl, 'http://hub:7685');
  assert.equal(config.hubToken, 'tok');
  assert.equal(config.hubRegisterToken, 'reg');
  assert.equal(config.machineId, 'box-1', 'file 值生效');
  assert.equal(config.publicUrl, 'http://10.0.0.5:7684');
});

test('HUB_SCHEMA 含 hubRegisterToken', () => {
  const { config } = loadConfig({
    schema: HUB_SCHEMA,
    defaultFilePath: '/nonexistent.json',
    argv: [],
    env: { CC_WEB_HUB_TOKEN: 'ht', CC_WEB_HUB_REGISTER_TOKEN: 'rt' },
  });
  assert.equal(config.hubToken, 'ht');
  assert.equal(config.hubRegisterToken, 'rt');
});
```

（`config_loader.cjs:204-207` 已导出 `SINGLE_SCHEMA`/`HUB_SCHEMA`；`test/config_loader.test.cjs:6` 现为 `const { loadConfig, parseConfigFlag } = require('../config_loader.cjs');`，改为 `const { loadConfig, parseConfigFlag, SINGLE_SCHEMA, HUB_SCHEMA } = require('../config_loader.cjs');`。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --test test/config_loader.test.cjs`
Expected: FAIL — `config.hubUrl` 为 `undefined`

- [ ] **Step 3: 实现** — 改 `config_loader.cjs`

在 `SINGLE_SCHEMA`（`wsPingInterval` 那行之后、闭合 `};` 之前）追加 5 字段：

```js
  wsPingInterval:      { type: 'number',  env: 'CC_WEB_WS_PING_INTERVAL',      default: 30000, min: 1 },
  hubUrl:              { type: 'string',  env: 'CC_WEB_HUB_URL',               default: '' },
  hubToken:            { type: 'string',  env: 'CC_WEB_HUB_TOKEN',             default: '' },
  hubRegisterToken:    { type: 'string',  env: 'CC_WEB_HUB_REGISTER_TOKEN',    default: '' },
  machineId:           { type: 'string',  env: 'CC_WEB_MACHINE_ID',            default: '' },
  machineName:         { type: 'string',  env: 'CC_WEB_MACHINE_NAME',          default: '' },
  publicUrl:           { type: 'string',  env: 'CC_WEB_PUBLIC_URL',            default: '' },
```

在 `HUB_SCHEMA`（`hubToken` 那行之后）追加：

```js
  hubToken:          { type: 'string', env: 'CC_WEB_HUB_TOKEN',                 default: '' },
  hubRegisterToken:  { type: 'string', env: 'CC_WEB_HUB_REGISTER_TOKEN',        default: '' },
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/config_loader.test.cjs`
Expected: PASS（全文件绿）

- [ ] **Step 5: Commit**

```bash
git add config_loader.cjs test/config_loader.test.cjs
git commit -m "feat(config): 单机/hub schema 加 hub 注册字段"
```

---

### Task 3: 单机 RegisterClient 模块

**Files:**
- Create: `register_client.cjs`
- Test: `test/register-client.test.cjs`

**Interfaces:**
- Consumes: `hub/config.cjs` 的 `ID_RE`。
- Produces: `RegisterClient` 类，构造 `{ hubUrl, registerToken, machineId, machineName, publicUrl, authToken, bindHost, port, log }`；方法 `.start()` / `.close()`；导出常量 `PING_INTERVAL_MS=20000`、`RECONNECT_BASE_MS=500`、`RECONNECT_MAX_MS=30000`、`AUTH_REJECT_BACKOFF_MS=300000`、`AUTH_REJECT_MAX_ATTEMPTS=3`。

- [ ] **Step 1: 写失败测试** — `test/register-client.test.cjs`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { RegisterClient } = require('../register_client.cjs');

// 起一个假 hub WS server(路径 /api/hub/agent),返回 { server, wss, port, received, controls }
function startFakeHub({ rejectOnce = false, onRegister } = {}) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const received = [];
  const accepted = [];
  wss.on('connection', (ws, req) => {
    if (!req.url.startsWith('/api/hub/agent')) { ws.close(1008); return; }
    if (rejectOnce) { ws.close(1008, 'Unauthorized'); return; }
    accepted.push(ws);
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      received.push(m);
      if (m.type === 'register' && onRegister) onRegister(ws, m);
      if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server, wss, port: server.address().port, received, accepted,
    stop: () => new Promise((r) => { wss.close(); server.close(() => r()); }),
  })));
}

test('start 后连上 hub 并发 register 帧(id/url 推导正确)', async () => {
  const hub = await startFakeHub({ onRegister: (ws) => ws.send(JSON.stringify({ type: 'registered' })) });
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`,
    registerToken: 'regtok',
    authToken: 'authtok',
    bindHost: '127.0.0.1', port: 7684, machineId: '', machineName: '', publicUrl: '',
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(hub.received.some((m) => m.type === 'register' && m.id && m.url === 'http://127.0.0.1:7684' && m.token === 'authtok'));
  rc.close();
  await hub.stop();
});

test('machineId 显式优先,否则用 hostname', async () => {
  const hub = await startFakeHub({ onRegister: (ws) => ws.send(JSON.stringify({ type: 'registered' })) });
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 't', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: 'my-id', machineName: '', publicUrl: '',
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(hub.received.find((m) => m.type === 'register').id, 'my-id');
  rc.close(); await hub.stop();
});

test('1008 鉴权拒绝 → 长退避 + 计数, 达上限停止重连', async () => {
  const hub = await startFakeHub({ rejectOnce: false }); // 持续拒绝(每条连接都 close 1008)
  // 改造为持续拒绝:
  hub.wss.removeAllListeners('connection');
  let rejects = 0;
  hub.wss.on('connection', (ws) => { rejects++; ws.close(1008, 'Unauthorized'); });
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 't', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: 'm', machineName: '', publicUrl: '',
    authRejectBackoffMs: 50, authRejectMaxAttempts: 3, // 测试用短间隔
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(rejects <= 3, `应最多尝试 3 次,实际 ${rejects}`);
  assert.equal(rc._stopped, true, '达上限后停止');
  rc.close(); await hub.stop();
});

test('未配 hubUrl 时不启动(start 无副作用)', () => {
  const rc = new RegisterClient({
    hubUrl: '', registerToken: '', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: '', machineName: '', publicUrl: '',
  });
  rc.start(); // 不应抛错、不应建连
  assert.equal(rc._ws, null);
  rc.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `node --test test/register-client.test.cjs`
Expected: FAIL — `Cannot find module '../register_client.cjs'`

- [ ] **Step 3: 实现** — 创建 `register_client.cjs`

```js
'use strict';

// 单机反向注册 client:主动连 hub 的 /api/hub/agent WS,连接即注册、断开自愈重连。
// 数据通道(看板轮询 + 出站 WS 终端)不经此模块。
const WebSocket = require('ws');
const os = require('node:os');
const { ID_RE } = require('./hub/config.cjs');

const PING_INTERVAL_MS = 20000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;
const AUTH_REJECT_BACKOFF_MS = 5 * 60 * 1000;
const AUTH_REJECT_MAX_ATTEMPTS = 3;
const WS_CLOSE_POLICY = 1008;

function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

class RegisterClient {
  constructor({
    hubUrl, registerToken, authToken,
    machineId, machineName, publicUrl,
    bindHost, port,
    pingIntervalMs = PING_INTERVAL_MS,
    reconnectBaseMs = RECONNECT_BASE_MS,
    reconnectMaxMs = RECONNECT_MAX_MS,
    authRejectBackoffMs = AUTH_REJECT_BACKOFF_MS,
    authRejectMaxAttempts = AUTH_REJECT_MAX_ATTEMPTS,
    log = console,
  }) {
    this._hubUrl = hubUrl || '';
    this._registerToken = registerToken || '';
    this._authToken = authToken || '';
    this._machineId = machineId || '';
    this._machineName = machineName || '';
    this._publicUrl = publicUrl || '';
    this._bindHost = bindHost || '127.0.0.1';
    this._port = port;
    this._pingIntervalMs = pingIntervalMs;
    this._reconnectBaseMs = reconnectBaseMs;
    this._reconnectMaxMs = reconnectMaxMs;
    this._authRejectBackoffMs = authRejectBackoffMs;
    this._authRejectMaxAttempts = authRejectMaxAttempts;
    this._log = log;

    // 推导 id
    if (!this._machineId) {
      this._machineId = os.hostname();
      this._log.warn?.('[register] 未设 CC_WEB_MACHINE_ID,默认 hostname 可能在多机环境冲突,建议显式设置');
    }
    // 推导 url
    if (!this._publicUrl) {
      this._publicUrl = `http://${this._bindHost}:${this._port}`;
    }
    // 自检:报告 url 不可被外部回连时告警
    this._warnIfUrlUnreachable();
    // 自检:明文 ws 泄露单机 token
    this._warnIfInsecure();

    this._ws = null;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._authRejectCount = 0;
    this._networkAttempt = 0;
    this._stopped = false;
    this._closing = false;
  }

  _warnIfUrlUnreachable() {
    try {
      const u = new URL(this._publicUrl);
      if (!isLoopback(u.hostname) && isLoopback(this._bindHost)) {
        this._log.warn?.(`[register] 报告 url(${this._publicUrl})对 hub 可能不可达,请设 CC_WEB_PUBLIC_URL`);
      }
    } catch { /* url 非法时由 hub 侧校验拒绝 */ }
  }

  _warnIfInsecure() {
    if (!this._hubUrl) return;
    try {
      const u = new URL(this._hubUrl);
      if (u.protocol === 'http:' && !isLoopback(u.hostname)) {
        this._log.warn?.('[register] hub 为 http,注册帧明文传输单机 token,建议 hub 启用 https/wss');
      }
    } catch { /* hub url 非法则连接时失败 */ }
  }

  enabled() { return !!(this._hubUrl && (this._registerToken || this._authToken)); }

  start() {
    if (!this.enabled()) return;
    this._connect();
  }

  _connect() {
    if (this._stopped || this._closing) return;
    const wsHubUrl = this._hubUrl.replace(/^http/, 'ws');
    let ws;
    try {
      ws = new WebSocket(`${wsHubUrl}/api/hub/agent`, {
        headers: { Authorization: `Bearer ${this._registerToken || this._authToken}` },
      });
    } catch (e) {
      this._scheduleReconnect('network');
      return;
    }
    this._ws = ws;

    ws.on('open', () => {
      this._authToken && undefined; // no-op
      this._sendRegister();
      this._pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, this._pingIntervalMs);
    });

    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'registered' || m.type === 'pong') {
        // 注册被接受 / 心跳确认 → 退避计数清零
        this._networkAttempt = 0;
      }
      if (m.type === 'unreachable') {
        this._log.warn?.(`[register] hub 回连失败 url=${m.url} err=${m.error},请检查 CC_WEB_PUBLIC_URL`);
      }
    });

    ws.on('close', (code) => {
      this._clearPing();
      this._ws = null;
      if (this._closing || this._stopped) return;
      if (code === WS_CLOSE_POLICY) {
        // 鉴权/策略拒绝:长退避 + 计数,达上限停止
        this._authRejectCount += 1;
        this._log.error?.(`[register] hub 拒绝注册(close 1008),请检查 token/字段(${this._authRejectCount}/${this._authRejectMaxAttempts})`);
        if (this._authRejectCount >= this._authRejectMaxAttempts) {
          this._log.error?.('[register] 鉴权连续失败达上限,停止重连');
          this._stopped = true;
          return;
        }
        this._scheduleReconnect('auth');
      } else {
        this._scheduleReconnect('network');
      }
    });

    ws.on('error', () => {
      // close 事件会跟随,重连在 close 里调度;此处仅吞错避免 uncaught
    });
  }

  _sendRegister() {
    const id = this._machineId;
    if (!ID_RE.test(id)) {
      this._log.error?.(`[register] machineId 非法(须匹配 ${ID_RE}),断开`);
      this._ws?.close(1008);
      return;
    }
    this._ws.send(JSON.stringify({
      type: 'register',
      id,
      name: this._machineName || id,
      url: this._publicUrl,
      token: this._authToken,
    }));
  }

  _scheduleReconnect(reason) {
    if (this._reconnectTimer || this._stopped || this._closing) return;
    let base;
    if (reason === 'auth') {
      base = this._authRejectBackoffMs;
    } else {
      this._networkAttempt += 1;
      base = Math.min(this._reconnectBaseMs * 2 ** (this._networkAttempt - 1), this._reconnectMaxMs);
    }
    const jitter = base * (0.8 + 0.4 * Math.random()); // ±20%
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, Math.round(jitter));
  }

  _clearPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  close() {
    this._closing = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._clearPing();
    if (this._ws) { try { this._ws.close(1001, 'going away'); } catch {} this._ws = null; }
  }
}

module.exports = {
  RegisterClient,
  PING_INTERVAL_MS, RECONNECT_BASE_MS, RECONNECT_MAX_MS,
  AUTH_REJECT_BACKOFF_MS, AUTH_REJECT_MAX_ATTEMPTS,
};
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/register-client.test.cjs`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add register_client.cjs test/register-client.test.cjs
git commit -m "feat(single): RegisterClient 反向注册 WS client + 退避分叉自愈"
```

---

### Task 4: hub AgentRegistrar 模块

**Files:**
- Create: `hub/register_server.cjs`
- Test: `test/hub-register-server.test.cjs`

**Interfaces:**
- Consumes: `hub/config.cjs` 的 `validateMachine`；`hub/registry.cjs` 的 `MachineRegistry.prototype.add/remove/setOnline/getSecret`；一个 `AgentClient` 构造器与一个 `clients` Map（外部持有，registrar 写入）。
- Produces: `AgentRegistrar` 类，构造 `{ registry, clients, AgentClientCtor, hubToken, registerToken, log }`；方法 `.accept(ws, req)`（server.cjs 在路径为 `/api/hub/agent` 时调用）、`.notifyUnreachable(id, url, error)`、`.cleanup()`；导出常量 `IDLE_TIMEOUT_MS=60000`、`USURP_WINDOW_MS=60000`、`USURP_THRESHOLD=3`。

- [ ] **Step 1: 写失败测试** — `test/hub-register-server.test.cjs`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { MachineRegistry } = require('../hub/registry.cjs');
const { AgentRegistrar } = require('../hub/register_server.cjs');

// 把 registrar 挂在一个真实 WS server 上,用 client 模拟单机
async function withRegistrar({ hubToken = 'ht', registerToken = '' } = {}, fn) {
  const registry = new MachineRegistry([]);
  const clients = new Map();
  let created = [];
  const FakeAgentClient = class { constructor(o){ this.o = o; created.push(o); } fetchDashboard(){ return {ok:true,payload:{sessions:[]}}; } close(){} };
  const registrar = new AgentRegistrar({
    registry, clients, AgentClientCtor: FakeAgentClient, hubToken, registerToken, log: { warn(){}, error(){} },
  });
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => registrar.accept(ws, req));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try { await fn({ registry, clients, created, registrar, port, stop: () => new Promise((r)=>{wss.close(); server.close(()=>r());}) }); }
  finally { await new Promise((r)=>{wss.close(); server.close(()=>r());}); }
}

function connect(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/hub/agent`, { headers: { Authorization: `Bearer ${token}` } });
  return ws;
}

test('register 帧被接受 → 写入 registry + 建 client', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, clients, created, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', name: 'M1', url: 'http://h:1', token: 'mt' }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(registry.all().length, 1);
    assert.equal(registry.getSecret('m1').token, 'mt');
    assert.ok(clients.has('m1'));
    assert.equal(created[0].id, 'm1');
    ws.close(); await stop();
  });
});

test('无 Bearer / 错 token → close 1008', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ port, stop }) => {
    const ws = connect(port, 'wrong');
    const code = await new Promise((r) => ws.on('close', r));
    assert.equal(code, 1008);
    await stop();
  });
});

test('register token 设置时,看板 token 不能用于注册', async () => {
  await withRegistrar({ hubToken: 'ht', registerToken: 'rt' }, async ({ port, stop }) => {
    const ws = connect(port, 'ht'); // 用看板 token 应被拒
    const code = await new Promise((r) => ws.on('close', r));
    assert.equal(code, 1008);
    const ws2 = connect(port, 'rt');
    await new Promise((r) => ws2.on('open', r));
    ws2.close();
    await stop();
  });
});

test('非法 url(169.254.169.254) → 拒绝 + 不入 registry', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', url: 'http://169.254.169.254', token: 't' }));
    await new Promise((r) => ws.on('close', r));
    assert.equal(registry.all().length, 0);
    await stop();
  });
});

test('连接断开 → registry remove + client close', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, clients, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', url: 'http://h:1', token: 't' }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(registry.all().length, 1);
    ws.close();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(registry.all().length, 0, '断开后移除');
    assert.ok(!clients.has('m1'));
    await stop();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `node --test test/hub-register-server.test.cjs`
Expected: FAIL — `Cannot find module '../hub/register_server.cjs'`

- [ ] **Step 3: 实现** — 创建 `hub/register_server.cjs`

```js
'use strict';

// hub 侧注册处理器:接受单机反向 WS(/api/hub/agent),鉴权 → 校验 → registry.add + 建 AgentClient。
// 连接断开即 remove;回连失败经 notifyUnreachable 回送告警帧;空闲超时防假死;同 id 抢占告警。
const { validateMachine } = require('./config.cjs');

const IDLE_TIMEOUT_MS = 60000;
const USURP_WINDOW_MS = 60000;
const USURP_THRESHOLD = 3;
const WS_CLOSE_POLICY = 1008;

function bearerFromReq(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

class AgentRegistrar {
  constructor({ registry, clients, AgentClientCtor, hubToken, registerToken = '', log = console }) {
    this._registry = registry;
    this._clients = clients;
    this._AgentClientCtor = AgentClientCtor;
    this._expectedToken = registerToken || hubToken;
    this._log = log;
    this._connsById = new Map();   // id -> ws(活跃注册连接)
    this._idleTimers = new Map();  // ws -> timer
    this._usurp = new Map();       // id -> number[](近窗覆盖时间戳)
  }

  // 由 hub/server.cjs 的 wss.on('connection') 在路径=/api/hub/agent 时调用
  accept(ws, req) {
    if (bearerFromReq(req) !== this._expectedToken) {
      try { ws.close(WS_CLOSE_POLICY, 'Unauthorized'); } catch {}
      return;
    }
    this._armIdle(ws);

    const onMessage = (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (!m || m.type !== 'register') return;
      this._handleRegister(ws, m);
    };
    const onClose = () => {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
      this._disarmIdle(ws);
      this._removeByConn(ws);
    };
    ws.on('message', onMessage);
    ws.on('close', onClose);
  }

  _handleRegister(ws, m) {
    let machine;
    try {
      machine = validateMachine({ id: m.id, name: m.name, url: m.url, token: m.token });
    } catch (e) {
      this._log.error?.(`[registrar] 注册帧非法: ${e.message}`);
      try { ws.close(WS_CLOSE_POLICY, 'invalid register'); } catch {}
      return;
    }
    this._recordUsurp(machine.id);
    // 后者覆盖前者:旧连接关闭
    const prev = this._connsById.get(machine.id);
    if (prev && prev !== ws) {
      try { prev.close(1000, 'superseded'); } catch {}
      this._disarmIdle(prev);
      this._removeByConn(prev, { keepRegistry: false }); // 旧连接下线→先清,再用新覆盖
    }
    this._registry.add(machine, ws);
    this._clients.set(machine.id, new this._AgentClientCtor({ id: machine.id, url: machine.url, token: machine.token }));
    this._connsById.set(machine.id, ws);
    this._resetIdle(ws);
    try { ws.send(JSON.stringify({ type: 'registered' })); } catch {}
  }

  _removeByConn(ws, { keepRegistry = false } = {}) {
    let removedId = null;
    for (const [id, c] of this._connsById) {
      if (c === ws) { removedId = id; break; }
    }
    if (!removedId) return;
    this._connsById.delete(removedId);
    if (!keepRegistry) {
      this._registry.remove(removedId);
      const ac = this._clients.get(removedId);
      if (ac) { try { ac.close(); } catch {} this._clients.delete(removedId); }
    }
  }

  _recordUsurp(id) {
    const now = Date.now();
    const arr = (this._usurp.get(id) || []).filter((t) => now - t < USURP_WINDOW_MS);
    arr.push(now);
    this._usurp.set(id, arr);
    if (arr.length >= USURP_THRESHOLD) {
      this._log.warn?.(`[registrar] id "${id}" 疑似多机冲突(短时反复覆盖),建议相关单机显式设 CC_WEB_MACHINE_ID`);
    }
  }

  notifyUnreachable(id, url, error) {
    const ws = this._connsById.get(id);
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ type: 'unreachable', url, error: String(error) })); } catch {}
    }
  }

  _armIdle(ws) {
    this._disarmIdle(ws);
    const t = setTimeout(() => { try { ws.close(1000, 'idle timeout'); } catch {} }, IDLE_TIMEOUT_MS);
    t.unref?.();
    this._idleTimers.set(ws, t);
  }
  _resetIdle(ws) { this._armIdle(ws); }
  _disarmIdle(ws) {
    const t = this._idleTimers.get(ws);
    if (t) { clearTimeout(t); this._idleTimers.delete(ws); }
  }

  cleanup() {
    for (const t of this._idleTimers.values()) clearTimeout(t);
    this._idleTimers.clear();
    for (const ws of this._connsById.values()) { try { ws.close(1001, 'hub shutdown'); } catch {} }
    this._connsById.clear();
  }
}

module.exports = { AgentRegistrar, IDLE_TIMEOUT_MS, USURP_WINDOW_MS, USURP_THRESHOLD };
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/hub-register-server.test.cjs`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add hub/register_server.cjs test/hub-register-server.test.cjs
git commit -m "feat(hub): AgentRegistrar 接受单机反向注册 + 动态 registry/client"
```

---

### Task 5: hub/server.cjs 集成（路径分流 + deprecate 种子 + unreachable + close）

**Files:**
- Modify: `hub/server.cjs:25-58`（startHub 装配）、`hub/server.cjs:454-489`（WS connection）、`hub/server.cjs:508-521`（close）
- Test: `test/hub-server.test.cjs`（追加用例）

**Interfaces:**
- Consumes: Task 1（registry add/remove）、Task 4（AgentRegistrar）。
- Produces: hub 启动接受单机反向注册；`hub-machines.json` 存在时作静态种子 + deprecate WARN；轮询失败回送 unreachable；close 清理 registrar。

- [ ] **Step 1: 写失败测试** — 追加到 `test/hub-server.test.cjs`

```js
test('hub 接受单机反向注册(无 hub-machines.json 也能动态加机)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-reg-'));
  const emptyMachines = path.join(tmp, 'none.json'); // 不存在
  const hub = await startHub({ machinesFile: emptyMachines, hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 100 });
  const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/api/hub/agent`, { headers: { Authorization: 'Bearer ht' } });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', id: 'd1', name: 'D1', url: 'http://127.0.0.1:1', token: 't' }));
  await new Promise((r) => setTimeout(r, 120));
  const dash = await fetch(`http://127.0.0.1:${hub.port}/api/dashboard?token=ht`).then((r) => r.json());
  assert.ok(dash.machines.some((m) => m.id === 'd1'), '动态注册的机器出现在看板');
  ws.close();
  await hub.stop();
});

test('hub-machines.json 存在 → 作为种子加载 + 打印 deprecate WARN', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-seed-'));
  const file = path.join(dir, 'hub-machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: [{ id: 'seed1', name: 'S1', url: 'http://127.0.0.1:1', token: 't' }] }), { mode: 0o600 });
  const warns = [];
  const origWarn = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    const hub = await startHub({ machinesFile: file, hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 100 });
    console.warn = origWarn;
    assert.ok(warns.some((w) => /deprecated/i.test(w)), '应有 deprecate WARN');
    const dash = await fetch(`http://127.0.0.1:${hub.port}/api/dashboard?token=ht`).then((r) => r.json());
    assert.ok(dash.machines.some((m) => m.id === 'seed1'), '种子机器在看板');
    await hub.stop();
  } finally { console.warn = origWarn; }
});
```

（确认文件顶部已 `require('node:fs')`、`require('node:path')`、`require('node:os')`、`require('ws')` 与 `startHub`；若缺按现有 import 补。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --test test/hub-server.test.cjs`
Expected: FAIL — 反向注册连接被当浏览器 WS 处理 / machines 文件不存在时 throw

- [ ] **Step 3: 实现** — 改 `hub/server.cjs`

**(a) 顶部 require**（在现有 `const { MachineRegistry } = require('./registry.cjs');` 附近加）：

```js
const { AgentRegistrar } = require('./register_server.cjs');
const { existsSync } = require('node:fs');
```

（若 `existsSync` 已通过 `require('node:fs')` 引入则不重复。）

**(b) startHub 装配**（`hub/server.cjs:41-46`）—— 把 `loadMachines` 改为「文件存在才加载 + deprecate WARN」，并实例化 registrar。把：

```js
  const machines = loadMachines(machinesFile);
  const registry = new MachineRegistry(machines);

  // 每机一个 agent_client(持有 token,内部用)
  const clients = new Map();
  for (const m of machines) clients.set(m.id, new AgentClient({ id: m.id, url: m.url, token: m.token }));
```

改为：

```js
  // deprecate 窗口:hub-machines.json 存在则作静态种子 + WARN,不存在则空(靠运行时注册)
  let machines = [];
  if (machinesFile && existsSync(machinesFile)) {
    machines = loadMachines(machinesFile);
    console.warn(`[hub] hub-machines.json 已 deprecated,将在后续版本移除;请改为在各单机配置 CC_WEB_HUB_URL + CC_WEB_HUB_TOKEN(详见 README 迁移指引)`);
  }
  const registry = new MachineRegistry(machines);

  // 每机一个 agent_client(持有 token,内部用);静态种子启动即建,运行时注册由 registrar 增建
  const clients = new Map();
  for (const m of machines) clients.set(m.id, new AgentClient({ id: m.id, url: m.url, token: m.token }));

  const registrar = new AgentRegistrar({
    registry,
    clients,
    AgentClientCtor: AgentClient,
    hubToken,
    registerToken: opts.registerToken || '',
  });
```

**(c) fetchOne 失败回送 unreachable**（`hub/server.cjs:48-58` 的 `fetchOne`）—— 把：

```js
      const r = await ac.fetchDashboard();
      return r.ok ? { ok: true, payload: r.payload } : { ok: false, error: r.error };
```

改为：

```js
      const r = await ac.fetchDashboard();
      if (!r.ok) registrar.notifyUnreachable(sec.id, sec.url, r.error);
      return r.ok ? { ok: true, payload: r.payload } : { ok: false, error: r.error };
```

**(d) WS connection 路径分流**（`hub/server.cjs:472-475`）—— 现有代码为：

```js
  wss.on('connection', (ws, req) => {
    // 鉴权:cookie 或 ?token= query(浏览器 WS 不能自带 header,走 query)
    const url = new URL(req.url, 'http://x');
```

在开头插入反向注册路径分流，改为：

```js
  wss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url, 'http://x');
    // 单机反向注册路径:Bearer 鉴权在 registrar 内,分流到此即返回
    if (reqUrl.pathname === '/api/hub/agent') {
      registrar.accept(ws, req);
      return;
    }
    // 鉴权:cookie 或 ?token= query(浏览器 WS 不能自带 header,走 query)
    const url = new URL(req.url, 'http://x');
```

（其后 `queryToken` / `auth.isAuthorized` / `bridge.handleConnection(ws)` 保持原样不变。）

**(e) close 清理 registrar**（`hub/server.cjs:508-521` 的 `close`）—— 在 `aggregator.stop();` 之后、`for (const ac of clients.values()) ac.close();` 之前加：

```js
        aggregator.stop();
        registrar.cleanup();
        for (const ac of clients.values()) ac.close();
```

**(f) startHub opts 解构**（`hub/server.cjs:26-37`）—— 在解构列表中加 `registerToken = '',`（与 `mainAgent` 同级）。

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/hub-server.test.cjs`
Expected: PASS（全文件绿，含原有用例 + 2 个新用例）

- [ ] **Step 5: 跑全量回归**

Run: `npm test`
Expected: PASS（确认未破坏 hub-aggregator / ws-bridge / config 等现有测试）

- [ ] **Step 6: Commit**

```bash
git add hub/server.cjs test/hub-server.test.cjs
git commit -m "feat(hub): 集成反向注册(路径分流)+ deprecate 种子 + unreachable 回送"
```

---

### Task 6: hub/server_entry.cjs 传 registerToken

**Files:**
- Modify: `hub/server_entry.cjs:24-35`

**Interfaces:**
- Consumes: Task 5（startHub 接收 `registerToken`）。
- Produces: hub 启动从配置读 `hubRegisterToken` 传入。

- [ ] **Step 1: 写失败测试** — `test/server_entry_config_wiring.test.cjs`（若存在则追加；否则新建，参考现有 wiring 测试风格）

```js
test('server_entry 把 CFG.hubRegisterToken 传入 startHub', async () => {
  // 用 --config 指向临时 hub-config.json(env: CC_WEB_HUB_REGISTER_TOKEN)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-'));
  const cfg = path.join(dir, 'hub-config.json');
  fs.writeFileSync(cfg, JSON.stringify({ hubToken: 'ht', hubRegisterToken: 'rt', port: 0, noOpen: true }), { mode: 0o600 });
  const stub = { started: null };
  const orig = require('../hub/server.cjs').startHub;
  require('../hub/server.cjs').startHub = async (opts) => { stub.started = opts; return { url: '', host: '127.0.0.1', port: 0, close: async () => {}, stop: async () => {} }; };
  process.argv = ['node', 'hub', '--config', cfg];
  try { require('../hub/server_entry.cjs'); } finally { require('../hub/server.cjs').startHub = orig; }
  assert.equal(stub.started.registerToken, 'rt');
});
```

（注：`server_entry.cjs` 顶层即执行 `startHub`，测试用 stub 替换 `startHub` 并断言传入 opts。若现有 wiring 测试已有更合适的 mock 模式，照其模式写。）

- [ ] **Step 2: 跑测试验证失败**

Run: `node --test test/server_entry_config_wiring.test.cjs`
Expected: FAIL — `stub.started.registerToken` 为 `undefined`

- [ ] **Step 3: 实现** — 改 `hub/server_entry.cjs:24-35`

在 `startHub({ ... })` 调用里加一行 `registerToken,`（与 `hubToken,` 同级）：

```js
startHub({
  machinesFile: CFG.machinesFile,
  hubToken: CFG.hubToken,
  registerToken: CFG.hubRegisterToken,
  host: CFG.host,
  port: CFG.port,
  intervalMs: CFG.intervalMs,
  mainAgent,
  loginMax: CFG.loginMax,
  loginWindowMs: CFG.loginWindowMs,
  mainAgentMax: CFG.mainAgentMax,
  mainAgentWindowMs: CFG.mainAgentWindowMs,
}).then((hub) => {
  console.log(`[hub] listening on ${hub.host}:${hub.port} (machines: ${CFG.machinesFile})`);
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/server_entry_config_wiring.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/server_entry.cjs test/server_entry_config_wiring.test.cjs
git commit -m "feat(hub): server_entry 传入 hubRegisterToken"
```

---

### Task 7: 单机 server.cjs 挂载 RegisterClient + SIGINT

**Files:**
- Modify: `server.cjs:66-79`（CFG 解构）、`server.cjs:286`（startWebServer 内挂载）、`server.cjs:753-763`（SIGINT）
- Test: 手动验证 + `test/register-client.test.cjs` 已覆盖模块本身（server.cjs 不可 require，集成靠 e2e Task 8 覆盖）

**Interfaces:**
- Consumes: Task 2（CFG 字段）、Task 3（RegisterClient）。
- Produces: 单机配了 `CC_WEB_HUB_URL`(+token) 时启动反向注册；SIGINT 优雅关闭注册连接。

- [ ] **Step 1: 读现有代码定位** — 确认 `server.cjs:66-79` 的 CFG 解构变量名风格、`startWebServer` 内 `server.listen` 完成位置、SIGINT handler 形态（已知 `server.cjs:753-763`）。

- [ ] **Step 2: 实现**

**(a) 顶部 require**（`server.cjs` 现有 require 区）：

```js
const { RegisterClient } = require('./register_client.cjs');
```

**(b) CFG 取值**（`server.cjs:66-79` 为逐行 `const X = CFG.y;` 形式，非解构对象）—— 在 `const AUTH_TOKEN = CFG.authToken;`（`server.cjs:77`）之后追加 6 行：

```js
const HUB_URL = CFG.hubUrl;
const HUB_REGISTER_TOKEN = CFG.hubRegisterToken;
const HUB_TOKEN = CFG.hubToken;
const MACHINE_ID = CFG.machineId;
const MACHINE_NAME = CFG.machineName || '';
const PUBLIC_URL = CFG.publicUrl;
```

（字段名对齐 Task 2 的 schema：`hubUrl`/`hubRegisterToken`/`hubToken`/`machineId`/`machineName`/`publicUrl`。）

**(c1) 声明 `registerClient`**（在 `// 优雅退出` 注释、`process.on('SIGINT', ...)` 之前，仍在 `startWebServer()` 函数体内，`server.cjs:752` 附近）—— 追加：

```js
  // 反向注册:配了 CC_WEB_HUB_URL(+token) 才启用;在 listen 回调里创建,SIGINT 里关闭
  let registerClient = null;
```

（`startWebServer()` 从 `server.cjs:286` 起，SIGINT(753) 与 listen(765) 都在其函数体内；`let registerClient` 声明在 SIGINT 之前，故 SIGINT 闭包可读、listen 回调可写。）

**(c2) 创建并启动**（在 `server.listen(PORT, HOST, () => {` 回调内，浏览器打开逻辑之后，`server.cjs:765+`）—— 追加：

```js
    if (HUB_URL && (HUB_REGISTER_TOKEN || HUB_TOKEN)) {
      registerClient = new RegisterClient({
        hubUrl: HUB_URL,
        registerToken: HUB_REGISTER_TOKEN,
        authToken: AUTH_TOKEN,
        machineId: MACHINE_ID,
        machineName: MACHINE_NAME,
        publicUrl: PUBLIC_URL,
        bindHost: HOST,
        port: PORT,
      });
      registerClient.start();
    }
```

**(d) SIGINT 关闭**（`server.cjs:753-763`）—— 现有：

```js
  process.on('SIGINT', () => {
    console.log('\n[Server] 正在关闭...');
    try {
      clearInterval(pingInterval);
    } catch {}
    for (const [ws, info] of clients) {
      if (info?.interval) clearInterval(info.interval);
      ws.close();
    }
    server.close(() => process.exit(0));
  });
```

在 `for` 循环之后、`server.close(...)` 之前加一行 `if (registerClient) registerClient.close();`：

```js
  process.on('SIGINT', () => {
    console.log('\n[Server] 正在关闭...');
    try {
      clearInterval(pingInterval);
    } catch {}
    for (const [ws, info] of clients) {
      if (info?.interval) clearInterval(info.interval);
      ws.close();
    }
    if (registerClient) registerClient.close();
    server.close(() => process.exit(0));
  });
```

- [ ] **Step 3: 跑全量回归**

Run: `npm test`
Expected: PASS（单机既有测试不受影响；RegisterClient 模块测试已在 Task 3 通过）

- [ ] **Step 4: 手动冒烟** — 起一个 hub 与一台单机，确认单机连上 hub 并出现在看板：

```bash
# 终端1:起 hub
CC_WEB_HUB_TOKEN=ht cc-web-control hub --no-open
# 终端2:起单机(指向 hub)
CC_WEB_AUTH_TOKEN=at CC_WEB_HUB_URL=http://127.0.0.1:7685 CC_WEB_HUB_TOKEN=ht CC_WEB_NO_OPEN=1 cc-web-control
# 浏览器打开 http://127.0.0.1:7685?token=ht,确认单机 hostname 出现在看板
```
Expected: 单机出现在 hub 看板；Ctrl+C 单机后看板内该机消失。

- [ ] **Step 5: Commit**

```bash
git add server.cjs
git commit -m "feat(single): server.cjs 挂载 RegisterClient + SIGINT 优雅关闭"
```

---

### Task 8: 端到端集成测试 + 文档

**Files:**
- Create: `test/hub-register-e2e.test.cjs`
- Modify: `config.example.json`、`README.md`

**Interfaces:**
- Consumes: Task 3（RegisterClient）、Task 5（hub 集成）、`test/stub_machine.cjs`。

- [ ] **Step 1: 写 e2e 测试** — `test/hub-register-e2e.test.cjs`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startHub } = require('../hub/server.cjs');
const { StubMachine } = require('./stub_machine.cjs');
const { RegisterClient } = require('../register_client.cjs');

test('e2e: 单机 RegisterClient 连 hub → 看板可见该机 + 出站 WS 可连', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const hub = await startHub({ machinesFile: path.join(noneDir, 'none.json'), hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80 });

  // stub 充当「单机的 HTTP+WS 服务」(被 hub 回连)
  const stub = await new StubMachine({ token: 'at', dashboardPayload: { tmuxOk: true, sessions: [{ name: 's1', cwd: '/x', status: 'idle', lastLine: '', lastTs: 0, attached: false }] } }).start();

  // RegisterClient 充当「单机主动注册到 hub」
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'e2e-box', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 250)); // 等注册 + 首轮轮询

  const dash = await fetch(`http://127.0.0.1:${hub.port}/api/dashboard?token=ht`).then((r) => r.json());
  const m = dash.machines.find((x) => x.id === 'e2e-box');
  assert.ok(m, '注册机器在看板');
  assert.equal(m.online, true, '看板可达(回连 stub 成功)');

  rc.close();
  await stub.stop();
  await hub.stop();
});

test('e2e: hub 重启后单机自愈重注册', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e2-'));
  const machinesFile = path.join(noneDir, 'none.json');
  let hub = await startHub({ machinesFile, hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80 });
  const stub = await new StubMachine({ token: 'at', dashboardPayload: { tmuxOk: true, sessions: [] } }).start();
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'e2e-box2', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
    reconnectBaseMs: 50, // 测试用短退避
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 200));

  await hub.stop(); // 模拟 hub 重启
  hub = await startHub({ machinesFile, hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80 });
  await new Promise((r) => setTimeout(r, 400)); // 等自愈重连

  const dash = await fetch(`http://127.0.0.1:${hub.port}/api/dashboard?token=ht`).then((r) => r.json());
  assert.ok(dash.machines.some((x) => x.id === 'e2e-box2'), 'hub 重启后单机自愈重注册');

  rc.close(); await stub.stop(); await hub.stop();
});
```

- [ ] **Step 2: 跑 e2e 验证通过**

Run: `node --test test/hub-register-e2e.test.cjs`
Expected: PASS（2 个用例绿）

- [ ] **Step 3: 跑全量回归**

Run: `npm test`
Expected: PASS（全部测试绿）

- [ ] **Step 4: 更新 config.example.json** — 在单机字段区追加（保持现有 JSON 结构与注释风格）：

```json
  "hubUrl": "",
  "hubToken": "",
  "hubRegisterToken": "",
  "machineId": "",
  "machineName": "",
  "publicUrl": "",
```

并在 `hub-config.example.json`（若存在 hub 字段示例）加 `"hubRegisterToken": ""`。

- [ ] **Step 5: 更新 README.md** — 「hub 多机模式」章节：

- 机器侧步骤改为：「在各单机配置 `CC_WEB_HUB_URL=http://hub-host:7685` + `CC_WEB_HUB_TOKEN=<hub token>`（或独立的 `CC_WEB_HUB_REGISTER_TOKEN`），单机启动即自动注册」。
- 加「迁移指引」小节：「旧版使用 `~/.cc-web-control/hub-machines.json` 的用户：hub 启动若检测到该文件仍会加载作种子并打印 deprecate 警告；请逐步迁移到单机注册，该文件将在后续版本移除。」
- 在「配置文件」字段清单补 `hubUrl`/`hubToken`/`hubRegisterToken`/`machineId`/`machineName`/`publicUrl`。
- 加「安全」说明：「`CC_WEB_HUB_TOKEN` 分发到单机后，单机操作者可登录 hub 看板；多操作者/不可信网络请用独立的 `CC_WEB_HUB_REGISTER_TOKEN`。注册 url 经 hub 主动请求，仅发给可信机器（SSRF 面）。跨不可信网络须用 https/wss。」

- [ ] **Step 6: Commit**

```bash
git add test/hub-register-e2e.test.cjs config.example.json hub-config.example.json README.md
git commit -m "test+docs: 反向注册 e2e + config/README 字段同步与迁移指引"
```

---

## Self-Review

**Spec 覆盖**（逐条对照 spec v2）：
- §2 架构 → Task 3+4+5
- §3 单机 client（启用条件/连接/注册帧/ping/退避分叉/优雅下线/配置生效）→ Task 3 + Task 7
- §3.3 id 冲突防护（hostname 默认 + WARN）→ Task 3（`_warnIfUrlUnreachable` 同侧的 WARN 在构造里）；hub 侧抢占告警 → Task 4（`_recordUsurp`）
- §4 hub endpoint/路径分流/鉴权/接受注册/在线下线/空闲超时/unreachable/registry 改动/close → Task 4 + Task 5 + Task 1
- §5 hub-machines.json deprecate 窗口 → Task 5（b）
- §6 配置（单机/hub/config.example/README）→ Task 2 + Task 8
- §7 安全（token 模型/SSRF/明文 ws）→ Task 4（register token 分离）、Task 3（`_warnIfInsecure`）、Task 8（README 安全段）
- §8 生命周期 → Task 8 e2e 覆盖自愈
- §9 重复 id 后者覆盖 → Task 4（`_handleRegister` 覆盖旧连接）
- §10 错误处理 → Task 3+4
- §11 成功指标 → 非代码，README/验收时人工对照
- §12 不做（YAGNI/ROI）→ 无任务（正确）
- §13 测试（含安全用例）→ Task 1/2/3/4/8 + 安全用例（SSRF 拒绝、snapshot 无 token/conn、未授权 close、register token 分离、id 校验）

**Placeholder scan**：无 TBD/TODO；每步含可执行代码或精确 old→new 片段。

**Type 一致性**：`add(machine, conn)` / `remove(id)` 在 Task 1 定义、Task 4/5 调用一致；`AgentRegistrar.accept(ws, req)` / `.notifyUnreachable(id,url,err)` / `.cleanup()` 在 Task 4 定义、Task 5 调用一致；`RegisterClient` 构造字段在 Task 3 定义、Task 7/8 调用一致；常量 `IDLE_TIMEOUT_MS` 等导出与使用一致。
