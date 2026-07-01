const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('flash:dashboard.js 调用 diffChangedStatus 算变化集', () => {
  const js = fs.readFileSync('public/dashboard.js', 'utf8');
  assert.match(js, /diffChangedStatus/);
});
test('flash:dashboard.js 给变化项加 session--flash class', () => {
  const js = fs.readFileSync('public/dashboard.js', 'utf8');
  assert.match(js, /session--flash/);
  assert.match(js, /classList\.add/);
});
test('flash:dashboard.js 维护 prevSessions 供下次 diff', () => {
  const js = fs.readFileSync('public/dashboard.js', 'utf8');
  assert.match(js, /prevSessions/);
});
test('flash:dashboard.css 定义 session-flash 动画 + session--flash 类', () => {
  const css = fs.readFileSync('public/dashboard.css', 'utf8');
  assert.match(css, /@keyframes\s+session-flash/);
  assert.match(css, /\.session--flash\b/);
  assert.match(css, /animation\s*:\s*session-flash/);
});
