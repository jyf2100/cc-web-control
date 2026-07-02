# 多机统一控制台(Hub)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个中心 Hub 服务(`cc-web-control hub`),把多台内网机器上的 cc-web-control 实例聚合成单一入口,实现「全局看板监控 + 单会话终端切换 + 多选批量广播」。

**Architecture:** Hub 是同包新子命令,复用根 `auth.cjs`。Hub 内部 6 个组件:`config`(清单解析)、`registry`(清单+健康)、`dashboard_aggregator`(轮询聚合)、`agent_client`(每机 HTTP+WS 客户端)、`ws_bridge`(浏览器↔agent 代理+扇出)、`server`(对浏览器的 HTTP+WS)。全局会话键 `{machineId}/{sessionName}` 贯穿三流。**各机 cc-web-control 零改动** —— hub 只调各机已有接口(`GET /api/dashboard`、WS `?session=`、`POST/DELETE /api/sessions`),连接时带 `Authorization: Bearer <token>`、不发 origin 头 → 各机 `auth.isSameOrigin` 对空 origin 放行(见 spec §4.3)。

**Tech Stack:** Node.js (CommonJS `.cjs`)、Express 4、`ws` 8、`node --test`。复用根 `auth.cjs`、`public/dashboard.css`、终端样式。

**Spec:** `docs/superpowers/specs/2026-07-02-multi-host-hub-console-design.md`

---

## 文件结构(锁定的分解)

**新建(hub/ 目录):**
| 文件 | 职责 | 行数预估 |
|---|---|---|
| `hub/config.cjs` | 解析+校验机器清单 JSON(fail-fast);导出 `loadMachines(filePath)`、`validateMachine(raw)` | ~120 |
| `hub/registry.cjs` | 持有机器清单 + `online` 状态机;`getById`、`setOnline`、`all` | ~90 |
| `hub/dashboard_aggregator.cjs` | 纯函数 `mergeDashboards(machineSnapshots)` + 轮询类 `DashboardAggregator` | ~140 |
| `hub/agent_client.cjs` | 每机一个:HTTP `fetchDashboard`/`createSession`/`deleteSession` + per-session WS 池(懒连接、引用计数、重连) | ~220 |
| `hub/ws_bridge.cjs` | 浏览器 WS ↔ agent WS 双向代理 + `broadcast` 扇出 + per-target 引用计数 | ~200 |
| `hub/server.cjs` | hub 的 Express+WS 服务(对浏览器),复用根 `auth.cjs`;REST 代理建/删会话 | ~200 |

**新建(测试):**
- `test/hub-config.test.cjs`、`test/hub-registry.test.cjs`、`test/hub-dashboard-aggregator.test.cjs`
- `test/hub-agent-client.test.cjs`、`test/hub-ws-bridge.test.cjs`、`test/hub-server.test.cjs`
- `test/stub_machine.cjs` —— 集成测试用的「假机器」(fake `/api/dashboard` + fake WS server),被多个集成测试复用

**新建(前端):**
- `public/console.html` —— 整合态单页(三区:全局看板 / 终端 / 广播栏)
- `public/console.js` —— 控制台前端逻辑(看板轮询、WS attach、多选广播)

**修改:**
- `bin/cc-web-control.cjs` —— 增加 `hub` 子命令分发(无参 = 现有单机行为,向后兼容)
- `public/dashboard.css` —— 追加控制台三区布局类(不改动现有规则)

**约定:**
- 全局会话键:`{machineId}/{sessionName}`,`machineId` 正则 `^[A-Za-z0-9._-]{1,32}$`,禁止含 `/`。
- WS 协议见 spec §5.4(本计划 Task 5/6 重复列出)。
- 测试运行:`node --test test/hub-*.test.cjs`(全部:`node --test test/*.test.cjs`)。
- 不提交除非用户要求;在 main 分支上,执行前先建特性分支 `feat/multi-host-hub`。

---

## Task 1: hub/config.cjs — 机器清单解析与校验

**Files:**
- Create: `hub/config.cjs`
- Test: `test/hub-config.test.cjs`

- [ ] **Step 1: 写失败测试**

```js
// test/hub-config.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadMachines, validateMachine } = require('../hub/config.cjs');

function writeTmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cfg-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

test('validateMachine 合法', () => {
  assert.deepEqual(validateMachine({ id: 'mc1', name: 'Mac', url: 'http://1.2.3.4:7684', token: 't' }), {
    id: 'mc1', name: 'Mac', url: 'http://1.2.3.4:7684', token: 't',
  });
});

test('validateMachine id 含 / → 抛错', () => {
  assert.throws(() => validateMachine({ id: 'a/b', name: 'x', url: 'http://h', token: 't' }), /id/);
});

test('validateMachine id 不合正则 → 抛错', () => {
  assert.throws(() => validateMachine({ id: 'a b', name: 'x', url: 'http://h', token: 't' }), /id/);
});

test('validateMachine 缺 url/token → 抛错', () => {
  assert.throws(() => validateMachine({ id: 'mc1', name: 'x', token: 't' }), /url/);
  assert.throws(() => validateMachine({ id: 'mc1', name: 'x', url: 'http://h' }), /token/);
});

test('loadMachines 合法清单', () => {
  const f = writeTmp(JSON.stringify({ machines: [
    { id: 'mc1', name: 'A', url: 'http://1:7684', token: 't1' },
    { id: 'mc2', name: 'B', url: 'http://2:7684', token: 't2' },
  ] }));
  try {
    const m = loadMachines(f);
    assert.equal(m.length, 2);
    assert.equal(m[0].id, 'mc1');
  } finally { rm(path.dirname(f)); }
});

test('loadMachines id 重复 → fail-fast', () => {
  const f = writeTmp(JSON.stringify({ machines: [
    { id: 'mc1', name: 'A', url: 'http://1:7684', token: 't1' },
    { id: 'mc1', name: 'B', url: 'http://2:7684', token: 't2' },
  ] }));
  try {
    assert.throws(() => loadMachines(f), /duplicate/i);
  } finally { rm(path.dirname(f)); }
});

test('loadMachines 文件不存在 → fail-fast', () => {
  assert.throws(() => loadMachines('/no/such/file.json'), /not found|ENOENT/i);
});

test('loadMachines JSON 损坏 → fail-fast', () => {
  const f = writeTmp('{ not json');
  try { assert.throws(() => loadMachines(f), /JSON/i); }
  finally { rm(path.dirname(f)); }
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test test/hub-config.test.cjs
```
Expected: 全部 FAIL(`Cannot find module '../hub/config.cjs'`)。

- [ ] **Step 3: 写最小实现**

