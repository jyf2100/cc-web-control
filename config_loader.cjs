// config_loader.cjs — 7684/7685 共享:JSON 配置文件加载 + env 覆盖 + 校验 + 权限告警
// 范式照搬 hub/config.cjs 的 loadMachines(JSON.parse 容错 + 校验),由 schema 驱动逐字段解析为生效值。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_DIR = path.join(os.homedir(), '.cc-web-control');
const SINGLE_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const HUB_CONFIG_PATH = path.join(CONFIG_DIR, 'hub-config.json');

// --config <path> 或 --config=<path>;返回路径或 undefined
function parseConfigFlag(argv) {
  const i = argv.indexOf('--config');
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  for (const a of argv) {
    if (a.startsWith('--config=')) return a.slice('--config='.length);
  }
  return undefined;
}

function throwBad(field, msg) {
  throw new Error(`config 字段 "${field}" ${msg}`);
}

// bool:env '1'→true(对齐现有 === '1' 口径);file true→true
function toBool(raw, source) {
  if (source === 'env') return raw === '1';
  return raw === true;
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
    case 'bool':
      return toBool(raw, source);
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
      throw new Error(`config 须为 JSON 对象: ${filePath}`);
    }
    fileValues = parsed;
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
