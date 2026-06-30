# 按项目路径启动 Claude 会话(续接优先)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cc-web-control 控制台「选项目即进入,优先续接该项目最近 Claude 会话,无历史则新建」,Project 下拉框升为主入口,Session 降为次要。

**Architecture:** 后端 `startClaudeInSession` 改续接优先,Node 层 `shouldContinue` 纯函数查该项目 jsonl 决定 `claude -c` / `claude`,`cd` 与启动合并为单条命令消除时序竞态;前端 Project 下拉框默认可见 + 空状态提示(纯函数 `projectsView` 决策),Session 桌面缩小 / 窄屏收起,切到只剩 shell 的会话给最小提示(纯函数 `detectDeadState`);看板走已有 mtime 降级路径;启动时一次性迁移陈旧 `.cc-web-bindings` 绑定。

**Tech Stack:** Node.js CommonJS(`.cjs`)、Express、tmux、原生 JS(UMD 前端纯模块)、`node --test`。

**Spec:** `docs/superpowers/specs/2026-06-28-project-path-agent-launch-design.md`

---

## File Structure

**新建:**
- `claude_session.cjs` — `shouldContinue(cwd, baseDir)` 纯函数(续接判断,无 IO 副作用)
- `public/projectsView.cjs` — `projectsView({projects, hasRoots})` 纯渲染决策(UMD,前后端共享)
- `public/deadState.cjs` — `detectDeadState({name, claudeSessionId})` 纯函数(死状态提示决策,UMD)
- `test/claude_session.test.cjs` / `test/projectsView.test.cjs` / `test/deadState.test.cjs` / `test/startClaudeInSession_contract.test.cjs`

**修改:**
- `server.cjs` — `startClaudeInSession`(125-144)改续接优先 + 单条命令;DEFAULT_SESSION 调用点(213)传 `useClaudeContinue`;POST /api/sessions(466)删 forceNew;启动入口(696)加 `migrateStaleBindings`
- `dashboard_binding.cjs` — 删 `createSessionBinding`,加 `migrateStaleBindings`
- `public/index.html`(42-46)— Project 去 `hidden`,加空状态元素
- `public/client.js` — `loadProjects`(702-729)空状态渲染;切换路径(743-752)死状态提示
- `public/style.css` — Session 桌面缩小,窄屏收起

**共享接口(锁死):**
- `shouldContinue(cwd, baseDir)` → `boolean`(`baseDir` 透传 `resolveProjectDir` 做测试隔离)
- `projectsView({projects, hasRoots})` → `{showSelect, showButton, emptyHint}`
- `detectDeadState({name, claudeSessionId})` → `{shouldHint, hint}`
- `migrateStaleBindings(projectsDir)` → `Array<{slug, tmuxName, sid}>`
- `startClaudeInSession(sessionName, cwd, opts = {})`,`opts.useClaudeContinue` 区分 DEFAULT_SESSION 路径

**执行顺序:** Task 1→2→3(后端,有依赖);Task 4→5(前端,有依赖);Task 6、Task 7 独立。后端组与前端组可并行。

---

## Task 1: claude_session.cjs shouldContinue 纯函数

**Files:**
- Create: `claude_session.cjs`
- Test: `test/claude_session.test.cjs`

- [ ] **Step 1: 写失败测试**

```javascript
// test/claude_session.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { cwdToSlug } = require('../dashboard_slug.cjs');
const { shouldContinue } = require('../claude_session.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-session-'));
}
function rm(d) {
  fs.rmSync(d, { recursive: true, force: true });
}

test('shouldContinue: slug 目录下 >=1 jsonl → true', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/sample-proj';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'abc-123.jsonl'), '{}\n');
    assert.equal(shouldContinue(cwd, base), true);
  } finally {
    rm(base);
  }
});

test('shouldContinue: cwd 对应目录不存在 → false', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/never-launched';
    assert.equal(shouldContinue(cwd, base), false);
  } finally {
    rm(base);
  }
});

test('shouldContinue: 目录存在但 0 jsonl → false(关键边界)', () => {
  const base = tmpDir();
  try {
    const cwd = '/Users/roc/workspace/empty-proj';
    const slugDir = path.join(base, cwdToSlug(cwd));
    fs.mkdirSync(slugDir, { recursive: true });
    fs.mkdirSync(path.join(slugDir, 'subagents'), { recursive: true });
    assert.equal(shouldContinue(cwd, base), false);
  } finally {
    rm(base);
  }
});

test('shouldContinue: baseDir 缺省时不抛,返回 boolean', () => {
  const result = shouldContinue('/Users/roc/workspace/cc-web-control');
  assert.equal(typeof result, 'boolean');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/claude_session.test.cjs`
