'use strict';

// hub 对浏览器的 HTTP + WS 服务:装配 registry/agent_client/dashboard_aggregator/ws_bridge,
// 复用根 auth.cjs。提供 /api/global-dashboard、/api/machines、/api/sessions 代理 + WS 终端代理。

const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const auth = require('../auth.cjs');
const { existsSync } = require('node:fs');
const { loadMachines } = require('./config.cjs');
const { MachineRegistry } = require('./registry.cjs');
const { AgentRegistrar } = require('./register_server.cjs');
const { DashboardAggregator } = require('./dashboard_aggregator.cjs');
const { AutonomyStore } = require('./autonomy_store.cjs');
const { AutonomyAggregator, summarizeResults } = require('./autonomy_aggregator.cjs');
const { AgentClient } = require('./agent_client.cjs');
const { WsBridge } = require('./ws_bridge.cjs');
const { createRateLimiter } = require('../rate_limit.cjs');
const { AgentDispatcher } = require('./agent_dispatcher.cjs');
const { createLocalTmux } = require('./local_tmux.cjs');
const { LocalTmuxClient } = require('./local_tmux_client.cjs');
const { EventWatcher } = require('./event_watcher.cjs');
const { AuditLog } = require('./audit_log.cjs');
const rootTmux = require('../tmux.cjs');
const { writeMainAgentFiles } = require('./main_agent_config.cjs');

