'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { migrateConfigKeyToKeychain, backupFor, FIELD } = require('../secret_migrate.cjs');
const { resolveApiKey, KeychainError, keychainRef } = require('../secret_store.cjs');

// 内存 fs:file → content(string)。
function memFs(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    existsSync: (p) => store.has(p),
    readFileSync: (p) => {
      if (!store.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return store.get(p);
    },
    writeFileSync: (p, data) => { store.set(p, data); },
  };
}

// mock store:set 记录调用,可控失败。
function mockStore({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    set: async (account, value) => {
      calls.push({ account, value });
      if (fail) throw new KeychainError('KEYCHAIN_UNAVAILABLE', 'keychain locked');
    },
    get: async () => 'resolved-key',
  };
}

const CFG = '/x/config.json';

// —— 迁移:明文 → keychain + ref + 备份(验收 A3)——
test('明文迁移:key 进 keychain,字段改 ref,config 无明文,备份含原值', async () => {
  const fsImpl = memFs({ [CFG]: JSON.stringify({ [FIELD]: 'sk-ant-test-XXXX', port: 7684 }, null, 2) });
  const store = mockStore();
  const r = await migrateConfigKeyToKeychain({
    configPath: CFG, store, fsImpl, stamp: () => '20260717',
  });
  assert.equal(r.migrated, true);
  assert.equal(store.calls[0].account, 'anthropic-api-key');
  assert.equal(store.calls[0].value, 'sk-ant-test-XXXX');
  // config 改 ref
  const newCfg = JSON.parse(fsImpl.store.get(CFG));
  assert.equal(newCfg[FIELD], 'keychain://cc-web-control/anthropic-api-key');
  assert.equal(newCfg.port, 7684); // 其它字段保留
  assert.ok(!fsImpl.store.get(CFG).includes('sk-ant-test-XXXX'), 'config 无明文');
  // 备份含原值
  const bak = fsImpl.store.get('/x/config.json.bak-20260717');
  assert.ok(bak.includes('sk-ant-test-XXXX'), '备份含原明文(供人工核对)');
  assert.equal(r.backupPath, '/x/config.json.bak-20260717');
});

test('backupFor:config.json → config.json.bak-YYYYMMDD', () => {
  assert.equal(backupFor('/a/b/config.json', '20260717'), '/a/b/config.json.bak-20260717');
});

// —— 幂等:已是 ref → 跳过 ——
test('已是 keychain ref → 不迁移(幂等)', async () => {
  const fsImpl = memFs({ [CFG]: JSON.stringify({ [FIELD]: keychainRef('cc-web-control', 'anthropic-api-key') }) });
  const store = mockStore();
  const r = await migrateConfigKeyToKeychain({ configPath: CFG, store, fsImpl });
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'already-ref');
  assert.equal(store.calls.length, 0);
});

// —— 空/不存在 ——
test('字段为空 → 不迁移', async () => {
  const fsImpl = memFs({ [CFG]: JSON.stringify({ port: 7684 }) });
  const r = await migrateConfigKeyToKeychain({ configPath: CFG, store: mockStore(), fsImpl });
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'empty');
});

test('config 文件不存在 → no-config,不抛', async () => {
  const fsImpl = memFs({});
  const r = await migrateConfigKeyToKeychain({ configPath: CFG, store: mockStore(), fsImpl });
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'no-config');
});

// —— keychain 失败:绝不回退明文,config 原样不动(验收 A5)——
test('keychain 不可用 → 返回结构化错误,config 原样保留明文(未回退、未清零)', async () => {
  const original = JSON.stringify({ [FIELD]: 'sk-ant-test-XXXX' });
  const fsImpl = memFs({ [CFG]: original });
  const store = mockStore({ fail: true });
  const r = await migrateConfigKeyToKeychain({ configPath: CFG, store, fsImpl });
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'keychain-unavailable');
  assert.equal(r.error.code, 'KEYCHAIN_UNAVAILABLE');
  // config 未被改写(无备份、字段仍是明文)
  assert.equal(fsImpl.store.get(CFG), original);
  assert.equal([...fsImpl.store.keys()].filter((k) => k.endsWith('.bak')).length, 0);
});

// JSON 解析失败 → parse-error
test('config JSON 损坏 → parse-error,不抛', async () => {
  const fsImpl = memFs({ [CFG]: '{ not json' });
  const r = await migrateConfigKeyToKeychain({ configPath: CFG, store: mockStore(), fsImpl });
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'parse-error');
});

// —— resolveApiKey ——
test('resolveApiKey:空 → null', async () => {
  assert.equal(await resolveApiKey('', mockStore()), null);
  assert.equal(await resolveApiKey(undefined, mockStore()), null);
});

test('resolveApiKey:ref → store.get(account)', async () => {
  const store = mockStore();
  const v = await resolveApiKey('keychain://cc-web-control/anthropic-api-key', store);
  assert.equal(v, 'resolved-key');
});

test('resolveApiKey:明文 → 原样返回(仅内存)', async () => {
  const v = await resolveApiKey('sk-ant-env-provided', mockStore());
  assert.equal(v, 'sk-ant-env-provided');
});

test('resolveApiKey:keychain 读失败 → 透传 KeychainError', async () => {
  const store = {
    get: async () => { throw new KeychainError('KEYCHAIN_UNAVAILABLE', 'locked'); },
  };
  await assert.rejects(
    () => resolveApiKey('keychain://cc-web-control/anthropic-api-key', store),
    (e) => e.code === 'KEYCHAIN_UNAVAILABLE',
  );
});