Expected: FAIL — `Cannot find module '../claude_session.cjs'`

- [ ] **Step 3: 最小实现**

```javascript
// claude_session.cjs
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/claude_session.test.cjs`
Expected: PASS(4 个 test 全过)

- [ ] **Step 5: 提交**

```bash
git add claude_session.cjs test/claude_session.test.cjs
git commit -m "feat: 新增 shouldContinue 纯函数,判断项目是否可续接最近会话"
```

---

## Task 2: server.cjs startClaudeInSession 改为续接优先

**Files:**
- Modify: `server.cjs:22`(require 行)
- Modify: `server.cjs:125-144`(`startClaudeInSession` 函数体)
- Modify: `server.cjs:213`(DEFAULT_SESSION 调用点)
- Test: `test/startClaudeInSession_contract.test.cjs`(源码 grep 契约,弥补 server.cjs 未导出)

> server.cjs 未导出 `startClaudeInSession`,引入 HTTP 集成测试属 spec 非目标。本任务用源码 grep 契约测试做回归闸门:行为正确性由 Task 1 `shouldContinue` 纯函数测试 + 既有 `test/claude_launch.test.cjs`(`buildClaudeLaunchCommand` 的 `-c` 拼接已 100% 覆盖)共同保证。

- [ ] **Step 1: 写失败测试(契约级断言)**

```javascript
// test/startClaudeInSession_contract.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

function extractFunction(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let i = m.index + m[0].lastIndexOf('{');
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error(`function ${name} braces unbalanced`);
}

test('server.cjs: require claude_session.cjs', () => {
  assert.ok(/require\(['"]\.\/claude_session\.cjs['"]\)/.test(SERVER),
    '未 require ./claude_session.cjs');
});

test('startClaudeInSession: 不再调用 createSessionBinding', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(!/createSessionBinding\s*\(/.test(inFn),
    'startClaudeInSession 仍调用 createSessionBinding');
});

test('startClaudeInSession: 不再注入 CC_WEB_CLAUDE_SESSION_ID', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(!/CC_WEB_CLAUDE_SESSION_ID/.test(inFn),
    'startClaudeInSession 仍注入 CC_WEB_CLAUDE_SESSION_ID');
});

test('startClaudeInSession: cd 与启动合并为单条命令', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(/cd\s+"[^"]*"\s*&&\s*/.test(inFn),
    '未合并为 cd "..." && <launch> 单条 sendKeys');
});

test('startClaudeInSession: 续接判断走 shouldContinue', () => {
  const inFn = extractFunction(SERVER, 'startClaudeInSession');
  assert.ok(/shouldContinue\s*\(/.test(inFn),
    '未调用 shouldContinue(cwd)');
});

test('startClaudeInSession: DEFAULT_SESSION 调用走 useClaudeContinue(范围限定)', () => {
  const initFn = extractFunction(SERVER, 'initAndAttachSession');
  assert.ok(/startClaudeInSession\(\s*DEFAULT_SESSION\s*,\s*cwd\s*,\s*\{\s*useClaudeContinue:\s*true\s*\}\s*\)/.test(initFn),
    'DEFAULT_SESSION 启动未传 { useClaudeContinue: true },CLAUDE_CONTINUE 行为被破坏');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/startClaudeInSession_contract.test.cjs`
Expected: FAIL — 6 个契约 test 失败:旧 `startClaudeInSession` 仍含 `createSessionBinding(`、`CC_WEB_CLAUDE_SESSION_ID`、两条独立 `await tmux.sendKeys`、未调 `shouldContinue`;server.cjs 未 require claude_session.cjs;DEFAULT_SESSION 调用无 `useClaudeContinue`。

- [ ] **Step 3: 最小实现**

修改 `server.cjs:22` require 行:

旧:
```javascript
const { readBinding, createSessionBinding, deleteBinding } = require('./dashboard_binding.cjs');
```

