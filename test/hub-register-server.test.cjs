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

// ---- mods 巡检上报(注册帧 + 心跳 ping;hub 侧清洗 + registry 持久) ----

test('register 帧带 mods → registry 存储(含 hub 侧重算的 risk/state)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({
      type: 'register', id: 'm1', name: 'M1', url: 'http://h:1', token: 't',
      mods: { cc_version: '2.1.300', mods_count: 2, source: 'fixture', risk: false }, // 客户端伪造 risk:false 应被重算
    }));
    await new Promise((r) => setTimeout(r, 80));
    const m = registry.getById('m1');
    assert.ok(m.mods, 'mods 应存入 registry');
    assert.equal(m.mods.mods_count, 2);
    assert.equal(m.mods.risk, true, 'hub 依 cc_version=2.1.300 + count=2 重算 risk(不信任客户端自评)');
    assert.equal(m.mods.state, 'risk');
    // snapshot()/all() 剥离 token/conn,mods 数据保留
    assert.ok(registry.snapshot().find((x) => x.id === 'm1').mods);
    ws.close(); await stop();
  });
});

test('心跳 ping 帧刷新 mods → registry 更新(验收 4:下一心跳周期内状态变化可见)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', url: 'http://h:1', token: 't',
      mods: { cc_version: '2.1.300', mods_count: 2, source: 'fixture' } }));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(registry.getById('m1').mods.mods_count, 2);
    assert.equal(registry.getById('m1').mods.risk, true);
    // 模拟单机删除 mods 夹具:下一次心跳上报 count 0
    ws.send(JSON.stringify({ type: 'ping', mods: { cc_version: '2.1.300', mods_count: 0, source: 'fixture' } }));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(registry.getById('m1').mods.mods_count, 0, '心跳应刷新 mods 计数');
    assert.equal(registry.getById('m1').mods.risk, false, '风险标记随计数归零消失');
    ws.close(); await stop();
  });
});

test('mods 巡检异常帧(error)→ registry 记录 error 状态(验收 5)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', url: 'http://h:1', token: 't' }));
    await new Promise((r) => setTimeout(r, 60));
    ws.send(JSON.stringify({ type: 'ping', mods: { cc_version: 'unknown', mods_count: 0, source: '', error: 'EACCES' } }));
    await new Promise((r) => setTimeout(r, 60));
    const mods = registry.getById('m1').mods;
    assert.equal(mods.state, 'error');
    assert.equal(mods.error, 'EACCES');
    ws.close(); await stop();
  });
});

test('心跳携带垃圾 mods → 忽略不覆盖已有状态(不可信输入防御)', async () => {
  await withRegistrar({ hubToken: 'ht' }, async ({ registry, port, stop }) => {
    const ws = connect(port, 'ht');
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'register', id: 'm1', url: 'http://h:1', token: 't',
      mods: { cc_version: '2.1.300', mods_count: 1, source: 'x' } }));
    await new Promise((r) => setTimeout(r, 60));
    ws.send(JSON.stringify({ type: 'ping', mods: { cc_version: '2.1.300', mods_count: -5 } })); // 非法计数
    ws.send(JSON.stringify({ type: 'ping', mods: 'garbage' })); // 非对象
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(registry.getById('m1').mods.mods_count, 1, '垃圾载荷不应覆盖合法状态');
    ws.close(); await stop();
  });
});
