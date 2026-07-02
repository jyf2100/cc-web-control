'use strict';
const os = require('node:os');
const path = require('node:path');
const { exec } = require('node:child_process');
const { startHub } = require('./server.cjs');
const { resolveMainAgentConfig } = require('./main_agent_env.cjs');

const machinesFile = process.env.CC_WEB_HUB_MACHINES_FILE ||
  path.join(os.homedir(), '.cc-web-control', 'hub-machines.json');
const hubToken = process.env.CC_WEB_HUB_TOKEN;

// 对齐单机版 CC_WEB_NO_OPEN:设 1 或传 --no-open 禁用 hub 启动后自动开浏览器
const NO_OPEN = process.env.CC_WEB_HUB_NO_OPEN === '1' || process.argv.includes('--no-open');

startHub({
  machinesFile,
  hubToken,
  host: process.env.CC_WEB_HUB_HOST,
  port: process.env.CC_WEB_HUB_PORT && Number(process.env.CC_WEB_HUB_PORT),
  intervalMs: process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS && Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS),
  mainAgent: resolveMainAgentConfig(process.env),
}).then((hub) => {
  console.log(`[hub] listening on ${hub.host}:${hub.port} (machines: ${machinesFile})`);
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
