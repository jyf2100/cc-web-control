# 事件去噪 v2 设计:A+B 轻量协同(时间退避 × 内容去重)

> **日期**:2026-07-03 | **状态**:已批准(轻量协同 / 15min / 接受 NOOP)| **关联**:[brainstorm 三方案对比](./2026-07-03-event-denoise-brainstorm.md) · T1 主 agent(`hub/event_watcher.cjs` / `hub/agent_dispatcher.cjs`)
>
> **选定方向**:A+B 组合。**默认采用「轻量协同」**(见 §4 选型理由);若用户 review 时要「双重全量」,按 §15 开放问题切换。

---

## 1. 背景与问题

`EventWatcher` 的冷却期 `settleMs` 固定 60s。一个**持续未恢复**的 errored/idle 会每 60s 重新 emit → claude 反复 `dequeue→read_session→诊断→ack`,烧 LLM 调用。实证:`mac-pro/claude-we-mp-rss` 网关 503 持续 errored,`run-61246-1..40` 同一问题被处理 **40 次**。

现有过滤(保留):只监控 errored/idle · `threshold=3` 去抖(持续~6s)· `settleMs=60s` 冷却(问题根源)· 队列上限 20 + 同 target 合并 + 串行 + ack 超时 drop。

## 2. 目标 / 非目标

**目标**
- 持续同错误不再反复烧 claude:run-61246 从 40 次 → ≤2 次。
- 不漏新问题:错误内容变化时立即重看。
- 不过抑制:持续同错误仍定期重看(防"lastLine 不变但实质恶化")。
- 守 T1 只读边界,不新增 claude 工具/执行权。
- 改动局部、可回退(纯 hub 侧调度逻辑)。

**非目标**
- 不做仪表盘人控(🅲,后续视需要再加)。
- 不改 claude 的 4 个 MCP 工具集与 schema。
- 不解析 transcript/语义(只用 `lastLine` 浅层签名)。

## 3. 方案选型:A+B 轻量协同

A(EventWatcher 层·**时间**)与 B(Dispatcher 层·**内容**)在不同层,互补不冗余:

- **A 主导频率压缩**:持续同状态错误,emit 间隔指数退避(`settleMs→2×→4×…封顶 maxSettleMs`)。emit 次数 40→5。
- **B 补内容感知**:dispatcher 看 `lastLine` 签名;签名变=新问题=立即 poke 并反馈;签名同=旧问题=抑制(但有定期重看安全网)。对 A 的 5 次 emit 再去重 → poke ≤2。

**协同的精髓在双反馈环**:
- **正向(降频)**:claude ack 写 `NOOP`(陈旧重复)→ watcher `emitCount++` → 退避加速。
- **反向(纠偏)**:dispatcher 发现签名变(症状变了)→ watcher `emitCount=0` → 退避从头开始。这一条补 A 的盲点:A 只看状态(`errored`/`idle`)不看内容,"状态没变但错误内容变了"(`503`→`connection refused`)A 会闷头退避;B 让它立刻醒。

**为何不「双重全量」**:A 的退避已在压缩频率,B 的完整升级梯(检查点 2/5/20/50/100 + 30min 安全网)会与之冗余,且引入两套独立状态机(`emitCount` + `repeater` 升级计数)、两套参数。轻量版只取 B 的**签名变化检测 + 定期重看安全网**,职责单一:dispatcher 只回答"这个 emit 要不要真 poke claude",频率完全交给 A。

## 4. 架构与数据流

