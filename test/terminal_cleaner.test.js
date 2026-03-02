const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanOutput } = require('../public/terminal_cleaner');

test('cleanOutput keeps slash palette text visible', () => {
  const sample = [
    'some previous output',
    '❯ /',
    'User skills (~/.claude/skills, ~/.claude/commands)',
    'tashan-development-loop · ~64 description tokens',
    '',
    'Esc to close',
    '',
  ].join('\n');

  const cleaned = cleanOutput(sample);
  assert.match(cleaned, /User skills/);
  assert.match(cleaned, /Esc to close/);
  assert.match(cleaned, /❯\s*\//, 'prompt line should remain visible so users can see interactive state');
});

test('cleanOutput does not hide last prompt line (needed for interactive "/" workflow)', () => {
  const sample = [
    'some previous output',
    '❯ /',
  ].join('\n');

  const cleaned = cleanOutput(sample);
  assert.match(cleaned, /❯\s*\//);
});
