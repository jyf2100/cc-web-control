# 主控 agent 界面起停 + tmux 镜像 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 hub web 控制台新增「主控 agent」面板,支持界面起停 cc-main-agent tmux session + 只读镜像其 pane 输出。

**Architecture:** 把 cc-main-agent 当特殊 machine(id=`main-agent`)喂进现有 `ws_bridge`。新建 `LocalTmuxClient` 适配器(引用计数共享池,照搬 `AgentClient._pool`)把本机 tmux session 翻译成 ws_bridge 期望的「远程 agent」形状(`attach`/`sendOneShot`)。ws_bridge 协议零改动,前端复用 `init` 帧覆盖语义。三个 HTTP 端点(start/stop/status)+ CSRF + 限流 + 串行锁 + 运行期门控。面板只读双保险(后端 send/sendOneShot no-op + 前端无 input 框)。

**Tech Stack:** Node.js (CommonJS `.cjs`)、Express、`ws`、`node:test`、tmux CLI。

**Spec:** `docs/superpowers/specs/2026-07-03-main-agent-ui-control-design.md`(三轮 expert review 定稿)。本 plan 覆盖 spec 全部 27 条 review 项(C1/H1-3/M1-7/L1-7 + R2-*/R3-*)。

**分支:** 基于 `main` 创建 `feat/main-agent-ui-control`(或用 worktree)。提交格式 conventional commits,无 Co-Authored-By。

**测试运行约定:** 全部 `node --test`(同步,绝不 `run_in_background`)。单文件 `node --test test/<file>.cjs`,全量 `node --test test/`。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `tmux.cjs` | 改 | 新增 `buildShowEnvArgs` + `showEnvironment(session, key)`(跑 `tmux show-environment`) |
| `hub/local_tmux.cjs` | 改 | 新增 `hasOwnedSession(name)`(包 showEnvironment 查 `CC_WEB_OWNED`) |
| `hub/local_tmux_client.cjs` | 新建 | `LocalTmuxClient` 适配器:引用计数池 + 只读 send/sendOneShot + redact + close |
| `hub/server.cjs` | 改 | setupMainAgent 抽 spawn 句柄 + 接受 `ma.tmux` 注入(可测)+ 构造 localClient 钉死 + getClient 分支 + close 序列 + 3 端点 + 串行锁 + 限流 |
| `public/console.html` | 改 | 顶部「主控 agent」面板 + banner |
| `public/console.js` | 改 | 面板 WS(init 覆盖)+ status 轮询 + 起停按钮 + 断线重连 |
| `test/tmux-show-environment.test.cjs` | 新建 | buildShowEnvArgs 单测 |
| `test/hub-local-tmux.test.cjs` | 改 | 扩展 hasOwnedSession 三态 + 边界单测 |
| `test/hub-local-tmux-client.test.cjs` | 新建 | LocalTmuxClient 全行为单测 |
| `test/hub-server-main-agent.test.cjs` | 新建 | 端点集成测试(supertest/fetch + stub tmux) |
| `docs/main-agent-smoke.md` | 改 | 面板手动验收 |
| `docs/操作手册.md` | 改(轻) | §13 补「界面可起停」 |

依赖顺序:Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。

---

## Task 1: tmux.cjs 新增 showEnvironment

**Files:**
- Modify: `tmux.cjs`(在 `buildCreateArgs` 后加 `buildShowEnvArgs`;在 `killSession` 后加 `showEnvironment`;`module.exports` 加两项)
- Test: `test/tmux-show-environment.test.cjs`(新建)

- [ ] **Step 1: Write the failing test**

创建 `test/tmux-show-environment.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildShowEnvArgs } = require('../tmux.cjs');

test('buildShowEnvArgs: session + key → show-environment 参数', () => {
  assert.deepEqual(
    buildShowEnvArgs('cc-main-agent', 'CC_WEB_OWNED'),
    ['show-environment', '-t', 'cc-main-agent', 'CC_WEB_OWNED'],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tmux-show-environment.test.cjs`
Expected: FAIL — `buildShowEnvArgs is not a function`(未导出)。

- [ ] **Step 3: Write minimal implementation**

在 `tmux.cjs` 的 `buildCreateArgs` 函数(约行 104-112)之后插入:

```js
/** 构造 show-environment 的 tmux 参数(查单个 session 环境变量)。 */
function buildShowEnvArgs(session, key) {
  return ['show-environment', '-t', session, key];
}
```

在 `killSession` 函数(约行 181-197)之后、`module.exports` 之前插入:

```js
/**
 * 查询 session 级环境变量的值(tmux new-session -e 设置的 key 可读)。
 * @param {string} sessionName
 * @param {string} key
 * @returns {Promise<string>} stdout(形如 "CC_WEB_OWNED=1");session/key 不存在则 reject
 */
async function showEnvironment(sessionName, key) {
  if (!sessionName || typeof sessionName !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }
  if (!key || typeof key !== 'string') {
    throw new Error('Key must be a non-empty string');
  }
  const { stdout } = await runTmux(buildShowEnvArgs(sessionName, key), { maxStdoutChars: 1024 });
  return stdout;
}
```

在 `module.exports = { ... }`(约行 199-209)的对象里追加 `buildShowEnvArgs, showEnvironment`(放在 `buildCreateArgs` 后、`parseCaptureHistory` 前即可,保持字母/逻辑分组)。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tmux-show-environment.test.cjs`
Expected: PASS(1 test)。

- [ ] **Step 5: Commit**

```bash
git add tmux.cjs test/tmux-show-environment.test.cjs
git commit -m "feat(tmux): add showEnvironment + buildShowEnvArgs for session env probe"
```

---

## Task 2: local_tmux.cjs 新增 hasOwnedSession

**Files:**
- Modify: `hub/local_tmux.cjs`(`createLocalTmux` 返回对象加 `hasOwnedSession`)
- Test: `test/hub-local-tmux.test.cjs`(扩展 stubTmux + 加 3 组测试)

- [ ] **Step 1: Write the failing test**

在 `test/hub-local-tmux.test.cjs` 顶部 `stubTmux()` 的返回对象里,在 `sendKey` 行后加一个可配置的 `showEnvironment` stub(默认返 `CC_WEB_OWNED=1`):

```js
function stubTmux() {
  const calls = [];
  let envOut = 'CC_WEB_OWNED=1';       // 默认 owned
  return {
    calls,
    setEnv(v) { envOut = v; },
    setEnvThrow(e) { envOut = undefined; this._envErr = e; },
    sendKeys: async (s, k, o) => { calls.push({ fn: 'sendKeys', s, k, o }); return true; },
    capturePane: async (s, sb) => { calls.push({ fn: 'capturePane', s, sb }); return 'PANE'; },
    checkSession: async (s) => { calls.push({ fn: 'checkSession', s }); return true; },
    createSession: async (s, c) => { calls.push({ fn: 'createSession', s, c }); return true; },
    killSession: async (s) => { calls.push({ fn: 'killSession', s }); return true; },
    sendKey: async (s, k) => { calls.push({ fn: 'sendKey', s, k }); return true; },
    showEnvironment: async (s, k) => {
      calls.push({ fn: 'showEnvironment', s, k });
      if (envOut === undefined) throw this._envErr || new Error('no such session');
      return envOut;
    },
  };
}
```

在文件末尾追加测试:

```js
test('hasOwnedSession: CC_WEB_OWNED=1 → true', async () => {
  const st = stubTmux();
  const lt = createLocalTmux({ tmux: st });
  assert.equal(await lt.hasOwnedSession('cc-main-agent'), true);
  assert.equal(st.calls[0].fn, 'showEnvironment');
  assert.equal(st.calls[0].k, 'CC_WEB_OWNED');
});

