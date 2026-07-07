# 配置文件启动(7684 单机 + 7685 hub)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 7684(`server.cjs`)与 7685(`hub/server_entry.cjs`)启动时读取本地 JSON 配置文件,环境变量保留作覆盖逃生口(`env > 文件 > 默认`),完全向后兼容(无文件 = 现状)。

**Architecture:** 新建共享模块 `config_loader.cjs`(根),内含 `loadConfig({ schema, defaultFilePath, argv, env, fsImpl })` + `SINGLE_SCHEMA`(7684,15 字段)+ `HUB_SCHEMA`(7685,11 字段)。loader 照搬 `hub/config.cjs` 的 `loadMachines`(JSON.parse 容错 + 校验)范式,但**由 schema 驱动逐字段解析**为最终生效值(env>file>default,含类型强转 + 校验 + 未知字段 warning + token 权限告警),返回 `{ config, warnings, filePath }`。两入口顶部各调一次 `loadConfig`,把 `config.*` 接入现有常量/`startHub` 入参。`mainAgent` 子段走「env 桥接」:`config.mainAgent.*` → 虚拟 env → 与真实 env 合并(env 优先)→ `resolveMainAgentConfig(mergedEnv)`,`resolveMainAgentConfig` 零改动。

**Tech Stack:** Node.js CommonJS(`.cjs`)、`node:test` + `node:assert/strict`、零新依赖(JSON 原生)。

**关联 spec:** `docs/superpowers/specs/2026-07-06-config-file-startup-design.md`(已审 + amend)。

**实现说明(对齐 spec §3.2 的优先级语义):** spec §3.2 文面写「各字段读取处 `process.env.X !== undefined ? ... : (cfg.field ?? DEFAULT)`」。本计划把该逐字段合并**集中到 loader**(schema 驱动),`config.*` 即为**已解析的生效值**。这是 §3.2 优先级(env>file>default)的 DRY 实现,可观测行为与 spec 完全一致,且让 `server.cjs` 接入点极简(直接读 `config.port`)。`mainAgent` 是唯一例外:其 env/default 解析仍由 `resolveMainAgentConfig` 经「env 桥接」完成,loader 只做**子字段类型校验**(passthrough),避免双重解析。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `config_loader.cjs`(根) | `loadConfig` + `parseConfigFlag` + `SINGLE_SCHEMA`/`HUB_SCHEMA` + 路径常量 | **Create** |
| `test/config_loader.test.cjs` | loader 单元测试(核心/校验/告警/两 schema/集成场景) | **Create** |
| `server.cjs` | 7684 接入:顶部 `loadConfig(SINGLE_SCHEMA)`,15 个常量改读 `CFG.*`(flag-OR 与 `parseCaptureHistory` 保留) | **Modify** |
| `test/server_config_wiring.test.cjs` | server.cjs 接入的源码契约测试 | **Create** |
| `hub/server.cjs` | `startHub` 增加 `loginMax`/`loginWindowMs`/`mainAgentMax`/`mainAgentWindowMs` opts(env 默认,向后兼容),限流器改读 local | **Modify** |
| `hub/server_entry.cjs` | 7685 接入:`loadConfig(HUB_SCHEMA)` + mainAgent env 桥接,字段传入 `startHub` | **Modify** |
| `test/hub_config_wiring.test.cjs` | hub 接入的源码契约测试 | **Create** |
| `config.example.json` / `hub-config.example.json`(根) | 带例值的模板(JSON 无注释,说明走 README) | **Create** |
| `README.md` | 追加「配置文件」段:两文件路径 + 字段表 + `chmod 600` | **Modify** |

**测试策略说明:** `server.cjs` / `hub/server_entry.cjs` 是 `require()` 即起服务的脚本,无法纯单测其运行时合并(会 attach tmux / 起 socket)。故采用本仓库既有范式:**loader 单测覆盖合并逻辑**(真实断言),**入口用源码契约测试锁定接线**(断言源码含 `loadConfig(...)` + 读 `CFG.*` + 保留 flag-OR),**全量回归测试覆盖向后兼容**(无 config 文件时现有 `test/*.test.cjs` 全绿)。三者合力 = 逻辑有证、接线有锁、回归有网。

---

## Task 1: loadConfig 核心(路径解析 / 文件缺失兜底 / JSON 容错 / number·string·bool 解析)

**Files:**
- Create: `config_loader.cjs`
- Create: `test/config_loader.test.cjs`

- [ ] **Step 1: Write the failing test**

`test/config_loader.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig, parseConfigFlag } = require('../config_loader.cjs');

// 仅 number/string/bool 的小 schema,用于 Task 1 核心行为(全 schema 见 Task 4/5)
const MINI = {
  port:   { type: 'number', env: 'CC_WEB_PORT', default: 7684, min: 1, max: 65535 },
  host:   { type: 'string', env: 'CC_WEB_HOST', default: '127.0.0.1', nonEmpty: true },
  debug:  { type: 'bool',   env: 'CC_WEB_DEBUG', default: false },
};

function writeTmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-load-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

test('parseConfigFlag: --config <path> 与 --config=<path>', () => {
  assert.equal(parseConfigFlag(['node', 'x', '--config', '/a/b.json']), '/a/b.json');
  assert.equal(parseConfigFlag(['node', 'x', '--config=/a/b.json']), '/a/b.json');
  assert.equal(parseConfigFlag(['node', 'x']), undefined);
});

test('文件不存在 → 全默认,无 throw,无 warnings', () => {
  const { config, warnings, filePath } = loadConfig({
    schema: MINI, defaultFilePath: '/no/such/config.json',
    argv: [], env: {},
  });
  assert.deepEqual(config, { port: 7684, host: '127.0.0.1', debug: false });
  assert.deepEqual(warnings, []);
  assert.equal(filePath, '/no/such/config.json');
});

test('文件存在 → 各字段正确读取(file)', () => {
  const f = writeTmp(JSON.stringify({ port: 9000, host: '0.0.0.0', debug: true }));
  try {
    const { config } = loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} });
    assert.equal(config.port, 9000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.debug, true);
  } finally { rm(path.dirname(f)); }
});

test('env 显式设置 → 覆盖文件值(env > file > default)', () => {
  const f = writeTmp(JSON.stringify({ port: 9000, host: 'from-file', debug: false }));
  try {
    const { config } = loadConfig({
      schema: MINI, defaultFilePath: f, argv: [],
      env: { CC_WEB_PORT: '8000', CC_WEB_HOST: 'from-env', CC_WEB_DEBUG: '1' },
    });
    assert.equal(config.port, 8000);     // env 覆盖 file
    assert.equal(config.host, 'from-env');
    assert.equal(config.debug, true);    // env '1' → true
  } finally { rm(path.dirname(f)); }
});

test('env 显式空串仍算"已设置"(不回退 file)—— 对齐 process.env.X || "" 口径', () => {
  const f = writeTmp(JSON.stringify({ host: 'from-file' }));
  try {
    // host 有 nonEmpty;env '' 已设置 → 用 env('')→ 空串 → nonEmpty 抛错(证明未回退 file)
    assert.throws(() => loadConfig({
      schema: MINI, defaultFilePath: f, argv: [], env: { CC_WEB_HOST: '' },
    }), /host.*不可为空/);
  } finally { rm(path.dirname(f)); }
});

test('--config flag 覆盖 defaultFilePath', () => {
  const f = writeTmp(JSON.stringify({ port: 7000 }));
  try {
    const { config, filePath } = loadConfig({
      schema: MINI, defaultFilePath: '/default/path.json',
      argv: ['node', 'x', '--config', f], env: {},
    });
    assert.equal(filePath, f);
    assert.equal(config.port, 7000);
  } finally { rm(path.dirname(f)); }
});

test('坏 JSON → throw 含文件路径', () => {
  const f = writeTmp('{ not json');
  try {
    assert.throws(
      () => loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }),
      new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  } finally { rm(path.dirname(f)); }
});

test('JSON 非对象(数组)→ throw', () => {
  const f = writeTmp('[1,2,3]');
  try {
    assert.throws(
      () => loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }),
      /须为 JSON 对象/
    );
  } finally { rm(path.dirname(f)); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config_loader.test.cjs`
