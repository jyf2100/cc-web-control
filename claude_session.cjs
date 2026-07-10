/**
 * 续接判断 + 最近会话 uuid 选取纯函数。
 * 设计依据:2026-06-28-project-path-agent-launch-design.md「后端启动语义」。
 * shouldContinue(cwd) true → 续接,false → 新建。
 * pickLatestSessionUuid(cwd) → mtime 最新 jsonl 的 sessionId(供 --resume <uuid> 事前绑定)。
 * 抽成独立纯函数(而非 server.cjs 内联),沿用 dashboard_slug.cjs 测试风格。
 * baseDir 可选,透传 resolveProjectDir(cwd, baseDir) 做测试隔离。
 */
const fs = require('fs');
const path = require('path');
const { resolveProjectDir, listProjectJsonls, cwdToSlug } = require('./dashboard_slug.cjs');
const { listBindings } = require('./dashboard_binding.cjs');

function shouldContinue(cwd, baseDir) {
  const dir = resolveProjectDir(cwd, baseDir);
  if (!dir) return false;
  return listProjectJsonls(dir).length > 0;
}

/**
 * 取 cwd 对应项目目录里 mtime 最新的 jsonl 的 sessionId(basename 去 .jsonl)。
 * 供续接路径 `claude --resume <uuid>` 事前绑定(--resume 精确追加进该 uuid 的 jsonl,
 * 评审团 2 号实证)。无项目目录 / 0 jsonl → null(调用方降级为不绑定)。
 * 内联 mtime 取最大,保持模块只依赖 dashboard_slug,不引入 dashboard_cache。
 * @param {string} cwd
 * @param {string} [baseDir] 测试隔离用
 * @returns {string|null}
 */
function pickLatestSessionUuid(cwd, baseDir) {
  const dir = resolveProjectDir(cwd, baseDir);
  if (!dir) return null;
  let latest = null;
  let latestMtime = -1;
  for (const f of listProjectJsonls(dir)) {
    try {
      const m = fs.statSync(f).mtimeMs;
      if (m > latestMtime) {
        latestMtime = m;
        latest = f;
      }
    } catch {
      /* skip unreadable */
    }
  }
  return latest ? path.basename(latest, '.jsonl') : null;
}

/**
 * 续接路径取「可安全 resume 的 uuid」(评审团 HIGH #1):按 mtime 降序取第一个**未被其它活跃
 * tmux session 占用**的 jsonl uuid,防新开 session B 续接进活跃 session A 的 jsonl(双写 + 塌缩)。
 * excludeTmuxName 自己的旧绑定不计入占用(允许 session 重启续接自己的历史)。
 * 全被占用 / 无 jsonl → null(调用方降级为新建独立会话)。
 * @param {string} cwd
 * @param {string} [excludeTmuxName] 当前要启动的 tmux session 名(占用集合排除它)
 * @param {string} [baseDir] 测试隔离用
 * @returns {string|null}
 */
function pickResumableSessionUuid(cwd, excludeTmuxName, baseDir) {
  const dir = resolveProjectDir(cwd, baseDir);
  if (!dir) return null;
  let jsonls;
  try {
    jsonls = listProjectJsonls(dir);
  } catch {
    return null;
  }
  if (!jsonls.length) return null;
  const sorted = [];
  for (const f of jsonls) {
    try {
      sorted.push({ f, m: fs.statSync(f).mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  sorted.sort((a, b) => b.m - a.m);
  // 占用集合:其它活跃 tmux session 绑定的 uuid(排除 excludeTmuxName 自己)
  const occupied = new Set();
  const slug = cwdToSlug(cwd);
  if (slug && excludeTmuxName) {
    for (const b of listBindings(slug, baseDir)) {
      if (b.tmuxName !== excludeTmuxName) occupied.add(b.sid);
    }
  }
  for (const { f } of sorted) {
    const uuid = path.basename(f, '.jsonl');
    if (!occupied.has(uuid)) return uuid;
  }
  return null;
}

module.exports = { shouldContinue, pickLatestSessionUuid, pickResumableSessionUuid };
