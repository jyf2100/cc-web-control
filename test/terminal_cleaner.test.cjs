const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanOutput } = require('../public/terminal_cleaner.cjs');

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

const { cleanSummary } = require('../public/terminal_cleaner.cjs');

test('cleanSummary: 去 markdown 标记(## 标题 / **粗** / `行内码`)', () => {
  assert.equal(cleanSummary('## 收尾完成 ✅ `memory → harness-memory`'), '收尾完成 ✅ memory → harness-memory');
  assert.equal(cleanSummary('全部测试通过(**73/73 绿**)'), '全部测试通过(73/73 绿)');
  assert.equal(cleanSummary('see *note* here').trim(), 'see note here');
  assert.equal(cleanSummary('see _note_ here').trim(), 'see note here');
});

test('cleanSummary: 去列表符 / 引用 / 折叠空白', () => {
  assert.equal(cleanSummary('- 列表项'), '列表项');
  assert.equal(cleanSummary('> 引用文本'), '引用文本');
  assert.equal(cleanSummary('a   b\n\nc'), 'a b c');
});

test('cleanSummary: 截断 maxLen + 省略号(默认 60)', () => {
  assert.equal(cleanSummary('a'.repeat(100), 10), 'aaaaaaaaaa…');
  assert.equal(cleanSummary('a'.repeat(10), 60), 'aaaaaaaaaa'); // 未超不截
});

test('cleanSummary: null/undefined/非串 → 空串; ANSI 残留净化', () => {
  assert.equal(cleanSummary(null), '');
  assert.equal(cleanSummary(undefined), '');
  assert.equal(cleanSummary('\x1b[31mError: boom\x1b[0m'), 'Error: boom');
});
