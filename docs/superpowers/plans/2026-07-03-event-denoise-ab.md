# 事件去噪 v2(A+B 轻量协同)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让持续未恢复的 errored/idle 不再每 60s 反复烧 claude —— EventWatcher 指数退避(A)+ AgentDispatcher `lastLine` 签名去重(B),双反馈环咬合(NOOP 加速退避 / 签名变重置退避)。run-61246:40→2、0 漏报。

**Architecture:** A 在 EventWatcher 层做时间退避(`emitCount` + `_backoffMs`);B 在 AgentDispatcher 层做内容去重(`_sig` + `_repeat` Map + sig-gate enqueue);dispatcher 通过 `onStaleAck`/`onProblemChanged` 回调反馈 watcher 的 `emitCount`。纯 hub 侧调度,不碰 claude 工具集。

**Tech Stack:** Node.js · `node --test`(同步)· CommonJS(`.cjs`)· 无新依赖。

> **关联 spec**:[2026-07-03-event-denoise-ab-design.md](../specs/2026-07-03-event-denoise-ab-design.md)。所有参数默认值以 spec §13 决策为准:`maxSettleMs=900_000`、`rePokeAfterMs=900_000`、`backoffBase=2`、`staleBump=1`、`resolveMs=7_200_000`。

> **⚠️ 项目 commit 规则(覆盖 skill 的 frequent-commits 默认)**:仅在用户明确要求时才 commit/push;当前在 `main` 分支,用户要求提交时**先建分支**。下方各 Task 末尾的 commit 步骤是 TDD 流程示意 —— 执行时若用户未要求提交,则跳过 commit、改动留工作区,继续下一 Task。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `hub/agent_dispatcher.cjs` | 改 | +`_sig`/`classifyOutcome` 纯函数;+`_repeat` Map;enqueue 前置 sig-gate,原队列管理抽 `_realEnqueue`;+`_gcRepeat`;ack 回填+正向反馈;构造参数 `onStaleAck`/`onProblemChanged`/`rePokeAfterMs`/`resolveMs` |
| `hub/event_watcher.cjs` | 改 | counter 增 `emitCount`;emit 条件用 `_backoffMs(emitCount)`;+`_backoffMs`/`markStale`/`markProblemChanged`;构造参数 `maxSettleMs`/`backoffBase`/`staleBump` |
| `hub/main_agent_env.cjs` | 改 | +解析 `CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS`/`_BACKOFF_BASE`/`_STALE_BUMP`/`_SETTLE_MS`(带默认) |
| `hub/server.cjs` | 改 | `setupMainAgent` 内 watcher 上移到 dispatcher 前;dispatcher 注入双回调 + `rePokeAfterMs` |
| `hub/main_agent_config.cjs` | 改 | `genPrompt()` 系统提示增 NOOP 前缀约定段 |
| `test/hub-agent-dispatcher-sig.test.cjs` | 新增 | `_sig`/`classifyOutcome`/sig-gate/ack 反馈用例 |
| `test/hub-event-watcher-backoff.test.cjs` | 新增 | 退避时间序列/markStale/markProblemChanged/封顶/recover 用例 |
| `docs/操作手册.md` | 改 | §13.3 工作原理补"指数退避 + 签名去重"段 |
| `docs/main-agent-smoke.md` | 改 | 审计序列补 `repeat_suppressed` |

**回归保护(关键)**:现有 `test/hub-agent-dispatcher.test.cjs` 的 `ev()` 用 `lastLine:'x'` → `_sig('x')` 返回 `null`(短行保守放行),sig-gate 不影响现有 enqueue/ack/poke/timeout/优先级/队列满/freeze 用例;现有 `test/hub-event-watcher.test.cjs` 用 `settleMs:0` → `_backoffMs(k)=0`,退避改动不破坏现有 threshold 去抖用例。每个 Task 后跑全量 `node --test test/*.test.cjs` 确认绿。

---

## Task 1:`_sig` + `classifyOutcome` 纯函数(agent_dispatcher.cjs)

**Files:**
- Modify: `hub/agent_dispatcher.cjs`(PRIORITY 常量后、`class AgentDispatcher` 前插入两个函数;改 `module.exports`)
- Test: `test/hub-agent-dispatcher-sig.test.cjs`(新建)

- [ ] **Step 1: 写失败测试**

