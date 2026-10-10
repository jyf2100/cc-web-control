'use strict';

// Claude Code mods/plugins 环境巡检(纯函数 + 依赖注入,测试不碰真实环境)。
//
// 背景:Claude Code 2.1.287 起引入 Mods —— 常驻进程内的 JS/TS 函数,以用户全权运行、无沙盒,
// 可读写文件/起进程/读环境变量,甚至替用户预先批准工具调用(headless `claude -p` 下同样执行)。
// 对本项目(浏览器 → WS → 本地 claude)意味着:Web 界面上「已批准」≠ 宿主机实际执行的内容。
// 本模块只做「存在状态 + 条目计数 + CC 版本」巡检;内容解析/静态审计是后续 PR 范围。
//
// 采集来源(以本机实测 CC 2.1.x 布局为准;mods 专属布局原文未给出精确路径,故多源探测):
//   1. <configDir>/plugins/installed_plugins.json  —— 权威已装插件清单(v2 格式 {plugins:{...}})
//   2. <configDir>/mods/                          —— mods 专属目录(存在即计条目)
//   3. <homeDir>/.claude.json 顶层 `mods` 字段     —— mods 运行态注册表(array/object 计数)
//   注:plugins/local/ 子目录是 installed_plugins.json 的子集,不计(防双重计数)。
//
// 降级约定(验收 5):任一来源「存在但读不出/解析失败」(EACCES、坏 JSON 等)→ 不静默吞错,
// 返回 mods_count: 0 + error 字段说明原因;ENOENT(不存在)视为正常缺席,不算错误。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile: execFileCb } = require('node:child_process');

// mods 风险判定下限版本:2.1.287 引入 Mods;低于此版本无 mods 能力,plugins 不构成该风险面。
const MODS_RISK_MIN_CC_VERSION = '2.1.287';

// 解析 CC 版本串:'2.1.287 (Claude Code)' / '2.1.287' → '2.1.287';无法解析 → null。
function parseCcVersion(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

// version >= min(x.y.z 数值逐段比较;任一不可解析 → false,宁可漏报不误报)。
function ccVersionAtLeast(version, min = MODS_RISK_MIN_CC_VERSION) {
  const a = parseCcVersion(version);
  const b = parseCcVersion(min);
  if (!a || !b) return false;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return true;
}

// claude 配置目录:CLAUDE_CONFIG_DIR(CC 官方支持)优先,默认 <home>/.claude。
function resolveClaudeConfigDir({ env = process.env, homeDir } = {}) {
  const custom = env ? env.CLAUDE_CONFIG_DIR : '';
  if (typeof custom === 'string' && custom.trim()) return custom;
  const home = homeDir || (env && env.HOME) || os.homedir();
  return path.join(home, '.claude');
}

// 读 JSON 文件的统一三态:'ok' | 'missing'(ENOENT,正常缺席)| 'error'(存在但读不出/解析失败)。
function readJsonFile(fsImpl, filePath) {
  let text;
  try {
    text = fsImpl.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e && (e.code === 'ENOENT' || /ENOENT/.test(String(e.message || '')))) return { status: 'missing' };
    return { status: 'error', error: `${filePath} 读取失败 ${e.code || e.message}` };
  }
  try {
    return { status: 'ok', value: JSON.parse(text) };
  } catch (e) {
    return { status: 'error', error: `${filePath} JSON 解析失败: ${e.message}` };
  }
}

// installed_plugins.json v2 → 已装插件条数:plugins 为 object 按 key 数、array 按长度;其余形状 → 0。
function countInstalledPlugins(value) {
  const plugins = value && typeof value === 'object' ? value.plugins : null;
  if (Array.isArray(plugins)) return plugins.length;
  if (plugins && typeof plugins === 'object') return Object.keys(plugins).length;
  return 0;
}

