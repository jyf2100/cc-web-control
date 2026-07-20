'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { MachineRegistry } = require('../hub/registry.cjs');
const { AgentRegistrar } = require('../hub/register_server.cjs');

// 把 registrar 挂在一个真实 WS server 上,用 client 模拟单机
async function withRegistrar({ hubToken = 'ht', registerToken = '', idleTimeoutMs } = {}, fn) {
  const registry = new MachineRegistry([]);
  const clients = new Map();
  let created = [];
  const FakeAgentClient = class { constructor(o){ this.o = o; created.push(o); } fetchDashboard(){ return {ok:true,payload:{sessions:[]}}; } close(){} };
  const registrar = new AgentRegistrar({
    registry, clients, AgentClientCtor: FakeAgentClient, hubToken, registerToken,
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
    log: { warn(){}, error(){} },
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

// ---- Finding 1:hub 响应 ping→pong + ping 重置 idle 计时器 ----

// 辅助:连上 → 发 register 帧 → 等 registered 回执
async function connectAndRegister(port, token, { id = 'm1', url = 'http://h:1', machineToken = 't' } = {}) {
  const ws = connect(port, token);
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'register', id, name: id, url, token: machineToken }));
  await new Promise((r) => setTimeout(r, 60));
  return ws;
}

test('ping 帧收到 → 回 pong(心跳响应)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ port, stop }) => {
    const ws = await connectAndRegister(port, 'ht');
    const got = new Promise((resolve) => {
      ws.on('message', (buf) => {
        let m; try { m = JSON.parse(buf.toString()); } catch { return; }
        if (m.type === 'pong') resolve(true);
      });
    });
    ws.send(JSON.stringify({ type: 'ping' }));
    assert.ok(await got, '应在收到 ping 后回 pong');
    ws.close(); await stop();
  });
});

test('ping 重置 idle:持续 ping → 连接存活过 idle 超时', async () => {
  // 注入 idleTimeoutMs=100,周期发 ping(< idle),验证 ping 真把 idle 计时器反复重置。
  // 若 ping 未重置 idle,连接会在 ~100ms 被 close(idle timeout);持续 ping 应让它活过该点。
  await withRegistrar({ hubToken: 'ht', idleTimeoutMs: 100 }, async ({ port, stop }) => {
    const ws = await connectAndRegister(port, 'ht');
    // 每 30ms 发一次 ping(模拟真实 client PING_INTERVAL_MS=20s < IDLE=60s 的关系)
    const pinger = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 30);
    // 等 170ms:远超原 idle(100ms)。ping 持续重置 idle → 不应断开。
    await new Promise((r) => setTimeout(r, 170));
    clearInterval(pinger);
    assert.equal(ws.readyState, WebSocket.OPEN, '持续 ping 应重置 idle,连接存活过原 idle 超时');
    ws.close(); await stop();
  });
});

test('无 ping → idle 超时正常断开(对照组)', async () => {
  // 对照:不 ping,idleTimeoutMs=80,连接应在 ~80ms 被关。
  await withRegistrar({ hubToken: 'ht', idleTimeoutMs: 80 }, async ({ port, stop }) => {
    const ws = await connectAndRegister(port, 'ht');
    const closed = await new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
    assert.equal(closed.code, 1000);
    assert.ok(/idle/.test(closed.reason), `应为 idle timeout,实际 ${closed.reason}`);
    await stop();
  });
});

// ---- cli_tool 注册协议(验收 #1 显式上报 / #2 缺省回退 unknown)----
test('register 帧带 cli_tool=grok-build → registry 持久化该值', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', name: 'M1', url: 'http://h:1', token: 't', cli_tool: 'grok-build' }));
    await new Promise((r) => setTimeout(r, 80));
    const m = registry.getById('m1');
    assert.equal(m.cli_tool, 'grok-build'); // 验收 #1:显式上报原样持久化
    ws.close(); await stop();
  });
});

test('register 帧不含 cli_tool → 回退 unknown(旧 agent 兼容,2xx 注册成功)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    // 旧版 agent:不带 cli_tool 字段
    ws.send(JSON.stringify({ type: 'register', id: 'm1', name: 'M1', url: 'http://h:1', token: 't' }));
    const got = await new Promise((r) => {
      ws.on('message', (buf) => { let m; try { m = JSON.parse(buf.toString()); } catch { return; } if (m.type === 'registered') r(true); });
    });
    assert.ok(got, '缺省 cli_tool 仍应注册成功(2xx 语义:回执 registered)');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(registry.getById('m1').cli_tool, 'unknown'); // 验收 #2:缺省回退 unknown
    ws.close(); await stop();
  });
});

test('register 帧 cli_tool 非枚举值 → 回退 unknown(不报错)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', name: 'M1', url: 'http://h:1', token: 't', cli_tool: 'not-a-tool' }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(registry.getById('m1').cli_tool, 'unknown');
    ws.close(); await stop();
  });
});
