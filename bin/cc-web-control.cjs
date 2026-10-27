#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
// 引擎元数据(命令名/安装提示):engine=codex 时依赖门改查 codex 而非 claude。
const { DEFAULT_ENGINE, engineCommand, engineInstallHint } = require('../engine.cjs');

const TMUX_DEP = { name: 'tmux', hint: 'macOS: brew install tmux  |  Ubuntu/Debian: sudo apt install tmux' };

// 依赖清单按引擎分发:tmux 恒需;agent CLI 按引擎取 claude(缺省)或 codex。
function depsForEngine(engine) {
  return [TMUX_DEP, { name: engineCommand(engine), hint: engineInstallHint(engine) }];
}

function commandExists(cmd) {
  if (!/^[a-zA-Z0-9._-]+$/.test(cmd)) return false;
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findMissing(existsFn, engine = DEFAULT_ENGINE) {
  return depsForEngine(engine).filter(d => !existsFn(d.name));
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

// 依赖门按引擎校验:engine 来自 config(env CC_WEB_ENGINE > file > default,与 server 同一
// loadConfig 口径)。此处只取 engine 字段;config 解析失败 → 缺省 claude(server 侧 load
// 会再抛完整错误,bin 不重复报)。未知/非法值已被 enum 分支降级为 claude,无需再兜。
function resolveEngine(argv = process.argv, env = process.env) {
  const { loadConfig, SINGLE_SCHEMA, SINGLE_CONFIG_PATH } = require('../config_loader.cjs');
  try {
    const { config } = loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: SINGLE_CONFIG_PATH, argv, env });
    return config.engine;
  } catch {
    return DEFAULT_ENGINE;
  }
}

function main(existsFn = commandExists, argv = process.argv, opts = {}) {
  const { sub, args } = parseSubcommand(argv.slice(2));
  if (sub === 'hub') {
    require(path.join(__dirname, '..', 'hub', 'server_entry.cjs'));
    return;
  }
  if (sub === 'config') {
    void runConfigCli(args, argv);
    return;
  }
  // opts.engine 供测试注入;缺省按 config 解析(与 server 侧同一份配置)。
  const engine = opts.engine !== undefined ? opts.engine : resolveEngine(argv);
  const missing = findMissing(existsFn, engine);
  if (missing.length) {
    console.error(formatMissing(missing));
    process.exit(1);
    return; // mock process.exit 时防止继续走到 startServer
  }
  startServer();
}

if (require.main === module) main(undefined, process.argv);

module.exports = { commandExists, findMissing, formatMissing, parseSubcommand, main, runConfigCli, depsForEngine, resolveEngine };
