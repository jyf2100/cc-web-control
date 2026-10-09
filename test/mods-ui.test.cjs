'use strict';
// mods 巡检前端测试:board_render.renderModsPanel 纯函数行为(验收 2/3/5 的 UI 侧)
// + dashboard/index 页面挂点与轮询源码结构锁(风格对齐 dashboard-dual-mode.test.cjs)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BR = require('../public/board_render.cjs');

const PUB = path.join(__dirname, '..', 'public');
const dashboardHtml = fs.readFileSync(path.join(PUB, 'dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(PUB, 'dashboard.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const clientJs = fs.readFileSync(path.join(PUB, 'client.js'), 'utf8');

// —— renderModsPanel 纯函数(渲染逻辑真源;hub 看板每机一行)——

const RISKY = { id: 'm1', name: 'RiskBox', mods: { cc_version: '2.1.300', mods_count: 2, source: 'fixture', risk: true, state: 'risk' } };
const CLEAN = { id: 'm2', name: 'CleanBox', mods: { cc_version: '2.1.300', mods_count: 0, source: 'fixture', risk: false, state: 'ok' } };

test('renderModsPanel: 两台机器各一行;非空 mods 机标「mods 风险」,空机不标(验收 2)', () => {
  const html = BR.renderModsPanel([RISKY, CLEAN]);
  const rows = html.match(/<tr class="mods-row[^"]*"/g) || [];
  assert.equal(rows.length, 2, '两行机器条目');
  assert.match(html, /mods-row--risk/);
  assert.match(html, /mods 风险/);
  assert.ok(!/mods-row--risk[^"]*" data-machine="m2"/.test(html.replace(/\n/g, '')), '空 mods 机器不得带风险行类');
  assert.ok(!html.includes('data-machine="m2" title="') || !/data-machine="m2"[^>]*mods-badge--risk/.test(html), '空 mods 机器不得带风险徽标');
  const cleanRow = (html.match(/<tr class="mods-row mods-row--ok" data-machine="m2"[^>]*>[\s\S]*?<\/tr>/) || [''])[0];
  assert.match(cleanRow, /正常/, '空 mods 机器显示正常');
  assert.ok(!/风险/.test(cleanRow));
});

test('renderModsPanel: 行内含机器名 / CC 版本 / mods 条数', () => {
  const html = BR.renderModsPanel([RISKY]);
  assert.match(html, /RiskBox/);
  assert.match(html, /CC 2\.1\.300/);
  assert.match(html, /<td class="mods-row__count">2<\/td>/);
});

test('renderModsPanel: 巡检异常机器显示「巡检异常」而非正常态(验收 5)', () => {
  const html = BR.renderModsPanel([{
    id: 'm3', name: 'ErrBox',
    mods: { cc_version: 'unknown', mods_count: 0, source: '', error: 'EACCES', risk: false, state: 'error' },
  }]);
  assert.match(html, /巡检异常/);
  assert.match(html, /mods-row--error/);
  assert.ok(!/mods-badge--ok/.test(html), '不得再显示正常绿色状态');
});

test('renderModsPanel: 版本未知且有 mods → 「版本未知」(不误报风险也不显示正常)', () => {
  const html = BR.renderModsPanel([{
    id: 'm4', name: 'UnkBox',
    mods: { cc_version: 'unknown', mods_count: 1, source: 'x', risk: false, state: 'unknown' },
  }]);
  assert.match(html, /版本未知/);
  assert.ok(!/mods 风险/.test(html));
});

test('renderModsPanel: 无任何机器上报 mods → 返回空串(面板隐藏)', () => {
  assert.equal(BR.renderModsPanel([]), '');
  assert.equal(BR.renderModsPanel([{ id: 'old', name: 'O' }]), '');
  assert.equal(BR.renderModsPanel(null), '');
});

test('renderModsPanel: 部分机器未上报 → 显示「未上报」灰行', () => {
  const html = BR.renderModsPanel([RISKY, { id: 'old', name: 'OldAgent' }]);
  assert.match(html, /未上报/);
  assert.match(html, /mods-row--none/);
});

test('renderModsPanel: 机器名 HTML 转义(不可信输入防御)', () => {
  const html = BR.renderModsPanel([{
    id: 'x', name: '<script>alert(1)</script>',
    mods: { cc_version: '2.1.300', mods_count: 1, source: 'x', risk: true, state: 'risk' },
  }]);
  assert.ok(!html.includes('<script>'), '机器名须被转义');
  assert.match(html, /&lt;script&gt;/);
});

// —— 页面挂点与轮询源码结构锁(行为级 DOM 测试需 JSDOM/Playwright;此处锁结构,风格对齐既有测试)——

test('dashboard.html: hub 模式含 #mods-panel / #mods-body 挂点(默认 hidden)', () => {
  assert.match(dashboardHtml, /id="mods-panel"/);
  assert.match(dashboardHtml, /id="mods-body"/);
  assert.match(dashboardHtml, /id="mods-panel"[^>]*hidden/);
});

test('dashboard.js: renderBoard 渲染 mods 面板(BR.renderModsPanel + 空串隐藏)', () => {
  assert.match(dashboardJs, /BR\.renderModsPanel/);
  assert.match(dashboardJs, /function renderModsPanel/);
  assert.match(dashboardJs, /modsPanel\.hidden\s*=\s*!html/);
  // 放在 renderBoard 顶部:空机/无会话早退分支下机器行仍可见
  assert.match(dashboardJs, /function renderBoard\(payload\)\s*\{\s*var machines = payload\.machines \|\| \[\];\s*renderModsPanel\(machines\);/);
});

test('index.html: 控制台含 #modsBanner 横幅挂点(默认 hidden)', () => {
  assert.match(indexHtml, /id="modsBanner"/);
  assert.match(indexHtml, /id="modsBanner"[^>]*hidden/);
});

test('client.js: 轮询 /api/mods-status;非空显示含 "mods" 文案横幅,空/失败隐藏(验收 3)', () => {
  assert.match(clientJs, /\/api\/mods-status/);
  assert.match(clientJs, /function renderModsBanner/);
  assert.match(clientJs, /mods_count/, '横幅显隐依据 mods_count');
  assert.match(clientJs, /mods\/plugins/, '横幅文案含 "mods" 字样');
  assert.match(clientJs, /pollModsBanner\(\)/, '初始化即探测');
});
