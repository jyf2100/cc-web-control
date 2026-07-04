const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.js'), 'utf8');

test('加载 terminal_cleaner + console_render + switch_sheet + console.js(顺序)', () => {
  const idxTC = html.indexOf('terminal_cleaner.cjs');
  const idxCR = html.indexOf('console_render.cjs');
  const idxSS = html.indexOf('switch_sheet.cjs');
  const idxJS = html.indexOf('console.js');
  assert.ok(idxTC > 0 && idxCR > 0 && idxSS > 0 && idxJS > 0);
  assert.ok(idxTC < idxCR && idxCR < idxSS && idxSS < idxJS);
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
test('console.html 移除卡片网格(无 board-body/.console-board)', () => {
  assert.doesNotMatch(html, /id="board-body"/);
  assert.doesNotMatch(html, /class="console-board"/);
});
// 新增:底部三项 tab + 切换抽屉 trigger + 加载 switch_sheet.cjs
test('console.html 含底部三项 tab(控制台 active/看板/切换)', () => {
  assert.match(html, /class="bottom-tabbar"/);
  assert.match(html, /tab--active/);
  assert.match(html, /id="switchTab"/);
});
test('console.html 加载 switch_sheet.cjs(抽屉模态)', () => {
  assert.ok(html.indexOf('switch_sheet.cjs') > 0, '应加载 switch_sheet.cjs');
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

test('console.js 移除旧 bcSend/bcInput 引用', () => {
  assert.doesNotMatch(js, /bcSend\.addEventListener/);
  assert.doesNotMatch(js, /getElementById\('bc-input'\)/);
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
test('renderMaCallout 调 parseCallout + 默认隐藏', () => {
  assert.match(js, /parseCallout/);
  assert.match(js, /heroCallout\.hidden\s*=/);
});
test('ma-toggle 切 data-ma-open + aria-expanded', () => {
  assert.match(js, /data-ma-open/);
  assert.match(js, /aria-expanded/);
});
test('visualViewport 监听:软键盘弹起同步 --vh(移动端 P1 §4.2 A6)', () => {
  assert.match(js, /visualViewport/);
});
test('终端可折叠:term-collapse-btn + data-collapsed 联动(P1 §4.2 A6)', () => {
  assert.match(html, /id="term-collapse-btn"/);
  assert.match(html, /data-collapsed="false"/);
  assert.match(js, /data-collapsed/);
});
