const { test } = require('node:test');
const assert = require('node:assert');
// 粘贴逻辑的真源在 login.html <script> 内(IIFE 不可 require)。
// 此处用文本断言保证脚本契约存在,运行时行为靠真机/grep。
const fs = require('node:fs');

test('login.html 含粘贴脚本:clipboard.readText + 失败静默 + aria-disabled', () => {
  const html = fs.readFileSync('public/login.html', 'utf8');
  assert.ok(/navigator\.clipboard\.readText/.test(html));
  assert.ok(/\.catch\(function/.test(html));          // 失败静默
  assert.ok(/aria-disabled/.test(html));               // 弱化态
});
