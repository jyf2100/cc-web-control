const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { cwdToSlug, resolveProjectDir, listProjectJsonls } = require('../dashboard_slug.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-slug-'));
}
function rm(d) {
  fs.rmSync(d, { recursive: true, force: true });
}

test('cwdToSlug: / → - (main algorithm)', () => {
  assert.equal(cwdToSlug('/Users/roc/workspace/cc-web-control'), '-Users-roc-workspace-cc-web-control');
  assert.equal(cwdToSlug('/a/b/c'), '-a-b-c');
});

test('cwdToSlug: empty / non-string → null', () => {
  assert.equal(cwdToSlug(''), null);
  assert.equal(cwdToSlug(null), null);
  assert.equal(cwdToSlug(undefined), null);
});

test('resolveProjectDir: hit returns dir, miss returns null', () => {
  const base = tmpDir();
  try {
    const slugDir = path.join(base, '-Users-roc-test-proj');
    fs.mkdirSync(slugDir);
    assert.equal(resolveProjectDir('/Users/roc/test-proj', base), slugDir);
    assert.equal(resolveProjectDir('/Users/roc/no-such', base), null);
  } finally { rm(base); }
});

test('resolveProjectDir: empty cwd → null', () => {
  assert.equal(resolveProjectDir('', tmpDir()), null);
});

test('listProjectJsonls: top-level only, excludes subdirs (M4)', () => {
  const base = tmpDir();
  try {
    const slugDir = path.join(base, '-proj');
    fs.mkdirSync(slugDir);
    fs.writeFileSync(path.join(slugDir, 'a.jsonl'), '{}\n');
    fs.writeFileSync(path.join(slugDir, 'b.jsonl'), '{}\n');
    fs.writeFileSync(path.join(slugDir, 'notjson.txt'), 'x');
    // 子目录里的 jsonl 必须被排除(subagent 事件流污染)
    fs.mkdirSync(path.join(slugDir, 'subagents'));
    fs.writeFileSync(path.join(slugDir, 'subagents', 'sub.jsonl'), '{}\n');

    const files = listProjectJsonls(slugDir);
    assert.equal(files.length, 2);
    assert.ok(files.every((f) => f.endsWith('.jsonl')));
    assert.ok(!files.some((f) => f.includes('subagents')));
  } finally { rm(base); }
});

test('listProjectJsonls: missing dir → []', () => {
  assert.deepEqual(listProjectJsonls('/no/such/dir'), []);
});
