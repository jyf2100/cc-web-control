const { test } = require('node:test');
const assert = require('node:assert');
const { handleTabTrap, shouldCloseOnKey, buildSessionItems } = require('../public/switch_sheet.cjs');

test('handleTabTrap 末项 Tab 跳首', () => {
  const r = handleTabTrap({ key: 'Tab', shiftKey: false }, ['a','b','c'], 2);
  assert.equal(r.trap, true); assert.equal(r.focusIndex, 0);
});
test('handleTabTrap 首项 Shift+Tab 跳末', () => {
  const r = handleTabTrap({ key: 'Tab', shiftKey: true }, ['a','b','c'], 0);
  assert.equal(r.trap, true); assert.equal(r.focusIndex, 2);
});
test('handleTabTrap 中间项不 trap', () => {
  assert.equal(handleTabTrap({ key: 'Tab', shiftKey: false }, ['a','b','c'], 1).trap, false);
});
test('handleTabTrap 非 Tab / 空列表不 trap', () => {
  assert.equal(handleTabTrap({ key: 'Enter' }, ['a'], 0).trap, false);
  assert.equal(handleTabTrap({ key: 'Tab' }, [], 0).trap, false);
  assert.equal(handleTabTrap({ key: 'Tab' }, ['a','b'], -1).trap, false);
});
test('shouldCloseOnKey', () => {
  assert.equal(shouldCloseOnKey({ key: 'Escape' }), true);
  assert.equal(shouldCloseOnKey({ key: 'c', ctrlKey: true, view: { document: { getSelection: () => '' } } }), true);
  assert.equal(shouldCloseOnKey({ key: 'c', metaKey: true, view: { document: { getSelection: () => '' } } }), true);
  assert.equal(shouldCloseOnKey({ key: 'c', ctrlKey: true, view: { document: { getSelection: () => 'sel' } } }), false);
  assert.equal(shouldCloseOnKey({ key: 'Enter' }), false);
  assert.equal(shouldCloseOnKey(null), false);
});
test('buildSessionItems attached 排前 + isCurrent', () => {
  const items = buildSessionItems([{ name: 'b' }, { name: 'a', attached: true }], 'a');
  assert.equal(items[0].name, 'a'); assert.equal(items[0].attached, true);
  assert.equal(items.find(i => i.name === 'a').isCurrent, true);
  assert.equal(items.find(i => i.name === 'b').isCurrent, false);
});
test('buildSessionItems 非法降级', () => {
  assert.deepEqual(buildSessionItems(null, 'x'), []);
  assert.equal(buildSessionItems([{ name: 'ok' }, { bad: 1 }, 'x' ], 'ok').length, 1);
});
