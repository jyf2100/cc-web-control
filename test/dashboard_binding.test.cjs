const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readBinding, writeBinding, deleteBinding, migrateStaleBindings } = require('../dashboard_binding.cjs');
const { cwdToSlug } = require('../dashboard_slug.cjs');

// 绑定路径约定:<projectsDir>/<slug>/.cc-web-bindings/<tmuxName>,内容为单行 sessionId。
// 用 tmpDir 注入 projectsDir,绝不碰真实 ~/.claude/projects。
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bind-'));
}
function rm(d) {
  fs.rmSync(d, { recursive: true, force: true });
}
const SLUG = '-Users-roc-proj';

test('writeBinding + readBinding 往返', () => {
  const base = tmpDir();
  try {
    writeBinding(SLUG, 'sess-a', 'sid-123', base);
    assert.equal(readBinding(SLUG, 'sess-a', base), 'sid-123');
  } finally { rm(base); }
});

test('readBinding 不存在 → null', () => {
  const base = tmpDir();
  try {
    assert.equal(readBinding(SLUG, 'nope', base), null);
  } finally { rm(base); }
});

test('deleteBinding 删除后 readBinding → null,且幂等不抛', () => {
  const base = tmpDir();
  try {
    writeBinding(SLUG, 'sess-b', 'sid-456', base);
    deleteBinding(SLUG, 'sess-b', base);
    assert.equal(readBinding(SLUG, 'sess-b', base), null);
    assert.doesNotThrow(() => deleteBinding(SLUG, 'sess-b', base));
  } finally { rm(base); }
});

test('writeBinding 同 tmuxName 覆盖旧 sid', () => {
  const base = tmpDir();
  try {
    writeBinding(SLUG, 'sess-c', 'old', base);
    writeBinding(SLUG, 'sess-c', 'new', base);
    assert.equal(readBinding(SLUG, 'sess-c', base), 'new');
  } finally { rm(base); }
});

test('readBinding 容错:绑定文件为空 → null(不当空字符串)', () => {
  const base = tmpDir();
  try {
    writeBinding(SLUG, 'sess-d', 'sid-789', base);
    // 把文件清空模拟异常写入
    const dir = path.join(base, SLUG, '.cc-web-bindings');
    fs.writeFileSync(path.join(dir, 'sess-d'), '');
    assert.equal(readBinding(SLUG, 'sess-d', base), null);
  } finally { rm(base); }
});

test('writeBinding 幂等创建嵌套目录', () => {
  const base = tmpDir();
  try {
    // 项目目录尚不存在时也能写入
    writeBinding(SLUG, 'sess-e', 'sid-000', base);
    assert.equal(readBinding(SLUG, 'sess-e', base), 'sid-000');
  } finally { rm(base); }
});

test('migrateStaleBindings: 删除 sid 在 slug 目录下无同名 jsonl 的陈旧绑定', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bind-'));
  try {
    const cwd = '/Users/roc/workspace/proj-stale';
    const slug = cwdToSlug(cwd);
    const tmuxName = 'claude-proj-stale';
    const slugDir = path.join(base, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'other-uuid-2222.jsonl'), '{}\n');
    writeBinding(slug, tmuxName, 'dead-uuid-1111', base);
    assert.equal(readBinding(slug, tmuxName, base), 'dead-uuid-1111');

    const removed = migrateStaleBindings(base);

    assert.equal(removed.length, 1);
    assert.equal(removed[0].tmuxName, tmuxName);
    assert.equal(readBinding(slug, tmuxName, base), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('migrateStaleBindings: 保留 sid 有同名 jsonl 的有效绑定', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bind-'));
  try {
    const slug = cwdToSlug('/Users/roc/workspace/proj-live');
    const tmuxName = 'claude-proj-live';
    const slugDir = path.join(base, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'live-uuid-3333.jsonl'), '{}\n');
    writeBinding(slug, tmuxName, 'live-uuid-3333', base);

    const removed = migrateStaleBindings(base);

    assert.deepEqual(removed, []);
    assert.equal(readBinding(slug, tmuxName, base), 'live-uuid-3333');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('migrateStaleBindings: slug 目录不存在 → 删绑定', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bind-'));
  try {
    const slug = cwdToSlug('/Users/roc/workspace/proj-gone');
    writeBinding(slug, 'claude-proj-gone', 'orphan-uuid-4444', base);

    const removed = migrateStaleBindings(base);

    assert.equal(removed.length, 1);
    assert.equal(readBinding(slug, 'claude-proj-gone', base), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('migrateStaleBindings: 空 baseDir → 返回 [] 不抛', () => {
  assert.deepEqual(migrateStaleBindings('/no/such/base'), []);
});

test('dashboard_binding.cjs: 不再导出 createSessionBinding', () => {
  const mod = require('../dashboard_binding.cjs');
  assert.equal(typeof mod.createSessionBinding, 'undefined');
  assert.equal(typeof mod.migrateStaleBindings, 'function');
  assert.equal(typeof mod.readBinding, 'function');
  assert.equal(typeof mod.deleteBinding, 'function');
});
