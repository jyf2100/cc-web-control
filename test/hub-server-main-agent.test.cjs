'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ma-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: [] }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// stub tmux:checkSession→true 跳过首次 spawn;create/kill/hasOwnedSession 可控
function stubTmuxOwned() {
  const calls = [];
  return {
    calls,
    sendKeys: async () => true,
    capturePane: async () => 'PANE',
    checkSession: async () => true, // 假装已存在 → setupMainAgent 跳过 create
    createSession: async (s, c) => { calls.push({ fn: 'create', s }); return true; },
    killSession: async (s) => { calls.push({ fn: 'kill', s }); return true; },
    sendKey: async () => true,
    showEnvironment: async () => 'CC_WEB_OWNED=1',
  };
}
async function withMainAgentHub({ tmux, enabled = true }, fn) {
  const { file, cleanup } = tmpMachinesFile();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-data-'));
  const hub = await startHub({
    machinesFile: file, hubToken: 'T', host: '127.0.0.1', port: 0, intervalMs: 1000,
    mainAgent: { enabled, tmux, session: 'cc-main-agent', dataDir, settleMs: 60000, maxSettleMs: 900000 },
  });
  try {
    await new Promise((r) => setTimeout(r, 80)); // 等 setupMainAgent async 完成
    await fn(hub);
  } finally {
    await hub.stop();
    cleanup();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('M5 getClient:WS attach main-agent → 收 init 帧(LocalTmuxClient 接通)', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=T`);
    await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); });
    const inbox = [];
    ws.on('message', (b) => inbox.push(JSON.parse(b.toString())));
    ws.send(JSON.stringify({ type: 'attach', target: { machine: 'main-agent', session: 'cc-main-agent' } }));
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(inbox.some((m) => m.type === 'init' && m.target.machine === 'main-agent'), '应收到 init');
    ws.close();
  });
});

test('M5 getClient:unknown machine → error 帧', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=T`);
    await new Promise((r) => { ws.on('open', r); });
    const inbox = [];
    ws.on('message', (b) => inbox.push(JSON.parse(b.toString())));
    ws.send(JSON.stringify({ type: 'attach', target: { machine: 'ghost', session: 'x' } }));
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(inbox.some((m) => m.type === 'error' && /unknown machine/.test(m.data)));
    ws.close();
  });
});

async function maFetch(hub, pathname, init = {}) {
  const url = `http://127.0.0.1:${hub.port}${pathname}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Cookie: 'cc_web_auth=T',
      Origin: `http://127.0.0.1:${hub.port}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('M2 status:handles 就绪 + owned → {running:true,enabled:true}', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const { status, body } = await maFetch(hub, '/api/main-agent/status');
    assert.equal(status, 200);
    assert.deepEqual(body, { running: true, enabled: true });
  });
});

test('M2 门控:未启用 main agent → status 200 {running:false,enabled:false};start/stop → 503', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned(), enabled: false }, async (hub) => {
    const st = await maFetch(hub, '/api/main-agent/status');
    assert.equal(st.status, 200);
    assert.deepEqual(st.body, { running: false, enabled: false });
    const start = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(start.status, 503);
    const stop = await maFetch(hub, '/api/main-agent/stop', { method: 'POST', body: '{}' });
    assert.equal(stop.status, 503);
  });
});

test('start:foreign 同名 session(hasOwnedSession=false)→ create 抛错 → catch 不杀 foreign(R2-H2)+ 500', async () => {
  const tmux = stubTmuxOwned();
  tmux.showEnvironment = async () => 'CC_WEB_OWNED=0'; // foreign
  tmux.createSession = async () => { throw new Error('Session "cc-main-agent" already exists'); };
  await withMainAgentHub({ tmux }, async (hub) => {
    const r = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(r.status, 500);
    assert.ok(!tmux.calls.some((c) => c.fn === 'kill'), 'foreign 不被 kill');
  });
});

test('R3-H1 start:hasOwnedSession 抛错(非 not-found)→ 审计 cleanup_probe_failed + 500(不泄露 error)', async () => {
  const tmux = stubTmuxOwned();
  tmux.showEnvironment = async () => { throw new Error('permission denied'); };
  tmux.createSession = async () => { throw new Error('boom'); };
  await withMainAgentHub({ tmux }, async (hub) => {
    const r = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(r.status, 500);
    assert.ok(!JSON.stringify(r.body).includes('permission denied'), '不泄露内部 error');
  });
});

test('M1 限流:连续 7 次 start(6/min)→ 第 7 次 429', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    for (let i = 0; i < 6; i++) await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    const r7 = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(r7.status, 429);
  });
});

test('CSRF:start 缺同源 → 403', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/api/main-agent/start`, {
      method: 'POST',
      headers: { Cookie: 'cc_web_auth=T', Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 403);
  });
});

test('stop:foreign session → {stopped:false,reason:foreign session} 不 kill(M4)', async () => {
  const tmux = stubTmuxOwned();
  tmux.showEnvironment = async () => 'CC_WEB_OWNED=0';
  await withMainAgentHub({ tmux }, async (hub) => {
    const r = await maFetch(hub, '/api/main-agent/stop', { method: 'POST', body: '{}' });
    assert.equal(r.status, 200);
    assert.equal(r.body.stopped, false);
    assert.equal(r.body.reason, 'foreign session');
    assert.ok(!tmux.calls.some((c) => c.fn === 'kill'));
  });
});