```js
// hub/config.cjs
'use strict';

const fs = require('node:fs');

const ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

function validateMachine(raw, index = -1) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`machine${index >= 0 ? ` #${index}` : ''}: not an object`);
  }
  const { id, name, url, token } = raw;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`machine${index >= 0 ? ` #${index}` : ''}: id 非法(须匹配 ${ID_RE},禁止含 "/")`);
  }
  if (typeof url !== 'string' || !url) {
    throw new Error(`machine "${id}": 缺 url`);
  }
  if (typeof token !== 'string' || !token) {
    throw new Error(`machine "${id}": 缺 token`);
  }
  return { id, name: typeof name === 'string' ? name : id, url, token };
}

function loadMachines(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`machines file not found: ${filePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`machines file JSON 解析失败: ${e.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.machines) ? parsed.machines : null);
  if (!list) {
    throw new Error('machines file 须为 { "machines": [...] } 或数组');
  }
  const seen = new Set();
  const machines = list.map((raw, i) => {
    const m = validateMachine(raw, i);
    if (seen.has(m.id)) throw new Error(`duplicate machine id: "${m.id}"`);
    seen.add(m.id);
    return m;
  });
  return machines;
}

module.exports = { validateMachine, loadMachines, ID_RE };
```

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test test/hub-config.test.cjs
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add hub/config.cjs test/hub-config.test.cjs
git commit -m "feat(hub): 机器清单解析与校验(config.cjs)"
```

---

## Task 2: hub/registry.cjs — 清单持有 + 健康状态机

**Files:**
- Create: `hub/registry.cjs`
- Test: `test/hub-registry.test.cjs`

- [ ] **Step 1: 写失败测试**

```js
// test/hub-registry.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { MachineRegistry } = require('../hub/registry.cjs');

const MACHINES = [
  { id: 'mc1', name: 'A', url: 'http://1:7684', token: 't1' },
  { id: 'mc2', name: 'B', url: 'http://2:7684', token: 't2' },
];

test('构造持有清单,初始 online=false', () => {
  const r = new MachineRegistry(MACHINES);
  assert.equal(r.all().length, 2);
  assert.equal(r.getById('mc1').online, false);
});

test('getById 未知名返回 undefined', () => {
  const r = new MachineRegistry(MACHINES);
  assert.equal(r.getById('nope'), undefined);
});

test('setOnline 更新状态且不可变原始清单', () => {
  const r = new MachineRegistry(MACHINES);
  r.setOnline('mc1', true);
  assert.equal(r.getById('mc1').online, true);
  assert.equal(MACHINES[0].online, undefined); // 未污染入参
});

test('snapshot 含 online 字段', () => {
  const r = new MachineRegistry(MACHINES);
  r.setOnline('mc1', true);
  const snap = r.snapshot();
  assert.equal(snap.length, 2);
  const mc1 = snap.find((m) => m.id === 'mc1');
  assert.equal(mc1.online, true);
  assert.equal(mc1.token, undefined); // snapshot 不外泄 token
});
```

- [ ] **Step 2: 运行确认失败**

```bash
node --test test/hub-registry.test.cjs
```
Expected: FAIL(`Cannot find module`)。

- [ ] **Step 3: 写实现**

```js
// hub/registry.cjs
'use strict';

// 不可变持有:内部存副本,snapshot 不含 token
class MachineRegistry {
  constructor(machines) {
    this._byId = new Map();
    for (const m of machines) {
      this._byId.set(m.id, { ...m, online: false, lastError: null });
    }
  }

  all() {
    return Array.from(this._byId.values()).map((m) => ({ ...m }));
  }

  getById(id) {
    const m = this._byId.get(id);
    return m ? { ...m } : undefined;
  }

  setOnline(id, online, lastError = null) {
    const m = this._byId.get(id);
    if (!m) return;
    this._byId.set(id, { ...m, online: !!online, lastError: online ? null : lastError });
  }

  // 对外快照,剔除 token
  snapshot() {
    return this.all().map(({ token, ...rest }) => rest);
  }

  getSecret(id) {
    const m = this._byId.get(id);
    return m ? { id: m.id, name: m.name, url: m.url, token: m.token } : undefined;
  }
}

module.exports = { MachineRegistry };
```

- [ ] **Step 4: 运行确认通过**

```bash
node --test test/hub-registry.test.cjs
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add hub/registry.cjs test/hub-registry.test.cjs
git commit -m "feat(hub): 机器清单持有与健康状态机(registry.cjs)"
```

---

## Task 3: hub/dashboard_aggregator.cjs — 聚合合并 + 轮询

**Files:**
- Create: `hub/dashboard_aggregator.cjs`
- Test: `test/hub-dashboard-aggregator.test.cjs`

- [ ] **Step 1: 写失败测试(纯函数优先)**

```js
// test/hub-dashboard-aggregator.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeDashboards } = require('../hub/dashboard_aggregator.cjs');

// input: 各机抓取结果 { machine, online, payload?, error? }
// payload = 各机 /api/dashboard 的 { tmuxOk, sessions:[{name,cwd,status,lastLine,lastTs,attached}] }

test('mergeDashboards 合并多机 + session 带 machine', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true,
      payload: { tmuxOk: true, sessions: [
        { name: 's1', cwd: '/a', status: 'working', lastLine: 'x', lastTs: 1, attached: false },
      ] } },
    { machine: { id: 'mc2', name: 'B' }, online: true,
      payload: { tmuxOk: true, sessions: [
        { name: 's2', cwd: '/b', status: 'idle', lastLine: '', lastTs: 2, attached: true },
      ] } },
  ]);
  assert.equal(merged.machines.length, 2);
  const mc1 = merged.machines.find((m) => m.id === 'mc1');
  assert.equal(mc1.online, true);
  assert.equal(mc1.sessions.length, 1);
  assert.equal(mc1.sessions[0].machine, 'mc1'); // 注入 machineId
  assert.equal(mc1.sessions[0].name, 's1');
});

test('mergeDashboards 离线机 → online:false,sessions:[]', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: false, error: 'ECONNREFUSED' },
  ]);
  assert.equal(merged.machines[0].online, false);
  assert.deepEqual(merged.machines[0].sessions, []);
  assert.equal(merged.machines[0].lastError, 'ECONNREFUSED');
});

test('mergeDashboards payload 缺失 sessions → 安全降级空数组', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true, payload: { tmuxOk: true } },
  ]);
  assert.deepEqual(merged.machines[0].sessions, []);
});

