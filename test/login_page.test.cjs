'use strict';
// 登录页版本号注入(login_page.cjs):PRD 20261028m16-e2e-login-version-footer。
// 纯函数 + fsImpl 注入(全仓测试风格),另含真实模板同步性断言(模板/注入不脱钩)。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { VERSION_PLACEHOLDER, renderLoginPage, readLoginPageSync } = require('../login_page.cjs');
const ROOT = path.join(__dirname, '..');
const VERSION_TEXT_RE = /v\d+\.\d+\.\d+/;

test('renderLoginPage:占位全部替换为 v<version>(v 前缀)', () => {
  const tpl = '<p>brand {{APP_VERSION}}</p><footer>Roc-CC · {{APP_VERSION}}</footer>';
  const out = renderLoginPage({ template: tpl, version: '9.9.9' });
  assert.equal(out, '<p>brand v9.9.9</p><footer>Roc-CC · v9.9.9</footer>');
  assert.ok(!out.includes(VERSION_PLACEHOLDER), '渲染后不应残留占位');
});

test('renderLoginPage:模板无占位时原样返回(幂等,不 double-prefix)', () => {
  const tpl = '<p>v3.1.4 已是字面量</p>';
  assert.equal(renderLoginPage({ template: tpl, version: '3.1.4' }), tpl);
});

test('真实 login.html + package.json:渲染结果静态含 v<version> 底部 footer', () => {
  const html = readLoginPageSync();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const verRe = new RegExp(`v${pkg.version.replace(/\./g, '\\.')}`);
  assert.match(html, verRe, '渲染结果应含 package.json 版本号');
  assert.ok(!html.includes(VERSION_PLACEHOLDER), '渲染后不应残留占位');
  // 底部 footer 静态存在于 HTML(ac3:不依赖前端 JS)
  assert.match(html, /<footer[^>]*class="login-footer"[^>]*>[^<]*v\d+\.\d+\.\d+[^<]*<\/footer>/);
});

test('login.html 模板与注入逻辑同步:含 footer + 占位(不再硬编码版本字面量)', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  const count = tpl.split(VERSION_PLACEHOLDER).length - 1;
  assert.ok(count >= 2, `模板应至少含 brand-ver + footer 两处占位,实际 ${count}`);
  assert.match(tpl, /<footer[^>]*class="login-footer"/, '模板应含底部版本 footer');
  assert.ok(!VERSION_TEXT_RE.test(tpl), '模板不应硬编码 semver 字面量(版本只来自 package.json)');
});

test('readLoginPageSync:fsImpl 注入(不碰真实磁盘),rootDir 可指 hub 侧仓根', () => {
  const files = {
    '/fake/public/login.html': 'x {{APP_VERSION}} {{APP_VERSION}}',
    '/fake/package.json': '{"version":"3.1.4"}',
  };
  const fsImpl = { readFileSync: (p) => files[p] };
  assert.equal(readLoginPageSync(fsImpl, '/fake'), 'x v3.1.4 v3.1.4');
});

test('server 侧 GET /login 渲染契约:注入后 HTML 含 form/token(next 输入契约不变)', () => {
  const html = readLoginPageSync();
  assert.match(html, /<form[^>]*method="POST"[^>]*action="\/login"/);
  assert.match(html, /id="token"/);
  assert.match(html, /id="next"/);
});
