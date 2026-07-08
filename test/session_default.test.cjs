const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { slugifySessionName, resolveDefaultSessionForCwd } = require('../session_default.cjs');

// slugifySessionName 与 public/client.js:128 逐字等价(两端同步)。任一改动需同步另一端 + 此测试。

test('slugifySessionName: 已合法小写原样', () => {
  assert.equal(slugifySessionName('cc-web-control'), 'cc-web-control');
});

test('slugifySessionName: 大写转小写', () => {
  assert.equal(slugifySessionName('CC-Web-Control'), 'cc-web-control');
});

test('slugifySessionName: 空白/非法字符折叠为 -', () => {
  assert.equal(slugifySessionName('My Project!'), 'my-project');
});

test('slugifySessionName: 空串/null/全非法 → 兜底 project', () => {
  assert.equal(slugifySessionName(''), 'project');
  assert.equal(slugifySessionName('!!!'), 'project');
  assert.equal(slugifySessionName(null), 'project');
  assert.equal(slugifySessionName(undefined), 'project');
});

test('slugifySessionName: 截断到 48 字符', () => {
  assert.equal(slugifySessionName('a'.repeat(60)).length, 48);
});

test('slugifySessionName: 输出恒满足 isValidSessionName 字符集 [A-Za-z0-9._-]', () => {
  for (const input of ['cc-web-control', 'A B/C', '...', 'x_1.2', 'café', '中文项目']) {
    assert.match(slugifySessionName(input), /^[a-z0-9._-]{1,48}$/);
  }
});

// resolveDefaultSessionForCwd:realpath 匹配同 server.cjs /api/projects + client.js syncProjectSelect。

function makeRootWithProjects(...names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-default-'));
  for (const n of names) fs.mkdirSync(path.join(root, n), { recursive: true });
  return root;
}

test('resolveDefaultSessionForCwd: cwd 命中项目 → claude-<项目名>', () => {
  const root = makeRootWithProjects('cc-web-control', 'other-proj');
  try {
    const cwd = path.join(root, 'cc-web-control');
    assert.equal(resolveDefaultSessionForCwd(cwd, [root], 'claude-web-session'), 'claude-cc-web-control');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDefaultSessionForCwd: cwd 未命中(在 root 外)→ fallback', () => {
  const root = makeRootWithProjects('cc-web-control');
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'));
  try {
    assert.equal(resolveDefaultSessionForCwd(elsewhere, [root], 'claude-web-session'), 'claude-web-session');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('resolveDefaultSessionForCwd: 空 projectRoots → fallback', () => {
  assert.equal(resolveDefaultSessionForCwd('/whatever', [], 'claude-web-session'), 'claude-web-session');
  assert.equal(resolveDefaultSessionForCwd('/whatever', undefined, 'claude-web-session'), 'claude-web-session');
});

test('resolveDefaultSessionForCwd: cwd 不存在(realpath miss)→ fallback', () => {
  const root = makeRootWithProjects('cc-web-control');
  try {
    assert.equal(resolveDefaultSessionForCwd('/no/such/dir/xyz', [root], 'claude-web-session'), 'claude-web-session');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDefaultSessionForCwd: 多 root 命中靠后的', () => {
  const root1 = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-'));
  const root2 = makeRootWithProjects('zzz');
  try {
    const cwd = path.join(root2, 'zzz');
    assert.equal(resolveDefaultSessionForCwd(cwd, [root1, root2], 'claude-web-session'), 'claude-zzz');
  } finally {
    fs.rmSync(root1, { recursive: true, force: true });
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

test('resolveDefaultSessionForCwd: 跳过隐藏目录与非目录条目', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-'));
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
  fs.mkdirSync(path.join(root, 'real-proj'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a-file'), 'x');
  try {
    // .hidden 是项目子目录但隐藏 → 跳过 → fallback
    assert.equal(resolveDefaultSessionForCwd(path.join(root, '.hidden'), [root], 'claude-web-session'), 'claude-web-session');
    // real-proj 命中
    assert.equal(resolveDefaultSessionForCwd(path.join(root, 'real-proj'), [root], 'claude-web-session'), 'claude-real-proj');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDefaultSessionForCwd: 项目名含大写/空格 → slugify 后拼前缀', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cased-'));
  fs.mkdirSync(path.join(root, 'My Cool Proj'), { recursive: true });
  try {
    const cwd = path.join(root, 'My Cool Proj');
    assert.equal(resolveDefaultSessionForCwd(cwd, [root], 'claude-web-session'), 'claude-my-cool-proj');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
