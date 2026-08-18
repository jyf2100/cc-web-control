'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const TV = require('../public/trajectories_view.cjs');

// ---- formatSize ----
test('formatSize B/KB/MB/GB 人类可读', () => {
  assert.equal(TV.formatSize(0), '0 B');
  assert.equal(TV.formatSize(512), '512 B');
  assert.equal(TV.formatSize(1024), '1.0 KB');
  assert.equal(TV.formatSize(1234), '1.2 KB');
  assert.equal(TV.formatSize(1048576), '1.0 MB');
  assert.equal(TV.formatSize(1572864), '1.5 MB');
  assert.equal(TV.formatSize(1073741824), '1.0 GB');
  assert.equal(TV.formatSize(5 * 1073741824), '5.0 GB');
});
test('formatSize 非法/负数兜底 0 B', () => {
  assert.equal(TV.formatSize(null), '0 B');
  assert.equal(TV.formatSize(undefined), '0 B');
  assert.equal(TV.formatSize(-5), '0 B');
  assert.equal(TV.formatSize(NaN), '0 B');
});

// ---- escapeHtml ----
test('escapeHtml 中和 <>&"', () => {
  assert.equal(TV.escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(TV.escapeHtml('a&b'), 'a&amp;b');
  assert.equal(TV.escapeHtml('a>b'), 'a&gt;b');
  assert.equal(TV.escapeHtml('a"b'), 'a&quot;b');
  assert.equal(TV.escapeHtml(null), '');
  assert.equal(TV.escapeHtml(undefined), '');
});

// ---- flattenTrajectories ----
const FIXTURE = {
  total: 5,
  machines: [
    { id: 'mc1', name: 'M1', online: true, count: 2, skipped: 0, trajectories: [
      { sessionId: 'u1', path: '/a/u1.jsonl', size: 1234, mtime: Date.UTC(2026, 7, 19, 6, 30), messages: 42, firstUserSummary: '帮我修个 bug', oversize: false, machine: 'mc1' },
      { sessionId: 'u2', path: '/a/u2.jsonl', size: 9000000, mtime: Date.UTC(2026, 7, 19, 23, 59), messages: null, firstUserSummary: null, oversize: true, machine: 'mc1' },
    ] },
    { id: 'mc2', name: 'M2', online: true, count: 1, skipped: 0, trajectories: [
      { sessionId: 'u3', path: '/b/u3.jsonl', size: 2048, mtime: Date.UTC(2026, 7, 20, 0, 0), messages: 3, firstUserSummary: '<x>&"注入', oversize: false, machine: 'mc2' },
    ] },
    { id: 'mc3', name: 'M3', online: false, count: 0, skipped: 0, trajectories: [] },
  ],
};
test('flattenTrajectories:两在线机拍平 + 离线机不产出 + machineName 回填', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  assert.equal(flat.length, 3);
  assert.equal(flat[0].machine, 'mc1');
  assert.equal(flat[0].machineName, 'M1');   // machineName 回填
  assert.equal(flat[1].machineName, 'M1');
  assert.equal(flat[2].machine, 'mc2');
  assert.equal(flat[2].machineName, 'M2');
  assert.ok(flat.every((t) => t.machine !== 'mc3'), '离线机 mc3 不产出');
  assert.ok(flat.every((t) => t.machineName === 'M1' || t.machineName === 'M2'));
});
test('flattenTrajectories:machine 字段缺失时以所属机 id 兜底', () => {
  const flat = TV.flattenTrajectories({ machines: [
    { id: 'mx', name: 'MX', online: true, trajectories: [{ sessionId: 's', path: '/p', size: 1, mtime: 1 }] },
  ] });
  assert.equal(flat[0].machine, 'mx');
  assert.equal(flat[0].machineName, 'MX');
});
test('flattenTrajectories:null/空 machines 兜底空数组', () => {
  assert.deepEqual(TV.flattenTrajectories(null), []);
  assert.deepEqual(TV.flattenTrajectories({ machines: [] }), []);
});

