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
const os = require('os');
const { spawn, exec } = require('child_process');
const { WebSocketServer } = require('ws');
const tmux = require('./tmux.cjs');
const auth = require('./auth.cjs');
const { buildClaudeLaunchCommand, shellEscapeForDoubleQuotes } = require('./claude_launch.cjs');
const { getDashboardCache, buildDashboardPayload } = require('./dashboard_cache.cjs');
const { AutonomyTracker } = require('./autonomy_counters.cjs');
const { cwdToSlug } = require('./dashboard_slug.cjs');
const { resolveDefaultSessionForCwd } = require('./session_default.cjs');
const { isSessionInUse } = require('./session_in_use.cjs');
const { readBinding, writeBinding, deleteBinding, migrateStaleBindings } = require('./dashboard_binding.cjs');
const { shouldContinue, pickResumableSessionUuid } = require('./claude_session.cjs');
// effort 档位(Opus 5 缓存匹配标识):会话级配置,启动锁定 + 进行中切换须警告清空上下文缓存。
const { normalizeEffort, isValidEffort, DEFAULT_EFFORT, buildEffortSlashCommand } = require('./public/effort.cjs');
const { getEffort, setEffort, deleteEffort } = require('./session_effort.cjs');
const crypto = require('node:crypto');
const { createRateLimiter } = require('./rate_limit.cjs');
const { loadConfig, SINGLE_SCHEMA, SINGLE_CONFIG_PATH, CONFIG_DIR } = require('./config_loader.cjs');
const { RegisterClient } = require('./register_client.cjs');
const { createSecretStore, resolveApiKey, maskSecret } = require('./secret_store.cjs');
const { migrateConfigKeyToKeychain } = require('./secret_migrate.cjs');
const { SubprocessAudit } = require('./subprocess_audit.cjs');

// 配置文件(~/.cc-web-control/config.json,--config 覆盖)+ env 覆盖(env > file > default)。
// 无文件 = 纯 env/默认 = 现状行为(向后兼容)。warnings:未知字段 / token 权限过松。
const { config: CFG, warnings: cfgWarnings, filePath: CONFIG_FILE } = loadConfig({
  schema: SINGLE_SCHEMA,
  defaultFilePath: SINGLE_CONFIG_PATH,
});
if (cfgWarnings.length) {
  console.error('[config] 警告:');
  for (const w of cfgWarnings) console.error(`  ⚠ ${w}`);
}

// 登录速率限制:默认 5 次/15 分钟(可经环境变量调整),防爆破
const loginRateLimiter = createRateLimiter({
  max: CFG.loginMax,
  windowMs: CFG.loginWindowMs,
});