新建 `test/hub-agent-dispatcher-sig.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _sig, classifyOutcome } = require('../hub/agent_dispatcher.cjs');

// --- _sig 规约(对应 spec §6)---
test('_sig: 剥 ISO 时间戳/run-id/孤立数字,折叠空白,小写', () => {
  assert.equal(_sig('Error 503 at 2026-07-03T10:22:31Z run-61246'), 'error at');
  assert.equal(_sig('Error 503 at 2026-07-03T10:23:02Z run-61247'), 'error at'); // 同一签名
});

test('_sig: 孤立数字(行号/计数)被剥', () => {
  assert.equal(_sig('panic: nil pointer at line 42'), 'panic: nil pointer at line');
  assert.equal(_sig('panic: segfault at line 88'), 'panic: segfault at line');
});

test('_sig: 不同症状产生不同签名(nil pointer ≠ segfault)', () => {
  assert.notEqual(_sig('panic: nil pointer at line 42'), _sig('panic: segfault at line 88'));
});

test('_sig: 短行(length<4)→ null(保守放行不抑制)', () => {
  assert.equal(_sig('ok'), null);
  assert.equal(_sig('hi'), null);
  assert.equal(_sig('err'), null);
});

test('_sig: 空串/非 string → null', () => {
  assert.equal(_sig(''), null);
  assert.equal(_sig(null), null);
  assert.equal(_sig(undefined), null);
  assert.equal(_sig(123), null);
});

test('_sig: unix 时间戳(10-13 位)被剥', () => {
  assert.equal(_sig('failed at 1751543051'), 'failed at');
});

// --- classifyOutcome 规约 ---
test('classifyOutcome: noop 前缀(大小写不敏感)', () => {
  assert.equal(classifyOutcome('NOOP: 同一 503 持续'), 'noop');
  assert.equal(classifyOutcome('noop nothing new'), 'noop');
});

test('classifyOutcome: advised 前缀', () => {
  assert.equal(classifyOutcome('advised: 重启 agent'), 'advised');
});

test('classifyOutcome: 其余/空 → unknown', () => {
  assert.equal(classifyOutcome('建议重启'), 'unknown');
  assert.equal(classifyOutcome(''), 'unknown');
  assert.equal(classifyOutcome(null), 'unknown');
  assert.equal(classifyOutcome(undefined), 'unknown');
});
```

- [ ] **Step 2: 跑测试,确认 RED**

Run: `node --test test/hub-agent-dispatcher-sig.test.cjs`
Expected: FAIL —— `_sig`/`classifyOutcome` 不是从 `../hub/agent_dispatcher.cjs` 导出的( `TypeError: _sig is not a function` 或导入为 `undefined`)。

- [ ] **Step 3: 写最小实现**

在 `hub/agent_dispatcher.cjs` 的 `const PRIORITY = { ... };` 之后、`class AgentDispatcher {` 之前插入:

```js
/**
 * 归一化 lastLine 为「内容签名」,用于判断是否同一问题的重复。
 * 剥时间戳/run-id/孤立数字 → 折叠空白 → 小写。保守:空/太短(<4)返回 null = 不抑制。
 */
function _sig(lastLine) {
  if (typeof lastLine !== 'string' || lastLine.length === 0) return null;
  const s = lastLine
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '') // ISO 时间戳
    .replace(/\d{10,13}/g, '')           // unix 时间戳(s/ms)
    .replace(/run-\d+/g, '')             // run-id
    .replace(/\b\d+\b/g, '')             // 孤立数字(行号/计数/pid)
    .replace(/\s+/g, ' ')                // 折叠空白
    .trim()
    .toLowerCase();
  return s.length >= 4 ? s : null;
}

/** 把 ack outcome 文本归类为调度语义;仅前缀匹配,不解析内容。 */
function classifyOutcome(outcome) {
  if (typeof outcome !== 'string') return 'unknown';
  const s = outcome.trim().toLowerCase();
  if (s.startsWith('noop')) return 'noop';
  if (s.startsWith('advised')) return 'advised';
  return 'unknown';
}
```

改文件末尾导出:

```js
module.exports = { AgentDispatcher, PRIORITY, _sig, classifyOutcome };
```

- [ ] **Step 4: 跑测试,确认 GREEN**

Run: `node --test test/hub-agent-dispatcher-sig.test.cjs`
Expected: PASS(全用例)。

- [ ] **Step 5: 回归**

Run: `node --test test/hub-agent-dispatcher.test.cjs test/hub-event-watcher.test.cjs`
Expected: PASS(导出新增不影响现有用例)。

- [ ] **Step 6: Commit(仅当用户要求)**

```bash
# 仅当用户明确要求提交时执行;当前在 main,先建分支:
# git checkout -b feat/event-denoise-ab
# git add hub/agent_dispatcher.cjs test/hub-agent-dispatcher-sig.test.cjs
# git commit -m "feat(dispatcher): 加 _sig/classifyOutcome 纯函数(事件去噪 B 层)"
```

---

## Task 2:EventWatcher 退避(emitCount + _backoffMs + emit 条件)

**Files:**
- Modify: `hub/event_watcher.cjs`(构造参数、`_counters` value、`_tick` emit 块、新增 `_backoffMs`)
- Test: `test/hub-event-watcher-backoff.test.cjs`(新建)

- [ ] **Step 1: 写失败测试**

新建 `test/hub-event-watcher-backoff.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventWatcher } = require('../hub/event_watcher.cjs');

const snap = (machines) => ({ machines });
const errored = (id = 'm1', s = 's1', lastLine = 'boom') =>
  snap([{ id, online: true, sessions: [{ name: s, status: 'errored', lastLine }] }]);

// 用注入时钟控制 now,避免依赖真实 setInterval。
function makeWatcher({ settleMs = 60_000, maxSettleMs = 900_000, backoffBase = 2 } = {}) {
  let now = 1_000_000;
  const emitted = [];
  let latest = snap([]);
  const w = new EventWatcher({ getLatest: () => latest, intervalMs: 1000, threshold: 1, settleMs, maxSettleMs, backoffBase });
  w.on('event', (e) => emitted.push(e));
  return {
    w, emitted,
    setLatest(v) { latest = v; },
    advance(ms) { now += ms; },
    tick() { /* _tick 用 Date.now();这里借 runInBand 走真实时钟会复杂,改用下述 direct 调用 */ },
    get now() { return now; },
  };
}
```

