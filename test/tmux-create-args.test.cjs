'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCreateArgs } = require('../tmux.cjs');

test('无 opts,无 command', () => {
  assert.deepEqual(buildCreateArgs('s'), ['new-session', '-d', '-s', 's']);
});
test('cwd + env + command', () => {
  const a = buildCreateArgs('s', 'claude', { cwd: '/d', env: { A: '1', B: '2' } });
  assert.equal(a[0], 'new-session');
  assert.ok(a.includes('-c'), 'has -c');
  assert.ok(a.includes('/d'));
  assert.ok(a.includes('-e') && a.includes('A=1') && a.includes('B=2'));
  assert.equal(a[a.length - 1], 'claude');
});