test('mergeDashboards 空输入 → { machines: [] }', () => {
  assert.deepEqual(mergeDashboards([]), { machines: [] });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
node --test test/hub-dashboard-aggregator.test.cjs
```
Expected: FAIL(`Cannot find module`)。

- [ ] **Step 3: 写实现(含轮询类;轮询类的并发抓取注入 fetcher,便于测试)**

```js
// hub/dashboard_aggregator.cjs
'use strict';

// 纯函数:合并各机抓取结果。每个结果: { machine:{id,name}, online, payload?, error? }
function mergeDashboards(results) {
  const machines = (results || []).map((r) => {
    const sessions = (r.online && r.payload && Array.isArray(r.payload.sessions))
      ? r.payload.sessions.map((s) => ({ ...s, machine: r.machine.id }))
      : [];
    return {
      id: r.machine.id,
      name: r.machine.name,
      online: !!r.online,
      sessions,
      lastError: r.online ? null : (r.error || 'offline'),
    };
  });
  return { machines };
}

// 轮询器:依赖注入 fetchOne(machineSecret) -> { online, payload?, error? }
class DashboardAggregator {
  constructor({ registry, fetchOne, intervalMs = 2000 }) {
    this._registry = registry;
    this._fetchOne = fetchOne;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._latest = { machines: [] };
  }
  start() {
    if (this._timer) return;
    this._tick(); // 立即跑一次
    this._timer = setInterval(() => this._tick(), this._intervalMs);
  }
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  async _tick() {
    const secrets = this._registry.all().map((m) => ({ id: m.id, name: m.name, url: m.url, token: m.token }));
    const results = await Promise.all(secrets.map(async (sec) => {
      try {
        const r = await this._fetchOne(sec);
        const online = !!r && r.ok;
        this._registry.setOnline(sec.id, online, online ? null : (r && r.error));
        return { machine: { id: sec.id, name: sec.name }, online, payload: online ? r.payload : null, error: online ? null : (r && r.error) };
      } catch (e) {
        this._registry.setOnline(sec.id, false, e.message);
        return { machine: { id: sec.id, name: sec.name }, online: false, error: e.message };
      }
    }));
    this._latest = mergeDashboards(results);
  }
  getLatest() { return this._latest; }
}

module.exports = { mergeDashboards, DashboardAggregator };
```

- [ ] **Step 4: 运行确认通过**

```bash
node --test test/hub-dashboard-aggregator.test.cjs
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add hub/dashboard_aggregator.cjs test/hub-dashboard-aggregator.test.cjs
git commit -m "feat(hub): 看板聚合合并纯函数 + 轮询器"
```

---

## Task 4: hub/agent_client.cjs — 每机 HTTP + per-session WS 池

**Files:**
- Create: `hub/agent_client.cjs`
- Create: `test/stub_machine.cjs`(集成测试复用的假机器)
- Test: `test/hub-agent-client.test.cjs`

- [ ] **Step 1: 写失败测试(用 stub_machine 起一个真 HTTP+WS 假机器)**

```js
// test/stub_machine.cjs
'use strict';
// 假机器:Express + ws,模拟各机 /api/dashboard + WS(?session=),带 token 校验。
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('node:http');

class StubMachine {
  constructor({ token, dashboardPayload, onWsMessage } = {}) {
    this.token = token;
    this.dashboardPayload = dashboardPayload || { tmuxOk: true, sessions: [] };
    this._onWsMessage = onWsMessage;
    this.received = []; // 收到的 WS input/key/batch
    this.app = express();
    this.app.use(express.json());
    this.app.get('/api/dashboard', (req, res) => {
      if (this.token) {
        const ok = req.headers.authorization === `Bearer ${this.token}`;
        if (!ok) return res.status(401).json({ error: 'unauthorized' });
      }
      res.json(this.dashboardPayload);
    });
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.wssOpts() });
    this.wss.on('connection', (ws, req) => {
      if (this.token) {
        const ok = req.headers.authorization === `Bearer ${this.token}`;
        if (!ok) { ws.close(1008, 'Unauthorized'); return; }
      }
      const url = new URL(req.url, 'http://x');
      const session = url.searchParams.get('session') || 'default';
      ws.send(JSON.stringify({ type: 'init', data: `[init ${session}]` }));
      ws.on('message', (buf) => {
        const msg = JSON.parse(buf.toString());
        this.received.push({ session, ...msg });
        if (this._onWsMessage) this._onWsMessage(session, msg, ws);
      });
    });
  }
  wssOpts() { return { server: this.server, path: '/' }; }
  start() {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const { port } = this.server.address();
        this.port = port;
        this.url = `http://127.0.0.1:${port}`;
        resolve(this);
      });
    });
  }
  stop() { return new Promise((r) => this.server.close(r)); }
}
module.exports = { StubMachine };
```

```js
// test/hub-agent-client.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentClient } = require('../hub/agent_client.cjs');
const { StubMachine } = require('./stub_machine.cjs');

test('fetchDashboard 带透传 token,返回 payload', async () => {
  const stub = await new StubMachine({ token: 'secret', dashboardPayload: { tmuxOk: true, sessions: [{ name: 's1', cwd: '/a', status: 'idle', lastLine: '', lastTs: 0, attached: false }] } }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 'secret' });
    const r = await ac.fetchDashboard();
    assert.equal(r.ok, true);
    assert.equal(r.payload.sessions[0].name, 's1');
  } finally { await stub.stop(); }
});

test('fetchDashboard token 错 → ok:false 401', async () => {
  const stub = await new StubMachine({ token: 'right' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 'wrong' });
    const r = await ac.fetchDashboard();
    assert.equal(r.ok, false);
    assert.match(r.error, /401/);
  } finally { await stub.stop(); }
});

test('fetchDashboard 连接失败 → ok:false', async () => {
  const ac = new AgentClient({ id: 'mc1', url: 'http://127.0.0.1:1', token: 't' });
  const r = await ac.fetchDashboard();
  assert.equal(r.ok, false);
});

test('attachSession 懒建 WS,收到 init 后回调,引用计数共享', async () => {
  const stub = await new StubMachine({ token: 't' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 't' });
    const inboxA = [];
    const refA = ac.attachSession('s1', (msg) => inboxA.push(msg));
    await refA.once('open'); // 等连接建立 + init
    assert.ok(inboxA.some((m) => m.type === 'init'));
    // 同 session 第二个订阅者复用同一条连接
    const inboxB = [];
    const refB = ac.attachSession('s1', (msg) => inboxB.push(msg));
    assert.equal(ac._poolSize('s1'), 1); // 仍是同一条 WS
    // 发 input 经透传到 stub
    refA.send({ type: 'input', data: 'hello', enter: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(stub.received.some((m) => m.type === 'input' && m.data === 'hello'));
    // detach 归零 → WS 关闭
    refA.detach(); refB.detach();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ac._poolSize('s1'), 0);
  } finally { await stub.stop(); }
});

