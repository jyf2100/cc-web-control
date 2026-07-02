// hub/event_watcher.cjs
'use strict';

const { EventEmitter } = require('events');

const WATCHED = new Set(['errored', 'idle']);

/** 当前快照里所有「值得看的」(machine,session,status,lastLine,lastTs)采样。 */
function sampleWatched(snap) {
  const out = [];
  for (const m of (snap && snap.machines) || []) {
    if (!m.online) continue;
    for (const s of m.sessions || []) {
      if (WATCHED.has(s.status)) {
        out.push({ machine: m.id, session: s.name, status: s.status, lastLine: s.lastLine, lastTs: s.lastTs });
      }
    }
  }
  return out;
}

/**
 * 纯函数:对比两份快照,返回状态**边沿**变化(任意→errored / 任意→idle)。
 * 供单测与「首次进入」判定;EventWatcher 的去抖基于采样值,不依赖此函数每轮都报。
 */
function diffEvents(prev, curr) {
  const out = [];
  const prevStates = new Map();
  for (const m of (prev && prev.machines) || []) {
    for (const s of m.sessions || []) prevStates.set(`${m.id}|${s.name}`, s.status);
  }
  for (const sm of sampleWatched(curr)) {
    const key = `${sm.machine}|${sm.session}`;
    const from = prevStates.has(key) ? prevStates.get(key) : null;
    if (from !== sm.status) {
      out.push({ machine: sm.machine, session: sm.session, from, to: sm.status, lastLine: sm.lastLine, lastTs: sm.lastTs });
    }
  }
  return out;
}

/**
 * 定时读 getLatest(),对每个 (machine,session) 维护「连续采样同状态」计数;
 * 达 threshold 且过 settleMs 冷却 → emit('event', {machine,session,to,from,lastLine,lastTs,ts})。
 * 测试可直接调 _tick()(不依赖真实 setInterval)。
 */
class EventWatcher extends EventEmitter {
  constructor({ getLatest, intervalMs = 2000, threshold = 3, settleMs = 60_000 } = {}) {
    super();
    if (typeof getLatest !== 'function') throw new Error('EventWatcher: getLatest required');
    this._getLatest = getLatest;
    this._intervalMs = intervalMs;
    this._threshold = threshold;
    this._settleMs = settleMs;
    this._counters = new Map(); // key -> { status, n, lastEmitTs }
    this._timer = null;
  }
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this._intervalMs);
    if (this._timer.unref) this._timer.unref();
  }
  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
  _tick() {
    const snap = this._getLatest() || { machines: [] };
    const now = Date.now();
    const seen = new Set();
    for (const sm of sampleWatched(snap)) {
      const key = `${sm.machine}|${sm.session}`;
      seen.add(key);
      let c = this._counters.get(key);
      if (!c || c.status !== sm.status) c = { status: sm.status, n: 0, lastEmitTs: c ? c.lastEmitTs : 0 };
      c.n += 1;
      this._counters.set(key, c);
      if (c.n >= this._threshold && now - c.lastEmitTs >= this._settleMs) {
        c.lastEmitTs = now;
        this.emit('event', { machine: sm.machine, session: sm.session, to: sm.status, from: null, lastLine: sm.lastLine, lastTs: sm.lastTs, ts: now });
      }
    }
    // 不再被采样的 (machine,session) 清掉计数(会话消失/状态转好)
    for (const k of this._counters.keys()) if (!seen.has(k)) this._counters.delete(k);
  }
}

module.exports = { diffEvents, EventWatcher, sampleWatched };
