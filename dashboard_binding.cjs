/**
 * 多会话看板:tmux 会话名 ↔ claude JSONL sessionId 绑定(M9)
 *
 * 绑定写入:startClaudeInSession 在启动前事前钉死 jsonl 文件名——
 *   新建走 `claude --session-id <uuid>`(jsonl 文件名恰好 = uuid,已实证),
 *   续接走 `claude --resume <latestUuid>`(精确追加进同一 jsonl)。
 * 启动前 writeBinding(slug, tmuxName, sid),listSessions 回填后看板精确定位,
 * 同项目多 session 不再塌缩到同一 mtime 最新文件。遗留陈旧绑定由
 * migrateStaleBindings 在启动时一次性清理(sid 在 slug 目录下无同名 jsonl 即删)。
 *
 * 安全校验(评审团 4 号):绑定的 sid 会被消费端(dashboard_cache._compute)作为
 * 文件名拼成 path.join(dir, sid+'.jsonl'),故 writeBinding sanitize sid(拒空/含
 * / \ .. 控制字符)、写前 symlink 预检(防 symlink 覆写敏感文件)、bindingFile 对
 * tmuxName 走白名单(防 tmuxName 注入路径)。消费端另有 realpath 边界兜底。
 *
 * 所有操作容错:失败不抛(看板降级 unknown/mtime,详见 dashboard_cache)。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { cwdToSlug, listProjectJsonls } = require('./dashboard_slug.cjs');

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const BINDING_DIRNAME = '.cc-web-bindings';

// tmuxName 走白名单:它直接拼进绑定文件路径,bindingFile 对非法值返回 null 短路。
// 与 server.cjs isValidSessionName 同口径。
const VALID_TMUX_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * sanitize 绑定的 claudeSessionId:它会被消费端(dashboard_cache._compute)作为
 * 文件名拼成 path.join(dir, sid+'.jsonl'),必须拒绝可穿越/含控制字符的值。
 * 不强制 UUID 正则——保留现有 fixture('sid-123'/'target' 等合法串)语义;
 * 穿越的终极防御由消费端 realpath 边界兜底。
 */
function isSafeSid(sid) {
  if (typeof sid !== 'string' || !sid) return false;
  if (/[/\\]/.test(sid)) return false;            // 路径分隔符
  if (sid.includes('..')) return false;             // 上溯段
  if (/[\x00-\x1f\x7f]/.test(sid)) return false;    // 控制字符
  return true;
}

function bindingFile(slug, tmuxName, projectsDir) {
  if (!slug || typeof tmuxName !== 'string' || !VALID_TMUX_NAME.test(tmuxName)) return null;
  return path.join(projectsDir || DEFAULT_PROJECTS_DIR, slug, BINDING_DIRNAME, tmuxName);
}

function readBinding(slug, tmuxName, projectsDir) {
  if (!slug || !tmuxName) return null;
  const file = bindingFile(slug, tmuxName, projectsDir);
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const sid = raw.trim();
    return sid || null;
  } catch {
    return null;
  }
}

function writeBinding(slug, tmuxName, claudeSessionId, projectsDir) {
  if (!slug || !tmuxName || !claudeSessionId) return;
  if (!isSafeSid(claudeSessionId)) return;   // sanitize:拒穿越/控制字符
  const file = bindingFile(slug, tmuxName, projectsDir);
  if (!file) return;                          // 非法 tmuxName
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // symlink 预检:已存在且非常规文件(如 symlink)→ 先删,防 writeFileSync
    // 跟随 symlink 覆写其目标(敏感文件)。
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile()) fs.rmSync(file, { force: true });
    } catch {
      /* 不存在,正常 */
    }
    fs.writeFileSync(file, claudeSessionId + '\n', { mode: 0o600 });
  } catch (e) {
    // 绑定写失败不致命,看板降级 mtime;但系统性故障(磁盘满/权限/只读 fs)需有信号,否则难排查。
    console.warn(`[binding] writeBinding 失败 ${slug}/${tmuxName},看板将降级 mtime:`, e?.message || e);
  }
}

function deleteBinding(slug, tmuxName, projectsDir) {
  if (!slug || !tmuxName) return;
  const file = bindingFile(slug, tmuxName, projectsDir);
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* 幂等:不存在即视为已删 */
  }
}

/**
 * 启动时一次性迁移:扫描 <projectsDir>/<slug>/.cc-web-bindings/ 下所有绑定文件,
 * 校验其 sid 在该 slug 目录顶层是否有同名 <sid>.jsonl,无则删除。
 * 陈旧 sid 会让 listSessions readBinding 回填错误,看板错位。注意:startClaudeInSession 事前
 * writeBinding,运行期仍会产生孤儿(claude 未落 jsonl / 文件名映射破裂);此处仅清启动前残留,
 * 运行期孤儿由 dashboard_cache._compute 绑定缺失时降级 mtime 兜底(不致永久 unknown)。
 * @param {string} [projectsDir] 默认 ~/.claude/projects;测试传 tmpDir 隔离
 * @returns {Array<{slug:string, tmuxName:string, sid:string}>} 被删绑定(日志用)
 */
function migrateStaleBindings(projectsDir = DEFAULT_PROJECTS_DIR) {
  const removed = [];
  let slugs;
  try {
    slugs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  } catch {
    return removed;
  }
  for (const slugEntry of slugs) {
    const slug = slugEntry.name;
    const slugDir = path.join(projectsDir, slug);
    const bindingDir = path.join(slugDir, BINDING_DIRNAME);
    let bindingNames;
    try {
      bindingNames = fs.readdirSync(bindingDir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name);
    } catch {
      continue;
    }
    if (bindingNames.length === 0) continue;
    const jsonlSet = new Set(
      listProjectJsonls(slugDir).map((f) => path.basename(f))
    );
    for (const tmuxName of bindingNames) {
      const sid = readBinding(slug, tmuxName, projectsDir);
      if (!sid) continue;
      if (jsonlSet.has(`${sid}.jsonl`)) continue;
      deleteBinding(slug, tmuxName, projectsDir);
      removed.push({ slug, tmuxName, sid });
    }
  }
  return removed;
}

/**
 * 列出某 slug 下所有有效绑定 [{tmuxName, sid}],供续接路径算「被活跃 session 占用的 uuid 集合」
 * (评审团 HIGH #1,防续接串扰)。tmuxName 来自磁盘 readdir(不可信),readBinding 内部白名单 +
 * 空内容过滤会跳过非法名/空绑定,故只返回有效项。容错:目录不存在/读失败 → []。
 */
function listBindings(slug, projectsDir) {
  if (!slug) return [];
  const dir = path.join(projectsDir || DEFAULT_PROJECTS_DIR, slug, BINDING_DIRNAME);
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const tmuxName of names) {
    const sid = readBinding(slug, tmuxName, projectsDir); // 白名单非法名 / 空内容 → null 跳过
    if (sid) out.push({ tmuxName, sid });
  }
  return out;
}

module.exports = { readBinding, writeBinding, deleteBinding, migrateStaleBindings, listBindings, BINDING_DIRNAME };
