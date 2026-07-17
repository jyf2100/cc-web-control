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
test('config → 子命令 config', () => {
  assert.deepEqual(parseSubcommand(['config']), { sub: 'config', args: [] });
});
test('config set anthropic.api-key X → args 透传(set 子命令)', () => {
  assert.deepEqual(parseSubcommand(['config', 'set', 'anthropic.api-key', 'X']), {
    sub: 'config', args: ['set', 'anthropic.api-key', 'X'],
  });
});