Expected: FAIL —— `Cannot find module '../config_loader.cjs'`(模块不存在)。

- [ ] **Step 3: Write minimal implementation**

`config_loader.cjs`(本任务只实现 number/string/bool + 核心流程;校验告警/全 schema 见后续任务,但一次性写全 `resolveField` 的 number/string/bool 三分支):
```js
// config_loader.cjs — 7684/7685 共享:JSON 配置文件加载 + env 覆盖 + 校验 + 权限告警
// 范式照搬 hub/config.cjs 的 loadMachines(JSON.parse 容错 + 校验),由 schema 驱动逐字段解析为生效值。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_DIR = path.join(os.homedir(), '.cc-web-control');
const SINGLE_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const HUB_CONFIG_PATH = path.join(CONFIG_DIR, 'hub-config.json');

// --config <path> 或 --config=<path>;返回路径或 undefined
function parseConfigFlag(argv) {
  const i = argv.indexOf('--config');
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  for (const a of argv) {
    if (a.startsWith('--config=')) return a.slice('--config='.length);
  }
  return undefined;
}

function throwBad(field, msg) {
  throw new Error(`config 字段 "${field}" ${msg}`);
}

// bool:env '1'→true(对齐现有 === '1' 口径);file true→true
function toBool(raw, source) {
  if (source === 'env') return raw === '1';
  return raw === true;
}

// 单字段解析:按 spec.type 强转 + 校验,返回最终值。source='env'|'file'|'default'
function resolveField(field, spec, raw, source) {
  switch (spec.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throwBad(field, `须为数字,实际 ${JSON.stringify(raw)}`);
      if (spec.min != null && n < spec.min) throwBad(field, `须 >= ${spec.min},实际 ${n}`);
      if (spec.max != null && n > spec.max) throwBad(field, `须 <= ${spec.max},实际 ${n}`);
      return n;
    }
    case 'string': {
      const s = raw == null ? '' : String(raw);
      if (spec.nonEmpty && !s) throwBad(field, '不可为空');
      return s;
    }
    case 'bool':
      return toBool(raw, source);
    default:
      throwBad(field, `未知 schema type "${spec.type}"(Task 2-5 补齐 port/session/array/object)`);
  }
}

function loadConfig({ schema, defaultFilePath, argv = process.argv, env = process.env, fsImpl = fs }) {
  const filePath = parseConfigFlag(argv) || defaultFilePath;
  const warnings = [];
  let fileValues = {};

  if (fsImpl.existsSync(filePath)) {
    let text;
    try {
      text = fsImpl.readFileSync(filePath, 'utf8');
    } catch (e) {
      throw new Error(`config 文件读取失败 ${filePath}: ${e.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`config JSON 解析失败 ${filePath}: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`config 须为 JSON 对象: ${filePath}`);
    }
    fileValues = parsed;
  }

  // 逐字段:env ?? file ?? default
  const config = {};
  for (const [field, spec] of Object.entries(schema)) {
    let raw, source;
    if (spec.env && env[spec.env] !== undefined) { raw = env[spec.env]; source = 'env'; }
    else if (Object.prototype.hasOwnProperty.call(fileValues, field)) { raw = fileValues[field]; source = 'file'; }
    else { raw = spec.default; source = 'default'; }
    config[field] = resolveField(field, spec, raw, source);
  }

  return { config, warnings, filePath };
}

module.exports = { loadConfig, parseConfigFlag, SINGLE_CONFIG_PATH, HUB_CONFIG_PATH, CONFIG_DIR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config_loader.test.cjs`
Expected: PASS(8 tests)。

- [ ] **Step 5: Commit**

```bash
git add config_loader.cjs test/config_loader.test.cjs
git commit -m "feat(config-loader): loadConfig 核心(路径/JSON 容错/number-string-bool 解析)"
```

---

## Task 2: 字段校验(port 范围 / session 正则 / array of strings / number min)→ throw

**Files:**
- Modify: `config_loader.cjs`(`resolveField` 补 port/session/array 三分支)
- Modify: `test/config_loader.test.cjs`(追加校验用例)

- [ ] **Step 1: Write the failing test**

追加到 `test/config_loader.test.cjs`(沿用 Task 1 的 `writeTmp`/`rm` 与文件顶部 require):
```js
const V = {
  port:        { type: 'port',    env: 'P', default: 7684 },
  sess:        { type: 'session', env: 'S', default: 'claude-web-session' },
  roots:       { type: 'array',   env: 'R', default: [] },
  intervalMs:  { type: 'number',  env: 'I', default: 100, min: 1 },
};

test('port 非整数 → throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '7684.5' } }), /port.*整数/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: 'abc' } }), /port.*整数/);
});
test('port 越界(0 / 70000)→ throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '0' } }), /port.*1-65535/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '70000' } }), /port.*1-65535/);
});
test('port 合法边界(1 / 65535)→ 通过', () => {
  assert.equal(loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '1' } }).config.port, 1);
  assert.equal(loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '65535' } }).config.port, 65535);
});
test('session 不合正则(含空格/斜杠/超 64)→ throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { S: 'a b' } }), /sess/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { S: 'a/b' } }), /sess/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { S: 'x'.repeat(65) } }), /sess/);
});
test('projectRoots:env 逗号分隔 → string[];file 数组每元素 string', () => {
  assert.deepEqual(
    loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { R: '/a, /b ,/c' } }).config.roots,
    ['/a', '/b', '/c']
  );
  const f = writeTmp(JSON.stringify({ roots: ['/x', '/y'] }));
  try {
    assert.deepEqual(loadConfig({ schema: V, defaultFilePath: f, argv: [], env: {} }).config.roots, ['/x', '/y']);
  } finally { rm(path.dirname(f)); }
});
test('projectRoots:file 非数组 → throw;元素非 string → throw', () => {
  const f1 = writeTmp(JSON.stringify({ roots: '/not-array' }));
  try { assert.throws(() => loadConfig({ schema: V, defaultFilePath: f1, argv: [], env: {} }), /roots.*数组/); }
  finally { rm(path.dirname(f1)); }
  const f2 = writeTmp(JSON.stringify({ roots: [123] }));
  try { assert.throws(() => loadConfig({ schema: V, defaultFilePath: f2, argv: [], env: {} }), /roots.*string/); }
  finally { rm(path.dirname(f2)); }
});
test('number 低于 min → throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { I: '0' } }), /intervalMs.*>= 1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config_loader.test.cjs`
Expected: FAIL —— `resolveField` 遇 `port`/`session`/`array` 走 default 分支抛「未知 schema type」。

- [ ] **Step 3: Write minimal implementation**

在 `config_loader.cjs` 的 `resolveField` switch 里,在 `case 'string'` 之后、`case 'bool'` 之前插入三分支:
```js
    case 'port': {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throwBad(field, `须为整数 1-65535,实际 ${JSON.stringify(raw)}`);
      }
      return n;
    }
    case 'session': {
      const s = raw == null ? '' : String(raw);
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) {
        throwBad(field, `须匹配 /^[A-Za-z0-9._-]{1,64}$/`);
      }
      return s;
    }
    case 'array': {
      let arr;
      if (source === 'env') {
        arr = String(raw).split(',').map(x => x.trim()).filter(Boolean);
      } else if (Array.isArray(raw)) {
        arr = raw;
      } else {
        throwBad(field, `须为数组,实际 ${JSON.stringify(raw)}`);
      }
      for (const el of arr) {
        if (typeof el !== 'string') throwBad(field, '元素须为 string');
      }
      return arr;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config_loader.test.cjs`
Expected: PASS(Task 1 的 8 + Task 2 的 7 = 15 tests)。

- [ ] **Step 5: Commit**

```bash
git add config_loader.cjs test/config_loader.test.cjs
git commit -m "feat(config-loader): 字段校验(port 范围/session 正则/array of strings)"
```

---

## Task 3: 未知字段 warning + token 权限告警(fsImpl 可注入)

**Files:**
- Modify: `config_loader.cjs`(fileValues 收集后:未知字段 warning + 含 token 时权限 stat 告警)
- Modify: `test/config_loader.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/config_loader.test.cjs`:
```js
const T = {
  port:      { type: 'port',   env: 'P', default: 7684 },
  authToken: { type: 'string', env: 'CC_WEB_AUTH_TOKEN', default: '' },
  hubToken:  { type: 'string', env: 'CC_WEB_HUB_TOKEN', default: '' },
};

test('未知字段 → warning 提示字段名(帮发现拼写错误,如 authoken)', () => {
  const f = writeTmp(JSON.stringify({ port: 8000, authoken: 'typo' }));
  try {
    const { warnings } = loadConfig({ schema: T, defaultFilePath: f, argv: [], env: {} });
    assert.ok(warnings.some(w => /未知字段 "authoken"/.test(w)), `应 warn authoken,实际 ${JSON.stringify(warnings)}`);
  } finally { rm(path.dirname(f)); }
});
test('已知字段全部命中 → 无未知字段 warning', () => {
  const f = writeTmp(JSON.stringify({ port: 8000, authToken: 't' }));
  try {
    const { warnings } = loadConfig({ schema: T, defaultFilePath: f, argv: [], env: {} });
    assert.ok(!warnings.some(w => /未知字段/.test(w)), `不应有未知字段 warning,实际 ${JSON.stringify(warnings)}`);
  } finally { rm(path.dirname(f)); }
});

// 权限告警用 fsImpl 注入,确定性控制 mode(免 chmod/umask 干扰)
function fakeFs(fileContent, mode) {
  return {
    existsSync: () => true,
    readFileSync: () => fileContent,
    statSync: () => ({ mode }),
  };
}
test('含 token 且 group/other 可读(mode 0o644)→ 权限 warning 含 chmod 600,不阻断', () => {
  const { config, warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ authToken: 'secret' }), 0o644),
  });
  assert.equal(config.authToken, 'secret');  // 不阻断
  assert.ok(warnings.some(w => /权限过松.*chmod 600/.test(w)), `应 warn 权限,实际 ${JSON.stringify(warnings)}`);
});
test('含 token 且仅 owner 可读(mode 0o600)→ 无权限 warning', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ hubToken: 'secret' }), 0o600),
  });
  assert.ok(!warnings.some(w => /权限过松/.test(w)), `0o600 不应 warn,实际 ${JSON.stringify(warnings)}`);
});
test('warnings 不含 token 值(安全:不回显 secret)', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ authToken: 'super-secret-value' }), 0o644),
  });
  const all = JSON.stringify(warnings);
  assert.ok(!all.includes('super-secret-value'), `warnings 不应含 token 值,实际 ${all}`);
});
test('不含 token 字段值 → 即使权限松也不 warn(无敏感数据)', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ port: 8000 }), 0o644),
  });
  assert.ok(!warnings.some(w => /权限过松/.test(w)), `无 token 不应 warn,实际 ${JSON.stringify(warnings)}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config_loader.test.cjs`
Expected: FAIL —— 未知字段 warning 与权限告警均不存在(`warnings` 恒为 `[]`)。

- [ ] **Step 3: Write minimal implementation**

在 `config_loader.cjs` 的 `loadConfig` 里,`fileValues = parsed;` 之后插入未知字段检测 + 权限告警:
```js
    // 未知字段 → warning(帮发现拼写错误,如 authoken)
    for (const k of Object.keys(fileValues)) {
      if (!Object.prototype.hasOwnProperty.call(schema, k)) {
        warnings.push(`未知字段 "${k}"(已忽略,请检查拼写)`);
      }
    }

    // 权限告警:含 token 类字段值且 group/other 可读 → warning(不阻断,不回显 token)
    const hasToken = Object.keys(schema).some(
      (f) => /token/i.test(f) && fileValues[f]
    );
    if (hasToken) {
      try {
        const mode = fsImpl.statSync(filePath).mode;
        if (mode & 0o077) {
          warnings.push(`config 文件权限过松(mode ${mode & 0o777} 含 group/other 读)且含 token,建议 chmod 600 ${filePath}`);
        }
      } catch { /* stat 失败不阻断启动 */ }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config_loader.test.cjs`
Expected: PASS(15 + 6 = 21 tests)。

- [ ] **Step 5: Commit**

```bash
git add config_loader.cjs test/config_loader.test.cjs
git commit -m "feat(config-loader): 未知字段 warning + token 权限告警(fsImpl 可注入)"
```

---

## Task 4: SINGLE_SCHEMA(7684 全 15 字段)+ object passthrough 分支

**Files:**
- Modify: `config_loader.cjs`(补 `object` 分支 + 定义 `SINGLE_SCHEMA`)
- Modify: `test/config_loader.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/config_loader.test.cjs`:
```js
const { SINGLE_SCHEMA } = require('../config_loader.cjs');

test('SINGLE_SCHEMA:15 字段全齐,env/default/type 对齐 spec §5.1', () => {
  const fields = Object.keys(SINGLE_SCHEMA);
  assert.equal(fields.length, 15, `应有 15 字段,实际 ${fields.length}: ${fields.join(',')}`);
  assert.equal(SINGLE_SCHEMA.port.env, 'CC_WEB_PORT');
  assert.equal(SINGLE_SCHEMA.port.default, 7684);
  assert.equal(SINGLE_SCHEMA.port.type, 'port');
  assert.equal(SINGLE_SCHEMA.authToken.env, 'CC_WEB_AUTH_TOKEN');
  assert.equal(SINGLE_SCHEMA.authToken.default, '');
  assert.equal(SINGLE_SCHEMA.projectRoots.type, 'array');
  assert.deepEqual(SINGLE_SCHEMA.projectRoots.default, []);
  assert.equal(SINGLE_SCHEMA.dashboardIntervalMs.env, 'CC_WEB_DASHBOARD_INTERVAL_MS');
  assert.equal(SINGLE_SCHEMA.dashboardIntervalMs.default, 2000);
  assert.equal(SINGLE_SCHEMA.wsPingInterval.env, 'CC_WEB_WS_PING_INTERVAL');
  assert.equal(SINGLE_SCHEMA.wsPingInterval.default, 30000);
  assert.equal(SINGLE_SCHEMA.captureHistory.type, 'string');
});

test('SINGLE_SCHEMA 全字段从文件加载(端到端)', () => {
  const f = writeTmp(JSON.stringify({
    port: 8000, host: '0.0.0.0', session: 'sess-1', authToken: 'tok',
    projectRoots: ['/p1', '/p2'], captureHistory: '100', pollInterval: 200,
    claudeContinue: true, noOpen: true, noAttach: true, webOnly: true,
    loginMax: 10, loginWindowMs: 60000, dashboardIntervalMs: 5000, wsPingInterval: 40000,
  }));
  try {
    const { config } = loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: f, argv: [], env: {} });
    assert.equal(config.port, 8000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.session, 'sess-1');
    assert.equal(config.authToken, 'tok');
    assert.deepEqual(config.projectRoots, ['/p1', '/p2']);
    assert.equal(config.captureHistory, '100');
    assert.equal(config.pollInterval, 200);
    assert.equal(config.claudeContinue, true);
    assert.equal(config.noOpen, true);
    assert.equal(config.noAttach, true);
    assert.equal(config.webOnly, true);
    assert.equal(config.loginMax, 10);
    assert.equal(config.loginWindowMs, 60000);
    assert.equal(config.dashboardIntervalMs, 5000);
    assert.equal(config.wsPingInterval, 40000);
  } finally { rm(path.dirname(f)); }
});

