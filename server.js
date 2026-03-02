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
const tmux = require('./tmux');

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
const PROJECT_ROOTS = (process.env.CC_WEB_PROJECT_ROOTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 创建 Express 应用
const app = express();
const server = http.createServer(app);
let webServerStarted = false;

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

async function startClaudeInSession(sessionName, cwd) {
  const escapedCwd = shellEscapeForDoubleQuotes(cwd);
  await tmux.sendKeys(sessionName, `cd "${escapedCwd}"`);
  await tmux.sendKeys(sessionName, `bash "${shellEscapeForDoubleQuotes(CLAUDE_WRAPPER)}"`);
}

/**
 * 列出所有 tmux 会话
 */
async function listSessions() {
  try {
    const util = require('util');
    const execAsync = util.promisify(require('child_process').exec);
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_attached}|#{session_created}" 2>/dev/null || echo ""');

    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => {
        const [name, attached, created] = line.split('|');
        return { name, attached: parseInt(attached) > 0, created: new Date(parseInt(created) * 1000).toLocaleString() };
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

      await startClaudeInSession(DEFAULT_SESSION, cwd);

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

  // API 路由
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
        await startClaudeInSession(name, normalizedCwd);
      }
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/sessions/:name', async (req, res) => {
    try {
      await tmux.killSession(req.params.name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // WebSocket
  const wss = new WebSocketServer({ server });

  const allowedKeyNames = new Set(['Tab', 'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'BSpace', 'Delete', 'C-u', 'C-c']);

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const sessionName = url.searchParams.get('session') || DEFAULT_SESSION;

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
if (WEB_ONLY) {
  console.log('[Init] 已设置 --web-only / CC_WEB_WEB_ONLY=1，仅启动 Web 服务（不创建/附加 tmux 会话）');
  startWebServer();
} else {
  void initAndAttachSession();
}
