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
 * 达 threshold 且过指数退避冷却(settleMs*backoffBase^emitCount,封顶 maxSettleMs)
 * → emit('event', {machine,session,to,from,lastLine,lastTs,ts,emitCount})。
 * 状态切换/会话消失重置 emitCount(从 settleMs 重新退避)。
 * now 可注入以便测试精确断言退避时间,默认 Date.now()。
 * 测试可直接调 _tick()(不依赖真实 setInterval)。
 */
class EventWatcher extends EventEmitter {
  constructor({ getLatest, intervalMs = 2000, threshold = 3, settleMs = 60_000,
                maxSettleMs = 900_000, backoffBase = 2, staleBump = 1, now } = {}) {
    super();
    if (typeof getLatest !== 'function') throw new Error('EventWatcher: getLatest required');
    this._getLatest = getLatest;
    this._intervalMs = intervalMs;
    this._threshold = threshold;
    this._settleMs = settleMs;
    this._maxSettleMs = maxSettleMs;
    this._backoffBase = backoffBase;
    this._staleBump = staleBump;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._counters = new Map(); // key -> { status, n, lastEmitTs, emitCount }
    this._timer = null;
  }
  /** 第 k 次 emit 之后的退避等待(ms):settleMs * backoffBase^k,封顶 maxSettleMs。 */
  _backoffMs(k) {
    return Math.min(this._settleMs * Math.pow(this._backoffBase, k), this._maxSettleMs);
  }

  /** 正向反馈:claude 标记陈旧重复 → 退避加速(emitCount += staleBump,不动 lastEmitTs)。 */
  markStale(machine, session) {
    const c = this._counters.get(`${machine}|${session}`);
    if (c) c.emitCount += this._staleBump;
  }

  /** 反向反馈:签名变化(新症状)→ emitCount 归零,从浅退避重新开始。 */
  markProblemChanged(machine, session) {
    const c = this._counters.get(`${machine}|${session}`);
    if (c) c.emitCount = 0;
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
    const now = this._now();
    const seen = new Set();
    for (const sm of sampleWatched(snap)) {
      const key = `${sm.machine}|${sm.session}`;
      seen.add(key);
      let c = this._counters.get(key);
      if (!c || c.status !== sm.status) c = { status: sm.status, n: 0, lastEmitTs: c ? c.lastEmitTs : 0, emitCount: 0 };
      c.n += 1;
      this._counters.set(key, c);
      if (c.n >= this._threshold && now - c.lastEmitTs >= this._backoffMs(c.emitCount)) {
        c.lastEmitTs = now;
        c.emitCount += 1;
        this.emit('event', { machine: sm.machine, session: sm.session, to: sm.status, from: null, lastLine: sm.lastLine, lastTs: sm.lastTs, ts: now, emitCount: c.emitCount });
      }
    }
    // 不再被采样的 (machine,session) 清掉计数(会话消失/状态转好)
    for (const k of this._counters.keys()) if (!seen.has(k)) this._counters.delete(k);
  }
}

module.exports = { diffEvents, EventWatcher, sampleWatched };
