/**
 * Tmux Web Control Server
 * 通过 WebSocket 实现 tmux 双向控制
 *
 * 功能：
 * 1. 在当前终端附加到 tmux 会话（直接操作 Claude Code）
 * 2. 后台启动 Web 服务提供远程访问能力
 * 3. 集成 tmux.js 模块管理会话
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { WebSocketServer } = require('ws');
const tmux = require('./tmux.cjs');
const auth = require('./auth.cjs');
const { buildClaudeLaunchCommand } = require('./claude_launch.cjs');
const { getDashboardCache, buildDashboardPayload } = require('./dashboard_cache.cjs');
const { cwdToSlug } = require('./dashboard_slug.cjs');
const { readBinding, deleteBinding, migrateStaleBindings } = require('./dashboard_binding.cjs');
const { shouldContinue } = require('./claude_session.cjs');
const { createRateLimiter } = require('./rate_limit.cjs');

// 登录速率限制:默认 5 次/15 分钟(可经环境变量调整),防爆破
const loginRateLimiter = createRateLimiter({
  max: Number.parseInt(process.env.CC_WEB_LOGIN_MAX || '', 10) || 5,
  windowMs: Number.parseInt(process.env.CC_WEB_LOGIN_WINDOW_MS || '', 10) || 15 * 60 * 1000,
});

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const PORT = Number.parseInt(process.env.CC_WEB_PORT || '', 10) || 7684;
const HOST = process.env.CC_WEB_HOST || '127.0.0.1';
const DEFAULT_SESSION = process.env.CC_WEB_SESSION || 'claude-web-session';
const POLL_INTERVAL = Number.parseInt(process.env.CC_WEB_POLL_INTERVAL || '', 10) || 100;
const NO_OPEN = process.env.CC_WEB_NO_OPEN === '1' || hasFlag('--no-open');
const NO_ATTACH = process.env.CC_WEB_NO_ATTACH === '1' || hasFlag('--no-attach');
const WEB_ONLY = process.env.CC_WEB_WEB_ONLY === '1' || hasFlag('--web-only');
const CLAUDE_WRAPPER = path.join(__dirname, 'claude-wrapper.sh');
const AUTH_TOKEN = process.env.CC_WEB_AUTH_TOKEN || '';
const CLAUDE_CONTINUE = process.env.CC_WEB_CLAUDE_CONTINUE === '1';
const PROJECT_ROOTS = (process.env.CC_WEB_PROJECT_ROOTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 创建 Express 应用
const app = express();
const server = http.createServer(app);
let webServerStarted = false;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// WebSocket 客户端
const clients = new Map();

async function isCommandAvailable(cmd, args = ['-V']) {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function isValidSessionName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(name);
}

function shellEscapeForDoubleQuotes(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

function tryRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isWithinRoots(candidatePath) {
  if (!PROJECT_ROOTS.length) return true;
  const realCandidate = tryRealpath(candidatePath);
  if (!realCandidate) return false;

  for (const root of PROJECT_ROOTS) {
    const realRoot = tryRealpath(root);
    if (!realRoot) continue;
    const rel = path.relative(realRoot, realCandidate);
    if (rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

function normalizeProjectCwd(cwdInput) {
  if (typeof cwdInput !== 'string' || !cwdInput.trim()) {
    throw new Error('cwd must be a non-empty string');
  }
  const abs = path.resolve(cwdInput);
  const real = tryRealpath(abs);
  if (!real) {
    throw new Error('cwd does not exist');
  }
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) {
    throw new Error('cwd is not a directory');
  }
  if (!isWithinRoots(real)) {
    throw new Error('cwd is not under allowed project roots (set CC_WEB_PROJECT_ROOTS to configure)');
  }
  return real;
}

/**
 * 在 tmux 会话内启动 claude。
 * @param {string} sessionName
 * @param {string} cwd
 * @param {object} [opts]
 * @param {boolean} [opts.useClaudeContinue] 服务启动 DEFAULT_SESSION 沿用 CLAUDE_CONTINUE;
 *   web 路径不传 → 走 shouldContinue(cwd) 续接优先(范围限定)。
 */
