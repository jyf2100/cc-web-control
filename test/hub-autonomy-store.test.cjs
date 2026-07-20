const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { AutonomyStore, aggregateEvents, TYPES, RETAIN_MS, isValidEvent } = require('../hub/autonomy_store.cjs');

const NOW = 1_700_000_000_000; // 固定「现在」,避免真墙钟漂移

// —— isValidEvent ——

test('isValidEvent 校验', () => {
  assert.equal(isValidEvent({ machine: 'm1', type: 'commit', ts: 1 }), true);
  assert.equal(isValidEvent({ machine: 'm1', type: 'rollback', ts: 1 }), true);
  assert.equal(isValidEvent({ machine: 'm1', type: 'intervention', ts: 1 }), true);
  assert.equal(isValidEvent({ machine: 'm1', type: 'bogus', ts: 1 }), false);
  assert.equal(isValidEvent({ machine: '', type: 'commit', ts: 1 }), false);
  assert.equal(isValidEvent({ machine: 'm1', type: 'commit', ts: 'x' }), false);
  assert.equal(isValidEvent(null), false);
});

// —— aggregateEvents(纯) ——

test('aggregateEvents: 窗口内按机分类型计数', () => {
  const events = [
    { machine: 'm1', type: 'commit', ts: NOW - 1000 },
    { machine: 'm1', type: 'commit', ts: NOW - 500 },
    { machine: 'm1', type: 'rollback', ts: NOW - 400 },
    { machine: 'm2', type: 'intervention', ts: NOW - 300 },
  ];
  const r = aggregateEvents(events, 3600_000, NOW, [
    { id: 'm1', name: 'A', online: true },
    { id: 'm2', name: 'B', online: true },
  ]);
  assert.equal(r.window, 3600_000);
  assert.equal(r.generatedAt, NOW);
  const m1 = r.machines.find((x) => x.id === 'm1');
  assert.equal(m1.commit, 2);
  assert.equal(m1.rollback, 1);
  assert.equal(m1.intervention, 0);
  assert.equal(m1.stale, false);
  assert.equal(m1.asOfTs, NOW - 400);
  const m2 = r.machines.find((x) => x.id === 'm2');
  assert.equal(m2.intervention, 1);
});

test('aggregateEvents: 窗口外事件不计入计数', () => {
  const DAY = 86400_000;
  const events = [
    { machine: 'm1', type: 'commit', ts: NOW - 2 * DAY }, // 24h 窗口外
    { machine: 'm1', type: 'commit', ts: NOW - 100 },     // 窗口内
  ];
  const r = aggregateEvents(events, DAY, NOW, [{ id: 'm1', name: 'A', online: true }]);
  assert.equal(r.machines[0].commit, 1);
  assert.equal(r.machines[0].asOfTs, NOW - 100);
});

test('aggregateEvents: 离线机 stale=true(展示最后已知值)', () => {
  const events = [
    { machine: 'm1', type: 'commit', ts: NOW - 100 },
  ];
  const r = aggregateEvents(events, 3600_000, NOW, [{ id: 'm1', name: 'A', online: false }]);
  assert.equal(r.machines[0].commit, 1); // 最后已知值仍展示
  assert.equal(r.machines[0].stale, true);
  assert.equal(r.machines[0].online, false);
});

test('aggregateEvents: 0 事件机也出现(0 计数,便于前端稳定渲染)', () => {
  const r = aggregateEvents([], 3600_000, NOW, [{ id: 'm1', name: 'A', online: true }]);
  assert.equal(r.machines.length, 1);
  assert.equal(r.machines[0].commit, 0);
  assert.equal(r.machines[0].asOfTs, null);
});

test('aggregateEvents: 0 台机器 → machines:[]', () => {
  const r = aggregateEvents([{ machine: 'm1', type: 'commit', ts: NOW }], 3600_000, NOW, []);
  assert.deepEqual(r.machines, []);
});

test('aggregateEvents: 非法事件被忽略', () => {
  const r = aggregateEvents([
    { machine: 'm1', type: 'commit', ts: NOW },
    { machine: 'm1', type: 'bad', ts: NOW },
    null,
  ], 3600_000, NOW, [{ id: 'm1', name: 'A', online: true }]);
  assert.equal(r.machines[0].commit, 1);
});

// —— AutonomyStore(DI fs:内存 fake) ——

function memFs() {
  const files = new Map();
  return {
    _files: files,
    readFileSync(p) { return files.has(p) ? files.get(p) : (() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; })(); },
    writeFileSync(p, c) { files.set(p, c); },
    appendFileSync(p, c) { files.set(p, (files.get(p) || '') + c); },
  };
}

test('AutonomyStore.record → 内存 + append 落盘', () => {
  const fsImpl = memFs();
  const f = '/tmp/autonomy-test.jsonl';
  const s = new AutonomyStore({ filePath: f, fsImpl, now: () => NOW });
  s.record({ machine: 'm1', type: 'commit', ts: NOW - 10 });
  s.record({ machine: 'm1', type: 'rollback', ts: NOW - 5 });
  assert.equal(s.events().length, 2);
  const lines = fsImpl.readFileSync(f).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).type, 'commit');
});