> ⚠️ 注意:`_tick()` 内部用 `Date.now()`。为可测,本 Task 同时给 EventWatcher 增加可选的 `now` 注入(见 Step 3 实现的 `_now()`)。测试用注入时钟驱动。

替换上面的 helper,改用注入 `now`:

```js
function makeWatcher({ settleMs = 60_000, maxSettleMs = 900_000, backoffBase = 2 } = {}) {
  let now = 1_000_000;
  const emitted = [];
  let latest = snap([]);
  const w = new EventWatcher({
    getLatest: () => latest, intervalMs: 1000, threshold: 1, settleMs, maxSettleMs, backoffBase,
    now: () => now,
  });
  w.on('event', (e) => emitted.push({ at: now, emitCount: e.emitCount }));
  return {
    w, emitted,
    setLatest(v) { latest = v; },
    advance(ms) { now += ms; },
  };
}

test('退避序列:settleMs→2×→4×… 封顶 maxSettleMs', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000, maxSettleMs: 900_000, backoffBase: 2 });
  setLatest(errored());
  // threshold=1:每轮 n=1>=threshold;emit 由 backoff 门控
  w._tick();                          // t0: 首次 emit(emitCount 0→1)
  assert.equal(emitted.length, 1);
  advance(59_000); w._tick();         // <backoffMs(1)=60s → 不 emit
  assert.equal(emitted.length, 1);
  advance(1_000); w._tick();          // =60s → emit(emitCount 1→2)
  assert.equal(emitted.length, 2);
  advance(120_000); w._tick();        // backoffMs(2)=120s → emit(2→3)
  assert.equal(emitted.length, 3);
  advance(240_000); w._tick();        // backoffMs(3)=240s → emit(3→4)
  assert.equal(emitted.length, 4);
  advance(960_000); w._tick();        // backoffMs(4)=min(480,封顶900)=480 → 已过960s → emit(4→5)
  assert.equal(emitted.length, 5);
  advance(900_000); w._tick();        // 封顶:backoffMs(5)=min(960,900)=900 → emit(5→6)
  assert.equal(emitted.length, 6);
});

test('状态切换重置 emitCount(idle→errored 从 settleMs 重新退避)', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000 });
  setLatest(snap([{ id: 'm1', online: true, sessions: [{ name: 's1', status: 'idle' }] }]));
  w._tick(); advance(60_000); w._tick();   // idle emit 两次,emitCount=2
  assert.equal(emitted.length, 2);
  setLatest(errored());                     // 切 errored
  w._tick();                                // 状态切换 → emitCount 重置;threshold=1 + now-lastEmitTs 可能<settleMs
  // 切换后首见:若距上次 emit 不足 settleMs,本轮不 emit(emitCount 已重置为 0)
  advance(60_000); w._tick();               // 过 settleMs → emit(emitCount 0→1)
  assert.equal(emitted.at(-1).emitCount, 1);
});

test('recover(会话消失)→ counter 删除;复发重置 emitCount', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000 });
  setLatest(errored());
  w._tick(); advance(60_000); w._tick();   // emit 两次,emitCount=2
  setLatest(snap([]));                       // 消失
  w._tick();                                 // recover → counter 删除
  advance(60_000);
  setLatest(errored());                      // 复发
  w._tick();                                 // 新 counter emitCount=0
  advance(60_000); w._tick();                // emit(emitCount 0→1)
  assert.equal(emitted.at(-1).emitCount, 1);
});
```

- [ ] **Step 2: 跑测试,确认 RED**

Run: `node --test test/hub-event-watcher-backoff.test.cjs`
Expected: FAIL —— 构造不识别 `maxSettleMs`/`backoffBase`/`now`;emit 无 `emitCount` 字段;固定 `settleMs` 门控。

- [ ] **Step 3: 写最小实现**

改 `hub/event_watcher.cjs` 构造函数:

```js
  constructor({ getLatest, intervalMs = 2000, threshold = 3, settleMs = 60_000,
                maxSettleMs = 900_000, backoffBase = 2, staleBump = 1, now } = {}) {
    super();
    if (typeof getLatest !== 'function') throw new Error('EventWatcher: getLatest required');
    this._getLatest = getLatest;
    this._intervalMs = intervalMs;
    this._threshold = threshold;
    this._settleMs = settleMs;
    this._maxSettleMs = maxSettleMs;
    this._backoffBase = backoffBase;
    this._staleBump = staleBump;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._counters = new Map(); // key -> { status, n, lastEmitTs, emitCount }
    this._timer = null;
  }
```

新增 `_backoffMs`(放在 `start()` 前):

```js
  _backoffMs(k) {
    return Math.min(this._settleMs * Math.pow(this._backoffBase, k), this._maxSettleMs);
  }
```

改 `_tick`(用 `this._now()`、counter 增 `emitCount`、emit 条件换 `_backoffMs`、emit 事件带 `emitCount`):

