'use strict';

const PRIORITY = { errored: 0, idle: 1, waiting: 2 };

/**
 * 归一化 lastLine 为「内容签名」,用于判断是否同一问题的重复。
 * 剥时间戳/run-id/孤立数字 → 折叠空白 → 小写。保守:空/太短(<4)返回 null = 不抑制。
 */
function _sig(lastLine) {
  if (typeof lastLine !== 'string' || lastLine.length === 0) return null;
  const s = lastLine
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '')
    .replace(/\d{10,13}/g, '')
    .replace(/run-\d+/g, '')
    .replace(/\b\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return s.length >= 4 ? s : null;
}

/** 把 ack outcome 文本归类为调度语义,仅前缀匹配,不解析内容。 */
function classifyOutcome(outcome) {
  if (typeof outcome !== 'string') return 'unknown';
  const s = outcome.trim().toLowerCase();
  if (s.startsWith('noop')) return 'noop';
  if (s.startsWith('advised')) return 'advised';
  return 'unknown';
}

class AgentDispatcher {
  constructor({
    tmux, audit, session = 'cc-main-agent',
    pokeText = (runId) => `[event] id=${runId} new event; call dequeue_event then ack_event`,
    ackTimeoutMs = 5 * 60 * 1000, maxRetries = 2, maxQueue = 20,
    onStaleAck = null, onProblemChanged = null,
    rePokeAfterMs = 900_000, resolveMs = 2 * 60 * 60 * 1000,
  } = {}) {
    if (!tmux) throw new Error('AgentDispatcher: tmux required');
    if (!audit) throw new Error('AgentDispatcher: audit required');
    this._tmux = tmux;
    this._audit = audit;
    this._session = session;
    this._pokeText = pokeText;
    this._ackTimeoutMs = ackTimeoutMs;
    this._maxRetries = maxRetries;
    this._maxQueue = maxQueue;
    this._onStaleAck = onStaleAck;
    this._onProblemChanged = onProblemChanged;
    this._rePokeAfterMs = rePokeAfterMs;
    this._resolveMs = resolveMs;
    this._queue = [];
    this._current = null;
    this._runCounter = 0;
    this._frozen = false;
    this._repeat = new Map(); // key -> { sig, lastPokeTs, lastOutcome }
  }

  _newRunId() { this._runCounter += 1; return `run-${process.pid}-${this._runCounter}`; }
  _key(e) { return `${e.machine}|${e.session}`; }

  enqueue(event) {
    if (this._frozen) return false;
    this._gcRepeat();
    const key = this._key(event);
    const sig = _sig(event.lastLine);
    if (sig === null) { this._realEnqueue(event); return true; } // 签名不可靠 → 保守放行
    const now = Date.now();
    const r = this._repeat.get(key);
    if (r === undefined) {
      this._repeat.set(key, { sig, lastPokeTs: now, lastOutcome: null });
      this._realEnqueue(event);
      return true;
    }
    if (r.sig !== sig) {
      this._repeat.set(key, { sig, lastPokeTs: now, lastOutcome: null });
      if (this._onProblemChanged) this._onProblemChanged(event.machine, event.session);
      this._realEnqueue(event);
      return true;
    }
    // sig 相同(旧问题)
    if (now - r.lastPokeTs >= this._rePokeAfterMs) {
      r.lastPokeTs = now;
      this._realEnqueue(event);
      return true;
    }
    this._audit.log({ scope: 'dispatcher', runId: null, event: 'repeat_suppressed', detail: { target: `${event.machine}/${event.session}`, sig } });
    return true;
  }

