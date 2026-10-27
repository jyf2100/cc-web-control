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
  // engine 重构:合并模板抽到 claude_launch.cjs 的 buildSessionStartCommand(纯函数,可逐字节
  // 单测);server 侧契约不变——单次 buildSessionStartCommand + 单次 sendKeys(防 cd 未生效竞态)。
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(/buildSessionStartCommand\(/.test(inFn), '未走 buildSessionStartCommand(cd+launch 合并)');
  const LAUNCH = fs.readFileSync(path.join(__dirname, '..', 'claude_launch.cjs'), 'utf8');
  assert.ok(
    /cd\s+"\$\{escapedCwd\}"\s*&&\s*\$\{launch\}/.test(LAUNCH),
    'claude_launch.cjs 未合并为 cd "..." && <launch> 单条命令'
  );
});

test('startClaudeInSession: 续接判断走 shouldContinue', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(/shouldContinue\s*\(/.test(inFn),
    '未调用 shouldContinue(cwd)');
});

test('startClaudeInSession: 默认会话(RESOLVED_DEFAULT_SESSION)启动走 useClaudeContinue(范围限定)', () => {
  const initFn = extractFunction(SERVER, 'initAndAttachSession');
  assert.ok(/startClaudeInSession\(\s*RESOLVED_DEFAULT_SESSION\s*,\s*cwd\s*,\s*\{\s*useClaudeContinue:\s*true\s*\}\s*\)/.test(initFn),
    'RESOLVED_DEFAULT_SESSION 启动未传 { useClaudeContinue: true },CLAUDE_CONTINUE 行为被破坏');
});
