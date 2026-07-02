'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startHub } = require('../hub/server.cjs');

async function tmpMachines() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-mcp-'));
  const file = path.join(dir, 'machines.json');
  await fs.writeFile(file, '[]', { mode: 0o600 });
  return file;
}

let base;
beforeEach(async () => {
  base = { machinesFile: await tmpMachines(), hubToken: 't', host: '127.0.0.1', port: 0, intervalMs: 1000 };
});
afterEach(async () => { if (base && base._hub) await base._hub.close(); });

async function hubGet(hub, pathname) {
  const r = await fetch(`${hub.url}${pathname}`, { headers: { Authorization: `Bearer ${base.hubToken}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('list_sessions: 返回聚合快照', async () => {
  const hub = await startHub(base); base._hub = hub;
  const { status, body } = await hubGet(hub, '/api/mcp/list_sessions');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.machines));
});

test('read_session: 未知 machine → 404', async () => {
  const hub = await startHub(base); base._hub = hub;
  const { status } = await hubGet(hub, '/api/mcp/read_session?machine=unknown&session=s1');
  assert.equal(status, 404);
});

test('read_session: 缺 machine/session → 400', async () => {
  const hub = await startHub(base); base._hub = hub;
  const { status } = await hubGet(hub, '/api/mcp/read_session?lines=40');
  assert.equal(status, 400);
});

test('list_sessions: 未授权 → 401', async () => {
  const hub = await startHub(base); base._hub = hub;
  const r = await fetch(`${hub.url}/api/mcp/list_sessions`);
  assert.equal(r.status, 401);
});

test('dequeue_event: 未启用主 agent → 503', async () => {
  const hub = await startHub(base); base._hub = hub;
  const r = await fetch(`${hub.url}/api/mcp/dequeue_event`, { method: 'POST', headers: { Authorization: `Bearer ${base.hubToken}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 503);
});

test('ack_event: 缺 runId → 400', async () => {
  const hub = await startHub(base); base._hub = hub;
  const r = await fetch(`${hub.url}/api/mcp/ack_event`, { method: 'POST', headers: { Authorization: `Bearer ${base.hubToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: 'x' }) });
  assert.equal(r.status, 400);
});
