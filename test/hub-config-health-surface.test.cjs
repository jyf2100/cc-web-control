'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeDashboards } = require('../hub/dashboard_aggregator.cjs');

// 单机 /api/dashboard payload.configHealth → hub 聚合后透传到 machine.configHealth(供「配置健康」分区)。

test('mergeDashboards:payload.configHealth 透传到 machine', () => {
  const ch = { projects: [{ name: 'p', claudeMdLines: 42, claudeMdReadable: true, skillsFiles: 1, skillsLines: 9, skillsReadable: true }], totals: { claudeMdLines: 42, skillsFiles: 1, skillsLines: 9 }, status: 'ok', generatedAt: 1 };
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true, payload: { tmuxOk: true, sessions: [], configHealth: ch } },
  ]);
  assert.deepEqual(merged.machines[0].configHealth, ch);
});

test('mergeDashboards:无 configHealth → 不挂该字段(向后兼容)', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true, payload: { tmuxOk: true, sessions: [] } },
  ]);
  assert.equal('configHealth' in merged.machines[0], false);
});

test('mergeDashboards:离线机不挂 configHealth(payload 不消费)', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: false, error: 'x' },
  ]);
  assert.equal('configHealth' in merged.machines[0], false);
});

test('mergeDashboards:多机各自 configHealth 独立透传', () => {
  const merged = mergeDashboards([
    { machine: { id: 'mc1', name: 'A' }, online: true, payload: { tmuxOk: true, sessions: [], configHealth: { status: 'ok', totals: { claudeMdLines: 10 } } } },
    { machine: { id: 'mc2', name: 'B' }, online: true, payload: { tmuxOk: true, sessions: [], configHealth: { status: 'over', totals: { claudeMdLines: 400 } } } },
  ]);
  assert.equal(merged.machines[0].configHealth.status, 'ok');
  assert.equal(merged.machines[1].configHealth.status, 'over');
});
