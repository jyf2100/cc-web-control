const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');

// 强契约:匹配真实 CSS 规则体(选择器后跟 { ... })。
// 仅在注释里留字面量、删真实规则体不能过;`.` 在正则中需转义。
// 7 条 class 契约:每条必须存在一条带规则体的真实样式。
const selectors = [
  '.session__del',
  '.session--current',
  '.session--confirming',
  '.s-cancel',
  '.s-confirm-del',
  '.toast',
  '.toast--show',
];
for (const sel of selectors) {
  test('dashboard.css 含真实规则体 ' + sel, () => {
    // 转义 class 选择器中的 `.`、`--` 等正则元字符(`.` → `\.`,`-` 在字符组外字面匹配)
    const escaped = sel.replace(/[.\\^$*+?(){}[\]|]/g, '\\$&');
    const re = new RegExp(escaped + '\\s*\\{[^}]*\\}');
    assert.match(CSS, re, '缺少真实规则体 ' + sel + '(仅留注释字面量不算)');
  });
}

// disabled 态契约:规则体必须含 cursor:not-allowed(真实可禁用语义)
test('session__del:disabled 规则体含 cursor:not-allowed', () => {
  assert.match(CSS, /\.session__del:disabled\s*\{[^}]*cursor:\s*not-allowed/);
});