// ---- filterTrajectories:机器精确匹配 ----
test('filterTrajectories:machine 精确匹配 t.machine', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  const only1 = TV.filterTrajectories(flat, { machine: 'mc1' });
  assert.equal(only1.length, 2);
  assert.ok(only1.every((t) => t.machine === 'mc1'));
  const only2 = TV.filterTrajectories(flat, { machine: 'mc2' });
  assert.equal(only2.length, 1);
  assert.equal(only2[0].sessionId, 'u3');
  // 前缀不算匹配(精确)
  assert.equal(TV.filterTrajectories(flat, { machine: 'mc' }).length, 0);
  // 空 machine → 不过滤(全量)
  assert.equal(TV.filterTrajectories(flat, { machine: '' }).length, 3);
  assert.equal(TV.filterTrajectories(flat, {}).length, 3);
});

// ---- filterTrajectories:date 边界(UTC 日,含起点不含次日起点)----
test('filterTrajectories:date=UTC 00:00:00.000 恰在起点 → 含', () => {
  const flat = [
    { machine: 'a', mtime: Date.UTC(2026, 7, 19, 0, 0, 0, 0) },
  ];
  const out = TV.filterTrajectories(flat, { date: '2026-08-19' });
  assert.equal(out.length, 1);
});
test('filterTrajectories:date=次日 00:00:00.000 → 不含(左闭右开)', () => {
  const flat = [
    { machine: 'a', mtime: Date.UTC(2026, 7, 20, 0, 0, 0, 0) },
  ];
  const out = TV.filterTrajectories(flat, { date: '2026-08-19' });
  assert.equal(out.length, 0);
});
test('filterTrajectories:date 日内含 / 前一日不含 / 恰在末尾前一毫秒含', () => {
  const day = '2026-08-19';
  const inDay = TV.filterTrajectories(TV.flattenTrajectories(FIXTURE), { date: day });
  assert.equal(inDay.length, 2);   // u1(08-19 06:30)+ u2(08-19 23:59);u3(08-20 00:00)不含
  assert.ok(inDay.every((t) => t.sessionId !== 'u3'));
  const prevDay = TV.filterTrajectories([{ machine: 'a', mtime: Date.UTC(2026, 7, 18, 23, 59, 59, 999) }], { date: day });
  assert.equal(prevDay.length, 0);
  const lastMs = TV.filterTrajectories([{ machine: 'a', mtime: Date.UTC(2026, 7, 19, 23, 59, 59, 999) }], { date: day });
  assert.equal(lastMs.length, 1);
});
test('filterTrajectories:machine + date 叠加过滤', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  const out = TV.filterTrajectories(flat, { machine: 'mc1', date: '2026-08-19' });
  assert.equal(out.length, 2);
  const none = TV.filterTrajectories(flat, { machine: 'mc2', date: '2026-08-19' });
  assert.equal(none.length, 0);
});

// ---- filterTrajectories:非法 date ----
test('filterTrajectories:非法 date 格式 → 空数组', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  for (const bad of ['2026/08/19', '20260819', '2026-8-19', '2026-13-01', '2026-00-10', '2026-02-31', 'abc', '2026-08-19T00:00:00Z']) {
    assert.deepEqual(TV.filterTrajectories(flat, { date: bad }), [], `date=${bad} 应返回空数组`);
  }
  // 空 date → 不过滤
  assert.equal(TV.filterTrajectories(flat, { date: '' }).length, 3);
});

// ---- renderTrajectoriesBody ----
test('renderTrajectoriesBody:机器名分组头 + 条数 + oversize 标记 + data-traj-index', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  const html = TV.renderTrajectoriesBody(flat, {});
  assert.match(html, /M1 · 2 条/);
  assert.match(html, /M2 · 1 条/);
  assert.match(html, /未解析（超限）/);                       // u2 oversize
  assert.match(html, /<tr class="traj-row" data-traj-index="0" tabindex="0">/);
  assert.match(html, /data-traj-index="2"/);                  // index 为 flat 数组下标
  assert.match(html, /<th>时间<\/th>/);
  assert.match(html, /<th>消息数<\/th>/);
  assert.ok(html.indexOf('M1 · 2 条') < html.indexOf('M2 · 1 条'), '组顺序 = flat 首现顺序');
});
test('renderTrajectoriesBody:firstUserSummary 为 null(非 oversize)→ 摘要列 —', () => {
  const flat = [{ sessionId: 'u', machine: 'm', machineName: 'M', size: 10, mtime: Date.now(), messages: 5, firstUserSummary: null, oversize: false }];
  const html = TV.renderTrajectoriesBody(flat, {});
  assert.match(html, /<td class="traj-cell traj-cell--summary">—<\/td>/);
});
test('renderTrajectoriesBody:空 → NO DATA 占位(区分无数据/无匹配)', () => {
  assert.match(TV.renderTrajectoriesBody([], {}), /NO DATA[^]*尚无轨迹上报/);
  assert.match(TV.renderTrajectoriesBody([], { machine: 'mc1', date: '2026-08-19' }), /NO DATA[^]*无匹配轨迹/);
});
test('renderTrajectoriesBody:摘要转义(注入串不裸进 HTML)', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  const html = TV.renderTrajectoriesBody(flat, {});
  assert.ok(html.indexOf('<x>&"注入') === -1, '原文不应出现');
  assert.match(html, /&lt;x&gt;&amp;&quot;注入/);
});

