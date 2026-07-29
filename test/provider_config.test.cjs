'use strict';

// PRD「配置文件体系:模型供应商可切换、不硬编码单家」验收测试。
// 覆盖 6 条验收标准:配置项存在 / 切换不改码 / 按节点并存 / 无硬编码绑定 /
// 缺失配置 fail-fast / 鉴权不落源码。纯函数行为 + 进程级 fail-fast。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  validateProviderConfig,
  providerEnv,
  ENV_BASE_URL,
  ENV_MODEL,
} = require('../provider_config.cjs');
const { loadConfig, SINGLE_SCHEMA } = require('../config_loader.cjs');

function writeTmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-cfg-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

// ---- 验收 #1:配置项存在(三个供应商字段:endpoint / model / 鉴权引用)----

test('#1 schema:供应商三字段(providerEndpoint / providerModel / anthropic_api_key)存在于 SINGLE_SCHEMA', () => {
  assert.equal(typeof SINGLE_SCHEMA.providerEndpoint, 'object');
  assert.equal(typeof SINGLE_SCHEMA.providerModel, 'object');
  assert.equal(typeof SINGLE_SCHEMA.anthropic_api_key, 'object');
  // 字段说明:env 映射 + 默认空(向后兼容)
  assert.equal(SINGLE_SCHEMA.providerEndpoint.env, ENV_BASE_URL);
  assert.equal(SINGLE_SCHEMA.providerModel.env, ENV_MODEL);
  assert.equal(SINGLE_SCHEMA.providerEndpoint.default, '');
  assert.equal(SINGLE_SCHEMA.providerModel.default, '');
});

// ---- 验收 #2:切换不改码 —— 改 config 的 endpoint/model,注入子进程的 env 目标随之改变 ----

test('#2 providerEnv:注入 env 的目标 = 配置传入的 endpoint/model(非硬编码)', () => {
  // 改成一个不同的合法值(stub endpoint + 自定义 model)
  const env = providerEnv({ endpoint: 'https://stub-provider.local/v1', model: 'stub-model-xyz' });
  assert.equal(env[ENV_BASE_URL], 'https://stub-provider.local/v1');
  assert.equal(env[ENV_MODEL], 'stub-model-xyz');
});

test('#2 端到端:loadConfig 读 config 文件 → providerEnv 反映文件值(切换仅改配置)', () => {
  const f = writeTmp(JSON.stringify({
    providerEndpoint: 'https://gateway-a.example.com',
    providerModel: 'model-A',
  }));
  try {
    const { config } = loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: f, argv: [], env: {} });
    const env = providerEnv({ endpoint: config.providerEndpoint, model: config.providerModel });
    assert.equal(env[ENV_BASE_URL], 'https://gateway-a.example.com');
    assert.equal(env[ENV_MODEL], 'model-A');
  } finally { rm(path.dirname(f)); }
});

test('#2 默认模式:两端皆空 → 不注入任何供应商 env(claude 走自带默认,向后兼容)', () => {
  assert.deepEqual(providerEnv({ endpoint: '', model: '' }), {});
  assert.deepEqual(providerEnv({}), {});
});

// ---- 验收 #3:按节点并存 —— 两节点加载不同供应商配置,env 互不干扰 ----

test('#3 按节点并存:配置 A / B 产生独立 env,同一 hub 下互不串扰', () => {
  const fa = writeTmp(JSON.stringify({ providerEndpoint: 'https://endpoint-A.local', providerModel: 'model-A' }));
  const fb = writeTmp(JSON.stringify({ providerEndpoint: 'https://endpoint-B.local', providerModel: 'model-B' }));
  try {
    // 模拟两个节点各自 loadConfig(独立配置文件 → 独立 env,正是 hub 聚合并存的基础)
    const ca = loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: fa, argv: [], env: {} }).config;
    const cb = loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: fb, argv: [], env: {} }).config;
    const envA = providerEnv({ endpoint: ca.providerEndpoint, model: ca.providerModel });
    const envB = providerEnv({ endpoint: cb.providerEndpoint, model: cb.providerModel });
    assert.equal(envA[ENV_BASE_URL], 'https://endpoint-A.local');
    assert.equal(envB[ENV_BASE_URL], 'https://endpoint-B.local');
    assert.equal(envA[ENV_MODEL], 'model-A');
    assert.equal(envB[ENV_MODEL], 'model-B');
    assert.notEqual(envA[ENV_BASE_URL], envB[ENV_BASE_URL], '两节点 endpoint 必须不同(并存)');
  } finally { rm(path.dirname(fa)); rm(path.dirname(fb)); }
});

// ---- 验收 #4:无硬编码绑定 —— env 值来源 = 配置变量,非字面量 ----

