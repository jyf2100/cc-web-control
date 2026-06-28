/**
 * 多会话看板:tmux 会话名 ↔ claude JSONL sessionId 绑定(M9)
 *
 * 背景:同 cwd 的多个 tmux 会话都跑 claude 时,看板无法只靠 mtime
 * 区分各自状态(都指向同目录最新 jsonl)。解决方案:startClaudeInSession
 * 在 forceNew 时预生成 UUID(createSessionBinding),既 writeBinding 写绑定文件,
 * 又通过 CC_WEB_CLAUDE_SESSION_ID 让 claude --session-id 用同一 UUID,
 * 于是 jsonl 文件名 = 该 UUID,listSessions 回填后看板精确定位。
 *
 * 旧方案曾用 wrapper 后台子 shell 监听新 jsonl 文件名,但真实环境该后台进程
 * 不可靠(未捕获),故改为 node 端预生成 + claude --session-id,彻底消除时序竞态。
 *
 * 所有操作容错:失败不抛(看板降级 unknown/mtime,详见 dashboard_cache)。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { cwdToSlug } = require('./dashboard_slug.cjs');

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const BINDING_DIRNAME = '.cc-web-bindings';

function bindingFile(slug, tmuxName, projectsDir) {
  return path.join(projectsDir || DEFAULT_PROJECTS_DIR, slug, BINDING_DIRNAME, tmuxName);
}

function readBinding(slug, tmuxName, projectsDir) {
  if (!slug || !tmuxName) return null;
  try {
    const raw = fs.readFileSync(bindingFile(slug, tmuxName, projectsDir), 'utf8');
    const sid = raw.trim();
    return sid || null;
  } catch {
    return null;
  }
}

function writeBinding(slug, tmuxName, claudeSessionId, projectsDir) {
  if (!slug || !tmuxName || !claudeSessionId) return;
  try {
    const file = bindingFile(slug, tmuxName, projectsDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, claudeSessionId + '\n');
  } catch {
    /* 绑定写失败不致命,看板降级 mtime */
  }
}

function deleteBinding(slug, tmuxName, projectsDir) {
  if (!slug || !tmuxName) return;
  try {
    fs.rmSync(bindingFile(slug, tmuxName, projectsDir), { force: true });
  } catch {
    /* 幂等:不存在即视为已删 */
  }
}

/**
 * 为新建的 tmux 会话预生成 claude session id 并写绑定。
 * 返回 { slug, sessionId } 供调用方 export 给 wrapper(claude --session-id)。
 * cwd 无效或无 sessionName → 返回 null(不写绑定,看板降级 mtime)。
 */
function createSessionBinding({ cwd, sessionName, projectsDir } = {}) {
  const slug = cwd ? cwdToSlug(cwd) : null;
  if (!slug || !sessionName) return null;
  const sessionId = crypto.randomUUID();
  writeBinding(slug, sessionName, sessionId, projectsDir);
  return { slug, sessionId };
}

module.exports = { readBinding, writeBinding, deleteBinding, createSessionBinding, BINDING_DIRNAME };
