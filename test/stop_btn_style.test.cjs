/**
 * 回归:竖屏下 terminal-header 的 Esc / Ctrl+C(stop-btn)扁平化,
 * 与 header 协调(去药丸胶囊感)。
 * 用户意图:"竖屏下 ESC ctrl+c 两个按钮的风格能合群点嘛"
 *   → 选 "留 header,扁平化去药丸"。
 *
 * 锁定:默认态无药丸圆角 / 无边框 / 透明底 / 文字次要色(--fg-2);
 *      hover/active 才亮 --accent-2 给反馈;client.js 按钮类名未误删。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');

// 截取 .btn.stop-btn { ... } 规则块(默认态)
const stopBtnBlock = css.match(/\.btn\.stop-btn\s*\{([^}]*)\}/);
const stopBtnHover = css.match(/\.btn\.stop-btn:hover[^{]*\{([^}]*)\}/);

test('stop-btn: 默认态不再用药丸圆角 9999px(扁平化)', () => {
  assert.ok(stopBtnBlock, '.btn.stop-btn 默认态规则应存在');
  const block = stopBtnBlock[1];
  assert.doesNotMatch(block, /border-radius:\s*var\(--r-pill\)/, '不应再用 --r-pill 药丸圆角');
  assert.doesNotMatch(block, /border-radius:\s*9999px/, '不应硬编码 9999px 药丸');
});

test('stop-btn: 默认无边框、透明底(不是带边框/浅底的药丸胶囊)', () => {
  const block = stopBtnBlock[1];
  assert.match(block, /border:\s*none/, '应有 border: none(扁平)');
  assert.match(block, /background:\s*transparent/, '应有 background: transparent(扁平)');
});

test('stop-btn: 默认文字用次要色 --fg-2(融入 terminal-header),非默认 accent', () => {
  const block = stopBtnBlock[1];
  assert.match(block, /color:\s*var\(--fg-2\)/, '默认色应为 --fg-2,与 header 文字协调');
  assert.doesNotMatch(block, /color:\s*var\(--accent-2\)/, '默认态不应直接 --accent-2(留待 hover/active)');
});

test('stop-btn: hover/active 才亮 --accent-2(默认安静,交互给反馈)', () => {
  assert.ok(stopBtnHover, '.btn.stop-btn:hover 规则应存在');
  assert.match(stopBtnHover[1], /var\(--accent-2\)/, 'hover 应出现 --accent-2(文字或底)');
});

test('client.js: stop 按钮仍带 btn stop-btn 类(类名未误删)', () => {
  assert.match(client, /className = 'btn stop-btn'/, 'mkStop 仍生成 class="btn stop-btn"');
});