test('bool:env "0"/"2" → false(仅 "1" 为 true);file false → false', () => {
  assert.equal(loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: '/x', argv: [], env: { CC_WEB_CLAUDE_CONTINUE: '0' } }).config.claudeContinue, false);
  assert.equal(loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: '/x', argv: [], env: { CC_WEB_CLAUDE_CONTINUE: '2' } }).config.claudeContinue, false);
  const f = writeTmp(JSON.stringify({ claudeContinue: false }));
  try {
    assert.equal(loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: f, argv: [], env: {} }).config.claudeContinue, false);
  } finally { rm(path.dirname(f)); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config_loader.test.cjs`
Expected: FAIL —— `SINGLE_SCHEMA` 未导出。

- [ ] **Step 3: Write minimal implementation**

在 `config_loader.cjs` 的 `resolveField` switch 里补 `object` 分支(在 `case 'array'` 之后):
```js
    case 'object': {
      // passthrough:仅校验子字段类型(如 mainAgent);env/default 解析交给调用方桥接
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        throwBad(field, `须为对象,实际 ${JSON.stringify(raw)}`);
      }
      if (spec.fields) {
        for (const [k, subType] of Object.entries(spec.fields)) {
          if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
          resolveField(`${field}.${k}`, { type: subType }, raw[k], 'file');
        }
      }
      return raw;
    }
