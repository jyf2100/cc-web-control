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

// ---- 数值字段 >0 clamp(settleMs / maxSettleMs / backoffBase / staleBump)----
// 语义:非法 / ≤0 / NaN / 未设 → 回退该字段默认值,不阻断启动(mainAgent 容错优先)

test('settleMs:非法/≤0/NaN/未设 → 60000;正常正数 → 采用', () => {
  // 未设
  assert.equal(resolveMainAgentConfig({}).settleMs, 60_000);
  // 非法(非数字字符串)
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_SETTLE_MS: 'abc' }).settleMs, 60_000);
  // 零
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_SETTLE_MS: '0' }).settleMs, 60_000);
  // 负数
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_SETTLE_MS: '-5' }).settleMs, 60_000);
  // 正常正数
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_SETTLE_MS: '30000' }).settleMs, 30_000);
});

test('maxSettleMs:非法/≤0/NaN/未设 → 900000;正常正数 → 采用', () => {
  assert.equal(resolveMainAgentConfig({}).maxSettleMs, 900_000);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS: 'abc' }).maxSettleMs, 900_000);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS: '0' }).maxSettleMs, 900_000);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS: '-5' }).maxSettleMs, 900_000);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS: '120000' }).maxSettleMs, 120_000);
});

test('backoffBase:非法/≤0/NaN/未设 → 2;正常正数 → 采用', () => {
  assert.equal(resolveMainAgentConfig({}).backoffBase, 2);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE: 'abc' }).backoffBase, 2);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE: '0' }).backoffBase, 2);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE: '-5' }).backoffBase, 2);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE: '5' }).backoffBase, 5);
});

test('staleBump:非法/≤0/NaN/未设 → 1;正常正数 → 采用', () => {
  assert.equal(resolveMainAgentConfig({}).staleBump, 1);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_STALE_BUMP: 'abc' }).staleBump, 1);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_STALE_BUMP: '0' }).staleBump, 1);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_STALE_BUMP: '-5' }).staleBump, 1);
  assert.equal(resolveMainAgentConfig({ CC_WEB_HUB_MAIN_AGENT_STALE_BUMP: '3' }).staleBump, 3);
});

test('全空 env:4 数值字段均为各自默认(回归保护)', () => {
  const cfg = resolveMainAgentConfig({});
  assert.equal(cfg.settleMs, 60_000);
  assert.equal(cfg.maxSettleMs, 900_000);
  assert.equal(cfg.backoffBase, 2);
  assert.equal(cfg.staleBump, 1);
});