  /** 原队列管理(溢出处理 + 同 target 合并 + 优先级排序 + pump)。 */
  _realEnqueue(event) {
    // 同 target 正被 _current 处理(未 ack)→ 刷新为最新症状并直接 re-poke,不排队。
    // 排队要等 ack 后才处理,那时旧症状已过时;这正是 rePokeAfterMs/sig变化/sig=null「放行」的落地语义。
    // 仅对 sig-gate 已判定「值得 poke」的 event 触发(同 sig 未到期已在 enqueue 被 repeat_suppressed 拦截)。
    const cur = this._current;
    if (cur && this._key(cur.event) === this._key(event)) {
      cur.event = event;
      this._poke(); // fire-and-forget;_poke 内部会重置 ack 计时器
      return;
    }
    if (this._queue.length >= this._maxQueue) {
      const idx = this._queue.findIndex((e) => this._key(e) === this._key(event));
      if (idx >= 0) this._queue.splice(idx, 1);          // 合并同 target
      else { this._queue.shift(); this._audit.log({ scope: 'dispatcher', runId: null, event: 'queue_overflow_drop', detail: { machine: event.machine, session: event.session } }); }
    }
    this._queue.push(event);
    this._queue.sort((a, b) => (PRIORITY[a.to] ?? 9) - (PRIORITY[b.to] ?? 9));
    this._pump(); // fire-and-forget
  }

  /** 懒 GC:清理长期未再 poke 的 repeater,防内存增长。 */
  _gcRepeat() {
    const now = Date.now();
    for (const [k, r] of this._repeat) {
      if (now - r.lastPokeTs >= this._resolveMs) this._repeat.delete(k);
    }
  }

  async _pump() {
    if (this._current || this._frozen) return;
    const next = this._queue.shift();
    if (!next) return;
    const runId = this._newRunId();
    // 关键:_current 在首个 await 之前赋值,杜绝同栈连续 enqueue 双取
    this._current = { runId, event: next, retry: 0, timer: null };
    await this._audit.log({ scope: 'dispatcher', runId, event: 'dequeue', detail: { target: `${next.machine}/${next.session}`, type: next.to } });
    await this._poke();
  }

  async _poke() {
    const c = this._current;
    if (!c) return;
    const text = this._pokeText(c.runId);
    try {
      await this._tmux.poke(this._session, text);
      await this._audit.log({ scope: 'dispatcher', runId: c.runId, event: 'poke', detail: { retry: c.retry } });
    } catch (e) {
      await this._audit.log({ scope: 'dispatcher', runId: c.runId, event: 'poke_error', detail: { error: e.message } });
    }
    this._armAckTimer();
  }

  _armAckTimer() {
    const c = this._current;
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => { this._onAckTimeout(); }, this._ackTimeoutMs);
    if (c.timer.unref) c.timer.unref();
  }

  async _onAckTimeout() {
    const c = this._current;
    if (!c) return;
    c.retry += 1;
    if (c.retry > this._maxRetries) {
      await this._audit.log({ scope: 'dispatcher', runId: c.runId, event: 'ack_timeout_drop', detail: { retries: c.retry - 1 } });
      this._current = null;
      this._pump();
      return;
    }
    await this._audit.log({ scope: 'dispatcher', runId: c.runId, event: 'ack_timeout_retry', detail: { retry: c.retry } });
    await this._poke();
  }

  async ack(runId, outcome) {
    const c = this._current;
    if (!c || c.runId !== runId) {
      await this._audit.log({ scope: 'dispatcher', runId, event: 'ack_stale', detail: { outcome } });
      return false;
    }
    // 回填 repeater(清理 _current 之前,以便取到 c.event)
    const key = this._key(c.event);
    const r = this._repeat.get(key);
    if (r) r.lastOutcome = outcome;
    // 正向反馈:claude 标记陈旧重复 → watcher 加速退避
    if (classifyOutcome(outcome) === 'noop' && this._onStaleAck) {
      this._onStaleAck(c.event.machine, c.event.session);
    }
    if (c.timer) clearTimeout(c.timer);
    await this._audit.log({ scope: 'dispatcher', runId: c.runId, event: 'ack', detail: { outcome } });
    this._current = null;
    this._pump();
    return true;
  }

  async dequeueEvent() {
    const c = this._current;
    if (!c) return null;
    await this._audit.log({ scope: 'mcp', runId: c.runId, event: 'dequeue_event', detail: {} });
    return { runId: c.runId, event: c.event };
  }

  freeze() { this._frozen = true; const c = this._current; if (c && c.timer) clearTimeout(c.timer); }
  unfreeze() { this._frozen = false; this._pump(); }
}

module.exports = { AgentDispatcher, PRIORITY, _sig, classifyOutcome };
