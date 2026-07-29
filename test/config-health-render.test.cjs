'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BR = require('../public/board_render.cjs');

function machine(id, status, totals) {
  return {
    id, name: id.toUpperCase(), online: true, sessions: [],
    configHealth: { status, totals: totals || { claudeMdLines: 0, skillsFiles: 0, skillsLines: 0 }, projects: [], generatedAt: 1 },
  };
}

test('flattenConfigHealth:每个已注册机器各一行(AC1)', () => {
  const rows = BR.flattenConfigHealth([
    machine('mc1', 'ok', { claudeMdLines: 40, skillsFiles: 1, skillsLines: 9 }),
    machine('mc2', 'warn', { claudeMdLines: 100, skillsFiles: 2, skillsLines: 20 }),
    machine('mc3', 'over', { claudeMdLines: 400, skillsFiles: 0, skillsLines: 0 }),
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.machineId), ['mc1', 'mc2', 'mc3']);
  assert.equal(rows[0].claudeMdLines, 40);
  assert.equal(rows[1].status, 'warn');
});

test('flattenConfigHealth:无 configHealth 的机器 → unreported(向后兼容)', () => {
  const rows = BR.flattenConfigHealth([{ id: 'mc1', name: 'A', online: true, sessions: [] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'unreported');
  assert.equal(rows[0].claudeMdLines, null);
});

test('renderConfigHealthRow:阈值三态标记(AC2)', () => {
  const okHtml = BR.renderConfigHealthRow({ machineId: 'a', machineName: 'A', status: 'ok', claudeMdLines: 40, skillsFiles: 0, skillsLines: 0 });
  assert.ok(okHtml.includes('40'), 'ok 显示行数');
  assert.ok(!/ch-badge/.test(okHtml), '≤60 不展示告警标记');

  const warnHtml = BR.renderConfigHealthRow({ machineId: 'a', machineName: 'A', status: 'warn', claudeMdLines: 100, skillsFiles: 0, skillsLines: 0 });
  assert.ok(warnHtml.includes('ch-badge--warn'), '>60 展示建议精简');
  assert.ok(warnHtml.includes('建议精简'));

  const overHtml = BR.renderConfigHealthRow({ machineId: 'a', machineName: 'A', status: 'over', claudeMdLines: 400, skillsFiles: 0, skillsLines: 0 });
  assert.ok(overHtml.includes('ch-badge--over'), '>300 展示超限');
  assert.ok(overHtml.includes('超限'));
});

test('renderConfigHealthRow:不可读 → 无法读取(AC6)', () => {
  const html = BR.renderConfigHealthRow({ machineId: 'a', machineName: 'A', status: 'unreadable', claudeMdLines: null, skillsFiles: 0, skillsLines: 0 });
  assert.ok(html.includes('无法读取'));
  assert.ok(html.includes('ch-lines--unreadable'));
});

test('renderConfigHealthRow:每行含 /doctor 触发按钮 + data-machine(AC4)', () => {
  const html = BR.renderConfigHealthRow({ machineId: 'mc9', machineName: 'M9', status: 'ok', claudeMdLines: 5, skillsFiles: 0, skillsLines: 0 });
  assert.ok(/data-act="doctor"/.test(html), '含 doctor 按钮');
  assert.ok(/data-machine="mc9"/.test(html), '按钮带 data-machine');
  assert.ok(/触发 \/doctor 分析/.test(html));
});

test('renderConfigHealthSection:行数 == 机器数;含表头字段(AC1)', () => {
  const html = BR.renderConfigHealthSection([
    machine('mc1', 'ok', { claudeMdLines: 40, skillsFiles: 1, skillsLines: 9 }),
    machine('mc2', 'warn', { claudeMdLines: 100, skillsFiles: 2, skillsLines: 20 }),
    machine('mc3', 'over', { claudeMdLines: 400, skillsFiles: 0, skillsLines: 0 }),
  ]);
  const rowCount = (html.match(/<tr class="ch-row/g) || []).length;
  assert.equal(rowCount, 3, '每个机器一行');
  assert.ok(html.includes('CLAUDE.md 行数'));
  assert.ok(html.includes('Skills 文件数'));
  assert.ok(html.includes('Skills 累计行数'));
});

test('renderConfigHealthSection:无机器 → 空态(不崩溃)', () => {
  const html = BR.renderConfigHealthSection([]);
  assert.ok(html.includes('NO DATA') || html.includes('config-health-empty'));
});

test('renderConfigHealthSection:机器名转义防注入', () => {
  const html = BR.renderConfigHealthSection([{ id: 'a', name: '<script>', online: true, sessions: [], configHealth: { status: 'ok', totals: { claudeMdLines: 1 } } }]);
  assert.ok(!html.includes('<script>'), '尖括号被转义');
  assert.ok(html.includes('&lt;script&gt;'));
});
