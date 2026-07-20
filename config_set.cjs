'use strict';

// `cc-web-control config set <dotted> <value>` 的纯逻辑(DI:store/fsImpl/argv)。
// 当前仅支持 anthropic.api-key:把 key 写入 OS keychain(service=cc-web-control,account=anthropic-api-key),
// 并把 config 文件的 anthropic_api_key 字段改为 keychain:// 引用(零明文落盘,验收 A1/A2)。
// keychain 不可用(验收 A5):绝不回退明文,返回结构化错误。

const { keychainRef } = require('./secret_store.cjs');
const { parseConfigFlag, SINGLE_CONFIG_PATH } = require('./config_loader.cjs');

const SERVICE = 'cc-web-control';
const FIELD = 'anthropic_api_key';
// CLI dotted 名 → keychain account
const KEY_MAP = { 'anthropic.api-key': 'anthropic-api-key' };

function parseConfigSetArgs(args) {
  if (!Array.isArray(args) || args[0] !== 'set') {
    return { ok: false, error: 'usage: cc-web-control config set <key> <value>(仅支持 set)' };
  }
  const dotted = args[1];
  if (!dotted || !KEY_MAP[dotted]) {
    return { ok: false, error: `unknown key "${dotted}"(支持: ${Object.keys(KEY_MAP).join(', ')})` };
  }
  const value = args[2];
  if (typeof value !== 'string' || !value) {
    return { ok: false, error: 'value required' };
  }
  return { ok: true, account: KEY_MAP[dotted], value };
}

/**
 * @param {{args:string[], argv?:string[], fsImpl:object, store:{set:()=>Promise}}} opts
 * @returns {Promise<{ok:boolean, exitCode:number, message:string, configPath?:string, error?:object}>}
 */
async function handleConfigSet({ args, argv = [], fsImpl, store }) {
  const parsed = parseConfigSetArgs(args);
  if (!parsed.ok) return { ok: false, exitCode: 2, message: parsed.error };

  const configPath = parseConfigFlag(argv) || SINGLE_CONFIG_PATH;

  // 1) 写 keychain —— 失败绝不回退明文(验收 A5)
  try {
    await store.set(parsed.account, parsed.value);
  } catch (e) {
    const err = e && typeof e.toJSON === 'function' ? e.toJSON() : { error: e.message };
    return {
      ok: false,
      exitCode: 1,
      message: `keychain 写入失败 ${e.code || ''}: ${e.reason || e.message}`,
      error: err,
    };
  }

  // 2) config 文件字段改引用(零明文落盘)
  let cfg = {};
  if (fsImpl.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fsImpl.readFileSync(configPath, 'utf8'));
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
    } catch {
      cfg = {}; // 损坏则新建(不抛,保留可写)
    }
  }
  cfg[FIELD] = keychainRef(SERVICE, parsed.account);
  fsImpl.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });

  return {
    ok: true,
    exitCode: 0,
    configPath,
    message: `已写入 OS keychain(service=${SERVICE}, account=${parsed.account});config ${configPath} 的 ${FIELD} 改为引用,无明文落盘。`,
  };
}

module.exports = { handleConfigSet, parseConfigSetArgs, KEY_MAP, SERVICE, FIELD };
