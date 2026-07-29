'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ch-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

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

async function doctorFetch(hub, machine, init = {}) {
  return fetch(`http://127.0.0.1:${hub.port}/api/config-health/${machine}/doctor`, {
    method: 'POST',
    headers: {
      Cookie: 'cc_web_hub_auth=T',
      Origin: `http://127.0.0.1:${hub.port}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

test('POST /api/config-health/:machine/doctor → 经现有 WS 通道送达 /doctor+Enter(AC4)', async () => {
  const s1 = await new StubMachine({
    token: 't1',
    dashboardPayload: { tmuxOk: true, sessions: [{ name: 'work', cwd: '/p', status: 'waiting', lastLine: '', lastTs: 1, attached: false }] },
  }).start();
  try {
    await withHub([s1], 'T', async (hub) => {
      await new Promise((r) => setTimeout(r, 250)); // 等聚合,使 aggregator.getLatest() 有 mc1 的 work 会话
      const res = await doctorFetch(hub, 'mc1');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.session, 'work');
      await new Promise((r) => setTimeout(r, 150)); // 等 sendOneShot 投递
      const doctor = s1.received.filter((m) => m.type === 'input' && m.data === '/doctor');
      assert.equal(doctor.length, 1, '应恰好收到一条 /doctor input');
      assert.equal(doctor[0].enter, true, '应带 enter:true(回车提交)');
      assert.equal(doctor[0].session, 'work');
    });
  } finally {
    await s1.stop();
  }
});

test('exactly-once:1 秒内连点多次 → 目标会话只收到一条 /doctor(AC7)', async () => {
  const s1 = await new StubMachine({
    token: 't1',
    dashboardPayload: { tmuxOk: true, sessions: [{ name: 'work', cwd: '/p', status: 'waiting', lastLine: '', lastTs: 1, attached: false }] },
  }).start();
  try {
    await withHub([s1], 'T', async (hub) => {
      await new Promise((r) => setTimeout(r, 250));
      const r1 = await doctorFetch(hub, 'mc1');
      const r2 = await doctorFetch(hub, 'mc1');
      const r3 = await doctorFetch(hub, 'mc1');
      assert.equal(r1.status, 200);
      const b2 = await r2.json();
      assert.equal(b2.deduped, true, '第二次应被去重');
      const b3 = await r3.json();
      assert.equal(b3.deduped, true, '第三次应被去重');
      await new Promise((r) => setTimeout(r, 150));
      const doctor = s1.received.filter((m) => m.type === 'input' && m.data === '/doctor');
      assert.equal(doctor.length, 1, '目标会话只收到一条 /doctor');
    });
  } finally {
    await s1.stop();
  }
});

test('未知 machine → 404', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'T', async (hub) => {
      const res = await doctorFetch(hub, 'nope');
      assert.equal(res.status, 404);
    });
  } finally {
    await s1.stop();
  }
});

test('机器无会话 → 409 no_session', async () => {
  const s1 = await new StubMachine({ token: 't1', dashboardPayload: { tmuxOk: true, sessions: [] } }).start();
  try {
    await withHub([s1], 'T', async (hub) => {
      await new Promise((r) => setTimeout(r, 250));
      const res = await doctorFetch(hub, 'mc1');
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.code, 'no_session');
    });
  } finally {
    await s1.stop();
  }
});

test('跨域 POST → 403(CSRF 防护)', async () => {
  const s1 = await new StubMachine({
    token: 't1',
    dashboardPayload: { tmuxOk: true, sessions: [{ name: 'work', cwd: '/p', status: 'waiting', lastLine: '', lastTs: 1, attached: false }] },
  }).start();
  try {
    await withHub([s1], 'T', async (hub) => {
      await new Promise((r) => setTimeout(r, 250));
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/config-health/mc1/doctor`, {
        method: 'POST',
        headers: { Cookie: 'cc_web_hub_auth=T', Origin: 'http://evil.example' },
      });
      assert.equal(res.status, 403);
    });
  } finally {
    await s1.stop();
  }
});

test('未授权 → 401', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  try {
    await withHub([s1], 'T', async (hub) => {
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/config-health/mc1/doctor`, { method: 'POST' });
      assert.equal(res.status, 401);
    });
  } finally {
    await s1.stop();
  }
});
