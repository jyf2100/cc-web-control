'use strict';
// 结构化状态机集成单测:DashboardCache 暴露规范 state + changedAt,buildDashboardPayload 透出
// state/changed_at。对应 PRD 验收:#1(枚举完备)、#2(行为触发)、#3(≤刷新周期反映)、#5(来自结构化字段)。
// 关键:状态全程由 jsonl 末尾事件派生,本测试从不启动/读取 tmux —— 直接证明 AC5
// (关闭 tmux 文本流回传,状态字段仍正确)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DashboardCache, buildDashboardPayload } = require('../dashboard_cache.cjs');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-state-')); }
function rm(d) { fs.rmSync(d, { recursive: true, force: true }); }
function iso(ms) { return new Date(ms).toISOString(); }
function makeSlugDir(base, cwd) {
  const dir = path.join(base, cwd.replace(/[\\/]+/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function writeJsonl(dir, name, events) {
  fs.writeFileSync(path.join(dir, name), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
const CWD = '/Users/roc/proj';
function sess(name, sid) { return sid ? { name, cwd: CWD, claudeSessionId: sid } : { name, cwd: CWD }; }

// 构造特定 stop_reason 的 assistant 事件(timestamp 控制 idle 阈值判定)
function assistant(stopReason, content, tsMs) {
  return { type: 'assistant', timestamp: iso(tsMs), message: { role: 'assistant', content, stop_reason: stopReason } };
}
function errEvent(tsMs) {
  return { type: 'assistant', timestamp: iso(tsMs), message: { role: 'assistant', content: [], stop_reason: 'end_turn' }, isApiErrorMessage: true };
}

test('snapshot 含规范 state + changedAt(AC1/AC5,全程无 tmux)', () => {
  const base = tmpDir();
  try {
    const dir = makeSlugDir(base, CWD);
    writeJsonl(dir, 'a.jsonl', [assistant('tool_use', [{ type: 'tool_use', name: 'Bash', input: {} }], Date.now())]);
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999, nowFn: () => 5000 });
    cache.setSessions([sess('s1')]);
    cache.refresh();
    const snap = cache.getSnapshots()[0];
    assert.equal(snap.status, 'working');
    assert.equal(snap.state, 'running');
    assert.equal(snap.changedAt, 5000); // 首次观察 → now
  } finally { rm(base); }
});

test('state 随 jsonl 末尾事件变化(AC2 行为映射:running/awaiting-input/error/idle)', () => {
  const base = tmpDir();
  try {
    const dir = makeSlugDir(base, CWD);
    let now = 10000;
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999, nowFn: () => now });
    cache.setSessions([sess('s1')]);

    writeJsonl(dir, 'a.jsonl', [assistant('tool_use', [{ type: 'tool_use', name: 'Bash', input: {} }], now)]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].state, 'running');

    now = 11000;
    writeJsonl(dir, 'a.jsonl', [assistant('end_turn', [{ type: 'text', text: 'done' }], now)]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].state, 'awaiting-input');

    now = 12000;
    writeJsonl(dir, 'a.jsonl', [errEvent(now)]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].state, 'error');
  } finally { rm(base); }
});

// AC3:状态变化后在一次刷新周期内反映(这里注入时钟,刷新即反映)
test('changedAt:状态变化时刷新,不变时沿用(AC3 时效 + AC5 最近变更时间)', () => {
  const base = tmpDir();
  try {
    const dir = makeSlugDir(base, CWD);
    let now = 1000;
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999, nowFn: () => now });
    cache.setSessions([sess('s1')]);

    writeJsonl(dir, 'a.jsonl', [assistant('tool_use', [{ type: 'tool_use', name: 'Bash', input: {} }], now)]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].changedAt, 1000); // running 首次

    now = 2000; // 状态不变(仍 tool_use working)
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].state, 'running');
    assert.equal(cache.getSnapshots()[0].changedAt, 1000, '状态未变 → changedAt 沿用 1000');

    now = 3000; // 切到 awaiting-input
    writeJsonl(dir, 'a.jsonl', [assistant('end_turn', [{ type: 'text', text: 'ok' }], now)]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].state, 'awaiting-input');
    assert.equal(cache.getSnapshots()[0].changedAt, 3000, '状态变化 → changedAt 刷新为 3000');

    now = 4000; // 再刷新,状态不变
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].changedAt, 3000, '状态未变 → changedAt 仍 3000');
  } finally { rm(base); }
});

test('unknown 会话 → state=idle(AC1:绝不 null/undefined)', () => {
  const base = tmpDir();
  try {
    makeSlugDir(base, CWD); // 空目录,无 jsonl
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999, nowFn: () => 1 });
    cache.setSessions([sess('s1')]);
    cache.refresh();
    const snap = cache.getSnapshots()[0];
    assert.equal(snap.status, 'unknown');
    assert.equal(snap.state, 'idle');
    assert.equal(typeof snap.changedAt, 'number');
  } finally { rm(base); }
});

test('buildDashboardPayload 透出 state + changed_at', () => {
  const sessions = [{ name: 'a', cwd: '/p/a', attached: true }];
  const snapshots = [{ name: 'a', status: 'waiting', state: 'awaiting-input', lastLine: 'hi', lastTs: 123, cachedAt: 999, changedAt: 999 }];
  const p = buildDashboardPayload(sessions, snapshots, true);
  const a = p.sessions[0];
  assert.equal(a.state, 'awaiting-input');
  assert.equal(a.changed_at, 999);
  assert.equal(a.status, 'waiting'); // 原 status 保留(向后兼容)
});

test('buildDashboardPayload snapshot 缺 state/changedAt → 归一为 idle + cachedAt 兜底(AC1)', () => {
  const sessions = [{ name: 'x', cwd: null }];
  // 老 snapshot 形状(无 state/changedAt):status=errored → state 应归一为 error
  const snapshots = [{ name: 'x', status: 'errored', lastLine: '', lastTs: null, cachedAt: 42 }];
  const p = buildDashboardPayload(sessions, snapshots, true);
  assert.equal(p.sessions[0].state, 'error');
  assert.equal(p.sessions[0].changed_at, 42);
});

test('buildDashboardPayload 完全无 snapshot → state=idle, changed_at=0(AC1 绝不 null)', () => {
  const p = buildDashboardPayload([{ name: 'y', cwd: null }], undefined, true);
  assert.equal(p.sessions[0].state, 'idle');
  assert.equal(p.sessions[0].changed_at, 0);
});