```js
  _tick() {
    const snap = this._getLatest() || { machines: [] };
    const now = this._now();
    const seen = new Set();
    for (const sm of sampleWatched(snap)) {
      const key = `${sm.machine}|${sm.session}`;
      seen.add(key);
      let c = this._counters.get(key);
      if (!c || c.status !== sm.status) c = { status: sm.status, n: 0, lastEmitTs: c ? c.lastEmitTs : 0, emitCount: 0 };
      c.n += 1;
      this._counters.set(key, c);
      if (c.n >= this._threshold && now - c.lastEmitTs >= this._backoffMs(c.emitCount)) {
        c.lastEmitTs = now;
        c.emitCount += 1;
        this.emit('event', { machine: sm.machine, session: sm.session, to: sm.status, from: null, lastLine: sm.lastLine, lastTs: sm.lastTs, ts: now, emitCount: c.emitCount });
      }
    }
    for (const k of this._counters.keys()) if (!seen.has(k)) this._counters.delete(k);
  }
```

- [ ] **Step 4: 跑测试,确认 GREEN**

Run: `node --test test/hub-event-watcher-backoff.test.cjs`
Expected: PASS。

- [ ] **Step 5: 回归**

Run: `node --test test/hub-event-watcher.test.cjs`
Expected: PASS(`settleMs:0` → `_backoffMs=0`,现有 threshold 去抖用例不变)。

- [ ] **Step 6: Commit(仅当用户要求)**

```bash
# git add hub/event_watcher.cjs test/hub-event-watcher-backoff.test.cjs
# git commit -m "feat(event-watcher): emitCount 指数退避(事件去噪 A 层)"
```

---

## Task 3:EventWatcher `markStale` / `markProblemChanged`

**Files:**
- Modify: `hub/event_watcher.cjs`(新增两方法)
- Test: `test/hub-event-watcher-backoff.test.cjs`(追加用例)

- [ ] **Step 1: 写失败测试(追加到 backoff 测试文件)**

```js
test('markStale: emitCount += staleBump(加速退避)', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000, staleBump: 1 });
  setLatest(errored());
  w._tick();                          // emit(emitCount 0→1)
  advance(60_000); w._tick();         // emit(1→2)
  assert.equal(emitted.length, 2);
  w.markStale('m1', 's1');            // emitCount 2→3,下次要等 backoffMs(3)=240s
  advance(120_000); w._tick();        // 距上次 120s < 240s → 不 emit
  assert.equal(emitted.length, 2);
  advance(120_000); w._tick();        // =240s → emit(3→4)
  assert.equal(emitted.length, 3);
});

test('markProblemChanged: emitCount=0(下次按 settleMs)', () => {
  const { w, emitted, setLatest, advance } = makeWatcher({ settleMs: 60_000 });
  setLatest(errored());
  w._tick(); advance(60_000); w._tick(); advance(120_000); w._tick();  // emitCount=3
  assert.equal(emitted.length, 3);
  w.markProblemChanged('m1', 's1');   // emitCount=0
  advance(60_000); w._tick();         // backoffMs(0)=settleMs=60s → emit(0→1)
  assert.equal(emitted.length, 4);
  assert.equal(emitted.at(-1).emitCount, 1);
});

test('markStale/markProblemChanged: 未知 key 静默忽略(不抛错)', () => {
  const { w } = makeWatcher();
  assert.doesNotThrow(() => w.markStale('nope', 'nope'));
  assert.doesNotThrow(() => w.markProblemChanged('nope', 'nope'));
});
```

- [ ] **Step 2: 跑测试,确认 RED**

Run: `node --test test/hub-event-watcher-backoff.test.cjs`
Expected: 新用例 FAIL(`markStale`/`markProblemChanged` 不是函数)。

- [ ] **Step 3: 写最小实现**

在 `hub/event_watcher.cjs` 的 `_backoffMs` 之后插入:

```js
  /** 正向反馈:claude 标记陈旧重复 → 退避加速(emitCount += staleBump,不动 lastEmitTs)。 */
  markStale(machine, session) {
    const c = this._counters.get(`${machine}|${session}`);
    if (c) c.emitCount += this._staleBump;
  }

  /** 反向反馈:签名变化(新症状)→ emitCount 归零,从浅退避重新开始。 */
  markProblemChanged(machine, session) {
    const c = this._counters.get(`${machine}|${session}`);
    if (c) c.emitCount = 0;
  }
```

- [ ] **Step 4: 跑测试,确认 GREEN**

Run: `node --test test/hub-event-watcher-backoff.test.cjs`
Expected: PASS(全用例)。

- [ ] **Step 5: 回归 + Commit(仅当用户要求)**

Run: `node --test test/*.test.cjs` → PASS。
```bash
# git add hub/event_watcher.cjs test/hub-event-watcher-backoff.test.cjs
# git commit -m "feat(event-watcher): markStale/markProblemChanged 双反馈入口"
```

---

## Task 4:AgentDispatcher sig-gate enqueue + `_repeat` + `_realEnqueue` + `_gcRepeat`

