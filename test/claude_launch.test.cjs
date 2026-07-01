const test = require('node:test');
const assert = require('node:assert/strict');

const { buildClaudeLaunchCommand, shellEscapeForDoubleQuotes } = require('../claude_launch.cjs');

test('buildClaudeLaunchCommand includes -c when continueConversation=true', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/claude-wrapper.sh', continueConversation: true });
  assert.equal(cmd, 'bash "/tmp/claude-wrapper.sh" -c');
});

test('buildClaudeLaunchCommand omits -c when continueConversation=false', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/claude-wrapper.sh', continueConversation: false });
  assert.equal(cmd, 'bash "/tmp/claude-wrapper.sh"');
});

test('shellEscapeForDoubleQuotes escapes shell metacharacters in double-quote context', () => {
  assert.equal(shellEscapeForDoubleQuotes('a$b'), 'a\\$b');
  assert.equal(shellEscapeForDoubleQuotes('a`b`'), 'a\\`b\\`');
  assert.equal(shellEscapeForDoubleQuotes('a"b"'), 'a\\"b\\"');
  assert.equal(shellEscapeForDoubleQuotes('a\\b'), 'a\\\\b');
});

test('shellEscapeForDoubleQuotes strips CR/LF to block tmux send-keys newline injection', () => {
  // 换行无法在双引号内可靠转义为字面量,删除最稳;合法项目路径不含换行。
  assert.equal(shellEscapeForDoubleQuotes('a\nb'), 'ab');
  assert.equal(shellEscapeForDoubleQuotes('a\rb'), 'ab');
  assert.equal(shellEscapeForDoubleQuotes('a\r\nb'), 'ab');
});

test('shellEscapeForDoubleQuotes leaves normal paths untouched', () => {
  assert.equal(
    shellEscapeForDoubleQuotes('/Users/roc/workspace/cc-web-control/claude-wrapper.sh'),
    '/Users/roc/workspace/cc-web-control/claude-wrapper.sh'
  );
});

