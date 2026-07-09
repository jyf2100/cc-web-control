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
