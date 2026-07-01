'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('name 为 cc-web-control', () => {
  assert.equal(pkg.name, 'cc-web-control');
});

test('bin 映射 cc-web-control 到 bin/cc-web-control.cjs', () => {
  assert.equal(pkg.bin['cc-web-control'], 'bin/cc-web-control.cjs');
});

test('files 覆盖 public/、claude-wrapper.sh、bin/ 与根 *.cjs', () => {
  assert.ok(pkg.files.includes('public/'), '缺 public/');
  assert.ok(pkg.files.includes('claude-wrapper.sh'), '缺 claude-wrapper.sh');
  assert.ok(pkg.files.includes('bin/'), '缺 bin/');
  assert.ok(pkg.files.includes('*.cjs'), '缺 *.cjs');
});

test('engines.node 要求 >= 18', () => {
  assert.ok(pkg.engines && /1[8-9]|[2-9][0-9]/.test(pkg.engines.node), `engines.node=${pkg.engines && pkg.engines.node}`);
});

test('保留 main 指向 server.cjs', () => {
  assert.equal(pkg.main, 'server.cjs');
});
