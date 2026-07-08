const test = require('node:test');
const assert = require('node:assert/strict');
const { isSessionInUse } = require('../session_in_use.cjs');

const OPEN = 1, CLOSED = 3;
function mkWs(readyState) { return { readyState }; }

test('无连接 → false', () => {
  assert.equal(isSessionInUse('foo', []), false);
  assert.equal(isSessionInUse('foo', new Map()), false);
});

test('sessionName 匹配 + OPEN → true', () => {
  assert.equal(isSessionInUse('foo', new Map([[mkWs(OPEN), { sessionName: 'foo' }]])), true);
});

test('sessionName 匹配但 CLOSED → false', () => {
  assert.equal(isSessionInUse('foo', new Map([[mkWs(CLOSED), { sessionName: 'foo' }]])), false);
});

test('sessionName 不匹配 → false', () => {
  assert.equal(isSessionInUse('foo', new Map([[mkWs(OPEN), { sessionName: 'bar' }]])), false);
});

test('多连接其一匹配 OPEN → true', () => {
  const clients = new Map([
    [mkWs(OPEN), { sessionName: 'bar' }],
    [mkWs(OPEN), { sessionName: 'foo' }],
  ]);
  assert.equal(isSessionInUse('foo', clients), true);
});

test('空 name / 无 clients → false', () => {
  assert.equal(isSessionInUse('', new Map()), false);
  assert.equal(isSessionInUse('foo', null), false);
  assert.equal(isSessionInUse('foo', undefined), false);
});