```
                    ┌─────────────────────────────────────────┐
                    │            EventWatcher (A)              │
                    │  _counters[key] = {status,n,lastEmitTs,  │
                    │                    emitCount}            │
                    │  emit 条件: n>=threshold &&             │
                    │    now-lastEmitTs >= _backoffMs(emitCount)│
                    └───────────────┬─────────────────────────┘
                                    │ emit('event', {machine,session,to,lastLine,...})
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │       AgentDispatcher.enqueue (B)        │
                    │  sig = _sig(event.lastLine)              │
                    │  查 _repeat[key]:                        │
                    │   首见        → 建 repeater → 入队 poke  │
                    │   sig 变      → 更新 + onProblemChanged  │
                    │                → 入队 poke               │
                    │   sig 同+到期 → 入队 poke(定期重看)    │
                    │   sig 同+未到 → repeat_suppressed(审计)│
                    └───────────────┬─────────────────────────┘
                                    │ poke (单行)
                                    ▼
                              ┌──────────┐
                              │  claude  │─→ dequeue_event/read_session/ack_event
                              └────┬─────┘
                                   │ ack(runId, outcome)
                                   ▼
                    ┌─────────────────────────────────────────┐
                    │       AgentDispatcher.ack                │
                    │  回填 _repeat[key].lastOutcome           │
                    │  classifyOutcome(outcome)=='noop'        │
                    │    → onStaleAck → watcher.emitCount +=   │
                    └─────────────────────────────────────────┘
         反向反馈:onProblemChanged(签名变)→ watcher.emitCount=0
         正向反馈:onStaleAck(NOOP)      → watcher.emitCount += staleBump
```

## 5. 组件设计

### 5.1 EventWatcher(A:退避 + 双反馈入口)

**构造参数**(在现有 `{getLatest, intervalMs=2000, threshold=3, settleMs=60_000}` 基础上新增):
- `maxSettleMs = 900_000`(15min,退避封顶 = 定期重看上限)
- `backoffBase = 2`
- `staleBump = 1`(每次 NOOP 反馈给 emitCount 加多少)

**counter 结构**:`{status, n, lastEmitTs, emitCount}`(`emitCount` 默认 0)。

**状态切换**(第 74 行,`!c || c.status !== sm.status` 分支):新建 counter 时 `emitCount: 0`(连同 `n: 0`,保留原 `lastEmitTs` 行为不变)。

**emit 判定**(替换第 77 行固定 `settleMs`):
```
c.n >= threshold && now - c.lastEmitTs >= this._backoffMs(c.emitCount)
```
命中后:`c.lastEmitTs = now; c.emitCount += 1;` 然后 `emit(...)`。

**新方法**:
- `_backoffMs(k) = Math.min(this._settleMs * Math.pow(this._backoffBase, k), this._maxSettleMs)`
- `markStale(machine, session)`:定位 key,`c.emitCount += this._staleBump`(不重置 `lastEmitTs` —— 下次仍按更大的退避等待,即"加速退避")。key 不存在则忽略。
- `markProblemChanged(machine, session)`:定位 key,`c.emitCount = 0`(只重置计数,不动 `lastEmitTs` —— 下次按 `_backoffMs(0)=settleMs` 重新进入浅退避)。key 不存在则忽略。

**recover**(第 83 行,`!seen.has(k)` 删除):不变 —— 会话消失即删 counter,复发时新建 `emitCount: 0`,天然重置。

**导出**:`module.exports = { diffEvents, EventWatcher, sampleWatched }` 不变。

### 5.2 AgentDispatcher(B:轻量 sig-gate + 正向反馈)

**构造参数**(在现有基础上新增):
- `onStaleAck = null`(回调 `(machine, session) => void`)
- `onProblemChanged = null`(回调 `(machine, session) => void`)
- `rePokeAfterMs = 900_000`(同 sig 定期重看间隔,与 `maxSettleMs` 对齐)
- `resolveMs = 2 * 60 * 60 * 1000`(repeater 懒 GC 阈值)

**新增内部状态**:
- `this._repeat = new Map()` —— `key → { sig, lastPokeTs, lastOutcome }`
  - `sig`:上次见到的归一化签名(`string`,或首见前的 `null`)
  - `lastPokeTs`:上次真正 poke(入队)的时间戳
  - `lastOutcome`:上次 ack 的 outcome 文本(诊断参考,审计用)

**纯函数 `_sig(lastLine)`**(模块级导出,供单测):
- 输入非字符串/空 → 返回 `null`(`null` = 签名不可靠,**保守放行不抑制**)
- 归一化:剥 ISO 时间戳 → 剥 unix 时间戳(10-13 位)→ 剥 `run-\d+` → 剥孤立数字 → 折叠空白 → `trim()` → `toLowerCase()`
- 归一化后 `length < 4` → 返回 `null`(短行不可靠,放行;安全失败=多调非漏调)
- 否则返回归一化串

