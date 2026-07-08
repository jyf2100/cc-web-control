const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs: require session_in_use.cjs', () => {
  assert.match(SERVER, /require\(['"]\.\/session_in_use\.cjs['"]\)/);
});

test('server.cjs: DELETE handler 在 killSession 之前调 isSessionInUse → 409 session_in_use', () => {
  const m = SERVER.match(/app\.delete\('\/api\/sessions\/:name'[\s\S]*?\n  \}\);/);
  assert.ok(m, '未找到 DELETE /api/sessions/:name handler');
  const h = m[0];
  const checkIdx = h.indexOf('isSessionInUse');
  const killIdx = h.indexOf('killSession');
  assert.notEqual(checkIdx, -1, 'DELETE 未调用 isSessionInUse');
  assert.ok(killIdx > checkIdx, 'isSessionInUse 检查须在 killSession 之前');
  assert.match(h, /status\(409\)/);
  assert.match(h, /session_in_use/);
});
