'use strict';

const PRIORITY = { errored: 0, idle: 1, waiting: 2 };

class AgentDispatcher {
  constructor({
    tmux, audit, session = 'cc-main-agent',
    pokeText = (runId) => `[event] id=${runId} new event; call dequeue_event then ack_event`,
    ackTimeoutMs = 5 * 60 * 1000, maxRetries = 2, maxQueue = 20,
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
    this._queue = [];
    this._current = null;
    this._runCounter = 0;
    this._frozen = false;
  }

  _newRunId() { this._runCounter += 1; return `run-${process.pid}-${this._runCounter}`; }
  _key(e) { return `${e.machine}|${e.session}`; }

  enqueue(event) {
    if (this._frozen) return false;
    if (this._queue.length >= this._maxQueue) {
      const idx = this._queue.findIndex((e) => this._key(e) === this._key(event));
      if (idx >= 0) this._queue.splice(idx, 1);          // 合并同 target
      else { this._queue.shift(); this._audit.log({ scope: 'dispatcher', runId: null, event: 'queue_overflow_drop', detail: { machine: event.machine, session: event.session } }); }
    }
    this._queue.push(event);
    this._queue.sort((a, b) => (PRIORITY[a.to] ?? 9) - (PRIORITY[b.to] ?? 9));
    this._pump(); // fire-and-forget
    return true;
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
    if (c.timer) clearTimeout(c.timer);
    await this._audit.log({ scope: 'dispatcher', runId, event: 'ack', detail: { outcome } });
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

module.exports = { AgentDispatcher, PRIORITY };
