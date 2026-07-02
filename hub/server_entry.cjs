'use strict';
const os = require('node:os');
const path = require('node:path');
const { startHub } = require('./server.cjs');

const machinesFile = process.env.CC_WEB_HUB_MACHINES_FILE ||
  path.join(os.homedir(), '.cc-web-control', 'hub-machines.json');
const hubToken = process.env.CC_WEB_HUB_TOKEN;

startHub({
  machinesFile,
  hubToken,
  host: process.env.CC_WEB_HUB_HOST,
  port: process.env.CC_WEB_HUB_PORT && Number(process.env.CC_WEB_HUB_PORT),
  intervalMs: process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS && Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS),
}).then((hub) => {
  console.log(`[hub] listening on 127.0.0.1:${hub.port} (machines: ${machinesFile})`);
}).catch((e) => {
  console.error(`[hub] 启动失败: ${e.message}`);
  process.exit(1);
});
