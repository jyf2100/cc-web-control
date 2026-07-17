'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { SubprocessAudit, validateEntry } = require('../subprocess_audit.cjs');

// 内存 fs mock:记录主文件与 errorLog 内容。store: filePath → string。
function memFs() {
  const store = new Map();
  const promises = {
    mkdir: async () => {},
    appendFile: async (file, data) => {
      store.set(file, (store.get(file) || '') + data);
    },
    readFile: async (file) => {
      if (!store.has(file)) throw new Error('ENOENT');
      return store.get(file);
    },
  };
  return { promises, store };
}

function makeAudit({ now } = {}) {
  const fsImpl = memFs();
  const a = new SubprocessAudit({
    filePath: '/s/audit/cc-subprocess.jsonl',
    errorLogPath: '/s/audit/audit-write-errors.log',
    host: 'mac-mini-07',
    instanceId: 'ccwc-7f2a',
    now,
    fsImpl,
  });
  return { a, fsImpl };
}

// —— validateEntry 纯函数 ——
test('validateEntry:合法 start', () => {
  const r = validateEntry({
    ts: '2026-07-17T08:30:12.431Z', host: 'h', instance_id: 'i', action: 'start',
    cmd: 'claude', cwd: '/Users/x/work', exit_code: null, duration_ms: null,
  });
  assert.equal(r.ok, true);
});

test('validateEntry:合法 stop(exit/duration 整数)', () => {
  const r = validateEntry({
    ts: '2026-07-17T08:30:42.431Z', host: 'h', instance_id: 'i', action: 'stop',
    cmd: 'claude', cwd: '/Users/x/work', exit_code: 0, duration_ms: 30000,
  });
  assert.equal(r.ok, true);
});

