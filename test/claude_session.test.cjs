const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { cwdToSlug } = require('../dashboard_slug.cjs');
const { shouldContinue, pickLatestSessionUuid } = require('../claude_session.cjs');

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