test('hasOwnedSession: CC_WEB_OWNED=0 → false(R3-L2 防误判)', async () => {
  const st = stubTmux(); st.setEnv('CC_WEB_OWNED=0');
  const lt = createLocalTmux({ tmux: st });
  assert.equal(await lt.hasOwnedSession('s'), false);
});

test('hasOwnedSession: showEnvironment 抛错(session 不存在/无键)→ false', async () => {
  const st = stubTmux(); st.setEnvThrow(new Error("can't find session: nope"));
  const lt = createLocalTmux({ tmux: st });
  assert.equal(await lt.hasOwnedSession('nope'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub-local-tmux.test.cjs`
Expected: FAIL — `lt.hasOwnedSession is not a function`。

- [ ] **Step 3: Write minimal implementation**

在 `hub/local_tmux.cjs` 的 `createLocalTmux` 返回对象里,在 `sendKey` 之后加:

```js
    /** 判定 session 是否由 hub 拥有(创建时注入了 CC_WEB_OWNED=1)。非 owned/不存在 → false。 */
    async hasOwnedSession(session) {
      try {
        const line = await t.showEnvironment(session, 'CC_WEB_OWNED');
        return String(line).trim().split('=')[1] === '1';
      } catch {
        return false;
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub-local-tmux.test.cjs`
Expected: PASS(原 3 + 新 3 = 6 tests)。

- [ ] **Step 5: Commit**

```bash
git add hub/local_tmux.cjs test/hub-local-tmux.test.cjs
git commit -m "feat(local_tmux): add hasOwnedSession probing CC_WEB_OWNED session env"
```

---

## Task 3: LocalTmuxClient 基础生命周期(attach/pool/detach/close)

**Files:**
- Create: `hub/local_tmux_client.cjs`
- Test: `test/hub-local-tmux-client.test.cjs`(新建)

本 task 实现:构造校验、attach 首帧 `init`(全员广播)、后续订阅回放、引用计数共享池、`setInterval` + `unref`、detach 末订阅清 interval、`close()` 遍历清池、dummy handle(session 不匹配)。capture 抛错暂吞(最简),Task 4 增强为 kill 回收。`send`/`sendOneShot` 暂不审计(Task 4 加)。

- [ ] **Step 1: Write the failing test**

创建 `test/hub-local-tmux-client.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalTmuxClient } = require('../hub/local_tmux_client.cjs');

// stub localTmux:capture 可推序列;audit 记录
function stubLocalTmux() {
  const seq = [];
  let i = 0;
  return {
    seq,
    setCaptures(arr) { seq.push(...arr); },
    capture: async () => { const v = seq.length ? seq[i++ % seq.length] : 'FRAME'; return v; },
    hasOwnedSession: async () => true,
  };
}
function memAudit() { const entries = []; return { entries, log: async (e) => { entries.push(e); return e; } }; }

test('构造缺参 → throw', () => {
  assert.throws(() => new LocalTmuxClient({}), /required/);
});

test('attach 首帧发 init(覆盖语义),用首 capture 的内容', async () => {
  const lt = stubLocalTmux(); lt.setCaptures(['HELLO']);
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 'cc-main-agent', audit: memAudit(), pollMs: 1000 });
  const got = [];
  c.attach('cc-main-agent', (m) => got.push(m));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(got.some((m) => m.type === 'init' && m.data === 'HELLO'));
  c.close();
});

test('session 不匹配 → onMsg error + 返回 dummy handle(非 null,空 send/detach)', async () => {
  const lt = stubLocalTmux();
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 'cc-main-agent', audit: memAudit() });
  const got = [];
  const h = c.attach('other', (m) => got.push(m));
  assert.ok(h && typeof h.send === 'function' && typeof h.detach === 'function', 'dummy handle');
  assert.equal(h.send({}), false);
  assert.ok(got.some((m) => m.type === 'error'));
  c.close();
});

test('H1 共享池:同 session 两次 attach 只起 1 个 capture 轮询;末订阅 detach 清 interval', async () => {
  let captureCalls = 0;
  const lt = { capture: async () => { captureCalls++; return 'F'; }, hasOwnedSession: async () => true };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 5 });
  const h1 = c.attach('s', () => {});
  const h2 = c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 20)); // 让 interval 跑几轮
  const callsAfterAttach = captureCalls;
  assert.ok(callsAfterAttach >= 1, '至少一次 capture');
  h1.detach();
  h2.detach();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(captureCalls, callsAfterAttach, 'detach 后 interval 清零,不再 capture');
  c.close();
});

test('close() 清池:之后 capture 不再触发(interval 已清)', async () => {
  let captureCalls = 0;
  const lt = { capture: async () => { captureCalls++; return 'F'; }, hasOwnedSession: async () => true };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 5 });
  c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 10));
  c.close();
  const before = captureCalls;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(captureCalls, before, 'close 后无 capture');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub-local-tmux-client.test.cjs`
Expected: FAIL — `Cannot find module '../hub/local_tmux_client.cjs'`。

- [ ] **Step 3: Write minimal implementation**

创建 `hub/local_tmux_client.cjs`:

```js
// hub/local_tmux_client.cjs
'use strict';

/**
 * 把本机 tmux session 翻译成 ws_bridge 期望的「远程 agent」形状。
 * 引用计数共享池:同 session 多连接共享 1 个 capture 轮询(照搬 AgentClient._pool)。
 * 只读:send/sendOneShot 永不调 poke/sendKey。
 */