```

在 `config_loader.cjs` 的 `module.exports` 之前定义 `SINGLE_SCHEMA`:
```js
const SINGLE_SCHEMA = {
  port:                { type: 'port',    env: 'CC_WEB_PORT',                  default: 7684 },
  host:                { type: 'string',  env: 'CC_WEB_HOST',                  default: '127.0.0.1', nonEmpty: true },
  session:             { type: 'session', env: 'CC_WEB_SESSION',               default: 'claude-web-session' },
  authToken:           { type: 'string',  env: 'CC_WEB_AUTH_TOKEN',            default: '' },
  projectRoots:        { type: 'array',   env: 'CC_WEB_PROJECT_ROOTS',         default: [] },
  captureHistory:      { type: 'string',  env: 'CC_WEB_CAPTURE_HISTORY',       default: '' },
  pollInterval:        { type: 'number',  env: 'CC_WEB_POLL_INTERVAL',         default: 100, min: 1 },
  claudeContinue:      { type: 'bool',    env: 'CC_WEB_CLAUDE_CONTINUE',       default: false },
  noOpen:              { type: 'bool',    env: 'CC_WEB_NO_OPEN',               default: false },
  noAttach:            { type: 'bool',    env: 'CC_WEB_NO_ATTACH',             default: false },
  webOnly:             { type: 'bool',    env: 'CC_WEB_WEB_ONLY',              default: false },
  loginMax:            { type: 'number',  env: 'CC_WEB_LOGIN_MAX',             default: 5, min: 1 },
  loginWindowMs:       { type: 'number',  env: 'CC_WEB_LOGIN_WINDOW_MS',       default: 900000, min: 1 },
  dashboardIntervalMs: { type: 'number',  env: 'CC_WEB_DASHBOARD_INTERVAL_MS', default: 2000, min: 1 },
  wsPingInterval:      { type: 'number',  env: 'CC_WEB_WS_PING_INTERVAL',      default: 30000, min: 1 },
};
```

并把 `module.exports` 改为:
```js
module.exports = { loadConfig, parseConfigFlag, SINGLE_SCHEMA, SINGLE_CONFIG_PATH, HUB_CONFIG_PATH, CONFIG_DIR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config_loader.test.cjs`
Expected: PASS(21 + 3 = 24 tests)。

- [ ] **Step 5: Commit**

```bash
git add config_loader.cjs test/config_loader.test.cjs
git commit -m "feat(config-loader): SINGLE_SCHEMA(7684 全 15 字段)+ object passthrough"
```

---

## Task 5: HUB_SCHEMA(7685 全字段 + mainAgent passthrough)+ machinesFile 默认路径

**Files:**
- Modify: `config_loader.cjs`(定义 `HUB_SCHEMA` + `DEFAULT_HUB_MACHINES_FILE`)
- Modify: `test/config_loader.test.cjs`

- [ ] **Step 1: Write the failing test**

追加到 `test/config_loader.test.cjs`:
```js
const { HUB_SCHEMA, HUB_CONFIG_PATH } = require('../config_loader.cjs');

test('HUB_CONFIG_PATH 默认指向 ~/.cc-web-control/hub-config.json', () => {
  assert.equal(HUB_CONFIG_PATH, path.join(os.homedir(), '.cc-web-control', 'hub-config.json'));
});

test('HUB_SCHEMA:11 字段全齐', () => {
  const fields = Object.keys(HUB_SCHEMA);
  assert.equal(fields.length, 11, `应有 11 字段,实际 ${fields.length}: ${fields.join(',')}`);
  assert.equal(HUB_SCHEMA.port.env, 'CC_WEB_HUB_PORT');
  assert.equal(HUB_SCHEMA.port.default, 7685);
  assert.equal(HUB_SCHEMA.hubToken.env, 'CC_WEB_HUB_TOKEN');
  assert.equal(HUB_SCHEMA.mainAgentMax.env, 'CC_WEB_MAIN_AGENT_MAX');
  assert.equal(HUB_SCHEMA.mainAgentMax.default, 6);
  assert.equal(HUB_SCHEMA.mainAgentWindowMs.default, 60000);
});

test('HUB_SCHEMA.machinesFile 默认 = ~/.cc-web-control/hub-machines.json', () => {
  assert.equal(
    HUB_SCHEMA.machinesFile.default,
    path.join(os.homedir(), '.cc-web-control', 'hub-machines.json')
  );
});

test('mainAgent:file 合法对象 → passthrough(子字段类型校验通过,env/default 留给桥接)', () => {
  const f = writeTmp(JSON.stringify({
    hubToken: 't', mainAgent: { enabled: true, settleMs: 30000, claudePath: '/x/claude' },
  }));
  try {
    const { config } = loadConfig({ schema: HUB_SCHEMA, defaultFilePath: f, argv: [], env: {} });
    assert.deepEqual(config.mainAgent, { enabled: true, settleMs: 30000, claudePath: '/x/claude' });
  } finally { rm(path.dirname(f)); }
});

test('mainAgent:子字段类型错(settleMs 非数字)→ throw', () => {
  const f = writeTmp(JSON.stringify({ mainAgent: { settleMs: 'fast' } }));
  try {
    assert.throws(
      () => loadConfig({ schema: HUB_SCHEMA, defaultFilePath: f, argv: [], env: {} }),
      /mainAgent\.settleMs.*数字/
    );
  } finally { rm(path.dirname(f)); }
});

test('mainAgent:mainAgent 非对象 → throw', () => {
  const f = writeTmp(JSON.stringify({ mainAgent: 'oops' }));
  try {
    assert.throws(
      () => loadConfig({ schema: HUB_SCHEMA, defaultFilePath: f, argv: [], env: {} }),
      /mainAgent.*对象/
    );
  } finally { rm(path.dirname(f)); }
});

test('HUB_SCHEMA:env 不读 CC_WEB_HUB_MAIN_AGENT_*(mainAgent 不经 loader 合并 env)', () => {
  assert.equal(HUB_SCHEMA.mainAgent.env, null);
  const { config } = loadConfig({
    schema: HUB_SCHEMA, defaultFilePath: '/x', argv: [],
    env: { CC_WEB_HUB_MAIN_AGENT_ENABLED: '1' },
  });
  assert.deepEqual(config.mainAgent, {});  // env 不进 mainAgent
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config_loader.test.cjs`
Expected: FAIL —— `HUB_SCHEMA` 未导出。

- [ ] **Step 3: Write minimal implementation**

在 `config_loader.cjs` 的 `SINGLE_SCHEMA` 之后定义:
```js
const DEFAULT_HUB_MACHINES_FILE = path.join(CONFIG_DIR, 'hub-machines.json');

const HUB_SCHEMA = {
  host:              { type: 'string', env: 'CC_WEB_HUB_HOST',                  default: '127.0.0.1', nonEmpty: true },
  port:              { type: 'port',   env: 'CC_WEB_HUB_PORT',                  default: 7685 },
  intervalMs:        { type: 'number', env: 'CC_WEB_HUB_DASHBOARD_INTERVAL_MS', default: 2000, min: 1 },
  machinesFile:      { type: 'string', env: 'CC_WEB_HUB_MACHINES_FILE',         default: DEFAULT_HUB_MACHINES_FILE, nonEmpty: true },
  hubToken:          { type: 'string', env: 'CC_WEB_HUB_TOKEN',                 default: '' },
  noOpen:            { type: 'bool',   env: 'CC_WEB_HUB_NO_OPEN',               default: false },
  loginMax:          { type: 'number', env: 'CC_WEB_LOGIN_MAX',                 default: 5, min: 1 },
  loginWindowMs:     { type: 'number', env: 'CC_WEB_LOGIN_WINDOW_MS',           default: 900000, min: 1 },
  mainAgentMax:      { type: 'number', env: 'CC_WEB_MAIN_AGENT_MAX',            default: 6, min: 1 },
  mainAgentWindowMs: { type: 'number', env: 'CC_WEB_MAIN_AGENT_WINDOW_MS',      default: 60000, min: 1 },
  mainAgent:         { type: 'object', env: null, default: {}, fields: {
                       enabled: 'bool', session: 'string', claudePath: 'string', dataDir: 'string',
                       auditFile: 'string', settleMs: 'number', maxSettleMs: 'number',
                       backoffBase: 'number', staleBump: 'number' } },
};
```

把 `module.exports` 改为:
```js
module.exports = {
  loadConfig, parseConfigFlag,
  SINGLE_SCHEMA, HUB_SCHEMA,
  SINGLE_CONFIG_PATH, HUB_CONFIG_PATH, CONFIG_DIR, DEFAULT_HUB_MACHINES_FILE,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config_loader.test.cjs`
Expected: PASS(24 + 6 = 30 tests)。

- [ ] **Step 5: Commit**

```bash
git add config_loader.cjs test/config_loader.test.cjs
git commit -m "feat(config-loader): HUB_SCHEMA(7685 全字段 + mainAgent passthrough)"
```

---

## Task 6: server.cjs(7684)接入 loadConfig

**Files:**
- Modify: `server.cjs`(顶部 require + loadConfig + warnings 打印;`:27-30` `:36-52` `:383` `:503` 改读 `CFG.*`)
- Create: `test/server_config_wiring.test.cjs`

- [ ] **Step 1: Write the failing test**

`test/server_config_wiring.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs 顶部 require config_loader + loadConfig(SINGLE_SCHEMA)', () => {
  assert.match(src, /require\(['"]\.\/config_loader\.cjs['"]\)/);
  assert.match(src, /loadConfig\(\s*\{\s*schema:\s*SINGLE_SCHEMA/);
});

test('server.cjs 读 CFG.port / CFG.host / CFG.session(取代裸 env 默认)', () => {
  assert.match(src, /\bCFG\.port\b/);
  assert.match(src, /\bCFG\.host\b/);
  assert.match(src, /\bCFG\.session\b/);
  assert.doesNotMatch(src, /CC_WEB_PORT\s*\|\|\s*['"]?7684/);
});

test('server.cjs:AUTH_TOKEN / PROJECT_ROOTS / CLAUDE_CONTINUE 读 CFG.*', () => {
  assert.match(src, /\bCFG\.authToken\b/);
  assert.match(src, /\bCFG\.projectRoots\b/);
  assert.match(src, /\bCFG\.claudeContinue\b/);
});

test('server.cjs:NO_OPEN/NO_ATTACH/WEB_ONLY 保留 flag-OR(CFG.noXxx || hasFlag)', () => {
  assert.match(src, /CFG\.noOpen\s*\|\|\s*hasFlag\(['"]--no-open['"]\)/);
  assert.match(src, /CFG\.noAttach\s*\|\|\s*hasFlag\(['"]--no-attach['"]\)/);
  assert.match(src, /CFG\.webOnly\s*\|\|\s*hasFlag\(['"]--web-only['"]\)/);
});

test('server.cjs:CAPTURE_HISTORY 仍经 tmux.parseCaptureHistory(读 CFG.captureHistory)', () => {
  assert.match(src, /tmux\.parseCaptureHistory\(\s*CFG\.captureHistory\s*\)/);
});

test('server.cjs:loginRateLimiter 用 CFG.loginMax / CFG.loginWindowMs', () => {
  assert.match(src, /createRateLimiter\(\s*\{\s*max:\s*CFG\.loginMax,\s*windowMs:\s*CFG\.loginWindowMs/);
});

test('server.cjs:dashboard/wsPing interval 读 CFG.*', () => {
  assert.match(src, /\bCFG\.dashboardIntervalMs\b/);
  assert.match(src, /\bCFG\.wsPingInterval\b/);
});

test('server.cjs:config warnings 启动时打印(操作者可见权限/未知字段告警)', () => {
  assert.match(src, /cfgWarnings/);
  assert.match(src, /\[config\] 警告/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server_config_wiring.test.cjs`
Expected: FAIL —— server.cjs 尚未 require/调用 `loadConfig`,无 `CFG.*`。

- [ ] **Step 3: Write minimal implementation**

修改 `server.cjs`:

(a) 在 require 区末尾(`:24` `createRateLimiter` require 之后)插入:
```js
const { loadConfig, SINGLE_SCHEMA, SINGLE_CONFIG_PATH } = require('./config_loader.cjs');

// 配置文件(~/.cc-web-control/config.json,--config 覆盖)+ env 覆盖(env > file > default)。
// 无文件 = 纯 env/默认 = 现状行为(向后兼容)。warnings:未知字段 / token 权限过松。
const { config: CFG, warnings: cfgWarnings } = loadConfig({
  schema: SINGLE_SCHEMA,
  defaultFilePath: SINGLE_CONFIG_PATH,
});
if (cfgWarnings.length) {
  console.error('[config] 警告:');
  for (const w of cfgWarnings) console.error(`  ⚠ ${w}`);
}
```

(b) `:27-30` loginRateLimiter 改为:
```js
const loginRateLimiter = createRateLimiter({
  max: CFG.loginMax,
  windowMs: CFG.loginWindowMs,
});
```

(c) `:36-52` 常量块改为:
```js
const PORT = CFG.port;
const HOST = CFG.host;
const DEFAULT_SESSION = CFG.session;
const POLL_INTERVAL = CFG.pollInterval;
const CAPTURE_HISTORY = tmux.parseCaptureHistory(CFG.captureHistory);
const NO_OPEN = CFG.noOpen || hasFlag('--no-open');
const NO_ATTACH = CFG.noAttach || hasFlag('--no-attach');
const WEB_ONLY = CFG.webOnly || hasFlag('--web-only');
const CLAUDE_WRAPPER = path.join(__dirname, 'claude-wrapper.sh');
const AUTH_TOKEN = CFG.authToken;
const CLAUDE_CONTINUE = CFG.claudeContinue;
const PROJECT_ROOTS = CFG.projectRoots;
```

(d) `:383` 改为 `intervalMs: CFG.dashboardIntervalMs,`

(e) `:503` 改为 `const WS_PING_INTERVAL_MS = CFG.wsPingInterval;`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server_config_wiring.test.cjs`
Expected: PASS(8 tests)。
再跑全量确认无回归:Run: `npm test` — Expected: PASS(全部,含既有用例;无 config 文件 → 全默认 = 现状)。

- [ ] **Step 5: Commit**

```bash
git add server.cjs test/server_config_wiring.test.cjs
git commit -m "feat(server): 7684 接入 loadConfig(env>file>default,flag-OR 与 parseCaptureHistory 保留)"
```

---

## Task 7: hub/server.cjs startHub 接收 login/mainAgent 限流 opts(向后兼容)

**Files:**
- Modify: `hub/server.cjs`(`:26-33` 解构加 4 个 opts;`:63-71` 限流器读 local)
- Create: `test/hub_startHub_limits.test.cjs`

- [ ] **Step 1: Write the failing test**

`test/hub_startHub_limits.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'hub', 'server.cjs'), 'utf8');

test('startHub 解构含 loginMax/loginWindowMs/mainAgentMax/mainAgentWindowMs(opts 可传入)', () => {
  assert.match(src, /loginMax\s*=\s*Number\.parseInt\(process\.env\.CC_WEB_LOGIN_MAX/);
  assert.match(src, /loginWindowMs\s*=\s*Number\.parseInt\(process\.env\.CC_WEB_LOGIN_WINDOW_MS/);
  assert.match(src, /mainAgentMax\s*=\s*Number\.parseInt\(process\.env\.CC_WEB_MAIN_AGENT_MAX/);
  assert.match(src, /mainAgentWindowMs\s*=\s*Number\.parseInt\(process\.env\.CC_WEB_MAIN_AGENT_WINDOW_MS/);
});

test('loginRateLimiter 读 local loginMax/loginWindowMs(不再直读 env)', () => {
  assert.match(src, /createRateLimiter\(\s*\{\s*max:\s*loginMax,\s*windowMs:\s*loginWindowMs/);
});
test('mainAgentRateLimiter 读 local mainAgentMax/mainAgentWindowMs(不再直读 env)', () => {
  assert.match(src, /createRateLimiter\(\s*\{\s*max:\s*mainAgentMax,\s*windowMs:\s*mainAgentWindowMs/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub_startHub_limits.test.cjs`
Expected: FAIL —— startHub 解构尚无 `loginMax` 等 opts,限流器仍直读 env。

- [ ] **Step 3: Write minimal implementation**

修改 `hub/server.cjs` `:26-33` 解构(在 `mainAgent = {},` 之前插入 4 行,保留各 env 默认 → 向后兼容):
```js
  const {
    machinesFile,
    hubToken,
    host = process.env.CC_WEB_HUB_HOST || '127.0.0.1',
    port = Number(process.env.CC_WEB_HUB_PORT) || 7685,
    intervalMs = Number(process.env.CC_WEB_HUB_DASHBOARD_INTERVAL_MS) || 2000,
    loginMax = Number.parseInt(process.env.CC_WEB_LOGIN_MAX || '', 10) || 5,
    loginWindowMs = Number.parseInt(process.env.CC_WEB_LOGIN_WINDOW_MS || '', 10) || 15 * 60 * 1000,
    mainAgentMax = Number.parseInt(process.env.CC_WEB_MAIN_AGENT_MAX || '', 10) || 6,
    mainAgentWindowMs = Number.parseInt(process.env.CC_WEB_MAIN_AGENT_WINDOW_MS || '', 10) || 60 * 1000,
    mainAgent = {},
  } = opts;
```

`:63-66` loginRateLimiter 改为:
```js
  const loginRateLimiter = createRateLimiter({
    max: loginMax,
    windowMs: loginWindowMs,
  });
```

`:68-71` mainAgentRateLimiter 改为:
```js
  const mainAgentRateLimiter = createRateLimiter({
    max: mainAgentMax,
    windowMs: mainAgentWindowMs,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub_startHub_limits.test.cjs`
Expected: PASS(3 tests)。
确认 hub 既有测试无回归:Run: `node --test test/hub-config.test.cjs test/hub-main-agent-env.test.cjs` — Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add hub/server.cjs test/hub_startHub_limits.test.cjs
git commit -m "feat(hub): startHub 接收 login/mainAgent 限流 opts(env 默认,向后兼容)"
```

---

## Task 8: hub/server_entry.cjs(7685)接入 loadConfig + mainAgent env 桥接

**Files:**
- Modify: `hub/server_entry.cjs`(整文件改写为 loadConfig + 桥接 + 传 startHub)
- Create: `test/hub_entry_config_wiring.test.cjs`

- [ ] **Step 1: Write the failing test**

`test/hub_entry_config_wiring.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'hub', 'server_entry.cjs'), 'utf8');

test('server_entry 顶部 require config_loader + loadConfig(HUB_SCHEMA)', () => {
  assert.match(src, /require\(['"]\.\.\/config_loader\.cjs['"]\)/);
  assert.match(src, /loadConfig\(\s*\{\s*schema:\s*HUB_SCHEMA/);
});

test('server_entry:config warnings 启动时打印', () => {
  assert.match(src, /cfgWarnings/);
});

test('server_entry:mainAgent env 桥接 —— config.mainAgent.* 映射到 CC_WEB_HUB_MAIN_AGENT_* 虚拟 env', () => {
  assert.match(src, /CC_WEB_HUB_MAIN_AGENT_ENABLED/);
  assert.match(src, /CC_WEB_HUB_MAIN_AGENT_SETTLE_MS/);
  assert.match(src, /CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH/);
  // 真实 env 后展开 → 优先(file 经虚拟 env 注入,env 仍覆盖)
  assert.match(src, /\{\s*\.\.\.virtualEnv,\s*\.\.\.process\.env\s*\}/);
  assert.match(src, /resolveMainAgentConfig\(mergedEnv\)/);
});

test('server_entry:startHub 入参用 CFG.*(machinesFile/hubToken/host/port/intervalMs + 限流 + mainAgent)', () => {
  assert.match(src, /machinesFile:\s*CFG\.machinesFile/);
  assert.match(src, /hubToken:\s*CFG\.hubToken/);
  assert.match(src, /host:\s*CFG\.host/);
  assert.match(src, /port:\s*CFG\.port/);
  assert.match(src, /intervalMs:\s*CFG\.intervalMs/);
  assert.match(src, /loginMax:\s*CFG\.loginMax/);
  assert.match(src, /mainAgentMax:\s*CFG\.mainAgentMax/);
  assert.match(src, /mainAgent,\s*[\s\S]*?\}\)/);
});

test('server_entry:NO_OPEN 保留 flag-OR(CFG.noOpen || argv --no-open)', () => {
  assert.match(src, /CFG\.noOpen\s*\|\|\s*process\.argv\.includes\(['"]--no-open['"]\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub_entry_config_wiring.test.cjs`
Expected: FAIL —— server_entry 尚未接入 loadConfig / 桥接。

- [ ] **Step 3: Write minimal implementation**

整文件改写 `hub/server_entry.cjs`:
```js
'use strict';
const { exec } = require('node:child_process');
const { startHub } = require('./server.cjs');
const { resolveMainAgentConfig } = require('./main_agent_env.cjs');
const { loadConfig, HUB_SCHEMA, HUB_CONFIG_PATH } = require('../config_loader.cjs');

// 配置文件(~/.cc-web-control/hub-config.json,--config 覆盖)+ env 覆盖(env > file > default)。
// 无文件 = 纯 env/默认 = 现状行为(向后兼容)。warnings:未知字段 / token 权限过松。
const { config: CFG, warnings: cfgWarnings } = loadConfig({
  schema: HUB_SCHEMA,
  defaultFilePath: HUB_CONFIG_PATH,
});
if (cfgWarnings.length) {
  console.error('[config] 警告:');
  for (const w of cfgWarnings) console.error(`  ⚠ ${w}`);
}

// mainAgent env 桥接(spec §5.2 B2):config.mainAgent.* → 虚拟 env,与真实 env 合并(env 优先),
// 整体交 resolveMainAgentConfig(零改动)。bool true→'1';数值/串→String。
const MAIN_AGENT_ENV_MAP = {
  enabled: 'CC_WEB_HUB_MAIN_AGENT_ENABLED',
  session: 'CC_WEB_HUB_MAIN_AGENT_SESSION',
  claudePath: 'CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH',
  dataDir: 'CC_WEB_HUB_MAIN_AGENT_DATA_DIR',
  auditFile: 'CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE',
  settleMs: 'CC_WEB_HUB_MAIN_AGENT_SETTLE_MS',
  maxSettleMs: 'CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS',
  backoffBase: 'CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE',
  staleBump: 'CC_WEB_HUB_MAIN_AGENT_STALE_BUMP',
};
const virtualEnv = {};
for (const [k, envName] of Object.entries(MAIN_AGENT_ENV_MAP)) {
  if (Object.prototype.hasOwnProperty.call(CFG.mainAgent, k)) {
    const v = CFG.mainAgent[k];
    virtualEnv[envName] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  }
}
const mergedEnv = { ...virtualEnv, ...process.env }; // 真实 env 后展开 → 覆盖虚拟(file)
const mainAgent = resolveMainAgentConfig(mergedEnv);

const NO_OPEN = CFG.noOpen || process.argv.includes('--no-open');

startHub({
  machinesFile: CFG.machinesFile,
  hubToken: CFG.hubToken,
  host: CFG.host,
  port: CFG.port,
  intervalMs: CFG.intervalMs,
  loginMax: CFG.loginMax,
  loginWindowMs: CFG.loginWindowMs,
  mainAgentMax: CFG.mainAgentMax,
  mainAgentWindowMs: CFG.mainAgentWindowMs,
  mainAgent,
}).then((hub) => {
  console.log(`[hub] listening on ${hub.host}:${hub.port} (machines: ${CFG.machinesFile})`);
  console.log(`[hub] 访问地址: ${hub.url}`);
  if (NO_OPEN) {
    console.log('[hub] 已禁用自动开浏览器(config.noOpen / CC_WEB_HUB_NO_OPEN=1 / --no-open)');
    return;
  }
  setTimeout(() => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${hub.url}`, () => {});
  }, 1500);
}).catch((e) => {
  console.error(`[hub] 启动失败: ${e.message}`);
  process.exit(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub_entry_config_wiring.test.cjs`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add hub/server_entry.cjs test/hub_entry_config_wiring.test.cjs
git commit -m "feat(hub): 7685 接入 loadConfig + mainAgent env 桥接(resolveMainAgentConfig 零改)"
```

---

## Task 9: 模板 config.example.json / hub-config.example.json + README 配置段

**Files:**
- Create: `config.example.json`、`hub-config.example.json`
- Modify: `README.md`(追加「配置文件」段)
- Create: `test/config_templates.test.cjs`

- [ ] **Step 1: Write the failing test**

`test/config_templates.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SINGLE_SCHEMA, HUB_SCHEMA, loadConfig } = require('../config_loader.cjs');

function readJson(p) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8')); }

test('config.example.json 字段全是 SINGLE_SCHEMA 已知字段(无拼写错误)', () => {
  const ex = readJson('config.example.json');
  for (const k of Object.keys(ex)) {
    assert.ok(Object.prototype.hasOwnProperty.call(SINGLE_SCHEMA, k), `example 含未知字段 ${k}`);
  }
});

test('hub-config.example.json 字段全是 HUB_SCHEMA 已知字段', () => {
  const ex = readJson('hub-config.example.json');
  for (const k of Object.keys(ex)) {
    assert.ok(Object.prototype.hasOwnProperty.call(HUB_SCHEMA, k), `example 含未知字段 ${k}`);
  }
});

test('两份 example 经 loadConfig 校验通过(无 throw)', () => {
  const single = path.join(__dirname, '..', 'config.example.json');
  const hub = path.join(__dirname, '..', 'hub-config.example.json');
  assert.doesNotThrow(() => loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: single, argv: [], env: {} }));
  assert.doesNotThrow(() => loadConfig({ schema: HUB_SCHEMA, defaultFilePath: hub, argv: [], env: {} }));
});

test('README 含配置文件段 + chmod 600 提示', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /配置文件/);
  assert.match(readme, /chmod 600/);
  assert.match(readme, /config\.json/);
  assert.match(readme, /hub-config\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config_templates.test.cjs`
Expected: FAIL —— 两份 example 不存在 / README 无配置段。

- [ ] **Step 3: Write minimal implementation**

`config.example.json`(7684 单机;字段说明见 README,JSON 不支持注释):
```json
{
  "port": 7684,
  "host": "127.0.0.1",
  "session": "claude-web-session",
  "authToken": "",
  "projectRoots": [],
  "captureHistory": "0",
  "pollInterval": 100,
  "claudeContinue": false,
  "noOpen": false,
  "noAttach": false,
  "webOnly": false,
  "loginMax": 5,
  "loginWindowMs": 900000,
  "dashboardIntervalMs": 2000,
  "wsPingInterval": 30000
}
```

`hub-config.example.json`(7685 hub):
```json
{
  "host": "127.0.0.1",
  "port": 7685,
  "intervalMs": 2000,
  "machinesFile": "~/.cc-web-control/hub-machines.json",
  "hubToken": "",
  "noOpen": false,
  "loginMax": 5,
  "loginWindowMs": 900000,
  "mainAgentMax": 6,
  "mainAgentWindowMs": 60000,
  "mainAgent": {
    "enabled": false,
    "session": "",
    "claudePath": "",
    "dataDir": "~/.cc-web-control/main-agent",
    "auditFile": "",
    "settleMs": 60000,
    "maxSettleMs": 900000,
    "backoffBase": 2,
    "staleBump": 1
  }
}
```

在 `README.md` 末尾追加(字段表对齐 spec §5.1/§5.2):
````markdown
## 配置文件启动

7684 / 7685 支持读本地 JSON 配置文件启动,环境变量保留作覆盖逃生口。优先级:`env > 文件 > 默认`。无配置文件 = 现状行为(纯 env/默认,向后兼容)。

### 文件路径

| 入口 | 默认路径 | `--config` 覆盖 |
|---|---|---|
| 7684 单机 `server.cjs` | `~/.cc-web-control/config.json` | `cc-web-control --config /path/to/config.json` |
| 7685 hub `hub server_entry.cjs` | `~/.cc-web-control/hub-config.json` | `cc-web-control hub --config /path/to/hub-config.json` |

模板见 `config.example.json` / `hub-config.example.json`,复制后改值即可。

### 7684 config.json 字段

| 字段 | 类型 | env | 默认 | 校验 |
|---|---|---|---|---|
| port | number | CC_WEB_PORT | 7684 | 整数 1-65535 |
| host | string | CC_WEB_HOST | 127.0.0.1 | 非空 |
| session | string | CC_WEB_SESSION | claude-web-session | `/^[A-Za-z0-9._-]{1,64}$/` |
| authToken | string | CC_WEB_AUTH_TOKEN | "" | — |
| projectRoots | string[] | CC_WEB_PROJECT_ROOTS(逗号分) | [] | 每元素 string |
| captureHistory | string | CC_WEB_CAPTURE_HISTORY | "0" | 数字串,交 tmux 解析 |
| pollInterval | number | CC_WEB_POLL_INTERVAL | 100 | >=1 |
| claudeContinue | bool | CC_WEB_CLAUDE_CONTINUE('1') | false | — |
| noOpen / noAttach / webOnly | bool | CC_WEB_NO_OPEN 等('1') | false | flag 仍可叠加 |
| loginMax / loginWindowMs | number | CC_WEB_LOGIN_MAX / WINDOW_MS | 5 / 900000 | >=1 |
| dashboardIntervalMs | number | CC_WEB_DASHBOARD_INTERVAL_MS | 2000 | >=1 |
| wsPingInterval | number | CC_WEB_WS_PING_INTERVAL | 30000 | >=1 |

bool 约定:文件 `true`/`false`;env `'1'` = true。

### 7685 hub-config.json 字段

| 字段 | 类型 | env | 默认 |
|---|---|---|---|
| host | string | CC_WEB_HUB_HOST | 127.0.0.1 |
| port | number | CC_WEB_HUB_PORT | 7685 |
| intervalMs | number | CC_WEB_HUB_DASHBOARD_INTERVAL_MS | 2000 |
| machinesFile | string | CC_WEB_HUB_MACHINES_FILE | ~/.cc-web-control/hub-machines.json |
| hubToken | string | CC_WEB_HUB_TOKEN | "" |
| noOpen | bool | CC_WEB_HUB_NO_OPEN | false |
| loginMax / loginWindowMs | number | CC_WEB_LOGIN_MAX / WINDOW_MS | 5 / 900000 |
| mainAgentMax / mainAgentWindowMs | number | CC_WEB_MAIN_AGENT_MAX / WINDOW_MS | 6 / 60000 |
| mainAgent | object | (见下) | {} |

`mainAgent` 子段(`enabled`/`session`/`claudePath`/`dataDir`/`auditFile`/`settleMs`/`maxSettleMs`/`backoffBase`/`staleBump`)经 env 桥接交 `resolveMainAgentConfig`,与 `CC_WEB_HUB_MAIN_AGENT_*` 等价(env 仍优先)。详见 `hub/main_agent_env.cjs`。

### 安全:token 权限

`authToken` / `hubToken` 明文存配置文件。loader 检测到「含 token 且 group/other 可读」会**警告继续**(不阻断)。建议:

```bash
chmod 600 ~/.cc-web-control/config.json
chmod 600 ~/.cc-web-control/hub-config.json
```

token 不回显日志 / 错误信息。`~/.cc-web-control/` 不在 repo 内;若把配置放项目内,务必加入 `.gitignore`。不接受明文可改用 env(CI secret 注入)。
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config_templates.test.cjs`
Expected: PASS(4 tests)。

- [ ] **Step 5: Commit**

```bash
git add config.example.json hub-config.example.json README.md test/config_templates.test.cjs
git commit -m "docs(config): config.example/hub-config.example 模板 + README 配置文件段"
```

---

## Task 10: 全量回归(无 config 文件 → 向后兼容)+ 收尾

**Files:**
- 无新增;仅验证

- [ ] **Step 1: 清空配置文件场景跑全量**

确保 `~/.cc-web-control/config.json` 与 `hub-config.json` **不存在**(向后兼容场景),然后:
Run: `npm test`
Expected: PASS(全部测试,含既有 `test/*.test.cjs` + 本计划新增 5 个测试文件)。无 config 文件时两入口走全默认 = 现状,既有行为零变化。

- [ ] **Step 2: 有配置文件场景冒烟(手动,非自动化)**

```bash
cp config.example.json ~/.cc-web-control/config.json
# 改个端口验证 file 生效,例如把 port 改 8765
node -e "require('./config_loader.cjs').loadConfig({schema:require('./config_loader.cjs').SINGLE_SCHEMA,defaultFilePath:process.env.HOME+'/.cc-web-control/config.json',argv:[],env:{}})" && echo OK
# 验证 env 覆盖:CC_WEB_PORT=9999 应覆盖 file 的 8765
CC_WEB_PORT=9999 node -e "const r=require('./config_loader.cjs').loadConfig({schema:require('./config_loader.cjs').SINGLE_SCHEMA,defaultFilePath:process.env.HOME+'/.cc-web-control/config.json',argv:[],env:process.env});console.log('port=',r.config.port)"
# 期望:port= 9999(env 覆盖 file)
```
Expected: `port= 9999`(env > file 验证通过)。验毕删测试文件:`rm ~/.cc-web-control/config.json`。

- [ ] **Step 3: 坏配置文件 fail-fast 冒烟(手动)**

```bash
echo '{ broken' > /tmp/bad-config.json
node -e "require('./config_loader.cjs').loadConfig({schema:require('./config_loader.cjs').SINGLE_SCHEMA,defaultFilePath:'/tmp/bad-config.json',argv:[],env:{}})"
# 期望:抛 "config JSON 解析失败 /tmp/bad-config.json: ..."
```
Expected: throw 含文件路径(进程启动会因此退出 = fail-fast,符合 spec §6)。`rm /tmp/bad-config.json`。

- [ ] **Step 4: 最终提交(若有未提交的清理)**

若 Step 2/3 未产生代码变更,本步可跳过;否则:
```bash
git add -A
git commit -m "test(config): 全量回归通过(无 config 文件向后兼容)"
```

---

## Self-Review(plan 自检,执行前完成)

**1. Spec coverage:**
- §1 目标(两入口读 JSON 启动 + env 覆盖 + 复用 loadMachines 范式)→ Task 1-8 ✓
- §3.1 两份独立文件 + `--config` flag → Task 1(parseConfigFlag)+ Task 4/5(路径常量)+ Task 6/8(接入)✓
- §3.2 优先级 env>file>default → Task 1 测试锁定 + loader 集中实现 ✓(实现说明已标注 DRY 偏离文面)
- §3.3 config_loader.cjs + SINGLE/HUB schema → Task 1-5 ✓
- §3.4 接入点(server.cjs 顶部 / server_entry startHub 前)→ Task 6 / Task 8 ✓
- §5.1 7684 15 字段 → Task 4 ✓
- §5.2 7685 11 字段 + mainAgent 子表 + B2 协同 → Task 5 + Task 8 ✓
- §6 错误处理(文件不存在 silent / 坏 JSON throw / 类型 throw / 端口越界 throw / projectRoots throw / 未知字段 warning / machinesFile 委托 loadMachines / 权限 warning)→ Task 1-3 + Task 10 ✓
- §7 安全(token 警告继续 / 不回显 / chmod 建议 / .gitignore 提醒)→ Task 3 + Task 9 ✓
- §8 测试计划(loader 核心 / schema / 接入 / 回归)→ Task 1-5 + 6/7/8 + 10 ✓
- §9 迁移与文档(向后兼容 + README + 模板)→ Task 9 + Task 10 ✓
- §1 非目标(MCP stdio env 不纳入)→ `hub/mcp/stdio.cjs` 不经 config_loader,本计划不触及 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个 code step 含完整代码;每个命令含 expected output。✓

**3. Type consistency:**
- `loadConfig` 签名 `{ schema, defaultFilePath, argv?, env?, fsImpl? }` → `{ config, warnings, filePath }` —— Task 1 定义,Task 4/5/6/8/9/10 使用一致 ✓
- `CFG` = `config` 别名 —— server.cjs(Task 6)与 server_entry(Task 8)一致 ✓
- `SINGLE_SCHEMA` 字段名 —— Task 4 定义,Task 6 使用一致 ✓
- `HUB_SCHEMA` 字段名 —— Task 5 定义,Task 8 使用一致 ✓
- startHub opts(loginMax/loginWindowMs/mainAgentMax/mainAgentWindowMs)—— Task 7 加,Task 8 传,一致 ✓
- mainAgent 桥接 `MAIN_AGENT_ENV_MAP` 9 键 —— Task 8 定义,与 `resolveMainAgentConfig`(hub/main_agent_env.cjs)读的 9 个 env 名一致 ✓

无缺口。可执行。

---

## Execution Handoff

计划已保存至 `docs/superpowers/plans/2026-07-06-config-file-startup.md`。两种执行方式:

1. **Subagent-Driven(推荐)** — 每个 Task 派一个 fresh subagent,Task 间 review,迭代快。
2. **Inline Execution** — 本会话内用 executing-plans 批量执行,带 checkpoint review。

**另:分支建议。** 当前在 `feat/single-machine-board-redesign`(spec commit `6feb32a` 在其上,本地未推送)。配置文件启动是独立新主题,建议实现开新分支 `feat/config-file-startup`(从当前分支拉,含三页面修复基线),spec + 本 plan 作为新分支首批 commit,实现 Task 1-10 在其上推进。要我现在开新分支,还是在执行时再定?
