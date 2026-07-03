# 事件去噪 Brainstorm:3 个备选方案

> **日期**:2026-07-03 | **状态**:brainstorm 产出,待用户选定方向 | **关联**:T1 主 agent(`hub/event_watcher.cjs` / `hub/agent_dispatcher.cjs`)
>
> 本文档归档"派产品专家团队并行头脑风暴"的产出,供决策。选定后据此写正式 spec → plan。

## 问题

`EventWatcher` 的冷却期 `settleMs` 是**固定 60s**。一个**持续未恢复**的 errored/idle 会每 60s 重新 emit → claude 反复走完整 `dequeue→read_session→诊断→ack`,烧 LLM 调用。
**实证**:`mac-pro/claude-we-mp-rss` 网关 503 持续 errored,`run-61246-1..40` —— 同一问题被处理 **40 次**。

## 已有过滤(别重复发明)

只监控 errored/idle · `threshold=3` 去抖(持续~6s)· `settleMs=60s` 冷却(问题根源:过了又重发)· 队列上限 20 + 同 target 合并 + 串行 + ack 超时 drop。

## 三方案对比

| 维度 | 🅰 指数退避+NOOP | 🅱 签名升级梯 | 🅲 三层全套 |
|---|---|---|---|
| run-61246 调用 | 40→**5**(叠加NOOP→3) | 40→**4** | 40→**1**(退避接管→3-4) |
| 去重维度 | 时间(emit 次数) | 内容(lastLine 签名) | 内容+标签+人控 |
| 不漏报 | 中(语义变最多晚1h;recover重置) | **强**(签名变立即放行+30min网+0静默丢) | 中(症状变重置;退避期可能过抑制) |
| 改动量 | **小**(1字段+1公式,现有结构内) | 中(全在dispatcher,逻辑多) | 大(新文件+路由+前端) |
| 可干预 | 弱(无手动入口,需补API) | 中(审计全留痕+升级摘要) | **强**(仪表盘静音/重诊+持久化) |
| 依赖claude配合 | NOOP前缀(可选) | 不依赖(outcome只展示) | ack标签(可选,层1去重独立) |

---

## 🅰 指数退避 + 陈旧 ack 反馈(成本/效率派)

**核心**:固定 60s 冷却 → 按 emit 次数指数退避(`60→120→240→480…封顶1h`);claude 在 ack 写 `NOOP` 前缀时,dispatcher 再把该 target 退避档 +1。两层都不碰 claude 工具集,纯 hub 侧调度。

**机制要点**:
- `EventWatcher._counters` value 增 `emitCount` 字段(连续同状态周期内已 emit 次数;状态切换/recover 归零——安全锚)。
- 退避公式 `_backoffMs(k)=min(settleMs * backoffBase^k, maxSettleMs)`,默认 `backoffBase=2 / settleMs=60s / maxSettleMs=1h`。
- emit 判定 `now-lastEmitTs >= _backoffMs(emitCount)`;命中后 `emitCount+=1`。
- 自适应层:`AgentDispatcher.ack()` 检测 outcome `NOOP` 前缀 → `EventWatcher.markStale(machine,session)` → `emitCount+=staleBump`。

**文件改动**:
- `hub/event_watcher.cjs`:加 `maxSettleMs/backoffBase/staleBump` 默认参数;counter 增 `emitCount`;emit 条件换 `_backoffMs(c.emitCount)`;状态切换重置 `emitCount:0`;新增 `_backoffMs(k)` + `markStale(machine,session)`。
- `hub/agent_dispatcher.cjs`:加 `classifyOutcome`(默认 `NOOP` 前缀匹配)+ `onStaleAck` 回调;`ack()` 清 `_current` 前调用。
- `hub/server.cjs`:`setupMainAgent` 把 watcher 上移到 dispatcher 前;透传 `settleMs/maxSettleMs`;`AgentDispatcher` 构造增 `onStaleAck: (m,s)=>watcher.markStale(m,s)`。
- `hub/main_agent_config.cjs`:system prompt 加一行——"陈旧重复事件请在 outcome 最前加 `NOOP` 前缀"。
- 测试(node:test):退避时间序列、状态切换归零、recover→counter删→复发重置、`markStale` 拉长等待、`maxSettleMs` 封顶、dispatcher `NOOP` 触发 `onStaleAck`。

