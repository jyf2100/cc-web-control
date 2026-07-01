const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const readCss = () => fs.readFileSync('public/style.css', 'utf8');

// 截取选择器规则块(从选择器首次出现到其第一个 }),用于断言声明
function ruleBlock(css, selector) {
  const idx = css.indexOf(selector);
  if (idx < 0) return '';
  const end = css.indexOf('}', idx);
  return end < 0 ? '' : css.slice(idx, end + 1);
}

test('滚动修复:.chat-container 是 flex 列容器(子项 flex:1 才生效)', () => {
  const b = ruleBlock(readCss(), '.chat-container');
  assert.match(b, /display\s*:\s*flex/);
  assert.match(b, /flex-direction\s*:\s*column/);
  assert.match(b, /overflow-y\s*:\s*auto/);
});

test('滚动修复:.messages 是 flex 列容器 + min-height:0(传递受限高度)', () => {
  const b = ruleBlock(readCss(), '.messages');
  assert.match(b, /display\s*:\s*flex/);
  assert.match(b, /flex-direction\s*:\s*column/);
  assert.match(b, /min-height\s*:\s*0/);
});

test('滚动修复:.terminal-content 占满 + 可收缩(配合 overflow:auto 触发滚动)', () => {
  const b = ruleBlock(readCss(), '.terminal-content');
  assert.match(b, /flex\s*:\s*1/);
  assert.match(b, /min-height\s*:\s*0/);
  assert.match(b, /overflow\s*:\s*auto/);
});
