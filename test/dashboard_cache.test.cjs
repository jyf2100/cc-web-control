const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { DashboardCache, getDashboardCache, latestJsonlByMtime, buildDashboardPayload } = require('../dashboard_cache.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-cache-'));
}
function rm(d) {
  fs.rmSync(d, { recursive: true, force: true });
}
function nowIso() {
  return new Date().toISOString();
}
function makeSlugDir(base, cwd) {
  const slug = cwd.replace(/[\\/]+/g, '-');
  const dir = path.join(base, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function writeJsonl(dir, name, events) {
  fs.writeFileSync(path.join(dir, name), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
function endTurn(text) {
  return { type: 'assistant', timestamp: nowIso(), message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } };
}
function toolUse(name) {
  return { type: 'assistant', timestamp: nowIso(), message: { role: 'assistant', content: [{ type: 'tool_use', name, input: {} }], stop_reason: 'tool_use' } };
}

test('_compute 命中 end_turn → waiting', () => {
  const base = tmpDir();
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    writeJsonl(slugDir, 'a.jsonl', [endTurn('done')]);
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj' }]);
    cache.refresh();
    const snaps = cache.getSnapshots();
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].name, 's1');
    assert.equal(snaps[0].status, 'waiting');
    assert.equal(snaps[0].lastLine, 'done');
  } finally { rm(base); }
});

test('_compute tool_use → working', () => {
  const base = tmpDir();
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    writeJsonl(slugDir, 'a.jsonl', [toolUse('Bash')]);
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj' }]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].status, 'working');
  } finally { rm(base); }
});

test('cwd 无项目目录 → unknown (M3 降级)', () => {
  const base = tmpDir();
  try {
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/no-such' }]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].status, 'unknown');
  } finally { rm(base); }
});

test('清理不再存在的会话', () => {
  const base = tmpDir();
  try {
    makeSlugDir(base, '/Users/roc/a');
    makeSlugDir(base, '/Users/roc/b');
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 'a', cwd: '/Users/roc/a' }, { name: 'b', cwd: '/Users/roc/b' }]);
    cache.refresh();
    assert.equal(cache.getSnapshots().length, 2);
    cache.setSessions([{ name: 'a', cwd: '/Users/roc/a' }]);
    cache.refresh();
    const names = cache.getSnapshots().map((s) => s.name);
    assert.deepEqual(names.sort(), ['a']);
  } finally { rm(base); }
});

test('getDashboardCache 单例 (M5)', () => {
  const a = getDashboardCache();
  const b = getDashboardCache();
  assert.equal(a, b);
});

test('latestJsonlByMtime 选最新 mtime (M2)', () => {
  const d = tmpDir();
  try {
    const f1 = path.join(d, 'old.jsonl');
    const f2 = path.join(d, 'new.jsonl');
    fs.writeFileSync(f1, '{}\n');
    fs.writeFileSync(f2, '{}\n');
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(f2, later, later);
    assert.equal(latestJsonlByMtime([f1, f2]), f2);
  } finally { rm(d); }
});

test('buildDashboardPayload 合并 session + snapshot,缺失 → unknown', () => {
  const sessions = [
    { name: 'a', cwd: '/p/a', attached: true },
    { name: 'b', cwd: '/p/b', attached: false },
  ];
  const snapshots = [
    { name: 'a', status: 'waiting', lastLine: 'hi', lastTs: 123, cachedAt: 0 },
  ];
  const payload = buildDashboardPayload(sessions, snapshots, true);
  assert.equal(payload.tmuxOk, true);
  assert.equal(payload.sessions.length, 2);
  const a = payload.sessions.find((s) => s.name === 'a');
  assert.equal(a.status, 'waiting');
  assert.equal(a.lastLine, 'hi');
  assert.equal(a.cwd, '/p/a');
  assert.equal(a.attached, true);
  const b = payload.sessions.find((s) => s.name === 'b');
  assert.equal(b.status, 'unknown');
  assert.equal(b.lastLine, '');
});

