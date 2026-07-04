/**
 * Task 4:dashboard.html 双模式探测分发测试。
 * 校验:hub 模式(board-body/fleet-summary/board-stale 挂点 + board_render 加载 +
 * click-to-navigate + title 带 fleet 数)与单机 fallback(/api/global-dashboard 404 → loop())。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

test('dashboard.html 双模式:加载 board_render(hub)+ dashboard_render(单机)', () => {
  assert.match(html, /board_render\.cjs/);
  assert.match(html, /dashboard_render\.cjs/);
});
test('dashboard.html hub 模式卡片网格挂点 + fleet 摘要 + board-stale', () => {
  assert.match(html, /id="board-body"/);
  assert.match(html, /id="fleet-summary"/);
  assert.match(html, /board-stale/);
});
test('dashboard.html 底部 tab 含切换(aria-haspopup)', () => {
  assert.match(html, /aria-haspopup="dialog"/);
});
test('dashboard.js 探测 global-dashboard 分发 hub/单机', () => {
  assert.match(js, /\/api\/global-dashboard/);
  assert.match(js, /404|status\s*===\s*404/);  // 404 → 单机 fallback
});
test('dashboard.js hub 卡片跳控制台(click-to-navigate)', () => {
  assert.match(js, /\/console\.html\?m=/);
});
test('dashboard.js hub title 带 fleet 数', () => {
  assert.match(js, /多机|fleet|online/);
});
