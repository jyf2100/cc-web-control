'use strict';

const WebSocket = require('ws');

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;

class AgentClient {
  constructor({ id, url, token }) {
    this.id = id;
    this.url = url;       // http://host:port
    this.token = token;
    // per-session: { ws, refs:Set<subscriber>, retry:timer, promises }
    this._pool = new Map();
  }

  // —— HTTP ——
  async fetchDashboard() {
    try {
      const res = await fetch(`${this.url}/api/dashboard`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return { ok: false, error: `${res.status}` };
      const payload = await res.json();
      return { ok: true, payload };
    } catch (e) {
      return { ok: false, error: e.code || e.message };
    }
  }

  async createSession({ name, cwd }) {
    try {
      const res = await fetch(`${this.url}/api/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cwd }),
      });
      return { ok: res.ok, status: res.status, body: res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => '') };
    } catch (e) {
      return { ok: false, status: 0, error: e.code || e.message };
    }
  }

  async deleteSession(name) {
    try {
      const res = await fetch(`${this.url}/api/sessions/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, status: 0, error: e.code || e.message };
    }
  }

  // —— WS 池(懒连接 + 引用计数) ——
  // 返回 handle: { detach(), send(msg), once('open') }
  // once('open') 等首次连接建立;首次连接失败会 reject(promise 已 settle 后再 resolve/reject 为 no-op)
  attachSession(session, onMessage) {
    let entry = this._pool.get(session);
    if (!entry) {
      entry = this._createEntry(session);
      this._pool.set(session, entry);
    }
    entry.refs.add(onMessage);
    const handle = {
      _onMessage: onMessage,
      _session: session,
      detach: () => this._detach(session, onMessage),
      send: (msg) => this._send(session, msg),
      once: (ev) => entry.promises[ev] || Promise.resolve(),
    };
    return handle;
  }

  _createEntry(session) {
    const entry = { ws: null, refs: new Set(), retry: null, promises: {} };
    entry.promises.open = new Promise((res, rej) => { entry._resolveOpen = res; entry._rejectOpen = rej; });
    this._connect(session, entry);
    return entry;
  }

  _connect(session, entry) {
    // 覆盖前先关旧连接(防御 error/close 延迟到达的边沿竞态,自愈加固)
    if (entry.ws && entry.ws.readyState <= 1) {
      try { entry.ws.close(); } catch {}
    }
    const wsUrl = this.url.replace(/^http/, 'ws') + `/?session=${encodeURIComponent(session)}`;
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } });
    entry.ws = ws;
    ws.on('open', () => { entry._resolveOpen(); });
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      for (const cb of entry.refs) cb(msg);
    });
    ws.on('error', (err) => {
      try { entry._rejectOpen(err); } catch {} // 首次连接失败:让 await once('open') 等待者得到 rejection(promise 已 settle 则 no-op)
      for (const cb of entry.refs) cb({ type: 'error', data: err.message });
    });
    ws.on('close', () => {
      if (entry.refs.size === 0) return; // 已无人订阅,不再重连
      this._scheduleReconnect(session, entry);
    });
  }

  _scheduleReconnect(session, entry) {
    if (entry.retry) return;
    const attempt = (entry._attempt = (entry._attempt || 0) + 1);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
    entry.retry = setTimeout(() => {
      entry.retry = null;
      if (entry.refs.size > 0) this._connect(session, entry);
    }, delay);
  }

  _send(session, msg) {
    const entry = this._pool.get(session);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  _detach(session, onMessage) {
    const entry = this._pool.get(session);
    if (!entry) return;
    entry.refs.delete(onMessage);
    if (entry.refs.size === 0) {
      if (entry.retry) { clearTimeout(entry.retry); entry.retry = null; }
      try { entry.ws && entry.ws.close(); } catch {}
      this._pool.delete(session);
    }
  }

  _poolSize(session) { const e = this._pool.get(session); return e ? e.refs.size : 0; }

  _hasReconnectTimer(session) {
    const e = this._pool.get(session);
    return !!(e && e.retry);
  }

  // —— 一次性发送(广播用):临时建连、发完即关 ——
  async sendOneShot(session, msg) {
    // 若已有池连接则直接复用
    const entry = this._pool.get(session);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify(msg));
      return { ok: true };
    }
    const wsUrl = this.url.replace(/^http/, 'ws') + `/?session=${encodeURIComponent(session)}`;
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } });
      const timer = setTimeout(() => { try { ws.close(); } catch {}; resolve({ ok: false, error: 'timeout' }); }, 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify(msg));
        clearTimeout(timer);
        setTimeout(() => { try { ws.close(); } catch {} }, 100);
        resolve({ ok: true });
      });
      ws.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }); });
    });
  }

  close() {
    for (const [, entry] of this._pool) {
      // 先清 refs:ws.close() 会触发 'close',此时 refs 为空 → 不调度重连,
      // 否则会留下引用计数 > 0 的重连 timer,撑住进程不退出。
      entry.refs.clear();
      if (entry.retry) { clearTimeout(entry.retry); entry.retry = null; }
      try { entry.ws && entry.ws.close(); } catch {}
    }
    this._pool.clear();
  }
}

module.exports = { AgentClient, RECONNECT_BASE_MS, RECONNECT_MAX_MS };