test('sendOneShot 临时连接发完即关(用于 broadcast)', async () => {
  const stub = await new StubMachine({ token: 't' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 't' });
    await ac.sendOneShot('sX', { type: 'input', data: 'boom', enter: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(stub.received.some((m) => m.type === 'input' && m.data === 'boom' && m.session === 'sX'));
    assert.equal(ac._poolSize('sX'), 0); // 不留连接
  } finally { await stub.stop(); }
});
```

- [ ] **Step 2: 运行确认失败**

```bash
node --test test/hub-agent-client.test.cjs
```
Expected: FAIL(`Cannot find module '../hub/agent_client.cjs'`)。

- [ ] **Step 3: 写实现**

```js
// hub/agent_client.cjs
'use strict';

const WebSocket = require('ws');

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;

class AgentClient {
  constructor({ id, url, token }) {
    this.id = id;
    this.url = url;       // http://host:port
    this.token = token;
    // per-session: { ws, refs:Set<subscriber>, opened:Promise, retry:timer }
    this._pool = new Map();
  }

  // —— HTTP ——
  async fetchDashboard() {
    try {
      const res = await fetch(`${this.url}/api/dashboard`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return { ok: false, error: `${res.status}` };
      const payload = await res.json();
      return { ok: true, payload };
    } catch (e) {
      return { ok: false, error: e.code || e.message };
    }
  }

  async createSession({ name, cwd }) {
    const res = await fetch(`${this.url}/api/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cwd }),
    });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => '') };
  }

  async deleteSession(name) {
    const res = await fetch(`${this.url}/api/sessions/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return { ok: res.ok, status: res.status };
  }

  // —— WS 池(懒连接 + 引用计数) ——
  // 返回 subscription handle:{ detach(), send(msg), once('open'|'close'|'error') }
  attachSession(session, onMessage) {
    let entry = this._pool.get(session);
    if (!entry) {
      entry = this._createEntry(session);
      this._pool.set(session, entry);
    }
    entry.refs.add(onMessage);
    const handle = {
      _onMessage: onMessage,
      _session: session,
      detach: () => this._detach(session, onMessage),
      send: (msg) => this._send(session, msg),
      once: (ev) => entry.promises[ev] || Promise.resolve(),
    };
    return handle;
  }

  _createEntry(session) {
    const entry = { ws: null, refs: new Set(), retry: null, promises: {} };
    entry.promises.open = new Promise((res, rej) => { entry._resolveOpen = res; entry._rejectOpen = rej; });
    this._connect(session, entry);
    return entry;
  }

  _connect(session, entry) {
    const wsUrl = this.url.replace(/^http/, 'ws') + `/?session=${encodeURIComponent(session)}`;
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } });
    entry.ws = ws;
    ws.on('open', () => { entry._resolveOpen(); });
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      for (const cb of entry.refs) cb(msg);
    });
    ws.on('error', (err) => {
      for (const cb of entry.refs) cb({ type: 'error', data: err.message });
      // 不 reject open(可能已 resolve);重连在 close 里调度
    });
    ws.on('close', () => {
      if (entry.refs.size === 0) return; // 已无人订阅,不再重连
      this._scheduleReconnect(session, entry);
    });
  }

  _scheduleReconnect(session, entry) {
    if (entry.retry) return;
    const attempt = (entry._attempt = (entry._attempt || 0) + 1);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
    entry.retry = setTimeout(() => {
      entry.retry = null;
      if (entry.refs.size > 0) this._connect(session, entry);
    }, delay);
  }

  _send(session, msg) {
    const entry = this._pool.get(session);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  _detach(session, onMessage) {
    const entry = this._pool.get(session);
    if (!entry) return;
    entry.refs.delete(onMessage);
    if (entry.refs.size === 0) {
      if (entry.retry) { clearTimeout(entry.retry); entry.retry = null; }
      try { entry.ws && entry.ws.close(); } catch {}
      this._pool.delete(session);
    }
  }

  _poolSize(session) { const e = this._pool.get(session); return e ? 1 : 0; }

  // —— 一次性发送(广播用):临时建连、发完即关 ——
  async sendOneShot(session, msg) {
    // 若已有池连接则直接复用
    const entry = this._pool.get(session);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify(msg));
      return { ok: true };
    }
    const wsUrl = this.url.replace(/^http/, 'ws') + `/?session=${encodeURIComponent(session)}`;
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } });
      const timer = setTimeout(() => { try { ws.close(); } catch {}; resolve({ ok: false, error: 'timeout' }); }, 5000);
      ws.on('open', () => { ws.send(JSON.stringify(msg)); clearTimeout(timer); setTimeout(() => { try { ws.close(); } catch {} }, 100); resolve({ ok: true }); });
      ws.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }); });
    });
  }

  close() {
    for (const [session, entry] of this._pool) {
      if (entry.retry) { clearTimeout(entry.retry); entry.retry = null; }
      try { entry.ws && entry.ws.close(); } catch {}
    }
    this._pool.clear();
  }
}

module.exports = { AgentClient, RECONNECT_BASE_MS, RECONNECT_MAX_MS };
```

- [ ] **Step 4: 运行确认通过**

```bash
node --test test/hub-agent-client.test.cjs
```
Expected: PASS(若时序敏感测试偶发失败,把 `setTimeout` 等待从 50 调到 100)。

- [ ] **Step 5: 提交**

```bash
git add hub/agent_client.cjs test/hub-agent-client.test.cjs test/stub_machine.cjs
git commit -m "feat(hub): 每机 HTTP + per-session WS 池(agent_client.cjs)"
```

---

## Task 5: hub/ws_bridge.cjs — 浏览器↔agent 代理 + 扇出 + 引用计数

**Files:**
- Create: `hub/ws_bridge.cjs`
- Test: `test/hub-ws-bridge.test.cjs`

**协议回顾(spec §5.4):**
- 浏览器→hub:`attach{target:{machine,session}}`、`detach`、`input{target,data,enter}`、`key{target,data}`、`batch{target,data[]}`、`broadcast{targets[],data,enter}`
- hub→浏览器:`init{target,data}`、`output{target,data}`、`error{target,data}`、`broadcast_result{results[]}`

- [ ] **Step 1: 写失败测试**

```js
// test/hub-ws-bridge.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { WsBridge } = require('../hub/ws_bridge.cjs');

// 假浏览器 ws:收集 send,提供 emit 收消息
function fakeBrowserWs() {
  const sent = [];
  const listeners = {};
  return {
    sent,
    readyState: 1,
    send: (s) => sent.push(JSON.parse(s)),
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: (ev, arg) => (listeners[ev] || []).forEach((fn) => fn(arg)),
    close: () => {},
  };
}

// 假 agent client 工厂:记录 attach/sendOneShot 调用
function fakeAgentFactory(handlers) {
  return {
    attach: handlers.attach,
    sendOneShot: handlers.sendOneShot,
    getById: handlers.getById,
  };
}