**Files:**
- Modify: `hub/agent_dispatcher.cjs`(构造参数、`_repeat`、`enqueue` 重构、新增 `_realEnqueue`/`_gcRepeat`)
- Test: `test/hub-agent-dispatcher-sig.test.cjs`(追加用例)

- [ ] **Step 1: 写失败测试(追加到 sig 测试文件)**

```js
const { AgentDispatcher } = require('../hub/agent_dispatcher.cjs');
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
function stubTmux() { const pokes = []; return { pokes, poke: async (s, msg) => { pokes.push(msg); } }; }
function memAudit() { const entries = []; return { entries, log: async (e) => { entries.push(e); return e; } }; }
const ev = (session, lastLine, to = 'errored') => ({ machine: 'm', session, to, lastLine });

test('sig-gate: 首见 sig → poke + 建 repeater', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246'));
  await tick();
  assert.equal(tmux.pokes.length, 1);
  assert.ok(d._repeat.has('m|s1'));
});

test('sig-gate: sig 相同 + 未到 rePokeAfterMs → 不 poke,审计 repeat_suppressed', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:23:02Z run-61247')); await tick(); // 同 sig
  assert.equal(tmux.pokes.length, 1);
  assert.ok(audit.entries.some((e) => e.event === 'repeat_suppressed'));
});

test('sig-gate: sig 相同 + 到 rePokeAfterMs → poke(定期重看)', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 1 }); // 1ms 极易到期
  d.enqueue(ev('s1', 'panic: nil pointer at line 42')); await tick();
  await tick(5);
  d.enqueue(ev('s1', 'panic: nil pointer at line 99')); await tick(); // 同 sig,已到期
  assert.equal(tmux.pokes.length, 2);
});

test('sig-gate: sig 变化 → poke + onProblemChanged 回调 + repeater.sig 更新', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const changed = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000,
    onProblemChanged: (m, s) => { changed.push(`${m}/${s}`); } });
  d.enqueue(ev('s1', 'panic: nil pointer at line 42')); await tick();
  d.enqueue(ev('s1', 'panic: segfault at line 88')); await tick(); // 不同 sig
  assert.equal(tmux.pokes.length, 2);
  assert.deepEqual(changed, ['m/s1']);
  assert.equal(d._repeat.get('m|s1').sig, 'panic: segfault at line');
});

test('sig-gate: sig=null(短行/空)→ 放行不抑制', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'x')); await tick();
  d.enqueue(ev('s1', 'x')); await tick(); // 短行 → null → 放行
  assert.equal(tmux.pokes.length, 2);
  assert.equal(d._repeat.size, 0); // null 不建 repeater
});

test('_gcRepeat: 超 resolveMs 的 repeater 被清', () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, resolveMs: 1 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246'));
  return (async () => {
    await tick(5);
    d.enqueue(ev('s2', 'another error here')); // 触发 _gcRepeat,s1 已超 resolveMs=1
    assert.equal(d._repeat.has('m|s1'), false);
    assert.equal(d._repeat.has('m|s2'), true);
  })();
});
```

- [ ] **Step 2: 跑测试,确认 RED**

Run: `node --test test/hub-agent-dispatcher-sig.test.cjs`
Expected: 新用例 FAIL(构造不识别 `onProblemChanged`/`rePokeAfterMs`/`resolveMs`;无 `_repeat`;enqueue 未 sig-gate)。

- [ ] **Step 3: 写最小实现**

改 `hub/agent_dispatcher.cjs` 构造函数(新增参数 + `_repeat`):

```js
  constructor({
    tmux, audit, session = 'cc-main-agent',
    pokeText = (runId) => `[event] id=${runId} new event; call dequeue_event then ack_event`,
    ackTimeoutMs = 5 * 60 * 1000, maxRetries = 2, maxQueue = 20,
    onStaleAck = null, onProblemChanged = null,
    rePokeAfterMs = 900_000, resolveMs = 2 * 60 * 60 * 1000,
  } = {}) {
    if (!tmux) throw new Error('AgentDispatcher: tmux required');
    if (!audit) throw new Error('AgentDispatcher: audit required');
    this._tmux = tmux;
    this._audit = audit;
    this._session = session;
    this._pokeText = pokeText;
    this._ackTimeoutMs = ackTimeoutMs;
    this._maxRetries = maxRetries;
    this._maxQueue = maxQueue;
    this._onStaleAck = onStaleAck;
    this._onProblemChanged = onProblemChanged;
    this._rePokeAfterMs = rePokeAfterMs;
    this._resolveMs = resolveMs;
    this._queue = [];
    this._current = null;
    this._runCounter = 0;
    this._frozen = false;
    this._repeat = new Map(); // key -> { sig, lastPokeTs, lastOutcome }
  }
```

把现有 `enqueue(...)` 方法体替换为 sig-gate + 抽出的 `_realEnqueue`;新增 `_gcRepeat`:

