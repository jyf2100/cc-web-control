#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// 子命令解析：接收已 slice 的用户参数（不含 node/脚本路径）
function parseSubcommand(args) {
  if (args[0] === 'hub') return { sub: 'hub', args: args.slice(1) };
  if (args[0] === 'config') return { sub: 'config', args: args.slice(1) };
  return { sub: 'default', args };
}

// `cc-web-control config set anthropic.api-key <KEY>`:写 OS keychain + config 改引用。
// 不依赖 tmux/claude,故在依赖检查前处理;退出码由 handleConfigSet 决定。
async function runConfigCli(args, argv) {
  const { handleConfigSet } = require(path.join(__dirname, '..', 'config_set.cjs'));
  const { createSecretStore } = require(path.join(__dirname, '..', 'secret_store.cjs'));
  const r = await handleConfigSet({
    args,
    argv,
    fsImpl: fs,
    store: createSecretStore(),
  });
  if (r.ok) {
    console.log(r.message);
    process.exit(r.exitCode);
  } else {
    console.error(r.message);
    if (r.error) console.error(JSON.stringify(r.error));
    process.exit(r.exitCode || 1);
  }
}

function main(existsFn = commandExists, argv = process.argv) {
  const { sub, args } = parseSubcommand(argv.slice(2));
  if (sub === 'hub') {
    require(path.join(__dirname, '..', 'hub', 'server_entry.cjs'));
    return;
  }
  if (sub === 'config') {
    void runConfigCli(args, argv);
    return;
  }
  const missing = findMissing(existsFn);
  if (missing.length) {
    console.error(formatMissing(missing));
    process.exit(1);
    return; // mock process.exit 时防止继续走到 startServer
  }
  startServer();
}

if (require.main === module) main(undefined, process.argv);

module.exports = { commandExists, findMissing, formatMissing, parseSubcommand, main, runConfigCli };