新:
```javascript
const { readBinding, deleteBinding } = require('./dashboard_binding.cjs');
const { shouldContinue } = require('./claude_session.cjs');
```

修改 `server.cjs:125-144`(`startClaudeInSession` 整体替换):

```javascript
/**
 * 在 tmux 会话内启动 claude。
 * @param {string} sessionName
 * @param {string} cwd
 * @param {object} [opts]
 * @param {boolean} [opts.useClaudeContinue] 服务启动 DEFAULT_SESSION 沿用 CLAUDE_CONTINUE;
 *   web 路径不传 → 走 shouldContinue(cwd) 续接优先(范围限定)。
 */
async function startClaudeInSession(sessionName, cwd, opts = {}) {
  const escapedCwd = shellEscapeForDoubleQuotes(cwd);
  // web 路径(默认):shouldContinue 判断 —— 有历史会话 → -c 续接;无 → 纯新建。
  //   不再预生成 UUID / writeBinding,看板走 mtime 降级(test/dashboard_cache.test.cjs:157 已覆盖)。
  // DEFAULT_SESSION 路径(useClaudeContinue=true):沿用 CLAUDE_CONTINUE,行为不变。
  const continueConversation = opts.useClaudeContinue
    ? CLAUDE_CONTINUE
    : shouldContinue(cwd);
  // cd 与 claude 启动合并为单条命令,消除慢盘 / direnv hook 下 cd 未生效就发 claude 的时序竞态
  const launch = buildClaudeLaunchCommand({ wrapperPath: CLAUDE_WRAPPER, continueConversation });
  await tmux.sendKeys(sessionName, `cd "${escapedCwd}" && ${launch}`);
}
```

修改 `server.cjs:213`(DEFAULT_SESSION 调用点,显式传 useClaudeContinue):

旧:
```javascript
      await startClaudeInSession(DEFAULT_SESSION, cwd);
```

新:
```javascript
      await startClaudeInSession(DEFAULT_SESSION, cwd, { useClaudeContinue: true });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/startClaudeInSession_contract.test.cjs`
Expected: PASS — 6 个契约 test 全过。

回归:`node --test test/dashboard_slug.test.cjs test/claude_launch.test.cjs test/claude_session.test.cjs`
Expected: 全 PASS。

- [ ] **Step 5: 提交**

```bash
git add server.cjs test/startClaudeInSession_contract.test.cjs
git commit -m "refactor: startClaudeInSession 改为续接优先,cd 与启动合并单条命令消除时序竞态"
```

---

## Task 3: POST /api/sessions 续接语义 + 旧绑定一次性迁移 + 删 createSessionBinding

**Files:**
- Modify: `server.cjs:466`(POST /api/sessions 删 forceNew)
- Modify: `server.cjs:696`(启动入口加迁移)
- Modify: `dashboard_binding.cjs`(删 createSessionBinding,加 migrateStaleBindings)
- Test: `test/dashboard_binding.test.cjs`(新增 migrateStaleBindings TDD)

> 范围限定:`DELETE /api/sessions:484` 的 `deleteBinding` 保留(幂等无害);`listSessions:166` 的 `readBinding` 保留(无绑定返 null,看板走 mtime 降级)。

- [ ] **Step 1: 写失败测试**

