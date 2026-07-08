const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

test('dashboard.js: 当前 session key 与 client.js 同值', () => {
  assert.match(SRC, /CURRENT_KEY\s*=\s*['"]cc_web_last_session['"]/);
});

test('dashboard.js: confirming Set(跨轮询存活)', () => {
  assert.match(SRC, /new Set\(\)/);
  assert.match(SRC, /confirming/);
});

test('dashboard.js: render 透传 currentName + confirming 给 renderSessionList', () => {
  assert.match(SRC, /renderSessionList\([^)]*currentName[^)]*confirming\)/);
});

test('dashboard.js: click 委托三分支 + stopPropagation(不触发导航)', () => {
  assert.match(SRC, /data-act="del"/);
  assert.match(SRC, /data-act="cancel"/);
  assert.match(SRC, /data-act="confirm"/);
  assert.match(SRC, /stopPropagation/);
});

test('dashboard.js: deleteSession 发 DELETE /api/sessions/:name', () => {
  assert.match(SRC, /\/api\/sessions\/['"]\s*\+\s*encodeURIComponent/);
  assert.match(SRC, /method:\s*['"]DELETE['"]/);
});

test('dashboard.js: 409(WS 保护)与 404(已不存在)分支', () => {
  assert.match(SRC, /===\s*409/);
  assert.match(SRC, /===\s*404/);
});

test('dashboard.js: 乐观移除 li[data-session]', () => {
  assert.match(SRC, /li\[data-session=/);
  assert.match(SRC, /removeChild\(|\.remove\(\)/);
});
