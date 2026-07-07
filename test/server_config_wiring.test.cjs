const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs 顶部 require config_loader + loadConfig(SINGLE_SCHEMA)', () => {
  assert.match(src, /require\(['"]\.\/config_loader\.cjs['"]\)/);
  assert.match(src, /loadConfig\(\s*\{\s*schema:\s*SINGLE_SCHEMA/);
});

test('server.cjs 读 CFG.port / CFG.host / CFG.session(取代裸 env 默认)', () => {
  assert.match(src, /\bCFG\.port\b/);
  assert.match(src, /\bCFG\.host\b/);
  assert.match(src, /\bCFG\.session\b/);
  assert.doesNotMatch(src, /CC_WEB_PORT\s*\|\|\s*['"]?7684/);
});

test('server.cjs:AUTH_TOKEN / PROJECT_ROOTS / CLAUDE_CONTINUE 读 CFG.*', () => {
  assert.match(src, /\bCFG\.authToken\b/);
  assert.match(src, /\bCFG\.projectRoots\b/);
  assert.match(src, /\bCFG\.claudeContinue\b/);
});

test('server.cjs:NO_OPEN/NO_ATTACH/WEB_ONLY 保留 flag-OR(CFG.noXxx || hasFlag)', () => {
  assert.match(src, /CFG\.noOpen\s*\|\|\s*hasFlag\(['"]--no-open['"]\)/);
  assert.match(src, /CFG\.noAttach\s*\|\|\s*hasFlag\(['"]--no-attach['"]\)/);
  assert.match(src, /CFG\.webOnly\s*\|\|\s*hasFlag\(['"]--web-only['"]\)/);
});

test('server.cjs:CAPTURE_HISTORY 仍经 tmux.parseCaptureHistory(读 CFG.captureHistory)', () => {
  assert.match(src, /tmux\.parseCaptureHistory\(\s*CFG\.captureHistory\s*\)/);
});

test('server.cjs:loginRateLimiter 用 CFG.loginMax / CFG.loginWindowMs', () => {
  assert.match(src, /createRateLimiter\(\s*\{\s*max:\s*CFG\.loginMax,\s*windowMs:\s*CFG\.loginWindowMs/);
});

test('server.cjs:dashboard/wsPing interval 读 CFG.*', () => {
  assert.match(src, /\bCFG\.dashboardIntervalMs\b/);
  assert.match(src, /\bCFG\.wsPingInterval\b/);
});

test('server.cjs:config warnings 启动时打印(操作者可见权限/未知字段告警)', () => {
  assert.match(src, /cfgWarnings/);
  assert.match(src, /\[config\] 警告/);
});
