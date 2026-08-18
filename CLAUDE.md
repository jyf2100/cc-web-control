# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

cc-web-control 是一个通过 Web 对话框控制本地 Claude Code 的工具,核心是"**终端镜像**":浏览器经 WebSocket 与 Node 服务双向通信,Node 通过 tmux 的 `send-keys`/`capture-pane` 操控一个常驻的 claude TUI。另提供 **hub 多机模式**,聚合多台单机成统一看板。

- **单机模式**(:7684,默认)— 一台机器上控制自己的 claude。
- **hub 模式**(:7685,`cc-web-control hub` 子命令)— 聚合 N 台单机,统一看板 / 点卡片直达任一单机 / 多选广播。

两种模式共用同一个 `bin/cc-web-control.cjs` 入口、同一套 `config_loader.cjs` 配置体系、同一份 `public/` 前端,但**服务端完全独立**(hub 有自己的 `hub/server.cjs`,不复用根 `server.cjs`)。

## 常用命令

```bash
npm install                  # 装依赖
npm start                    # 单机模式,等价 node server.cjs,默认 http://127.0.0.1:7684
npm test                     # 全量测试(node --test test/*.test.cjs)
node --test test/foo.test.cjs  # 跑单个测试文件(无 vitest/jest,原生 node:test)

# 运行(npm i -g 后)
cc-web-control               # 单机
cc-web-control hub           # hub 聚合
```

- **无构建、无 lint**。纯 `.cjs`(CommonJS),`type: "module"` 但所有源码用 `.cjs` 后缀直接 `require`,改完即生效。
- **`npm run dev` 指向 `nodemon server.js`,但仓库入口实为 `server.cjs`** —— 该脚本可能是坏的,调试时直接 `node server.cjs`。
- **发布到 npm 必须显式 `--registry https://registry.npmjs.org`**(默认镜像不能发)。

## 整体架构:两种模式的数据流

```
单机模式:
  浏览器 ──WS── Node(server.cjs) ──tmux── claude TUI
                          │
                          └─读 ~/.claude/projects/<slug>/*.jsonl → 看板状态

hub 模式:
  浏览器 ──WS/HTTP── hub(hub/server.cjs)
                        ├── 注册通道:  各单机反向 WS 连入(/api/hub/agent)
                        ├── 聚合通道:  每 2s 并发 HTTP 拉各单机 /api/dashboard
                        ├── 终端通道:  WS 桥接 → 各单机的 WS(?session=)
                        └── mainAgent: 可选常驻 Claude,经 MCP 工具观察各单机
```

关键:hub **不跑** claude 会话(除非显式开 mainAgent),它只是聚合/转发层;真正的 claude 永远在单机上。

## 单机模式内部(server.cjs,854 行)

**只有 1 条 WebSocket**,挂在 HTTP server 上,用 `?session=<name>` query 区分会话,无独立路径。鉴权后消息协议(`server.cjs:673-729`,串行进 `commandQueue`):
- 客户端→服务端:`input`(→ `tmux send-keys -l`)、`key`(白名单按键 Tab/Enter/Esc/方向键/C-c 等,`server.cjs:616`)、`batch`(≤50 条)
- 服务端→客户端:`init`(连上发全屏)、`output`(轮询发现屏变)、`error`

**HTTP 路由**:`/healthz`、`/login`(GET+POST)、`/logout`(公开);鉴权后 `/api/config`、`/api/sessions`(GET 列/POST 建/DELETE 杀)、`/api/dashboard`、`/api/projects`、`/api/auth/ticket`(供 hub `/jump` 用)。

### tmux session 生命周期 + jsonl 事前绑定(核心设计)

这是全仓最非显然的机制,改动相关逻辑前必读(`server.cjs:173-207` + `claude_launch.cjs` + `claude_session.cjs`):

