'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeAudit, AuditAggregator } = require('../hub/audit_aggregator.cjs');

// input: 各机抓取结果 { machine:{id,name}, online, entries? }

const E = (ts, action, machine) => ({
  ts, host: machine, instance_id: machine, action,
  cmd: 'claude', cwd: '/work', exit_code: null, duration_ms: null,
});

test('mergeAudit:多机 entries 合并 + 带 machine 标签', () => {
  const merged = mergeAudit([
    { machine: { id: 'mc1', name: 'A' }, online: true, entries: [E('2026-07-17T08:30:01Z', 'start', 'mc1')] },
    { machine: { id: 'mc2', name: 'B' }, online: true, entries: [E('2026-07-17T08:30:02Z', 'start', 'mc2')] },
  ]);
  assert.equal(merged.entries.length, 2);
  assert.ok(merged.entries.every((e) => typeof e.machine === 'string'));
});

test('mergeAudit:按 ts 倒序(顶行最新)', () => {
  const merged = mergeAudit([
    { machine: { id: 'mc1', name: 'A' }, online: true, entries: [E('2026-07-17T08:30:01Z', 'start', 'mc1')] },
    { machine: { id: 'mc2', name: 'B' }, online: true, entries: [E('2026-07-17T09:00:00Z', 'start', 'mc2')] },
  ]);
  assert.equal(merged.entries[0].ts, '2026-07-17T09:00:00Z');
  assert.equal(merged.entries[1].ts, '2026-07-17T08:30:01Z');
});

test('mergeAudit:离线机 / 缺 entries → 不贡献行', () => {
  const merged = mergeAudit([
    { machine: { id: 'mc1', name: 'A' }, online: false },
    { machine: { id: 'mc2', name: 'B' }, online: true, entries: [] },
  ]);
  assert.equal(merged.entries.length, 0);
});

test('mergeAudit:limit 截断', () => {
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push(E(`2026-07-17T08:30:0${i}Z`, 'start', 'mc1'));
  const merged = mergeAudit([{ machine: { id: 'mc1', name: 'A' }, online: true, entries }], { limit: 2 });
  assert.equal(merged.entries.length, 2);
});

test('mergeAudit:空输入 → { entries: [] }', () => {
  assert.deepEqual(mergeAudit([]), { entries: [] });
});

test('mergeAudit:跳过畸形 entry(非对象)', () => {
  const merged = mergeAudit([
    { machine: { id: 'mc1', name: 'A' }, online: true, entries: [null, 'x', E('2026-07-17T08:30:01Z', 'start', 'mc1')] },
  ]);
  assert.equal(merged.entries.length, 1);
});

// —— AuditAggregator 类(DI fetchOne + fake registry) ——
function fakeRegistry(machines) {
  const state = new Map(machines.map((m) => [m.id, { ...m, online: false, lastError: null }]));
  return {
    all() { return Array.from(state.values()).map(({ token, ...rest }) => rest); },
    getSecret(id) { const m = state.get(id); return m ? { id: m.id, name: m.name, url: m.url, token: m.token } : undefined; },
  };
}

test('AuditAggregator _tick:fetchOne(secret, limit) 收到 token 与 limit,合并到 getLatest', async () => {
  const seen = [];
  const reg = fakeRegistry([{ id: 'mc1', name: 'A', url: 'http://1', token: 't1' }]);
  const agg = new AuditAggregator({
    registry: reg,
    intervalMs: 999999,
    limit: 50,
    fetchOne: async (secret, limit) => {
      seen.push({ id: secret.id, token: secret.token, limit });
      return { ok: true, entries: [E('2026-07-17T08:30:01Z', 'start', 'mc1')] };
    },
  });
  await agg._tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].token, 't1');
  assert.equal(seen[0].limit, 50);
  assert.equal(agg.getLatest().entries.length, 1);
  assert.equal(agg.getLatest().entries[0].machine, 'mc1');
});

test('AuditAggregator:fetchOne 失败/抛错 → 该机不贡献行,不影响其它机', async () => {
  const reg = fakeRegistry([
    { id: 'mc1', name: 'A', url: 'http://1', token: 't1' },
    { id: 'mc2', name: 'B', url: 'http://2', token: 't2' },
  ]);
  const agg = new AuditAggregator({
    registry: reg,
    intervalMs: 999999,
    fetchOne: async (secret) => {
      if (secret.id === 'mc1') throw new Error('boom');
      return { ok: true, entries: [E('2026-07-17T08:30:02Z', 'start', 'mc2')] };
    },
  });
  await agg._tick();
  const latest = agg.getLatest();
  assert.equal(latest.entries.length, 1);
  assert.equal(latest.entries[0].machine, 'mc2');
});

test('AuditAggregator:start/stop 不重复/不抛', async () => {
  const reg = fakeRegistry([]);
  const agg = new AuditAggregator({ registry: reg, intervalMs: 10, fetchOne: async () => ({ ok: true, entries: [] }) });
  agg.start();
  agg.start(); // 幂等
  agg.stop();
  agg.stop(); // 幂等
  assert.equal(agg.getLatest().entries.length, 0);
});
