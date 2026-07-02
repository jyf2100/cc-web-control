'use strict';
// 假机器:Express + ws,模拟各机 /api/dashboard + WS(?session=),带 token 校验。
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('node:http');

class StubMachine {
  constructor({ token, dashboardPayload, onWsMessage } = {}) {
    this.token = token;
    this.dashboardPayload = dashboardPayload || { tmuxOk: true, sessions: [] };
    this._onWsMessage = onWsMessage;
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
    this.wss.on('connection', (ws, req) => {
      if (this.token) {
        const ok = req.headers.authorization === `Bearer ${this.token}`;
        if (!ok) { ws.close(1008, 'Unauthorized'); return; }
      }
      const url = new URL(req.url, 'http://x');
      const session = url.searchParams.get('session') || 'default';
      ws.send(JSON.stringify({ type: 'init', data: `[init ${session}]` }));
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
  stop() { return new Promise((r) => this.server.close(() => r())); }
}
module.exports = { StubMachine };
