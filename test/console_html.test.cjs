const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.js'), 'utf8');

test('加载 terminal_cleaner + console_render 脚本(顺序)', () => {
  const idxTC = html.indexOf('terminal_cleaner.cjs');
  const idxCR = html.indexOf('console_render.cjs');
  const idxJS = html.indexOf('console.js');
  assert.ok(idxTC > 0, '应加载 terminal_cleaner.cjs');
  assert.ok(idxCR > 0, '应加载 console_render.cjs');
  assert.ok(idxTC < idxCR, 'terminal_cleaner 须在 console_render 前');
  assert.ok(idxCR < idxJS, 'console_render 须在 console.js 前');
});
test('顶层 .console-app 容器(非 #app)', () => {
  assert.match(html, /class="console-app"/);
  assert.doesNotMatch(html, /id="app"/);
});
test('topbar 含返回入口 + fleet 摘要挂点', () => {
  assert.match(html, /class="console-topbar"/);
  assert.match(html, /href="\/dashboard\.html"/);
  assert.match(html, /id="fleet-summary"/);
});
test('卡片网格是 <ul id="board-body">(非 table)', () => {
  assert.match(html, /<ul[^>]*id="board-body"/);
  assert.doesNotMatch(html, /<table id="global-board"/);
});
test('HERO L2 callout 默认 hidden', () => {
  assert.match(html, /id="hero-callout"[^>]*hidden/);
});
test('终端 term-target 支持 data-state + 融合输入', () => {
  assert.match(html, /id="term-target"/);
  assert.match(html, /id="term-input"/);
  assert.match(html, /id="term-input-form"/);
});
test('废弃广播栏已移除(单输入融合)', () => {
  assert.doesNotMatch(html, /id="broadcast-bar"/);
  assert.doesNotMatch(html, /id="bc-send"/);
  assert.doesNotMatch(html, /id="bc-input"/);
});
test('保留功能挂点(ma-* / hub-status / bc-result)', () => {
  for (const id of ['hub-status', 'main-agent-panel', 'ma-status-dot', 'ma-status-text', 'ma-screen', 'ma-start-btn', 'ma-stop-btn', 'bc-result']) {
    assert.match(html, new RegExp(`id="${id}"`), `应保留 #${id}`);
  }
});
test('图标 span 标注 aria-hidden', () => {
  assert.match(html, /aria-hidden="true"/);
});

test('console.js 引用 ConsoleRender 纯函数', () => {
  assert.match(js, /ConsoleRender\.(sortCardsErroredFirst|buildCardHTML|diffCards)/);
});
test('console.js 移除旧 bcSend/bcInput 引用', () => {
  assert.doesNotMatch(js, /bcSend\.addEventListener/);
  assert.doesNotMatch(js, /getElementById\('bc-input'\)/);
});
test('renderBoard 用 keyed-diff(非全量 innerHTML="")', () => {
  assert.match(js, /diffCards/);
  assert.doesNotMatch(js, /boardBody\.innerHTML\s*=\s*''/);
});
test('空态渲染 board-empty', () => {
  assert.match(js, /board-empty/);
});

test('ensureWs 补 onclose/onerror + 重连', () => {
  assert.match(js, /ws\.onclose\s*=/);
  assert.match(js, /ws\.onerror\s*=/);
  assert.match(js, /nextBackoff/);
});
test('断线态切 term-target data-state + 禁用输入', () => {
  assert.match(js, /setAttribute\(['"]data-state['"]/);
  assert.match(js, /termInput\.disabled\s*=\s*true/);
});
test('广播融合:term-input 按 selected.size 分发', () => {
  assert.match(js, /selected\.size/);
  assert.match(js, /type:\s*'broadcast'/);
  assert.match(js, /type:\s*'input'/);
});
test('refreshBroadcast 切输入条广播态 + 徽章', () => {
  assert.match(js, /bcCount\.hidden\s*=\s*selected\.size\s*<\s*2/);
});
test('scheduleTermReconnect 防重入(避免 onclose+onerror 双触发 backoff 风暴)', () => {
  assert.match(js, /if\s*\(termReconnectTimer\)\s*return\s*;/);
});
test('renderMaStatus 写 hero-l1 健康摘要', () => {
  assert.match(js, /hero-l1|heroL1/);
  assert.match(js, /summarizeFleet/);
});
test('renderMaCallout 调 parseCallout + 默认隐藏', () => {
  assert.match(js, /parseCallout/);
  assert.match(js, /heroCallout\.hidden\s*=/);
});
test('ma-toggle 切 data-ma-open + aria-expanded', () => {
  assert.match(js, /data-ma-open/);
  assert.match(js, /aria-expanded/);
});
test('poll stale 检测:连续失败标陈旧', () => {
  assert.match(js, /pollFailCount|数据.*前/);
});
test('visualViewport 监听:软键盘弹起同步 --vh(移动端 P1 §4.2 A6)', () => {
  assert.match(js, /visualViewport/);
});
test('终端可折叠:term-collapse-btn + data-collapsed 联动(P1 §4.2 A6)', () => {
  assert.match(html, /id="term-collapse-btn"/);
  assert.match(html, /data-collapsed="false"/);
  assert.match(js, /data-collapsed/);
});