**纯函数 `classifyOutcome(outcome)`**(模块级导出):
- 空/非串 → `'unknown'`
- `trim().toLowerCase()` 以 `noop` 开头 → `'noop'`
- 以 `advised` 开头 → `'advised'`
- 其余 → `'unknown'`

**enqueue 重构**(前置 sig-gate;原队列管理逻辑抽成 `_realEnqueue`):
```
enqueue(event):
  if this._frozen: return false
  this._gcRepeat()                              // 懒 GC
  key = this._key(event)
  sig = _sig(event.lastLine)
  if sig == null:
    this._realEnqueue(event); return true       // 签名不可靠,保守放行
  now = Date.now()
  r = this._repeat.get(key)
  if r == null:
    this._repeat.set(key, { sig, lastPokeTs: now, lastOutcome: null })
    this._realEnqueue(event); return true       // 首见 → poke
  if r.sig !== sig:
    this._repeat.set(key, { sig, lastPokeTs: now, lastOutcome: null })
    this._onProblemChanged?.(event.machine, event.session)  // 反馈 watcher 重置退避
    this._realEnqueue(event); return true       // 新症状 → poke
  // sig 相同(旧问题)
  if now - r.lastPokeTs >= this._rePokeAfterMs:
    r.lastPokeTs = now
    this._realEnqueue(event); return true       // 定期重看安全网 → poke
  this._audit.log({ scope:'dispatcher', runId:null, event:'repeat_suppressed',
                    detail:{ target:`${event.machine}/${event.session}`, sig } })
  return true                                    // 抑制,不入队
```

**`_realEnqueue(event)`**:即当前 `enqueue` 第 31-39 行的队列管理(maxQueue 溢出处理 + 同 target 合并 + push + sort + `_pump()`)原样搬入。

**`_gcRepeat()`**:遍历 `_repeat`,删除 `now - lastPokeTs >= resolveMs` 的条目(防内存增长;target 长期无事件即回收)。

**ack 扩展**(在现有清理 `_current = null` **之前**回填,以便仍能取到 `c.event` 的 machine/session):
```
ack(runId, outcome):
  c = this._current
  if !c || c.runId !== runId: ...(现有 ack_stale 分支不变)...
  // 回填 repeater
  key = this._key(c.event)
  r = this._repeat.get(key)
  if r: r.lastOutcome = outcome
  // 正向反馈
  if classifyOutcome(outcome) == 'noop':
    this._onStaleAck?.(c.event.machine, c.event.session)
  ...(现有: clearTimeout + audit ack + _current=null + _pump)...
```

**导出**:`module.exports = { AgentDispatcher, PRIORITY, _sig, classifyOutcome }`。

### 5.3 server.cjs 连接

`setupMainAgent` 内( watcher 与 dispatcher 构造处):
- watcher 在 dispatcher 之前构造(读取 `settleMs`/`maxSettleMs`,可由环境变量 `CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS` 覆盖,默认 1800000)。
- `AgentDispatcher` 构造注入双回调:
  - `onStaleAck: (m, s) => watcher.markStale(m, s)`
  - `onProblemChanged: (m, s) => watcher.markProblemChanged(m, s)`
  - `rePokeAfterMs` 取与 watcher `maxSettleMs` 相同的值(单一来源,避免漂移)。

### 5.4 main_agent_config.cjs(NOOP 约定)

`genPrompt()`(系统提示)增一段:
> **陈旧重复事件标记**:若判定当前事件为「已诊断过、无新信息」的陈旧重复(同一错误持续未恢复、lastLine 实质未变),请在 `ack_event` 的 `outcome` 最前加 `NOOP` 前缀,如 `NOOP: 同一 503 持续,已建议等待网关恢复,无需重复处理`。正常诊断建议仍用 `advised: ...`。该标记仅影响后续调度频率,不触发任何动作。

## 6. 签名归一化规则(`_sig`)

设计原则:**保守**。宁可放过(多调一次)不可误并(漏看新问题)。