- **启动 claude 之前**就把其 jsonl 会话文件名钉死,写 binding 落盘,让看板能精确定位会话而非塌缩到 mtime 最新。
  - 新建 → `claude --session-id <uuid>`(jsonl 文件名恰为 uuid)
  - 续接 → `claude --resume <uuid>`(追加进同一 jsonl);uuid 由 `pickResumableSessionUuid` 按 mtime 降序取**首个未被其它活跃 tmux session 占用**的,防新 session 续进活跃 session 的 jsonl 造成双写/塌缩。
  - `claude-wrapper.sh` 先 `unset CLAUDECODE/CLAUDE_CODE`(破 claude 嵌套检测)再 `exec claude`。
- **会话命名**:cwd 命中某 `projectRoots` 顶层项目 → `claude-<slug>`(与前端同名避免双会话);否则回退 `CFG.session`。所有名字须过 `/^[A-Za-z0-9._-]{1,64}$/`。
- **cwd 安全**:`normalizeProjectCwd` 做 resolve→realpath→校验在 `projectRoots` 内→**拒换行**(防 send-keys 注入),再经 `shellEscapeForDoubleQuotes` 转义。
- **删除防自杀**:`DELETE /api/sessions/:name` 先查 `isSessionInUse`(有 OPEN 的 WS 连着该 session)→ 返回 **409 `session_in_use`**,防多标签/多设备 localStorage 不一致误杀当前会话。

### 看板数据来自 jsonl,不是 capture-pane(易误解)

两条独立轮询:
- **WS 终端回显**:`capture-pane`(默认 100ms)→ 推 `output`。
- **看板状态**:读 `~/.claude/projects/<slug>/<sid>.jsonl` **末尾 64KB**(`dashboard_tail.cjs`),`dashboard_parse.cjs` 把事件流解析成 `errored/waiting/idle/working` 状态 + 最后输出预览。`dashboard_cache.cjs` 是全局单例,每 `dashboardIntervalMs`(默认 2s)刷新。

即:看板的"最后输出"是 jsonl 末尾事件的文本预览,**不是**终端屏幕。改看板逻辑要动 `dashboard_*.cjs`,不是 `tmux.cjs`。

## hub 模式内部(hub/)

**三通道**(理解 hub 的关键):

1. **注册通道**(单机→hub):单机 `register_client.cjs` 用 `registerToken || authToken` 作 Bearer 连 hub 的 `/api/hub/agent` WS(`register_server.cjs`)。连上即注册,20s ping/pong 心跳。断线重连:close 1008(鉴权拒)→ 长 5min 退避,3 次停止;网络断 → 指数 500ms→30s(±20% jitter)。hub 回连单机失败时经此通道反向推 `unreachable` 告警。
2. **聚合通道**(hub→单机):`dashboard_aggregator.cjs` 每 `intervalMs`(默认 2s)并发 HTTP 拉各机 `/api/dashboard`,`mergeDashboards` 给每个 session 打 `machine` 标签,经 `GET /api/global-dashboard` 供前端。
3. **终端通道**(hub 前端→单机):`ws_bridge.cjs` 把前端终端流量桥接到对应单机的 AgentClient WS 池(引用计数懒连接 + 指数退避重连)。`/jump` 端点用单机 token 换一次性 ticket,302 把浏览器引到单机已登录态(免二次登录,限流 30/min + 审计)。

**registry 是纯内存 `Map`**,不落盘(`registry.cjs`),进程重启靠单机重新反向注册自愈。对外 `snapshot()`/`all()` **剥离 token 与连接**,只有 `getSecret()` 返回含 token 的回连凭证。静态 `hub-machines.json` 已 deprecated,改用单机运行时注册。校验拒云元数据地址 `169.254.169.254`(SSRF 防护,`hub/config.cjs`)。

