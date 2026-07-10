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
const { resolveProjectDir, listProjectJsonls } = require('./dashboard_slug.cjs');

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

module.exports = { shouldContinue, pickLatestSessionUuid };
