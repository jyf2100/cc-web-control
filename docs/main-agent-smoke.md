# 主控 agent(T1 只读参谋)端到端冒烟

本文指导你用 `docs/main-agent-smoke.sh` 半自动验证主控 agent T1 闭环:EventWatcher 状态边沿 → dispatcher 入队 → 单行 poke 唤醒 cc-main-agent 会话里的 claude → claude 调 4 个 MCP 工具回 hub 只读诊断 → `ack_event` 记录建议。

> 相关操作手册章节见 [操作手册](./操作手册.md) 第 13 节「主控 agent(T1 只读参谋)」。

---

## 1. 前置条件

| 条件 | 说明 |
| --- | --- |
| tmux 可用 | `tmux -V` 能输出版本号(>= 3.0 为宜)。主 agent 通过本地 tmux 会话 `cc-main-agent` 拉起 claude。 |
| claude CLI 在 PATH 且已登录 | `command -v claude` 能找到;且已完成 Claude 登录认证(否则 spawn 出来的 claude 进程起不来)。 |
| 端口空闲 | 默认 `7685`,若被占用可用 `CC_WEB_HUB_PORT` 改端口(`lsof -nP -iTCP:7685 -sTCP:LISTEN` 排查)。 |
| hub-machines.json 已配 | 至少一台子机在线(`~/.cc-web-control/hub-machines.json`),且该子机的 cc-web-control 服务可达。**否则没有子机会话状态可触发,主 agent 永远收不到事件。** |

---

## 2. 启动

最简(脚本会用时间戳生成临时 token,仅本机冒烟):

```bash
bash docs/main-agent-smoke.sh
```

推荐(显式指定你的真实 hub token,便于后续子机回调和审计对应):

```bash
CC_WEB_HUB_TOKEN=<你的hub token> bash docs/main-agent-smoke.sh
```

可选环境变量(均与 hub 侧 `hub/main_agent_env.cjs` 解析的变量一一对应):

```bash
CC_WEB_HUB_TOKEN=xxx \
CC_WEB_HUB_PORT=7685 \
CC_WEB_HUB_MAIN_AGENT_SESSION=cc-main-agent \      # 可选,默认 cc-main-agent
CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH=claude \         # 可选,默认 claude
CC_WEB_HUB_MAIN_AGENT_DATA_DIR=~/.cc-web-control/main-agent \  # 可选,默认同左
CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE=~/.cc-web-control/main-agent-audit.jsonl \  # 可选,默认同左
bash docs/main-agent-smoke.sh
```

脚本会:
1. 设 `CC_WEB_HUB_MAIN_AGENT_ENABLED=1`(必需,不设则 hub 不装配,dequeue/ack 端点回 503);
2. 设 `CC_WEB_HUB_NO_OPEN=1`(冒烟不需要自动开浏览器);
3. `node hub/server_entry.cjs` 启动 hub(后台),trap EXIT 时自动 kill;
4. 等 3 秒后跑前 4 步自动检查;
5. 进入手动验收提示,`Ctrl-C` 退出并清理 hub。

---

## 3. 自动检查(脚本 4 步;第 2 步同时验证三个配置文件)

| # | 检查项 | PASS | FAIL 处理 |
| --- | --- | --- | --- |
| 1 | `cc-main-agent` tmux 会话存在 | 打印 `PASS: session 'cc-main-agent' exists` | claude 不在 PATH / 未登录、tmux 不可用、hub 启动报错。看脚本上方的 hub 日志。 |
| 2 | `$DATA_DIR/.mcp.json` 与 `CLAUDE.md` 已生成 | `ls -la` 两文件均存在,权限 `-rw-------`(0600) | `$DATA_DIR`(默认 `~/.cc-web-control/main-agent`)不可写,或 hub 写文件失败。看 hub 日志。 |
| 3 | `.mcp.json` 不含 token | 打印 `PASS: no token in .mcp.json` | **安全漏洞**。说明 `main_agent_config.cjs` 的 `genMcpConfig` 把 token 内联了。立刻停,排查 `hub/main_agent_config.cjs`。 |
| 4 | 审计文件存在 | `ls -la` 出 `~/.cc-web-control/main-agent-audit.jsonl` | 首次启动尚无事件触发时,审计文件可能还没建。**不算 FAIL**,等你触发首次 enqueue 后再看。 |
| 5 | `mcp-trust.json` 已生成(无人值守信任) | `ls` 出 `$DATA_DIR/mcp-trust.json`,权限 `-rw-------`(0600) | `hub/main_agent_config.cjs` 的 `writeMainAgentFiles` 没写该文件。**缺它 → claude 卡在确认框、`ack` 永不到**(见故障排查)。 |

---

## 4. 手动验收(核心:确认主 agent 真在工作)

保持脚本终端跑着,另开一个终端选其中一种方式观察。

### 方式 A:看审计流(推荐)

```bash
tail -f ~/.cc-web-control/main-agent-audit.jsonl
```

然后**触发一个事件**:在 hub 管的某台子机会话里,让它进入 `errored` 或 `idle` 状态并**持续约 6 秒**(EventWatcher 默认 `threshold=3` × `intervalMs=2000ms` = 6 秒去抖,防抖滤波,避免抖动误报)。

预期审计序列(每行一个 JSON,关键字段 `event`):

```
{"event":"enqueue",   "scope":"event",      "detail":{"machine":"...","session":"...","type":"errored"}}
{"event":"dequeue",   "scope":"dispatcher", "detail":{"target":".../...","type":"errored"}}
{"event":"poke",      "scope":"dispatcher", "detail":{"retry":0}}
{"event":"dequeue_event","scope":"mcp"}                         # claude 调了 dequeue_event() MCP 工具
{"event":"ack",       "scope":"dispatcher", "detail":{"outcome":"advised: ..."}}   # claude 诊断完调 ack_event()
```