**会话轨迹聚合**(轻量 Evolve 数据底座):单机 `trajectory_scan.cjs` 扫描 `~/.claude/projects/**/*.jsonl` 元数据(根路径/超限阈值经 `trajectoryRoot`/`trajectoryOversizeBytes` 配置),经 `GET /api/trajectories`(60s TTL 缓存)供 hub `trajectory_aggregator.cjs` 每 2s 轮询,聚合为 `GET /api/global-trajectories`(?machine=/?date=YYYY-MM-DD UTC 日过滤)。只聚合元数据不搬文件本体;前端 `public/trajectories_view.cjs` 是 hub 看板「会话轨迹」面板的纯函数渲染源(过滤语义与 hub 侧副本须同步维护)。

**mainAgent**(可选,hub 上常驻一个"值班" Claude,默认关):hub 在 `~/.cc-web-control/main-agent/` 生成 `.mcp.json`/`CLAUDE.md`/`mcp-trust.json`,起一个 tmux session 跑 `claude --mcp-config ...`。它通过 `hub/mcp/stdio.cjs`(stdio MCP server)暴露 **4 个只读工具**(`list_sessions`/`read_session`/`dequeue_event`/`ack_event`,经 HTTP 回调 hub)。`event_watcher.cjs` 对各机 session 的 `errored`/`idle` 状态做边沿检测(去抖 + 指数退避),`agent_dispatcher.cjs` poke 主控 agent 处理,ack 反馈调节退避(settle/backoff),全程落 `main-agent-audit.jsonl`(runId 贯穿)。**token 经 `tmux -e` env 注入,不落 mcp-config 文件**;LocalTmuxClient 对其输出 redact token 且只读。

## 配置体系(config_loader.cjs)

- 配置目录:`~/.cc-web-control/`,含 `config.json`(单机)、`hub-config.json`(hub)。
- **schema 驱动**,逐字段类型校验;优先级 **env > file > default**;`--config <path>` 覆盖文件路径。
- `SINGLE_SCHEMA`(单机,~21 字段)与 `HUB_SCHEMA`(hub,含 `mainAgent` passthrough 对象)。未知字段 → warning(防拼写错误);含 token 且文件权限过松 → 建议 `chmod 600`。
- 单机连 hub:配 `CC_WEB_HUB_URL` + `CC_WEB_HUB_REGISTER_TOKEN`(或 `CC_WEB_HUB_TOKEN`)即自动反向注册。跨 NAT 通常用 Tailscale 100.x 组网。

## 前端(public/)

原生 JS(无框架)。`index.html`=对话界面,`dashboard.html`=看板,`client.js`=单机前端逻辑,`dashboard.js`+`board_render.cjs`+`dashboard_render.cjs`=看板渲染。`modules/` 是 ES 模块(`terminal_model`/`virtual_scroll`/`command_palette`/`multi_line_input` 等),`vendor/pretext-layout.js` 是终端文本布局库。单机与 hub 共用同一份前端,靠运行时探测区分。

## 代码约定与陷阱

- **纯函数 + 依赖注入**是全仓测试风格:`loadConfig`/`buildClaudeLaunchCommand`/`parseStatus`/`buildRequest` 等都接受可注入的 `fsImpl`/`fetchImpl`/`argv`/`env`,测试不碰真实进程/网络。新增可测逻辑沿用此模式。
- **immutability**:返回新对象,不原地突变(schema default 浅拷贝、config 不可变等已贯彻)。
- **安全边界一览**(改鉴权/网络相关前过一遍):token 常量时间比较(`auth.cjs` `safeEqual`)、登录滑动窗口限流(默认 5/15min)、unsafe 方法同源 CSRF 检查、cwd/binding 路径穿越多重防御、hub 双 token(`hubToken` 总令牌 / `hubRegisterToken` 可选注册专用)、loopback 判断(跨机明文 http 才告警)。
- **hub 未设 trust proxy**:反代部署下 `req.ip` 共享会使限流计数合并,公网部署需自行处理(`hub/server.cjs:85`)。
- **Node ≥ 18**;hub mainAgent 的 ACP/Claude 相关能力若启用可能要求更高 Node 版本。
- 文档:`docs/操作手册.md`(中文完整手册)、`docs/部署使用文档.md`。
