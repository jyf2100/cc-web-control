'use strict';

// Task 9:模板合法性契约测试
// 防止 config.example.json / hub-config.example.json 腐烂:
//   (a) 必须是合法 JSON
//   (b) 必须能被 loadConfig 接受且无 warning(空 token 不触发权限告警;
//       不含 schema 之外的字段,不触发"未知字段"warning)
// 用 fsImpl 把 loadConfig 的文件读取重定向到 repo 内的 example 文件,
// 不读用户家目录、不依赖 --config flag。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  loadConfig,
  SINGLE_SCHEMA,
  HUB_SCHEMA,
  DEFAULT_HUB_MACHINES_FILE,
} = require('../config_loader.cjs');

// 自定义 fsImpl:把任意 filePath 重定向到 repo 内的 example 文件
// (测模板本身,不读用户家目录)。statSync 返回 0o600 → 不触发权限告警。
function fsImplFor(examplePath) {
  return {
    existsSync: () => true,
    readFileSync: () => fs.readFileSync(examplePath, 'utf8'),
    statSync: () => ({ mode: 0o600 }),
  };
}

test('config.example.json:合法 JSON + loadConfig 无 throw + 无 warning', () => {
  const example = path.join(__dirname, '..', 'config.example.json');
  const { config, warnings } = loadConfig({
    schema: SINGLE_SCHEMA,
    defaultFilePath: '/ignored',
    argv: [],
    fsImpl: fsImplFor(example),
  });
  // 模板字段必须与 SINGLE_SCHEMA 严格一致:不含未知字段,不含非法值
  assert.deepEqual(warnings, []);
  // 抽检关键字段类型/默认(逐字段全量比对见 schema 自身测试)
  assert.equal(config.port, 7684);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.session, 'claude-web-session');
  assert.ok(Array.isArray(config.projectRoots));
  assert.equal(config.pollInterval, 100);
  assert.equal(config.loginMax, 5);
  assert.equal(config.wsPingInterval, 30000);
});

test('hub-config.example.json:合法 JSON + loadConfig 无 throw + 无 warning', () => {
  const example = path.join(__dirname, '..', 'hub-config.example.json');
  const { config, warnings } = loadConfig({
    schema: HUB_SCHEMA,
    defaultFilePath: '/ignored',
    argv: [],
    fsImpl: fsImplFor(example),
  });
  assert.deepEqual(warnings, []);
  assert.equal(config.port, 7685);
  assert.equal(config.intervalMs, 2000);
  assert.equal(config.mainAgentMax, 6);
  assert.ok(typeof config.mainAgent === 'object' && config.mainAgent !== null);
  // mainAgent 子字段类型正确 passthrough
  assert.equal(config.mainAgent.enabled, false);
  assert.equal(config.mainAgent.settleMs, 60000);
  assert.equal(config.mainAgent.backoffBase, 2);
  // example 故意省略 machinesFile → loader 回退默认绝对路径(DEFAULT_HUB_MACHINES_FILE)
  assert.equal(config.machinesFile, DEFAULT_HUB_MACHINES_FILE);
});