// 一次性 ticket 存储:mint 时写入,GET /login?ticket= 消费时立即删除(Task 4)。
// hub→单机自动登录流:hub 持 Bearer 调此端点拿 15s ticket,再引导浏览器 GET /login?ticket=
// 完成登录(浏览器无 Bearer)。DoS 双闸:TICKET_MAX 防内存爆,rate limiter 防滥mint。
const tickets = new Map();
const TICKET_TTL_MS = 15_000;
const TICKET_MAX = 1024;
// 定时清扫过期 ticket(30s);unref 让测试进程 / CLI 能自然退出,不被 interval 挂住。
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tickets) {
    if (v.expires <= now) tickets.delete(k);
  }
}, 30_000).unref();
const ticketRateLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const PORT = CFG.port;
const HOST = CFG.host;
const DEFAULT_SESSION = CFG.session;
const POLL_INTERVAL = CFG.pollInterval;
// 控制台可回看的 tmux scrollback 历史行数:未设/0=原行为(只抓当前屏);正整数 N=抓当前屏+往上N行。
// 用户反馈滚动条只能看当前一屏;显式设 CC_WEB_CAPTURE_HISTORY=N 开启 scrollback 回看。
const CAPTURE_HISTORY = tmux.parseCaptureHistory(CFG.captureHistory);
const NO_OPEN = CFG.noOpen || hasFlag('--no-open');
const NO_ATTACH = CFG.noAttach || hasFlag('--no-attach');
const WEB_ONLY = CFG.webOnly || hasFlag('--web-only');
const CLAUDE_WRAPPER = path.join(__dirname, 'claude-wrapper.sh');
const AUTH_TOKEN = CFG.authToken;
const HUB_URL = CFG.hubUrl;
const HUB_REGISTER_TOKEN = CFG.hubRegisterToken;
const HUB_TOKEN = CFG.hubToken;
const MACHINE_ID = CFG.machineId;
const MACHINE_NAME = CFG.machineName || '';
const PUBLIC_URL = CFG.publicUrl;
const CLAUDE_CONTINUE = CFG.claudeContinue;
const PROJECT_ROOTS = CFG.projectRoots;
// 启动 cwd 命中某项目根 → 'claude-<项目名>'(与项目启动区 client.js:845 同名,避免双会话);否则回退 CFG.session。
const RESOLVED_DEFAULT_SESSION = resolveDefaultSessionForCwd(process.cwd(), PROJECT_ROOTS, DEFAULT_SESSION);
// 文档化默认 effort 档位(AC6):CFG.defaultEffort 经 normalizeEffort 校验,非法值降级 medium 并告警。
const RESOLVED_DEFAULT_EFFORT = normalizeEffort(CFG.defaultEffort, DEFAULT_EFFORT);
if (CFG.defaultEffort && !isValidEffort(CFG.defaultEffort)) {
  console.error(`[config] defaultEffort "${CFG.defaultEffort}" 非合法档位,降级为 ${RESOLVED_DEFAULT_EFFORT}`);
}

// —— keychain + 子进程审计(本 PR:secret 不落盘明文 + spawn 级可观测)——
// secret 唯一落盘点:OS keychain;启动时迁移明文 → keychain 引用,解析后内存持有,
// 经 tmux new-session -e 注入子进程 env(不落 shell 历史;与 CC_WEB_OWNED 同通道,本机 trusted)。
const HOSTNAME = os.hostname();
// instance_id 与 hub 注册一致(register_client 未设 machineId 时默认 hostname)
const INSTANCE_ID = MACHINE_ID || HOSTNAME;
const secretStore = createSecretStore();
let CLAUDE_API_KEY = null; // bootstrap() 里解析(空=未配置,claude 走自己的登录)
function claudeSessionEnv() {
  return CLAUDE_API_KEY ? { ANTHROPIC_API_KEY: CLAUDE_API_KEY } : undefined;
}
// spawn 级审计:<state-dir>/audit/cc-subprocess.jsonl,字段/校验见 subprocess_audit.cjs。
const AUDIT_DIR = path.join(CONFIG_DIR, 'audit');
const subprocessAudit = new SubprocessAudit({
  filePath: path.join(AUDIT_DIR, 'cc-subprocess.jsonl'),
  errorLogPath: path.join(AUDIT_DIR, 'audit-write-errors.log'),
  host: HOSTNAME,
  instanceId: INSTANCE_ID,
});