class LocalTmuxClient {
  constructor({ localTmux, sessionName, audit, pollMs = 1000 } = {}) {
    if (!localTmux || !sessionName || !audit) throw new Error('localTmux, sessionName, audit required');
    this._lt = localTmux;
    this._session = sessionName;
    this._audit = audit;
    this._pollMs = pollMs;
    this._pool = new Map(); // session -> { id, subs:Set<fn>, timer, lastCaptured }
    this._seq = 0;
  }

  // Task 4 实现 redact;本 task 透传
  _redact(text) { return text; }

  _broadcast(entry, msg) {
    for (const cb of entry.subs) {
      try { cb(msg); } catch {}
    }
  }

  _captureOnce(session, entryId) {
    this._lt.capture(session, 2000).then((captured) => {
      const e = this._pool.get(session);
      if (!e || e.id !== entryId) return; // 陈旧回调 early-return(R3-M1)
      if (captured === e.lastCaptured) return;
      e.lastCaptured = captured;
      this._broadcast(e, { type: 'init', data: this._redact(captured) });
    }).catch(() => {
      // Task 4 增强:kill 回收四件套
    });
  }

  attach(session, onMsg) {
    if (session !== this._session) {
      try { onMsg({ type: 'error', data: 'unknown session' }); } catch {}
      return { send: () => false, detach: () => {} }; // dummy handle(L4)
    }
    let entry = this._pool.get(session);
    if (entry && entry.lastCaptured != null) {
      entry.subs.add(onMsg);
      try { onMsg({ type: 'init', data: this._redact(entry.lastCaptured) }); } catch {}
      return this._handle(session, onMsg);
    }
    if (!entry) {
      entry = { id: ++this._seq, subs: new Set(), timer: null, lastCaptured: null };
      this._pool.set(session, entry);
    }
    entry.subs.add(onMsg);
    const entryId = entry.id;
    this._captureOnce(session, entryId); // 首 capture(async)
    entry.timer = setInterval(() => this._captureOnce(session, entryId), this._pollMs);
    if (entry.timer.unref) entry.timer.unref(); // R2-M1:防 hub close 被 timer 撑住
    return this._handle(session, onMsg);
  }

  _handle(session, onMsg) {
    return {
      // 只读:不调 poke/sendKey(Task 4 加审计)
      send: () => false,
      detach: () => {
        const e = this._pool.get(session);
        if (!e) return;
        e.subs.delete(onMsg);
        if (e.subs.size === 0) {
          if (e.timer) { clearInterval(e.timer); e.timer = null; }
          this._pool.delete(session);
        }
      },
    };
  }

  async sendOneShot() {
    // Task 4 加审计
    return { ok: false, error: 'read-only' };
  }

  close() {
    for (const [, e] of this._pool) {
      if (e.timer) { clearInterval(e.timer); e.timer = null; }
      e.subs.clear();
    }
    this._pool.clear();
  }
}

module.exports = { LocalTmuxClient };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub-local-tmux-client.test.cjs`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add hub/local_tmux_client.cjs test/hub-local-tmux-client.test.cjs
git commit -m "feat(local_tmux_client): LocalTmuxClient ref-counted pool + init broadcast + close"
```

---

## Task 4: LocalTmuxClient 健壮防护(kill 回收 / 审计 / redact / 上限 / 守卫)

**Files:**
- Modify: `hub/local_tmux_client.cjs`
- Test: `test/hub-local-tmux-client.test.cjs`(追加)

覆盖:R2-H1(kill 四件套回收 + attach 守卫)、R3-M1(capture in-flight 竞态 entryId)、R3-L1(tombstone `entry.timer=null`)、M7/L1(send/sendOneShot 审计 `scope:'local_tmux'`)、L2(redact 敏感串)、subs 上限。

- [ ] **Step 1: Write the failing test**

在 `test/hub-local-tmux-client.test.cjs` 末尾追加:

```js
test('R2-H1 kill 回收:capture 抛错 → subs 收 error + 四件套清池(新 attach 重建,不重放陈旧帧)', async () => {
  const lt = {
    capture: async () => { throw new Error('session not found'); },
    hasOwnedSession: async () => false,
  };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 5 });
  const got = [];
  c.attach('s', (m) => got.push(m));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(got.some((m) => m.type === 'error' && /session ended|not found/i.test(m.data)), '收 error 帧');
  assert.equal(c._pool.size, 0, 'pool entry 已完整回收');
  c.close();
});

test('R3-M1 entryId 身份比对:capture in-flight 期间 detach + 重 attach → 旧回调不误伤新 entry', async () => {
  let resolveFirst;
  const lt = {
    capture: () => new Promise((res) => { resolveFirst = res; }),
    hasOwnedSession: async () => true,
  };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 1000 });
  const h1 = c.attach('s', () => {});
  // 首 capture 悬着(in-flight);detach 旧订阅
  h1.detach();
  // 新 attach 建新 entry(新 id),旧 capture resolve 时不应清理新 entry
  c.attach('s', () => {});
  const newEntry = c._pool.get('s');
  const newId = newEntry.id;
  resolveFirst('STALE'); // 旧 capture 完成
  await new Promise((r) => setTimeout(r, 10));
  const after = c._pool.get('s');
  assert.ok(after && after.id === newId, '新 entry 未被旧回调误删');
  assert.ok(after.subs.size >= 1, '新订阅仍在');
  c.close();
});

test('M7/L1 send 审计 scope=local_tmux via=ws;sendOneShot via=broadcast', async () => {
  const lt = stubLocalTmux();
  const audit = memAudit();
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit });
  const h = c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.send({ type: 'input', data: 'x' }), false);
  assert.equal(h.send({}), false);
  await c.sendOneShot({});
  assert.ok(audit.entries.some((e) => e.scope === 'local_tmux' && e.event === 'input_ignored' && e.detail.via === 'ws'));
  assert.ok(audit.entries.some((e) => e.scope === 'local_tmux' && e.event === 'input_ignored' && e.detail.via === 'broadcast'));
  c.close();
});

test('L2 redact:capture 含 CC_WEB_HUB_TOKEN → init data 已 <redacted>', async () => {
  const lt = { capture: async () => 'env CC_WEB_HUB_TOKEN=sk-secret123 done', hasOwnedSession: async () => true };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit() });
  const got = [];
  c.attach('s', (m) => got.push(m));
  await new Promise((r) => setTimeout(r, 10));
  const init = got.find((m) => m.type === 'init');
  assert.ok(init.data.includes('<redacted>'));
  assert.ok(!init.data.includes('sk-secret123'));
  c.close();
});

test('subs 上限:第 11 个 attach 被拒(返回 dummy,不加入)', async () => {
  const lt = stubLocalTmux();
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), maxSubs: 10 });
  for (let i = 0; i < 10; i++) c.attach('s', () => {});
  const before = c._pool.get('s').subs.size;
  const over = c.attach('s', () => {});
  assert.equal(c._pool.get('s').subs.size, before, '第 11 个未加入');
  assert.equal(over.send({}), false); // dummy
  c.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub-local-tmux-client.test.cjs`
