'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeConfigHealth, computeProject, classifyConfigHealth, countLines, WARN_LINES, OVER_LINES } = require('../config_health.cjs');

// —— countLines:编辑器视角行数 ——
test('countLines:基础计数', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('one'), 1);
  assert.equal(countLines('a\nb\nc'), 3);
  assert.equal(countLines('a\nb\nc\n'), 3); // 尾换行不额外计行
  assert.equal(countLines('\n\n\n'), 3);     // 三个空行
});

// —— classifyConfigHealth:阈值三态 + unreadable ——
test('classifyConfigHealth:60/300 阈值', () => {
  assert.equal(classifyConfigHealth(0), 'ok');
  assert.equal(classifyConfigHealth(WARN_LINES), 'ok');      // 60 → ok(≤60)
  assert.equal(classifyConfigHealth(WARN_LINES + 1), 'warn'); // 61 → warn
  assert.equal(classifyConfigHealth(OVER_LINES), 'warn');     // 300 → warn(≤300)
  assert.equal(classifyConfigHealth(OVER_LINES + 1), 'over'); // 301 → over
  assert.equal(classifyConfigHealth(null), 'unreadable');
  assert.equal(classifyConfigHealth(undefined), 'unreadable');
});

// 内存 fs:paths → {type, content?}。realpathSync 原样返回(测试无符号链接)。
function memFs(tree) {
  return {
    existsSync(p) { return !!tree[p]; },
    realpathSync(p) { if (!tree[p]) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return p; },
    readFileSync(p) {
      const n = tree[p];
      if (!n || n.type !== 'file') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (n.readError) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
      return n.content || '';
    },
    readdirSync(p, opts) {
      const n = tree[p];
      if (!n || n.type !== 'dir') { const e = new Error('ENOTDIR'); e.code = 'ENOTDIR'; throw e; }
      const out = [];
      for (const path of Object.keys(tree)) {
        if (path === p) continue;
        const prefix = p + '/';
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest.includes('/')) continue; // 仅直接子项
        const child = tree[path];
        out.push({
          name: rest,
          isDirectory() { return child.type === 'dir'; },
          isFile() { return child.type === 'file'; },
        });
      }
      return out;
    },
  };
}

function lines(n) { return Array.from({ length: n }, (_, i) => 'line ' + i).join('\n') + '\n'; }

test('computeConfigHealth:单项目 CLAUDE.md 行数 + skills 计数(AC1/AC3 指标准确)', () => {
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/proj': { type: 'dir' },
    '/root/proj/CLAUDE.md': { type: 'file', content: lines(42) },
    '/root/proj/.claude': { type: 'dir' },
    '/root/proj/.claude/skills': { type: 'dir' },
    '/root/proj/.claude/skills/deploy': { type: 'dir' },
    '/root/proj/.claude/skills/deploy/SKILL.md': { type: 'file', content: lines(10) },
    '/root/proj/.claude/skills/lint': { type: 'dir' },
    '/root/proj/.claude/skills/lint/SKILL.md': { type: 'file', content: lines(5) },
  });
  const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs, now: 1000 });
  assert.equal(r.projects.length, 1);
  const p = r.projects[0];
  assert.equal(p.name, 'proj');
  assert.equal(p.claudeMdLines, 42);
  assert.equal(p.claudeMdReadable, true);
  assert.equal(p.skillsFiles, 2);
  assert.equal(p.skillsLines, 15);
  assert.equal(r.totals.claudeMdLines, 42);
  assert.equal(r.totals.skillsFiles, 2);
  assert.equal(r.totals.skillsLines, 15);
  assert.equal(r.status, 'ok');
  assert.equal(r.generatedAt, 1000);
});

test('computeConfigHealth:阈值三态可复现(AC2)', () => {
  const cases = [
    { n: 50, expect: 'ok' },
    { n: WARN_LINES, expect: 'ok' },
    { n: 100, expect: 'warn' },
    { n: OVER_LINES, expect: 'warn' },
    { n: 400, expect: 'over' },
  ];
  for (const c of cases) {
    const fs = memFs({
      '/root': { type: 'dir' },
      '/root/p': { type: 'dir' },
      '/root/p/CLAUDE.md': { type: 'file', content: lines(c.n) },
    });
    const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
    assert.equal(r.status, c.expect, 'n=' + c.n + ' 应为 ' + c.expect + ' 实得 ' + r.status);
  }
});