```js
  enqueue(event) {
    if (this._frozen) return false;
    this._gcRepeat();
    const key = this._key(event);
    const sig = _sig(event.lastLine);
    if (sig === null) { this._realEnqueue(event); return true; } // 签名不可靠 → 保守放行
    const now = Date.now();
    const r = this._repeat.get(key);
    if (r === undefined) {
      this._repeat.set(key, { sig, lastPokeTs: now, lastOutcome: null });
      this._realEnqueue(event);
      return true;
    }
    if (r.sig !== sig) {
      this._repeat.set(key, { sig, lastPokeTs: now, lastOutcome: null });
      if (this._onProblemChanged) this._onProblemChanged(event.machine, event.session);
      this._realEnqueue(event);
      return true;
    }
    // sig 相同(旧问题)
    if (now - r.lastPokeTs >= this._rePokeAfterMs) {
      r.lastPokeTs = now;
      this._realEnqueue(event);
      return true;
    }
    this._audit.log({ scope: 'dispatcher', runId: null, event: 'repeat_suppressed', detail: { target: `${event.machine}/${event.session}`, sig } });
    return true;
  }

  /** 原队列管理(溢出处理 + 同 target 合并 + 优先级排序 + pump)。 */
  _realEnqueue(event) {
    if (this._queue.length >= this._maxQueue) {
      const idx = this._queue.findIndex((e) => this._key(e) === this._key(event));
      if (idx >= 0) this._queue.splice(idx, 1);
      else { this._queue.shift(); this._audit.log({ scope: 'dispatcher', runId: null, event: 'queue_overflow_drop', detail: { machine: event.machine, session: event.session } }); }
    }
    this._queue.push(event);
    this._queue.sort((a, b) => (PRIORITY[a.to] ?? 9) - (PRIORITY[b.to] ?? 9));
    this._pump();
  }

  /** 懒 GC:清理长期未再 poke 的 repeater,防内存增长。 */
  _gcRepeat() {
    const now = Date.now();
    for (const [k, r] of this._repeat) {
      if (now - r.lastPokeTs >= this._resolveMs) this._repeat.delete(k);
    }
  }
```

- [ ] **Step 4: 跑测试,确认 GREEN**

Run: `node --test test/hub-agent-dispatcher-sig.test.cjs`
Expected: PASS(全用例)。

- [ ] **Step 5: 回归**

Run: `node --test test/hub-agent-dispatcher.test.cjs`
Expected: PASS(`ev()` 的 `lastLine:'x'` → `_sig=null` → 走 `_realEnqueue`,现有 enqueue/poke/ack/timeout/优先级/队列满/freeze 行为不变)。

- [ ] **Step 6: Commit(仅当用户要求)**

```bash
# git add hub/agent_dispatcher.cjs test/hub-agent-dispatcher-sig.test.cjs
# git commit -m "feat(dispatcher): enqueue sig-gate + _repeat 去重(事件去噪 B 层)"
```

---

## Task 5:AgentDispatcher `ack` 回填 + `onStaleAck` 正向反馈

**Files:**
- Modify: `hub/agent_dispatcher.cjs`(`ack` 方法)
- Test: `test/hub-agent-dispatcher-sig.test.cjs`(追加用例)

- [ ] **Step 1: 写失败测试(追加)**

```js
test('ack: NOOP outcome → 触发 onStaleAck + 回填 lastOutcome', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const stale = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000,
    onStaleAck: (m, s) => { stale.push(`${m}/${s}`); } });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  const rid = d._current.runId;
  await d.ack(rid, 'NOOP: 同一 503,已建议过');
  assert.deepEqual(stale, ['m/s1']);
  assert.equal(d._repeat.get('m|s1').lastOutcome, 'NOOP: 同一 503,已建议过');
});

test('ack: advised outcome → 不触发 onStaleAck + 回填 lastOutcome', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const stale = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000,
    onStaleAck: () => { stale.push('x'); } });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  const rid = d._current.runId;
  await d.ack(rid, 'advised: 重启 agent');
  assert.equal(stale.length, 0);
  assert.equal(d._repeat.get('m|s1').lastOutcome, 'advised: 重启 agent');
});

test('ack: 未知 runId → ack_stale,不回填不反馈', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const stale = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000,
    onStaleAck: () => { stale.push('x'); } });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  await d.ack('run-bogus', 'NOOP: x');
  assert.equal(stale.length, 0);
  assert.ok(audit.entries.some((e) => e.event === 'ack_stale'));
});
```

- [ ] **Step 2: 跑测试,确认 RED**

Run: `node --test test/hub-agent-dispatcher-sig.test.cjs`
Expected: 新用例 FAIL(`ack` 不回填 `_repeat`、不调 `onStaleAck`)。

- [ ] **Step 3: 写最小实现**

替换 `hub/agent_dispatcher.cjs` 的 `ack` 方法:

```js
  async ack(runId, outcome) {
    const c = this._current;
    if (!c || c.runId !== runId) {
      await this._audit.log({ scope: 'dispatcher', runId, event: 'ack_stale', detail: { outcome } });
      return false;
    }
    // 回填 repeater(清理 _current 之前,以便取到 c.event)
    const key = this._key(c.event);
    const r = this._repeat.get(key);
    if (r) r.lastOutcome = outcome;
    // 正向反馈:claude 标记陈旧重复 → watcher 加速退避
    if (classifyOutcome(outcome) === 'noop' && this._onStaleAck) {
      this._onStaleAck(c.event.machine, c.event.session);
    }
    if (c.timer) clearTimeout(c.timer);
    await this._audit.log({ scope: 'dispatcher', runId: c.runId, event: 'ack', detail: { outcome } });
    this._current = null;
    this._pump();
    return true;
  }
```

