'use strict';

/**
 * 配置健康指标:CLAUDE.md / Skills 规模精简监控(纯函数 + 依赖注入)。
 *
 * 信号背景:Anthropic 删 80% Claude Code 系统提示;/doctor 可把 CLAUDE.md/Skills 调到合规模,
 * 高绩效团队 CLAUDE.md ≤ 60 行,绝不超过 300 行。本模块只读不改目标仓文件(遵 ADR-0001 控制面/目标面分离)。
 *
 * 阈值(对 CLAUDE.md 行数):
 *   ≤ 60   ok      健康
 *   > 60   warn    建议精简
 *   > 300  over    超限
 *   不可读 unreadable / 无项目 empty
 *
 * 纯函数 + DI:fsImpl 可注入(测试用内存 fs);默认真实 node:fs。绝不抛——任何 IO 失败降级为 unreadable。
 */

const fs = require('node:fs');
const path = require('node:path');

// 阈值常量(与社区最佳实践对齐:60 行 / 300 行)
const WARN_LINES = 60;
const OVER_LINES = 300;

// 行数计数:编辑器视角的「可见行数」。'a\nb\nc\n' → 3;'a\nb\nc' → 3;'' → 0。
// 与 wc -l(计 \n 数)在无尾换行时差 1,满足 AC「误差 ≤ 1 行」;追加 N 行则计数 +N(一致性)。
function countLines(text) {
  const s = String(text == null ? '' : text);
  if (s === '') return 0;
  const parts = s.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

// 按行数分类(纯)。null/undefined → 'unreadable'(文件不可读/缺失)。
function classifyConfigHealth(lines) {
  if (lines == null || (typeof lines === 'number' && !Number.isFinite(lines))) return 'unreadable';
  if (lines <= WARN_LINES) return 'ok';
  if (lines <= OVER_LINES) return 'warn';
  return 'over';
}

// 默认 fs 实现(真实 node:fs)。readFileSync 等抛错由调用方 try/catch 降级。
function defaultFs() {
  return {
    existsSync: (p) => fs.existsSync(p),
    realpathSync: (p) => fs.realpathSync(p),
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
    readdirSync: (p, opts) => fs.readdirSync(p, opts),
  };
}

// 递归收集 dir 下所有 basename 匹配 nameRe(默认 /^skill\.md$/i)的文件绝对路径。
// 环形目录/超深由 fs 自身限制;skills 目录通常很小。任何 readdir 错误 → 抛给上层降级。
function walkSkillFiles(dir, fsImpl, nameRe) {
  const re = nameRe || /^skill\.md$/i;
  const out = [];
  const stack = [dir];
  let guard = 0;
  while (stack.length) {
    if (++guard > 10000) break; // 深度/数量硬上限,防恶意/异常结构
    const cur = stack.pop();
    let entries;
    try {
      entries = fsImpl.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // 子目录不可读 → 跳过该层,不整体失败
    }
    for (const ent of entries) {
      if (!ent) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && re.test(ent.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

// 读单个文件行数;不可读/缺失 → null(readable=false)。
function readLines(filePath, fsImpl) {
  try {
    const txt = fsImpl.readFileSync(filePath, 'utf8');
    return countLines(txt);
  } catch {
    return null;
  }
}

// 单项目指标:claudeMd 行数 + skills(SKILL.md)文件数与累计行数。
function computeProject(name, projDir, fsImpl) {
  const claudeMdPath = path.join(projDir, 'CLAUDE.md');
  let claudeMdExists = false;
  try { claudeMdExists = fsImpl.existsSync(claudeMdPath); } catch { claudeMdExists = false; }
  const claudeMdLines = claudeMdExists ? readLines(claudeMdPath, fsImpl) : null;
  // 文件不存在 ≠ 不可读:不存在则 claudeMdLines=0(空配置,健康),readable=true;
  // 存在但读失败(权限)→ null + readable=false(AC6「无法读取」)。
  let claudeMdReadable = true;
  let claudeMdValue = 0;
  if (claudeMdExists) {
    if (claudeMdLines == null) { claudeMdReadable = false; claudeMdValue = null; }
    else { claudeMdValue = claudeMdLines; }
  }

  // skills:<projDir>/.claude/skills 下递归找 SKILL.md。
  const skillsDir = path.join(projDir, '.claude', 'skills');
  let skillsExists = false;
  try { skillsExists = fsImpl.existsSync(skillsDir); } catch { skillsExists = false; }
  let skillsFiles = 0;
  let skillsLines = 0;
  let skillsReadable = true;
  if (skillsExists) {
    try {
      const files = walkSkillFiles(skillsDir, fsImpl);
      skillsFiles = files.length;
      for (const f of files) {
        const n = readLines(f, fsImpl);
        if (n == null) { skillsReadable = false; }
        else { skillsLines += n; }
      }
    } catch {
      skillsReadable = false; // 目录不可读(权限等)→ 标记不可读,不计崩溃
    }
  }

  return {
    name,
    path: projDir,
    claudeMdLines: claudeMdValue,
    claudeMdReadable,
    skillsFiles,
    skillsLines,
    skillsReadable,
  };
}

// 主入口:扫描 projectRoots 下各项目,聚合成机器级 configHealth。
// opts: { projectRoots:[...], fsImpl?, now? }。projectRoots 每项为目录路径;其直接子目录为「项目」。
// 返回 { projects:[...], totals:{claudeMdLines,skillsFiles,skillsLines}, status, generatedAt }。
function computeConfigHealth(opts) {
  const o = opts || {};
  const fsImpl = o.fsImpl || defaultFs();
  const roots = Array.isArray(o.projectRoots) ? o.projectRoots.filter(Boolean) : [];
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const projects = [];

  for (const rootRaw of roots) {
    let rootReal;
    try {
      rootReal = fsImpl.realpathSync(rootRaw);
    } catch {
      continue; // 根不存在/不可读 → 跳过,不崩溃
    }
    let entries;
    try {
      entries = fsImpl.readdirSync(rootReal, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent || !ent.isDirectory()) continue;
      const name = ent.name;
      if (!name || name.startsWith('.')) continue;
      const full = path.join(rootReal, name);
      let realFull;
      try { realFull = fsImpl.realpathSync(full); } catch { continue; }
      try {
        projects.push(computeProject(name, realFull, fsImpl));
      } catch {
        // 单项目异常 → 记为不可读,继续其它项目(AC6:不得整体崩溃)
        projects.push({
          name, path: full,
          claudeMdLines: null, claudeMdReadable: false,
          skillsFiles: 0, skillsLines: 0, skillsReadable: false,
        });
      }
    }
  }

  // 聚合:claudeMdLines 仅累加可读项(不可读项不计入总数,但会反映到 status)。
  let claudeMdLines = 0;
  let skillsFiles = 0;
  let skillsLines = 0;
  let anyClaudeMdReadable = false;   // 是否至少一个项目 CLAUDE.md 可读(含 0 行的空文件)
  let anyClaudeMdUnreadable = false; // 是否至少一个项目 CLAUDE.md 存在但读失败(权限等)
  const anyProject = projects.length > 0;
  for (const p of projects) {
    if (p.claudeMdLines != null) claudeMdLines += p.claudeMdLines;
    if (p.claudeMdReadable) anyClaudeMdReadable = true;
    if (p.claudeMdReadable === false && p.claudeMdLines === null) anyClaudeMdUnreadable = true;
    skillsFiles += p.skillsFiles || 0;
    skillsLines += p.skillsLines || 0;
  }

  let status;
  if (!anyProject) {
    status = 'empty';
  } else if (anyClaudeMdUnreadable && !anyClaudeMdReadable) {
    // 有项目但所有现存 CLAUDE.md 都不可读 → 无法读取(AC6 降级)
    status = 'unreadable';
  } else {
    status = classifyConfigHealth(claudeMdLines);
  }

  return {
    projects,
    totals: { claudeMdLines, skillsFiles, skillsLines },
    status,
    generatedAt: now,
  };
}

module.exports = {
  computeConfigHealth,
  computeProject,
  classifyConfigHealth,
  countLines,
  WARN_LINES,
  OVER_LINES,
};