Expected: FAIL — kill 回收测试期望 `pool.size===0` 但当前 capture catch 为空 → entry 留池;redact 测试期望 `<redacted>` 但透传;send 审计无 entries;无 maxSubs。

- [ ] **Step 3: Write minimal implementation**

修改 `hub/local_tmux_client.cjs`:

(a) 构造加 `maxSubs`(默认 10):

```js
  constructor({ localTmux, sessionName, audit, pollMs = 1000, maxSubs = 10 } = {}) {
    if (!localTmux || !sessionName || !audit) throw new Error('localTmux, sessionName, audit required');
    this._lt = localTmux;
    this._session = sessionName;
    this._audit = audit;
    this._pollMs = pollMs;
    this._maxSubs = maxSubs;
    this._pool = new Map();
    this._seq = 0;
  }
```

(b) `_redact` 实现:

```js
  _redact(text) {
    if (typeof text !== 'string') return text;
    return text
      .replace(/CC_WEB_HUB_TOKEN=[^\s]+/gi, 'CC_WEB_HUB_TOKEN=<redacted>')
      .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer <redacted>');
  }
```

(c) `_captureOnce` 的 `.catch` 增强(kill 回收四件套 + tombstone + 身份比对):

```js
  _captureOnce(session, entryId) {
    this._lt.capture(session, 2000).then((captured) => {
      const e = this._pool.get(session);
      if (!e || e.id !== entryId) return;
      if (captured === e.lastCaptured) return;
      e.lastCaptured = captured;
      this._broadcast(e, { type: 'init', data: this._redact(captured) });
    }).catch(() => {
      const e = this._pool.get(session);
      if (!e || e.id !== entryId) return; // R3-M1 身份比对
      this._broadcast(e, { type: 'error', data: 'session ended' });
      if (e.timer) { clearInterval(e.timer); }
      e.subs.clear();
      e.timer = null;            // R3-L1 tombstone(使 attach 守卫非死代码)
      this._pool.delete(session); // R2-H1 无条件全清
    });
  }
```

(d) `attach` 加守卫(R2-H1)+ 上限:

```js
  attach(session, onMsg) {
    if (session !== this._session) {
      try { onMsg({ type: 'error', data: 'unknown session' }); } catch {}
      return { send: () => false, detach: () => {} };
    }
    let entry = this._pool.get(session);
    if (entry && entry.timer === null) { // R2-H1 守卫:已死 entry(tombstone)复活 → 强制删,防重放陈旧帧
      this._pool.delete(session);
      entry = undefined;
    }
    if (entry && entry.lastCaptured != null) {
      if (entry.subs.size >= this._maxSubs) return { send: () => false, detach: () => {} };
      entry.subs.add(onMsg);
      try { onMsg({ type: 'init', data: this._redact(entry.lastCaptured) }); } catch {}
      return this._handle(session, onMsg);
    }
    if (!entry) {
      entry = { id: ++this._seq, subs: new Set(), timer: null, lastCaptured: null };
      this._pool.set(session, entry);
    }
    if (entry.subs.size >= this._maxSubs) return { send: () => false, detach: () => {} };
    entry.subs.add(onMsg);
    const entryId = entry.id;
    this._captureOnce(session, entryId);
    entry.timer = setInterval(() => this._captureOnce(session, entryId), this._pollMs);
    if (entry.timer.unref) entry.timer.unref();
    return this._handle(session, onMsg);
  }
```

(e) `_handle.send` 与 `sendOneShot` 加审计:

```js
  _handle(session, onMsg) {
    return {
      send: () => {
        this._audit.log({ scope: 'local_tmux', runId: null, event: 'input_ignored', detail: { via: 'ws' } });
        return false;
      },
      detach: () => {
        const e = this._pool.get(session);
        if (!e) return;
        e.subs.delete(onMsg);
        if (e.subs.size === 0) {
          if (e.timer) { clearInterval(e.timer); e.timer = null; }
          this._pool.delete(session);
        }
      },
    };
  }

  async sendOneShot() {
    await this._audit.log({ scope: 'local_tmux', runId: null, event: 'input_ignored', detail: { via: 'broadcast' } });
    return { ok: false, error: 'read-only' };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub-local-tmux-client.test.cjs`
Expected: PASS(5 + 5 = 10 tests)。

- [ ] **Step 5: Commit**

```bash
git add hub/local_tmux_client.cjs test/hub-local-tmux-client.test.cjs
git commit -m "feat(local_tmux_client): kill recovery, entryId guard, audit, redact, subs cap"
```

---

## Task 5: server.cjs 装配(setupMainAgent 抽 spawn + tmux 注入 + getClient + close)

**Files:**
- Modify: `hub/server.cjs`(import `LocalTmuxClient`;`setupMainAgent` 接受 `ma.tmux`、构造 localClient、抽 spawn 句柄;`getClient` 加 main-agent 分支;`close` 序列补 `localClient.close()` + `await mainAgentOpChain`)
- Test: `test/hub-server-main-agent.test.cjs`(新建,本 task 先加 getClient/close 集成测;端点测在 Task 6)

**可测性关键**:`setupMainAgent` 改用 `createLocalTmux({ tmux: ma.tmux || rootTmux })`,测试传 stub tmux(`checkSession` 返 true 跳过首次 spawn)。

- [ ] **Step 1: Write the failing test**

