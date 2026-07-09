'use strict';

// 单机反向注册 client:主动连 hub 的 /api/hub/agent WS,连接即注册、断开自愈重连。
// 数据通道(看板轮询 + 出站 WS 终端)不经此模块。
const WebSocket = require('ws');
const os = require('node:os');
const { ID_RE } = require('./hub/config.cjs');

const PING_INTERVAL_MS = 20000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;
const AUTH_REJECT_BACKOFF_MS = 5 * 60 * 1000;
const AUTH_REJECT_MAX_ATTEMPTS = 3;
const WS_CLOSE_POLICY = 1008;

function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

class RegisterClient {
  constructor({
    hubUrl, registerToken, authToken,
    machineId, machineName, publicUrl,
    bindHost, port,
    pingIntervalMs = PING_INTERVAL_MS,
    reconnectBaseMs = RECONNECT_BASE_MS,
    reconnectMaxMs = RECONNECT_MAX_MS,
    authRejectBackoffMs = AUTH_REJECT_BACKOFF_MS,
    authRejectMaxAttempts = AUTH_REJECT_MAX_ATTEMPTS,
    log = console,
  }) {
    this._hubUrl = hubUrl || '';
    this._registerToken = registerToken || '';
    this._authToken = authToken || '';
    this._machineId = machineId || '';
    this._machineName = machineName || '';
    this._publicUrl = publicUrl || '';
    this._bindHost = bindHost || '127.0.0.1';
    this._port = port;
    this._pingIntervalMs = pingIntervalMs;
    this._reconnectBaseMs = reconnectBaseMs;
    this._reconnectMaxMs = reconnectMaxMs;
    this._authRejectBackoffMs = authRejectBackoffMs;
    this._authRejectMaxAttempts = authRejectMaxAttempts;
    this._log = log;

    // 推导 id
    if (!this._machineId) {
      this._machineId = os.hostname();
      this._log.warn?.('[register] 未设 CC_WEB_MACHINE_ID,默认 hostname 可能在多机环境冲突,建议显式设置');
    }
    // 推导 url
    if (!this._publicUrl) {
      this._publicUrl = `http://${this._bindHost}:${this._port}`;
    }
    // 自检:报告 url 不可被外部回连时告警
    this._warnIfUrlUnreachable();
    // 自检:明文 ws 泄露单机 token
    this._warnIfInsecure();

    this._ws = null;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._authRejectCount = 0;
    this._networkAttempt = 0;
    this._stopped = false;
    this._closing = false;
  }

  _warnIfUrlUnreachable() {
    try {
      const u = new URL(this._publicUrl);
      if (!isLoopback(u.hostname) && isLoopback(this._bindHost)) {
        this._log.warn?.(`[register] 报告 url(${this._publicUrl})对 hub 可能不可达,请设 CC_WEB_PUBLIC_URL`);
      }
    } catch { /* url 非法时由 hub 侧校验拒绝 */ }
  }

  _warnIfInsecure() {
    if (!this._hubUrl) return;
    try {
      const u = new URL(this._hubUrl);
      if (u.protocol === 'http:' && !isLoopback(u.hostname)) {
        this._log.warn?.('[register] hub 为 http,注册帧明文传输单机 token,建议 hub 启用 https/wss');
      }
    } catch { /* hub url 非法则连接时失败 */ }
  }

  enabled() { return !!(this._hubUrl && (this._registerToken || this._authToken)); }

  start() {
    if (!this.enabled()) return;
    this._connect();
  }

  _connect() {
    if (this._stopped || this._closing) return;
    const wsHubUrl = this._hubUrl.replace(/^http/, 'ws');
    let ws;
    try {
      ws = new WebSocket(`${wsHubUrl}/api/hub/agent`, {
        headers: { Authorization: `Bearer ${this._registerToken || this._authToken}` },
      });
    } catch (e) {
      this._scheduleReconnect('network');
      return;
    }
    this._ws = ws;

    ws.on('open', () => {
      this._sendRegister();
      this._pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, this._pingIntervalMs);
    });

    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'registered' || m.type === 'pong') {
        // 注册被接受 / 心跳确认 → 退避计数清零
        this._networkAttempt = 0;
      }
      if (m.type === 'unreachable') {
        this._log.warn?.(`[register] hub 回连失败 url=${m.url} err=${m.error},请检查 CC_WEB_PUBLIC_URL`);
      }
    });

    ws.on('close', (code) => {
      this._clearPing();
      this._ws = null;
      if (this._closing || this._stopped) return;
      if (code === WS_CLOSE_POLICY) {
        // 鉴权/策略拒绝:长退避 + 计数,达上限停止
        this._authRejectCount += 1;
        this._log.error?.(`[register] hub 拒绝注册(close 1008),请检查 token/字段(${this._authRejectCount}/${this._authRejectMaxAttempts})`);
        if (this._authRejectCount >= this._authRejectMaxAttempts) {
          this._log.error?.('[register] 鉴权连续失败达上限,停止重连');
          this._stopped = true;
          return;
        }
        this._scheduleReconnect('auth');
      } else {
        this._scheduleReconnect('network');
      }
    });

    ws.on('error', () => {
      // close 事件会跟随,重连在 close 里调度;此处仅吞错避免 uncaught
    });
  }

  _sendRegister() {
    const id = this._machineId;
    if (!ID_RE.test(id)) {
      this._log.error?.(`[register] machineId 非法(须匹配 ${ID_RE}),断开`);
      this._ws?.close(1008);
      return;
    }
    this._ws.send(JSON.stringify({
      type: 'register',
      id,
      name: this._machineName || id,
      url: this._publicUrl,
      token: this._authToken,
    }));
  }

  _scheduleReconnect(reason) {
    if (this._reconnectTimer || this._stopped || this._closing) return;
    let base;
    if (reason === 'auth') {
      base = this._authRejectBackoffMs;
    } else {
      this._networkAttempt += 1;
      base = Math.min(this._reconnectBaseMs * 2 ** (this._networkAttempt - 1), this._reconnectMaxMs);
    }
    const jitter = base * (0.8 + 0.4 * Math.random()); // ±20%
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, Math.round(jitter));
  }

  _clearPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  close() {
    this._closing = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._clearPing();
    if (this._ws) { try { this._ws.close(1001, 'going away'); } catch {} this._ws = null; }
  }
}

module.exports = {
  RegisterClient,
  PING_INTERVAL_MS, RECONNECT_BASE_MS, RECONNECT_MAX_MS,
  AUTH_REJECT_BACKOFF_MS, AUTH_REJECT_MAX_ATTEMPTS,
};
