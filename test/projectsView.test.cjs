const test = require('node:test');
const assert = require('node:assert/strict');
const { projectsView } = require('../public/projectsView.cjs');

test('projectsView: 有项目 → 显示下拉框与启动按钮,无空状态文案', () => {
  const out = projectsView({
    projects: [{ name: 'cc-web-control', path: '/Users/roc/workspace/cc-web-control' }],
    hasRoots: true,
  });
  assert.deepEqual(out, { showSelect: true, showButton: true, emptyHint: '' });
});

test('projectsView: 无项目且未配置根目录 → 隐藏控件,提示未配置', () => {
  const out = projectsView({ projects: [], hasRoots: false });
  assert.equal(out.showSelect, false);
  assert.equal(out.showButton, false);
  assert.match(out.emptyHint, /CC_WEB_PROJECT_ROOTS/);
});

test('projectsView: 无项目但已配置根目录 → 隐藏控件,提示目录为空(区别未配置)', () => {
  const out = projectsView({ projects: [], hasRoots: true });
  assert.equal(out.showSelect, false);
  assert.equal(out.showButton, false);
  assert.doesNotMatch(out.emptyHint, /CC_WEB_PROJECT_ROOTS/);
  assert.match(out.emptyHint, /空|没有/);
});

test('projectsView: 输入非法 → 安全降级隐藏 + 未配置提示', () => {
  const out = projectsView(null);
  assert.equal(out.showSelect, false);
  assert.equal(out.showButton, false);
  assert.match(out.emptyHint, /CC_WEB_PROJECT_ROOTS/);
});
