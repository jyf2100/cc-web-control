const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubcommand } = require('../bin/cc-web-control.cjs');

test('无参 → 子命令 default(单机)', () => {
  assert.deepEqual(parseSubcommand([]), { sub: 'default', args: [] });
});
test('hub → 子命令 hub', () => {
  assert.deepEqual(parseSubcommand(['hub']), { sub: 'hub', args: [] });
});
test('hub --port 8000 → args 透传', () => {
  assert.deepEqual(parseSubcommand(['hub', '--port', '8000']), { sub: 'hub', args: ['--port', '8000'] });
});
