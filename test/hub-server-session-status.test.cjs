'use strict';
// HTTP 集成:hub 结构化状态机端点。对应 PRD 验收 #1/#4/#5(HTTP 层)。
//   GET /api/sessions?status=<enum>        按规范状态过滤(AC4)
//   GET /api/sessions?group_by=status      四态计数(AC4)
//   GET /api/sessions?status=<非法>        400 + allowed(AC4)
//   GET /api/sessions/:machine/:session/status → {node_id,session,status,changed_at}(AC5)
//   GET /api/global-dashboard:session 透传 state/changed_at(AC5 端到端)
// 用 StubMachine 作被控机(直接返回含 state/changed_at 的 payload)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-status-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
async function waitFor(fn, { timeoutMs = 3000, intervalMs = 30 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* 轮询抖动 */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`);
}
const AUTH = { headers: { Cookie: 'cc_web_hub_auth=hubtok' } };

async function withStatusHub(specs, fn) {
  const stubs = [];
  for (const spec of specs) {
    const stub = await new StubMachine({
      token: spec.token,
      dashboardPayload: { tmuxOk: true, sessions: spec.sessions || [] },
    }).start();
    stubs.push(stub);
  }
  const machines = specs.map((s, i) => ({
    id: s.id || `mc${i + 1}`, name: s.name || `M${i + 1}`, url: stubs[i].url, token: stubs[i].token, cli_tool: s.cli_tool || 'claude-code',
  }));
  const { file, cleanup } = tmpMachinesFile(machines);
  const hub = await startHub({ machinesFile: file, hubToken: 'hubtok', host: '127.0.0.1', port: 0, intervalMs: 80 });
  try { await fn(hub); } finally {
    await hub.stop();
    for (const s of stubs) await s.stop();
    cleanup();
  }
}

// stub 会话 payload 直接带规范 state + changed_at(模拟单机 /api/dashboard 已暴露结构化字段)
const SESSIONS = [
  { name: 'run1', status: 'working', state: 'running', changed_at: 100 },
  { name: 'idle1', status: 'idle', state: 'idle', changed_at: 200 },
  { name: 'wait1', status: 'waiting', state: 'awaiting-input', changed_at: 300 },
  { name: 'err1', status: 'errored', state: 'error', changed_at: 400 },
];

test('GET /api/sessions?status=awaiting-input → 仅该状态会话(AC4)', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    const url = `http://127.0.0.1:${hub.port}/api/sessions?status=awaiting-input`;
    await waitFor(async () => { const b = await fetch(url, AUTH).then((r) => r.json()); return b && b.sessions && b.sessions.length === 1; });
    const body = await fetch(url, AUTH).then((r) => r.json());
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].name, 'wait1');
    assert.ok(body.sessions.every((s) => s.state === 'awaiting-input'));
  });
});

test('GET /api/sessions?status=error → 出错会话', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    const url = `http://127.0.0.1:${hub.port}/api/sessions?status=error`;
    await waitFor(async () => { const b = await fetch(url, AUTH).then((r) => r.json()); return b && b.sessions && b.sessions.length === 1; });
    const body = await fetch(url, AUTH).then((r) => r.json());
    assert.equal(body.sessions[0].name, 'err1');
  });
});

test('GET /api/sessions?group_by=status → 四态计数(AC4)', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    const url = `http://127.0.0.1:${hub.port}/api/sessions?group_by=status`;
    await waitFor(async () => { const b = await fetch(url, AUTH).then((r) => r.json()); return b && b.total === 4; });
    const body = await fetch(url, AUTH).then((r) => r.json());
    assert.deepEqual(body.groups, { idle: 1, running: 1, 'awaiting-input': 1, error: 1 });
    assert.equal(body.total, 4);
  });
});

test('GET /api/sessions?status=bogus → 400 + allowed 四态(AC4)', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions?status=bogus`, AUTH);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.deepEqual(body.allowed, ['idle', 'running', 'awaiting-input', 'error']);
    assert.ok(/awaiting-input/.test(body.error));
  });
});

test('GET /api/sessions/:machine/:session/status → 结构化字段(AC5)', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${hub.port}/api/sessions`, AUTH)).json().then((b) => b && b.sessions && b.sessions.length === 4));
    const body = await fetch(`http://127.0.0.1:${hub.port}/api/sessions/mc1/err1/status`, AUTH).then((r) => r.json());
    assert.deepEqual(body, { node_id: 'mc1', session: 'err1', status: 'error', changed_at: 400 });
  });
});

test('GET /api/sessions/:machine/:session/status 未知会话 → 404', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${hub.port}/api/sessions`, AUTH)).json().then((b) => b && b.sessions && b.sessions.length === 4));
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions/mc1/nope/status`, AUTH);
    assert.equal(res.status, 404);
  });
});

test('GET /api/global-dashboard:session 透传 state/changed_at(AC5 端到端)', async () => {
  await withStatusHub([{ id: 'mc1', token: 't1', sessions: SESSIONS }], async (hub) => {
    await waitFor(async () => {
      const b = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, AUTH).then((r) => r.json());
      return b && b.machines && b.machines[0] && (b.machines[0].sessions || []).length === 4;
    });
    const body = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, AUTH).then((r) => r.json());
    const run1 = body.machines[0].sessions.find((s) => s.name === 'run1');
    assert.equal(run1.state, 'running');
    assert.equal(run1.changed_at, 100);
  });
});
