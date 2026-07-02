'use strict';

const BROADCAST_MAX_TARGETS = 50;

class WsBridge {
  constructor({ getClient }) {
    this._getClient = getClient; // (machineId) => { attach, sendOneShot, getById } | null
  }

  // 处理一条浏览器 WS 连接
  handleConnection(ws) {
    // 每条浏览器连接维护「当前 attach 的 handle」
    let current = null; // { machine, session, handle }

    const detachCurrent = () => {
      if (current) { try { current.handle.detach(); } catch {} current = null; }
    };

    ws.on('message', async (raw) => {
      let payload; try { payload = JSON.parse(raw.toString()); } catch { return; }
      const { type } = payload || {};

      if (type === 'attach') {
        detachCurrent();
        const { machine, session } = payload.target || {};
        const client = this._getClient(machine);
        if (!client || !client.getById(machine)) { this._send(ws, { type: 'error', target: payload.target, data: `unknown machine: ${machine}` }); return; }
        const handle = client.attach(session, (msg) => {
          this._send(ws, { ...msg, target: { machine, session } });
        });
        current = { machine, session, handle };
        return;
      }

      if (type === 'detach') { detachCurrent(); return; }

      if (type === 'input' || type === 'key' || type === 'batch') {
        const { machine, session } = payload.target || {};
        if (!current || current.machine !== machine || current.session !== session) {
          // 临时路径:允许未 attach 的 target 走 sendOneShot(input/key/batch)
          const client = this._getClient(machine);
          if (!client) { this._send(ws, { type: 'error', target: payload.target, data: `unknown machine: ${machine}` }); return; }
          const r = await client.sendOneShot(session, { type, data: payload.data, enter: payload.enter });
          if (!r.ok) this._send(ws, { type: 'error', target: payload.target, data: r.error || 'send failed' });
          return;
        }
        const ok = current.handle.send({ type, data: payload.data, enter: payload.enter });
        if (!ok) this._send(ws, { type: 'error', target: payload.target, data: 'session not connected' });
        return;
      }

      if (type === 'broadcast') {
        await this.handleBroadcast(ws, payload);
        return;
      }
    });

    ws.on('close', () => detachCurrent());
    ws.on('error', () => detachCurrent());
  }

  async handleBroadcast(ws, payload) {
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (targets.length > BROADCAST_MAX_TARGETS) {
      this._send(ws, { type: 'error', data: `broadcast targets 超过上限 ${BROADCAST_MAX_TARGETS}` });
      return;
    }
    // 去重(同 machine+session)
    const seen = new Set();
    const dedup = [];
    for (const t of targets) {
      const key = `${t.machine}/${t.session}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(t);
    }
    const results = await Promise.all(dedup.map(async (t) => {
      const client = this._getClient(t.machine);
      if (!client) return { target: t, ok: false, error: `unknown machine: ${t.machine}` };
      const r = await client.sendOneShot(t.session, { type: 'input', data: payload.data, enter: payload.enter });
      return { target: t, ok: r.ok, error: r.ok ? undefined : r.error };
    }));
    this._send(ws, { type: 'broadcast_result', results });
  }

  _send(ws, obj) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

module.exports = { WsBridge, BROADCAST_MAX_TARGETS };
