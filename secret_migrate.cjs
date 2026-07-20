'use strict';

// 明文 anthropic_api_key → keychain 自动迁移(验收 A3)。
// 升级后首次启动:若 config 文件里 anthropic_api_key 是明文(sk-ant-...),把它搬进 OS keychain,
// 原地改写为 keychain:// 引用,并写一份 config.json.bak-YYYYMMDD(原值可读,便于人工核对后自删)。
// keychain 不可用(验收 A5):绝不回退明文,不修改 config,返回结构化 KEYCHAIN_UNAVAILABLE。
// 范式:纯逻辑 + DI(fsImpl/store/stamp),便于测试不碰真实 keychain/磁盘/时钟。

const fs = require('fs');
const path = require('path');
const { keychainRef, isPlaintextKey } = require('./secret_store.cjs');

const FIELD = 'anthropic_api_key';
const DEFAULT_SERVICE = 'cc-web-control';
const DEFAULT_ACCOUNT = 'anthropic-api-key';

function defaultStamp() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

function backupFor(configPath, stamp) {
  // config.json → config.json.bak-YYYYMMDD(同目录)
  return `${configPath}.bak-${stamp}`;
}

/**
 * @param {{configPath:string, store:{set:(a,v)=>Promise}, fsImpl?:object,
 *          service?:string, account?:string, stamp?:()=>string}} opts
 * @returns {Promise<{migrated:boolean, reason?:string, backupPath?:string,
 *                     ref?:string, error?:object}>}
 *   error 为 KeychainError(含 .code/.reason)时 reason='keychain-unavailable'。
 */
async function migrateConfigKeyToKeychain({
  configPath,
  store,
  fsImpl = fs,
  service = DEFAULT_SERVICE,
  account = DEFAULT_ACCOUNT,
  stamp = defaultStamp,
}) {
  if (!fsImpl.existsSync(configPath)) {
    return { migrated: false, reason: 'no-config' };
  }
  let raw;
  let parsed;
  try {
    raw = fsImpl.readFileSync(configPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (e) {
    return { migrated: false, reason: 'parse-error', error: e.message };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { migrated: false, reason: 'not-object' };
  }
  const cur = parsed[FIELD];
  if (cur === undefined || cur === null || cur === '') {
    return { migrated: false, reason: 'empty' };
  }
  // 已是 keychain 引用 → 无需迁移(幂等)
  if (!isPlaintextKey(cur)) {
    return { migrated: false, reason: 'already-ref' };
  }

  // 明文 → 写 keychain(失败绝不回退明文)
  try {
    await store.set(account, cur);
  } catch (e) {
    return { migrated: false, reason: 'keychain-unavailable', error: e };
  }

  // 写备份:原明文可读,便于用户人工核对一次后自删
  const backupPath = backupFor(configPath, stamp());
  fsImpl.writeFileSync(backupPath, raw, { mode: 0o600 });

  // 字段改引用,落回 config(2 空格缩进 + 尾换行,chmod 600)
  const ref = keychainRef(service, account);
  parsed[FIELD] = ref;
  fsImpl.writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });

  return { migrated: true, backupPath, ref, account, service };
}

module.exports = {
  migrateConfigKeyToKeychain,
  backupFor,
  defaultStamp,
  FIELD,
  DEFAULT_SERVICE,
  DEFAULT_ACCOUNT,
};
