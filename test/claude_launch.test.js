const test = require('node:test');
const assert = require('node:assert/strict');

const { buildClaudeLaunchCommand } = require('../claude_launch');

test('buildClaudeLaunchCommand includes -c when continueConversation=true', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/claude-wrapper.sh', continueConversation: true });
  assert.equal(cmd, 'bash "/tmp/claude-wrapper.sh" -c');
});

test('buildClaudeLaunchCommand omits -c when continueConversation=false', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/claude-wrapper.sh', continueConversation: false });
  assert.equal(cmd, 'bash "/tmp/claude-wrapper.sh"');
});

