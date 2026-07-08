const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');

for (const cls of ['.session__del', '.session--current', '.session--confirming', '.s-cancel', '.s-confirm-del', '.toast', '.toast--show']) {
  test('dashboard.css 含选择器 ' + cls, () => {
    assert.ok(CSS.includes(cls), '缺少 ' + cls);
  });
}
test('session__del 有 disabled 态', () => {
  assert.match(CSS, /session__del:disabled/);
});
