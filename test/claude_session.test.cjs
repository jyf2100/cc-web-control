const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { cwdToSlug } = require('../dashboard_slug.cjs');
const { shouldContinue, pickLatestSessionUuid, pickResumableSessionUuid } = require('../claude_session.cjs');
const { writeBinding } = require('../dashboard_binding.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-session-'));
}
function rm(d) {
  fs.rmSync(d, { recursive: true, force: true });
}

test('shouldContinue: slug 目录下 >=1 jsonl → true', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/sample-proj';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'abc-123.jsonl'), '{}\n');
    assert.equal(shouldContinue(cwd, base), true);
  } finally {
    rm(base);
  }
});

test('shouldContinue: cwd 对应目录不存在 → false', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/never-launched';
    assert.equal(shouldContinue(cwd, base), false);
  } finally {
    rm(base);
  }
});

test('shouldContinue: 目录存在但 0 jsonl → false(关键边界)', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/empty-proj';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.mkdirSync(path.join(slugDir, 'subagents'), { recursive: true });
    assert.equal(shouldContinue(cwd, base), false);
  } finally {
    rm(base);
  }
});

test('shouldContinue: baseDir 缺省时不抛,返回 boolean', () => {
  const result = shouldContinue('/Users/roc/workspace/cc-web-control');
  assert.equal(typeof result, 'boolean');
});

// --- pickLatestSessionUuid:续接路径取「最近会话 uuid」(供 --resume <uuid> 事前绑定) ---

test('pickLatestSessionUuid: 多 jsonl → mtime 最大者的 uuid(basename 去 .jsonl)', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/pick-proj';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'old-uuid.jsonl'), '{}\n');
    fs.writeFileSync(path.join(slugDir, 'new-uuid.jsonl'), '{}\n');
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(slugDir, 'new-uuid.jsonl'), later, later);
    assert.equal(pickLatestSessionUuid(cwd, base), 'new-uuid');
  } finally { rm(base); }
});

test('pickLatestSessionUuid: cwd 目录不存在 → null', () => {
  const base = tmpDir();
  try {
    assert.equal(pickLatestSessionUuid('/Users/roc/workspace/never', base), null);
  } finally { rm(base); }
});

test('pickLatestSessionUuid: 目录存在但 0 jsonl → null', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/empty-pick';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.mkdirSync(path.join(slugDir, 'subagents'), { recursive: true });
    assert.equal(pickLatestSessionUuid(cwd, base), null);
  } finally { rm(base); }
});

test('pickLatestSessionUuid: baseDir 缺省时不抛,返回 string|null', () => {
  const result = pickLatestSessionUuid('/Users/roc/workspace/cc-web-control');
  assert.ok(result === null || typeof result === 'string');
});

// --- pickResumableSessionUuid(评审团 HIGH #1):续接取 uuid 时跳过被其它活跃 session 占用的,防串扰 ---
// 续接串扰根因:shouldContinue 见有 jsonl 即 true,pickLatestSessionUuid 盲取 mtime 最新(必是活跃 session 的)
// → 新开 session B 会 --resume 进活跃 session A 的 jsonl,双写 + 塌缩。修复:跳过被占用 uuid。

test('pickResumableSessionUuid: 跳过被其它活跃 session 占用的 uuid,取次新', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/collide-proj';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'uuidA.jsonl'), '{}\n');
    fs.writeFileSync(path.join(slugDir, 'uuidB.jsonl'), '{}\n');
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(slugDir, 'uuidA.jsonl'), later, later); // uuidA mtime 最新(活跃 session A)
    writeBinding(cwdToSlug(cwd), 'sess-a', 'uuidA', base); // sess-a 已占用 uuidA
    assert.equal(pickResumableSessionUuid(cwd, 'sess-b', base), 'uuidB');
  } finally { rm(base); }
});

test('pickResumableSessionUuid: excludeTmuxName 自己的占用不计入 → 可续接自己的历史', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/self-resume';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'uuidA.jsonl'), '{}\n');
    writeBinding(cwdToSlug(cwd), 'sess-a', 'uuidA', base); // sess-a 旧绑定 uuidA
    assert.equal(pickResumableSessionUuid(cwd, 'sess-a', base), 'uuidA'); // 重启续接自己
  } finally { rm(base); }
});

test('pickResumableSessionUuid: 全部 uuid 被其它 session 占用 → null(调用方降级新建)', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/all-occupied';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'uuidA.jsonl'), '{}\n');
    writeBinding(cwdToSlug(cwd), 'sess-a', 'uuidA', base);
    assert.equal(pickResumableSessionUuid(cwd, 'sess-b', base), null);
  } finally { rm(base); }
});

test('pickResumableSessionUuid: 无绑定 → 等同 mtime 最新(向后兼容)', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/no-bindings';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'old.jsonl'), '{}\n');
    fs.writeFileSync(path.join(slugDir, 'new.jsonl'), '{}\n');
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(slugDir, 'new.jsonl'), later, later);
    assert.equal(pickResumableSessionUuid(cwd, 'sess-x', base), 'new');
  } finally { rm(base); }
});

test('pickResumableSessionUuid: 无 jsonl → null', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/empty-resume';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    assert.equal(pickResumableSessionUuid(cwd, 'sess-x', base), null);
  } finally { rm(base); }
});