- [ ] **Step 4: 跑测试,确认 GREEN**

Run: `node --test test/hub-agent-dispatcher-sig.test.cjs`
Expected: PASS(全用例)。

- [ ] **Step 5: 回归 + Commit(仅当用户要求)**

Run: `node --test test/*.test.cjs` → PASS。
```bash
# git add hub/agent_dispatcher.cjs test/hub-agent-dispatcher-sig.test.cjs
# git commit -m "feat(dispatcher): ack 回填 lastOutcome + NOOP 触发 onStaleAck 正向反馈"
```

---

## Task 6:`main_agent_env.cjs` + `server.cjs` 接线

**Files:**
- Modify: `hub/main_agent_env.cjs`(新增 4 个可选字段解析)
- Modify: `hub/server.cjs:256-257`(`setupMainAgent` 内 watcher 上移、dispatcher 注入双回调 + `rePokeAfterMs`)
- Test: 集成靠现有全量测试 + 手测(无新单测)

- [ ] **Step 1: 改 `main_agent_env.cjs`**

在 `resolveMainAgentConfig` 的 `return cfg;` 前插入(与现有 `if (env.X) cfg.y = …` 风格一致;数值用 `Number`,带默认兜底):

```js
  cfg.settleMs = env.CC_WEB_HUB_MAIN_AGENT_SETTLE_MS ? Number(env.CC_WEB_HUB_MAIN_AGENT_SETTLE_MS) : 60_000;
  cfg.maxSettleMs = env.CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS ? Number(env.CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS) : 900_000;
  cfg.backoffBase = env.CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE ? Number(env.CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE) : 2;
  cfg.staleBump = env.CC_WEB_HUB_MAIN_AGENT_STALE_BUMP ? Number(env.CC_WEB_HUB_MAIN_AGENT_STALE_BUMP) : 1;
```

同步更新 JSDoc `@returns` 补 `settleMs/maxSettleMs/backoffBase/staleBump`。

- [ ] **Step 2: 改 `server.cjs` 的 `setupMainAgent`(第 256-257 行)**

把 dispatcher 先 / watcher 后的顺序调换为 **watcher 先 / dispatcher 后**,并注入参数与回调:

```js
    const watcher = new EventWatcher({
      getLatest: () => aggregator.getLatest(),
      intervalMs,
      settleMs: ma.settleMs,
      maxSettleMs: ma.maxSettleMs,
      backoffBase: ma.backoffBase,
      staleBump: ma.staleBump,
    });
    const dispatcherInst = new AgentDispatcher({
      tmux: localTmux, audit, session: ma.session || 'cc-main-agent',
      onStaleAck: (m, s) => watcher.markStale(m, s),
      onProblemChanged: (m, s) => watcher.markProblemChanged(m, s),
      rePokeAfterMs: ma.maxSettleMs,
    });
```

> 注:`ma` 即 `resolveMainAgentConfig(env)` 的返回(`setupMainAgent` 上游已解析,见 `server.cjs` 对 `ma` 的引用)。若上游变量名不同,按实际调整 —— 执行时先 `grep -n "resolveMainAgentConfig\|const ma" hub/server.cjs` 确认。

- [ ] **Step 3: 跑全量回归**

Run: `node --test test/*.test.cjs`
Expected: 全 PASS。

- [ ] **Step 4: 接线正确性自检(读确认)**

Run: `grep -n "new EventWatcher\|new AgentDispatcher\|onStaleAck\|onProblemChanged\|rePokeAfterMs" hub/server.cjs`
Expected: 输出含 watcher 在前、dispatcher 在后、双回调 + `rePokeAfterMs: ma.maxSettleMs`。

- [ ] **Step 5: Commit(仅当用户要求)**

```bash
# git add hub/main_agent_env.cjs hub/server.cjs
# git commit -m "feat(hub): setupMainAgent 接线 watcher 退避 + dispatcher 双反馈回调"
```

---

## Task 7:`main_agent_config.cjs` NOOP 前缀约定

**Files:**
- Modify: `hub/main_agent_config.cjs`(`genPrompt()` 返回的系统提示文本)

- [ ] **Step 1: 定位 prompt 文本**

Run: `grep -n "genPrompt\|ack_event\|outcome\|CLAUDE.md" hub/main_agent_config.cjs`
确认 `genPrompt()` 返回的字符串结构(找到工作循环 / ack 说明段落)。

- [ ] **Step 2: 在 prompt 的 ack 说明段补 NOOP 约定**

在指导 claude 如何写 `ack_event` outcome 的位置,追加一段(全角标点,与现有 prompt 风格一致):

````
**陈旧重复事件标记**:若判定当前事件为「已诊断过、无新信息」的陈旧重复(同一错误持续未恢复、lastLine 实质未变),请在 `ack_event` 的 `outcome` 最前加 `NOOP` 前缀,如:
`NOOP: 同一 503 持续,已建议等待网关恢复,无需重复处理`
正常诊断建议仍用 `advised: ...`。该标记仅影响 hub 后续调度频率(降低重复处理),不触发任何动作。
````

