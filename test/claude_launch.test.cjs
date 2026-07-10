const test = require('node:test');
const assert = require('node:assert/strict');

const { buildClaudeLaunchCommand, shellEscapeForDoubleQuotes } = require('../claude_launch.cjs');

// 新签名 { wrapperPath, sessionId?, resumeId? }:事前钉死 jsonl 文件名(评审团 2/3 号方案)。
//   sessionId  → claude --session-id <uuid>(新建,jsonl 文件名 = uuid)
//   resumeId   → claude --resume <uuid>(续接,追加进同一 jsonl)
//   都无       → 裸 claude(自生成 uuid,不绑定,降级兜底)
//   两者都传   → throw(语义互斥,防误用)

test('buildClaudeLaunchCommand sessionId → bash "<w>" --session-id "<id>"', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/w.sh', sessionId: '11111111-2222-3333-4444-555555555555' });
  assert.equal(cmd, 'bash "/tmp/w.sh" --session-id "11111111-2222-3333-4444-555555555555"');
});

test('buildClaudeLaunchCommand resumeId → bash "<w>" --resume "<id>"', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/w.sh', resumeId: '22222222-3333-4444-5555-666666666666' });
  assert.equal(cmd, 'bash "/tmp/w.sh" --resume "22222222-3333-4444-5555-666666666666"');
});

test('buildClaudeLaunchCommand 无 sessionId/resumeId → plain bash "<w>"', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/w.sh' });
  assert.equal(cmd, 'bash "/tmp/w.sh"');
});

test('buildClaudeLaunchCommand 同时传 sessionId 和 resumeId → throw(互斥)', () => {
  assert.throws(
    () => buildClaudeLaunchCommand({ wrapperPath: '/tmp/w.sh', sessionId: 'a', resumeId: 'b' }),
    /mutually exclusive|二者不可同时|sessionId.*resumeId/i
  );
});

test('buildClaudeLaunchCommand sessionId 经 shellEscape(纵深防御:含 $ 被转义)', () => {
  // 合法 UUID 不含元字符,但 id 直接拼进 tmux send-keys 双引号,纵深防御必须转义。
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/w.sh', sessionId: 'a$b' });
  assert.equal(cmd, 'bash "/tmp/w.sh" --session-id "a\\$b"');
});

test('buildClaudeLaunchCommand resumeId 经 shellEscape(含 ` 被转义)', () => {
  const cmd = buildClaudeLaunchCommand({ wrapperPath: '/tmp/w.sh', resumeId: 'a`b' });
  assert.equal(cmd, 'bash "/tmp/w.sh" --resume "a\\`b"');
});

test('buildClaudeLaunchCommand wrapperPath 空/空白/缺省 → throw', () => {
  assert.throws(() => buildClaudeLaunchCommand({ wrapperPath: '' }));
  assert.throws(() => buildClaudeLaunchCommand({ wrapperPath: '   ' }));
  assert.throws(() => buildClaudeLaunchCommand({}));
});

// --- 既有 shellEscapeForDoubleQuotes 纯函数测试保留 ---

test('shellEscapeForDoubleQuotes escapes shell metacharacters in double-quote context', () => {
  assert.equal(shellEscapeForDoubleQuotes('a$b'), 'a\\$b');
  assert.equal(shellEscapeForDoubleQuotes('a`b`'), 'a\\`b\\`');
  assert.equal(shellEscapeForDoubleQuotes('a"b"'), 'a\\"b\\"');
  assert.equal(shellEscapeForDoubleQuotes('a\\b'), 'a\\\\b');
});

test('shellEscapeForDoubleQuotes strips CR/LF to block tmux send-keys newline injection', () => {
  // 换行无法在双引号内可靠转义为字面量,删除最稳;合法 id/路径不含换行。
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
