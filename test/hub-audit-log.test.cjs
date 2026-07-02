'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { AuditLog } = require('../hub/audit_log.cjs');

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-'));
  return path.join(dir, 'audit.jsonl');
}

test('append 一行一条 JSON,runId 贯穿', async () => {
  const f = await tmpFile();
  const log = new AuditLog({ filePath: f, now: () => '2026-07-02T00:00:00.000Z' });
  await log.log({ scope: 'dispatcher', runId: 'run-1', event: 'enqueue', detail: { a: 1 } });
  await log.log({ scope: 'mcp', runId: 'run-1', event: 'ack', detail: null });
  const raw = await fs.readFile(f, 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 2);
  const [e1, e2] = lines.map(JSON.parse);
  assert.equal(e1.runId, 'run-1');
  assert.equal(e1.scope, 'dispatcher');
  assert.equal(e1.event, 'enqueue');
  assert.deepEqual(e1.detail, { a: 1 });
  assert.equal(e1.ts, '2026-07-02T00:00:00.000Z');
  assert.equal(e2.runId, 'run-1');
  assert.equal(e2.detail, null);
});

test('append-only:多次写不覆盖历史', async () => {
  const f = await tmpFile();
  const log = new AuditLog({ filePath: f, now: () => 't' });
  await log.log({ scope: 's', runId: 'r', event: 'e1' });
  await log.log({ scope: 's', runId: 'r', event: 'e2' });
  await log.log({ scope: 's', runId: 'r', event: 'e3' });
  const lines = (await fs.readFile(f, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[2]).event, 'e3');
});

test('缺 filePath 抛错', () => {
  assert.throws(() => new AuditLog({}), /filePath required/);
});