test('attach → 订阅 agent,agent 消息转发给浏览器带 target', () => {
  let pushed;
  const bridge = new WsBridge({
    getClient: (mid) => fakeAgentFactory({
      getById: () => ({ id: mid }),
      attach: (session, onMsg) => { pushed = onMsg; return { detach() {}, send() {}, once: () => Promise.resolve() }; },
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  pushed({ type: 'init', data: 'screen' });
  assert.deepEqual(ws.sent[0], { type: 'init', target: { machine: 'mc1', session: 's1' }, data: 'screen' });
});

test('input → 经当前 attach 的 handle 发送;未 attach 则 error', () => {
  let sentViaHandle = null;
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: (session, onMsg) => ({ detach() {}, send: (m) => { sentViaHandle = m; }, once: () => Promise.resolve() }),
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  ws.emit('message', JSON.stringify({ type: 'input', target: { machine: 'mc1', session: 's1' }, data: 'hi', enter: true }));
  assert.deepEqual(sentViaHandle, { type: 'input', data: 'hi', enter: true });
});

test('broadcast 去重 + 扇出 + 上限 50 + 返回 broadcast_result', async () => {
  const shots = [];
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: () => ({ detach() {}, send() {}, once: () => Promise.resolve() }),
      sendOneShot: async (session, msg) => { shots.push({ session, msg }); return { ok: true }; },
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  // 去重:同 target 出现两次 → 只发一次
  const targets = [
    { machine: 'mc1', session: 'a' },
    { machine: 'mc1', session: 'a' },
    { machine: 'mc1', session: 'b' },
  ];
  await bridge.handleBroadcast(ws, { targets, data: 'go', enter: true });
  assert.equal(shots.length, 2); // a 去重后 + b
  const result = ws.sent.find((m) => m.type === 'broadcast_result');
  assert.equal(result.results.length, 2);
  assert.equal(result.results.every((r) => r.ok), true);

  // 上限 50
  const tooMany = Array.from({ length: 51 }, (_, i) => ({ machine: 'mc1', session: `s${i}` }));
  const ws2 = fakeBrowserWs();
  bridge.handleConnection(ws2);
  await bridge.handleBroadcast(ws2, { targets: tooMany, data: 'x', enter: true });
  const err = ws2.sent.find((m) => m.type === 'error');
  assert.match(err.data, /50/);
});

test('detach 清理订阅', () => {
  let detached = false;
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: () => ({ detach: () => { detached = true; }, send() {}, once: () => Promise.resolve() }),
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  ws.emit('message', JSON.stringify({ type: 'detach' }));
  assert.equal(detached, true);
});
```

- [ ] **Step 2: 运行确认失败**

```bash
node --test test/hub-ws-bridge.test.cjs
```
Expected: FAIL(`Cannot find module`)。

- [ ] **Step 3: 写实现**

```js
// hub/ws_bridge.cjs
'use strict';

const BROADCAST_MAX_TARGETS = 50;

class WsBridge {
  constructor({ getClient }) {
    this._getClient = getClient; // (machineId) => { attach, sendOneShot, getById } | null
  }

  // 处理一条浏览器 WS 连接
  handleConnection(ws) {
    // 每条浏览器连接维护「当前 attach 的 handle」
    let current = null; // { machine, session, handle }

    const detachCurrent = () => {
      if (current) { try { current.handle.detach(); } catch {} current = null; }
    };

    ws.on('message', async (raw) => {
      let payload; try { payload = JSON.parse(raw.toString()); } catch { return; }
      const { type } = payload || {};

      if (type === 'attach') {
        detachCurrent();
        const { machine, session } = payload.target || {};
        const client = this._getClient(machine);
        if (!client || !client.getById(machine)) { this._send(ws, { type: 'error', target: payload.target, data: `unknown machine: ${machine}` }); return; }
        const handle = client.attach(session, (msg) => {
          this._send(ws, { ...msg, target: { machine, session } });
        });
        current = { machine, session, handle };
        return;
      }

      if (type === 'detach') { detachCurrent(); return; }

      if (type === 'input' || type === 'key' || type === 'batch') {
        const { machine, session } = payload.target || {};
        if (!current || current.machine !== machine || current.session !== session) {
          // 临时路径:允许未 attach 的 target 走 sendOneShot(input/key/batch)
          const client = this._getClient(machine);
          if (!client) { this._send(ws, { type: 'error', target: payload.target, data: `unknown machine: ${machine}` }); return; }
          const r = await client.sendOneShot(session, { type, data: payload.data, enter: payload.enter });
          if (!r.ok) this._send(ws, { type: 'error', target: payload.target, data: r.error || 'send failed' });
          return;
        }
        const ok = current.handle.send({ type, data: payload.data, enter: payload.enter });
        if (!ok) this._send(ws, { type: 'error', target: payload.target, data: 'session not connected' });
        return;
      }

      if (type === 'broadcast') {
        await this.handleBroadcast(ws, payload);
        return;
      }
    });

    ws.on('close', () => detachCurrent());
    ws.on('error', () => detachCurrent());
  }

  async handleBroadcast(ws, payload) {
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (targets.length > BROADCAST_MAX_TARGETS) {
      this._send(ws, { type: 'error', data: `broadcast targets 超过上限 ${BROADCAST_MAX_TARGETS}` });
      return;
    }
    // 去重(同 machine+session)
    const seen = new Set();
    const dedup = [];
    for (const t of targets) {
      const key = `${t.machine}/${t.session}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(t);
    }
    const results = await Promise.all(dedup.map(async (t) => {
      const client = this._getClient(t.machine);
      if (!client) return { target: t, ok: false, error: `unknown machine: ${t.machine}` };
      const r = await client.sendOneShot(t.session, { type: 'input', data: payload.data, enter: payload.enter });
      return { target: t, ok: r.ok, error: r.ok ? undefined : r.error };
    }));
    this._send(ws, { type: 'broadcast_result', results });
  }

  _send(ws, obj) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

module.exports = { WsBridge, BROADCAST_MAX_TARGETS };
```

- [ ] **Step 4: 运行确认通过**

```bash
node --test test/hub-ws-bridge.test.cjs
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add hub/ws_bridge.cjs test/hub-ws-bridge.test.cjs
git commit -m "feat(hub): 浏览器↔agent WS 代理 + 广播扇出 + 引用计数"
```

---

## Task 6: hub/server.cjs — hub HTTP+WS 服务(对浏览器)+ REST 代理

**Files:**
- Create: `hub/server.cjs`
- Test: `test/hub-server.test.cjs`

- [ ] **Step 1: 写失败测试(端到端,起真 hub + 2 个 stub 机器)**

```js
// test/hub-server.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-srv-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function withHub(stubs, token, fn) {
  const machines = stubs.map((s, i) => ({ id: `mc${i + 1}`, name: `M${i + 1}`, url: s.url, token: s.token }));
  const { file, cleanup } = tmpMachinesFile(machines);
  const hub = await startHub({ machinesFile: file, hubToken: token, host: '127.0.0.1', port: 0, intervalMs: 100 });
  try { await fn(hub); } finally { await hub.stop(); cleanup(); }
}

test('GET /api/global-dashboard 聚合多机(带 hub token cookie)', async () => {
  const s1 = await new StubMachine({ token: 't1', dashboardPayload: { tmuxOk: true, sessions: [{ name: 'a', cwd: '/a', status: 'working', lastLine: 'x', lastTs: 1, attached: false }] } }).start();
  const s2 = await new StubMachine({ token: 't2', dashboardPayload: { tmuxOk: true, sessions: [] } }).start();
  try {
    await withHub([s1, s2], 'hubtok', async (hub) => {
      await new Promise((r) => setTimeout(r, 250)); // 等一轮轮询
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, { headers: { Cookie: 'cc_web_auth=hubtok' } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.machines.length, 2);
      const mc1 = body.machines.find((m) => m.id === 'mc1');
      assert.equal(mc1.online, true);
      assert.equal(mc1.sessions[0].machine, 'mc1');
    });
  } finally { await s1.stop(); await s2.stop(); }
});

test('未授权 → 401', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`);
      assert.equal(res.status, 401);
    });
  } finally { await s1.stop(); }
});

test('WS attach + 双向转发(init/output) ', async () => {
  let stubWs;
  const s1 = await new StubMachine({ token: 't1', onWsMessage: (sess, msg, ws) => { stubWs = ws; } }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=hubtok`);
      await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); });
      const inbox = [];
      ws.on('message', (b) => inbox.push(JSON.parse(b.toString())));
      ws.send(JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(inbox.some((m) => m.type === 'init' && m.target.machine === 'mc1'));
      // 浏览器 → agent
      ws.send(JSON.stringify({ type: 'input', target: { machine: 'mc1', session: 's1' }, data: 'ping', enter: true }));
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(s1.received.some((m) => m.type === 'input' && m.data === 'ping'));
      ws.close();
    });
  } finally { await s1.stop(); }
});

test('POST /api/sessions 代理到目标机', async () => {
  let created = null;
  const s1 = await new StubMachine({ token: 't1' }).start();
  s1.app.post('/api/sessions', (req, res) => { created = req.body; res.status(201).json({ success: true }); });
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions`, {
        method: 'POST', headers: { Cookie: 'cc_web_auth=hubtok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine: 'mc1', name: 'newS', cwd: '/p' }),
      });
      assert.equal(res.status, 201);
      assert.deepEqual(created, { name: 'newS', cwd: '/p' });
    });
  } finally { await s1.stop(); }
});
```

> 注:hub WS 鉴权用 query `?token=`(浏览器侧 WS 不方便带 cookie 时)或 cookie;本实现两者皆支持(见 Step 3)。

- [ ] **Step 2: 运行确认失败**

```bash
node --test test/hub-server.test.cjs
```
Expected: FAIL(`Cannot find module`)。

- [ ] **Step 3: 写实现(复用根 auth.cjs)**

```js
// hub/server.cjs
'use strict';

