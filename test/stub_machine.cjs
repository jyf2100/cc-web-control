'use strict';
// 假机器:Express + ws,模拟各机 /api/dashboard + WS(?session=),带 token 校验。
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('node:http');

class StubMachine {
  constructor({ token, dashboardPayload, onWsMessage, listenerDelayMs, connectionError } = {}) {
    this.token = token;
    this.dashboardPayload = dashboardPayload || { tmuxOk: true, sessions: [] };
    this._onWsMessage = onWsMessage;
    // 模拟真机 server.cjs:connection 时先 `await tmux.capturePane`(server.cjs:555),
    // 之后才发 init(:565)并注册 message listener(:593)。设此值 >0 让 connection
    // handler 变 async 并延迟发 init + 注册 listener,复现 sendOneShot 的时序竞态。
    this.listenerDelayMs = listenerDelayMs || 0;
    // 模拟对端会话不存在:connection 时发 error 帧而非 init(对应 server.cjs:558)。
    // 验证 sendOneShot 收到 error → 如实 ok:false(修复前盲发会误报 ok:true)。
    this.connectionError = connectionError || '';
    this.received = []; // 收到的 WS input/key/batch
    this.app = express();
    this.app.use(express.json());
    this.app.get('/api/dashboard', (req, res) => {
      if (this.token) {
        const ok = req.headers.authorization === `Bearer ${this.token}`;
        if (!ok) return res.status(401).json({ error: 'unauthorized' });
      }
      res.json(this.dashboardPayload);
    });
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', async (ws, req) => {
      if (this.token) {
        const ok = req.headers.authorization === `Bearer ${this.token}`;
        if (!ok) { ws.close(1008, 'Unauthorized'); return; }
      }
      const url = new URL(req.url, 'http://x');
      const session = url.searchParams.get('session') || 'default';
      // 模拟真机 await tmux.capturePane:init 与 message listener 都在此延迟之后注册
      if (this.listenerDelayMs) {
        await new Promise((r) => setTimeout(r, this.listenerDelayMs));
      }
      if (this.connectionError) {
        ws.send(JSON.stringify({ type: 'error', data: this.connectionError }));
      } else {
        ws.send(JSON.stringify({ type: 'init', data: `[init ${session}]` }));
      }
      ws.on('message', (buf) => {
        const msg = JSON.parse(buf.toString());
        this.received.push({ session, ...msg });
        if (this._onWsMessage) this._onWsMessage(session, msg, ws);
      });
    });
  }
  start() {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const { port } = this.server.address();
        this.port = port;
        this.url = `http://127.0.0.1:${port}`;
        resolve(this);
      });
    });
  }
  stop() {
    // 先关 WS 再关 HTTP,避免潜在 WS 连接撑住 server.close(回调延迟到所有连接断开)
    return new Promise((resolve) => {
      this.wss.close(() => this.server.close(() => resolve()));
    });
  }
}
module.exports = { StubMachine };