// mods 字段(array/object)→ 条数;其余形状 → 0。
function countModsField(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

// 目录条目数(跳过点文件);不存在 → missing;读不出 → error。
function countDirEntries(fsImpl, dirPath) {
  let entries;
  try {
    entries = fsImpl.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    if (e && (e.code === 'ENOENT' || /ENOENT/.test(String(e.message || '')))) return { status: 'missing' };
    return { status: 'error', error: `${dirPath} 读取失败 ${e.code || e.message}` };
  }
  return { status: 'ok', count: entries.filter((ent) => ent && ent.name && !ent.name.startsWith('.')).length };
}

/**
 * 巡检本机 mods/plugins 环境(同步;fs/env 注入,测试不碰真实 $HOME)。
 * @param {object} [opts]
 * @param {object} [opts.fsImpl] 默认 require('node:fs')
 * @param {object} [opts.env] 默认 process.env(读 CLAUDE_CONFIG_DIR/HOME)
 * @param {string} [opts.homeDir] 显式 home(默认从 env/os 推导;测试夹具用)
 * @param {string} [opts.ccVersion] 预探测的 CC 版本(默认 'unknown';spawn 探测见 detectClaudeVersion)
 * @returns {{cc_version:string, mods_count:number, source:string, error?:string}}
 */
function inspectModsEnv({ fsImpl = fs, env = process.env, homeDir, ccVersion = 'unknown' } = {}) {
  const configDir = resolveClaudeConfigDir({ env, homeDir });
  const home = homeDir || (env && env.HOME) || os.homedir();
  const sources = [];
  const errors = [];
  let count = 0;

  // 来源 1:已装插件清单(权威)
  const installed = readJsonFile(fsImpl, path.join(configDir, 'plugins', 'installed_plugins.json'));
  if (installed.status === 'ok') {
    const n = countInstalledPlugins(installed.value);
    count += n;
    sources.push(`installed_plugins.json:${n}`);
  } else if (installed.status === 'missing') {
    sources.push('installed_plugins.json:absent');
  } else {
    errors.push(installed.error);
  }

  // 来源 2:mods 专属目录
  const modsDir = countDirEntries(fsImpl, path.join(configDir, 'mods'));
  if (modsDir.status === 'ok') {
    count += modsDir.count;
    sources.push(`mods-dir:${modsDir.count}`);
  } else if (modsDir.status === 'missing') {
    sources.push('mods-dir:absent');
  } else {
    errors.push(modsDir.error);
  }

  // 来源 3:状态文件顶层 mods 字段(CLAUDE_CONFIG_DIR 覆盖时对应 <configDir>.json,与 CC 行为一致)
  const stateJson = readJsonFile(fsImpl, `${configDir}.json`);
  if (stateJson.status === 'ok') {
    if (stateJson.value && typeof stateJson.value === 'object' && 'mods' in stateJson.value) {
      const n = countModsField(stateJson.value.mods);
      count += n;
      sources.push(`state-json#mods:${n}`);
    } else {
      sources.push('state-json#mods:absent');
    }
  } else if (stateJson.status === 'missing') {
    sources.push('state-json#mods:absent');
  } else {
    errors.push(stateJson.error);
  }

  const out = {
    cc_version: typeof ccVersion === 'string' && ccVersion ? ccVersion : 'unknown',
    mods_count: errors.length ? 0 : count, // 任一来源读失败 → 计数不可信,降级 0 并带 error(验收 5)
    source: sources.join(' + '),
  };
  if (errors.length) out.error = errors.join('; ');
  return out;
}

/**
 * 探测本机 claude CLI 版本(`claude --version`,输出形如 '2.1.287 (Claude Code)')。
 * execFile 可注入;任何失败(未安装/超时/输出不解析)→ 'unknown',绝不 reject。
 * spawn 有成本,调用方(server.cjs)应缓存结果。
 */
function detectClaudeVersion({ execFile = execFileCb, bin = 'claude', timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      execFile(bin, ['--version'], { timeout: timeoutMs }, (err, stdout) => {
        if (err) return done('unknown');
        done(parseCcVersion(String(stdout || '')) || 'unknown');
      });
    } catch {
      done('unknown');
    }
  });
}

// 状态机:巡检异常 > mods 风险 > (mods>0 且版本未知) > 正常。
// state 由本模块统一计算(单机自评 / hub 复评同源),前端只渲染不判定。
function classifyModsStatus({ hasError, count, versionOk, versionKnown }) {
  if (hasError) return 'error';
  if (count > 0 && versionOk) return 'risk';
  if (count > 0 && !versionKnown) return 'unknown'; // 有 mods 但 CC 版本探测不出,无法排除风险
  return 'ok'; // 空 mods,或版本已知且 < 2.1.287(mods 能力不存在)
}

/**
 * 对巡检结果补齐风险判定(risk/state/risk_reason)。输入不合法 → null。
 * 幂等:对已 evaluate 过的对象重复调用结果一致(状态字段重算覆盖)。
 */
function evaluateModsStatus(status) {
  if (!status || typeof status !== 'object') return null;
  const count = Number.isFinite(status.mods_count) ? Math.max(0, Math.floor(status.mods_count)) : 0;
  const hasError = typeof status.error === 'string' && status.error.length > 0;
  const version = typeof status.cc_version === 'string' && status.cc_version ? status.cc_version : 'unknown';
  const versionKnown = !!parseCcVersion(version);
  const versionOk = versionKnown && ccVersionAtLeast(version);
  const state = classifyModsStatus({ hasError, count, versionOk, versionKnown });
  const out = {
    cc_version: version,
    mods_count: count,
    source: typeof status.source === 'string' ? status.source : '',
    risk: state === 'risk',
    state,
  };
  if (hasError) out.error = status.error;
  if (state === 'risk') {
    out.risk_reason = `mods_count=${count} 且 CC ${version} ≥ ${MODS_RISK_MIN_CC_VERSION}(Mods 常驻进程内、无沙盒)`;
  }
  if (typeof status.checked_at === 'number' && Number.isFinite(status.checked_at)) out.checked_at = status.checked_at;
  return out;
}

/**
 * hub 侧清洗单机上报的 mods 状态(不可信输入 → 白名单字段 + 长度/范围钳制,再重算 risk/state)。
 * 非对象 / mods_count 非法 → null(视为未上报,不覆盖已有状态)。
 */
function sanitizeModsStatus(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const count = typeof raw.mods_count === 'number' && Number.isFinite(raw.mods_count) ? Math.floor(raw.mods_count) : NaN;
  if (!(count >= 0 && count <= 1_000_000)) return null;
  const clampStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const out = {
    cc_version: clampStr(raw.cc_version, 64) || 'unknown',
    mods_count: count,
    source: clampStr(raw.source, 512),
  };
  const err = clampStr(raw.error, 512);
  if (err) out.error = err;
  if (typeof raw.checked_at === 'number' && Number.isFinite(raw.checked_at)) out.checked_at = raw.checked_at;
  return evaluateModsStatus(out);
}

module.exports = {
  MODS_RISK_MIN_CC_VERSION,
  parseCcVersion,
  ccVersionAtLeast,
  resolveClaudeConfigDir,
  inspectModsEnv,
  detectClaudeVersion,
  evaluateModsStatus,
  sanitizeModsStatus,
};