async function startClaudeInSession(sessionName, cwd, opts = {}) {
  const escapedCwd = shellEscapeForDoubleQuotes(cwd);
  // web 路径(默认):shouldContinue 判断 —— 有历史会话 → -c 续接;无 → 纯新建。
  //   不再预生成 UUID / writeBinding,看板走 mtime 降级(test/dashboard_cache.test.cjs:157 已覆盖)。
  // DEFAULT_SESSION 路径(useClaudeContinue=true):沿用 CLAUDE_CONTINUE,行为不变。
  const continueConversation = opts.useClaudeContinue
    ? CLAUDE_CONTINUE
    : shouldContinue(cwd);
  // cd 与 claude 启动合并为单条命令,消除慢盘 / direnv hook 下 cd 未生效就发 claude 的时序竞态
  const launch = buildClaudeLaunchCommand({ wrapperPath: CLAUDE_WRAPPER, continueConversation });
  await tmux.sendKeys(sessionName, `cd "${escapedCwd}" && ${launch}`);
}

/**
 * 列出所有 tmux 会话
 */
async function listSessions() {
  try {
    const util = require('util');
    const execAsync = util.promisify(require('child_process').exec);
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_attached}|#{session_created}|#{pane_current_path}" 2>/dev/null || echo ""');

    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => {
        const [name, attached, created, cwd] = line.split('|');
        const createdEpoch = Number.parseInt(created, 10);
        // 回填 claudeSessionId:wrapper 启动时写入的绑定文件(无绑定 → undefined,_compute 降级 mtime)
        const slug = cwd ? cwdToSlug(cwd) : null;
        const claudeSessionId = slug ? (readBinding(slug, name) || undefined) : undefined;
        return {
          name,
          attached: Number.parseInt(attached, 10) > 0,
          createdEpoch: Number.isFinite(createdEpoch) ? createdEpoch : null,
          created: Number.isFinite(createdEpoch) ? new Date(createdEpoch * 1000).toLocaleString() : null,
          cwd: cwd || null, // pane_current_path,供看板解析会话状态
          claudeSessionId,
        };
      });
  } catch (error) {
    return [];
  }
}

/**
 * 初始化 tmux 会话并附加
 */
async function initAndAttachSession() {
  try {
    // 先启动 Web 服务：即使 tmux/claude 不可用，也能打开页面看到错误提示
    startWebServer();

    const hasTmux = await isCommandAvailable('tmux');
    if (!hasTmux) {
      console.error('[Init] 错误: 未找到 tmux 命令。请先安装 tmux，然后重启服务。');
      console.error(`[Init] 当前 PATH: ${process.env.PATH || ''}`);
      return true;
    }

    // 获取当前工作目录
    const cwd = process.cwd();
    console.log(`[Init] 当前工作目录: ${cwd}`);

    const exists = await tmux.checkSession(DEFAULT_SESSION);

    if (!exists) {
      console.log(`[Init] 创建 tmux 会话: ${DEFAULT_SESSION}`);
      // 创建会话并启动 shell，在 shell 中切换到当前目录再启动 claude
      await tmux.createSession(DEFAULT_SESSION);

      const hasClaude = await isCommandAvailable('claude', ['--version']);
      if (!hasClaude) {
        console.error('[Init] 错误: 未找到 claude 命令。请先安装 Claude Code CLI（命令为 claude），然后重启服务。');
        return true;
      }

      await startClaudeInSession(DEFAULT_SESSION, cwd, { useClaudeContinue: true });

      console.log(`[Init] Claude Code 已在 ${cwd} 启动`);
    } else {
      console.log(`[Init] 使用现有会话: ${DEFAULT_SESSION}`);
    }

    // 等待一小段时间让 Web 服务启动
    await new Promise(resolve => setTimeout(resolve, 500));

    if (NO_ATTACH) {
      console.log('[Init] 已设置 --no-attach / CC_WEB_NO_ATTACH=1，跳过附加 tmux 会话');
      return true;
    }

    // 在当前终端附加到 tmux 会话
    console.log('[Init] 正在附加到 tmux 会话...');
    console.log('[Init] 提示: 按 Ctrl+B 然后 D 可分离会话，Web 端仍可访问');

    const tmuxAttach = spawn('tmux', ['attach-session', '-t', DEFAULT_SESSION], {
      stdio: 'inherit'
    });

    tmuxAttach.on('exit', () => {
      console.log('\n[Exit] 已离开 tmux 会话');
      console.log(`[Exit] Web 服务仍在运行，可通过 http://${HOST}:${PORT} 访问`);
      console.log('[Exit] 按 Ctrl+C 完全停止服务');
    });

    return true;
  } catch (error) {
    console.error(`[Init] 错误:`, error.message);
    return false;
  }
}