const express = require('express');
const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const auth = require('../auth.cjs');
const { loadMachines } = require('./config.cjs');
const { MachineRegistry } = require('./registry.cjs');
const { DashboardAggregator } = require('./dashboard_aggregator.cjs');
const { AgentClient } = require('./agent_client.cjs');
const { WsBridge } = require('./ws_bridge.cjs');

function startHub(opts) {
  const {
    machinesFile,
    hubToken,
    host = process.env.CC_WEB_HUB_HOST || '127.0.0.1',
    port = Number(process.env.CC_WEB_HUB_PORT) || 7685,
    intervalMs = Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS) || 2000,
  } = opts;

  if (!hubToken) throw new Error('CC_WEB_HUB_TOKEN 必设(裸奔危险)');

  const machines = loadMachines(machinesFile);
  const registry = new MachineRegistry(machines);

  // 每机一个 agent_client
  const clients = new Map();
  for (const m of machines) clients.set(m.id, new AgentClient({ id: m.id, url: m.url, token: m.token }));

  const aggregator = new DashboardAggregator({
    registry,
    intervalMs,
    fetchOne: async (sec) => {
      const ac = clients.get(sec.id);
      const r = await ac.fetchDashboard();
      return r.ok ? { ok: true, payload: r.payload } : { ok: false, error: r.error };
    },
  });

  const app = express();
  app.use(express.json());

  // 静态:控制台前端(复用 public/)
  const publicDir = require('node:path').join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  const requireHubAuth = (req, res) => {
    const ok = auth.isAuthorized(
      { cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization },
      hubToken
    );
    if (!ok) { res.status(401).json({ error: 'unauthorized' }); return false; }
    return true;
  };

  app.get('/api/config', (req, res) => { if (!requireHubAuth(req, res)) return; res.json({ hub: true, intervalMs }); });
  app.get('/api/machines', (req, res) => { if (!requireHubAuth(req, res)) return; res.json({ machines: registry.snapshot() }); });
  app.get('/api/global-dashboard', (req, res) => { if (!requireHubAuth(req, res)) return; res.json(aggregator.getLatest()); });

  app.post('/api/sessions', async (req, res) => {
    if (!requireHubAuth(req, res)) return;
    const { machine, name, cwd } = req.body || {};
    const ac = clients.get(machine);
    if (!ac) { res.status(404).json({ error: `unknown machine: ${machine}` }); return; }
    const r = await ac.createSession({ name, cwd });
    res.status(r.status).json(r.body || { ok: r.ok });
  });

  app.delete('/api/sessions/:machine/:name', async (req, res) => {
    if (!requireHubAuth(req, res)) return;
    const ac = clients.get(req.params.machine);
    if (!ac) { res.status(404).json({ error: `unknown machine: ${req.params.machine}` }); return; }
    const r = await ac.deleteSession(req.params.name);
    res.status(r.status).json({ ok: r.ok });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const bridge = new WsBridge({ getClient: (mid) => clients.get(mid) });

  wss.on('connection', (ws, req) => {
    // 鉴权:cookie 或 ?token= query
    const url = new URL(req.url, 'http://x');
    const queryToken = url.searchParams.get('token');
    const ok = auth.isAuthorized(
      { cookieHeader: req.headers.cookie, authorizationHeader: queryToken ? `Bearer ${queryToken}` : req.headers.authorization },
      hubToken
    );
    if (!ok) { try { ws.close(1008, 'Unauthorized'); } catch {} return; }
    bridge.handleConnection(ws);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      aggregator.start();
      const addr = server.address();
      resolve({
        port: addr.port,
        close: async () => { aggregator.stop(); for (const ac of clients.values()) ac.close(); wss.close(); await new Promise((r) => server.close(r)); },
        stop: async function () { await this.close(); },
      });
    });
  });
}

module.exports = { startHub };
```

- [ ] **Step 4: 运行确认通过**

```bash
node --test test/hub-server.test.cjs
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add hub/server.cjs test/hub-server.test.cjs
git commit -m "feat(hub): hub HTTP+WS 服务 + REST 代理(复用 auth.cjs)"
```

---

## Task 7: bin 分发 — `cc-web-control hub` 子命令

**Files:**
- Modify: `bin/cc-web-control.cjs`
- Test: 扩展 `test/`(可加 `test/bin-dispatch.test.cjs`)

- [ ] **Step 1: 写失败测试(子命令路由,纯函数化 main)**

```js
// test/bin-dispatch.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubcommand } = require('../bin/cc-web-control.cjs');

test('无参 → 子命令 default(单机)', () => {
  assert.deepEqual(parseSubcommand([]), { sub: 'default', args: [] });
});

test('hub → 子命令 hub', () => {
  assert.deepEqual(parseSubcommand(['hub']), { sub: 'hub', args: [] });
});