function startHub(opts) {
  const {
    machinesFile,
    hubToken,
    host = process.env.CC_WEB_HUB_HOST || '127.0.0.1',
    port = Number(process.env.CC_WEB_HUB_PORT) || 7685,
    intervalMs = Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS) || 2000,
    mainAgent = {},
    registerToken = '',
    loginMax = Number.parseInt(process.env.CC_WEB_LOGIN_MAX || '', 10) || 5,
    loginWindowMs = Number.parseInt(process.env.CC_WEB_LOGIN_WINDOW_MS || '', 10) || 15 * 60 * 1000,
    mainAgentMax = Number.parseInt(process.env.CC_WEB_MAIN_AGENT_MAX || '', 10) || 6,
    mainAgentWindowMs = Number.parseInt(process.env.CC_WEB_MAIN_AGENT_WINDOW_MS || '', 10) || 60 * 1000,
  } = opts;

  if (!hubToken) throw new Error('CC_WEB_HUB_TOKEN 必设(裸奔危险)');

  // deprecate 窗口:hub-machines.json 存在则作静态种子 + WARN,不存在则空(靠运行时注册)
  let machines = [];
  if (machinesFile && existsSync(machinesFile)) {
    machines = loadMachines(machinesFile);
    console.warn(`[hub] hub-machines.json 已 deprecated,将在后续版本移除;请改为在各单机配置 CC_WEB_HUB_URL + CC_WEB_HUB_TOKEN(详见 README 迁移指引)`);
  }
  const registry = new MachineRegistry(machines);

  // 每机一个 agent_client(持有 token,内部用);静态种子启动即建,运行时注册由 registrar 增建
  const clients = new Map();
  for (const m of machines) clients.set(m.id, new AgentClient({ id: m.id, url: m.url, token: m.token }));

  const registrar = new AgentRegistrar({
    registry,
    clients,
    AgentClientCtor: AgentClient,
    hubToken,
    registerToken: opts.registerToken || '',
  });

  // autonomy 指标:事件存储(7d 持久化 ~/.cc-web-control/autonomy-metrics.jsonl)+ 增量聚合器。
  // onResult 钩子把每轮各机 /api/dashboard 的 autonomy 单调计数喂给聚合器 → 正增量落成事件存入 store。
  const autonomyStore = new AutonomyStore({
    filePath: path.join(process.env.HOME || '/tmp', '.cc-web-control', 'autonomy-metrics.jsonl'),
    fsImpl: require('node:fs'),
  });
  const autonomyAggregator = new AutonomyAggregator({ store: autonomyStore });
  // compact:每 10min 裁掉 7d 外事件并整表重写文件(防 append-only 无限增长)
  const autonomyCompactTimer = setInterval(() => { try { autonomyStore.compact(); } catch {} }, 10 * 60 * 1000);

  const aggregator = new DashboardAggregator({
    registry,
    intervalMs,
    fetchOne: async (sec) => {
      // sec = {id,name,url,token};只用 id 取 client,token 不进 _latest
      const ac = clients.get(sec.id);
      if (!ac) return { ok: false, error: `unknown machine: ${sec.id}` };
      const r = await ac.fetchDashboard();
      if (!r.ok) registrar.notifyUnreachable(sec.id, sec.url, r.error);
      return r.ok ? { ok: true, payload: r.payload } : { ok: false, error: r.error };
    },
    onResult: (results) => {
      // 各机 autonomy 单调计数 → 增量事件(2s 量级精度,满足验收 5s 内计入)
      try { autonomyAggregator.ingest(summarizeResults(results), Date.now()); } catch { /* 观测失败不影响聚合 */ }
    },
  });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Referrer-Policy:同源策略——hub/jump 302 到目标机时,目标页 Referer 不应携带 hub URL
  // (避免把 hub 内部地址 / query 漏给下游;spec §3.4)
  app.use((req, res, next) => { res.setHeader('Referrer-Policy', 'same-origin'); next(); });

  // 注:req.ip 取 socket 对端地址(未设 trust proxy)。反代部署时所有请求 IP 相同,
  // 限流计数会共享——内网单用户可接受;多用户/公网部署应按需设 app.set('trust proxy', N)。
  // 登录速率限制:对齐单机 server.cjs 配置(默认 5 次/15 分钟;opts 优先,未传回退 env/默认)
  const loginRateLimiter = createRateLimiter({
    max: loginMax,
    windowMs: loginWindowMs,
  });
  // ★ M1:主控 agent 起停端点限流(默认 6/min,起停低频操作;opts 优先,未传回退 env/默认)
  const mainAgentRateLimiter = createRateLimiter({
    max: mainAgentMax,
    windowMs: mainAgentWindowMs,
  });

  // Task 6:/jump 端点限流 + 审计。30/min/IP(浏览器新标签低频,留余量防滥用);
  // jumpAudit 落 ~/.cc-web-control/jump-audit.jsonl(与 main-agent-audit.jsonl 同目录)。
  const jumpRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
  const jumpAudit = new AuditLog({
    filePath: path.join(process.env.HOME || '/tmp', '.cc-web-control', 'jump-audit.jsonl'),
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
    res.cookie('cc_web_hub_auth', token, {
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
    res.clearCookie('cc_web_hub_auth', { path: '/' });
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
      'cc_web_hub_auth',
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

  // Task 6:GET /jump?m=&s= → 服务端到端拉下游 ticket,302 引浏览器直达单机已登录态。
  // 安全:m/s 必填 + SESSION_RE 限字符 + machine 经 registry.getSecret(无注册即拒,无 SSRF)
  // + AbortSignal.timeout(3s) 防挂起 + 502 中性文案不漏 ECONNREFUSED/堆栈(spec §3.2/§3.4)。
  // 不在 requireAuth 白名单:必经 hub cookie(已通过上面 requireAuth)。
  const SESSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

  app.get('/jump', (req, res) => {
    const { limited } = jumpRateLimiter.check(req.ip);
    if (limited) { res.status(429).type('text/plain').send('rate limited'); return; }

    const m = String(req.query.m || '');
    const s = String(req.query.s || '');
    if (!m || !s) { res.status(400).type('text/plain').send('missing m or s'); return; }
    if (!SESSION_RE.test(s)) { res.status(400).type('text/plain').send('bad session'); return; }

    const secret = registry.getSecret(m);
    if (!secret) { res.status(400).type('text/plain').send('unknown machine'); return; }

    const nextPath = auth.normalizeNextPath(typeof req.query.next === 'string' ? req.query.next : '')
      || `/?session=${encodeURIComponent(s)}`;
    const encNext = encodeURIComponent(nextPath);

    fetch(`${secret.url}/api/auth/ticket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret.token}` },
      signal: AbortSignal.timeout(3000),
    })
      .then((up) => {
        if (!up.ok) throw new Error(`http_${up.status}`);
        return up.json();
      })
      .then((body) => {
        const ticket = body && typeof body.ticket === 'string' ? body.ticket : '';
        if (!ticket) throw new Error('no_ticket');
        res.header('Cache-Control', 'no-store');
        res.redirect(302, `${secret.url}/login?ticket=${encodeURIComponent(ticket)}&next=${encNext}`);
      })
      .catch((e) => {
        // 中性文案:不向浏览器回写 ECONNREFUSED/ENOTFOUND/error.message/堆栈(spec §3.4)。
        // 细节进 jumpAudit(本地文件,运维侧可见)。
        const code = e && (e.code || e.message) ? String(e.code || e.message) : 'unknown';
        jumpAudit.log({
          scope: 'jump', runId: null, event: 'fetch_ticket_failed',
          detail: { machine: m, session: s, code },
        }).catch(() => { /* 审计落盘失败不阻断响应 */ });
        res.status(502).type('text/plain').send('Bad Gateway');
      });
  });

  // hub 入口:登录后直达多机控制台(而非共享 public/ 里的单机 index.html,
  // 那会去请求 hub 不存在的 /api/dashboard 等端点)。放在 requireAuth 之后、
  // express.static 之前:未授权 / → requireAuth 重定向 /login?next=/;
  // 已授权 / → 302 /dashboard.html → 浏览器再请求 /dashboard.html(requireAuth 通过)→ static 发文件。
  app.get('/', (req, res) => res.redirect('/dashboard.html'));

  // 静态:控制台前端(复用 public/);requireAuth 之后,控制台资源需登录
  const publicDir = path.join(__dirname, '..', 'public');
  // 前端 html/js/cjs 设 Cache-Control: no-store:防浏览器缓存旧版
  // (曾导致"重启 main-agent 收不到信息"——用户浏览器持有旧 console.js);图片等保留默认缓存
  app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
      if (/\.(html|js|cjs)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    },
  }));

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

  // autonomy 指标面板数据:?window=1h|24h|7d(默认 24h)。按机聚合 commit/rollback/intervention 三项计数,
  // 离线机标记 stale。0 机 → machines:[](前端显示「无数据」占位)。切换窗口为纯内存聚合(≤1s)。
  const AUTONOMY_WINDOWS = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000 };
  app.get('/api/autonomy', (req, res) => {
    const key = typeof req.query.window === 'string' && AUTONOMY_WINDOWS[req.query.window] ? req.query.window : '24h';
    const windowMs = AUTONOMY_WINDOWS[key];
    const nowMs = Date.now();
    // 机器宇宙 = registry 快照(剥离 token,含 online 标志)。离线机 online:false → aggregate 标 stale。
    const machines = registry.snapshot().map((m) => ({ id: m.id, name: m.name, online: !!m.online }));
    const body = autonomyStore.aggregate(windowMs, nowMs, machines);
    res.json({ window: key, windowMs, generatedAt: nowMs, machines: body.machines });
  });

  // —— 主控 agent 内部端点(只读参谋 T1)——
  app.get('/api/mcp/list_sessions', (req, res) => {
    res.json(aggregator.getLatest());
  });

  app.get('/api/mcp/read_session', async (req, res) => {
    const machine = req.query.machine ? String(req.query.machine) : '';
    const session = req.query.session ? String(req.query.session) : '';
    if (!machine || !session) { res.status(400).json({ error: 'machine and session required' }); return; }
    const lines = Math.min(Math.max(Number(req.query.lines) || 40, 1), 500);
    const ac = clients.get(machine);
    if (!ac) { res.status(404).json({ error: `unknown machine: ${machine}` }); return; }
    const r = await ac.readPane(session, lines);
    if (!r.ok) { res.status(502).json({ error: r.error }); return; }
    res.json({ machine, session, lines: r.lines });
  });

  // dispatcher 实例:mainAgent 未启用时为 null(端点据此返回 503)。装配在 Task 11。
  let dispatcher = null;

  app.post('/api/mcp/dequeue_event', async (req, res) => {
    if (!dispatcher) { res.status(503).json({ error: 'main agent disabled' }); return; }
    const item = await dispatcher.dequeueEvent();
    res.json(item || { event: null });
  });

  app.post('/api/mcp/ack_event', async (req, res) => {
    const { runId, outcome } = req.body || {};
    if (!runId) { res.status(400).json({ error: 'runId required' }); return; }
    if (!dispatcher) { res.status(503).json({ error: 'main agent disabled' }); return; }
    const ok = await dispatcher.ack(runId, outcome);
    res.json({ ok });
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

  const ma = mainAgent;
  let mainAgentHandles = null;
  // M3:主控 agent 起停操作串行化(start/stop 互斥,防 close 中途 start 留孤儿)。Task 6 端点经此包装。
  let mainAgentOpChain = Promise.resolve();
  function serializeMainAgentOp(fn) {
    const next = mainAgentOpChain.then(fn, fn);
    mainAgentOpChain = next.catch(() => {});
    return next;
  }

  async function setupMainAgent({ realHost, realPort }) {
    const dataDir = ma.dataDir || path.join(process.env.HOME || '/tmp', '.cc-web-control', 'main-agent');
    const mcpServerPath = path.join(__dirname, '..', 'bin', 'cc-web-control-mcp.cjs');
    const { mcpPath, trustPath } = await writeMainAgentFiles({ dir: dataDir, mcpServerPath });
    const audit = new AuditLog({ filePath: ma.auditFile || path.join(path.dirname(dataDir), 'main-agent-audit.jsonl') });
    const localTmux = createLocalTmux({ tmux: ma.tmux || rootTmux });
    const watcher = new EventWatcher({
      getLatest: () => aggregator.getLatest(),
      intervalMs,
      settleMs: ma.settleMs,
      maxSettleMs: ma.maxSettleMs,
      backoffBase: ma.backoffBase,
      staleBump: ma.staleBump,
    });
    const dispatcherInst = new AgentDispatcher({
      tmux: localTmux, audit, session: ma.session || 'cc-main-agent',
      onStaleAck: (m, s) => watcher.markStale(m, s),
      onProblemChanged: (m, s) => watcher.markProblemChanged(m, s),
      rePokeAfterMs: ma.maxSettleMs, // 复用 maxSettleMs:A 层「再上报」与 B 层「再 poke」默认对齐 15min(语义不同,有意耦合)
    });
    watcher.on('event', (evt) => {
      audit.log({ scope: 'event', runId: null, event: 'enqueue', detail: { machine: evt.machine, session: evt.session, type: evt.to } });
      dispatcherInst.enqueue({ machine: evt.machine, session: evt.session, to: evt.to, lastLine: evt.lastLine, lastTs: evt.lastTs });
    });
    const sessionName = ma.session || 'cc-main-agent';
    const hubUrl = `http://${realHost}:${realPort}`;
    // 复用:首次 spawn 与 start 端点的 spawn 句柄共用同一 command/env(提取防漂移)
    const buildSpawnArgs = () => ({
      command: `${ma.claudePath || 'claude'} --mcp-config ${mcpPath} --strict-mcp-config --settings ${trustPath}`,
      opts: { cwd: dataDir, env: { CC_WEB_HUB_TOKEN: hubToken, CC_WEB_HUB_URL: hubUrl, CC_WEB_OWNED: '1' } },
    });
    // 首次用 hasSession:任何同名会话都不破坏(保护用户既有工作);spawn 句柄用 hasOwnedSession(只认本系统 spawn 的,见下)
    if (!(await localTmux.hasSession(sessionName))) {
      // token/url 经 tmux -e 注入 claude 进程 → MCP server 子进程继承;不落 mcp-config 文件
      const { command, opts } = buildSpawnArgs();
      await localTmux.create(sessionName, command, opts);
    }
    watcher.start();
    const localClient = new LocalTmuxClient({ localTmux, sessionName, audit });
    // spawn 句柄:start 端点复用(不重新算 mcpPath/trustPath/cwd/token——首次已写)。
    // ⚠️ MUST 经 serializeMainAgentOp 调用:否则 hasOwnedSession→create 窗口与并发 stop/close 竞争。
    const spawn = async () => {
      if (await localTmux.hasOwnedSession(sessionName)) return { running: true, started: false };
      const { command, opts } = buildSpawnArgs();
      await localTmux.create(sessionName, command, opts);
      return { running: true, started: true };
    };
    return {
      dispatcher: dispatcherInst,
      handles: { audit, watcher, dispatcher: dispatcherInst, localTmux, localClient, sessionName, spawn },
    };
  }

  // —— 主控 agent 起停端点(只读镜像配套;CSRF + 限流 + 串行锁)——

  app.post('/api/main-agent/start', async (req, res) => {
    if (!requireSameOriginForUnsafeMethods(req, res)) return;
    const { limited } = mainAgentRateLimiter.check(req.ip);
    if (limited) { res.status(429).json({ error: 'rate limited' }); return; }
    if (!mainAgentHandles) { res.status(503).json({ error: 'main agent not ready' }); return; }
    try {
      // ★ M6 + R2-H2 + R3-H1:create 抛错 → 仅清 owned session,foreign 不动;探测失败写审计。
      //   cleanup_probe_failed 分支经 kill 抛错可达(hasOwnedSession 内部吞 showEnvironment 错→false 不抛)。
      const r = await serializeMainAgentOp(() => mainAgentHandles.spawn().catch(async (e) => {
        try {
          if (await mainAgentHandles.localTmux.hasOwnedSession(mainAgentHandles.sessionName)) {
            await mainAgentHandles.localTmux.kill(mainAgentHandles.sessionName);
          }
        } catch (probeErr) {
          mainAgentHandles.audit.log({
            scope: 'local_tmux', runId: null, event: 'cleanup_probe_failed',
            detail: { name: mainAgentHandles.sessionName, error: probeErr.message },
          });
        }
        throw e;
      }));
      res.json(r);
    } catch (e) {
      // R3-H1:不泄露内部 error message
      res.status(500).json({ error: 'start failed' });
    }
  });

  app.post('/api/main-agent/stop', async (req, res) => {
    if (!requireSameOriginForUnsafeMethods(req, res)) return;
    const { limited } = mainAgentRateLimiter.check(req.ip);
    if (limited) { res.status(429).json({ error: 'rate limited' }); return; }
    if (!mainAgentHandles) { res.status(503).json({ error: 'main agent not ready' }); return; }
    try {
      const r = await serializeMainAgentOp(async () => {
        const name = mainAgentHandles.sessionName;
        const lt = mainAgentHandles.localTmux;
        if (await lt.hasOwnedSession(name)) {
          try {
            await lt.kill(name);
          } catch {
            // race:kill 时会话已消失(claude 自然退出 / TOCTOU)。重查:已非 owned → 视作已停(幂等,非 500)
            if (!(await lt.hasOwnedSession(name))) return { running: false, stopped: true };
            throw new Error('kill failed'); // 真失败 → 外层 500(C1:防 unhandledRejection/挂起)
          }
          return { running: false, stopped: true };
        }
        // M4 + R2-H2:foreign session(hasSession 但非 owned)不杀,如实回报
        if (await lt.hasSession(name)) return { stopped: false, reason: 'foreign session' };
        return { running: false, stopped: false };
      });
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: 'stop failed' });
    }
  });

  app.get('/api/main-agent/status', async (req, res) => {
    // M2:handles 未就绪 → 200 {running:false,enabled:false}(非 error;门控挡 start/stop→503)
    if (!mainAgentHandles) { res.json({ running: false, enabled: false }); return; }
    const running = await mainAgentHandles.localTmux.hasOwnedSession(mainAgentHandles.sessionName);
    res.json({ running, enabled: !!(ma && ma.enabled) });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // ⚠️ 关键适配:ws_bridge 调 client.attach(session, onMsg) 与 client.sendOneShot(session, msg),
  // 但 AgentClient 的方法是 attachSession。这里把 attachSession 包成 attach,返回 { attach, sendOneShot }。
  // 未知机器返回 null,ws_bridge 据此回 error(契约见 ws_bridge.cjs)。
  const bridge = new WsBridge({
    getClient: (mid) => {
      // M5:main-agent 直接复用 LocalTmuxClient(它就是 {attach, sendOneShot} 形状)
      if (mid === 'main-agent') return mainAgentHandles?.localClient ?? null;
      const ac = clients.get(mid);
      if (!ac) return null;
      return {
        attach: (session, onMsg) => ac.attachSession(session, onMsg), // handle.send 已返回 boolean
        sendOneShot: (session, msg) => ac.sendOneShot(session, msg),
      };
    },
  });

  wss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url, 'http://x');
    // 单机反向注册路径:Bearer 鉴权在 registrar 内,分流到此即返回
    if (reqUrl.pathname === '/api/hub/agent') {
      registrar.accept(ws, req);
      return;
    }
    // 鉴权:cookie 或 ?token= query(浏览器 WS 不能自带 header,走 query)
    const url = new URL(req.url, 'http://x');
    const queryToken = url.searchParams.get('token');
    const ok = auth.isAuthorized(
      {
        cookieHeader: req.headers.cookie,
        authorizationHeader: queryToken ? `Bearer ${queryToken}` : req.headers.authorization,
      },
      hubToken,
      'cc_web_hub_auth',
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
      if (ma.enabled) {
        setupMainAgent({ realHost: displayHost, realPort: addr.port })
          .then(({ dispatcher: d, handles }) => { dispatcher = d; mainAgentHandles = handles; })
          .catch((e) => { console.error('[main-agent] disabled:', e.message); });
      }
      resolve({
        host: displayHost,
        port: addr.port,
        url: `http://${displayHost}:${addr.port}`,
        close: async () => {
          // M3:把 main-agent 清理纳入串行链,与任何在途/后到的 start/stop op 严格排序(防 close 中途 start 留孤儿)。
          await serializeMainAgentOp(async () => {
            if (!mainAgentHandles) return;
            mainAgentHandles.watcher.stop();
            mainAgentHandles.dispatcher.freeze();
            mainAgentHandles.localClient.close(); // R2-M1:清 capture interval
            try { await mainAgentHandles.localTmux.kill(mainAgentHandles.sessionName); } catch {}
          });
          aggregator.stop();
          clearInterval(autonomyCompactTimer);
          try { autonomyStore.compact(); } catch {} // 关闭时整表重写,裁掉过期事件
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
