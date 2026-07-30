/**
 * session_effort.cjs — 单机会话级 effort 档位持久化(控制面状态,供 AC5「状态可见」)。
 *
 * 每个 tmux 会话启动时用户选定一个 effort 档位(low/medium/high/max),作为该会话的缓存匹配
 * 标识锁定(见 effort.cjs)。本模块把该选择落盘到 ~/.cc-web-control/effort/<sessionName>,
 * 让 GET /api/sessions 能回填 effort 字段、UI 跨刷新仍可见当前生效档位。
 *
 * 设计与 dashboard_binding.cjs 同口径:
 *   - sessionName 作为文件名 → 白名单(/^[A-Za-z0-9._-]{1,64}$/,同 isValidSessionName),
 *     拒非法名防路径注入;
 *   - effort 值经 effort.cjs isValidEffort 校验(枚举),写前 symlink 预检(防覆写敏感文件);
 *   - 全程容错:失败不抛(读不到 → null,UI 降级显示默认档位)。
 *
 * 纯 fs 操作 + 依赖注入(baseDir 可选,测试隔离),沿用 dashboard_binding 测试风格。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isValidEffort, normalizeEffort } = require('./public/effort.cjs');

const CONFIG_DIR = path.join(os.homedir(), '.cc-web-control');
const EFFORT_DIRNAME = 'effort';

// sessionName 直接拼进文件路径,白名单兜底(与 server.cjs isValidSessionName 同口径)。
const VALID_SESSION_NAME = /^[A-Za-z0-9._-]{1,64}$/;

function effortFile(sessionName, baseDir) {
  if (typeof sessionName !== 'string' || !VALID_SESSION_NAME.test(sessionName)) return null;
  return path.join(baseDir || CONFIG_DIR, EFFORT_DIRNAME, sessionName);
}

/**
 * 读某会话锁定的 effort 档位;无记录/非法 → null(调用方降级为默认档位)。
 */
function getEffort(sessionName, baseDir) {
  const file = effortFile(sessionName, baseDir);
  if (!file) return null;
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    return isValidEffort(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 写入会话 effort 档位(归一化后落盘)。非法 sessionName / 写失败均不抛。
 */
function setEffort(sessionName, effort, baseDir) {
  const file = effortFile(sessionName, baseDir);
  if (!file) return;
  const value = normalizeEffort(effort);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // symlink 预检(同 dashboard_binding):已存在且非常规文件 → 先删,防 writeFileSync
    // 跟随 symlink 覆写其目标(敏感文件)。
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile()) fs.rmSync(file, { force: true });
    } catch {
      /* 不存在,正常 */
    }
    fs.writeFileSync(file, value + '\n', { mode: 0o600 });
  } catch (e) {
    console.warn(`[effort] setEffort 失败 ${sessionName},UI 将降级默认档位:`, e?.message || e);
  }
}

/**
 * 删除会话 effort 记录(会话删除时清理,幂等)。
 */
function deleteEffort(sessionName, baseDir) {
  const file = effortFile(sessionName, baseDir);
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* 幂等:不存在即视为已删 */
  }
}

module.exports = { getEffort, setEffort, deleteEffort, EFFORT_DIRNAME, CONFIG_DIR };
