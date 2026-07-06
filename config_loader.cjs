// config_loader.cjs — 7684/7685 共享:JSON 配置文件加载 + env 覆盖 + 校验 + 权限告警
// 范式照搬 hub/config.cjs 的 loadMachines(JSON.parse 容错 + 校验),由 schema 驱动逐字段解析为生效值。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_DIR = path.join(os.homedir(), '.cc-web-control');
const SINGLE_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const HUB_CONFIG_PATH = path.join(CONFIG_DIR, 'hub-config.json');

// --config <path> 或 --config=<path>;返回路径或 undefined;畸形 → throw(防静默用错文件)
function parseConfigFlag(argv) {
  const i = argv.indexOf('--config');
  if (i >= 0) {
    if (i + 1 >= argv.length) throw new Error('--config 须跟一个路径参数(如 --config /path/x.json)');
    return argv[i + 1];
  }
  for (const a of argv) {
    if (a.startsWith('--config=')) {
      const v = a.slice('--config='.length);
      if (!v) throw new Error('--config= 不能为空(如 --config=/path/x.json)');
      return v;
    }
  }
  return undefined;
}

function throwBad(field, msg) {
  throw new Error(`config 字段 "${field}" ${msg}`);
}

// 单字段解析:按 spec.type 强转 + 校验,返回最终值。source='env'|'file'|'default'
function resolveField(field, spec, raw, source) {
  switch (spec.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throwBad(field, `须为数字,实际 ${JSON.stringify(raw)}`);
      if (spec.min != null && n < spec.min) throwBad(field, `须 >= ${spec.min},实际 ${n}`);
      if (spec.max != null && n > spec.max) throwBad(field, `须 <= ${spec.max},实际 ${n}`);
      return n;
    }
    case 'string': {
      const s = raw == null ? '' : String(raw);
      if (spec.nonEmpty && !s) throwBad(field, '不可为空');
      return s;
    }
    case 'port': {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throwBad(field, `须为整数 1-65535,实际 ${JSON.stringify(raw)}`);
      }
      return n;
    }
    case 'session': {
      const s = raw == null ? '' : String(raw);
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) {
        throwBad(field, `须匹配 /^[A-Za-z0-9._-]{1,64}$/`);
      }
      return s;
    }
    case 'array': {
      let rawArr;
      if (source === 'env') {
        rawArr = String(raw).split(',');
      } else if (Array.isArray(raw)) {
        rawArr = raw;
      } else {
        throwBad(field, `须为数组,实际 ${JSON.stringify(raw)}`);
      }
      const arr = [];
      for (let i = 0; i < rawArr.length; i++) {
        const el = rawArr[i];
        if (typeof el !== 'string') {
          throwBad(field, `元素 #${i} 须为 string,实际 ${JSON.stringify(el)}`);
        }
        const trimmed = el.trim();
        if (trimmed) arr.push(trimmed);
      }
      return arr;
    }
    case 'bool':
      // env '1'→true(对齐现有 === '1' 口径);file 须为字面 boolean(防引号 footgun)
      if (source === 'env') return raw === '1';
      if (typeof raw !== 'boolean') throwBad(field, 'bool 须为 true/false(文件值勿加引号)');
      return raw;
    default:
      throwBad(field, `未知 schema type "${spec.type}"(Task 2-5 补齐 port/session/array/object)`);
  }
}

function loadConfig({ schema, defaultFilePath, argv = process.argv, env = process.env, fsImpl = fs }) {
  const filePath = parseConfigFlag(argv) || defaultFilePath;
  const warnings = [];
  let fileValues = {};

  if (fsImpl.existsSync(filePath)) {
    let text;
    try {
      text = fsImpl.readFileSync(filePath, 'utf8');
    } catch (e) {
      throw new Error(`config 文件读取失败 ${filePath}: ${e.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`config JSON 解析失败 ${filePath}: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const got = Array.isArray(parsed) ? 'array' : (parsed === null ? 'null' : typeof parsed);
      throw new Error(`config 须为 JSON 对象(实际 ${got}): ${filePath}`);
    }
    fileValues = parsed;

    // 未知字段 → warning(帮发现拼写错误,如 authoken)
    for (const k of Object.keys(fileValues)) {
      if (!Object.prototype.hasOwnProperty.call(schema, k)) {
        warnings.push(`未知字段 "${k}"(已忽略,请检查拼写)`);
      }
    }

    // 权限告警:含 token 类字段值且 group/other 可读 → warning(不阻断,不回显 token)
    const hasToken = Object.keys(schema).some(
      (f) => /token/i.test(f) && fileValues[f]
    );
    if (hasToken) {
      try {
        const mode = fsImpl.statSync(filePath).mode;
        if (process.platform !== 'win32' && (mode & 0o077)) {
          warnings.push(`config 文件权限过松(mode 0o${(mode & 0o777).toString(8)} 含 group/other 读)且含 token,建议 chmod 600 ${filePath}`);
        }
      } catch { /* stat 失败不阻断启动 */ }
    }
  }

  // 逐字段:env ?? file ?? default
  const config = {};
  for (const [field, spec] of Object.entries(schema)) {
    let raw, source;
    if (spec.env && env[spec.env] !== undefined) { raw = env[spec.env]; source = 'env'; }
    else if (Object.prototype.hasOwnProperty.call(fileValues, field)) { raw = fileValues[field]; source = 'file'; }
    else { raw = spec.default; source = 'default'; }
    config[field] = resolveField(field, spec, raw, source);
  }

  return { config, warnings, filePath };
}

module.exports = { loadConfig, parseConfigFlag, SINGLE_CONFIG_PATH, HUB_CONFIG_PATH, CONFIG_DIR };
