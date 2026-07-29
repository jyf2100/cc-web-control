'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryStore } = require('../hub/delivery_store.cjs');

test('record:写入条目含 id/kind/data/ts/results/summary', () => {
  let now = 1000;
  const store = new DeliveryStore({ nowFn: () => now });
  const entry = store.record({
    kind: 'broadcast',
    data: 'npm test',
    results: [{ machine: 'mc1', session: 's1', status: 'delivered', ok: true }],
    summary: { total: 1, delivered: 1, failed: 0, offline: 0, unknown: 0 },
  });
  assert.equal(entry.kind, 'broadcast');
  assert.equal(entry.data, 'npm test');
  assert.equal(entry.ts, 1000);
  assert.equal(entry.results.length, 1);
  assert.ok(typeof entry.id === 'string');
});

test('recent:返回最近 N 条(正序)', () => {
  let now = 0;
  const store = new DeliveryStore({ nowFn: () => ++now });
  store.record({ kind: 'broadcast', data: 'a', results: [], summary: null });
  store.record({ kind: 'intervene', data: 'b', results: [], summary: null });
  store.record({ kind: 'broadcast', data: 'c', results: [], summary: null });
  const recent = store.recent(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].data, 'b');
  assert.equal(recent[1].data, 'c');
});

test('recent:limit 默认 50,上限 200', () => {
  const store = new DeliveryStore({ nowFn: () => 1 });
  for (let i = 0; i < 10; i++) {
    store.record({ kind: 'broadcast', data: `d${i}`, results: [], summary: null });
  }
  assert.equal(store.recent().length, 10);
  assert.equal(store.recent(5).length, 5);
  assert.equal(store.recent(0).length, 1);  // clamp min 1
  assert.equal(store.recent(999).length, 10); // 不会超过实际数量
});

test('maxEntries:超限时裁掉最旧条目(环形缓冲)', () => {
  let now = 0;
  const store = new DeliveryStore({ maxEntries: 3, nowFn: () => ++now });
  store.record({ kind: 'broadcast', data: 'a', results: [], summary: null });
  store.record({ kind: 'broadcast', data: 'b', results: [], summary: null });
  store.record({ kind: 'broadcast', data: 'c', results: [], summary: null });
  store.record({ kind: 'broadcast', data: 'd', results: [], summary: null }); // 超限
  assert.equal(store.size(), 3);
  const all = store.recent(100);
  assert.equal(all[0].data, 'b');  // 'a' 被裁掉
  assert.equal(all[2].data, 'd');
});

test('clear:清空所有条目', () => {
  const store = new DeliveryStore({ nowFn: () => 1 });
  store.record({ kind: 'broadcast', data: 'x', results: [], summary: null });
  assert.equal(store.size(), 1);
  store.clear();
  assert.equal(store.size(), 0);
  assert.deepEqual(store.recent(), []);
});

test('record:data 非字符串时存空串(results 非数组时存空数组)', () => {
  const store = new DeliveryStore({ nowFn: () => 1 });
  const entry = store.record({ kind: 'intervene', data: 42, results: null, summary: undefined });
  assert.equal(entry.data, '');
  assert.deepEqual(entry.results, []);
  assert.equal(entry.summary, null);
});

test('record:results 深拷贝(不持外部引用)', () => {
  const store = new DeliveryStore({ nowFn: () => 1 });
  const results = [{ machine: 'mc1', status: 'delivered' }];
  const entry = store.record({ kind: 'broadcast', data: 'x', results, summary: null });
  results[0].status = 'failed';  // 外部突变
  assert.equal(entry.results[0].status, 'delivered');  // 不受影响
});
