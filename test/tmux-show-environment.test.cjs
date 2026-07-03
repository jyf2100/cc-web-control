'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildShowEnvArgs } = require('../tmux.cjs');

test('buildShowEnvArgs: session + key → show-environment 参数', () => {
  assert.deepEqual(
    buildShowEnvArgs('cc-main-agent', 'CC_WEB_OWNED'),
    ['show-environment', '-t', 'cc-main-agent', 'CC_WEB_OWNED'],
  );
});

test('buildShowEnvArgs: 不同 session/key 防参数顺序互换', () => {
  assert.deepEqual(
    buildShowEnvArgs('s2', 'OTHER_KEY'),
    ['show-environment', '-t', 's2', 'OTHER_KEY'],
  );
});
