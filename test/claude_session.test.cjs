const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { cwdToSlug } = require('../dashboard_slug.cjs');
const { shouldContinue } = require('../claude_session.cjs');

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
