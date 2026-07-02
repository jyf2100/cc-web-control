'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { AgentClient } = require('../hub/agent_client.cjs');

async function startStubRemote(initData, { token = 'tok' } = {}) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    if (req.headers.authorization !== `Bearer ${token}`) { ws.close(1008); return; }
    // 模拟远程 server:连上即发 init(data = capturePane 全量)
    ws.send(JSON.stringify({ type: 'init', data: initData }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close: () => new Promise((r) => wss.close(() => server.close(r))),
  };
}

test('readPane: 取 init 帧尾部 N 行', async () => {
  const lines200 = Array.from({ length: 200 }, (_, i) => `line-${i}`).join('\n');
  const stub = await startStubRemote(lines200);
  try {
    const ac = new AgentClient({ id: 'm1', url: stub.url, token: stub.token });
    const r = await ac.readPane('s1', 5);
    assert.equal(r.ok, true);
    assert.equal(r.total, 200);
    assert.deepEqual(r.lines, ['line-195', 'line-196', 'line-197', 'line-198', 'line-199']);
  } finally {
    await stub.close();
  }
});

test('readPane: 远程 error 帧如实报失败', async () => {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'error', data: 'session not found' })));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const ac = new AgentClient({ id: 'm1', url: `http://127.0.0.1:${port}`, token: 'tok' });
  const r = await ac.readPane('s1', 40);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'session not found');
  await new Promise((res) => wss.close(() => server.close(res)));
});
