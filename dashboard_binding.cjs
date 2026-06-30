/**
 * 多会话看板:tmux 会话名 ↔ claude JSONL sessionId 绑定(M9)
 *
 * 历史:旧流程曾由 startClaudeInSession 在 forceNew 时预生成 UUID 并写绑定,
 * 让 jsonl 文件名 = 该 UUID,listSessions 回填后看板精确定位。新流程(Task 3)
 * 改走续接优先(shouldContinue),不再预生成/写绑定;遗留的陈旧绑定由
 * migrateStaleBindings 在启动时一次性清理(sid 在 slug 目录下无同名 jsonl 即删)。
 *
 * 所有操作容错:失败不抛(看板降级 unknown/mtime,详见 dashboard_cache)。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { cwdToSlug, listProjectJsonls } = require('./dashboard_slug.cjs');

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
 * 启动时一次性迁移:扫描 <projectsDir>/<slug>/.cc-web-bindings/ 下所有绑定文件,
 * 校验其 sid 在该 slug 目录顶层是否有同名 <sid>.jsonl,无则删除。
 * 陈旧 sid 会让 listSessions readBinding 回填错误,看板错位。新流程不再写绑定。
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

module.exports = { readBinding, writeBinding, deleteBinding, migrateStaleBindings, BINDING_DIRNAME };
