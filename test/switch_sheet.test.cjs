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

test('createSwitchSheet 源码契约:meta 行 + 项目空状态', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  // meta 行(opts.meta → .switch-sheet-meta)
  assert.ok(/opts\.meta/.test(src) || /meta\s*=.*opts\.meta/.test(src), '应解析 opts.meta');
  assert.ok(src.includes('switch-sheet-meta'), '应有 .switch-sheet-meta 行');
  // 项目区空状态(.switch-sheet-projects-empty,无项目时提示)
  assert.ok(src.includes('switch-sheet-projects-empty'), '应有项目区空状态 .switch-sheet-projects-empty');
  assert.ok(/projects\.length[\s\S]*switch-sheet-projects-empty/.test(src) || /else[\s\S]*switch-sheet-projects-empty/.test(src),
    'projects 为空时应渲染空状态(else 分支)');
});

test('createSwitchSheet 源码契约:动态 sheet 挂 id="switchSheet"(供 aria-controls 指向)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(/sheet\.setAttribute\(\s*['"]id['"]\s*,\s*['"]switchSheet['"]\s*\)/.test(src)
    || /sheet\.id\s*=\s*['"]switchSheet['"]/.test(src),
    'sheet 应挂 id="switchSheet"');
});

test('createSwitchSheet 源码契约:open 给 .console-card 加 inert,close 移除', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(/console-card/.test(src), '应引用 .console-card');
  assert.ok(/setAttribute\(\s*['"]inert['"]\s*,\s*['"]['"]?\s*\)/.test(src)
    || /setAttribute\(\s*['"]inert['"]\s*,\s*''\s*\)/.test(src)
    || /inert['"],?\s*['"]?['"]?\)/.test(src), 'open 应 setAttribute inert');
  assert.ok(/removeAttribute\(\s*['"]inert['"]/.test(src), 'close 应 removeAttribute inert');
});

test('createSwitchSheet aria-label 为「启动项目」(原「切换会话」)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.match(src, /'启动项目'/);
  assert.doesNotMatch(src, /'切换会话'/);
});
test('createSwitchSheet 不再渲染会话段(会话标题与 sessTitle 变量删除)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(!/textContent\s*=\s*'会话'/.test(src), '会话段标题应删除');
  assert.ok(!/sessTitle/.test(src), 'sessTitle 变量应删除');
});
test('createSwitchSheet 仍渲染项目段', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.match(src, /'项目'/);
  assert.match(src, /switch-sheet-projects/);
});
test('buildSessionItems 纯函数保留(向后兼容)', () => {
  assert.deepEqual(
    buildSessionItems([{name:'a',attached:false}], 'a'),
    [{name:'a',label:'a',attached:false,isCurrent:true}]
  );
});

test('createSwitchSheet backdropRoot 可经 opts 注入(默认 .console-card 兼容单机)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.match(src, /opts\.backdropRoot/);                             // 读 opts
  assert.match(src, /\.console-card/);                                 // 默认回退单机根
  assert.doesNotMatch(src, /querySelector\(['"]\.console-card['"]\)/); // 不再写死
});

test('createSwitchSheet 源码契约:hideProjects 可跳过项目段 + ariaLabel 可注入(默认「启动项目」) — 三页面 §4.2 P0-2', () => {
  // hub 无 /api/projects 端点(只被控机 :7684 有),hub 抽屉项目段永久空态;
  // hideProjects:true 跳过 projWrap,只留机器/会话单选 attach。ariaLabel 注入「切换被控 agent」。
  // 默认值 '启动项目' 保留(向后兼容单机客户端 client.js 的 createSwitchSheet 调用 + :93-107 契约)。
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.match(src, /opts\.hideProjects/);
  assert.match(src, /opts\.ariaLabel/);
  assert.match(src, /'启动项目'/);   // 默认值保留(向后兼容)
});
