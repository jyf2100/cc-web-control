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

test('WS 鉴权失败(?token=错)→ 连接被关闭', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=wrong`);
      const closed = await new Promise((r) => {
        ws.on('close', () => r(true));
        ws.on('error', () => {}); // 防 unhandled
        setTimeout(() => r(false), 500);
      });
      assert.equal(closed, true);
    });
  } finally {
    await s1.stop();
  }
});

test('单机离线降级:该机 online:false,其余机正常', async () => {
  const s1 = await new StubMachine({
    token: 't1',
    dashboardPayload: { tmuxOk: true, sessions: [{ name: 'a', cwd: '/a', status: 'idle', lastLine: '', lastTs: 1, attached: false }] },
  }).start();
  const s2 = await new StubMachine({ token: 't2', dashboardPayload: { tmuxOk: true, sessions: [] } }).start();
  try {
    await withHub([s1, s2], 'hubtok', async (hub) => {
      await new Promise((r) => setTimeout(r, 250));
      // 停掉 s1 模拟离线
      await s1.stop();
      await new Promise((r) => setTimeout(r, 350)); // 等下一轮轮询(intervalMs:100)
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, {
        headers: { Cookie: 'cc_web_auth=hubtok' },
      });
      const body = await res.json();
      assert.equal(body.machines.length, 2); // 整体不崩,s1 仍在列表
      const mc1 = body.machines.find((m) => m.id === 'mc1');
      const mc2 = body.machines.find((m) => m.id === 'mc2');
      assert.equal(mc1.online, false); // s1 离线
      assert.equal(mc2.online, true); // s2 不受影响
    });
  } finally {
    // ⚠️ 只 stop s2(s1 已在测试内停,重复 stop 会报 ERR_SERVER_NOT_RUNNING)
    await s2.stop();
  }
});

test('DELETE /api/sessions/:machine/:name 代理到目标机', async () => {
  let deleted = null;
  const s1 = await new StubMachine({ token: 't1' }).start();
  s1.app.delete('/api/sessions/:name', (req, res) => { deleted = req.params.name; res.status(200).json({ success: true }); });
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions/mc1/theSess`, {
        method: 'DELETE',
        headers: { Cookie: 'cc_web_auth=hubtok' },
      });
      assert.equal(res.status, 200);
      assert.equal(deleted, 'theSess');
    });
  } finally {
    await s1.stop();
  }
});

// ===== 登录链(T8 回填:hub 复用根 login.html + cookie)=====

test('GET /login 返回登录表单(含 <form)', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/login`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /<form/i, 'login 页应含 form 表单');
    });
  } finally {
    await s1.stop();
  }
});

test('POST /login 正确 token → 302 + 设置 httpOnly cookie', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const origin = `http://127.0.0.1:${hub.port}`;
      const res = await fetch(`http://127.0.0.1:${hub.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: origin,
        },
        body: 'token=hubtok&next=/',
      });
      assert.equal(res.status, 302);
      const setCookie = res.headers.get('set-cookie') || '';
      assert.match(setCookie, /cc_web_auth=hubtok/, '应设置 cc_web_auth cookie');
      assert.match(setCookie, /HttpOnly/i, 'cookie 必须 httpOnly');
    });
  } finally {
    await s1.stop();
  }
});

test('POST /login 错误 token → 401', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const origin = `http://127.0.0.1:${hub.port}`;
      const res = await fetch(`http://127.0.0.1:${hub.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: origin,
        },
        body: 'token=wrong&next=/',
      });
      assert.equal(res.status, 401);
    });
  } finally {
    await s1.stop();
  }
});

test('POST /login 缺 token → 400', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const origin = `http://127.0.0.1:${hub.port}`;
      const res = await fetch(`http://127.0.0.1:${hub.port}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: origin,
        },
        body: 'next=/',
      });
      assert.equal(res.status, 400);
    });
  } finally {
    await s1.stop();
  }
});

test('未授权 GET / → 302 重定向到 /login?next=', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      const loc = res.headers.get('location') || '';
      assert.match(loc, /\/login\?next=/, '应重定向到 /login?next=');
    });
  } finally {
    await s1.stop();
  }
});

test('已授权 GET / → 302 重定向到 /console.html(避免落入单机 index.html)', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/`, {
        redirect: 'manual',
        headers: { Cookie: 'cc_web_auth=hubtok' },
      });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/console.html');
    });
  } finally {
    await s1.stop();
  }
});

test('GET /healthz 公开健康检查(无需 cookie)', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/healthz`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { ok: true });
    });
  } finally {
    await s1.stop();
  }
});