**pros**:87.5% 降本(40→5);安全锚强(recover 即重置,不漏复发);改动最小、全在现有结构;退避独立生效不依赖 claude;守 T1 边界。
**cons**:退避期"语义悄悄变"的错误最多晚 1h 看;NOOP 依赖 prompt 约定(不配合退避仍生效);多 3 个可调参数;深退避后无手动重置入口(可后续补)。
**复杂度**:中(但最小)。**T1 边界**:完全守住,无新工具/执行权,outcome 解析只影响"下次何时 poke"。
**无人值守**:自然收敛,每持续错误最坏 1 次/小时;recover 自动重置不漏复发。
**run-61246 走查**:40min 窗口 emit 在 t=0/120/360/840/1800s → 调用 5 次;叠加 NOOP→约 3 次。

---

## 🅱 签名门控升级梯(可靠性/不漏报派)

**核心**:dispatcher 按 `lastLine` 归一化签名去重,同问题重复按检查点(第 2/5/20/50/100 次 + 30min 安全网)才升级 poke 一次(带历史摘要);签名一变(新错误)立即放行。EventWatcher 不动(它的重 emit 是进程内事件不烧 LLM,真正烧钱的是 dispatcher 的 poke,所以在 dispatcher gate)。

**机制要点**:
- 新增 `_sig(lastLine)` 归一化纯函数(剥时间戳/`run-\d+`/孤立数字/空白,lowercase);空/垃圾 → null(保守放行不抑制)。
- 每 target 重复跟踪器 `_repeat = Map(key→{sig, advisedCount, suppressedCount, totalRepeats, firstSeenTs, lastPokeTs, lastOutcome, history[末3]})`。
- 常量:`ESCALATION_AT=[2,5,20,50,100]`、`ESCALATION_PERIOD=50`、`ESCALATION_MAX_SILENT_MS=30min`(时间安全网)、`RESOLVE_MS=2h`(GC)。
- `enqueue`:同签名重复 → `totalRepeats++`,命中检查点才构造升级事件(带 `escalation` 摘要)`_realEnqueue`,否则 `repeat_suppressed` 审计;签名变/首见/空签名 → 立即正常 poke(0 延迟)。
- `ack` 回填 `lastOutcome`/`history`(不依赖 outcome 关键字做硬抑制);`dequeueEvent` 透传 `escalation` 字段;升级时 poke 文案换 `RECURRING (第N次,约Mmin)`。

**文件改动**:
- `hub/agent_dispatcher.cjs`(主改):加 `_repeat` Map + 4 常量 + 导出 `_sig`;重构 `enqueue` 为 sig-gate;抽 `_realEnqueue`;新增 `_dueForEscalation`;`ack()` 回填;`dequeueEvent()` 透传 escalation;懒 GC + 审计事件 `repeat_suppressed/problem_changed/problem_resolved`。
- `hub/event_watcher.cjs`:不改行为(可选注释)。
- `hub/mcp/stdio.cjs`:`dequeue_event`/`ack_event` 工具描述文案补 escalation 说明(向后兼容,无 schema 变更)。
- `test/hub-agent-dispatcher.test.cjs`:同 sig 第2/3/5 次 poke=3、sig 变化立即 poke、ack 回填、`RESOLVE_MS` GC、空 lastLine 放行、升级事件含 escalation。

**pros**:绝不漏新问题(签名变立即放行);绝不静默丢(抑制全进审计+升级汇总);30min 安全网;升级带丰富上下文提升诊断质量;约 10x 降本;守 T1 边界(确定性重见,claude 无法永久静音)。
**cons**:复杂度上升(多 Map/签名/升级/GC/回填);签名碰撞可能并问题(缓解:归一化保守+周期升级);签名漂移(时间戳)→从不抑制→退化原行为(安全失败=多调非漏调);dispatcher 跨 ack 有状态(重启丢);非归零(8h 故障仍 poke ~20 次)。
**复杂度**:中。**T1 边界**:守住;关键别把 outcome 关键字升级成"受 claude 控制的抑制开关"。
**无人值守**:首见照常 poke;升级梯 + 30min 网持续重见;抑制不烧 LLM;自愈 GC;最坏退化原行为。
**run-61246 走查**:40 次 emit → 调用 4 次(第1/2/5/20),后3次带摘要走廉价 ack,0 漏报(36 次在审计 `repeat_suppressed`,第5/20次汇总呈现)。

---

## 🅲 三层:症状去重 + ack 标签退避 + 仪表盘人控(人机协同/控制派)

