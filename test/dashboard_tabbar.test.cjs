const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const readHtml = () => fs.readFileSync('public/dashboard.html', 'utf8');
const readCss = () => fs.readFileSync('public/dashboard.css', 'utf8');

test('dashboard.html: 底部 .bottom-tabbar(看板 active + 控制台)', () => {
    const h = readHtml();
    assert.ok(h.includes('class="bottom-tabbar"'), '应有 .bottom-tabbar');
    assert.ok(/class="tab tab--active"[^>]*href="\/dashboard\.html"[^>]*aria-current="page"/.test(h), '看板 tab=active');
    assert.ok(/class="tab"[^>]*href="\/" /.test(h) || /class="tab"[^>]*href="\/"/.test(h), '控制台 tab');
});

test('dashboard.html: 无 nav / 登录 nav-link', () => {
    const h = readHtml();
    assert.ok(!h.includes('class="nav"'), 'header nav 应已删(导航下沉底部 tab)');
    assert.ok(!/nav-link/.test(h), '不应再有 nav-link');
});

test('dashboard.css: tab 样式 + 指示条 + visually-hidden + #app flex 容纳 tab', () => {
    const css = readCss();
    assert.ok(/\.bottom-tabbar\s*\{/.test(css), 'dashboard.css 应有 .bottom-tabbar');
    assert.ok(/\.tab\s*\{[^}]*min-height:\s*44px/.test(css), '.tab min-height 44px');
    assert.ok(/\.tab--active::before\s*\{[^}]*background:\s*var\(--accent-2\)/.test(css), '指示条 --accent-2');
    assert.ok(/\.visually-hidden\s*\{/.test(css), '应有 .visually-hidden');
});