| 输入 lastLine(示例) | 归一化 sig | 说明 |
|---|---|---|
| `Error 503 at 2026-07-03T10:22:31Z run-61246` | `error at` | 剥时间戳+run-id+数字 |
| `Error 503 at 2026-07-03T10:23:02Z run-61247` | `error at` | **同一签名**(同一问题) |
| `connection refused (errno 111)` | `connection refused (errno )` | 同签名 |
| `panic: nil pointer at line 42` | `panic: nil pointer at line` | 同签名(行号被剥) |
| `panic: segfault at line 88` | `panic: segfault at line` | 与上行**不同** sig → 视为新症状,立即 poke |
| `ok` / `hi` / `err` | `null` | <4 字符,放行不抑制 |
| `""` / `null` / 非 string | `null` | 放行不抑制 |

> 注:孤立数字剥离会让"error count: 5" 与 "error count: 12" 同签名。这是**有意**的(计数波动不代表新问题);若需区分可后续细化规则。

## 7. 配置参数

| 参数 | 默认 | 位置 | 含义 |
|---|---|---|---|
| `settleMs` | 60_000 | EventWatcher | 退避基数(首次 emit 后等 60s) |
| `maxSettleMs` | 900_000 | EventWatcher | 退避封顶(15min)= 定期重看上限 |
| `backoffBase` | 2 | EventWatcher | 退避倍率 |
| `staleBump` | 1 | EventWatcher | NOOP 反馈给 emitCount 的增量 |
| `rePokeAfterMs` | 900_000 | AgentDispatcher | 同 sig 定期重看间隔(对齐 maxSettleMs) |
| `resolveMs` | 7_200_000 | AgentDispatcher | repeater 懒 GC 阈值(2h) |

环境变量(可选,均带默认):`CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS`、`CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE`、`CC_WEB_HUB_MAIN_AGENT_STALE_BUMP`(其余沿用现有)。

## 8. 安全边界(T1 只读,守住)

- **无新工具/执行权**:claude 仍是 4 个只读 MCP 工具,无 Bash/Edit/Write。
- **outcome 仅影响调度**:`classifyOutcome` 只读 outcome 文本前缀决定"下次何时 poke",不触发动作;`NOOP` 无法让 claude 永久静音一个问题(定期重看 + 签名变化兜底)。
- **反馈环单向**:回调 `onStaleAck`/`onProblemChanged` 只改 watcher 的 `emitCount`(调度参数),不读写 claude 状态、不回传内容。
- **签名不落盘**:`_repeat` 是 hub 进程内存 Map,重启即清空(安全失败:重启后所有 target 视为首见,重新诊断一次)。
- **审计完整**:新增 `repeat_suppressed` 审计事件;`ack` 仍全量记录 outcome。

## 9. 测试用例清单(node:test,同步 `node --test test/*.test.cjs`)

**EventWatcher(`test/hub-event-watcher-backoff.test.cjs`,新增)**:
1. 退避时间序列:持续 errored,首次 emit 后,后续 emit 间隔 = `settleMs * backoffBase^k`,封顶 `maxSettleMs`。
2. 状态切换重置 emitCount:idle→errored 后,emitCount 归 0,退避从 settleMs 重新开始。
3. recover 删除 counter:会话消失后复发,counter 新建 emitCount=0。
4. `markStale(m,s)`:`emitCount += staleBump`,下次 emit 等待变长。
5. `markProblemChanged(m,s)`:`emitCount = 0`,下次按 settleMs。
6. `maxSettleMs` 封顶:退避序列不超过 maxSettleMs。
7. 未知 key 的 markStale/markProblemChanged 静默忽略(不抛错)。

**AgentDispatcher(`test/hub-agent-dispatcher-sig.test.cjs`,新增)**:
8. `_sig` 规约:表 §6 全部示例(时间戳/run-id/数字剥离、短行→null、空→null)。
9. 首见 sig → 入队 + 建 repeater(用 spy/mock tmux 验证 poke 被调)。
10. sig 相同 + 未到 `rePokeAfterMs` → 不入队,审计出 `repeat_suppressed`。
11. sig 相同 + 到 `rePokeAfterMs` → 入队(定期重看),`lastPokeTs` 更新。
12. sig 变化 → 入队 + `onProblemChanged` 回调被调 + repeater.sig 更新。
13. `sig=null`(短行/空)→ 放行入队,不抑制。
14. `ack(runId, 'NOOP: ...')` → `onStaleAck` 回调被调 + repeater.lastOutcome 回填。
15. `ack(runId, 'advised: ...')` → `onStaleAck` 不被调 + lastOutcome 回填。
16. `_gcRepeat`:超 `resolveMs` 的 repeater 被清;未超的保留。

