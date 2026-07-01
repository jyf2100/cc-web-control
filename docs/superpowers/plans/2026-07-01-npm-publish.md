# cc-web-control npm 发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [`) syntax for tracking.

**Goal:** 把 cc-web-control 发布到 npm 公共仓库，用户通过 `npx cc-web-control` 一键启动，无需 clone 仓库；发布后现有运行行为不变。

**Architecture:** 新增 `bin/cc-web-control.cjs` 做 tmux/claude 依赖检测 + 透传 argv/env + `require('../server.cjs')`（server.cjs 顶层自执行，require 即启动）；package.json 加 `name`/`bin`/`files`/`engines`；README 与部署文档去除硬编码绝对路径并新增 npx 快速开始。server.cjs / claude-wrapper.sh / public/ / 其余 `*.cjs` **一律不改**。

**Tech Stack:** Node.js ≥ 18，npm，CommonJS（`.cjs`），原生测试 `node --test`。

**Spec:** `docs/superpowers/specs/2026-07-01-npm-publish-design.md`

---

## 执行前提（务必先做）

1. **从 main 拉新分支**：npm 发布是独立工作，不要在 `feat/bottom-tabbar` 上做。先切到 main 并开新分支：
   ```bash
   git checkout main
   git pull --ff-only
   git checkout -b feat/npm-publish
   ```
2. **带上 spec**：`docs/superpowers/specs/2026-07-01-npm-publish-design.md` 是 untracked 文件，切分支后随工作区保留；若已在分支上则无需移动。
3. **不实际 `npm publish`**：所有任务止于 `npm pack --dry-run` 验证。真实发布由用户手动执行（需 `npm adduser` 凭据）。
4. **先处置那 5 个 WIP，再切分支**：`claude-wrapper.sh`/`claude_launch.cjs`/`server.cjs`/`test/claude_launch.test.cjs`/`.gitignore` 的未提交改动属 `feat/bottom-tabbar` 另一条线。它们是 tracked 修改，直接 `git checkout main` 会跟随到新分支污染工作区。切分支前先在 `feat/bottom-tabbar` 上二选一：
   - `git stash -m "bottom-tabbar WIP"`（暂存，事后 `git stash pop` 回该分支）
   - 或 commit 到 `feat/bottom-tabbar`（若那部分工作已成型）
   本计划**不修改**这 5 个文件（package.json 不在其中，改动不冲突）。

---

## 文件结构

| 文件 | 责任 | 操作 |
|---|---|---|
| `bin/cc-web-control.cjs` | bin 入口：依赖检测 + 透传 + require server | 新建 |
| `test/bin_entry.test.cjs` | bin 入口逻辑测试 | 新建 |
| `package.json` | name/bin/files/engines | 改 |
| `test/package.test.cjs` | package.json 字段断言 | 新建 |
| `test/publish_files.test.cjs` | public/ HTML 引用资源自洽性回归 | 新建 |
| `README.md` | npx 快速开始 + 路径相对化 | 改 |
| `test/readme.test.cjs` | README 关键内容断言 | 新建 |
| `docs/部署使用文档.md` | 路径相对化 | 改 |
| `test/deploy_doc.test.cjs` | 部署文档无硬编码路径断言 | 新建 |

---

## Task 1: bin 入口（依赖检测 + 启动）

**Files:**
- Create: `bin/cc-web-control.cjs`
- Test: `test/bin_entry.test.cjs`

可测性设计要点：把"判定"与"副作用"分离——`findMissing(existsFn)` 接受注入的判定函数，测试用假函数覆盖三种情况；`main` 在缺失分支 `process.exit(1)` 后加 `return`，避免 mock 时误触 `startServer()`。

- [ ] **Step 1: 写失败测试**

`test/bin_entry.test.cjs`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commandExists, findMissing, formatMissing, main } = require('../bin/cc-web-control.cjs');

test('commandExists 对存在的命令返回 true', () => {
  assert.equal(commandExists('node'), true);
});

test('commandExists 对不存在的命令返回 false', () => {
  assert.equal(commandExists('no-such-cli-xyz-12345'), false);
});

test('findMissing 全部存在时返回空数组', () => {
  assert.deepEqual(findMissing(() => true), []);
});

