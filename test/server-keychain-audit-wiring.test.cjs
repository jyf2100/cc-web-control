'use strict';
// server.cjs keychain + 子进程审计接线(源码级契约):secret 不落盘 + spawn 级可观测。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskSecret } = require('../secret_store.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs: require secret_store / secret_migrate / subprocess_audit', () => {
  assert.match(src, /require\(['"]\.\/secret_store\.cjs['"]\)/);
  assert.match(src, /require\(['"]\.\/secret_migrate\.cjs['"]\)/);
  assert.match(src, /require\(['"]\.\/subprocess_audit\.cjs['"]\)/);
});

test('server.cjs: loadConfig 取 filePath(迁移要写回真实 config 路径)', () => {
  assert.match(src, /filePath:\s*CONFIG_FILE/);
});

test('server.cjs: key 解析后经 tmux -e 注入子进程 env(两处 createSession)', () => {
  assert.match(src, /claudeSessionEnv\(\)/);
  // createSession(... , null, { env: claudeSessionEnv() }) 两处(默认会话 + POST)
  const matches = src.match(/createSession\([^)]*env:\s*claudeSessionEnv\(\)/g) || [];
  assert.ok(matches.length >= 2, `createSession 应至少 2 处注入 env,实际 ${matches.length}`);
});

test('server.cjs: bootstrap 先迁移明文→keychain,再 resolveApiKey', () => {
  assert.match(src, /migrateConfigKeyToKeychain\(\s*\{\s*configPath:\s*CONFIG_FILE/);
  assert.match(src, /resolveApiKey\(\s*CFG\.anthropic_api_key/);
});

test('server.cjs: anthropic_api_key 读自 CFG(经 schema 字段)', () => {
  assert.match(src, /CFG\.anthropic_api_key/);
});

test('server.cjs: startClaudeInSession 内 recordStart(spawn 审计)', () => {
  assert.match(src, /subprocessAudit\.recordStart\(\s*\{\s*sessionName/);
});

test('server.cjs: DELETE /api/sessions 内 recordStop + paneExitStatus 取 exit_code', () => {
  assert.match(src, /subprocessAudit\.recordStop\(/);
  assert.match(src, /tmux\.paneExitStatus\(/);
});

test('server.cjs: GET /api/audit/cc-subprocess 端点(mask cmd)', () => {
  assert.match(src, /app\.get\(['"]\/api\/audit\/cc-subprocess['"]/);
  assert.match(src, /maskSecret\(e\.cmd\)/);
});

test('server.cjs: keychain 解析失败 ERROR 日志 + 不阻断启动(非 throw)', () => {
  // resolveApiKey 包在 try/catch,失败仅 console.error,不抛
  const idx = src.indexOf('resolveApiKey(CFG.anthropic_api_key');
  assert.ok(idx > 0);
  assert.ok(/console\.error\(/.test(src.slice(idx, idx + 400)));
});

// —— 行为级:maskSecret ——
test('maskSecret:sk-ant 字面值 → sk-ant-****(防 cmd 泄露 key)', () => {
  assert.equal(maskSecret('ANTHROPIC_API_KEY=sk-ant-abc123XYZ prompt'),
    'ANTHROPIC_API_KEY=sk-ant-**** prompt');
  assert.equal(maskSecret('claude --no-update'), 'claude --no-update'); // 无 key 原样
  assert.equal(maskSecret(undefined), undefined);
});