// 创建 Express 应用
const app = express();
const server = http.createServer(app);
let webServerStarted = false;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Referrer-Policy:同源——单机 ticket 登录跳转链不漏 Referer(spec §3.4)
app.use((req, res, next) => { res.setHeader('Referrer-Policy', 'same-origin'); next(); });

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
  // 源头拒绝换行:cwd 经 tmux send-keys 双引号拼进命令,换行可触发命令分隔(注入)。
  // 与 auth.cjs normalizeNextPath 同策略;shellEscapeForDoubleQuotes 再删一次作纵深。
  if (/[\r\n]/.test(cwdInput)) {
    throw new Error('cwd must not contain line breaks');
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
 * @param {string} [opts.effort] Opus 5 effort 档位(会话级配置,启动时锁定)。
 *   须为合法枚举(low/medium/high/max);拼进 launch 命令 --effort <level>,wrapper 消费导出 env。
 */
async function startClaudeInSession(sessionName, cwd, opts = {}) {
  // realpath 统一口径:claude 内部按 realpath(cwd) 算 slug 写 jsonl(gate 实证),
  // tmux pane_current_path 也返回 realpath;此处统一 realCwd,让 shouldContinue /
  // pickResumableSessionUuid 定位目录、writeBinding 的 slug 都与 listSessions 回读一致。
  const realCwd = tryRealpath(cwd) || cwd;
  const escapedCwd = shellEscapeForDoubleQuotes(realCwd);
  const slug = cwdToSlug(realCwd);
  // 事前绑定(--session-id / --resume,评审团 2/3 号方案,替代已废弃的「启动后轮询捕获」):
  //   web 路径(默认):shouldContinue 判断 —— 有历史 → --resume <最近 uuid> 续接;无 → --session-id <新 uuid> 新建。
  //   DEFAULT_SESSION 路径(useClaudeContinue=true):沿用 CLAUDE_CONTINUE,也参与绑定。
  // 两条 flag 在启动前就钉死 jsonl 文件名(--session-id 文件名恰好=uuid、--resume 追加进同一 jsonl),
  // 启动前 writeBinding 事前绑定 → listSessions 回填后看板精确定位,同 cwd 多 session 不再塌缩到 mtime 最新。
  const isContinue = opts.useClaudeContinue ? CLAUDE_CONTINUE : shouldContinue(realCwd);
  let sessionId, resumeId;
  if (isContinue) {
    // 续接路径:跳过被其它活跃 session 占用的 uuid(评审团 HIGH #1,防续接串扰 ——
    // 否则新开 session B 会 --resume 进活跃 session A 的 jsonl,双写同一文件 + 看板塌缩)。
    // 取到 → --resume;取不到(无历史 / 全被占用)→ 退化为新建独立会话(--session-id 新 uuid + 绑定),
    // 既避免劫持活跃会话,又保证绑定即写(不留孤儿,看板精确)。
    const latest = pickResumableSessionUuid(realCwd, sessionName);
    if (latest) {
      resumeId = latest;
      if (slug) writeBinding(slug, sessionName, latest);
    } else {
      sessionId = crypto.randomUUID();
      if (slug) writeBinding(slug, sessionName, sessionId);
    }
  } else {
    sessionId = crypto.randomUUID();
    if (slug) writeBinding(slug, sessionName, sessionId);
  }
  // cd 与 claude 启动合并为单条命令,消除慢盘 / direnv hook 下 cd 未生效就发 claude 的时序竞态
  // effort(已校验枚举)作为 --effort <level> 拼进 launch:wrapper 消费并导出 CC_WEB_CLAUDE_EFFORT,
  // 不透传 claude(防拒未知参数)。档位是缓存匹配标识,启动即锁定。
  const validEffort = isValidEffort(opts.effort) ? opts.effort : null;
  const launch = buildClaudeLaunchCommand({ wrapperPath: CLAUDE_WRAPPER, sessionId, resumeId, effort: validEffort });
  const cmd = `cd "${escapedCwd}" && ${launch}`;
  await tmux.sendKeys(sessionName, cmd);
  // spawn 级审计(best-effort:审计失败不阻断 claude 启动)。cmd 为传给 tmux 的精确命令串。
  try {
    await subprocessAudit.recordStart({ sessionName, cmd, cwd: realCwd });
  } catch (e) {
    console.error('[audit] recordStart 失败(非致命):', e.message);
  }
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
        // 回填 claudeSessionId:wrapper 启动时写入的绑定文件(无绑定 → undefined,_compute 降级 mtime)。
        // name 经 isValidSessionName 守卫:非法名绝不下沉到 readBinding 的文件路径(评审团 4 号 D)。
        const slug = cwd ? cwdToSlug(cwd) : null;
        const claudeSessionId = (slug && isValidSessionName(name)) ? (readBinding(slug, name) || undefined) : undefined;
        // effort:会话级锁定档位(AC5 状态可见)。读不到记录 → 降级文档化默认档位(AC6)。
        // name 经 isValidSessionName 守卫:getEffort 内部对非法名返回 null,安全。
        const effort = (isValidSessionName(name) ? getEffort(name) : null) || RESOLVED_DEFAULT_EFFORT;
        return {
          name,
          attached: Number.parseInt(attached, 10) > 0,
          createdEpoch: Number.isFinite(createdEpoch) ? createdEpoch : null,
          created: Number.isFinite(createdEpoch) ? new Date(createdEpoch * 1000).toLocaleString() : null,
          cwd: cwd || null, // pane_current_path,供看板解析会话状态
          claudeSessionId,
          effort,
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

    console.log(`[Init] 默认会话: ${RESOLVED_DEFAULT_SESSION}`);
    const exists = await tmux.checkSession(RESOLVED_DEFAULT_SESSION);

    if (!exists) {
      console.log(`[Init] 创建 tmux 会话: ${RESOLVED_DEFAULT_SESSION}`);
      // 创建会话并启动 shell，在 shell 中切换到当前目录再启动 claude
      // ANTHROPIC_API_KEY 经 tmux -e 进 session env(子进程继承,不落 shell 历史)
      await tmux.createSession(RESOLVED_DEFAULT_SESSION, null, { env: claudeSessionEnv() });

      const hasClaude = await isCommandAvailable('claude', ['--version']);
      if (!hasClaude) {
        console.error('[Init] 错误: 未找到 claude 命令。请先安装 Claude Code CLI（命令为 claude），然后重启服务。');
        return true;
      }

      await startClaudeInSession(RESOLVED_DEFAULT_SESSION, cwd, { useClaudeContinue: true });

      console.log(`[Init] Claude Code 已在 ${cwd} 启动`);
    } else {
      console.log(`[Init] 使用现有会话: ${RESOLVED_DEFAULT_SESSION}`);
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

    const tmuxAttach = spawn('tmux', ['attach-session', '-t', RESOLVED_DEFAULT_SESSION], {
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
    const nextRaw = typeof req.query.next === 'string' ? req.query.next : '';
    const nextPath = auth.normalizeNextPath(nextRaw) || '/';

    // ticket 消费(hub /jump 跳来):get → delete → check,三步无 await,锁死一次性。
    // 任何失败分支都中性回登录页(保留 next、不设 cookie),防止重放与信息泄漏。
    const ticketRaw = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    if (ticketRaw) {
      const entry = tickets.get(ticketRaw);
      if (entry) tickets.delete(ticketRaw);           // 先删,保证一次性
      if (!entry || entry.expires <= Date.now()) {
        return res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
      }
      // 消费成功 → 设 cookie(选项与 POST /login 完全一致)
      const secure = req.secure || String(req.get('x-forwarded-proto') || '').toLowerCase().startsWith('https');
      res.cookie('cc_web_auth', AUTH_TOKEN, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
      });
      return res.redirect(nextPath);
    }

    // AUTH_TOKEN 未设时不再丢 next(bug fix):auth disabled = 用户已通过,
    // 直接跳到 next,而不是把 next 扔掉只回 /。
    if (!AUTH_TOKEN) {
      res.redirect(nextPath);
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

  // 一次性 ticket mint:hub 持 Bearer 调此端点 → 返回 15s 内有效的 ticket。
  // requireAuth 已校验 Bearer(经 auth.isAuthorized);rate limit 防滥 mint;
  // TICKET_MAX 防内存 DoS。Task 4 在 GET /login?ticket= 立即删除消费。
  app.post('/api/auth/ticket', (req, res) => {
    const { limited } = ticketRateLimiter.check(req.ip);
    if (limited) return res.status(429).type('text/plain').send('rate limited');
    if (tickets.size >= TICKET_MAX) {
      return res.status(503).type('json').send(JSON.stringify({ error: 'ticket capacity' }));
    }
    const ticket = crypto.randomBytes(32).toString('base64url');
    tickets.set(ticket, { expires: Date.now() + TICKET_TTL_MS });
    res.type('json').send(JSON.stringify({ ticket }));
  });

  // API 路由
  app.get('/api/config', (req, res) => {
    res.json({
      defaultSession: RESOLVED_DEFAULT_SESSION,
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
    intervalMs: CFG.dashboardIntervalMs,
  });
  dashboardCache.start();

  // autonomy 指标跟踪器(单机维度:commit/rollback 来自 jsonl 尾扫,intervention 来自 WS 打断键)。
  // 仅观测、不改 Claude 行为;经 /api/dashboard 的 session.autonomy 字段上报给 hub。
  const autonomyTracker = new AutonomyTracker();

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
      // autonomy:扫 jsonl 尾部计 commit/rollback,清理已消失会话,snapshot 仅含当前会话
      autonomyTracker.tick(sessions);
      autonomyTracker.retain(sessions.map((s) => s.name));
      const tmuxOk = await tmuxAvailable();
      res.json(buildDashboardPayload(
        sessions, dashboardCache.getSnapshots(), tmuxOk,
        autonomyTracker.snapshot(sessions.map((s) => s.name))
      ));
    } catch (error) {
      // M3:绝不 500,降级返回空 payload
      res.json({ sessions: [], tmuxOk: false });
    }
  });

  // 子进程 spawn 级审计(供 hub 聚合 /api/global-audit)。cmd 字段脱敏(防 key 泄露)。
  app.get('/api/audit/cc-subprocess', async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      const entries = await subprocessAudit.readRecent(limit);
      const masked = entries.map((e) => ({ ...e, cmd: maskSecret(e.cmd) }));
      res.json({ entries: masked });
    } catch (error) {
      res.json({ entries: [] }); // 审计端点绝不 500,降级空列表
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

      const { name, cwd, effort } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Session name required' });
      if (!isValidSessionName(name)) return res.status(400).json({ error: 'Invalid session name' });
      // effort 档位(AC1/AC6):未显式选择或非法 → 文档化默认档位;合法枚举原样用。
      const chosenEffort = normalizeEffort(effort, RESOLVED_DEFAULT_EFFORT);

      await tmux.createSession(name, null, { env: claudeSessionEnv() });
      if (cwd) {
        const normalizedCwd = normalizeProjectCwd(cwd);
        const hasClaude = await isCommandAvailable('claude', ['--version']);
        if (!hasClaude) {
          res.status(503).json({ error: 'claude is not available on PATH' });
          return;
        }
        // web 选项目创建会话:startClaudeInSession 内部走 shouldContinue 续接优先
        // (有历史 → claude -c;无历史 → claude 新建)。不再 forceNew 预生成 UUID。
        // effort 作为启动参数锁定下发(AC1)。
        await startClaudeInSession(name, normalizedCwd, { effort: chosenEffort });
      }
      // 落盘会话级 effort(AC5 状态可见),供 GET /api/sessions 回填。
      setEffort(name, chosenEffort);
      res.status(201).json({ success: true, effort: chosenEffort });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/sessions/:name', async (req, res) => {
    try {
      if (!requireSameOriginForUnsafeMethods(req, res)) return;
      const name = req.params.name;
      // 名字校验(评审团 4 号 D):非法名直接 400,绝不下沉到后续 tmux/绑定操作,防注入。
      if (!isValidSessionName(name)) {
        return res.status(400).json({ success: false, error: 'Invalid session name' });
      }
      // 防自杀:控制台正连着该会话(WS 活跃)则拒绝删除(多标签/多设备兜底)
      if (isSessionInUse(name, clients)) {
        return res.status(409).json({ success: false, error: 'session_in_use' });
      }
      // kill 前取 cwd → slug,清理绑定文件(否则同名会话复用会读到旧 sid,定位错 jsonl)
      const sessions = await listSessions();
      const target = sessions.find((s) => s.name === name);
      // 审计 exit_code:claude 已自然退出(pane dead)→ 读真实状态;仍活跃 → kill 终止记 137(SIGKILL 语义)
      let exitCode = 137;
      try {
        const ds = await tmux.paneExitStatus(name);
        if (ds != null) exitCode = ds;
      } catch { /* paneExitStatus 失败不阻断删除 */ }
      await tmux.killSession(name);
      // spawn 级审计 stop(best-effort)
      try {
        await subprocessAudit.recordStop({ sessionName: name, exitCode });
      } catch (e) {
        console.error('[audit] recordStop 失败(非致命):', e.message);
      }
      if (target && target.cwd) {
        const slug = cwdToSlug(target.cwd);
        if (slug) deleteBinding(slug, name);
      }
      // 清理会话级 effort 记录(与绑定同生命周期清理)。
      deleteEffort(name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 会话进行中切换 effort 档位(AC2/AC3)。档位是缓存匹配标识,切换会清空全部上下文缓存——
  // 故前端须先弹「将清空上下文缓存」警告并经用户二次确认,确认后才调本端点下发(dispatch)。
  // 本端点:校验档位 → 向 tmux 会话下发 effort slash 命令(终端镜像通道)→ 更新会话级记录。
  app.patch('/api/sessions/:name/effort', async (req, res) => {
    try {
      if (!requireSameOriginForUnsafeMethods(req, res)) return;
      const name = req.params.name;
      if (!isValidSessionName(name)) {
        return res.status(400).json({ success: false, error: 'Invalid session name' });
      }
      const { effort } = req.body || {};
      if (!isValidEffort(effort)) {
        return res.status(400).json({ success: false, error: 'Invalid effort level (low/medium/high/max)' });
      }
      const hasTmux = await isCommandAvailable('tmux');
      if (!hasTmux) {
        return res.status(503).json({ success: false, error: 'tmux is not available on PATH' });
      }
      const exists = await tmux.checkSession(name);
      if (!exists) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }
      // 下发切换命令到 claude 会话(AC3 dispatch)。具体命令以 Claude Code 实际支持为准(风险 C4),
      // buildEffortSlashCommand 为文档化常量。sendKeys 走终端镜像的 send-keys -l + Enter 通道。
      const cmd = buildEffortSlashCommand(effort);
      await tmux.sendKeys(name, cmd, { enter: true });
      // 更新会话级记录(AC5:切换确认后 UI 显示 = 新档位)。
      setEffort(name, effort);
      res.json({ success: true, effort, dispatched: cmd });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 静态文件服务（放在鉴权之后）
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (/\.(html|js|cjs)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    },
  }));

  // WebSocket
  const wss = new WebSocketServer({ server });
  const WS_PING_INTERVAL_MS = CFG.wsPingInterval;

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
    const sessionName = url.searchParams.get('session') || RESOLVED_DEFAULT_SESSION;
    if (!isValidSessionName(sessionName)) {
      try {
        ws.close(1008, 'Invalid session name');
      } catch {}
      return;
    }

    const clientInfo = { sessionName, lastOutput: null, isPolling: false, missingNoticeSent: false };
    clientInfo.commandQueue = Promise.resolve();
    clients.set(ws, clientInfo);

    // 先注册 message listener,再做异步 capturePane/init:消息可能在 init 发出前到达
    // (hub sendOneShot 等 init 后即发,或任意客户端握手后立即发)。若 listener 注册晚于
    // `await capturePane`,抢先到达的消息会被 EventEmitter 丢弃(广播竞态根因)。
    // 依赖的 sessionName、clientInfo.commandQueue 此处均已就绪。
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
          // autonomy:用户主动打断 Claude(C-c / Esc 均为「停止当前回合」的同等信号)→ intervention +1。
          // 仅观测、不改 Claude 行为;经 /api/dashboard 上报给 hub(与「自然结束」可区分:C-c/Esc 是人工打断,
          // 任务跑完自然退出不会产生本路径的 key 事件)。
          if (data === 'C-c' || data === 'Escape') {
            try { autonomyTracker.recordIntervention(sessionName); } catch { /* 观测失败不影响输入 */ }
          }
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

    try {
      const output = await tmux.capturePane(sessionName, CAPTURE_HISTORY);
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
        const output = await tmux.capturePane(sessionName, CAPTURE_HISTORY);
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

    ws.on('close', () => {
      const info = clients.get(ws);
      if (info?.interval) clearInterval(info.interval);
      clients.delete(ws);
    });
  });

  // 反向注册:配了 CC_WEB_HUB_URL(+token) 才启用;在 listen 回调里创建,SIGINT 里关闭
  let registerClient = null;

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
    if (registerClient) registerClient.close();
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

    // 反向注册到 hub(配了 CC_WEB_HUB_URL + token 才启用)
    if (HUB_URL && (HUB_REGISTER_TOKEN || HUB_TOKEN)) {
      registerClient = new RegisterClient({
        hubUrl: HUB_URL,
        registerToken: HUB_REGISTER_TOKEN || HUB_TOKEN,
        authToken: AUTH_TOKEN,
        machineId: MACHINE_ID,
        machineName: MACHINE_NAME,
        publicUrl: PUBLIC_URL,
        bindHost: HOST,
        port: PORT,
      });
      registerClient.start();
    }
  });
}

// 启动 —— 先 keychain 迁移 + 解析 key(子进程 env 依赖),再清旧绑定、起服务。
// 一次性迁移:绑定 sid 指向已不存在的 jsonl 时会让 listSessions readBinding 回填陈旧 sid,看板错位。
// startClaudeInSession 事前 writeBinding,运行期仍可能产生孤儿(claude 未落 jsonl / 文件名映射破裂);
// 此处仅在启动时清一次残留,运行期孤儿由 _compute 绑定缺失时降级 mtime 兜底。与 tmux 无关,两种模式都跑。
async function bootstrap() {
  // 1) 明文 anthropic_api_key → keychain 迁移(验收 A3);失败绝不回退明文、不阻断启动(验收 A5)
  try {
    const r = await migrateConfigKeyToKeychain({ configPath: CONFIG_FILE, store: secretStore });
    if (r.migrated) {
      console.log(`[keychain] 已把明文 anthropic_api_key 迁入 OS keychain,原值备份于 ${r.backupPath}(核对后可自删)`);
    } else if (r.reason === 'keychain-unavailable') {
      console.error(`[keychain] 明文迁移失败 ${r.error && r.error.code}: ${r.error && r.error.reason}(config 未改动,请解锁 keychain / 安装 libsecret 后重启)`);
    }
  } catch (e) {
    console.error('[keychain] 迁移异常(非致命):', e.message);
  }
  // 2) 解析 API key → 内存持有(供 createSession 注入 env;空=未配置,claude 走自己的登录)
  try {
    CLAUDE_API_KEY = await resolveApiKey(CFG.anthropic_api_key, secretStore);
    if (CLAUDE_API_KEY) console.log('[keychain] ANTHROPIC_API_KEY 已解析(经 tmux -e 注入子进程,不落盘)');
  } catch (e) {
    console.error(`[keychain] 解析 API key 失败 ${e.code || ''}: ${e.reason || e.message}(子进程将缺少 ANTHROPIC_API_KEY)`);
  }
  // 3) 清陈旧会话绑定
  try {
    const removed = migrateStaleBindings();
    if (removed.length > 0) {
      console.log(`[Init] 清理 ${removed.length} 个陈旧会话绑定:${removed.map((r) => r.tmuxName).join(', ')}`);
    }
  } catch (err) {
    console.error('[Init] 旧绑定迁移失败(非致命):', err.message);
  }
  // 4) 起服务
  if (WEB_ONLY) {
    console.log('[Init] 已设置 --web-only / CC_WEB_WEB_ONLY=1，仅启动 Web 服务（不创建/附加 tmux 会话）');
    startWebServer();
  } else {
    void initAndAttachSession();
  }
}

void bootstrap();