```javascript
// 追加到 test/dashboard_binding.test.cjs 末尾
const { migrateStaleBindings } = require('../dashboard_binding.cjs');

test('migrateStaleBindings: 删除 sid 在 slug 目录下无同名 jsonl 的陈旧绑定', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bind-'));
  try {
    const cwd = '/Users/roc/workspace/proj-stale';
    const slug = cwdToSlug(cwd);
    const tmuxName = 'claude-proj-stale';
    const slugDir = path.join(base, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'other-uuid-2222.jsonl'), '{}\n');
    writeBinding(slug, tmuxName, 'dead-uuid-1111', base);
    assert.equal(readBinding(slug, tmuxName, base), 'dead-uuid-1111');

    const removed = migrateStaleBindings(base);

    assert.equal(removed.length, 1);
    assert.equal(removed[0].tmuxName, tmuxName);
    assert.equal(readBinding(slug, tmuxName, base), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('migrateStaleBindings: 保留 sid 有同名 jsonl 的有效绑定', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bind-'));
  try {
    const slug = cwdToSlug('/Users/roc/workspace/proj-live');
    const tmuxName = 'claude-proj-live';
    const slugDir = path.join(base, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'live-uuid-3333.jsonl'), '{}\n');
    writeBinding(slug, tmuxName, 'live-uuid-3333', base);

    const removed = migrateStaleBindings(base);

    assert.deepEqual(removed, []);
    assert.equal(readBinding(slug, tmuxName, base), 'live-uuid-3333');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('migrateStaleBindings: slug 目录不存在 → 删绑定', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bind-'));
  try {
    const slug = cwdToSlug('/Users/roc/workspace/proj-gone');
    writeBinding(slug, 'claude-proj-gone', 'orphan-uuid-4444', base);

    const removed = migrateStaleBindings(base);

    assert.equal(removed.length, 1);
    assert.equal(readBinding(slug, 'claude-proj-gone', base), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('migrateStaleBindings: 空 baseDir → 返回 [] 不抛', () => {
  assert.deepEqual(migrateStaleBindings('/no/such/base'), []);
});

test('dashboard_binding.cjs: 不再导出 createSessionBinding', () => {
  const mod = require('../dashboard_binding.cjs');
  assert.equal(typeof mod.createSessionBinding, 'undefined');
  assert.equal(typeof mod.migrateStaleBindings, 'function');
  assert.equal(typeof mod.readBinding, 'function');
  assert.equal(typeof mod.deleteBinding, 'function');
});
```

> 若 `test/dashboard_binding.test.cjs` 顶部尚未 require `fs/path/os/cwdToSlug/writeBinding/readBinding`,补上(沿用该文件现有 import 风格)。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/dashboard_binding.test.cjs`
Expected: FAIL — `migrateStaleBindings is not a function` / `Cannot find`;导出契约 `typeof createSessionBinding` 仍为 `'function'`。

- [ ] **Step 3: 最小实现**

修改 `dashboard_binding.cjs` require 区(补 `listProjectJsonls`):

旧(约第 20 行):
```javascript
const { cwdToSlug } = require('./dashboard_slug.cjs');
```

新:
```javascript
const { cwdToSlug, listProjectJsonls } = require('./dashboard_slug.cjs');
```

删除原 `createSessionBinding` 函数整体(连同其实现,彻底消除死代码)。

在 `module.exports` 之前新增 `migrateStaleBindings`:

```javascript
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
```

修改 `module.exports`(删 `createSessionBinding`,加 `migrateStaleBindings`):

```javascript
module.exports = {
  readBinding,
  writeBinding,
  deleteBinding,
  migrateStaleBindings,
  BINDING_DIRNAME,
};
```

> `writeBinding` 保留导出:测试需它构造绑定夹具,`migrateStaleBindings` 内部不调它。`DEFAULT_PROJECTS_DIR`(dashboard_binding.cjs:22,`path.join(os.homedir(), '.claude', 'projects')`)与 `BINDING_DIRNAME`(dashboard_binding.cjs:23,`'.cc-web-bindings'`)均为现有常量,直接复用。

修改 `server.cjs:22` require(补 `migrateStaleBindings`,与 Task 2 的解构合并):

```javascript
const { readBinding, deleteBinding, migrateStaleBindings } = require('./dashboard_binding.cjs');
const { shouldContinue } = require('./claude_session.cjs');
```

修改 `server.cjs:466`(POST /api/sessions 内,删 forceNew `true`):

旧:
```javascript
        await startClaudeInSession(name, normalizedCwd, true);
```

新:
```javascript
        // web 选项目创建会话:startClaudeInSession 内部走 shouldContinue 续接优先
        // (有历史 → claude -c;无历史 → claude 新建)。不再 forceNew 预生成 UUID。
        await startClaudeInSession(name, normalizedCwd);
```

修改 `server.cjs:696` 启动入口(在 `// 启动` 注释后、`if (WEB_ONLY)` 前插入无条件迁移):