- [ ] **Step 3: 验证写入**

Run: `node -e "const {genPrompt}=require('./hub/main_agent_config.cjs'); const p=genPrompt(); console.log(p.includes('NOOP'), p.includes('陈旧重复事件标记'));"`
Expected: `true true`。

- [ ] **Step 4: Commit(仅当用户要求)**

```bash
# git add hub/main_agent_config.cjs
# git commit -m "feat(main-agent): prompt 增 NOOP 前缀约定(陈旧重复标记)"
```

---

## Task 8:文档(操作手册 §13.3 + smoke.md)

**Files:**
- Modify: `docs/操作手册.md`(§13.3 工作原理)
- Modify: `docs/main-agent-smoke.md`(审计序列)

- [ ] **Step 1: 操作手册 §13.3 补段**

在 §13.3「工作原理」第 1 点(EventWatcher)后,补一小段说明指数退避 + 签名去重(全角标点):

````
1. **EventWatcher**(含指数退避):……(原文)持续同状态的事件,emit 间隔按 `emitCount` 指数退避(`settleMs → 2× → 4× …`,默认封顶 15 分钟),避免同一错误每 60 秒反复触发。
2. **AgentDispatcher**(含签名去重):……(原文)入队前按 `lastLine` 归一化签名去重——签名相同(同一问题)且未到定期重看间隔(默认 15 分钟)则抑制(`repeat_suppressed`);签名变化(新症状)立即 poke 并重置退避;claude 在 ack 写 `NOOP:` 前缀表示陈旧重复时,进一步加速退避。
````

- [ ] **Step 2: smoke.md 审计序列补 `repeat_suppressed`**

在 §4 方式 A 的「预期审计序列」里,`poke` 与 `dequeue_event` 之间补一行说明:同一 (machine,session) 短时间内重复 enqueue 时会出现 `repeat_suppressed`(被签名去重,不 poke)。在 §5 安全检查清单「全程有审计」项的审计事件列表补 `repeat_suppressed`。

- [ ] **Step 3: Commit(仅当用户要求)**

```bash
# git add docs/操作手册.md docs/main-agent-smoke.md
# git commit -m "docs: 主控 agent 事件去噪(退避 + 签名去重)说明"
```

---

## Self-Review

**1. Spec 覆盖**(对照 spec 各节):
- §5.1 EventWatcher 退避 + markStale/markProblemChanged → Task 2 + 3 ✓
- §5.2 AgentDispatcher sig-gate + ack 回填 + 双反馈 → Task 1(_sig/classifyOutcome)+ 4 + 5 ✓
- §5.3 server.cjs 接线 → Task 6 ✓
- §5.4 NOOP 约定 → Task 7 ✓
- §9 测试用例清单(1-16)→ Task 1-5 测试覆盖 ✓(退避序列/状态切换/recover/markStale/markProblemChanged/封顶/未知key/_sig/classifyOutcome/首见/同sig抑制/到期重poke/sig变/sig=null/GC/ack NOOP/ack advised)
- §7 配置参数(env 解析)→ Task 6 ✓
- §12 文件清单(操作手册 + smoke)→ Task 8 ✓

**2. Placeholder 扫描**:无 TBD/TODO;每个代码步骤含完整代码;commit 步骤标注「仅当用户要求」。✓

**3. 类型/命名一致性**:
- `emitCount`/`_backoffMs(k)`/`markStale(m,s)`/`markProblemChanged(m,s)`/`maxSettleMs`/`backoffBase`/`staleBump` —— Task 2/3/6 一致 ✓
- `_sig`/`classifyOutcome`/`_repeat{sig,lastPokeTs,lastOutcome}`/`_realEnqueue`/`_gcRepeat`/`rePokeAfterMs`/`resolveMs`/`onStaleAck`/`onProblemChanged` —— Task 1/4/5/6 一致 ✓
- emit 事件 `emitCount` 字段(Task 2 实现)与 Task 2 测试 `e.emitCount` 读取一致 ✓
- `_key(e)` = `${machine}|${session}`,EventWatcher key 同格式 → `markStale(machine,session)` 反查 `_counters.get(\`${machine}|${session}\`)` 一致 ✓

**4. 回归安全**:Task 4 Step 5 明确验证现有 dispatcher 测试(`lastLine:'x'`→`_sig=null`→放行)不破;Task 2 Step 5 验证现有 watcher 测试(`settleMs:0`→`_backoffMs=0`)不破。每个 Task 末尾跑全量。✓

**5. 执行顺序依赖**:Task 1(_sig/classifyOutcome)先于 Task 4(enqueue 用 _sig)/ Task 5(ack 用 classifyOutcome);Task 2/3(EventWatcher)先于 Task 6(接线);Task 6 依赖 Task 1-5 完成。顺序合理,无前向引用。✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-event-denoise-ab.md`. 两种执行方式:

1. **Subagent-Driven(推荐)** —— 每个 Task 派一个 fresh subagent,任务间两阶段 review(spec 合规 + 代码质量),迭代快。
2. **Inline Execution** —— 本会话内按 executing-plans 批量执行,带检查点。

选哪种?
