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

  // 安全关闭。CONNECTING 态 close()/terminate() 会经 ws 库 abortHandshake →
  // process.nextTick(emitErrorAndClose) 异步 emit 'error'。两条 crash 路:
  //   ① ws 上无 'error' 监听器 → emit 同步 throw(uncaughtException);
  //   ② 'error' 监听器调 _rejectOpen 去 reject 一个无人 await 的 once('open')
  //      promise → unhandledRejection(Node 默认 =throw)。
  // 快速切换会话时首个连接尚未建立即被 detach,正中此坑。修法:摘除所有监听器
  // (杜绝 reject/回调副作用),补一个吞 error 的 no-op 监听器,再按态销毁——
  // nextTick 的 emit('error') 被 no-op 接住,既不 throw 也不 reject。
  _safeClose(ws) {
    if (!ws) return;
    try {
      ws.removeAllListeners();
      ws.on('error', () => {});
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING) {
        ws.terminate();
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch {}
  }

  _connect(session, entry) {
    // 覆盖前先关旧连接(防御 error/close 延迟到达的边沿竞态,自愈加固)
    this._safeClose(entry.ws);
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
      this._safeClose(entry.ws);
      this._pool.delete(session);
    }
  }

  _poolSize(session) { const e = this._pool.get(session); return e ? e.refs.size : 0; }

  _hasReconnectTimer(session) {
    const e = this._pool.get(session);
    return !!(e && e.retry);
  }

  // —— 一次性发送(广播用):临时建连,等对端 init 再发、发完即关 ——
  async sendOneShot(session, msg) {
    // 若已有池连接则直接复用(attach 时已等过 init,message listener 早就位)
    const entry = this._pool.get(session);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify(msg));
      return { ok: true };
    }
    const wsUrl = this.url.replace(/^http/, 'ws') + `/?session=${encodeURIComponent(session)}`;
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } });
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._safeClose(ws); // 与池连接同款安全关闭:杜绝 CONNECTING 态 emit('error') 逃逸
        resolve(result);
      };
      const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), 5000);
      // 关键:等对端 init 帧再发。真机 server.cjs 的 ws.on('message') 注册在
      // `await tmux.capturePane` 之后(server.cjs:555→:593),WS 一 open 就发会把消息
      // 抢在 listener 注册前送达,被 EventEmitter 丢弃(表现为「扇出成功」却没收到)。
      // init 由对端在 listener 注册前后发出,等它再发可保证送达时 listener 已就位。
      // 收到 error 帧(如会话不存在)则如实报失败,不再误报 ok。
      ws.on('message', (buf) => {
        let m; try { m = JSON.parse(buf.toString()); } catch { return; }
        if (!m) return;
        if (m.type === 'init') {
          ws.send(JSON.stringify(msg));
          setTimeout(() => done({ ok: true }), 50); // 给对端一个 tick 读帧、入队再关
        } else if (m.type === 'error') {
          done({ ok: false, error: m.data || 'remote error' });
        }
      });
      ws.on('error', (err) => done({ ok: false, error: err.message }));
    });
  }

  close() {
    for (const [, entry] of this._pool) {
      // _safeClose 已 removeAllListeners('close'),不会回调 _scheduleReconnect;
      // refs.clear() 与清 retry 在此作防御纵深(双重保险),确保无悬空重连 timer 撑住进程不退出。
      entry.refs.clear();
      if (entry.retry) { clearTimeout(entry.retry); entry.retry = null; }
      this._safeClose(entry.ws);
    }
    this._pool.clear();
  }
}

module.exports = { AgentClient, RECONNECT_BASE_MS, RECONNECT_MAX_MS };