```javascript
// 启动
// 一次性迁移:旧流程写的绑定(sid 指向已不存在的 jsonl)会让 listSessions readBinding
// 回填陈旧 sid,看板错位。新流程不再写绑定,迁移后目录自然不再增长。与 tmux 无关,两种模式都跑。
try {
  const removed = migrateStaleBindings();
  if (removed.length > 0) {
    console.log(`[Init] 清理 ${removed.length} 个陈旧会话绑定:${removed.map((r) => r.tmuxName).join(', ')}`);
  }
} catch (err) {
  console.error('[Init] 旧绑定迁移失败(非致命):', err.message);
}

if (WEB_ONLY) {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/dashboard_binding.test.cjs`
Expected: PASS — migrateStaleBindings 4 场景 + 导出契约全过。

回归:`node --test test/dashboard_cache.test.cjs test/dashboard_slug.test.cjs test/claude_session.test.cjs test/startClaudeInSession_contract.test.cjs`
Expected: 全 PASS。

手动验证:`node server.cjs` 启动时若 `.cc-web-bindings` 下有陈旧绑定,控制台打印 `[Init] 清理 N 个陈旧会话绑定:...`;无则静默。

- [ ] **Step 5: 提交**

```bash
git add dashboard_binding.cjs server.cjs test/dashboard_binding.test.cjs
git commit -m "refactor: POST 走续接语义,启动迁移陈旧绑定,删 createSessionBinding 死代码"
```

---

## Task 4: public/projectsView.cjs 纯渲染决策函数

**Files:**
- Create: `public/projectsView.cjs`
- Test: `test/projectsView.test.cjs`

> 暴露方式沿用现有前端纯模块 `tmux_actions.cjs` / `terminal_cleaner.cjs` 的 UMD 风格(`module.exports` 供 node 测试 require,`window.ProjectsView` 供浏览器)。

- [ ] **Step 1: 写失败测试**

```javascript
// test/projectsView.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectsView } = require('../public/projectsView.cjs');

test('projectsView: 有项目 → 显示下拉框与启动按钮,无空状态文案', () => {
  const out = projectsView({
    projects: [{ name: 'cc-web-control', path: '/Users/roc/workspace/cc-web-control' }],
    hasRoots: true,
  });
  assert.deepEqual(out, { showSelect: true, showButton: true, emptyHint: '' });
});

test('projectsView: 无项目且未配置根目录 → 隐藏控件,提示未配置', () => {
  const out = projectsView({ projects: [], hasRoots: false });
  assert.equal(out.showSelect, false);
  assert.equal(out.showButton, false);
  assert.match(out.emptyHint, /CC_WEB_PROJECT_ROOTS/);
});

test('projectsView: 无项目但已配置根目录 → 隐藏控件,提示目录为空(区别未配置)', () => {
  const out = projectsView({ projects: [], hasRoots: true });
  assert.equal(out.showSelect, false);
  assert.equal(out.showButton, false);
  assert.doesNotMatch(out.emptyHint, /CC_WEB_PROJECT_ROOTS/);
  assert.match(out.emptyHint, /空|没有/);
});

test('projectsView: 输入非法 → 安全降级隐藏 + 未配置提示', () => {
  const out = projectsView(null);
  assert.equal(out.showSelect, false);
  assert.equal(out.showButton, false);
  assert.match(out.emptyHint, /CC_WEB_PROJECT_ROOTS/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/projectsView.test.cjs`
Expected: FAIL — `Cannot find module '../public/projectsView.cjs'`

- [ ] **Step 3: 最小实现**

```javascript
// public/projectsView.cjs
/**
 * Project 选择区纯渲染决策(共享前后端,无 DOM)。
 * 输入 { projects, hasRoots } → 输出 { showSelect, showButton, emptyHint }。
 * 设计依据:2026-06-28-project-path-agent-launch-design.md「前端入口」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProjectsView = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const HINT_NO_ROOTS =
    '未找到项目。在启动服务处设置 export CC_WEB_PROJECT_ROOTS=/路径A,/路径B 后重启服务。';
  const HINT_EMPTY_DIR =
    '已配置项目根目录,但未扫描到任何子目录项目。请检查根目录下是否有项目文件夹。';

  function projectsView(input) {
    const safe = input && typeof input === 'object' ? input : {};
    const projects = Array.isArray(safe.projects) ? safe.projects : [];
    const hasRoots = safe.hasRoots === true;

    if (projects.length > 0) {
      return { showSelect: true, showButton: true, emptyHint: '' };
    }
    return {
      showSelect: false,
      showButton: false,
      emptyHint: hasRoots ? HINT_EMPTY_DIR : HINT_NO_ROOTS,
    };
  }

  return { projectsView };
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/projectsView.test.cjs`
Expected: PASS(4 个用例全绿)