test('hub --port 8000 → args 透传', () => {
  assert.deepEqual(parseSubcommand(['hub', '--port', '8000']), { sub: 'hub', args: ['--port', '8000'] });
});
```

> 注:测试里函数名统一用 `parseSubcommand`(小写 c)。实现里导出同名。

- [ ] **Step 2: 运行确认失败**

```bash
node --test test/bin-dispatch.test.cjs
```
Expected: FAIL(`parseSubcommand is not a function`)。

- [ ] **Step 3: 改 bin(向后兼容:无 `hub` 第一参 → 原单机行为)**

修改 `bin/cc-web-control.cjs`,在 `main` 之前加入子命令解析:

```js
// 新增导出(放在 module.exports 之前)
function parseSubcommand(argv) {
  const args = argv.slice(2);
  if (args[0] === 'hub') return { sub: 'hub', args: args.slice(1) };
  return { sub: 'default', args };
}

// 改 main(替换原 main 的函数体调用处)
function main(existsFn = commandExists, argv = process.argv) {
  const { sub } = parseSubcommand(argv);
  if (sub === 'hub') {
    require(path.join(__dirname, '..', 'hub', 'server_entry.cjs'));
    return;
  }
  const missing = findMissing(existsFn);
  if (missing.length) {
    console.error(formatMissing(missing));
    process.exit(1);
    return;
  }
  startServer();
}
```

并把入口改为 `if (require.main === module) main(undefined, process.argv);`,导出加 `parseSubcommand`。

新建 `hub/server_entry.cjs`(读环境变量启动 hub,作为 `cc-web-control hub` 的入口):

```js
// hub/server_entry.cjs
'use strict';
const os = require('node:os');
const path = require('node:path');
const { startHub } = require('./server.cjs');

const machinesFile = process.env.CC_WEB_HUB_MACHINES_FILE ||
  path.join(os.homedir(), '.cc-web-control', 'hub-machines.json');
const hubToken = process.env.CC_WEB_HUB_TOKEN;

