/**
 * 多会话看板:cwd → Claude 项目 slug 映射(spike 准则 2/3)
 *
 * Claude Code 把每个会话的 cwd 映射成 ~/.claude/projects/<slug>/ 目录名,
 * slug 规则(实证):路径分隔符 / → -。例:
 *   /Users/roc/workspace/cc-web-control → -Users-roc-workspace-cc-web-control
 *
 * 主算法只做 / → -。脏路径(非 ASCII 段)Claude 内部会折叠,本函数不完全复现 →
 * miss 时调用方降级为 unknown(spike 设计的降级路径)。
 *
 * listProjectJsonls:M4 非递归,只取顶层 *.jsonl,排除子目录
 * (subagents/、memory.backup.* 等会污染状态)。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function cwdToSlug(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  return cwd.replace(/[\\/]+/g, '-');
}

function resolveProjectDir(cwd, baseDir = PROJECTS_DIR) {
  if (typeof cwd !== 'string' || !cwd.trim()) return null;
  const slug = cwdToSlug(cwd);
  if (!slug) return null;
  const dir = path.join(baseDir, slug);
  try {
    if (fs.statSync(dir).isDirectory()) return dir;
  } catch {
    /* miss → null */
  }
  return null;
}

function listProjectJsonls(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

module.exports = { cwdToSlug, resolveProjectDir, listProjectJsonls, PROJECTS_DIR };
