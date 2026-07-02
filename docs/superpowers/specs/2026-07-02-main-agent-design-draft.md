# 主控 agent 设计 v1(draft,基于专家 review 修订)

> **状态**:v1 draft,2026-07-02。基于 v0 经 4 位专家 review(架构/安全/可行性/完整性,40 条 findings / 9 critical)修订。**待用户批准**后转 writing-plans。
> **来源**:cc-web-control 一阶段 spec §12「二期展望:主控 agent」。
> **项目**:`/Users/roc/workspace/cc-web-control` —— Node.js Express + WS + tmux;`hub` 子命令聚合多机。`package.json type:module` → `.js` ESM / `.cjs` CommonJS;测试 `node --test test/*.test.cjs`。

## 0. 相对 v0 的根本变化

v0 的「完整手脚 + 全自动」单一基线经 review 判定不可行。v1 五处根本修订:

1. **能力分三档**(T1/T2/T3),**MVP = T1 只读参谋**,渐进到全自动;晋升以实测指标为门。
2. **安全模型翻转**:deny 黑名单 → **allowlist 默认拒绝 + 进程级隔离(独立 UID)+ 审计外置 + 子机 hardened profile**。删除「deny 作硬边界」「复用 hub_ui_helpers 作硬边界」。
3. **触发改 pull 模型**:`sendInput` 多行注入被 tmux 拆碎(实测),改为 MCP 工具 `dequeue_event()` 拉取结构化事件,`sendInput` 仅单行 poke。
4. **hub_mcp_server = 独立 stdio 子进程 + HTTP IPC** 回调 hub,非「直调内存模块」。
5. **路径围栏 + git checkpoint** 取代命令围栏;新增 `audit_log` 组件 + 单一 `run_id` 贯穿。

## 1. 能力分档(MVP = T1)

| 档 | 主 agent 能力 | 触发 | 上线门 |
|---|---|---|---|
| **T1 只读参谋** | 仅 `list_sessions` / `read_session`;**无 `send_instruction`、无 hub 本机 Write/Edit/Bash**;只产建议写入审计日志,由人执行 | 事件 + 定时巡检 | 初始档,跑 N 天收集指标 |
| **T2 受控执行** | 加 `send_instruction`,但**全量走审批队列**(人批才下发) | 同上 | T1 误唤醒率 < X、日均成本 < Y、连续 Z 天无需回滚 |
| **T3 低危全自动** | `send_instruction` 低危自动、高危转人;主 agent 有受限本机能力(仅 allowlist) | 同上 | T2 审批通过率稳定、无安全事故 |

**用户的「全自动值班」= T3 终点**,T1/T2 是渐进路径。档位由人经控制台手动晋升(不自动),降级一键可回 T1。

## 2. 架构(修订后)

```
子机 dashboards ──▶ dashboard_aggregator ──▶ event_watcher(去抖+电平)
                                                    │ enqueue(run_id)
                                                    ▼
                                          agent_dispatcher(队列/优先级/合并/预算门)
                                                    │ 单行 poke(sendInput)
                                                    ▼
                          ┌─────────────────────────────────────┐
                          │  主 agent(claude code @ 本机 tmux)    │  ← 独立低权 UID
                          │  独立 UID / allowlist / 路径围栏       │
                          └─────────────────────────────────────┘
              pull events │           │ MCP 工具调用(经 stdio)
              ◀───────────┘           ▼
                              hub_mcp_server(独立 stdio 进程)
                                          │ HTTP IPC + 内部 token
                              ┌───────────┴───────────────┐
                              ▼                           ▼
                    /api/mcp/list_sessions         /api/mcp/read_session
                    (复用 aggregator)               (agent_client capturePane)
                              │
                              ▼  (仅 T2+)
                    /api/mcp/send_instruction → agent_client.sendOneShot → 子机
                                                    │
                          audit_log ◀── 全链路 log(scope,run_id,event,detail) ──┘
                              │ (主 agent 不可写:外置/append-only/hash-chain)
```

**六个组件**,各一文件、单一职责、可独立单测:

| 组件 | 文件 | 职责 | 可测性 |
|---|---|---|---|
| event_watcher | `hub/event_watcher.cjs` | 纯函数 `diffEvents(prev,curr)→Event[]` + 去抖/电平 | 纯快照输入单测 |
| agent_dispatcher | `hub/agent_dispatcher.cjs` | 队列 + 优先级 + 合并 + 预算门 + 单行 poke + 完成 ACK | 队列逻辑单测(stub tmux) |
| hub_mcp_server | `hub/mcp/stdio.cjs` + `bin/cc-web-control-mcp.cjs` | stdio JSON-RPC,HTTP 回调 hub | stub HTTP 单测 |
| guardrail | `hub/guardrail.cjs` | 纯函数 `decide(call,ctx)→allow/deny/escalate` + 频率/扇出 | 纯函数单测 |
| audit_log | `hub/audit_log.cjs` | append-only `log(scope,run_id,event,detail)` | 单测 |
| local_tmux | `hub/local_tmux.cjs` | 包根 `tmux.cjs` 的 sendKeys/capturePane 适配 | 测试 stub 本机 tmux |

