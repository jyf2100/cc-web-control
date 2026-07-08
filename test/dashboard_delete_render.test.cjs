const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/dashboard_render.cjs');

test('renderSession: 默认含删除按钮 data-act=del', () => {
  const html = R.renderSession({ name: 'claude-foo', status: 'idle', cwd: '/x/foo', lastLine: 'hi' }, 0);
  assert.match(html, /class="[^"]*session__del[^"]*"/);
  assert.match(html, /data-act="del"/);
});

test('renderSession: isCurrent → 删除按钮 disabled + session--current + 当前会话提示', () => {
  const html = R.renderSession({ name: 'claude-foo', status: 'idle' }, 0, { isCurrent: true });
  assert.match(html, /session--current/);
  assert.match(html, /<button[^>]*session__del[^>]*disabled/);
  assert.match(html, /当前会话/);
});

test('renderSession: confirming → session--confirming + 取消/确认按钮,不含 del', () => {
  const html = R.renderSession({ name: 'claude-foo', status: 'idle' }, 0, { confirming: true });
  assert.match(html, /session--confirming/);
  assert.match(html, /data-act="cancel"/);
  assert.match(html, /data-act="confirm"/);
  assert.doesNotMatch(html, /data-act="del"/);
});

test('renderSessionList: 透传 currentName + confirmingSet', () => {
  const sessions = [
    { name: 'a', status: 'idle' },
    { name: 'b', status: 'idle' },
    { name: 'c', status: 'idle' },
  ];
  const html = R.renderSessionList(sessions, 'b', new Set(['c']));
  const bLi = html.match(/<li[^>]*data-session="b"[\s\S]*?<\/li>/)[0];
  const cLi = html.match(/<li[^>]*data-session="c"[\s\S]*?<\/li>/)[0];
  const aLi = html.match(/<li[^>]*data-session="a"[\s\S]*?<\/li>/)[0];
  assert.match(bLi, /session--current/);
  assert.match(cLi, /session--confirming/);
  assert.doesNotMatch(aLi, /session--current/);
  assert.doesNotMatch(aLi, /session--confirming/);
});

test('renderSessionList: 向后兼容(仅 sessions)不抛错', () => {
  const html = R.renderSessionList([{ name: 'a', status: 'idle' }]);
  assert.match(html, /data-session="a"/);
});
