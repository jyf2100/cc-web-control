const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const readHtml = () => fs.readFileSync('public/dashboard.html', 'utf8');
const readCss = () => fs.readFileSync('public/dashboard.css', 'utf8');

test('dashboard.html: 底部 .bottom-tabbar 已删(Task 10 三页面:hub 仅看板)', () => {
    const h = readHtml();
    assert.ok(!h.includes('class="bottom-tabbar"'), '不应再有 .bottom-tabbar');
    assert.ok(!/tab--active/.test(h), '不应再有 tab--active');
    assert.ok(!/class="tab"/.test(h), '不应再有 .tab');
});

test('dashboard.html: 无 nav / 登录 nav-link', () => {
    const h = readHtml();
    assert.ok(!h.includes('class="nav"'), 'header nav 应已删(导航下沉底部 tab)');
    assert.ok(!/nav-link/.test(h), '不应再有 nav-link');
});

test('dashboard.css: visually-hidden 保留(tab 样式已随 tabbar 删除,Task 10 删 HTML)', () => {
    const css = readCss();
    assert.ok(!/\.bottom-tabbar/.test(css), 'Task 9 删除:.bottom-tabbar 死 CSS');
    assert.ok(!/\.tab--active/.test(css), 'Task 9 删除:.tab--active 死 CSS');
    assert.ok(/\.visually-hidden\s*\{/.test(css), '应有 .visually-hidden');
});
