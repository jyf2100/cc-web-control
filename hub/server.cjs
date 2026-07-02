'use strict';

// hub 对浏览器的 HTTP + WS 服务:装配 registry/agent_client/dashboard_aggregator/ws_bridge,
// 复用根 auth.cjs。提供 /api/global-dashboard、/api/machines、/api/sessions 代理 + WS 终端代理。

const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const auth = require('../auth.cjs');
const { loadMachines } = require('./config.cjs');
const { MachineRegistry } = require('./registry.cjs');
const { DashboardAggregator } = require('./dashboard_aggregator.cjs');
const { AgentClient } = require('./agent_client.cjs');
const { WsBridge } = require('./ws_bridge.cjs');

function startHub(opts) {
  const {
    machinesFile,
    hubToken,
    host = process.env.CC_WEB_HUB_HOST || '127.0.0.1',
    port = Number(process.env.CC_WEB_HUB_PORT) || 7685,
    intervalMs = Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS) || 2000,
  } = opts;

  if (!hubToken) throw new Error('CC_WEB_HUB_TOKEN 必设(裸奔危险)');

  const machines = loadMachines(machinesFile);
  const registry = new MachineRegistry(machines);

  // 每机一个 agent_client(持有 token,内部用)
  const clients = new Map();
  for (const m of machines) clients.set(m.id, new AgentClient({ id: m.id, url: m.url, token: m.token }));

  const aggregator = new DashboardAggregator({
    registry,
    intervalMs,
    fetchOne: async (sec) => {
      // sec = {id,name,url,token};只用 id 取 client,token 不进 _latest
      const ac = clients.get(sec.id);
      if (!ac) return { ok: false, error: `unknown machine: ${sec.id}` };
      const r = await ac.fetchDashboard();
      return r.ok ? { ok: true, payload: r.payload } : { ok: false, error: r.error };
    },
  });

  const app = express();
  app.use(express.json());

  // 静态:控制台前端(复用 public/)
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // 统一鉴权:cookie(cc_web_auth)或 Authorization: Bearer
  const requireHubAuth = (req, res) => {
    const ok = auth.isAuthorized(
      { cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization },
      hubToken,
    );
    if (!ok) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  };

  app.get('/api/config', (req, res) => {
    if (!requireHubAuth(req, res)) return;
    res.json({ hub: true, intervalMs });
  });

  // 机器列表(已剥离 token)
  app.get('/api/machines', (req, res) => {
    if (!requireHubAuth(req, res)) return;
    res.json({ machines: registry.snapshot() });
  });

  // 全局聚合 dashboard
  app.get('/api/global-dashboard', (req, res) => {
    if (!requireHubAuth(req, res)) return;
    res.json(aggregator.getLatest());
  });

  // 代理:创建会话(body 带 machine 字段指定目标机)
  app.post('/api/sessions', async (req, res) => {
    if (!requireHubAuth(req, res)) return;
    const { machine, name, cwd } = req.body || {};
    const ac = clients.get(machine);
    if (!ac) {
      res.status(404).json({ error: `unknown machine: ${machine}` });
      return;
    }
    const r = await ac.createSession({ name, cwd });
    res.status(r.status).json(r.body || { ok: r.ok });
  });

  // 代理:删除会话
  app.delete('/api/sessions/:machine/:name', async (req, res) => {
    if (!requireHubAuth(req, res)) return;
    const ac = clients.get(req.params.machine);
    if (!ac) {
      res.status(404).json({ error: `unknown machine: ${req.params.machine}` });
      return;
    }
    const r = await ac.deleteSession(req.params.name);
    res.status(r.status).json({ ok: r.ok });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // ⚠️ 关键适配:ws_bridge 调 client.attach(session, onMsg) 与 client.sendOneShot(session, msg),
  // 但 AgentClient 的方法是 attachSession。这里把 attachSession 包成 attach,返回 { attach, sendOneShot }。
  // 未知机器返回 null,ws_bridge 据此回 error(契约见 ws_bridge.cjs)。
  const bridge = new WsBridge({
    getClient: (mid) => {
      const ac = clients.get(mid);
      if (!ac) return null;
      return {
        attach: (session, onMsg) => ac.attachSession(session, onMsg), // handle.send 已返回 boolean
        sendOneShot: (session, msg) => ac.sendOneShot(session, msg),
      };
    },
  });

  wss.on('connection', (ws, req) => {
    // 鉴权:cookie 或 ?token= query(浏览器 WS 不能自带 header,走 query)
    const url = new URL(req.url, 'http://x');
    const queryToken = url.searchParams.get('token');
    const ok = auth.isAuthorized(
      {
        cookieHeader: req.headers.cookie,
        authorizationHeader: queryToken ? `Bearer ${queryToken}` : req.headers.authorization,
      },
      hubToken,
    );
    if (!ok) {
      try { ws.close(1008, 'Unauthorized'); } catch {}
      return;
    }
    bridge.handleConnection(ws);
  });

  return new Promise((resolve, reject) => {
    // listen 失败(如端口占用)Node 在 server 上发 'error' → reject,避免 uncaughtException + await 永挂
    server.on('error', reject);
    server.listen(port, host, () => {
      aggregator.start();
      const addr = server.address();
      resolve({
        port: addr.port,
        close: async () => {
          aggregator.stop();
          for (const ac of clients.values()) ac.close();
          wss.close();
          await new Promise((r) => server.close(r));
        },
        stop: async function () { await this.close(); },
      });
    });
  });
}

module.exports = { startHub };
