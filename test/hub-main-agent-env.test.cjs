'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveMainAgentConfig } = require('../hub/main_agent_env.cjs');

test('默认关闭(enabled=false),可选项均 undefined', () => {
  const cfg = resolveMainAgentConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.session, undefined);
  assert.equal(cfg.claudePath, undefined);
  assert.equal(cfg.dataDir, undefined);
  assert.equal(cfg.auditFile, undefined);
});

test('enabled=1 触发,可选项透传', () => {
  const cfg = resolveMainAgentConfig({
    CC_WEB_HUB_MAIN_AGENT_ENABLED: '1',
    CC_WEB_HUB_MAIN_AGENT_SESSION: 'my-agent',
    CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH: '/usr/local/bin/claude',
    CC_WEB_HUB_MAIN_AGENT_DATA_DIR: '/tmp/ma',
    CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE: '/tmp/ma/audit.jsonl',
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.session, 'my-agent');
  assert.equal(cfg.claudePath, '/usr/local/bin/claude');
  assert.equal(cfg.dataDir, '/tmp/ma');
  assert.equal(cfg.auditFile, '/tmp/ma/audit.jsonl');
});

test('enabled 非 "1"(如 "0"/"true"/"")→ 关闭', () => {
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_ENABLED: '0' }).enabled, false);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_ENABLED: 'true' }).enabled, false);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_ENABLED: '' }).enabled, false);
});