- [ ] **Step 5: 提交**

```bash
git add public/projectsView.cjs test/projectsView.test.cjs
git commit -m "feat: 新增 projectsView 纯渲染决策函数及单测"
```

---

## Task 5: index.html 去 hidden + 空状态元素 + client.js loadProjects 空状态渲染

**Files:**
- Modify: `public/index.html:42-46`
- Modify: `public/client.js:702-729`(`loadProjects`)
- Test: 纯函数已由 Task 4 覆盖;DOM 绑定手动验证。

> `hasRoots` 从 `GET /api/projects` 已返回的 `roots` 字段(server.cjs:438 `res.json({ roots: PROJECT_ROOTS, projects })`)推导:`hasRoots = Array.isArray(data.roots) && data.roots.length > 0`。无需后端改动。

- [ ] **Step 1: 改 index.html — 去 Project 控件 hidden,新增空状态元素**

定位 `public/index.html:42-46`(`<label id="projectControl" class="control" hidden>` + `<select id="projectSelect">` + `<button id="startProject" class="btn" type="button" hidden>`)。改为:

```html
<label id="projectControl" class="control">
    <span class="control-label">Project</span>
    <select id="projectSelect" class="control-input"></select>
</label>
<p id="projectsEmpty" class="projects-empty" hidden></p>
<button id="startProject" class="btn" type="button">启动</button>
```

(去掉两处 `hidden`,在 Project 下拉框后新增 `<p id="projectsEmpty">`。不重命名任何现有 id/class。实际 DOM 结构以 index.html 现有为谁,只去 hidden + 加 `<p id="projectsEmpty">`,其余属性保持。)

- [ ] **Step 2: index.html 引入 projectsView.cjs**

在 client.js 的 `<script>` 标签之前,新增(与现有 `tmux_actions.cjs` script 并列):

```html
<script src="projectsView.cjs"></script>
```

- [ ] **Step 3: 改 client.js loadProjects — 调 projectsView 决定显示 + 渲染 emptyHint**

定位 `public/client.js:702-729` `loadProjects`,整体替换:

```javascript
    async function loadProjects() {
        if (!projectSelect || !projectControl || !startProjectBtn) return;
        const projectsEmptyEl = document.getElementById('projectsEmpty');
        const applyView = (view) => {
            projectControl.hidden = !view.showSelect;
            startProjectBtn.hidden = !view.showButton;
            if (projectsEmptyEl) {
                if (view.emptyHint) {
                    projectsEmptyEl.textContent = view.emptyHint;
                    projectsEmptyEl.hidden = false;
                } else {
                    projectsEmptyEl.textContent = '';
                    projectsEmptyEl.hidden = true;
                }
            }
        };
        try {
            const data = await fetchJson('/api/projects');
            const projects = data && Array.isArray(data.projects) ? data.projects : [];
            const hasRoots = Boolean(data && Array.isArray(data.roots) && data.roots.length > 0);
            const viewFn = (typeof ProjectsView !== 'undefined' && ProjectsView.projectsView) || null;
            const view = viewFn
                ? viewFn({ projects, hasRoots })
                : { showSelect: projects.length > 0, showButton: projects.length > 0, emptyHint: '' };
            applyView(view);
            if (!projects.length) return;

            projectSelect.innerHTML = '';
            for (const p of projects) {
                const opt = document.createElement('option');
                opt.value = p.path;
                opt.dataset.projectName = p.name;
                if (p.root) opt.dataset.projectRoot = p.root;
                opt.textContent = p.root ? `${p.name} (${p.root})` : p.name;
                projectSelect.appendChild(opt);
            }
        } catch {
            const viewFn = (typeof ProjectsView !== 'undefined' && ProjectsView.projectsView) || null;
            const view = viewFn
                ? viewFn({ projects: [], hasRoots: false })
                : { showSelect: false, showButton: false, emptyHint: '' };
            applyView(view);
        }
    }
```

(不重命名现有 id/class。`hasRoots` 从 `data.roots` 推导,不依赖后端新增字段。模块未加载时兜底降级,不阻断。)