**核心**:新建 `SuppressionPolicy`(hub 侧纯 Node),被 EventWatcher 和 Dispatcher 共有,唯一抑制决策点。层①同 `lastLine` 直接拦截(零依赖兜底)→ 层②ack 标签 `[NOOP]/[TRANSIENT]/[ACTION]/[HUMAN]` 驱动退避(`60s→5min→15min→1h→4h`)→ 层③仪表盘静音/恢复/立即重诊(持久化)。

**机制要点**:
- `policy.decide(key,sample,now)→{emit,reason}`:层①同 lastLine → `duplicate` 抑制;层②时间门用 `effectiveSettleMs(key)=schedule[step]`;症状变(`lastLine` 不同)→ `symptom-changed` 重置 step 放行。
- `policy.recordAck(key,outcome)`:`classifyOutcome` 归类(前缀标签优先,否则关键词启发,无法判定→`unknown` 不推进退避);`noop/transient/human` → step++,`actionable` → step=0。
- 人控:`mute`(effectiveSettle=∞)/`escalate`(每轮放行)/`reset`(step=0 清 lastLine);经 `JsonOverrideStore`(`dataDir/suppression-overrides.json`,0600)持久化;`recordRecovery` 在 session 转好时重置 step(保留 mute)。

**文件改动**:
- `hub/suppression_policy.cjs`(新建,~150 行):`SuppressionPolicy` 类 + `classifyOutcome` + `JsonOverrideStore`;`decide/effectiveSettleMs/recordAck/recordEmit/recordRecovery/mute/unmute/escalate/reset/snapshot`。
- `hub/event_watcher.cjs`(改~6 行):构造增 `policy`;`_tick` emit 块改调 `policy.decide`;消失 key 调 `recordRecovery`。
- `hub/agent_dispatcher.cjs`(改~3 行):构造增 `policy`;`ack()` 增 `policy.recordAck`。
- `hub/server.cjs`(改~35 行):`setupMainAgent` new `SuppressionPolicy` 注入 watcher+dispatcher;新增 `GET /api/main-agent/suppression` + `POST /api/main-agent/suppression/:key`(复用 hubToken 鉴权)。
- `hub/main_agent_config.cjs`(改~8 行):system prompt 加 ack 标签约定段。
- `public/console.html`(改,量小):errored/idle 行加徽标"已抑制×N·退避Xm"+ [静音][恢复][立即重诊] 按钮。

**pros**:层①去重零依赖(40→1);复用 claude 已有判断(它本就识别"第20次同义重投");退避封顶4h;透明可干预(仪表盘直接告诉人在重复);改动薄契合现有结构;守 T1 边界;持久化契合无人值守。
**cons**:面最广(新文件+路由+前端+可写文件);`classifyOutcome` 关键词可能误判(缓解:无标签→`unknown`不推进);退避可能过抑制"lastLine 不变但严重度上升"的事故(缓解:4h封顶+边沿重置+人 Escalate/Reset+[ACTION] 立即归零);前端无构建链则 patch 粗(可分期);claude 忘打标→退化层1去重。
**复杂度**:中(面广)。**T1 边界**:policy 在 hub 进程非 claude;claude 工具集不变;outcome 仅读标签;mute/escalate/reset 只能经 hub 路由(claude 无途径调)。
**无人值守**:三层独立底向上兜底;层①零依赖是核心防线;层②退避接管(最坏小时级);mute 持久化;状态变自动重置不睡死。
**run-61246 走查**:lastLine 字节不变 → 层①去重 → 调用 1 次(`run-61246-1`),suppressed~39;若 lastLine 含时间戳去重失效 → 退避接管 3-4 次;人可仪表盘静音/重诊。

---

## 推荐 + 演进路径

考虑 T1 是只读参谋、硬约束"最小改动优先"、要无人值守 —— **推荐 🅰 作为基础**:改动最小、87.5% 降本、recover 安全锚强、不依赖 claude 配合。

🅰 的唯一弱点(语义变延迟看)可后续用 🅱 的**签名变化检测**轻量补(签名变→重置退避档,不必上整套升级梯)。**演进路径**:

```
🅰 指数退避(立竿见影,最小改动)
   └→ 叠加 🅱 签名变化检测(补"语义变立即重看",轻量)
        └→ 视需要加 🅲 仪表盘人控(多台坏机要静音/强制重诊时)
```

**其他场景**:生产环境/漏报代价高 → 直接 🅱;多台已知坏机要人在环 → 🅲。

## 待用户选定

选定后据此写正式 spec(`docs/superpowers/specs/YYYY-MM-DD-event-denoise-<chosen>-design.md`)→ 实现 plan。当前不写代码(brainstorming HARD-GATE)。