// ---- renderTrajectoryDetail ----
test('renderTrajectoryDetail:含路径/摘要/大小,且全部转义', () => {
  const item = { machine: 'mc2', machineName: 'M2', sessionId: 'u3', path: '/b/u3.jsonl', size: 2048,
    mtime: Date.UTC(2026, 7, 20, 0, 0), messages: 3, firstUserSummary: '<x>&"注入', oversize: false };
  const html = TV.renderTrajectoryDetail(item);
  assert.match(html, /M2/);
  assert.match(html, /u3/);
  assert.ok(html.indexOf('/b/u3.jsonl') !== -1, '应含绝对路径(字面)');
  assert.ok(html.indexOf('<x>&"注入') === -1, '原文不应出现');
  assert.match(html, /&lt;x&gt;&amp;&quot;注入/);              // 摘要转义
  assert.match(html, /2\.0 KB/);                                // 大小
  assert.match(html, /机器/);
  assert.match(html, /会话 ID/);
  assert.match(html, /消息条数/);
  assert.match(html, /修改时间/);
  assert.match(html, /首条用户消息/);
});
test('renderTrajectoryDetail:oversize → 消息条数「未解析（超限）」', () => {
  const html = TV.renderTrajectoryDetail({ machine: 'mc1', machineName: 'M1', sessionId: 'u2', path: '/a/u2.jsonl',
    size: 9000000, mtime: Date.now(), messages: null, firstUserSummary: null, oversize: true });
  assert.match(html, /未解析（超限）/);
  assert.match(html, /8\.6 MB/);
});
test('renderTrajectoryDetail:摘要防御性再截断 200 字符(后端超长不信任)', () => {
  const long = 'x'.repeat(500);
  const html = TV.renderTrajectoryDetail({ machine: 'a', machineName: 'A', sessionId: 's', path: '/p',
    size: 1, mtime: 0, messages: 1, firstUserSummary: long, oversize: false });
  assert.ok(html.indexOf('x'.repeat(201)) === -1, '不应出现 >200 连续 x');
  assert.match(html, /x{200}…/);
});

// ---- buildExportPayload ----
test('buildExportPayload:trajectories 路径与过滤后逐条一致 + filters 回显', () => {
  const flat = TV.flattenTrajectories(FIXTURE);
  const filtered = TV.filterTrajectories(flat, { machine: 'mc1', date: '2026-08-19' });
  const payload = TV.buildExportPayload(filtered, { machine: 'mc1', date: '2026-08-19' }, Date.UTC(2026, 7, 19, 12, 0, 0));
  assert.equal(payload.count, 2);
  assert.deepEqual(payload.filters, { machine: 'mc1', date: '2026-08-19' });   // 回显
  assert.equal(payload.generatedAt, '2026-08-19T12:00:00.000Z');
  // 路径清单与过滤结果逐条一致(顺序 = 界面顺序)
  assert.deepEqual(payload.trajectories, [
    { machine: 'mc1', sessionId: 'u1', path: '/a/u1.jsonl' },
    { machine: 'mc1', sessionId: 'u2', path: '/a/u2.jsonl' },
  ]);
  // 无过滤:全量
  const all = TV.buildExportPayload(flat, {}, Date.UTC(2026, 7, 19, 12, 0, 0));
  assert.equal(all.count, 3);
  assert.equal(all.trajectories[2].path, '/b/u3.jsonl');
  assert.deepEqual(all.filters, { machine: '', date: '' });
});
test('buildExportPayload:纯对象(JSON 可序列化)+ 空 filtered', () => {
  const payload = TV.buildExportPayload([], { machine: 'zz' }, 1699999999999);
  assert.equal(payload.count, 0);
  assert.deepEqual(payload.trajectories, []);
  assert.equal(JSON.parse(JSON.stringify(payload)).count, 0);
});