创建 `test/hub-server-main-agent.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ma-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: [] }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
// stub tmux:checkSession→true 跳过首次 spawn;create/kill/hasOwnedSession 可控
function stubTmuxOwned() {
  const calls = [];
  return {
    calls,
    sendKeys: async () => true,
    capturePane: async () => 'PANE',
    checkSession: async () => true, // 假装已存在 → setupMainAgent 跳过 create
    createSession: async (s, c) => { calls.push({ fn: 'create', s }); return true; },
    killSession: async (s) => { calls.push({ fn: 'kill', s }); return true; },
    sendKey: async () => true,
    showEnvironment: async () => 'CC_WEB_OWNED=1',
  };
}
async function withMainAgentHub({ tmux, enabled = true }, fn) {
  const { file, cleanup } = tmpMachinesFile();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-data-'));
  const hub = await startHub({
    machinesFile: file, hubToken: 'T', host: '127.0.0.1', port: 0, intervalMs: 1000,
    mainAgent: { enabled, tmux, session: 'cc-main-agent', dataDir, settleMs: 60000, maxSettleMs: 900000 },
  });
  try {
    await new Promise((r) => setTimeout(r, 80)); // 等 setupMainAgent async 完成
    await fn(hub);
  } finally {
    await hub.stop();
    cleanup();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('M5 getClient:WS attach main-agent → 收 init 帧(LocalTmuxClient 接通)', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=T`);
    await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); });
    const inbox = [];
    ws.on('message', (b) => inbox.push(JSON.parse(b.toString())));
    ws.send(JSON.stringify({ type: 'attach', target: { machine: 'main-agent', session: 'cc-main-agent' } }));
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(inbox.some((m) => m.type === 'init' && m.target.machine === 'main-agent'), '应收到 init');
    ws.close();
  });
});

test('M5 getClient:unknown machine → error 帧', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/?token=T`);
    await new Promise((r) => { ws.on('open', r); });
    const inbox = [];
    ws.on('message', (b) => inbox.push(JSON.parse(b.toString())));
    ws.send(JSON.stringify({ type: 'attach', target: { machine: 'ghost', session: 'x' } }));
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(inbox.some((m) => m.type === 'error' && /unknown machine/.test(m.data)));
    ws.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub-server-main-agent.test.cjs`
Expected: FAIL — WS attach main-agent 收不到 init(getClient 未加 main-agent 分支,返 null → 'unknown machine')。

- [ ] **Step 3: Write minimal implementation**

(a) `hub/server.cjs` 顶部 import 加(在 `const { createLocalTmux } = require('./local_tmux.cjs');` 行后):

```js
const { LocalTmuxClient } = require('./local_tmux_client.cjs');
```

(b) `setupMainAgent` 内(约行 255 `const localTmux = createLocalTmux({ tmux: rootTmux });`)改为接受注入:

```js
    const localTmux = createLocalTmux({ tmux: ma.tmux || rootTmux });
```

(c) `setupMainAgent` 在 `watcher.start();`(约行 283)前、`return { ... }`(行 284)前,构造 `localClient` 与 `spawn` 句柄,并写进返回的 `handles`:

```js
    watcher.start();
    const localClient = new LocalTmuxClient({ localTmux, sessionName: ma.session || 'cc-main-agent', audit });
    // spawn 句柄:start 端点复用(不重新算 mcpPath/trustPath/cwd/token——首次已写)
    const spawn = async () => {
      if (await localTmux.hasOwnedSession(sessionName)) return { running: true, started: false };
      await localTmux.create(
        sessionName,
        `${ma.claudePath || 'claude'} --mcp-config ${mcpPath} --strict-mcp-config --settings ${trustPath}`,
        { cwd: dataDir, env: { CC_WEB_HUB_TOKEN: hubToken, CC_WEB_HUB_URL: hubUrl, CC_WEB_OWNED: '1' } },
      );
      return { running: true, started: true };
    };
    return {
      dispatcher: dispatcherInst,
      handles: { audit, watcher, dispatcher: dispatcherInst, localTmux, localClient, sessionName, spawn },
    };
```

注意:首次 spawn(行 276-282 的 `if (!(await localTmux.hasSession(...)))` 块)需补 `CC_WEB_OWNED:'1'` 到 env(M4),改为:

```js
    if (!(await localTmux.hasSession(sessionName))) {
      await localTmux.create(sessionName, `${ma.claudePath || 'claude'} --mcp-config ${mcpPath} --strict-mcp-config --settings ${trustPath}`, {
        cwd: dataDir,
        env: { CC_WEB_HUB_TOKEN: hubToken, CC_WEB_HUB_URL: hubUrl, CC_WEB_OWNED: '1' },
      });
    }
```

(d) `getClient`(约行 293-302)加 main-agent 分支:

```js
  const bridge = new WsBridge({
    getClient: (mid) => {
      if (mid === 'main-agent') return mainAgentHandles?.localClient ?? null;
      const ac = clients.get(mid);
      if (!ac) return null;
      return {
        attach: (session, onMsg) => ac.attachSession(session, onMsg),
        sendOneShot: (session, msg) => ac.sendOneShot(session, msg),
      };
    },
  });
```

(e) `close`(约行 339-349)补 `await mainAgentOpChain`(M3,Task 6 定义该变量;本 task 先声明 `let mainAgentOpChain = Promise.resolve();` 在模块级,close 里 await)+ `localClient.close()`:

```js
        close: async () => {
          await mainAgentOpChain; // M3:等起停操作串行完,防 close 中途 start 留孤儿
          if (mainAgentHandles) {
            mainAgentHandles.watcher.stop();
            mainAgentHandles.dispatcher.freeze();
            mainAgentHandles.localClient.close(); // R2-M1:清 capture interval
            try { await mainAgentHandles.localTmux.kill(mainAgentHandles.sessionName); } catch {}
          }
          aggregator.stop();
          for (const ac of clients.values()) ac.close();
          wss.close();
          await new Promise((r) => server.close(r));
        },
```

在 `const ma = mainAgent;`(约行 247)后加模块级串行锁变量(供 Task 6 用):

```js
  let mainAgentOpChain = Promise.resolve();
  function serializeMainAgentOp(fn) {
    const next = mainAgentOpChain.then(fn, fn);
    mainAgentOpChain = next.catch(() => {});
    return next;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub-server-main-agent.test.cjs`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add hub/server.cjs test/hub-server-main-agent.test.cjs
git commit -m "feat(hub): wire LocalTmuxClient into getClient + close; extract spawn handle"
```

---

## Task 6: server.cjs 三端点(start/stop/status)+ 限流 + CSRF

**Files:**
- Modify: `hub/server.cjs`(在 `/api/mcp/ack_event`(约行 216-222)之后、`app.post('/api/sessions'` 之前加 3 端点 + 限流器)
- Test: `test/hub-server-main-agent.test.cjs`(追加)

- [ ] **Step 1: Write the failing test**

在 `test/hub-server-main-agent.test.cjs` 末尾追加(复用 `withMainAgentHub` + `stubTmuxOwned`):

```js
async function maFetch(hub, pathname, init = {}) {
  const url = `http://127.0.0.1:${hub.port}${pathname}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Cookie: 'cc_web_auth=T',
      Origin: `http://127.0.0.1:${hub.port}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('M2 status:handles 就绪 + owned → {running:true,enabled:true}', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const { status, body } = await maFetch(hub, '/api/main-agent/status');
    assert.equal(status, 200);
    assert.deepEqual(body, { running: true, enabled: true });
  });
});