test('AutonomyStore.recordMany: 批量一次 append', () => {
  const fsImpl = memFs();
  const f = '/tmp/autonomy-test2.jsonl';
  const s = new AutonomyStore({ filePath: f, fsImpl, now: () => NOW });
  s.recordMany([
    { machine: 'm1', type: 'commit', ts: NOW - 1 },
    { machine: 'm2', type: 'intervention', ts: NOW - 2 },
    { machine: 'm1', type: 'bad', ts: NOW }, // 过滤
  ]);
  assert.equal(s.events().length, 2);
  assert.equal(fsImpl.readFileSync(f).trim().split('\n').length, 2);
});

test('AutonomyStore 启动 load:读盘 + 丢弃 7d 外历史', () => {
  const fsImpl = memFs();
  const f = '/tmp/autonomy-load.jsonl';
  const recent = NOW - 1000;
  const ancient = NOW - RETAIN_MS - 1000; // 超出 7d
  fsImpl.writeFileSync(f, [
    JSON.stringify({ machine: 'm1', type: 'commit', ts: recent }),
    JSON.stringify({ machine: 'm1', type: 'commit', ts: ancient }),
    '{bad json',
    '',
  ].join('\n') + '\n');
  const s = new AutonomyStore({ filePath: f, fsImpl, now: () => NOW });
  assert.equal(s.events().length, 1); // 仅 recent 留下
  assert.equal(s.events()[0].ts, recent);
});

test('AutonomyStore load 文件不存在 → 穛起步不抛', () => {
  const fsImpl = memFs();
  const s = new AutonomyStore({ filePath: '/no/such.jsonl', fsImpl, now: () => NOW });
  assert.equal(s.events().length, 0);
});

test('AutonomyStore.compact: 裁掉过期事件 + 整表重写文件', () => {
  const fsImpl = memFs();
  const f = '/tmp/autonomy-compact.jsonl';
  const recent = NOW - 1000;
  const ancient = NOW - RETAIN_MS - 5000;
  const s = new AutonomyStore({ filePath: f, fsImpl, now: () => NOW });
  s.record({ machine: 'm1', type: 'commit', ts: recent });
  s.record({ machine: 'm1', type: 'commit', ts: ancient });
  const dropped = s.compact(NOW);
  assert.equal(dropped, 1);
  assert.equal(s.events().length, 1);
  // 文件被整表重写:只剩 recent 一行
  const lines = fsImpl.readFileSync(f).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).ts, recent);
});

test('AutonomyStore.aggregate = aggregateEvents(events,...) 一致', () => {
  const s = new AutonomyStore({ fsImpl: null, now: () => NOW });
  s.record({ machine: 'm1', type: 'commit', ts: NOW - 10 });
  const a1 = s.aggregate(3600_000, NOW, [{ id: 'm1', name: 'A', online: true }]);
  const a2 = aggregateEvents(s.events(), 3600_000, NOW, [{ id: 'm1', name: 'A', online: true }]);
  assert.deepEqual(a1, a2);
});

test('AutonomyStore round-trip:record → 新实例 load → 事件可恢复', () => {
  const fsImpl = memFs();
  const f = '/tmp/autonomy-rt.jsonl';
  const s1 = new AutonomyStore({ filePath: f, fsImpl, now: () => NOW });
  s1.record({ machine: 'm1', type: 'commit', ts: NOW - 10 });
  s1.record({ machine: 'm1', type: 'intervention', ts: NOW - 5 });
  // 模拟重启:同一文件、同一 fs → 新实例从盘 load 回来
  const s2 = new AutonomyStore({ filePath: f, fsImpl, now: () => NOW });
  assert.equal(s2.events().length, 2);
  assert.deepEqual(
    s2.aggregate(3600_000, NOW, [{ id: 'm1', name: 'A', online: true }]).machines[0],
    { id: 'm1', name: 'A', online: true, commit: 1, rollback: 0, intervention: 1, stale: false, asOfTs: NOW - 5 }
  );
});

// —— 真实 fs 冒烟(确保 DI 默认路径接 node:fs 正确) ——
test('AutonomyStore 真实 fs 冒烟:tmp 文件 round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-real-'));
  try {
    const f = path.join(dir, 'a.jsonl');
    const s1 = new AutonomyStore({ filePath: f, now: () => NOW }); // 默认 fsImpl = null → 不落盘
    // 显式用 node:fs 构造一个落盘实例
    const s2 = new AutonomyStore({ filePath: f, fsImpl: fs, now: () => NOW });
    s2.record({ machine: 'm1', type: 'commit', ts: NOW - 1 });
    const s3 = new AutonomyStore({ filePath: f, fsImpl: fs, now: () => NOW });
    assert.equal(s3.events().length, 1);
    assert.equal(s1.events().length, 0); // 不同实例、内存独立
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 关 TYPES 导出供聚合层枚举
test('TYPES 含三项指标', () => {
  assert.deepEqual(TYPES.sort(), ['commit', 'intervention', 'rollback']);
});
