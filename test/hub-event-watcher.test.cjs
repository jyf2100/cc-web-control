// test/hub-event-watcher.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffEvents, EventWatcher } = require('../hub/event_watcher.cjs');

const snap = (machines) => ({ machines });

test('diffEvents: 进入 errored 记一条', () => {
  const prev = snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'working' }] }]);
  const curr = snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'errored', lastLine: 'boom' }] }]);
  const out = diffEvents(prev, curr);
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 'errored');
  assert.equal(out[0].from, 'working');
  assert.equal(out[0].lastLine, 'boom');
});

test('diffEvents: 首次出现(prev 无)且 errored/idle 也记', () => {
  const out = diffEvents(snap([]), snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'idle' }] }]));
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 'idle');
  assert.equal(out[0].from, null);
});

test('diffEvents: 持续 errored(无变化)不重复报', () => {
  const prev = snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'errored' }] }]);
  const curr = snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'errored' }] }]);
  assert.equal(diffEvents(prev, curr).length, 0);
});

test('diffEvents: 离线机不产事件', () => {
  const out = diffEvents(snap([]), snap([{ id: 'm1', online: false, sessions: [{ name: 's1', status: 'errored' }] }]));
  assert.equal(out.length, 0);
});

test('EventWatcher: 连续 threshold 轮采样 errored 才 emit;中途 reset 重计', () => {
  let latest = snap([]);
  const w = new EventWatcher({ getLatest: () => latest, threshold: 3, settleMs: 0 });
  const emitted = [];
  w.on('event', (e) => emitted.push(e));
  const errored = snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'errored' }] }]);
  const working = snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'working' }] }]);

  latest = errored; w._tick(); // 采样到 errored,计数 1
  assert.equal(emitted.length, 0);
  latest = errored; w._tick(); // 计数 2
  assert.equal(emitted.length, 0);
  latest = working; w._tick(); // 中途变 working,计数 reset
  latest = errored; w._tick(); // 计数 1
  latest = errored; w._tick(); // 计数 2
  latest = errored; w._tick(); // 计数 3 → emit
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].to, 'errored');
});
