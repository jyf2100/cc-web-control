/**
 * tmux 控制模块
 * 提供对 tmux 会话的创建、检查、捕获和终止功能
 */

const { spawn } = require('child_process');

function runTmux(args, { maxStdoutChars = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > maxStdoutChars) {
        stdout = stdout.slice(-maxStdoutChars);
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 64 * 1024) {
        stderr = stderr.slice(-64 * 1024);
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to spawn tmux: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const msg = (stderr || '').trim();
      reject(new Error(msg || `tmux exited with code ${code}`));
    });
  });
}

/**
 * 检查 tmux 会话是否存在
 * @param {string} sessionName - 会话名称
 * @returns {Promise<boolean>} - 会话是否存在
 */
async function checkSession(sessionName) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  try {
    await runTmux(['has-session', '-t', sessionName], { maxStdoutChars: 1024 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建新的 tmux 会话
 * @param {string} sessionName - 会话名称
 * @returns {Promise<boolean>} - 是否创建成功
 */
async function createSession(sessionName, command = null) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  const exists = await checkSession(sessionName);
  if (exists) {
    throw new Error(`Session "${sessionName}" already exists`);
  }

  try {
    if (command) {
      await runTmux(['new-session', '-d', '-s', sessionName, command], { maxStdoutChars: 1024 });
    } else {
      await runTmux(['new-session', '-d', '-s', sessionName], { maxStdoutChars: 1024 });
    }
    return true;
  } catch (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }
}

/**
 * 捕获会话当前内容
 * @param {string} sessionName - 会话名称
 * @returns {Promise<string|null>} - 会话内容
 */
async function capturePane(sessionName) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  const exists = await checkSession(sessionName);
  if (!exists) {
    return null;
  }

  try {
    const { stdout } = await runTmux(['capture-pane', '-t', sessionName, '-p'], {
      maxStdoutChars: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * 向会话发送按键（会自动补一个 Enter）
 * @param {string} sessionName - 会话名称
 * @param {string} keys - 要发送的按键
 * @returns {Promise<boolean>} - 是否发送成功
 */
async function sendKeys(sessionName, keys, options = undefined) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  if (typeof keys !== 'string') {
    throw new Error('Keys must be a string');
  }

  const sendEnter = options && typeof options === 'object' && options.enter === false ? false : true;

  const exists = await checkSession(sessionName);
  if (!exists) {
    throw new Error(`Session "${sessionName}" does not exist`);
  }

  await runTmux(['send-keys', '-t', sessionName, '-l', keys], { maxStdoutChars: 1024 });
  if (sendEnter) {
    await runTmux(['send-keys', '-t', sessionName, 'Enter'], { maxStdoutChars: 1024 });
  }
  return true;
}

/**
 * 终止 tmux 会话
 * @param {string} sessionName - 会话名称
 * @returns {Promise<boolean>} - 是否终止成功
 */
async function killSession(sessionName) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  const exists = await checkSession(sessionName);
  if (!exists) {
    throw new Error(`Session "${sessionName}" does not exist`);
  }

  try {
    await runTmux(['kill-session', '-t', sessionName], { maxStdoutChars: 1024 });
    return true;
  } catch (error) {
    throw new Error(`Failed to kill session: ${error.message}`);
  }
}

module.exports = {
  checkSession,
  createSession,
  capturePane,
  sendKeys,
  killSession,
  sendKey,
};

async function sendKey(sessionName, key) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }
  if (!key || typeof key !== 'string') {
    throw new Error('Key must be a non-empty string');
  }

  const exists = await checkSession(sessionName);
  if (!exists) {
    throw new Error(`Session "${sessionName}" does not exist`);
  }

  await runTmux(['send-keys', '-t', sessionName, key], { maxStdoutChars: 1024 });
  return true;
}
