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
const { createRateLimiter } = require('../rate_limit.cjs');

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
  app.use(express.urlencoded({ extended: false }));

  // 注:req.ip 取 socket 对端地址(未设 trust proxy)。反代部署时所有请求 IP 相同,
  // 限流计数会共享——内网单用户可接受;多用户/公网部署应按需设 app.set('trust proxy', N)。
  // 登录速率限制:对齐单机 server.cjs 配置(默认 5 次/15 分钟,可经环境变量调整)
  const loginRateLimiter = createRateLimiter({
    max: Number.parseInt(process.env.CC_WEB_LOGIN_MAX || '', 10) || 5,
    windowMs: Number.parseInt(process.env.CC_WEB_LOGIN_WINDOW_MS || '', 10) || 15 * 60 * 1000,
  });

  const expectedOriginForHttp = (req) => ({
    protocol: req.protocol,
    host: req.get('host'),
  });

  const requireSameOriginForUnsafeMethods = (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    const ok = auth.isSameOrigin(req.get('origin'), expectedOriginForHttp(req));
    if (!ok) {
      res.status(403).json({ error: 'Forbidden (origin mismatch)' });
      return false;
    }
    return true;
  };

  // GET /login:复用根 public/login.html(纯静态表单,input name=token/next)
  app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
  });

  // POST /login:限流 → same-origin → safeEqual → 设 httpOnly cookie → 重定向 next
  app.post('/login', (req, res) => {
    const { limited, retryAfterMs } = loginRateLimiter.check(req.ip);
    if (limited) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).type('text/plain').send('Too many login attempts, try again later');
      return;
    }
    if (!requireSameOriginForUnsafeMethods(req, res)) return;

    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const nextRaw = typeof req.body?.next === 'string' ? req.body.next : '';
    if (!token) {
      res.status(400).type('text/plain').send('Missing token');
      return;
    }
    if (!auth.safeEqual(token, hubToken)) {
      res.status(401).type('text/plain').send('Invalid token');
      return;
    }
    loginRateLimiter.reset(req.ip); // 合法用户,清空该 IP 计数

    const secure = req.secure || String(req.get('x-forwarded-proto') || '').toLowerCase().startsWith('https');
    res.cookie('cc_web_auth', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
    });
    const nextPath = auth.normalizeNextPath(nextRaw);
    res.redirect(nextPath || '/');
  });

  // POST /logout:清 cookie,回登录页
  app.post('/logout', (req, res) => {
    if (!requireSameOriginForUnsafeMethods(req, res)) return;
    res.clearCookie('cc_web_auth', { path: '/' });
    res.redirect('/login');
  });

  // 健康检查(公开,供前置代理/K8s 探活)
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // requireAuth 中间件:白名单(login/logout/healthz/公开 PWA 资源);未授权 /api→401,其它→重定向 /login?next=
  // 注册在 /login、/logout 之后,express.static 与 /api 路由之前。
  const requireAuth = (req, res, next) => {
    const p = req.path || '/';
    // tokens.css 必须公开:它是 login.html 唯一依赖的样式表;manifest/icon 需公开以支持 PWA standalone 启动
    if (
      p === '/login' ||
      p === '/logout' ||
      p === '/healthz' ||
      p === '/tokens.css' ||
      p === '/logo.png' ||
      p === '/favicon.ico' ||
      p === '/manifest.json' ||
      p === '/icon-192.png' ||
      p === '/icon-512.png' ||
      p === '/apple-touch-icon.png'
    ) {
      return next();
    }
    const ok = auth.isAuthorized(
      { cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization },
      hubToken,
    );
    if (ok) return next();

    if (p.startsWith('/api/')) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const nextUrl = typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/') ? req.originalUrl : '/';
    res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
  };

  app.use(requireAuth);

  // hub 入口:登录后直达多机控制台(而非共享 public/ 里的单机 index.html,
  // 那会去请求 hub 不存在的 /api/dashboard 等端点)。放在 requireAuth 之后、
  // express.static 之前:未授权 / → requireAuth 重定向 /login?next=/;
  // 已授权 / → 302 /console.html → 浏览器再请求 /console.html(requireAuth 通过)→ static 发文件。
  app.get('/', (req, res) => res.redirect('/console.html'));

  // 静态:控制台前端(复用 public/);requireAuth 之后,控制台资源需登录
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  app.get('/api/config', (req, res) => {
    res.json({ hub: true, intervalMs });
  });

  // 机器列表(已剥离 token)
  app.get('/api/machines', (req, res) => {
    res.json({ machines: registry.snapshot() });
  });

  // 全局聚合 dashboard
  app.get('/api/global-dashboard', (req, res) => {
    res.json(aggregator.getLatest());
  });

  // 代理:创建会话(body 带 machine 字段指定目标机)
  app.post('/api/sessions', async (req, res) => {
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
      // 0.0.0.0 归一为 127.0.0.1:浏览器/本机访问开不了 0.0.0.0(url 供 server_entry 自动开浏览器)
      const displayHost = (!host || host === '0.0.0.0') ? '127.0.0.1' : host;
      resolve({
        host: displayHost,
        port: addr.port,
        url: `http://${displayHost}:${addr.port}`,
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