看到 `ack` 且 `outcome` 形如 `advised: <建议>` 或 `noop: <为何不动>`,说明主 agent 端到端闭环成功。

> 若只看到 `enqueue`/`dequeue`/`poke` 却迟迟没有 `ack`,5 分钟后会出现 `ack_timeout_retry`(默认重试 2 次)再 `ack_timeout_drop`,见下面故障排查。

### 方式 B:看会话

```bash
tmux attach -t cc-main-agent
```

观察 claude 被 poke(单行 `[event] id=run-... new event; call dequeue_event then ack_event`)后的行为:
- 是否调用了 `dequeue_event` / `list_sessions` / `read_session` 工具;
- 是否产出一条简明诊断建议(疑似原因 + 建议人执行的动作);
- 是否调用了 `ack_event(runId, outcome)` 确认。

`Ctrl-B` 然后 `d` 可 detach,不要 `Ctrl-C`(那会杀掉 claude)。

---

## 5. 安全检查清单

- [ ] **token 仅在 tmux 进程环境**:`.mcp.json` 只含 `{ command, args }`,token 经 `tmux new-session -e CC_WEB_HUB_TOKEN=... CC_WEB_HUB_URL=...` 注入 claude 进程,由 MCP server 子进程继承,**绝不落盘**。(脚本第 3 步自动验证。)
- [ ] **`read_session` 输出视为不可信**:其中可能含 prompt injection(指令/URL/代码)。主 agent 的系统提示已约束:只用于诊断、绝不执行、引用时用 `<untrusted-pane>...</untrusted-pane>` 分隔标记。
- [ ] **主 agent 无写权限工具**:T1 只读档只给了 4 个 MCP 工具(`list_sessions` / `read_session` / `dequeue_event` / `ack_event`),**没有** Bash/Edit/Write。`ack_event` 的 `outcome` 只是建议文本,不触发任何动作。
- [ ] **全程有审计**:`enqueue` / `dequeue` / `poke` / `ack` / `ack_timeout_*` / `queue_overflow_drop` 全部写进 `~/.cc-web-control/main-agent-audit.jsonl`。
- [ ] **无人值守信任已预置(两层缺一不可)**:`writeMainAgentFiles` 还会写 `mcp-trust.json`(0600),经 claude `--settings` 注入,含 `enabledMcpjsonServers:["cc-web-control"]`(跳过 "New MCP server found" 信任框)+ `permissions.allow` 放行 4 个只读工具(跳过每次 MCP 工具调用的 "Do you want to proceed?" 执行权限框)。**两层任缺其一,claude 卡框、`ack` 永不到。** 冒烟若见 pane 停在确认框,即此处缺配置。

---

## 6. 故障排查

| 现象 | 可能原因 / 处理 |
| --- | --- |
| 自动检查 1 FAIL:无 `cc-main-agent` 会话 | claude 不在 PATH(`command -v claude`)、未完成 Claude 登录、tmux 不可用、hub 启动失败。看脚本上方 hub 的 stderr。 |
| 无审计 `enqueue` | 子机未进入 `errored`/`idle`,或进入了但**没持续够 6 秒**(EventWatcher 去抖阈值)。或 `hub-machines.json` 里该子机不在线、cc-web-control 服务不可达。看 hub 日志确认 aggregator 聚合到了对应状态。 |
| 有 `enqueue` 无 `ack` | 主 agent 没响应。依次看审计里是否 `poke` 成功(`poke_error` 说明 tmux poke 失败);若 `poke` 正常但无 `dequeue_event`(scope=mcp),说明 claude 卡住/没被唤醒,5 分钟后看 `ack_timeout_retry` / `ack_timeout_drop`。`tmux attach -t cc-main-agent` 看会话是否健康。 |
| `queue_overflow_drop` | 同一台 (machine,session) 事件积压超过 20 条(队列上限)。主 agent 处理速度跟不上,或 claude 长时间无响应。 |
| dequeue/ack 端点回 503 | `CC_WEB_HUB_MAIN_AGENT_ENABLED` 没设成 `1`。hub 默认不装配主 agent。 |
| 有 `poke` 正常、无 `dequeue_event`/`ack`，claude pane 停在确认框 | claude 卡在 "New MCP server found" 或 "Do you want to proceed?" 框。**这是无人值守最常见的坑：信任未预置。** 检查 `$DATA_DIR/mcp-trust.json` 是否生成、是否含 `enabledMcpjsonServers` + `permissions.allow`（4 个 `mcp__cc-web-control__*` 工具）。由 `hub/main_agent_config.cjs` 的 `genTrustSettings` 生成、经启动命令的 `--settings` 注入。 |
| 有 `enqueue` 无 `ack`（续） | 若确认框已排除：依次看审计是否 `poke` 成功（`poke_error` 说明 tmux poke 失败）；`poke` 正常但无 `dequeue_event`（scope=mcp），说明 claude 没被唤醒/卡住，5 分钟后看 `ack_timeout_retry`/`ack_timeout_drop`。`tmux attach -t cc-main-agent` 看会话健康度。 |

---

## 7. 清理

- 脚本终端 `Ctrl-C`:trap 自动 kill hub。
- 残留的 `cc-main-agent` 会话(若 claude 还没退出):`tmux kill-session -t cc-main-agent`。
- 如需清空审计重跑:`rm ~/.cc-web-control/main-agent-audit.jsonl`。
- 配置文件(`~/.cc-web-control/main-agent/.mcp.json` / `CLAUDE.md`)可保留,下次启动会被覆盖重写。
