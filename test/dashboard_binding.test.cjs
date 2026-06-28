const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readBinding, writeBinding, deleteBinding, createSessionBinding } = require('../dashboard_binding.cjs');

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

test('createSessionBinding:生成有效 UUID 且 readBinding 一致', () => {
  const base = tmpDir();
  try {
    const result = createSessionBinding({ cwd: '/Users/roc/proj', sessionName: 'sess-x', projectsDir: base });
    assert.ok(result, '应返回绑定结果');
    assert.equal(result.slug, SLUG);
    // UUID v4 格式(crypto.randomUUID 输出)
    assert.match(result.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // 写入后 readBinding 应回读到同一 sessionId
    assert.equal(readBinding(result.slug, 'sess-x', base), result.sessionId);
  } finally { rm(base); }
});

test('createSessionBinding:cwd 缺失 → null(不写绑定)', () => {
  assert.equal(createSessionBinding({ cwd: '', sessionName: 's', projectsDir: tmpDir() }), null);
  assert.equal(createSessionBinding({ cwd: null, sessionName: 's', projectsDir: tmpDir() }), null);
});
