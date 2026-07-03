// hub/local_tmux_client.cjs
'use strict';

/**
 * 把本机 tmux session 翻译成 ws_bridge 期望的「远程 agent」形状。
 * 引用计数共享池:同 session 多连接共享 1 个 capture 轮询(照搬 AgentClient._pool)。
 * 只读:send/sendOneShot 永不调 poke/sendKey。
 */

/** 首帧 init 的 tmux scrollback 行数(提供足够历史供前端覆盖显示;非 timeout)。 */
const INIT_SCROLLBACK_LINES = 2000;

class LocalTmuxClient {
  constructor({ localTmux, sessionName, audit, pollMs = 1000 } = {}) {
    if (!localTmux || !sessionName || !audit) throw new Error('localTmux, sessionName, audit required');
    this._lt = localTmux;
    this._session = sessionName;
    this._audit = audit;
    this._pollMs = pollMs;
    this._pool = new Map(); // session -> { id, subs:Set<fn>, timer, lastCaptured }
    this._seq = 0;
  }

  // Task 4 实现 redact;本 task 透传
  _redact(text) { return text; }

  _broadcast(entry, msg) {
    for (const cb of entry.subs) {
      try { cb(msg); } catch {}
    }
  }

  _captureOnce(session, entryId) {
    this._lt.capture(session, INIT_SCROLLBACK_LINES).then((captured) => {
      const e = this._pool.get(session);
      if (!e || e.id !== entryId) return; // 陈旧回调 early-return(R3-M1)
      if (captured === e.lastCaptured) return;
      e.lastCaptured = captured;
      this._broadcast(e, { type: 'init', data: this._redact(captured) });
    }).catch(() => {
      // Task 4 增强:kill 回收四件套
    });
  }

  attach(session, onMsg) {
    if (session !== this._session) {
      try { onMsg({ type: 'error', data: 'unknown session' }); } catch {}
      return { send: () => false, detach: () => {} }; // dummy handle(L4)
    }
    let entry = this._pool.get(session);
    if (entry && entry.lastCaptured != null) {
      entry.subs.add(onMsg);
      try { onMsg({ type: 'init', data: this._redact(entry.lastCaptured) }); } catch {}
      return this._handle(session, onMsg);
    }
    if (!entry) {
      entry = { id: ++this._seq, subs: new Set(), timer: null, lastCaptured: null };
      this._pool.set(session, entry);
    }
    entry.subs.add(onMsg);
    if (entry.timer) {
      // 首 capture 已在途中 + interval 已 arm:复用,避免重复起轮询(H1 共享池)。
      // 第二订阅者会由在途 capture resolve 时的 _broadcast 收到 init。
      return this._handle(session, onMsg);
    }
    const entryId = entry.id;
    this._captureOnce(session, entryId); // 首 capture(async)
    entry.timer = setInterval(() => this._captureOnce(session, entryId), this._pollMs);
    if (entry.timer.unref) entry.timer.unref(); // R2-M1:防 hub close 被 timer 撑住
    return this._handle(session, onMsg);
  }

  _handle(session, onMsg) {
    return {
      // 只读:不调 poke/sendKey(Task 4 加审计)
      send: () => false,
      detach: () => {
        const e = this._pool.get(session);
        if (!e) return;
        e.subs.delete(onMsg);
        if (e.subs.size === 0) {
          if (e.timer) { clearInterval(e.timer); e.timer = null; }
          this._pool.delete(session);
        }
      },
    };
  }

  async sendOneShot() {
    // Task 4 加审计
    return { ok: false, error: 'read-only' };
  }

  close() {
    for (const [, e] of this._pool) {
      if (e.timer) { clearInterval(e.timer); e.timer = null; }
      e.subs.clear();
    }
    this._pool.clear();
  }
}

module.exports = { LocalTmuxClient };