test('computeConfigHealth:追加行后刷新计数一致(AC3 准确性)', () => {
  let content = lines(50);
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/p': { type: 'dir' },
    '/root/p/CLAUDE.md': { type: 'file', get content() { return content; } },
  });
  let r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.totals.claudeMdLines, 50);
  content = lines(50) + lines(7); // 追加 7 行
  r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.totals.claudeMdLines, 57);
});

test('computeConfigHealth:CLAUDE.md 不可读(权限)→ unreadable(AC6)', () => {
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/p': { type: 'dir' },
    '/root/p/CLAUDE.md': { type: 'file', content: lines(10), readError: true },
  });
  const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.projects[0].claudeMdReadable, false);
  assert.equal(r.projects[0].claudeMdLines, null);
  assert.equal(r.status, 'unreadable');
});

test('computeConfigHealth:CLAUDE.md 缺失 ≠ 不可读(status ok,行数 0)', () => {
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/p': { type: 'dir' },
    // 无 CLAUDE.md
    '/root/p/.claude': { type: 'dir' },
    '/root/p/.claude/skills': { type: 'dir' },
    '/root/p/.claude/skills/x': { type: 'dir' },
    '/root/p/.claude/skills/x/SKILL.md': { type: 'file', content: lines(3) },
  });
  const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.projects[0].claudeMdReadable, true);
  assert.equal(r.projects[0].claudeMdLines, 0);
  assert.equal(r.totals.skillsFiles, 1);
  assert.equal(r.status, 'ok');
});

test('computeConfigHealth:无 projectRoots → empty', () => {
  const r = computeConfigHealth({ projectRoots: [], fsImpl: memFs({}) });
  assert.equal(r.status, 'empty');
  assert.equal(r.projects.length, 0);
  assert.equal(r.totals.claudeMdLines, 0);
});

test('computeConfigHealth:根不存在 → 跳过不崩溃(empty)', () => {
  const r = computeConfigHealth({ projectRoots: ['/nope'], fsImpl: memFs({}) });
  assert.equal(r.status, 'empty');
});

test('computeConfigHealth:多项目聚合 totals 求和', () => {
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/a': { type: 'dir' },
    '/root/a/CLAUDE.md': { type: 'file', content: lines(40) },
    '/root/b': { type: 'dir' },
    '/root/b/CLAUDE.md': { type: 'file', content: lines(30) },
    '/root/b/.claude': { type: 'dir' },
    '/root/b/.claude/skills': { type: 'dir' },
    '/root/b/.claude/skills/s': { type: 'dir' },
    '/root/b/.claude/skills/s/SKILL.md': { type: 'file', content: lines(8) },
  });
  const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.projects.length, 2);
  assert.equal(r.totals.claudeMdLines, 70);
  assert.equal(r.totals.skillsFiles, 1);
  assert.equal(r.totals.skillsLines, 8);
  assert.equal(r.status, 'warn'); // 70 > 60
});

test('computeConfigHealth:跳过点号开头子目录', () => {
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/.hidden': { type: 'dir' },
    '/root/.hidden/CLAUDE.md': { type: 'file', content: lines(500) },
    '/root/real': { type: 'dir' },
    '/root/real/CLAUDE.md': { type: 'file', content: lines(20) },
  });
  const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].name, 'real');
});

test('computeProject:skills 目录缺失 → 0 文件且 readable', () => {
  const fs = memFs({
    '/p': { type: 'dir' },
    '/p/CLAUDE.md': { type: 'file', content: lines(5) },
  });
  const p = computeProject('p', '/p', fs);
  assert.equal(p.skillsFiles, 0);
  assert.equal(p.skillsLines, 0);
  assert.equal(p.skillsReadable, true);
});

test('computeConfigHealth:SKILL.md 大小写不敏感匹配', () => {
  const fs = memFs({
    '/root': { type: 'dir' },
    '/root/p': { type: 'dir' },
    '/root/p/CLAUDE.md': { type: 'file', content: lines(1) },
    '/root/p/.claude': { type: 'dir' },
    '/root/p/.claude/skills': { type: 'dir' },
    '/root/p/.claude/skills/a': { type: 'dir' },
    '/root/p/.claude/skills/a/skill.md': { type: 'file', content: lines(2) }, // 小写
  });
  const r = computeConfigHealth({ projectRoots: ['/root'], fsImpl: fs });
  assert.equal(r.totals.skillsFiles, 1);
  assert.equal(r.totals.skillsLines, 2);
});
