const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

function extractFunction(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let i = m.index + m[0].lastIndexOf('{');
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error(`function ${name} braces unbalanced`);
}

test('server.cjs: require claude_session.cjs', () => {
  assert.ok(/require\(['"]\.\/claude_session\.cjs['"]\)/.test(SERVER),
    '未 require ./claude_session.cjs');
});

test('startClaudeInSession: 不再调用 createSessionBinding', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(!/createSessionBinding\s*\(/.test(inFn),
    'startClaudeInSession 仍调用 createSessionBinding');
});

test('startClaudeInSession: 不再注入 CC_WEB_CLAUDE_SESSION_ID', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(!/CC_WEB_CLAUDE_SESSION_ID/.test(inFn),
    'startClaudeInSession 仍注入 CC_WEB_CLAUDE_SESSION_ID');
});

test('startClaudeInSession: cd 与启动合并为单条命令', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(/cd\s+"[^"]*"\s*&&\s*/.test(inFn),
    '未合并为 cd "..." && <launch> 单条 sendKeys');
});

test('startClaudeInSession: 续接判断走 shouldContinue', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(/shouldContinue\s*\(/.test(inFn),
    '未调用 shouldContinue(cwd)');
});

test('startClaudeInSession: DEFAULT_SESSION 调用走 useClaudeContinue(范围限定)', () => {
  const initFn = extractFunction(SERVER, 'initAndAttachSession');
  assert.ok(/startClaudeInSession\(\s*DEFAULT_SESSION\s*,\s*cwd\s*,\s*\{\s*useClaudeContinue:\s*true\s*\}\s*\)/.test(initFn),
    'DEFAULT_SESSION 启动未传 { useClaudeContinue: true },CLAUDE_CONTINUE 行为被破坏');
});
