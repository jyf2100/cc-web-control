'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'hub', 'server_entry.cjs'), 'utf8');

test('server_entry.cjs 顶部 require config_loader + 解构 loadConfig/HUB_SCHEMA/HUB_CONFIG_PATH', () => {
  assert.match(src, /require\(['"]\.\.\/config_loader\.cjs['"]\)/);
  assert.match(src, /\bloadConfig\b/);
  assert.match(src, /\bHUB_SCHEMA\b/);
  assert.match(src, /\bHUB_CONFIG_PATH\b/);
});

test('server_entry.cjs:loadConfig({ schema: HUB_SCHEMA, defaultFilePath: HUB_CONFIG_PATH })', () => {
  assert.match(src, /loadConfig\(\s*\{\s*schema:\s*HUB_SCHEMA/);
  assert.match(src, /defaultFilePath:\s*HUB_CONFIG_PATH/);
});

test('server_entry.cjs:cfgWarnings 启动时打印([config] 警告)', () => {
  assert.match(src, /cfgWarnings/);
  assert.match(src, /\[config\] 警告/);
});

test('server_entry.cjs:mainAgent 经 resolveMainAgentFromConfig(CFG.mainAgent, process.env) 桥接', () => {
  assert.match(src, /resolveMainAgentFromConfig\(\s*CFG\.mainAgent/);
  assert.match(src, /require\(['"]\.\/main_agent_env\.cjs['"]\)/);
});

test('server_entry.cjs:startHub 入参读 CFG.*(machinesFile/hubToken/host/port/intervalMs)', () => {
  assert.match(src, /machinesFile:\s*CFG\.machinesFile/);
  assert.match(src, /hubToken:\s*CFG\.hubToken/);
  assert.match(src, /host:\s*CFG\.host/);
  assert.match(src, /port:\s*CFG\.port/);
  assert.match(src, /intervalMs:\s*CFG\.intervalMs/);
});

test('server_entry.cjs:startHub 透传 4 限流 opts(loginMax/loginWindowMs/mainAgentMax/mainAgentWindowMs)', () => {
  assert.match(src, /loginMax:\s*CFG\.loginMax/);
  assert.match(src, /loginWindowMs:\s*CFG\.loginWindowMs/);
  assert.match(src, /mainAgentMax:\s*CFG\.mainAgentMax/);
  assert.match(src, /mainAgentWindowMs:\s*CFG\.mainAgentWindowMs/);
});

test('server_entry.cjs:NO_OPEN = CFG.noOpen || process.argv.includes(--no-open)', () => {
  assert.match(src, /NO_OPEN\s*=\s*CFG\.noOpen\s*\|\|\s*process\.argv\.includes\(['"]--no-open['"]\)/);
});

test('server_entry.cjs:不再直读 process.env.CC_WEB_HUB_*(已由 CFG.* 取代)', () => {
  assert.doesNotMatch(src, /process\.env\.CC_WEB_HUB_MACHINES_FILE/);
  assert.doesNotMatch(src, /process\.env\.CC_WEB_HUB_HOST/);
  assert.doesNotMatch(src, /process\.env\.CC_WEB_HUB_PORT/);
  assert.doesNotMatch(src, /process\.env\.CC_WEB_HUB_DASHBOARD_INTERVAL_MS/);
  assert.doesNotMatch(src, /process\.env\.CC_WEB_HUB_TOKEN/);
  // CC_WEB_HUB_NO_OPEN 已由 CFG.noOpen 取代(原 === '1' 直读应消失)
  assert.doesNotMatch(src, /process\.env\.CC_WEB_HUB_NO_OPEN/);
});