## 3. 主 agent 会话与隔离

- hub 本机开固定名 tmux 会话 `cc-main-agent`,跑 `claude --mcp-config <file>`;**hub 进程内直接 spawn tmux**(dispatcher 经 `local_tmux.cjs` 直连,不经 WS 往返,延迟低、无自递归)。
- **独立低权 UID 运行**:`hub-machines.json`、审计日志、settings、guardrail 配置对该 UID **只读或不可达** → 主 agent 无法 `cat` 拿 token 横向移动、无法篡改审计/挂起队列。
- **allowlist 默认拒绝**:T3 才开 Bash,且 `allow` 仅限只读命令(ls/cat/grep/git status…),参数受限;**全部写/删/网络/Shell-execution 原语一律走审批**。Shell 执行经「不信任命令文本的执行器」(固定脚本白名单 + 参数 schema 校验),非把整条命令交给 agent 拼写。
- **路径围栏**:Write/Edit 限沙箱目录;hub 配置/registry/审计/日志/代码路径在 `permissions.deny` 硬禁;每次写前 **git checkpoint**(已 git 仓库),恢复 = `checkout`,树已脏则拒绝行动。
- **hub 本机依赖回退**:启动期检测 tmux + claude,缺失则主 agent 功能降级关闭、hub 控制台仍可用(与一期零回归)。
- **观察通道**:主 agent 会话在控制台有独立固定面板(capturePane + 可 attach),**但不进 aggregator 的 machine 列表、不进 event_watcher 事件源**(防自指)。
- **平台适配(关键)**:项目跑在 darwin。§3/§8 的隔离与冻结原语按平台分:Linux 用 cgroup freezer + namespace + 独立 UID;macOS 用 `sandbox-exec`(沙箱 profile 禁敏感文件/网络出口)+ 低权用户 + 进程组 kill。**隔离是 T3 的硬前提**——部署平台不支持完整隔离则**停在 T2 审批档**,不升 T3。

## 4. 事件触发(pull 模型)

- **载荷与唤醒分离**:`dispatcher` 投递 = `sendInput` 单行 poke(如 `new event; call dequeue_event`);结构化事件经 MCP 工具 `dequeue_event()→JSON` 拉取(可靠、可测、可审计)。
- **完成信号**:dispatcher 监听主 agent transcript JSONL 的最后 assistant 事件 `stop_reason==end_turn`(即 status 转 waiting,复用 `dashboard_parse.parseStatus`)作出队下一条;**不依赖** claude TUI 回 ACK(它不提供)。备选:agent 调 `ack_event(run_id,outcome)` 显式确认。
- **事件去抖 + 电平回退**(修 errored 抖动/粘性):errored/idle 须**连续 ≥K 轮或 ≥T 秒**才 enqueue(过滤瞬态 529 blip);errored 边沿触发「出现过即记录」,但动作后给 grace 期,状态未变则指数退避重投(带上限次数),不依赖 agent 自检。
- **队列保护**:上限(如 20),满则合并同 target / 丢最旧 + 告警;优先级 errored > idle > waiting;解冻后按「每 target 最近一条」去重回放,不全量倾泻。
- **时钟**:idle/长无输出只在单机时间域比较(now 与该机 lastTs 同源),跨机不做绝对时间比较;或要求 NTP + payload 附 server-time 偏移校正。

## 5. hub_mcp_server(独立 stdio + HTTP IPC)

- claude 经 `--mcp-config` spawn 它为 **stdio 子进程**,与 hub HTTP 进程独立。
- 用 `@modelcontextprotocol/sdk` 跑 stdio JSON-RPC,工具经 **HTTP 回调本机 hub**(如 `127.0.0.1:<port>/api/mcp/*`),用环境变量 `CC_WEB_HUB_TOKEN` 鉴权(**不内联进 mcp-config JSON**,文件仍 0600 防御纵深)。
- hub 新增内部端点,复用既有对象:`/api/mcp/list_sessions`(→ aggregator)、`/api/mcp/read_session`(→ agent_client capturePane,errored 时额外回溯最后 error 事件上下文)、`/api/mcp/send_instruction`(→ agent_client.sendOneShot,T2+ 才开)。
- **send_instruction 单行约束**:若子机也是 claude TUI、无 MCP 入口,投递前把所有 `\n` 归一为单行(替换为字面 `\n` 或空格),spec 钉死「注入子会话文本必为单行」,并文档化对可下发指令形态的限制。

## 6. 工具集(MCP,T1 三件 / T2+ 四件)

