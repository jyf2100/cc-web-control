'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { handleConfigSet, parseConfigSetArgs, KEY_MAP } = require('../config_set.cjs');
const { KeychainError } = require('../secret_store.cjs');

function memFs(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    existsSync: (p) => store.has(p),
    readFileSync: (p) => store.get(p),
    writeFileSync: (p, data) => { store.set(p, data); },
    store,
  };
}
function mockStore({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    set: async (account, value) => {
      calls.push({ account, value });
      if (fail) throw new KeychainError('KEYCHAIN_UNAVAILABLE', 'keychain locked');
    },
  };
}

const TMP = '/tmp/cfg.json';

// —— parseConfigSetArgs ——
test('parseConfigSetArgs:合法 set anthropic.api-key <KEY>', () => {
  const r = parseConfigSetArgs(['set', 'anthropic.api-key', 'sk-ant-abc']);
  assert.equal(r.ok, true);
  assert.equal(r.account, 'anthropic-api-key');
  assert.equal(r.value, 'sk-ant-abc');
});

test('parseConfigSetArgs:非 set → 拒', () => {
  assert.equal(parseConfigSetArgs(['get', 'x']).ok, false);
});

test('parseConfigSetArgs:未知 key → 拒(列支持项)', () => {
  const r = parseConfigSetArgs(['set', 'foo.bar', 'v']);
  assert.equal(r.ok, false);
  assert.match(r.error, /anthropic.api-key/);
});

test('parseConfigSetArgs:缺 value → 拒', () => {
  assert.equal(parseConfigSetArgs(['set', 'anthropic.api-key']).ok, false);
});

test('KEY_MAP:anthropic.api-key → anthropic-api-key', () => {
  assert.equal(KEY_MAP['anthropic.api-key'], 'anthropic-api-key');
});

// —— handleConfigSet 成功(验收 A1/A2)——
test('成功:key 进 keychain(account=anthropic-api-key),config 字段改引用、无明文', async () => {
  const fsImpl = memFs({ [TMP]: JSON.stringify({ port: 7684 }) });
  const store = mockStore();
  const r = await handleConfigSet({
    args: ['set', 'anthropic.api-key', 'sk-ant-abc'],
    argv: ['node', 'ccwc', 'config', 'set', 'anthropic.api-key', 'sk-ant-abc', '--config', TMP],
    fsImpl,
    store,
  });
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.equal(store.calls[0].account, 'anthropic-api-key');
  assert.equal(store.calls[0].value, 'sk-ant-abc');
  const cfg = JSON.parse(fsImpl.store.get(TMP));
  assert.equal(cfg.port, 7684); // 其它字段保留
  assert.equal(cfg.anthropic_api_key, 'keychain://cc-web-control/anthropic-api-key');
  assert.ok(!fsImpl.store.get(TMP).includes('sk-ant-abc'), 'config 无明文 key');
});

test('成功:config 文件不存在 → 新建(含引用字段)', async () => {
  const fsImpl = memFs({});
  const store = mockStore();
  const r = await handleConfigSet({
    args: ['set', 'anthropic.api-key', 'sk-ant-abc'],
    argv: ['--config', TMP],
    fsImpl,
    store,
  });
  assert.equal(r.ok, true);
  const cfg = JSON.parse(fsImpl.store.get(TMP));
  assert.equal(cfg.anthropic_api_key, 'keychain://cc-web-control/anthropic-api-key');
});

// —— keychain 失败:绝不回退明文(验收 A5)——
test('keychain 不可用 → 结构化错误,config 未写明文/未改', async () => {
  const original = JSON.stringify({ port: 7684 });
  const fsImpl = memFs({ [TMP]: original });
  const store = mockStore({ fail: true });
  const r = await handleConfigSet({
    args: ['set', 'anthropic.api-key', 'sk-ant-abc'],
    argv: ['--config', TMP],
    fsImpl,
    store,
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.equal(r.error.code, 'KEYCHAIN_UNAVAILABLE');
  // config 原样未动
  assert.equal(fsImpl.store.get(TMP), original);
});