- [ ] **Step 4: 手动验证(DOM 绑定,无自动化测试)**

Run: `node server.cjs` → 浏览器打开控制台。
1. 默认进入,Project 下拉框**可见**(不被 JS 藏回)。
2. 未配 `CC_WEB_PROJECT_ROOTS`:`projectsEmpty` 显示「未找到项目...CC_WEB_PROJECT_ROOTS...」,启动按钮隐藏。
3. 配了 roots 但根目录无子目录:显示「已配置项目根目录,但未扫描到...」(区别未配置)。
4. 配了 roots 且有子目录:下拉框列出项目,无空状态文案,启动按钮可见。
5. 控制台无 `ProjectsView is not defined` 报错。

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/client.js
git commit -m "feat: Project 下拉框默认可见并渲染空状态提示"
```

---

## Task 6: 死状态最小提示(切到只剩 shell 的会话)

**Files:**
- Create: `public/deadState.cjs`
- Modify: `public/client.js:743-752`(切换已存在 session 分支)
- Test: `test/deadState.test.cjs`

> 语义说明(控制台限制):控制台 client.js **不调** `/api/dashboard`(那是 dashboard.js 的职责),无法可靠检测 claude 进程当前是否存活。`/api/sessions` 返回的 `claudeSessionId`(有绑定文件说明曾跑过 claude)作「值得提示」的代理标记:只要该会话曾跑过 claude 就提示「**可能**已退出」,提示文案明确是「可能」,由用户在终端确认。不自动重启,不阻塞切换。

- [ ] **Step 1: 写失败测试**

```javascript
// test/deadState.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDeadState, DEAD_HINT } = require('../public/deadState.cjs');

test('detectDeadState: 有 claude 历史绑定 → 提示(shouldHint true)', () => {
  const out = detectDeadState({ name: 'claude-foo', claudeSessionId: 'abc-123' });
  assert.equal(out.shouldHint, true);
  assert.equal(out.hint, DEAD_HINT);
});

test('detectDeadState: 无 claude 历史绑定(首次进入)→ 不提示', () => {
  const out = detectDeadState({ name: 'claude-foo', claudeSessionId: undefined });
  assert.equal(out.shouldHint, false);
  assert.equal(out.hint, '');
});

