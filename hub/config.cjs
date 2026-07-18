'use strict';

const fs = require('node:fs');

const ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

// hub 聚合的被控 CLI 工具枚举(会话分类/徽标/过滤用)。
// 新增工具时在此追加;unknown 为缺省回退(旧版 agent 不带 cli_tool 仍可注册,见 validateMachine)。
const CLI_TOOLS = ['claude-code', 'grok-build', 'codex', 'cursor', 'unknown'];

// 归一化 cli_tool:已知枚举原样返回;null/undefined/空串/非字符串/非枚举值 → 'unknown'。
// 用于:注册帧、静态 machines 文件、聚合后的会话徽标。非枚举值静默回退(不抛错,保证旧 agent 兼容)。
function normalizeCliTool(raw) {
  if (typeof raw !== 'string' || !CLI_TOOLS.includes(raw)) return 'unknown';
  return raw;
}

function validateMachine(raw, index = -1) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`machine${index >= 0 ? ` #${index}` : ''}: not an object`);
  }
  const { id, name, url, token } = raw;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`machine${index >= 0 ? ` #${index}` : ''}: id 非法(须匹配 ${ID_RE},禁止含 "/")`);
  }
  if (typeof url !== 'string' || !url) {
    throw new Error(`machine "${id}": 缺 url`);
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`machine "${id}": url 非法`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`machine "${id}": url 须 http/https`);
  }
  if (parsed.hostname === '169.254.169.254') {
    throw new Error(`machine "${id}": url 拒云元数据地址`);
  }
  if (typeof token !== 'string' || !token) {
    throw new Error(`machine "${id}": 缺 token`);
  }
  return { id, name: typeof name === 'string' ? name : id, url, token, cli_tool: normalizeCliTool(raw.cli_tool) };
}

function loadMachines(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`machines file not found: ${filePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`machines file JSON 解析失败: ${e.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.machines) ? parsed.machines : null);
  if (!list) {
    throw new Error('machines file 须为 { "machines": [...] } 或数组');
  }
  const seen = new Set();
  const machines = list.map((raw, i) => {
    const m = validateMachine(raw, i);
    if (seen.has(m.id)) throw new Error(`duplicate machine id: "${m.id}"`);
    seen.add(m.id);
    return m;
  });
  return machines;
}

module.exports = { validateMachine, loadMachines, ID_RE, CLI_TOOLS, normalizeCliTool };
