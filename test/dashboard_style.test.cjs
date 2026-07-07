const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');

// Task 9 CSS 锁:对齐 Plan A DOM(<li.card-row> 同级 <button.card__select aria-pressed>
// + <a.card>)。卡住结构:card-row flex 一行、grid 减列、aria-pressed、safe-area、死代码清理。

test('.card-row is flex (button + a 同行)', () => {
  assert.match(css, /\.card-row\s*{[^}]*display:\s*flex/);
  assert.match(css, /\.card-row\s*>\s*\.card\s*{[^}]*flex:\s*1/);
});

test('.card__select uses aria-pressed not aria-checked', () => {
  assert.match(css, /\.card__select\[aria-pressed="true"\]/);
  assert.ok(!/\.card__select\[aria-checked="true"\]/.test(css));
});

test('.card grid has 4 columns (card__select 移出后)', () => {
  assert.match(css, /\.card\s*{[^}]*grid-template-columns:\s*auto auto 1fr auto/);
});

test('.main has safe-area bottom padding', () => {
  assert.match(css, /\.main\s*{[^}]*env\(safe-area-inset-bottom\)/);
});

test('.ma-warn-line retained (P3 regression lock)', () => {
  assert.match(css, /\.ma-warn-line/);
});

test('tabbar and switch-sheet dead CSS removed', () => {
  assert.ok(!/\.bottom-tabbar/.test(css));
  assert.ok(!/\.switch-sheet-backdrop/.test(css));
});

test('.visually-hidden retained (a11y helper, survives tabbar removal — 迁自 dashboard_tabbar.test.cjs)', () => {
  assert.match(css, /\.visually-hidden\s*\{/);
});
