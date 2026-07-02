'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

// 写临时 machines 清单(0600 权限,含 token)
function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-srv-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// 起一个真 hub + N 个已起好的 stub,跑 fn,finally 关停
async function withHub(stubs, token, fn) {
  const machines = stubs.map((s, i) => ({ id: `mc${i + 1}`, name: `M${i + 1}`, url: s.url, token: s.token }));
  const { file, cleanup } = tmpMachinesFile(machines);
  const hub = await startHub({ machinesFile: file, hubToken: token, host: '127.0.0.1', port: 0, intervalMs: 100 });
  try {
    await fn(hub);
  } finally {
    await hub.stop();
    cleanup();
  }
}

test('GET /api/global-dashboard 聚合多机(带 hub token cookie)', async () => {
  const s1 = await new StubMachine({
    token: 't1',
    dashboardPayload: { tmuxOk: true, sessions: [{ name: 'a', cwd: '/a', status: 'working', lastLine: 'x', lastTs: 1, attached: false }] },
  }).start();
  const s2 = await new StubMachine({ token: 't2', dashboardPayload: { tmuxOk: true, sessions: [] } }).start();
  try {
    await withHub([s1, s2], 'hubtok', async (hub) => {
      // 等首轮聚合(intervalMs=100,start() 即刻跑一次,留余量)
      await new Promise((r) => setTimeout(r, 250));
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, {
        headers: { Cookie: 'cc_web_auth=hubtok' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.machines.length, 2);
      const mc1 = body.machines.find((m) => m.id === 'mc1');
      assert.equal(mc1.online, true);
      assert.equal(mc1.sessions[0].machine, 'mc1');
    });
  } finally {
    await s1.stop();
    await s2.stop();
  }
});

test('未授权 → 401', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`);
      assert.equal(res.status, 401);
    });
  } finally {
    await s1.stop();
  }
});

test('WS attach + 双向转发(init/output)', async () => {
  const s1 = await new StubMachine({ token: 't1', onWsMessage: (sess, msg, ws) => {} }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=hubtok`);
      await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); });
      const inbox = [];
      ws.on('message', (b) => inbox.push(JSON.parse(b.toString())));
      ws.send(JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(inbox.some((m) => m.type === 'init' && m.target.machine === 'mc1'), '应收到 init');
      ws.send(JSON.stringify({ type: 'input', target: { machine: 'mc1', session: 's1' }, data: 'ping', enter: true }));
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(s1.received.some((m) => m.type === 'input' && m.data === 'ping'), 'stub 应收到 input');
      ws.close();
    });
  } finally {
    await s1.stop();
  }
});

test('POST /api/sessions 代理到目标机', async () => {
  let created = null;
  const s1 = await new StubMachine({ token: 't1' }).start();
  s1.app.post('/api/sessions', (req, res) => { created = req.body; res.status(201).json({ success: true }); });
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions`, {
        method: 'POST',
        headers: { Cookie: 'cc_web_auth=hubtok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine: 'mc1', name: 'newS', cwd: '/p' }),
      });
      assert.equal(res.status, 201);
      assert.deepEqual(created, { name: 'newS', cwd: '/p' });
    });
  } finally {
    await s1.stop();
  }
});