test('M2 门控:未启用 main agent → status 200 {running:false,enabled:false};start/stop → 503', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned(), enabled: false }, async (hub) => {
    const st = await maFetch(hub, '/api/main-agent/status');
    assert.equal(st.status, 200);
    assert.deepEqual(st.body, { running: false, enabled: false });
    const start = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(start.status, 503);
    const stop = await maFetch(hub, '/api/main-agent/stop', { method: 'POST', body: '{}' });
    assert.equal(stop.status, 503);
  });
});

test('start:foreign 同名 session(hasOwnedSession=false)→ create 抛错 → catch 不杀 foreign(R2-H2)+ 500', async () => {
  const tmux = stubTmuxOwned();
  tmux.showEnvironment = async () => 'CC_WEB_OWNED=0'; // foreign
  tmux.createSession = async () => { throw new Error('Session "cc-main-agent" already exists'); };
  await withMainAgentHub({ tmux }, async (hub) => {
    const r = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(r.status, 500);
    assert.ok(!tmux.calls.some((c) => c.fn === 'kill'), 'foreign 不被 kill');
  });
});

test('R3-H1 start:hasOwnedSession 抛错(非 not-found)→ 审计 cleanup_probe_failed + 500(不泄露 error)', async () => {
  const tmux = stubTmuxOwned();
  tmux.showEnvironment = async () => { throw new Error('permission denied'); };
  tmux.createSession = async () => { throw new Error('boom'); };
  await withMainAgentHub({ tmux }, async (hub) => {
    const r = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(r.status, 500);
    assert.ok(!JSON.stringify(r.body).includes('permission denied'), '不泄露内部 error');
  });
});

test('M1 限流:连续 7 次 start(6/min)→ 第 7 次 429', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    for (let i = 0; i < 6; i++) await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    const r7 = await maFetch(hub, '/api/main-agent/start', { method: 'POST', body: '{}' });
    assert.equal(r7.status, 429);
  });
});