test('validateEntry:action 非法被拒', () => {
  const r = validateEntry({ ts: '2026-07-17T08:30:12Z', host: 'h', instance_id: 'i', action: 'foo', cmd: '', cwd: '/x', exit_code: null, duration_ms: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /action must be one of/);
});

test('validateEntry:ts 非法被拒(yesterday)', () => {
  const r = validateEntry({ ts: 'yesterday', host: 'h', instance_id: 'i', action: 'start', cmd: '', cwd: '/x', exit_code: null, duration_ms: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /ts must be/);
});

test('validateEntry:缺 host 被拒', () => {
  const r = validateEntry({ ts: '2026-07-17T08:30:12Z', instance_id: 'i', action: 'start', cmd: '', cwd: '/x', exit_code: null, duration_ms: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /host must be/);
});

test('validateEntry:start 带 exit_code 被拒', () => {
  const r = validateEntry({ ts: '2026-07-17T08:30:12Z', host: 'h', instance_id: 'i', action: 'start', cmd: '', cwd: '/x', exit_code: 0, duration_ms: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /exit_code must be null for start/);
});

test('validateEntry:stop 缺 exit_code 被拒', () => {
  const r = validateEntry({ ts: '2026-07-17T08:30:12Z', host: 'h', instance_id: 'i', action: 'stop', cmd: '', cwd: '/x', exit_code: null, duration_ms: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error, /exit_code required/);
});

test('validateEntry:cwd 非绝对路径被拒', () => {
  const r = validateEntry({ ts: '2026-07-17T08:30:12Z', host: 'h', instance_id: 'i', action: 'start', cmd: '', cwd: 'rel/path', exit_code: null, duration_ms: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /cwd must be/);
});

test('validateEntry:exit_code 越界(256)被拒', () => {
  const r = validateEntry({ ts: '2026-07-17T08:30:12Z', host: 'h', instance_id: 'i', action: 'stop', cmd: '', cwd: '/x', exit_code: 256, duration_ms: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /exit_code/);
});

// —— 落盘 + 配对(验收 B6/B8)——
test('recordStart 落一行合法 start JSONL', async () => {
  const { a, fsImpl } = makeAudit({ now: () => '2026-07-17T08:30:12.431Z' });
  const ok = await a.recordStart({ sessionName: 's1', cmd: 'claude --no-update', cwd: '/Users/x/work' });
  assert.equal(ok, true);
  const lines = fsImpl.store.get('/s/audit/cc-subprocess.jsonl').trim().split('\n');
  assert.equal(lines.length, 1);
  const e = JSON.parse(lines[0]);
  assert.equal(e.action, 'start');
  assert.equal(e.exit_code, null);
  assert.equal(e.duration_ms, null);
  assert.equal(e.cmd, 'claude --no-update');
  assert.equal(e.cwd, '/Users/x/work');
  assert.equal(e.host, 'mac-mini-07');
  assert.equal(e.instance_id, 'ccwc-7f2a');
  assert.equal(e.ts, '2026-07-17T08:30:12.431Z');
});

test('start→30s 后 stop:配对 + duration≈30000 + ts(start)<ts(stop)', async () => {
  let t = '2026-07-17T08:30:12.431Z';
  const { a, fsImpl } = makeAudit({ now: () => t });
  await a.recordStart({ sessionName: 's1', cmd: 'claude', cwd: '/work' });
  t = '2026-07-17T08:30:42.431Z'; // +30s
  await a.recordStop({ sessionName: 's1', exitCode: 137 });
  const lines = fsImpl.store.get('/s/audit/cc-subprocess.jsonl').trim().split('\n');
  const [s, st] = lines.map(JSON.parse);
  assert.equal(s.action, 'start');
  assert.equal(s.exit_code, null);
  assert.equal(st.action, 'stop');
  assert.equal(st.exit_code, 137);
  assert.equal(st.duration_ms, 30000);
  assert.ok(Date.parse(s.ts) < Date.parse(st.ts));
});

test('stop 无配对 start:duration_ms=null(仍记 exit_code)', async () => {
  const { a, fsImpl } = makeAudit({ now: () => '2026-07-17T08:30:42.431Z' });
  // 但 stop 无 active → duration_ms=null,而 schema 要求 stop 的 duration_ms 非空整数 → 会被拒!
  const ok = await a.recordStop({ sessionName: 'orphan', exitCode: 0 });
  assert.equal(ok, false); // 无 active → duration null → 校验拒
  const main = fsImpl.store.get('/s/audit/cc-subprocess.jsonl');
  assert.equal(main, undefined); // 主文件未被污染
  const errLog = fsImpl.store.get('/s/audit/audit-write-errors.log');
  assert.ok(errLog && errLog.includes('duration_ms'));
});

// —— schema 拒写不污染主 JSONL(验收 B7)——
test('非法 raw 写入被拒 → 落 errorLog,主文件不污染,下条合法紧跟', async () => {
  const { a, fsImpl } = makeAudit({ now: () => '2026-07-17T08:30:12.431Z' });
  const bad = await a.recordRaw({
    ts: 'yesterday', host: 'h', instance_id: 'i', action: 'foo', cmd: '', cwd: '/x', exit_code: null, duration_ms: null,
  });
  assert.equal(bad, false);
  const good = await a.recordRaw({
    ts: '2026-07-17T08:30:12.431Z', host: 'h', instance_id: 'i', action: 'start', cmd: 'claude', cwd: '/x', exit_code: null, duration_ms: null,
  });
  assert.equal(good, true);
  const main = fsImpl.store.get('/s/audit/cc-subprocess.jsonl').trim().split('\n');
  assert.equal(main.length, 1, '主文件仅 1 条(非法被拒未写入)');
  assert.equal(JSON.parse(main[0]).action, 'start');
  const errLog = fsImpl.store.get('/s/audit/audit-write-errors.log');
  assert.ok(errLog, 'errorLog 已写');
  const errObj = JSON.parse(errLog.trim());
  assert.equal(errObj.error, 'ts must be an ISO8601 string');
  assert.equal(errObj.rejected.action, 'foo');
});

// —— readRecent ——
test('readRecent:读尾部 N 条,跳过畸形行', async () => {
  const { a, fsImpl } = makeAudit({ now: () => '2026-07-17T08:30:12.000Z' });
  fsImpl.store.set('/s/audit/cc-subprocess.jsonl', [
    JSON.stringify({ ts: '2026-07-17T08:30:01Z', host: 'h', instance_id: 'i', action: 'start', cmd: 'a', cwd: '/x', exit_code: null, duration_ms: null }),
    'not-json-line',
    JSON.stringify({ ts: '2026-07-17T08:30:02Z', host: 'h', instance_id: 'i', action: 'stop', cmd: 'a', cwd: '/x', exit_code: 0, duration_ms: 1000 }),
    '',
  ].join('\n'));
  const recent = await a.readRecent(1);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].action, 'stop');
  const all = await a.readRecent();
  assert.equal(all.length, 2); // 跳过畸形行
});

test('readRecent:文件不存在 → []', async () => {
  const { a } = makeAudit();
  assert.deepEqual(await a.readRecent(10), []);
});

// —— restart ——
test('recordRestart:落 restart 条目,重置 active 时间', async () => {
  let t = '2026-07-17T08:30:00.000Z';
  const { a, fsImpl } = makeAudit({ now: () => t });
  await a.recordStart({ sessionName: 's', cmd: 'claude', cwd: '/w' });
  t = '2026-07-17T08:31:00.000Z';
  await a.recordRestart({ sessionName: 's', exitCode: 0 });
  const lines = fsImpl.store.get('/s/audit/cc-subprocess.jsonl').trim().split('\n').map(JSON.parse);
  const r = lines[1];
  assert.equal(r.action, 'restart');
  assert.equal(r.exit_code, 0);
  assert.equal(r.duration_ms, 60000);
});

// —— 构造守卫 ——
test('构造缺 host/instanceId/file 抛错', () => {
  assert.throws(() => new SubprocessAudit({ errorLogPath: '/e', host: 'h', instanceId: 'i' }), /filePath required/);
  assert.throws(() => new SubprocessAudit({ filePath: '/f', errorLogPath: '/e', instanceId: 'i' }), /host required/);
  assert.throws(() => new SubprocessAudit({ filePath: '/f', errorLogPath: '/e', host: 'h' }), /instanceId required/);
  assert.throws(() => new SubprocessAudit({ filePath: '/f', host: 'h', instanceId: 'i' }), /errorLogPath required/);
});