startHub({
  machinesFile,
  hubToken,
  host: process.env.CC_WEB_HUB_HOST,
  port: process.env.CC_WEB_HUB_PORT && Number(process.env.CC_WEB_HUB_PORT),
  intervalMs: process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS && Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS),
}).then((hub) => {
  console.log(`[hub] listening on 127.0.0.1:${hub.port} (machines: ${machinesFile})`);
}).catch((e) => {
  console.error(`[hub] 启动失败: ${e.message}`);
  process.exit(1);
});
```

- [ ] **Step 4: 运行确认通过**

```bash
node --test test/bin-dispatch.test.cjs
```
Expected: PASS。再跑全量回归:`node --test test/*.test.cjs`。

- [ ] **Step 5: 提交**

```bash
git add bin/cc-web-control.cjs hub/server_entry.cjs test/bin-dispatch.test.cjs
git commit -m "feat(bin): 增加 cc-web-control hub 子命令分发"
```

---

## Task 8: 前端控制台 — console.html + console.js

**Files:**
- Create: `public/console.html`
- Create: `public/console.js`
- Modify: `public/dashboard.css`(追加三区布局类,不改现有规则)

**范围说明:** 复用现有终端渲染与样式。本 task 重点:全局看板轮询表、WS attach 切换、多选广播栏。**不重写终端**,而是复用 `client.js` 中已有的终端 DOM 操作逻辑(若复用成本高,则 console.js 自带最小终端渲染)。鉴于前端是手测为主,本 task 不强制单测,但提供结构化代码 + 手测清单。

- [ ] **Step 1: console.html(三区骨架)**

```html
<!-- public/console.html -->
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>cc-web-control · 多机控制台</title>
  <link rel="stylesheet" href="dashboard.css" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="console-header">
    <h1>多机控制台</h1>
    <div id="hub-status"></div>
  </header>

  <!-- ① 全局看板 -->
  <section class="console-board">
    <table id="global-board">
      <thead>
        <tr><th class="sel"></th><th>机器 / 会话</th><th class="st">状态</th><th>最后输出</th></tr>
      </thead>
      <tbody id="board-body"></tbody>
    </table>
  </section>

  <!-- ② 终端 -->
  <section class="console-term">
    <div id="term-target" class="term-target">未选择会话</div>
    <pre id="term-screen" class="term-screen"></pre>
    <form id="term-input-form" class="term-input-form">
      <input id="term-input" class="term-input" placeholder="输入(Enter 发送)…" autocomplete="off" />
    </form>
  </section>

  <!-- ③ 广播栏(多选 ≥2 时出现) -->
  <footer class="console-broadcast" id="broadcast-bar" hidden>
    <span id="bc-count" class="bc-count"></span>
    <input id="bc-input" class="bc-input" placeholder="给这些会话发同一条指令…" autocomplete="off" />
    <button id="bc-send" class="bc-send">扇出</button>
    <div id="bc-result" class="bc-result"></div>
  </footer>

  <script src="console.js"></script>
</body>
</html>
```

- [ ] **Step 2: dashboard.css 追加三区布局类(追加到文件末尾,不改现有规则)**

```css
/* ===== 多机控制台三区布局(追加,不改现有规则) ===== */
.console-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; }
.console-board { padding:0 12px; max-height:38vh; overflow:auto; }
#global-board { width:100%; border-collapse:collapse; font-size:.9em; }
#global-board th, #global-board td { padding:4px 8px; border-bottom:1px solid rgba(255,255,255,.08); text-align:left; }
#global-board tr.row { cursor:pointer; }
#global-board tr.row.active { background:rgba(96,165,250,.15); }
.st-working { color:#34d399; } .st-waiting{color:#fbbf24;} .st-idle{color:#94a3b8;} .st-errored{color:#f87171;} .st-unknown{color:#64748b;}
.term-target { opacity:.6; font-size:.85em; padding:4px 12px; }
.term-screen { margin:0 12px; padding:8px; background:#000; color:#e5e7eb; font-family:monospace; font-size:.85em; min-height:30vh; max-height:38vh; overflow:auto; white-space:pre-wrap; }
.term-input-form { display:flex; gap:6px; padding:6px 12px; }
.term-input { flex:1; }
.console-broadcast { position:sticky; bottom:0; display:flex; gap:6px; align-items:center; padding:8px 12px; background:rgba(245,158,11,.08); border-top:1px solid rgba(245,158,11,.3); }
.bc-count { font-size:.8em; background:rgba(245,158,11,.2); padding:2px 8px; border-radius:4px; }
.bc-send { background:#f59e0b; color:#fff; border:0; padding:4px 12px; border-radius:4px; cursor:pointer; }
.bc-result { font-size:.75em; opacity:.8; }
```

- [ ] **Step 3: console.js(看板轮询 + WS attach + 广播)**

```js
// public/console.js
'use strict';
(function () {
  const TOKEN = (() => {
    const m = document.cookie.match(/(?:^|;\s*)cc_web_auth=([^;]+)/);
    return m ? m[1] : new URLSearchParams(location.search).get('token') || '';
  })();
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?token=${encodeURIComponent(TOKEN)}`;
  let ws = null;
  let currentTarget = null;       // {machine,session}
  const selected = new Set();     // "machine/session"

  const boardBody = document.getElementById('board-body');
  const termTarget = document.getElementById('term-target');
  const termScreen = document.getElementById('term-screen');
  const termInput = document.getElementById('term-input');
  const termForm = document.getElementById('term-input-form');
  const bcBar = document.getElementById('broadcast-bar');
  const bcCount = document.getElementById('bc-count');
  const bcInput = document.getElementById('bc-input');
  const bcSend = document.getElementById('bc-send');
  const bcResult = document.getElementById('bc-result');

  function ensureWs() {
    if (ws && ws.readyState <= 1) return ws;
    ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if ((msg.type === 'init' || msg.type === 'output') && currentTarget &&
          msg.target.machine === currentTarget.machine && msg.target.session === currentTarget.session) {
        termScreen.textContent = msg.data || '';
        termScreen.scrollTop = termScreen.scrollHeight;
      } else if (msg.type === 'error' && currentTarget && msg.target &&
                 msg.target.machine === currentTarget.machine && msg.target.session === currentTarget.session) {
        termScreen.textContent += `\n[错误] ${msg.data}`;
      } else if (msg.type === 'broadcast_result') {
        const okN = msg.results.filter((r) => r.ok).length;
        bcResult.textContent = `成功 ${okN}/${msg.results.length}`;
      }
    };
    return ws;
  }

  function attachTarget(t) {
    currentTarget = t;
    termTarget.textContent = t ? `${t.machine} / ${t.session}` : '未选择会话';
    termScreen.textContent = '';
    if (!t) return;
    ensureWs().addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'attach', target: t }));
    });
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'attach', target: t }));
  }

  termForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentTarget || !termInput.value) return;
    ws.send(JSON.stringify({ type: 'input', target: currentTarget, data: termInput.value, enter: true }));
    termInput.value = '';
  });

  function renderBoard(payload) {
    boardBody.innerHTML = '';
    for (const m of payload.machines) {
      for (const s of m.sessions) {
        const key = `${m.id}/${s.name}`;
        const tr = document.createElement('tr');
        tr.className = 'row';
        if (currentTarget && currentTarget.machine === m.id && currentTarget.session === s.name) tr.classList.add('active');
        const sel = document.createElement('td'); sel.className = 'sel';
        const cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = selected.has(key);
        cb.addEventListener('change', () => { cb.checked ? selected.add(key) : selected.delete(key); refreshBroadcast(); });
        cb.addEventListener('click', (e) => e.stopPropagation());
        sel.appendChild(cb);
        const name = document.createElement('td'); name.textContent = `${m.name||m.id} / ${s.name}`;
        const st = document.createElement('td'); st.className = 'st-' + (s.status || 'unknown'); st.textContent = s.status || 'unknown';
        const last = document.createElement('td'); last.textContent = s.lastLine || (m.online ? '' : '(离线)');
        tr.append(sel, name, st, last);
        tr.addEventListener('click', () => attachTarget({ machine: m.id, session: s.name }));
        boardBody.appendChild(tr);
      }
    }
  }

  function refreshBroadcast() {
    bcBar.hidden = selected.size < 2;
    bcCount.textContent = `已选 ${selected.size} 个会话`;
  }

  bcSend.addEventListener('click', () => {
    const targets = Array.from(selected).map((k) => { const [machine, session] = k.split('/'); return { machine, session }; });
    if (!targets.length || !bcInput.value) return;
    bcResult.textContent = '扇出中…';
    ensureWs().addEventListener('open', () => ws.send(JSON.stringify({ type: 'broadcast', targets, data: bcInput.value, enter: true })));
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'broadcast', targets, data: bcInput.value, enter: true }));
    bcInput.value = '';
  });

  async function poll() {
    try {
      const res = await fetch('/api/global-dashboard', { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (res.ok) renderBoard(await res.json());
    } catch {}
  }
  setInterval(poll, 2000);
  poll();
  ensureWs();
})();
```

- [ ] **Step 4: 手测清单**

启动两台假机器(或真机),写 `~/.cc-web-control/hub-machines.json`,然后:
```bash
CC_WEB_HUB_TOKEN=myhubtoken cc-web-control hub
# 浏览器打开 http://127.0.0.1:7685/console.html (登录后)
```
手测验收点:
- [ ] 看板列出所有机器所有会话,状态色正确,2s 刷新。
- [ ] 点一行 → 终端切换到该会话,显示 init 屏;输入框发送后对方收到。
- [ ] 多选 ≥2 行 → 广播栏出现;输入指令点扇出 → 各会话收到,显示成功数。
- [ ] 关停一台机器 → 该机看板标离线,其余不受影响。

- [ ] **Step 5: 提交**

```bash
git add public/console.html public/console.js public/dashboard.css
git commit -m "feat(hub): 多机控制台前端(看板+终端切换+广播栏)"
```

---

## Task 9: 全量回归 + README 文档片段

**Files:**
- Modify: `README.md`(追加「多机 Hub 用法」段落)

- [ ] **Step 1: 全量回归**

```bash
node --test test/*.test.cjs
```
Expected: 全部 PASS,无回归。

- [ ] **Step 2: 覆盖率自查(80%+)**

```bash
node --test --experimental-test-coverage test/hub-*.test.cjs
```
确认 hub/ 下文件行覆盖率 ≥ 80%。未覆盖处补测试(优先 agent_client 的重连分支、ws_bridge 的 input 未 attach 路径)。

- [ ] **Step 3: README 追加用法**

在 `README.md` 追加:

```markdown
## 多机 Hub(集中管理多台机器)

1. 各机:暴露内网 + 开 token
   `CC_WEB_HOST=0.0.0.0 CC_WEB_AUTH_TOKEN=<machine-token> cc-web-control`
2. 写机器清单 `~/.cc-web-control/hub-machines.json`(权限 0600):
   ```json
   { "machines": [
     { "id":"mc1","name":"Mac","url":"http://192.168.1.10:7684","token":"<machine-token>" }
   ] }
   ```
3. 启 hub:`CC_WEB_HUB_TOKEN=<hub-token> cc-web-control hub`
4. 浏览器开 `http://<hub-host>:7685/console.html`,用 hub token 登录。

> 各机 cc-web-control 无需任何改动(见设计文档 §4.3)。
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: 多机 Hub 用法"
```

---

## 验收对照(spec §11)

| 验收 | 覆盖 task |
|---|---|
| 1. 连 ≥2 机,global-dashboard 返回所有会话 | T3, T6 |
| 2. 点行切终端,双向交互 | T4, T5, T6, T8 |
| 3. 多选 ≥2 广播,逐 target 成败 | T5, T6, T8 |
| 4. 关机标 offline,其余不受影响 | T2, T3, T6 |
| 5. 单 token 登录,未授权被拒 | T6 |
| 6. 各机零改动,单机零回归 | T7(bin 向后兼容) |
| 7. 覆盖率 ≥ 80% | T1–T6, T9 |

## 备注

- **二期**(主控编排 agent)见 spec §12,不在本计划。
- 本计划**不提交代码除非用户要求**;在 main 分支执行前先建特性分支 `feat/multi-host-hub`。
