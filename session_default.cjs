/**
 * 默认会话名派生:cwd 命中某项目根 → 'claude-<项目名 slug>';否则回退调用方给的 fallback。
 *
 * 用途:server.cjs initAndAttachSession 启动时按 cwd 决定承载 Claude Code 的默认 tmux 会话名,
 * 与「项目启动区」(public/client.js:845 startProjectSession)派生的会话名保持一致 ——
 * 避免服务端默认会话与项目启动区各建一个会话导致双会话/看板错位。
 *
 * 同步约束:
 * - slugifySessionName 与 public/client.js:128 逐字等价(两端独立,改一处需同步另一处 + 其测试)。
 * - resolveDefaultSessionForCwd 的 realpath 匹配模式同 server.cjs /api/projects
 *   与 public/client.js syncProjectSelect(L710-724),改一处需同步。
 */
const fs = require('fs');
const path = require('path');

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// 与 public/client.js:128 slugifySessionName 逐字等价(两端同步)。
function slugifySessionName(name) {
  const base = String(name || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const cleaned = base || 'project';
  return cleaned.slice(0, 48);
}

// cwd 命中 projectRoots 下某顶层项目子目录(跳过隐藏目录与非目录)→ 'claude-<slug>';否则 fallback。
// 纯函数,自带 fs/path,不依赖 server.cjs 全局,便于单测。
function resolveDefaultSessionForCwd(cwd, projectRoots, fallback) {
  if (!Array.isArray(projectRoots) || projectRoots.length === 0) return fallback;
  const realCwd = realpathOrNull(cwd);
  if (!realCwd) return fallback;
  for (const root of projectRoots) {
    const realRoot = realpathOrNull(root);
    if (!realRoot) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(realRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!ent.name || ent.name.startsWith('.')) continue;
      const realFull = realpathOrNull(path.join(realRoot, ent.name));
      if (!realFull) continue;
      if (realFull === realCwd) return `claude-${slugifySessionName(ent.name)}`;
    }
  }
  return fallback;
}

module.exports = { slugifySessionName, resolveDefaultSessionForCwd };
