'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { commandExists, findMissing, formatMissing, main } = require('../bin/cc-web-control.cjs');
const tunnel = require('../bin/cc-web-control-tunnel.cjs');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

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

test('formatMissing 单项缺失时输出该依赖名与安装提示', () => {
  const out = formatMissing(findMissing(name => name !== 'tmux'));
  assert.ok(out.includes('✗ tmux'));
  assert.ok(out.includes('brew install tmux'));
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

// ── cc-web-control-tunnel: 隧道 bin 入口(全局用户直接跑隧道,免拼 $(npm root -g) 长路径) ──
const tunnelBinPath = path.join(__dirname, '..', 'bin', 'cc-web-control-tunnel.cjs');

test('package.json: bin 含 cc-web-control-tunnel 入口', () => {
  assert.equal(
    pkg.bin['cc-web-control-tunnel'],
    'bin/cc-web-control-tunnel.cjs',
    `bin 应映射 cc-web-control-tunnel,实际 bin: ${JSON.stringify(pkg.bin)}`,
  );
});

test('bin/cc-web-control-tunnel.cjs 存在且为可执行脚本(shebang)', () => {
  assert.ok(fs.existsSync(tunnelBinPath), 'bin/cc-web-control-tunnel.cjs 应存在');
  const src = fs.readFileSync(tunnelBinPath, 'utf8');
  assert.ok(src.startsWith('#!'), '应有 shebang');
});

test('tunnel.resolveTunnelScript: 返回 restart_tunnel.sh 绝对路径且文件存在', () => {
  const p = tunnel.resolveTunnelScript();
  assert.ok(p.endsWith('scripts/restart_tunnel.sh'), `应以 scripts/restart_tunnel.sh 结尾,实际: ${p}`);
  assert.ok(fs.existsSync(p), `隧道脚本应存在: ${p}`);
});

test('tunnel.startTunnel: 用 bash 跑脚本,stdio inherit(透传 URL/TOKEN 输出)', () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on: () => {}, exitCode: null };
  };
  tunnel.startTunnel({ spawnFn: fakeSpawn, script: '/tmp/__fake_tunnel__.sh' });
  assert.equal(calls.length, 1, '应调用 spawn 一次');
  assert.equal(calls[0].cmd, 'bash', '应用 bash 执行');
  assert.deepEqual(calls[0].args, ['/tmp/__fake_tunnel__.sh'], '应把脚本路径作为 bash 参数');
  assert.equal(calls[0].opts.stdio, 'inherit', '应 stdio inherit 透传输出');
});

test('cc-web-control-tunnel.cjs: 不含写死的本机路径(对外通用)', () => {
  assert.ok(fs.existsSync(tunnelBinPath), 'bin 文件应存在');
  const src = fs.readFileSync(tunnelBinPath, 'utf8');
  assert.doesNotMatch(src, /\/Users\/roc|\/Volumes\/work/, '不应写死本机路径');
  assert.match(src, /__dirname/, '应基于 __dirname 解析脚本路径');
});
