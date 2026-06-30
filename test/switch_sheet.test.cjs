const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { handleTabTrap, shouldCloseOnKey, buildSessionItems, buildProjectItems } = require('../public/switch_sheet.cjs');

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
test('buildProjectItems 渲染 label(root 带后缀)+ isCurrent(去尾斜杠匹配 cwd)', () => {
  const projects = [
    { path: '/roots/a/foo', name: 'foo', root: 'A' },
    { path: '/roots/b/bar/', name: 'bar' },
  ];
  const items = buildProjectItems(projects, '/roots/b/bar');
  assert.equal(items.length, 2);
  assert.equal(items[0].path, '/roots/a/foo');
  assert.equal(items[0].label, 'foo (A)');
  assert.equal(items[1].label, 'bar');
  assert.equal(items.find(i => i.path === '/roots/b/bar/').isCurrent, true);
  assert.equal(items.find(i => i.path === '/roots/a/foo').isCurrent, false);
});
test('buildProjectItems 非法降级', () => {
  assert.deepEqual(buildProjectItems(null, 'x'), []);
  assert.equal(buildProjectItems([{ path: '/p', name: 'p' }, { bad: 1 }, 'x' ], '/p').length, 1);
});
test('createSwitchSheet 源码契约:支持 projects 渲染 + onLaunch 回调', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(src.includes('onLaunch'), 'createSwitchSheet 应接受 onLaunch 回调');
  assert.ok(src.includes('switch-sheet-projects'), '应有项目区容器 .switch-sheet-projects');
  assert.ok(src.includes('switch-sheet-section-title'), '项目区应有分组标题');
  assert.ok(/projects\.forEach/.test(src), '应遍历 projects 渲染项目项');
  assert.ok(/onLaunch\(/.test(src), '项目项点击应调用 onLaunch(path)');
});
