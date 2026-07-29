'use strict';
// server.cjs 供应商配置接线(源码级契约):endpoint/model 取自配置注入子进程 + 缺失 fail-fast。
// 对照 test/server-keychain-audit-wiring.test.cjs 的源码级断言风格。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs: require provider_config.cjs', () => {
  assert.match(src, /require\(['"]\.\/provider_config\.cjs['"]\)/);
});

test('server.cjs: claudeSessionEnv 经 providerEnv 合并 CFG.providerEndpoint/providerModel(值来自配置,非字面量)', () => {
  // 调用点必须以 CFG.providerEndpoint / CFG.providerModel 喂 providerEnv(非硬编码 URL/model)
  assert.match(src, /providerEnv\(\s*\{\s*endpoint:\s*CFG\.providerEndpoint/);
  assert.match(src, /model:\s*CFG\.providerModel/);
});

test('server.cjs: 注入子进程的两处 createSession 仍用 claudeSessionEnv()', () => {
  const matches = src.match(/createSession\([^)]*env:\s*claudeSessionEnv\(\)/g) || [];
  assert.ok(matches.length >= 2, `createSession 应至少 2 处注入 env,实际 ${matches.length}`);
});

test('server.cjs: bootstrap 首步 validateProviderConfig + !ok → process.exit(1)(fail-fast)', () => {
  assert.match(src, /validateProviderConfig\(\s*\{\s*endpoint:\s*CFG\.providerEndpoint/);
  assert.match(src, /model:\s*CFG\.providerModel/);
  // 校验失败须显式退出 1(非静默回退硬编码默认)
  assert.match(src, /if\s*\(!providerCheck\.ok\)/);
  assert.match(src, /process\.exit\(1\)/);
});

test('server.cjs: 注入路径无硬编码供应商 endpoint URL / 模型 id 字面量(值均经 CFG/providerEnv)', () => {
  // claudeSessionEnv / providerEnv 相关区段不应出现具体供应商 URL 或模型 id 字面量
  const idx = src.indexOf('function claudeSessionEnv');
  assert.ok(idx > 0, '应有 claudeSessionEnv 定义');
  const seg = src.slice(idx, idx + 600);
  assert.ok(!/https?:\/\/[a-z0-9.-]+\.(com|org|net|io|ai)\b/i.test(seg), 'claudeSessionEnv 不应硬编码供应商 URL');
  assert.ok(!/['"]claude-(sonnet|opus|haiku)-[\w.-]+['"]/.test(seg), 'claudeSessionEnv 不应硬编码模型 id');
});
