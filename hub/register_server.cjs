'use strict';

// hub 侧注册处理器:接受单机反向 WS(/api/hub/agent),鉴权 → 校验 → registry.add + 建 AgentClient。
// 连接断开即 remove;回连失败经 notifyUnreachable 回送告警帧;空闲超时防假死;同 id 抢占告警。
const { validateMachine } = require('./config.cjs');

const IDLE_TIMEOUT_MS = 60000;
const USURP_WINDOW_MS = 60000;
const USURP_THRESHOLD = 3;
const WS_CLOSE_POLICY = 1008;

function bearerFromReq(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

class AgentRegistrar {
  constructor({ registry, clients, AgentClientCtor, hubToken, registerToken = '', idleTimeoutMs = IDLE_TIMEOUT_MS, log = console }) {
    this._registry = registry;
    this._clients = clients;
    this._AgentClientCtor = AgentClientCtor;
    this._expectedToken = registerToken || hubToken;
    this._idleTimeoutMs = idleTimeoutMs;
    this._log = log;
    this._connsById = new Map();   // id -> ws(活跃注册连接)
    this._idleTimers = new Map();  // ws -> timer
    this._usurp = new Map();       // id -> number[](近窗覆盖时间戳)
  }

  // 由 hub/server.cjs 的 wss.on('connection') 在路径=/api/hub/agent 时调用
  accept(ws, req) {
    if (bearerFromReq(req) !== this._expectedToken) {
      try { ws.close(WS_CLOSE_POLICY, 'Unauthorized'); } catch {}
      return;
    }
    this._armIdle(ws);

    const onMessage = (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (!m) return;
      // spec §3.4/§4.4:客户端心跳 ping → 回 pong + 重置 idle 计时器
      // (否则注册后 ping 被忽略,idle 不重置 → 60s 超时断连 → 终端每分钟死一次)
      if (m.type === 'ping') {
        this._resetIdle(ws);
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        return;
      }
      if (m.type === 'register') this._handleRegister(ws, m);
    };
    const onClose = () => {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
      this._disarmIdle(ws);
      this._removeByConn(ws);
    };
    ws.on('message', onMessage);
    ws.on('close', onClose);
  }

  _handleRegister(ws, m) {
    let machine;
    try {
      machine = validateMachine({ id: m.id, name: m.name, url: m.url, token: m.token });
    } catch (e) {
      this._log.error?.(`[registrar] 注册帧非法: ${e.message}`);
      try { ws.close(WS_CLOSE_POLICY, 'invalid register'); } catch {}
      return;
    }
    this._recordUsurp(machine.id);
    // 后者覆盖前者:旧连接关闭
    const prev = this._connsById.get(machine.id);
    if (prev && prev !== ws) {
      try { prev.close(1000, 'superseded'); } catch {}
      this._disarmIdle(prev);
      this._removeByConn(prev, { keepRegistry: false }); // 旧连接下线→先清,再用新覆盖
    }
    this._registry.add(machine, ws);
    this._clients.set(machine.id, new this._AgentClientCtor({ id: machine.id, url: machine.url, token: machine.token }));
    this._connsById.set(machine.id, ws);
    this._resetIdle(ws);
    try { ws.send(JSON.stringify({ type: 'registered' })); } catch {}
  }

  _removeByConn(ws, { keepRegistry = false } = {}) {
    let removedId = null;
    for (const [id, c] of this._connsById) {
      if (c === ws) { removedId = id; break; }
    }
    if (!removedId) return;
    this._connsById.delete(removedId);
    if (!keepRegistry) {
      this._registry.remove(removedId);
      const ac = this._clients.get(removedId);
      if (ac) { try { ac.close(); } catch {} this._clients.delete(removedId); }
    }
  }

  _recordUsurp(id) {
    const now = Date.now();
    const arr = (this._usurp.get(id) || []).filter((t) => now - t < USURP_WINDOW_MS);
    arr.push(now);
    this._usurp.set(id, arr);
    if (arr.length >= USURP_THRESHOLD) {
      this._log.warn?.(`[registrar] id "${id}" 疑似多机冲突(短时反复覆盖),建议相关单机显式设 CC_WEB_MACHINE_ID`);
    }
  }

  notifyUnreachable(id, url, error) {
    const ws = this._connsById.get(id);
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ type: 'unreachable', url, error: String(error) })); } catch {}
    }
  }

  _armIdle(ws) {
    this._disarmIdle(ws);
    const t = setTimeout(() => { try { ws.close(1000, 'idle timeout'); } catch {} }, this._idleTimeoutMs);
    t.unref?.();
    this._idleTimers.set(ws, t);
  }
  _resetIdle(ws) { this._armIdle(ws); }
  _disarmIdle(ws) {
    const t = this._idleTimers.get(ws);
    if (t) { clearTimeout(t); this._idleTimers.delete(ws); }
  }

  cleanup() {
    for (const t of this._idleTimers.values()) clearTimeout(t);
    this._idleTimers.clear();
    for (const ws of this._connsById.values()) { try { ws.close(1001, 'hub shutdown'); } catch {} }
    this._connsById.clear();
  }
}

module.exports = { AgentRegistrar, IDLE_TIMEOUT_MS, USURP_WINDOW_MS, USURP_THRESHOLD };
