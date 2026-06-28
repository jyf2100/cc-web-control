/**
 * 续接判断纯函数。设计依据:2026-06-28-project-path-agent-launch-design.md「后端启动语义」。
 * shouldContinue(cwd) true → `claude -c`,false → `claude`。
 * 抽成独立纯函数(而非 server.cjs 内联),沿用 dashboard_slug.cjs 测试风格。
 * baseDir 可选,透传 resolveProjectDir(cwd, baseDir) 做测试隔离。
 */
const { resolveProjectDir, listProjectJsonls } = require('./dashboard_slug.cjs');

function shouldContinue(cwd, baseDir) {
  const dir = resolveProjectDir(cwd, baseDir);
  if (!dir) return false;
  return listProjectJsonls(dir).length > 0;
}

module.exports = { shouldContinue };