| 工具 | 档 | 说明 |
|---|---|---|
| `list_sessions` | T1 | 全机器全会话 + 状态 + 末行 + machine online/offline + human-controlled 锁 |
| `read_session(machine,session,lines)` | T1 | 读尾部;输出在主 agent 上下文标记为**不可信数据**(分隔符 + system prompt 强约束) |
| `dequeue_event()` | T1 | 拉结构化事件(JSON) |
| `ack_event(run_id,outcome)` | T1 | 显式确认处理完毕(备选完成信号) |
| `send_instruction(machine,session,text)` | **T2+** | 单行;走审批队列(T2)/ 低危自动(T3) |

**主 agent 自带 Bash/Edit/Write 仅 T3 开**,且受 §3 allowlist + 路径围栏约束。

## 7. 安全模型(翻转后)

- **allowlist 默认拒绝**,非 deny 黑名单。deny 字符串匹配可被 base64/eval/写脚本绕过,不作硬边界。
- **进程级隔离**:主 agent 独立低权 UID/容器/namespace;token 仅 hub 持有、永不下发;各机限制仅 hub 出口可连(即便 token 泄露也无法从主 agent 进程直连)。
- **子机 hardened profile(主→子跳围栏)**:hub 侧 guardrail 只管「是否允许发送」(速率/扇出/预算/审批门),对自然语言做 advisory 检测;**真正执行围栏是每台子机 claude code 自身 settings.json**(致命模式 deny + Bash/Edit/Write require-approval)。spec 写死「子机必须以 hardened profile 运行」作为自动档(T3)前提。
- **prompt injection 防护**:read_session 输出标记不可信;由 read_session 推导的写/执行动作一律转人;考虑独立只读「诊断 agent」(无 Bash)消费子会话输出、产结构化结论再喂主 agent。
- **hub_ui_helpers 仅用于浏览器人控二次确认,agent 路径不复用作硬边界**(只复用 `DANGER_PATTERNS` 正则常量作 advisory 特征)。

## 8. 护栏

- **扇出 = 速率上限**:per-target-per-minute + per-agent-run 全局双封顶(防循环单发绕过单次上限)。
- **成本预算**:解析主 agent 自身 `~/.claude/*.jsonl` usage 事件按短间隔累计 = 真实花费;**硬预算在 dispatcher 层**(剩余 < 最小块时拒唤醒/不投递),不交给 agent 自限。巡检节奏按舰队规模缩放,token 计入预算,超限跳过本轮巡检。
- **冻结语义三同步**:暂停 event_watcher 轮询 + 冻结 dispatcher 队列(不再 enqueue)+ 停主 agent;实现为**进程组/会话级 SIGKILL**(连 disowned 子进程一并停)+ Linux cgroup freezer / macOS `sandbox-exec` kill,非仅 sendKeys Esc;allowlist deny 后台化原语(`&`/nohup/setsid/disown/cron/at);验收含破坏性测试(已 `nohup rm … &` 后冻结验证子进程被终止)。
- **人机并发**:人 attach 某 sub-session 即标记 human-controlled,主 agent 对它 send_instruction 默认 skip+log/排队到人 detach;per-target send mutex 防按键交错;注入文本加 `[agent]`/`[human]` 可见标记。
- **网络分区**:send_instruction 返回连接错误时,agent 须先 list_sessions 复核目标 online;离线则不补救、事件退避重排队(dispatcher 管);工具结果统一带 machine online/offline 摘要。

## 9. 审计(统一 run_id + 外置)

- 单一 `run_id`/`event_id` 贯穿:dispatcher 事件 → 注入 poke `[EVENT id=…]` → agent 回执 echo id → 每工具调用带 id → 结果。
- **强制记 non-action**(agent 看了选择不动 + 原因),事后可区分「看到不动」vs「没看到」。
- **外置/append-only**:由 hub 进程(独立 UID)写,主 agent 无写权;条目带前一条 hash 的链式哈希;更稳妥走 syslog/对象存储/SIEM(hub 经只写管道推送,主 agent 无文件句柄无网络出口可达)。
- `replay` = 重渲染时间线,非重执行(LLM 非确定性)。
- **工作状态外部化**:agent 处理中事件(open/已尝试)存独立状态文件(非主 agent context),重启/compact 后重载,避免重复劳动。

## 10. 开放问题 + 必做 spike

- **spike(进入实现前必做)**:
  1. sendInput 单行 poke 可靠唤醒(不与 TUI 抢键、不落 paste)
  2. 多行自然语言注入子会话(预期失败 → 验证 §5 单行约束必要性)
  3. hub_mcp_server HTTP IPC 原型 + 主 agent transcript `end_turn` 完成信号可用性
  4. 主 agent 独立 UID/sandbox 跑 claude code 的可行性(token 隔离、tmux 权限、平台冻结原语:Linux cgroup / macOS sandbox-exec)
- **留 spec 细化**:T1→T2→T3 晋升门的具体阈值(误唤醒率/日成本/回滚次数);allowlist 白名单初始集;审计 sink 选型(本地 append-only vs 外置);诊断 agent 是否独立(看 T1 复杂度)。
