'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventWatcher } = require('../hub/event_watcher.cjs');

const snap = (machines) => ({ machines });
const errored = (id = 'm1', s = 's1', lastLine = 'boom') =>
  snap([{ id, online: true, sessions: [{ name: s, status: 'errored', lastLine }] }]);

// 用注入时钟 now 驱动 _tick,避免依赖真实 Date.now() 的连续调用。
function makeWatcher({ settleMs = 60_000, maxSettleMs = 900_000, backoffBase = 2 } = {}) {
  let now = 1_000_000;
  const emitted = [];
  let latest = snap([]);
  const w = new EventWatcher({
    getLatest: () => latest, intervalMs: 1000, threshold: 1, settleMs, maxSettleMs, backoffBase,
    now: () => now,
  });
  w.on('event', (e) => emitted.push({ at: now, emitCount: e.emitCount }));
  return {
    w, emitted,
    setLatest(v) { latest = v; },
    advance(ms) { now += ms; },
  };
}

test('退避序列:_backoffMs(k)=settleMs*2^k,封顶 maxSettleMs', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000, maxSettleMs: 900_000, backoffBase: 2 });
  setLatest(errored());
  w._tick();                       // emit#1(emitCount 0→1)
  assert.equal(emitted.length, 1);
  advance(119_000); w._tick();     // <backoffMs(1)=120s → 不 emit
  assert.equal(emitted.length, 1);
  advance(1_000); w._tick();       // =120s → emit#2(1→2)
  assert.equal(emitted.length, 2);
  advance(240_000); w._tick();     // backoffMs(2)=240s → emit#3(2→3)
  assert.equal(emitted.length, 3);
  advance(480_000); w._tick();     // backoffMs(3)=480s → emit#4(3→4)
  assert.equal(emitted.length, 4);
  advance(900_000); w._tick();     // backoffMs(4)=min(960,900)=900 封顶 → emit#5(4→5)
  assert.equal(emitted.length, 5);
  advance(900_000); w._tick();     // backoffMs(5)=900 封顶 → emit#6(5→6)
  assert.equal(emitted.length, 6);
});

test('状态切换重置 emitCount(idle→errored 从 settleMs 重新退避)', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000 });
  setLatest(snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'idle' }] }]));
  w._tick(); advance(120_000); w._tick();   // idle emit 两次,emitCount=2
  assert.equal(emitted.length, 2);
  setLatest(errored());                      // 切 errored → emitCount 重置为 0
  w._tick();                                 // lastEmitTs 保留,本轮不 emit
  advance(60_000); w._tick();                // backoffMs(0)=60s → emit(emitCount 0→1)
  assert.equal(emitted.at(-1).emitCount, 1);
});

test('recover(会话消失)→ counter 删除;复发重置 emitCount', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000 });
  setLatest(errored());
  w._tick(); advance(120_000); w._tick();   // emit 两次,emitCount=2
  setLatest(snap([])); w._tick();            // recover → counter 删除
  setLatest(errored());                      // 复发
  w._tick();                                 // 新 counter {emitCount:0} → emit(0→1)
  assert.equal(emitted.at(-1).emitCount, 1);
});

test('markStale: emitCount += staleBump(加速退避)', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000, staleBump: 1 });
  setLatest(errored());
  w._tick();                        // emit#1(emitCount 0→1)
  advance(120_000); w._tick();      // emit#2(1→2);backoffMs(1)=120s
  assert.equal(emitted.length, 2);
  w.markStale('m1', 's1');          // emitCount 2→3,下次要等 backoffMs(3)=480s
  advance(479_000); w._tick();      // <480s → 不 emit
  assert.equal(emitted.length, 2);
  advance(1_000); w._tick();        // =480s → emit(3→4)
  assert.equal(emitted.length, 3);
});

test('markProblemChanged: emitCount=0(下次按 settleMs)', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000 });
  setLatest(errored());
  w._tick(); advance(120_000); w._tick(); advance(240_000); w._tick();  // emit#1/#2/#3,emitCount=3
  assert.equal(emitted.length, 3);
  w.markProblemChanged('m1', 's1');   // emitCount=0
  advance(60_000); w._tick();         // backoffMs(0)=settleMs=60s → emit(0→1)
  assert.equal(emitted.length, 4);
  assert.equal(emitted.at(-1).emitCount, 1);
});

test('markStale/markProblemChanged: 未知 key 静默忽略(不抛错)', () => {
  const { w } = makeWatcher();
  assert.doesNotThrow(() => w.markStale('nope', 'nope'));
  assert.doesNotThrow(() => w.markProblemChanged('nope', 'nope'));
});