test('findMissing 仅 tmux 缺失时返回 tmux', () => {
  const missing = findMissing(name => name !== 'tmux');
  assert.deepEqual(missing.map(m => m.name), ['tmux']);
});

test('findMissing 两者都缺失时返回 [tmux, claude]', () => {
  const missing = findMissing(() => false);
  assert.deepEqual(missing.map(m => m.name), ['tmux', 'claude']);
});

test('formatMissing 输出含依赖名与标题', () => {
  const out = formatMissing(findMissing(() => false));
  assert.ok(out.includes('缺少必需依赖'));
  assert.ok(out.includes('tmux'));
  assert.ok(out.includes('claude'));
});

test('main 缺失依赖时以 exit code 1 退出且不启动 server', () => {
  const origExit = process.exit;
  const origErr = console.error;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  console.error = () => {};
  try {
    main(() => false);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/bin_entry.test.cjs`
Expected: FAIL — `Cannot find module '../bin/cc-web-control.cjs'`

- [ ] **Step 3: 写最小实现**

`bin/cc-web-control.cjs`:
```javascript
#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const DEPS = [
  { name: 'tmux', hint: 'macOS: brew install tmux  |  Ubuntu/Debian: sudo apt install tmux' },
  { name: 'claude', hint: '安装 Claude Code CLI 并完成 Claude 登录认证（https://claude.com/claude-code）' },
];

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findMissing(existsFn) {
  return DEPS.filter(d => !existsFn(d.name));
}

function formatMissing(missing) {
  const lines = ['cc-web-control: 缺少必需依赖，请先安装：'];
  for (const m of missing) lines.push(`  ✗ ${m.name} — ${m.hint}`);
  lines.push('');
  return lines.join('\n');
}

function startServer() {
  require(path.join(__dirname, '..', 'server.cjs'));
}

function main(existsFn = commandExists) {
  const missing = findMissing(existsFn);
  if (missing.length) {
    console.error(formatMissing(missing));
    process.exit(1);
    return; // mock process.exit 时防止继续走到 startServer
  }
  startServer();
}

if (require.main === module) main();

module.exports = { commandExists, findMissing, formatMissing, main };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/bin_entry.test.cjs`
Expected: PASS（8/8）

- [ ] **Step 5: 提交**

```bash
git add bin/cc-web-control.cjs test/bin_entry.test.cjs
git commit -m "feat: 新增 bin 入口检测 tmux/claude 依赖并启动 server"
```

---

## Task 2: package.json 字段（name/bin/files/engines）

**Files:**
- Modify: `package.json`
- Test: `test/package.test.cjs`

当前 `package.json`：`name="tmux-web-control"`，无 `bin`/`files`/`engines`，`type=module`、`main=server.cjs`、`version=1.0.0`、`license=MIT`。`.cjs` 在 `type:module` 下仍是 CommonJS，bin 入口的 `require` 正常。

- [ ] **Step 1: 写失败测试**

`test/package.test.cjs`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('name 为 cc-web-control', () => {
  assert.equal(pkg.name, 'cc-web-control');
});

test('bin 映射 cc-web-control 到 bin/cc-web-control.cjs', () => {
  assert.equal(pkg.bin['cc-web-control'], 'bin/cc-web-control.cjs');
});

test('files 覆盖 public/、claude-wrapper.sh、bin/ 与根 *.cjs', () => {
  assert.ok(pkg.files.includes('public/'), '缺 public/');
  assert.ok(pkg.files.includes('claude-wrapper.sh'), '缺 claude-wrapper.sh');
  assert.ok(pkg.files.includes('bin/'), '缺 bin/');
  assert.ok(pkg.files.includes('*.cjs'), '缺 *.cjs');
});

test('engines.node 要求 >= 18', () => {
  assert.ok(pkg.engines && /1[8-9]|[2-9][0-9]/.test(pkg.engines.node), `engines.node=${pkg.engines && pkg.engines.node}`);
});

test('保留 main 指向 server.cjs', () => {
  assert.equal(pkg.main, 'server.cjs');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/package.test.cjs`
Expected: FAIL（name 仍为 tmux-web-control，无 bin/files/engines）

- [ ] **Step 3: 改 package.json**

把 `name` 改为 `"cc-web-control"`；在 `"main"` 下方新增 `bin`；新增 `files`；新增 `engines`。保留其余字段（version/type/scripts/dependencies/devDependencies/license）不变。结果片段：
```json
{
  "name": "cc-web-control",
  "version": "1.0.0",
  "type": "module",
  "main": "server.cjs",
  "bin": {
    "cc-web-control": "bin/cc-web-control.cjs"
  },
  "files": [
    "*.cjs",
    "public/",
    "claude-wrapper.sh",
    "bin/"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": { "...": "保持原样" }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/package.test.cjs`
Expected: PASS（5/5）

- [ ] **Step 5: 提交**

```bash
git add package.json test/package.test.cjs
git commit -m "feat: package.json 改名 cc-web-control 并加 bin/files/engines"
```

---

## Task 3: files 清单自洽性回归测试

**Files:**
- Create: `test/publish_files.test.cjs`

该测试不修改生产代码，只锁定不变量：`public/` 下每个 HTML 引用的本地资源都真实存在——保证 `files: ["public/"]` 覆盖全部前端依赖，将来新增引用遗漏文件时立刻失败。

- [ ] **Step 1: 写测试**

`test/publish_files.test.cjs`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');

test('public/ 下每个 HTML 引用的本地资源都存在', () => {
  const htmlFiles = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
  assert.ok(htmlFiles.length > 0, '应至少有一个 html');
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
      .map(m => m[1])
      .filter(r => !/^(https?:|data:|#|\/)/.test(r));
    for (const r of refs) {
      const resolved = path.normalize(path.join(PUB, r));
      assert.ok(
        fs.existsSync(resolved),
        `${f} 引用 "${r}"，但 ${resolved} 不存在`
      );
    }
  }
});

test('关键运行资源在 public/ 内', () => {
  for (const f of ['index.html', 'client.js', 'dashboard.html', 'login.html', 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(PUB, f)), `缺 ${f}`);
  }
});
```

- [ ] **Step 2: 跑测试确认通过（本任务无 RED 阶段——锁定现有不变量）**

Run: `node --test test/publish_files.test.cjs`
Expected: PASS。若 FAIL，说明 public/ 现有引用已损坏——那是既有 bug，记录并在 handoff 上报，不要在本任务修。

- [ ] **Step 3: 提交**

```bash
git add test/publish_files.test.cjs
git commit -m "test: 锁定 public/ HTML 引用资源自洽性(files 清单回归)"
```

---

## Task 4: README 更新（npx 快速开始 + 路径相对化）

**Files:**
- Modify: `README.md`
- Test: `test/readme.test.cjs`

- [ ] **Step 1: 写失败测试**

`test/readme.test.cjs`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('含 npx 快速开始', () => {
  assert.ok(/npx cc-web-control/.test(readme));
});

test('声明需 tmux 与 claude 前置依赖', () => {
  assert.ok(/tmux/.test(readme));
  assert.ok(/claude/i.test(readme));
});

test('声明需 Node.js >= 18', () => {
  assert.ok(/1[8-9]|[2-9][0-9]/.test(readme));
});

test('无硬编码 /Users/pan 绝对路径', () => {
  assert.ok(!/\/Users\/pan\//.test(readme), '仍含 /Users/pan/ 硬编码路径');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/readme.test.cjs`
Expected: FAIL（无 npx / 仍有 /Users/pan）

- [ ] **Step 3: 改 README.md**

1. **路径相对化**：把所有 `/Users/pan/cc-control/tmux-web-control` 替换为相对占位 `<项目目录>/cc-web-control`（或直接去掉绝对前缀，用项目名）。
2. **顶部加快速开始章节**（置于标题与现有内容之间）：

```markdown
## 快速开始

```bash
# 方式一：无需安装，直接运行
npx cc-web-control

# 方式二：全局安装后使用
npm install -g cc-web-control
cc-web-control
```

### 前置依赖

本工具在本机通过 tmux 操控 `claude` CLI，运行前请确保已安装：

- **Node.js** ≥ 18
- **tmux**（macOS: `brew install tmux`；Ubuntu: `sudo apt install tmux`）
- **Claude Code CLI**（已完成 Claude 登录认证）

首次启动若缺少依赖，程序会打印安装提示并退出（exit code 1）。
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/readme.test.cjs`
Expected: PASS（4/4）

- [ ] **Step 5: 提交**

```bash
git add README.md test/readme.test.cjs
git commit -m "docs: README 新增 npx 快速开始并相对化路径"
```

---

## Task 5: 部署文档路径相对化

**Files:**
- Modify: `docs/部署使用文档.md`
- Test: `test/deploy_doc.test.cjs`

- [ ] **Step 1: 写失败测试**

`test/deploy_doc.test.cjs`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', '部署使用文档.md'), 'utf8');

test('无硬编码 /Volumes/work 绝对路径', () => {
  assert.ok(!/\/Volumes\/work\//.test(doc), '仍含 /Volumes/work/ 硬编码路径');
});

test('部署文档非空', () => {
  assert.ok(doc.length > 100);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/deploy_doc.test.cjs`
Expected: FAIL（仍含 /Volumes/work/）

- [ ] **Step 3: 改 docs/部署使用文档.md**

把所有 `/Volumes/work/workspace/cc-control` 替换为通用占位 `<项目目录>` 或 `$(pwd)`（git clone 后的目录）。其余内容保持。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/deploy_doc.test.cjs`
Expected: PASS（2/2）

- [ ] **Step 5: 提交**

```bash
git add docs/部署使用文档.md test/deploy_doc.test.cjs
git commit -m "docs: 部署使用文档相对化路径"
```

---

## Task 6: 发布前最终验证（npm pack --dry-run，不实际 publish）

**Files:** 无新增（验证任务）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部 PASS（bin_entry + package + publish_files + readme + deploy_doc + 既有测试）

- [ ] **Step 2: 生成 pack 清单**

Run: `npm pack --dry-run 2>&1 | tee /tmp/cc-web-pack.txt`
Expected: 列出将被打包的文件，**结尾打印** `Tarball Contents` 与总大小。

- [ ] **Step 3: 断言关键文件在清单内**

Run:
```bash
for f in "server.cjs" "auth.cjs" "tmux.cjs" "claude-wrapper.sh" "bin/cc-web-control.cjs" "public/index.html" "public/client.js" "public/dashboard.html" "package.json"; do
  grep -q "$f" /tmp/cc-web-pack.txt || { echo "缺失: $f"; exit 1; }
done
echo "关键文件齐全"
```
Expected: `关键文件齐全`

- [ ] **Step 4: 断言排除项不在清单内**

Run:
```bash
for f in "docs/superpowers" "test/bin_entry" "scripts/restart_tunnel" "pretext/"; do
  grep -q "$f" /tmp/cc-web-pack.txt && { echo "不该打包却出现: $f"; exit 1; }
done
echo "排除项干净"
```
Expected: `排除项干净`

- [ ] **Step 5: 集成冒烟（本地实际安装并启动，验证 bin 真的能跑）**

Run:
```bash
# 1) 本地 link 成全局命令
npm link
# 2) 调用全局命令（依赖齐全时应正常进入 server 启动；用超时防止它真常驻）
( cc-web-control --web-only 2>&1 & SRV=$!; sleep 3; \
  curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:${CC_WEB_PORT:-3000}/ || true; \
  kill $SRV 2>/dev/null )
# 3) 解除 link
npm unlink -g cc-web-control
```
Expected: server 输出启动日志，curl 返回 2xx/3xx（登录重定向也算正常）。若机器没装 tmux/claude，此步可跳过并在 handoff 注明，改由 `node bin/cc-web-control.cjs` 验证依赖检测分支输出。

- [ ] **Step 6: 提交计划与 spec（若尚未提交）并收尾**

```bash
git add docs/superpowers/specs/2026-07-01-npm-publish-design.md docs/superpowers/plans/2026-07-01-npm-publish.md
git commit -m "docs: npm 发布设计 spec 与实施计划"
```
随后按 `superpowers:finishing-a-development-branch` 收尾分支。

---

## 发布操作（计划之外，由用户手动执行）

验证全绿后，用户执行：
```bash
npm view cc-web-control          # 复查名字未被抢注
npm adduser                      # 一次性登录（首次）
npm publish                      # 实际发布 1.0.0
```
