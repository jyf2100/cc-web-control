'use strict';

const fs = require('node:fs');

const ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

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
  if (typeof token !== 'string' || !token) {
    throw new Error(`machine "${id}": 缺 token`);
  }
  return { id, name: typeof name === 'string' ? name : id, url, token };
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

module.exports = { validateMachine, loadMachines, ID_RE };
