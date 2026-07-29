'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardPayload } = require('../dashboard_cache.cjs');

test('buildDashboardPayload:第 5 参 configHealth 挂到顶层', () => {
  const ch = { projects: [], totals: { claudeMdLines: 42, skillsFiles: 1, skillsLines: 9 }, status: 'ok', generatedAt: 1 };
  const p = buildDashboardPayload([], [], true, undefined, ch);
  assert.deepEqual(p.configHealth, ch);
});

test('buildDashboardPayload:不传 configHealth → 无该字段(向后兼容)', () => {
  const p = buildDashboardPayload([], [], true);
  assert.equal('configHealth' in p, false);
});

test('buildDashboardPayload:configHealth 与 autonomy 共存', () => {
  const auto = { s1: { commits: 1, rollbacks: 0, interventions: 0 } };
  const ch = { status: 'warn' };
  const p = buildDashboardPayload(
    [{ name: 's1', cwd: '/x', attached: false }],
    [{ name: 's1', status: 'working', lastLine: '', lastTs: 1 }],
    true, auto, ch
  );
  assert.equal(p.sessions[0].autonomy.commits, 1);
  assert.deepEqual(p.configHealth, ch);
});

test('buildDashboardPayload:configHealth 非对象 → 忽略(不挂)', () => {
  const p = buildDashboardPayload([], [], true, undefined, 'nope');
  assert.equal('configHealth' in p, false);
});