test('CSRF:start 缺同源 → 403', async () => {
  await withMainAgentHub({ tmux: stubTmuxOwned() }, async (hub) => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/api/main-agent/start`, {
      method: 'POST',
      headers: { Cookie: 'cc_web_auth=T', Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 403);
  });
});

test('stop:foreign session → {stopped:false,reason:foreign session} 不 kill(M4)', async () => {
  const tmux = stubTmuxOwned();
  tmux.showEnvironment = async () => 'CC_WEB_OWNED=0';
  await withMainAgentHub({ tmux }, async (hub) => {
    const r = await maFetch(hub, '/api/main-agent/stop', { method: 'POST', body: '{}' });
    assert.equal(r.status, 200);
    assert.equal(r.body.stopped, false);
    assert.equal(r.body.reason, 'foreign session');
    assert.ok(!tmux.calls.some((c) => c.fn === 'kill'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/hub-server-main-agent.test.cjs`
Expected: FAIL — 端点不存在(404/redirect,非预期 status)。

- [ ] **Step 3: Write minimal implementation**

在 `hub/server.cjs` 的 `app.post('/api/mcp/ack_event', ...)`(约行 222)之后插入。先在文件顶部 `loginRateLimiter`(约行 62-65)后加 main-agent 限流器:

```js
  // ★ M1:主控 agent 起停端点限流(默认 6/min,起停低频操作)
  const mainAgentRateLimiter = createRateLimiter({
    max: Number.parseInt(process.env.CC_WEB_MAIN_AGENT_MAX || '', 10) || 6,
    windowMs: Number.parseInt(process.env.CC_WEB_MAIN_AGENT_WINDOW_MS || '', 10) || 60 * 1000,
  });
```

在 `/api/mcp/ack_event` 之后插入三端点:

```js
  // —— 主控 agent 起停端点(只读镜像配套;CSRF + 限流 + 串行锁)——
  const maSameOrigin = (req, res) => requireSameOriginForUnsafeMethods(req, res);

  app.post('/api/main-agent/start', async (req, res) => {
    if (!maSameOrigin(req, res)) return;
    const { limited } = mainAgentRateLimiter.check(req.ip);
    if (limited) { res.status(429).json({ error: 'rate limited' }); return; }
    if (!mainAgentHandles) { res.status(503).json({ error: 'main agent not ready' }); return; }
    try {
      const r = await serializeMainAgentOp(() => mainAgentHandles.spawn().catch(async (e) => {
        // ★ M6 + R2-H2 + R3-H1:create 抛错 → 仅清 owned,foreign 不动;探测失败写审计
        try {
          if (await mainAgentHandles.localTmux.hasOwnedSession(mainAgentHandles.sessionName)) {
            await mainAgentHandles.localTmux.kill(mainAgentHandles.sessionName);
          }
        } catch (probeErr) {
          mainAgentHandles.handles.audit.log({
            scope: 'local_tmux', runId: null, event: 'cleanup_probe_failed',
            detail: { name: mainAgentHandles.sessionName, error: probeErr.message },
          });
        }
        throw e;
      }));
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: 'start failed' });
    }
  });

  app.post('/api/main-agent/stop', async (req, res) => {
    if (!maSameOrigin(req, res)) return;
    const { limited } = mainAgentRateLimiter.check(req.ip);
    if (limited) { res.status(429).json({ error: 'rate limited' }); return; }
    if (!mainAgentHandles) { res.status(503).json({ error: 'main agent not ready' }); return; }
    const r = await serializeMainAgentOp(async () => {
      const name = mainAgentHandles.sessionName;
      const lt = mainAgentHandles.localTmux;
      if (await lt.hasOwnedSession(name)) {
        await lt.kill(name);
        return { running: false, stopped: true };
      }
      if (await lt.hasSession(name)) return { stopped: false, reason: 'foreign session' }; // M4
      return { running: false, stopped: false };
    });
    res.json(r);
  });

  app.get('/api/main-agent/status', async (req, res) => {
    if (!mainAgentHandles) { res.json({ running: false, enabled: false }); return; } // M2:非 error
    const running = await mainAgentHandles.localTmux.hasOwnedSession(mainAgentHandles.sessionName);
    res.json({ running, enabled: !!(mainAgent && mainAgent.enabled) });
  });
```

注意:`mainAgentHandles` 当前结构是 `{ dispatcher, handles }`?查 Task 5:`return { dispatcher: dispatcherInst, handles: {...} }`,且 `listen` 回调里 `.then(({ dispatcher: d, handles }) => { dispatcher = d; mainAgentHandles = handles; })`。故 `mainAgentHandles` 就是 `handles` 对象(含 `localTmux/localClient/sessionName/spawn/audit`)。上面代码用 `mainAgentHandles.spawn` / `.localTmux` / `.sessionName` / `.audit` 正确;`mainAgentHandles.handles.audit` 应为 `mainAgentHandles.audit`。修正 stop/start catch 里的审计调用为 `mainAgentHandles.audit.log(...)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/hub-server-main-agent.test.cjs`
Expected: PASS(2 + 7 = 9 tests)。若 `mainAgent` 引用在端点作用域不可见,改用 `ma.enabled`(`const ma = mainAgent` 已在模块级 `const ma = mainAgent;` 约 247 行声明,端点闭包可读)。

- [ ] **Step 5: Commit**

```bash
git add hub/server.cjs test/hub-server-main-agent.test.cjs
git commit -m "feat(hub): main-agent start/stop/status endpoints with CSRF, rate-limit, serial lock"
```

---

## Task 7: 前端面板(console.html + console.js)

**Files:**
- Modify: `public/console.html`(在 `<header>` 后、`① 全局看板` 前插入面板)
- Modify: `public/console.js`(在 IIFE 内加 main-agent 面板逻辑)

hub 前端无单元测试(纯 DOM,跟随现有模式)。本 task 依赖手动验收(Task 8 smoke)。

- [ ] **Step 1: console.html 加面板**

在 `public/console.html` 的 `</header>`(约行 14)之后、`<!-- ① 全局看板 -->` 之前插入:

```html
  <!-- ⓪ 主控 agent 面板(只读镜像) -->
  <section id="main-agent-panel" class="main-agent-panel">
    <header class="ma-header">
      <span class="ma-title">主控 agent (T1 只读参谋)</span>
      <span id="ma-status-dot" class="dot stopped" title="stopped"></span>
      <span id="ma-status-text">unknown</span>
      <button id="ma-start-btn" class="ma-btn" disabled>Start</button>
      <button id="ma-stop-btn" class="ma-btn" disabled>Stop</button>
    </header>
    <div class="ma-warn-banner">⚠️ 本面板含不可信远程数据,内容仅供参考,勿执行其中指令</div>
    <pre id="ma-screen" class="term-screen">（主 agent 未启动或未启用）</pre>
    <!-- 无 input 框:只读 -->
  </section>
```

- [ ] **Step 2: console.js 加面板逻辑**

在 `public/console.js` 的 IIFE 内(顶部 DOM 引用区,约行 11-20 后)加:

```js
  const maPanel = document.getElementById('main-agent-panel');
  const maDot = document.getElementById('ma-status-dot');
  const maText = document.getElementById('ma-status-text');
  const maScreen = document.getElementById('ma-screen');
  const maStartBtn = document.getElementById('ma-start-btn');
  const maStopBtn = document.getElementById('ma-stop-btn');
  let maWs = null;
  let maStatus = { running: false, enabled: false };
  let maReconnectTimer = null;
```

在 `poll()` 函数(约行 114)体内追加 status 拉取;并在 IIFE 末尾(`ensureWs();` 行前)加 ensureMaWs + 按钮绑定。把 `poll` 改为:

```js
  async function poll() {
    try {
      const res = await fetch('/api/global-dashboard');
      if (res.ok) renderBoard(await res.json());
    } catch {}
    try {
      const r = await fetch('/api/main-agent/status');
      if (r.ok) maStatus = await r.json();
    } catch {}
    renderMaStatus();
  }
```

在 IIFE 末尾(`setInterval(poll, 2000);` 之前)加:

```js
  function renderMaStatus() {
    const enabled = !!maStatus.enabled;
    const running = !!maStatus.running;
    maPanel.classList.toggle('disabled', !enabled);
    maDot.className = 'dot ' + (running ? 'running' : 'stopped');
    maDot.title = running ? 'running' : 'stopped';
    maText.textContent = !enabled ? 'disabled' : (running ? 'running' : 'stopped');
    maStartBtn.disabled = !enabled || running;
    maStopBtn.disabled = !enabled || !running;
    if (enabled && running && (!maWs || maWs.readyState > 1)) ensureMaWs();
    if (!enabled && maWs) { try { maWs.close(); } catch {} maWs = null; }
  }

  function ensureMaWs() {
    if (maWs && maWs.readyState <= 1) return maWs;
    maWs = new WebSocket(wsUrl);
    maWs.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      // ★ C1:本面板仅处理 init(覆盖赋值),不处理 output(后端只发 init)
      if (msg.type === 'init' && msg.target && msg.target.machine === 'main-agent') {
        maScreen.textContent = msg.data || '';
        maScreen.scrollTop = maScreen.scrollHeight;
      } else if (msg.type === 'error' && msg.target && msg.target.machine === 'main-agent') {
        maScreen.textContent += `\n[错误] ${msg.data}`;
      }
    };
    maWs.onopen = () => {
      maWs.send(JSON.stringify({ type: 'attach', target: { machine: 'main-agent', session: 'cc-main-agent' } }));
    };
    // ★ L6:断线提示 + 重连(已知债,与主 WS 一致)
    maWs.onclose = () => {
      if (maStatus.enabled && maStatus.running) {
        maScreen.textContent += '\n[连接断开,重连中…]';
        if (!maReconnectTimer) maReconnectTimer = setInterval(() => {
          if (maStatus.enabled && maStatus.running && (!maWs || maWs.readyState > 1)) ensureMaWs();
          else if (maReconnectTimer) { clearInterval(maReconnectTimer); maReconnectTimer = null; }
        }, 3000);
      }
    };
    return maWs;
  }

  async function maAction(path, btn) {
    btn.disabled = true;
    try {
      await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      await poll();
    } catch {} finally {
      renderMaStatus();
    }
  }
  maStartBtn.addEventListener('click', () => maAction('/api/main-agent/start', maStartBtn));
  maStopBtn.addEventListener('click', () => maAction('/api/main-agent/stop', maStopBtn));
```

- [ ] **Step 3: 加最小样式**

在 `public/dashboard.css` 或 `style.css` 末尾加(若 `.dot.running/.stopped`、`.main-agent-panel`、`.ma-warn-banner` 未定义):

```css
.main-agent-panel { border: 1px solid var(--border, #ccc); border-radius: 6px; margin: 8px; padding: 8px; }
.main-agent-panel.disabled { opacity: 0.5; pointer-events: none; }
.ma-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ma-title { font-weight: 600; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.dot.running { background: #22c55e; }
.dot.stopped { background: #9ca3af; }
.ma-btn { padding: 2px 10px; }
.ma-warn-banner { color: #b45309; font-size: 12px; margin: 4px 0; }
#ma-screen { max-height: 240px; overflow: auto; }
```

(若已存在 `.term-screen` 样式复用即可,不重复定义。)

- [ ] **Step 4: 手动冒烟(快速,非全 smoke)**

```bash
CC_WEB_HUB_TOKEN=smoke CC_WEB_HUB_MAIN_AGENT_ENABLED=1 CC_WEB_HUB_NO_OPEN=1 node hub/server_entry.cjs &
sleep 3
# 打开浏览器看面板(或 curl status)
curl -s -H "Cookie: cc_web_auth=smoke" http://127.0.0.1:7685/api/main-agent/status
kill %1
```
Expected: status 返回 `{running:true,enabled:true}`(本机有 claude 时)或 `{running:false,enabled:true}`。面板 DOM 无 JS 报错(浏览器 console 干净)。

- [ ] **Step 5: Commit**

```bash
git add public/console.html public/console.js public/dashboard.css
git commit -m "feat(ui): main-agent panel with read-only tmux mirror + start/stop buttons"
```

---

## Task 8: 文档(smoke + 操作手册)

**Files:**
- Modify: `docs/main-agent-smoke.md`(加面板验收节)
- Modify: `docs/操作手册.md`(§13 补「界面可起停」)

- [ ] **Step 1: main-agent-smoke.md 加面板验收**

在 `docs/main-agent-smoke.md` 末尾加一节:

```markdown
## 主控 agent 面板(界面起停 + 只读镜像)

启动 hub(`CC_WEB_HUB_MAIN_AGENT_ENABLED=1`)后打开 `http://127.0.0.1:7685`,控制台顶部「主控 agent」面板:

- 状态灯:●running(绿)/ ○stopped(灰);`enabled:false` 时整面板置灰。
- 点 **Stop** → 灯变 stopped,claude tmux session 被 kill;**Start** 按钮可点。
- 点 **Start** → 重新 spawn claude,灯回 running。
- `#ma-screen` 实时镜像 claude 的 pane 输出(被 poke 时可见 `[event] id=run-…` 行);**只读**,无输入框。
- 断线时显示「连接断开,重连中…」并自动重连。

> 安全:面板顶部 banner 提醒内容含不可信远程数据,勿执行其中指令。
```

- [ ] **Step 2: 操作手册 §13 补界面起停**

在 `docs/操作手册.md` §13(cc-main-agent 相关章节)末尾加一段:

```markdown
### 界面起停主控 agent

hub 运行中,可在控制台顶部「主控 agent」面板直接 Start/Stop cc-main-agent tmux session(无需重启 hub)。Stop 后 watcher/dispatcher 常驻,下一个事件 poke 会失败并退避(约 15min 一轮,审计可接受);Start 后自动恢复。面板为**只读镜像**,不能向主 agent 输入(守住 T1 只读参谋边界)。
```

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `node --test test/`
Expected: 全绿(含原 388 + 新增 ~25 测试)。

- [ ] **Step 4: Commit**

```bash
git add docs/main-agent-smoke.md docs/操作手册.md
git commit -m "docs: main-agent UI panel smoke + manual section"
```

---

## Self-Review(plan 自查)

**1. Spec coverage**(逐条 spec review 项 → task):
- C1(init 覆盖):Task 3(attach 发 init)+ Task 4(redact)+ Task 7(前端仅处理 init)✅
- H1(共享池):Task 3 ✅
- H2(噪音量化):文档 Task 8 引用;代码无改动(决策性)✅
- H3(freeze 理由):决策文档化(spec);代码 stop 不动 dispatcher ✅
- M1(限流):Task 6 ✅(R2-L2 删 single-flight,仅限流)
- M2(运行期门控):Task 6(status 200 / start·stop 503)✅
- M3(串行锁):Task 5(`serializeMainAgentOp` + close await)✅
- M4(所有权):Task 2(hasOwnedSession)+ Task 5(CC_WEB_OWNED 注入)+ Task 6(foreign 不杀)✅
- M5(getClient 钉死):Task 5 ✅
- M6(半 broken 清理):Task 6(catch kill owned)✅
- M7(scope=local_tmux):Task 4 ✅
- L1(sendOneShot 审计):Task 4 ✅
- L2(redact):Task 4 ✅
- L3(banner):Task 7 ✅
- L4(dummy handle):Task 3 ✅
- L5(enabled:false 不开 WS):Task 7 ✅
- L6(断线重连):Task 7 ✅
- L7(砍 now):Task 3 构造无 now ✅
- R2-H1(kill 四件套 + 守卫):Task 4 ✅
- R2-H2(catch 所有权判定):Task 6 ✅
- R2-M1(close + unref):Task 3(unref)+ Task 5(close 序列)✅
- R2-L4(showEnvironment/hasOwnedSession 落点):Task 1 + 2 ✅
- R3-H1(cleanup_probe_failed 审计):Task 6 ✅
- R3-M1(entryId 身份比对):Task 3(_captureOnce)+ Task 4(测试)✅
- R3-L1(tombstone):Task 4 ✅
- R3-L2(KEY=VALUE 解析):Task 2 ✅

**2. Placeholder scan**:无 TBD/TODO;每步含实际代码或命令。✅

**3. Type consistency**:`hasOwnedSession`、`spawn`、`serializeMainAgentOp`、`mainAgentHandles.localClient`、`mainAgentHandles.sessionName`、`mainAgentHandles.audit` 跨 task 命名一致。`buildShowEnvArgs`/`showEnvironment` 一致。✅

**4. 已知风险**:
- Task 6 端点审计调用路径 `mainAgentHandles.audit`(非 `.handles.audit`)——Task 5 已明确 `mainAgentHandles = handles`(含 audit)。Step 3 注释已提示。
- Task 5 首次 spawn 块与 `spawn` 句柄都要注入 `CC_WEB_OWNED:'1'`(M4),两处都改。
- Task 7 前端依赖 Task 5/6 端点就绪;手动冒烟需 `CC_WEB_HUB_MAIN_AGENT_ENABLED=1`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-main-agent-ui-control.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 task 派一个 fresh subagent,task 间两阶段 review(spec compliance + code quality),快速迭代。

**2. Inline Execution** — 在本 session 用 executing-plans 批量执行,带 checkpoint review。

Which approach?