/**
 * 启动 Web 服务器
 */
function startWebServer() {
  if (webServerStarted) return;
  webServerStarted = true;

  app.get('/healthz', (req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  const expectedOriginForHttp = (req) => ({
    protocol: req.protocol,
    host: req.get('host'),
  });

  const requireSameOriginForUnsafeMethods = (req, res) => {
    if (!AUTH_TOKEN) return true;
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    const ok = auth.isSameOrigin(req.get('origin'), expectedOriginForHttp(req));
    if (!ok) {
      res.status(403).json({ error: 'Forbidden (origin mismatch)' });
      return false;
    }
    return true;
  };

  app.get('/login', (req, res) => {
    if (!AUTH_TOKEN) {
      res.redirect('/');
      return;
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  app.post('/login', (req, res) => {
    if (!AUTH_TOKEN) {
      res.redirect('/');
      return;
    }
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
    if (!auth.safeEqual(token, AUTH_TOKEN)) {
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

  app.post('/logout', (req, res) => {
    if (!AUTH_TOKEN) {
      res.redirect('/');
      return;
    }
    if (!requireSameOriginForUnsafeMethods(req, res)) return;
    res.clearCookie('cc_web_auth', { path: '/' });
    res.redirect('/login');
  });

  const requireAuth = (req, res, next) => {
    if (!AUTH_TOKEN) return next();
    const p = req.path || '/';
    // Allow login + health check + public PWA assets (favicon/logo/manifest).
    // manifest.json 必须公开:iOS 添加主屏 / standalone 启动时不带 cookie 抓取它,
    // 被拦截则 iOS 不识别为 PWA,打开仍是 Safari 而非全屏 app。
    // tokens.css 必须公开:它是公开登录页 login.html 唯一依赖的样式表,
    // 被拦截则登录页退化成无样式的浏览器默认渲染(看起来像「另一个登录界面」)。
    // These do not grant access to tmux control and help avoid confusing stale icons in browsers.
    if (p === '/login' || p === '/healthz' || p === '/logo.png' || p === '/favicon.ico' || p === '/manifest.json' || p === '/tokens.css' || p === '/icon-192.png' || p === '/icon-512.png' || p === '/apple-touch-icon.png') return next();
    const ok = auth.isAuthorized(
      { cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization },
      AUTH_TOKEN
    );
    if (ok) return next();

    if (p.startsWith('/api/')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const nextUrl = typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/') ? req.originalUrl : '/';
    res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
  };

  app.use(requireAuth);

  // API 路由
  app.get('/api/config', (req, res) => {
    res.json({
      defaultSession: DEFAULT_SESSION,
      authEnabled: !!AUTH_TOKEN,
      projectRoots: PROJECT_ROOTS,
    });
  });

  app.get('/api/sessions', async (req, res) => {
    try {
      const hasTmux = await isCommandAvailable('tmux');
      if (!hasTmux) {
        res.status(503).json({ error: 'tmux is not available on PATH' });
        return;
      }
      const sessions = await listSessions();
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 多会话看板:聚合 tmux 会话 + 状态缓存(M3 从不 500,M7 轮询,M9 tmux 探测缓存)
  const dashboardCache = getDashboardCache({
    intervalMs: Number.parseInt(process.env.CC_WEB_DASHBOARD_INTERVAL_MS || '', 10) || 2000,
  });
  dashboardCache.start();

  let _tmuxOkCache = null;
  let _tmuxOkAt = 0;
  async function tmuxAvailable() {
    const now = Date.now();
    if (_tmuxOkCache !== null && now - _tmuxOkAt < 60000) return _tmuxOkCache;
    _tmuxOkCache = await isCommandAvailable('tmux');
    _tmuxOkAt = now;
    return _tmuxOkCache;
  }

  app.get('/api/dashboard', async (req, res) => {
    try {
      const sessions = await listSessions();
      dashboardCache.setSessions(sessions);
      dashboardCache.refresh();
      const tmuxOk = await tmuxAvailable();
      res.json(buildDashboardPayload(sessions, dashboardCache.getSnapshots(), tmuxOk));
    } catch (error) {
      // M3:绝不 500,降级返回空 payload
      res.json({ sessions: [], tmuxOk: false });
    }
  });

  app.get('/api/projects', async (req, res) => {
    try {
      if (!PROJECT_ROOTS.length) {
        res.json({ roots: [], projects: [] });
        return;
      }

      const projects = [];
      for (const root of PROJECT_ROOTS) {
        const realRoot = tryRealpath(root);
        if (!realRoot) continue;
        let entries = [];
        try {
          entries = fs.readdirSync(realRoot, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const name = ent.name;
          if (!name || name.startsWith('.')) continue;
          const full = path.join(realRoot, name);
          const realFull = tryRealpath(full);
          if (!realFull) continue;
          projects.push({ name, path: realFull, root: realRoot });
        }
      }

      projects.sort((a, b) => a.name.localeCompare(b.name));
      res.json({ roots: PROJECT_ROOTS, projects });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions', async (req, res) => {
    try {
      if (!requireSameOriginForUnsafeMethods(req, res)) return;
      const hasTmux = await isCommandAvailable('tmux');
      if (!hasTmux) {
        res.status(503).json({ error: 'tmux is not available on PATH' });
        return;
      }

      const { name, cwd } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Session name required' });
      if (!isValidSessionName(name)) return res.status(400).json({ error: 'Invalid session name' });

      await tmux.createSession(name);
      if (cwd) {
        const normalizedCwd = normalizeProjectCwd(cwd);
        const hasClaude = await isCommandAvailable('claude', ['--version']);
        if (!hasClaude) {
          res.status(503).json({ error: 'claude is not available on PATH' });
          return;
        }
        // web 选项目创建会话:startClaudeInSession 内部走 shouldContinue 续接优先
        // (有历史 → claude -c;无历史 → claude 新建)。不再 forceNew 预生成 UUID。
        await startClaudeInSession(name, normalizedCwd);
      }
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/sessions/:name', async (req, res) => {
    try {
      if (!requireSameOriginForUnsafeMethods(req, res)) return;
      const name = req.params.name;
      // kill 前取 cwd → slug,清理绑定文件(否则同名会话复用会读到旧 sid,定位错 jsonl)
      const sessions = await listSessions();
      const target = sessions.find((s) => s.name === name);
      await tmux.killSession(name);
      if (target && target.cwd) {
        const slug = cwdToSlug(target.cwd);
        if (slug) deleteBinding(slug, name);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 静态文件服务（放在鉴权之后）
  app.use(express.static(path.join(__dirname, 'public')));

  // WebSocket
  const wss = new WebSocketServer({ server });
  const WS_PING_INTERVAL_MS = Number.parseInt(process.env.CC_WEB_WS_PING_INTERVAL || '', 10) || 30_000;

  const allowedKeyNames = new Set(['Tab', 'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'BSpace', 'Delete', 'C-u', 'C-c']);

  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {}
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, WS_PING_INTERVAL_MS);

  wss.on('connection', async (ws, req) => {
    if (AUTH_TOKEN) {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const originOk = auth.isSameOrigin(req.headers.origin, { protocol: forwardedProto, host: forwardedHost });
      const authOk = auth.isAuthorized(
        { cookieHeader: req.headers.cookie, authorizationHeader: req.headers.authorization },
        AUTH_TOKEN
      );
      if (!originOk || !authOk) {
        try {
          ws.close(1008, 'Unauthorized');
        } catch {}
        return;
      }
    }

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const sessionName = url.searchParams.get('session') || DEFAULT_SESSION;
    if (!isValidSessionName(sessionName)) {
      try {
        ws.close(1008, 'Invalid session name');
      } catch {}
      return;
    }

    const clientInfo = { sessionName, lastOutput: null, isPolling: false, missingNoticeSent: false };
    clientInfo.commandQueue = Promise.resolve();
    clients.set(ws, clientInfo);

    try {
      const output = await tmux.capturePane(sessionName);
      if (output === null && ws.readyState === 1) {
        clientInfo.missingNoticeSent = true;
        ws.send(JSON.stringify({
          type: 'error',
          data: `会话不存在或无法读取: "${sessionName}"（请确认 tmux 已安装且会话存在，例如: tmux list-sessions）`
        }));
      }
      if (output !== null && ws.readyState === 1) {
        clientInfo.lastOutput = output;
        ws.send(JSON.stringify({ type: 'init', data: output }));
      }
    } catch (e) {}

    const interval = setInterval(async () => {
      if (clientInfo.isPolling) return;
      clientInfo.isPolling = true;
      try {
        const output = await tmux.capturePane(sessionName);
        if (output === null && !clientInfo.missingNoticeSent && ws.readyState === 1) {
          clientInfo.missingNoticeSent = true;
          ws.send(JSON.stringify({
            type: 'error',
            data: `会话不存在或无法读取: "${sessionName}"（请确认 tmux 已安装且会话存在）`
          }));
        }
        if (output !== null && ws.readyState === 1 && output !== clientInfo.lastOutput) {
          clientInfo.lastOutput = output;
          ws.send(JSON.stringify({ type: 'output', data: output }));
        }
      } catch (e) {
      } finally {
        clientInfo.isPolling = false;
      }
    }, POLL_INTERVAL);

    clientInfo.interval = interval;

    ws.on('message', (message) => {
      const run = async () => {
        const payload = JSON.parse(message);
        const { type, data, enter } = payload || {};

        const runInput = async (inputText, inputEnter) => {
          if (typeof inputText !== 'string') {
            throw new Error('Input payload must be a string');
          }
          const shouldEnter = inputEnter === false ? false : true;
          await tmux.sendKeys(sessionName, inputText, { enter: shouldEnter });
        };

        const runKey = async (keyName) => {
          if (typeof keyName !== 'string') {
            throw new Error('Key payload must be a string');
          }
          if (!allowedKeyNames.has(keyName)) {
            throw new Error('Key not allowed');
          }
          await tmux.sendKey(sessionName, keyName);
        };

        if (type === 'input') {
          await runInput(data, enter);
          return;
        }

        if (type === 'key') {
          await runKey(data);
          return;
        }

        if (type === 'batch') {
          if (!Array.isArray(data)) {
            throw new Error('Batch payload must be an array');
          }
          if (data.length > 50) {
            throw new Error('Batch too large');
          }

          for (const action of data) {
            if (!action || typeof action !== 'object') {
              throw new Error('Invalid batch action');
            }
            if (action.type === 'input') {
              await runInput(action.data, action.enter);
              continue;
            }
            if (action.type === 'key') {
              await runKey(action.data);
              continue;
            }
            throw new Error('Unknown batch action type');
          }
          return;
        }
      };

      clientInfo.commandQueue = clientInfo.commandQueue
        .then(run)
        .catch((e) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', data: e.message || 'Failed to send input' }));
          }
        });
    });

    ws.on('close', () => {
      const info = clients.get(ws);
      if (info?.interval) clearInterval(info.interval);
      clients.delete(ws);
    });
  });

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n[Server] 正在关闭...');
    try {
      clearInterval(pingInterval);
    } catch {}
    for (const [ws, info] of clients) {
      if (info?.interval) clearInterval(info.interval);
      ws.close();
    }
    server.close(() => process.exit(0));
  });

  server.listen(PORT, HOST, () => {
    console.log('='.repeat(50));
    console.log('Web 服务已启动');
    console.log(`访问地址: http://${HOST}:${PORT}`);
    console.log('='.repeat(50));

    // 自动打开浏览器
    if (!NO_OPEN) {
      setTimeout(() => {
        const platform = process.platform;
        const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} http://${HOST}:${PORT}`, () => {});
      }, 1500);
    }
  });
}

// 启动
// 一次性迁移:旧流程写的绑定(sid 指向已不存在的 jsonl)会让 listSessions readBinding
// 回填陈旧 sid,看板错位。新流程不再写绑定,迁移后目录自然不再增长。与 tmux 无关,两种模式都跑。
try {
  const removed = migrateStaleBindings();
  if (removed.length > 0) {
    console.log(`[Init] 清理 ${removed.length} 个陈旧会话绑定:${removed.map((r) => r.tmuxName).join(', ')}`);
  }
} catch (err) {
  console.error('[Init] 旧绑定迁移失败(非致命):', err.message);
}

if (WEB_ONLY) {
  console.log('[Init] 已设置 --web-only / CC_WEB_WEB_ONLY=1，仅启动 Web 服务（不创建/附加 tmux 会话）');
  startWebServer();
} else {
  void initAndAttachSession();
}