test('detectDeadState: 输入非法 → 安全降级不提示', () => {
  const out = detectDeadState(null);
  assert.equal(out.shouldHint, false);
  assert.equal(out.hint, '');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/deadState.test.cjs`
Expected: FAIL — `Cannot find module '../public/deadState.cjs'`

- [ ] **Step 3: 最小实现**

```javascript
// public/deadState.cjs
/**
 * 死状态提示决策(共享前后端,无 DOM)。
 * 切到曾跑过 claude(claudeSessionId 非空)的已存在 session 时,提示 claude 可能已退出。
 * 仅提示,不自动重启。设计依据:2026-06-28-project-path-agent-launch-design.md「边界」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeadState = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEAD_HINT =
    '该会话的 Claude 可能已退出,可在终端输入 claude -c 续接,或删除会话后重建。';

  function detectDeadState(entry) {
    const safe = entry && typeof entry === 'object' ? entry : {};
    if (!Boolean(safe.claudeSessionId)) {
      return { shouldHint: false, hint: '' };
    }
    return { shouldHint: true, hint: DEAD_HINT };
  }

  return { detectDeadState, DEAD_HINT };
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/deadState.test.cjs`
Expected: PASS(3 个用例全绿)

- [ ] **Step 5: index.html 引入 deadState.cjs**

在 client.js 的 `<script>` 之前新增(与 projectsView.cjs 并列):

```html
<script src="deadState.cjs"></script>
```

- [ ] **Step 6: 改 client.js 切换分支调用死状态提示**

定位 `public/client.js:743-752` 切换已存在 session 段(`if (names.includes(sessionName)) { ... showSystemNote('已切换到会话...'); return; }`)。在 `showSystemNote(`已切换到会话...`)` 之后、`return` 之前插入:

```javascript
            const entry = Array.isArray(sessions) ? sessions.find((s) => s && s.name === sessionName) : null;
            const detect = (typeof DeadState !== 'undefined' && DeadState.detectDeadState) || null;
            if (detect && entry) {
                const dead = detect({ name: entry.name, claudeSessionId: entry.claudeSessionId });
                if (dead.shouldHint) showSystemNote(dead.hint);
            }
```

(`sessions` 变量在上方 `const sessions = await fetchJson('/api/sessions')` 已存在,直接复用。`showSystemNote` 是 client.js 现有终端提示函数。)

- [ ] **Step 7: 手动验证(DOM 绑定)**

Run: `node server.cjs` → 浏览器控制台。
1. 选一个**有历史 claude 绑定**的已存在项目会话(`claude-<project>`,`.cc-web-bindings` 下有 sid),点启动 → 切换后终端额外出现「该会话的 Claude 可能已退出...」提示。
2. 选一个**首次进入**(无绑定)的新项目,POST 创建路径 → 不出现死状态提示。
3. 控制台无 `DeadState is not defined` 报错。
4. 提示出现后不阻断 WebSocket(终端正常)。

- [ ] **Step 8: 提交**

```bash
git add public/deadState.cjs public/index.html public/client.js test/deadState.test.cjs
git commit -m "feat: 切到曾跑过 claude 的会话时给最小续接提示"
```

---

## Task 7: style.css Session 桌面缩小 + 窄屏收起

**Files:**
- Modify: `public/style.css`(`.control-input` 规则后 + `@media (max-width: 768px)` 块内)
- Test: 纯 CSS,无自动化测试,手动验证。

> 令牌来自 `tokens.css`(`--muted` / `--border` / `--brand` / `--bg` 等)。`.control-input` / `.btn` 现有规则沿用,仅压窄 Session 控件。窄屏媒体查询块有两处(style.css:249、451),收起规则嵌在 451 那处(含 `.control-label { display: none }`),不新增第三个 `@media` 块。

- [ ] **Step 1: 桌面端 Session 控件缩小**

在 `public/style.css` 的 `.control-input { ... }` 规则块之后(约 103-116 行),新增:

```css
/* 桌面端 Session 下拉框缩小(label 已隐藏),Project 升为主入口 */
#sessionSelect.control-input {
    max-width: 140px;
}

#refreshSessions.btn {
    padding: 0 8px;
}
```

- [ ] **Step 2: 窄屏(<768px)收起 Session 控件**

在 `public/style.css:451` 现有 `@media (max-width: 768px)` 块内,`.control-label { display: none; }` 之后,追加:

```css
    /* 窄屏收起 Session 下拉框及刷新按钮,只露 Project + 启动 */
    #sessionSelect.control-input,
    #refreshSessions.btn {
        display: none;
    }
```

(仅追加这一条规则,嵌在现有媒体查询块内。不改动 `.logo` / `.messages` / `.terminal-view` 等原有规则。)

- [ ] **Step 3: 手动验证(纯 CSS)**

Run: `node server.cjs` → 浏览器控制台 + DevTools 设备模拟。
1. **桌面端(≥769px)**:Session 下拉框宽度 ≤140px,刷新按钮收窄;Project + 启动正常可见;整行不拥挤。
2. **窄屏(375px / 768px)**:Session 下拉框与刷新按钮**完全隐藏**,只剩 Project + 启动。
3. **暗色模式**(`prefers-color-scheme: dark`):缩小后边框 / 背景沿用令牌,无割裂。
4. 切回桌面端,Session 控件恢复可见且缩小态正常;`.controls`(`flex-wrap: wrap`)不溢出 header。

- [ ] **Step 4: 提交**

```bash
git add public/style.css
git commit -m "style: Session 控件桌面缩小、窄屏收起,Project 升为主入口"
```

---

## 完成标准

- `node --test test/*.test.cjs` 全 PASS(含新增 claude_session / projectsView / deadState / startClaudeInSession_contract,既有 dashboard_binding / dashboard_slug / dashboard_cache / claude_launch 不回归)。
- 手动验证清单(Task 5 / 6 / 7)全部通过。
- `node server.cjs` 启动正常,迁移日志(若有陈旧绑定)输出正确。
- 未重命名任何现有 DOM id / class(`client.js` / `dashboard.js` DOM 锁定清单不受影响)。
- 未引入 jsdom / supertest / server.cjs HTTP 集成测试基建。
