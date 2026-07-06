'use strict';
const { exec } = require('node:child_process');
const { startHub } = require('./server.cjs');
const { resolveMainAgentFromConfig } = require('./main_agent_env.cjs');
const { loadConfig, HUB_SCHEMA, HUB_CONFIG_PATH } = require('../config_loader.cjs');

// 配置文件(~/.cc-web-control/hub-config.json,--config 覆盖)+ env 覆盖(env > file > default)。
// 无文件 = 纯 env/默认 = 现状行为(向后兼容)。warnings:未知字段 / token 权限过松。
const { config: CFG, warnings: cfgWarnings } = loadConfig({
  schema: HUB_SCHEMA,
  defaultFilePath: HUB_CONFIG_PATH,
});
if (cfgWarnings.length) {
  console.error('[config] 警告:');
  for (const w of cfgWarnings) console.error(`  ⚠ ${w}`);
}

// mainAgent 环境桥接(spec §5.2 B2):config.mainAgent → 虚拟 env → 与真实 env 合并(env 优先)
const mainAgent = resolveMainAgentFromConfig(CFG.mainAgent, process.env);

// 对齐单机版:config.noOpen 或 --no-open 禁用 hub 启动后自动开浏览器
const NO_OPEN = CFG.noOpen || process.argv.includes('--no-open');

startHub({
  machinesFile: CFG.machinesFile,
  hubToken: CFG.hubToken,
  host: CFG.host,
  port: CFG.port,
  intervalMs: CFG.intervalMs,
  mainAgent,
  loginMax: CFG.loginMax,
  loginWindowMs: CFG.loginWindowMs,
  mainAgentMax: CFG.mainAgentMax,
  mainAgentWindowMs: CFG.mainAgentWindowMs,
}).then((hub) => {
  console.log(`[hub] listening on ${hub.host}:${hub.port} (machines: ${CFG.machinesFile})`);
  console.log(`[hub] 访问地址: ${hub.url}`);
  if (NO_OPEN) {
    console.log('[hub] 已禁用自动开浏览器(CC_WEB_HUB_NO_OPEN=1 / --no-open)');
    return;
  }
  // 延迟 1.5s 开浏览器:hub 刚起,aggregator 首轮聚合需 ~intervalMs,留点余量
  setTimeout(() => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${hub.url}`, () => {});
  }, 1500);
}).catch((e) => {
  console.error(`[hub] 启动失败: ${e.message}`);
  process.exit(1);
});
