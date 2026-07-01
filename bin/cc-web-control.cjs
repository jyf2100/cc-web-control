#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const DEPS = [
  { name: 'tmux', hint: 'macOS: brew install tmux  |  Ubuntu/Debian: sudo apt install tmux' },
  { name: 'claude', hint: '安装 Claude Code CLI 并完成 Claude 登录认证（https://claude.com/claude-code）' },
];

function commandExists(cmd) {
  if (!/^[a-zA-Z0-9._-]+$/.test(cmd)) return false;
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findMissing(existsFn) {
  return DEPS.filter(d => !existsFn(d.name));
}

function formatMissing(missing) {
  const lines = ['cc-web-control: 缺少必需依赖，请先安装：'];
  for (const m of missing) lines.push(`  ✗ ${m.name} — ${m.hint}`);
  lines.push('');
  return lines.join('\n');
}

function startServer() {
  require(path.join(__dirname, '..', 'server.cjs'));
}

function main(existsFn = commandExists) {
  const missing = findMissing(existsFn);
  if (missing.length) {
    console.error(formatMissing(missing));
    process.exit(1);
    return; // mock process.exit 时防止继续走到 startServer
  }
  startServer();
}

if (require.main === module) main();

module.exports = { commandExists, findMissing, formatMissing, main };
