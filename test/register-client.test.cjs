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

// ---- cli_tool 上报(验收 #8:当前 cc-web-control agent 报 claude-code;可显式覆盖)----
test('register 帧默认带 cli_tool="claude-code"(cc-web-control 自身语义)', async () => {
  const hub = await startFakeHub({ onRegister: (ws) => ws.send(JSON.stringify({ type: 'registered' })) });
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 't', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: 'm', machineName: '', publicUrl: '',
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 150));
  const reg = hub.received.find((m) => m.type === 'register');
  assert.equal(reg.cli_tool, 'claude-code');
  rc.close(); await hub.stop();
});

test('register 帧 cliTool 可显式覆盖(如 grok-build);非法值回退 unknown', async () => {
  const hub = await startFakeHub({ onRegister: (ws) => ws.send(JSON.stringify({ type: 'registered' })) });
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 't', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: 'm', machineName: '', publicUrl: '',
    cliTool: 'grok-build',
  });
  rc.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(hub.received.find((m) => m.type === 'register').cli_tool, 'grok-build');
  rc.close(); await hub.stop();

  // 非法值 → unknown(由 normalizeCliTool 兜底)
  const hub2 = await startFakeHub({ onRegister: (ws) => ws.send(JSON.stringify({ type: 'registered' })) });
  const rc2 = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub2.port}`, registerToken: 't', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: 'm2', machineName: '', publicUrl: '',
    cliTool: 'bogus',
  });
  rc2.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(hub2.received.find((m) => m.type === 'register').cli_tool, 'unknown');
  rc2.close(); await hub2.stop();
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

// ---- Finding 2:registered / pong 帧 → _authRejectCount 归零(spec §3.5 成功清零) ----
test('registered / pong 帧 → _authRejectCount 归零(防偶发 1008 累积误触停止阈值)', async () => {
  const hub = await startFakeHub({
    onRegister: (ws) => ws.send(JSON.stringify({ type: 'registered' })),
  });
  // startFakeHub 已内置 ping→pong 响应
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 't', authToken: 'x',
    bindHost: '127.0.0.1', port: 1, machineId: 'm', machineName: '', publicUrl: '',
    pingIntervalMs: 50, // 短 ping 间隔,快速触发一次 pong
  });
  rc._authRejectCount = 2; // 模拟之前累积的 1008 拒绝(未达停止阈值 3)
  rc.start();
  // registered 帧到达 → 归零
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(rc._authRejectCount, 0, '收到 registered 后 _authRejectCount 应归零');
  assert.equal(rc._stopped, false, '未达阈值不应停止');
  // 再次累积,ping→pong 也会归零
  rc._authRejectCount = 1;
  await new Promise((r) => setTimeout(r, 80)); // 等 pingIntervalMs=50 触发一次 ping→pong
  assert.equal(rc._authRejectCount, 0, '收到 pong 后 _authRejectCount 应归零');
  rc.close(); await hub.stop();
});