test('#4 providerEnv 输出严格等于入参(无任何内置供应商 endpoint / model 字面量)', () => {
  // 任意输入都被忠实透传:函数本身不含任何固定供应商值
  for (const [ep, md] of [
    ['https://anywhere.example.com', 'any-model'],
    ['http://localhost:11434', 'llama'],
    ['', ''],
  ]) {
    const env = providerEnv({ endpoint: ep, model: md });
    assert.equal(env[ENV_BASE_URL] || '', ep.trim());
    assert.equal(env[ENV_MODEL] || '', md.trim());
  }
  // 确认源码不含具体供应商 endpoint / 模型 id 字面量被直接用于调用
  const src = fs.readFileSync(path.join(__dirname, '..', 'provider_config.cjs'), 'utf8');
  assert.ok(!/https?:\/\/(api\.anthropic\.com|api\.openai\.com)/.test(src), '源码不应硬编码具体供应商 endpoint');
  assert.ok(!/claude-(sonnet|opus|haiku|3|4)-[\w.-]+/.test(src), '源码不应硬编码具体模型 id');
});

// ---- 验收 #5:缺失配置 fail-fast(纯函数 + 进程级)----

test('#5 validateProviderConfig:只配 model 不配 endpoint → {ok:false} + 明确错误(含字段名)', () => {
  const r = validateProviderConfig({ endpoint: '', model: 'some-model' });
  assert.equal(r.ok, false);
  assert.ok(/providerEndpoint/.test(r.error), `错误应点名缺失字段,实际:${r.error}`);
  assert.ok(/不.*回退.*硬编码|不会回退/.test(r.error), `错误应说明不回退硬编码默认,实际:${r.error}`);
});

test('#5 validateProviderConfig:只配 endpoint 不配 model → {ok:false}', () => {
  const r = validateProviderConfig({ endpoint: 'https://x.local', model: '' });
  assert.equal(r.ok, false);
  assert.ok(/providerModel/.test(r.error));
});

test('#5 validateProviderConfig:两端皆空 → {ok:true}(默认模式,不 fail)', () => {
  assert.equal(validateProviderConfig({ endpoint: '', model: '' }).ok, true);
  assert.equal(validateProviderConfig({}).ok, true);
});

test('#5 validateProviderConfig:两端皆给 → {ok:true}(自定义供应商模式)', () => {
  assert.equal(validateProviderConfig({ endpoint: 'https://x.local', model: 'm' }).ok, true);
});

test('#5 进程级:config 仅配 model(缺 endpoint)→ node server.cjs 非零退出 + 明确错误', () => {
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-ff-'));
  const badCfg = path.join(badDir, 'config.json');
  fs.writeFileSync(badCfg, JSON.stringify({ providerModel: 'orphan-model-id' }), { mode: 0o600 });
  const serverPath = path.join(__dirname, '..', 'server.cjs');
  // 清掉父进程可能注入的 ANTHROPIC_BASE_URL/MODEL,确保走文件值(model 有、endpoint 无)
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_BASE_URL;
  delete childEnv.ANTHROPIC_MODEL;
  try {
    const result = spawnSync(process.execPath, [serverPath, '--config', badCfg], {
      env: childEnv,
      timeout: 20000,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, `期望退出码 1(fail-fast),实际 ${result.status};stderr=${result.stderr || ''}`);
    assert.match(
      (result.stderr || '') + (result.stdout || ''),
      /供应商配置不完整|providerEndpoint/,
      `应打印明确错误信息,实际 stderr=${result.stderr || '(空)'} stdout=${result.stdout || '(空)'}`
    );
  } finally {
    rm(badDir);
  }
});

// ---- 验收 #6:鉴权不落源码 —— 鉴权仅经配置/环境变量引用(provider_config 不接触明文 key)----

test('#6 provider_config.cjs 不含明文 API key 字面量,且仅处理 endpoint/model(鉴权解耦)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'provider_config.cjs'), 'utf8');
  assert.ok(!/sk-ant-[A-Za-z0-9_-]+/.test(src), '不应出现明文 Anthropic key 字面量');
  assert.ok(!/AKIA[0-9A-Z]{16}/.test(src), '不应出现明文 AWS key 字面量');
  // 结构性:本模块导出的两个函数只接收/产出 endpoint 与 model,不接收也不回传任何鉴权明文
  // (鉴权引用字段 anthropic_api_key 由 secret_store.cjs 的 resolveApiKey 独立解析注入)
  const exports_ = require('../provider_config.cjs');
  assert.equal(typeof exports_.validateProviderConfig, 'function');
  assert.equal(typeof exports_.providerEnv, 'function');
  assert.deepEqual(Object.keys(exports_).sort(), ['ENV_BASE_URL', 'ENV_MODEL', 'providerEnv', 'validateProviderConfig']);
});
