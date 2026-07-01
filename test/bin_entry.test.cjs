'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commandExists, findMissing, formatMissing, main } = require('../bin/cc-web-control.cjs');

test('commandExists 对存在的命令返回 true', () => {
  assert.equal(commandExists('node'), true);
});

test('commandExists 对不存在的命令返回 false', () => {
  assert.equal(commandExists('no-such-cli-xyz-12345'), false);
});

test('findMissing 全部存在时返回空数组', () => {
  assert.deepEqual(findMissing(() => true), []);
});

test('findMissing 仅 tmux 缺失时返回 tmux', () => {
  const missing = findMissing(name => name !== 'tmux');
  assert.deepEqual(missing.map(m => m.name), ['tmux']);
});

test('findMissing 两者都缺失时返回 [tmux, claude]', () => {
  const missing = findMissing(() => false);
  assert.deepEqual(missing.map(m => m.name), ['tmux', 'claude']);
});

test('formatMissing 输出含依赖名与标题', () => {
  const out = formatMissing(findMissing(() => false));
  assert.ok(out.includes('缺少必需依赖'));
  assert.ok(out.includes('tmux'));
  assert.ok(out.includes('claude'));
});

test('main 缺失依赖时以 exit code 1 退出且不启动 server', () => {
  const origExit = process.exit;
  const origErr = console.error;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  console.error = () => {};
  try {
    main(() => false);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
});
