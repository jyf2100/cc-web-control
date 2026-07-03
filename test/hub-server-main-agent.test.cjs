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
