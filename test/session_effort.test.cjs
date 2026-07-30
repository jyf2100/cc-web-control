'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getEffort, setEffort, deleteEffort } = require('../session_effort.cjs');
const { DEFAULT_EFFORT } = require('../public/effort.cjs');

// 每个测试独立 tmp 目录(依赖注入 baseDir),互不污染。
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-effort-'));
}

test('setEffort/getEffort:合法会话+档位 → 落盘并可回读', () => {
  const dir = tmpDir();
  try {
    setEffort('claude-foo', 'high', dir);
    assert.equal(getEffort('claude-foo', dir), 'high');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('setEffort:非法 effort 归一化为 DEFAULT_EFFORT 落盘', () => {
  const dir = tmpDir();
  try {
    setEffort('claude-foo', 'turbo', dir);
    assert.equal(getEffort('claude-foo', dir), DEFAULT_EFFORT);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('setEffort:覆盖写 → 回读最新档位', () => {
  const dir = tmpDir();
  try {
    setEffort('claude-foo', 'low', dir);
    setEffort('claude-foo', 'max', dir);
    assert.equal(getEffort('claude-foo', dir), 'max');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('getEffort:无记录 → null(调用方降级默认)', () => {
  const dir = tmpDir();
  try {
    assert.equal(getEffort('claude-missing', dir), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('getEffort:文件内容非法 → null(不回读脏值)', () => {
  const dir = tmpDir();
  try {
    setEffort('claude-foo', 'medium', dir);
    const file = path.join(dir, 'effort', 'claude-foo');
    fs.writeFileSync(file, 'TURBO\n', { mode: 0o600 });
    assert.equal(getEffort('claude-foo', dir), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('setEffort:非法 sessionName → 静默不写(白名单防路径注入)', () => {
  const dir = tmpDir();
  try {
    setEffort('../escape', 'high', dir);
    setEffort('a/b', 'high', dir);
    assert.equal(getEffort('../escape', dir), null);
    // 目录下不应出现逃逸文件
    assert.ok(!fs.existsSync(path.join(dir, 'escape')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deleteEffort:幂等删除已存在记录', () => {
  const dir = tmpDir();
  try {
    setEffort('claude-foo', 'high', dir);
    assert.equal(getEffort('claude-foo', dir), 'high');
    deleteEffort('claude-foo', dir);
    assert.equal(getEffort('claude-foo', dir), null);
    // 再删一次不抛
    deleteEffort('claude-foo', dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('setEffort:覆盖 symlink → 先删后写(防覆写敏感文件目标)', () => {
  const dir = tmpDir();
  try {
    // 预置一个 symlink 指向敏感文件
    const target = path.join(dir, 'secret');
    fs.writeFileSync(target, 'SECRET', { mode: 0o600 });
    const effortDir = path.join(dir, 'effort');
    fs.mkdirSync(effortDir, { recursive: true });
    const link = path.join(effortDir, 'claude-foo');
    fs.symlinkSync(target, link);
    // setEffort 应先删 symlink 再写常规文件,不跟随 symlink 覆写 target
    setEffort('claude-foo', 'high', dir);
    assert.equal(fs.readFileSync(target, 'utf8'), 'SECRET', 'symlink 目标不应被覆写');
    assert.equal(getEffort('claude-foo', dir), 'high');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