**回归**:`test/hub-agent-dispatcher.test.cjs` / `test/hub-event-watcher.test.cjs` 现有用例须继续通过(构造缺省参数、enqueue/ack/poke/timeout 行为不变)。

## 10. run-61246 走查(预期)

持续 503、lastLine 实质不变、40min 窗口:

| 时间 | watcher emit | dispatcher 行为 | poke? |
|---|---|---|---|
| t=0(首见,6s 去抖后) | run-1 | 建 repeater{sig},lastPokeTs=0 | ✓ poke(首次诊断) |
| t=120s | run-2(emitCount=1) | sig 同,120s < 15min | ✗ repeat_suppressed |
| t=360s | run-3(emitCount=2) | sig 同 | ✗ suppressed |
| t=840s | run-4(emitCount=3) | sig 同 | ✗ suppressed |
| t=1740s≈29min | run-5(emitCount=4,`_backoffMs(4)=min(960,900)=900` 封顶) | sig 同,1740s ≥ rePokeAfterMs(900s) | ✓ poke(定期重看) |

**结果**:40min 窗口 poke 2 次(首次 + t≈29min 定期重看),40→2,**95% 降本**;封顶后稳定每 15min 重看一次。若 claude 首次 ack 写 `NOOP` → 退避加速(emitCount 提前增大),更快收敛到 15min 稳态。若中途 lastLine 变(`503`→`connection refused`)→ 立即 poke + 退避重置,0 漏报。

## 11. 降级与回退

- **claude 不配合写 NOOP**:退避仍按 emitCount 自然增长(只是收敛稍慢),`rePokeAfterMs` 定期重看仍兜底。功能不缺失。
- **`_sig` 把不同问题误并**(签名碰撞):`rePokeAfterMs` 保证最多 15min 重看一次;且 lastLine 实质变化通常产生不同 sig。
- **`_sig` 把同问题误判为新**(签名漂移,如未剥净的时间戳):退化为"多调非漏调"(安全失败),退避 + 上限仍约束总次数。
- **回退**:本特性纯 hub 侧逻辑,无数据迁移;回退即还原 `enqueue`/`_tick`/`ack` 三处 + 删两个测试文件。`_repeat` 为内存态,重启即清。

## 12. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `hub/event_watcher.cjs` | 改 | +`emitCount`/`_backoffMs`/`markStale`/`markProblemChanged`/构造参数 |
| `hub/agent_dispatcher.cjs` | 改 | +`_sig`/`classifyOutcome`/`_repeat`/sig-gate enqueue/`_realEnqueue`/`_gcRepeat`/ack 回填+正向反馈 |
| `hub/server.cjs` | 改 | watcher 上移 + dispatcher 注入双回调 + `rePokeAfterMs` 对齐 |
| `hub/main_agent_config.cjs` | 改 | system prompt 增 NOOP 约定段 |
| `test/hub-event-watcher-backoff.test.cjs` | 新增 | 用例 1-7 |
| `test/hub-agent-dispatcher-sig.test.cjs` | 新增 | 用例 8-16 |
| `docs/操作手册.md` §13.3 | 改 | 工作原理补"指数退避 + 签名去重"一段 |
| `docs/main-agent-smoke.md` | 改 | 审计序列补 `repeat_suppressed` 说明 |

## 13. 决策记录(用户 2026-07-03 拍板)

1. **轻量 vs 全量** → **轻量协同**(A 退避主导 + B 只做签名变化检测与定期重看;不上 B 全量升级梯)。
2. **`maxSettleMs` / `rePokeAfterMs`** → **900_000(15min)**(偏不漏:持续同错误每 15min 强制重看一次)。
3. **NOOP 约定** → **接受**:claude 判定陈旧重复时在 outcome 写 `NOOP:` 前缀,驱动 watcher 加速退避。

---

**下一步**:进 `writing-plans` 出 TDD 实现计划。