test('_compute 有 claudeSessionId → 精确定位该 jsonl(不取 mtime 最新)', () => {
  const base = tmpDir();
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    writeJsonl(slugDir, 'target.jsonl', [endTurn('我是 target 的状态')]);
    writeJsonl(slugDir, 'other.jsonl', [toolUse('Bash')]);
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(slugDir, 'other.jsonl'), later, later);
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj', claudeSessionId: 'target' }]);
    cache.refresh();
    const snap = cache.getSnapshots()[0];
    assert.equal(snap.status, 'waiting');
    assert.equal(snap.lastLine, '我是 target 的状态');
  } finally { rm(base); }
});

test('_compute 有 claudeSessionId 但文件不存在 → unknown', () => {
  const base = tmpDir();
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    writeJsonl(slugDir, 'other.jsonl', [toolUse('Bash')]);
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj', claudeSessionId: 'target' }]);
    cache.refresh();
    assert.equal(cache.getSnapshots()[0].status, 'unknown');
  } finally { rm(base); }
});

test('_compute 无 claudeSessionId → 降级 mtime 最新', () => {
  const base = tmpDir();
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    writeJsonl(slugDir, 'old.jsonl', [endTurn('old')]);
    writeJsonl(slugDir, 'new.jsonl', [toolUse('Bash')]);
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(slugDir, 'new.jsonl'), later, later);
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj' }]);
    cache.refresh();
    const snap = cache.getSnapshots()[0];
    assert.equal(snap.status, 'working');
    assert.equal(snap.lastLine, '[tool: Bash]');
  } finally { rm(base); }
});

test('buildDashboardPayload 空 sessions / undefined snapshots 安全', () => {
  const p1 = buildDashboardPayload([], [], false);
  assert.equal(p1.tmuxOk, false);
  assert.deepEqual(p1.sessions, []);
  const p2 = buildDashboardPayload([{ name: 'x', cwd: null }], undefined, true);
  assert.equal(p2.sessions[0].status, 'unknown');
});

// --- 安全校验(评审团 4 号 A):claudeSessionId 从磁盘读出后被拼成路径,realpath 边界防穿越 ---

test('_compute claudeSessionId 穿越(../../x 指向 dir 外真实文件)→ unknown(realpath 边界)', () => {
  const base = tmpDir();
  const siblingDir = path.join(path.dirname(base), 'dash-cache-evil');
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    // 在 dir 外(base 同级)构造一个真实可读的 jsonl,诱使穿越读取
    fs.mkdirSync(siblingDir, { recursive: true });
    writeJsonl(siblingDir, 'leak.jsonl', [endTurn('越界读到的机密')]);
    // dir = <base>/-Users-roc-proj;从 dir 到 siblingDir 需 ../../<evil 名>/leak
    const evilName = path.basename(siblingDir);
    const evilSid = `../../${evilName}/leak`;
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj', claudeSessionId: evilSid }]);
    cache.refresh();
    const snap = cache.getSnapshots()[0];
    assert.equal(snap.status, 'unknown', '穿越的 sid 应被 realpath 边界拦截');
    assert.notEqual(snap.lastLine, '越界读到的机密', '绝不读出 dir 外文件内容');
  } finally {
    rm(base);
    rm(siblingDir);
  }
});

test('_compute claudeSessionId 经符号链接指向 dir 外 → unknown(realpath 边界)', () => {
  const base = tmpDir();
  const siblingDir = path.join(path.dirname(base), 'dash-cache-evil-link');
  try {
    const slugDir = makeSlugDir(base, '/Users/roc/proj');
    fs.mkdirSync(siblingDir, { recursive: true });
    writeJsonl(siblingDir, 'secret.jsonl', [endTurn('符号链接越界')]);
    // 在 dir 内放一个指向 dir 外 secret.jsonl 的符号链接,绑定该名
    fs.symlinkSync(path.join(siblingDir, 'secret.jsonl'), path.join(slugDir, 'hooked.jsonl'));
    const cache = new DashboardCache({ projectsDir: base, intervalMs: 999999 });
    cache.setSessions([{ name: 's1', cwd: '/Users/roc/proj', claudeSessionId: 'hooked' }]);
    cache.refresh();
    const snap = cache.getSnapshots()[0];
    assert.equal(snap.status, 'unknown', '符号链接指向 dir 外应被拦截');
    assert.notEqual(snap.lastLine, '符号链接越界');
  } finally {
    rm(base);
    rm(siblingDir);
  }
});
