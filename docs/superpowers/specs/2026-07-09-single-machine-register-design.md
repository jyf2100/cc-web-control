# 单机反向注册 + hub 自动发现 — 设计

- 日期：2026-07-09
- 状态：待评审（v2：经需求分析师 + 产品经理双专家审查修订）
- 作者：roc + Claude
- 关联代码：`hub/server.cjs`、`hub/registry.cjs`、`hub/server_entry.cjs`、`hub/config.cjs`、`server.cjs`、`bin/cc-web-control.cjs`、`config_loader.cjs`

## 1. 背景与目标

### 1.1 现状

cc-web-control 有两种角色（CLI 子命令互斥，`bin/cc-web-control.cjs:38-56`）：

- **单机**（`cc-web-control`，:7684）：带 token 鉴权的 HTTP + WebSocket server，控制本机 tmux。
- **hub 多机**（`cc-web-control hub`，:7685）：聚合多台单机的中央服务。

当前 hub 通过**静态 JSON 清单** `~/.cc-web-control/hub-machines.json` 得知机器列表（`config_loader.cjs:185`、`hub/config.cjs:7-56` 的 `loadMachines`），数据流方向是 **hub 主动、单机被动**：

- 看板聚合：hub → 单机 HTTP 轮询（每 2s `GET /api/dashboard`，`hub/dashboard_aggregator.cjs:29-57`）
- 终端交互：hub → 单机 **出站 WebSocket**（hub 是 WS client，`hub/agent_client.cjs:83-104`）

单机**完全不知道 hub 的存在**。每加一台机器都要手动编辑 JSON 并重启 hub；机器宕机后清单仍列出、看板持续显示 offline，无自动下线。

### 1.2 目标

- **单机主动注册**：单机启动（或重启）时主动把自己登记到 hub。
- **hub 自动发现**：hub 运行时从单机注册中动态发现机器，加机零 hub 侧操作。
- **自动生命周期**：连接即在线、断开即下线，无需人工维护清单与机器存活性。
- **零外部依赖**：不引入 Nacos 等外部注册中心（已评估，见 §12.1）。

### 1.3 非目标

- 不改变数据通道：看板仍走 hub 主动轮询，终端仍走 hub 主动出站 WS（**注册协议只负责「发现 + 在线」，不承载业务数据**）。
- 不做 NAT 穿透：前提是单机能被 hub 直连（同网或公网可达）；单机在 NAT 后无法被 hub 回连的场景不在本期范围。
- 不做多 hub 协同、不做服务权重/灰度。

## 2. 方案总览

**注册/在线方向反转，数据通道不动。**

```
[单机 :7684]                                 [hub :7685]
  │                                            │
  │══ 反向注册 WS（新增） ═════════════════════▶│  ① 单机→hub
  │   ws://hub/api/hub/agent                   │     连接即注册 / 在连即条目存在
  │   Authorization: Bearer <register/hub-token>│     断开 = 下线，重连 = 自愈重注册
  │   首帧 {type:register,id,name,url,token}   │
  │◀══ {type:unreachable,url} （回连失败告警） │
  │                                            │
  │◀══ HTTP GET /api/dashboard（每 2s） ══════│  ② 看板轮询（现有，不变；aggregator 写 online）
  │◀══ WS /?session=X（出站，按需） ══════════│  ③ 终端交互（现有，不变）
```

- **① 新增**：单机主动连 hub 一条反向 WebSocket，**只**承担 注册 + 在线探测 + 自愈重连 + 回连失败反馈。
- **②③ 不变**：hub 仍主动轮询看板、主动出站 WS 连终端，复用全部现有数据通道、鉴权、聚合与 WS 桥代码。

单机从此同时是 WS server（:7684 接受 hub 出站连）与 WS client（主动连 hub 注册）。两条职责独立、方向相反、互不干扰。

**为何用反向长连接而非 HTTP 心跳**：连接级在线状态最准（无需单独心跳协议）、断开即时感知、重连天然实现「hub 重启后自愈重注册」。数据通道仍复用现有轮询+出站 WS，改动面集中在「注册/在线」这一条新链路上。

## 3. 单机侧：反向注册 client

新增模块 `register_client.cjs`（与 `server.cjs` 同层，根目录），由 `server.cjs` 在 HTTP/WS 服务启动后条件加载。

### 3.1 启用条件（向后兼容的关键）

仅当配置了 `CC_WEB_HUB_URL` 且注册凭据（`CC_WEB_HUB_REGISTER_TOKEN`，未设则回退 `CC_WEB_HUB_TOKEN`）时启动注册 client；否则**完全不注册**，单机行为与现状一致。老用户升级零影响。

### 3.2 连接

```js
const wsHubUrl = CC_WEB_HUB_URL.replace(/^http/, 'ws');
const registerToken = CC_WEB_HUB_REGISTER_TOKEN || CC_WEB_HUB_TOKEN;
const ws = new WebSocket(`${wsHubUrl}/api/hub/agent`, {
  headers: { Authorization: `Bearer ${registerToken}` },
});
```

单机是程序化连接，可自带 header（区别于浏览器 WS 只能走 `?token=` query）。

### 3.3 注册帧

连上后立即发送：

```json
{ "type": "register", "id": "<machineId>", "name": "<displayName>", "url": "<可达URL>", "token": "<单机CC_WEB_AUTH_TOKEN>" }
```

字段来源：

| 字段 | 默认值 | 覆盖 env | 约束 |
|---|---|---|---|
| `id` | `os.hostname()` | `CC_WEB_MACHINE_ID` | 沿用 hub 现有规则 `^[A-Za-z0-9._-]{1,32}$`，禁 `/`（全局会话键分隔符 `machine.id\|session`，见 `hub/event_watcher.cjs:30,33`） |
| `name` | 取 `id` | `CC_WEB_MACHINE_NAME`（**MVP 可后置**，首版可不暴露此 env） | 显示名，可空 |
| `url` | `http://<bindHost>:<port>` | `CC_WEB_PUBLIC_URL` | 必须是 hub 能回连的地址；NAT/反代场景必填 |
| `token` | `CC_WEB_AUTH_TOKEN` | —（即单机自身鉴权 token） | 让 hub 之后能用 Bearer 调本机 |

**id 冲突防护**：默认 `id = hostname` 在容器/克隆镜像环境极易撞名（多台同 hostname）。MVP 不自动追加随机后缀（避免重启导致 id 漂移、hub 误判为新机器），改为两层告警：

- 单机侧：启动时若未显式设 `CC_WEB_MACHINE_ID`，打印 WARN「hostname 可能在多机环境冲突，建议显式设置 CC_WEB_MACHINE_ID」。
- hub 侧：检测到同一 id 在短时间内被不同连接反复覆盖（抢占振荡）时告警。

未来增强可让单机把一个随机后缀持久化到 `~/.cc-web-control/machine-id` 文件（首次生成、后续复用），既防冲突又稳定——本期不做。

**url 自检**：单机注册时若报告的 url 解析为 `localhost`/`127.0.0.1`/私网地址、却配了非 loopback 的 hub 地址，启动打印 WARN「hub 可能回连不上此 url，请设置 CC_WEB_PUBLIC_URL」。

### 3.4 保活（单机 ping）

连接保持即条目存在。为防中间网络设备因空闲杀连接，单机定时（默认 20s）发送应用层 `{ "type": "ping" }`。hub 收到回 `{ "type": "pong" }`，并以此重置空闲计时器（见 §4.4）。

### 3.5 重连、退避与鉴权失败分叉（自愈）

断开后重连，但**区分失败类型**，避免 token 轮换时无限轰炸 hub（需求 Critical）：

| 触发 | 含义 | 退避策略 |
|---|---|---|
| `close(1008)`（hub 策略拒绝：鉴权失败 / 注册帧非法） | 永久性配置错误 | **长退避**（默认 5min）+ ERROR 级醒目告警「请检查 CC_WEB_HUB_REGISTER_TOKEN / CC_WEB_HUB_TOKEN / 注册帧字段」；连续失败达上限（默认 3 次）后**停止重连**，避免轰炸 |
| `close(1006)` 异常断开 / `1011` 服务端错误 / TCP 错误 / 连接超时 | 临时网络/服务故障 | **短退避**：500ms 起、×2、封顶 30s |

通用规则：

- **成功建立连接**（register 被 hub 接受，或收到首个 pong）→ **退避计数器清零**（避免长期故障后恢复迟钝，需求 Important）。
- 所有退避延迟叠加 **±20% 随机 jitter**（防 hub 重启后 N 台单机走相同序列同步涌入风暴，需求 Important）。
- 重连成功后重发 register 帧 = 自愈。
- 重连退避期间**不阻断** :7684 本地服务。

### 3.6 优雅下线

单机 `SIGINT` / `SIGTERM` 时，register client 主动 `ws.close(1001, 'going away')`（或先发一帧 `{type:'unregister'}` 再 close），让 hub 即时 remove，而非苦等 TCP keepalive 超时。单机 `server.cjs` 的关闭钩子需集成 register client 的关闭。

### 3.7 配置变更生效

注册相关配置（`CC_WEB_HUB_URL` / token / `CC_WEB_MACHINE_ID` / `CC_WEB_PUBLIC_URL` 等）变更**需重启单机进程**生效，不支持热重载。spec 与 README 明确这一点，避免用户误以为改 env 即时生效。

## 4. hub 侧：注册 WS endpoint + 动态 registry 接入

### 4.1 endpoint 与路径分流

现有 hub 的浏览器 WS 用 `new WebSocketServer({ server })`（`hub/server.cjs:454`）**不过滤路径**——所有 WS upgrade 都进同一个 `wss`，鉴权后交给 `WsBridge`（`hub/server.cjs:472-489`）。

在现有 `wss.on('connection')` handler **顶部按 `req.url` 路径分流**：

- 路径为 `/api/hub/agent` → 交给新增的**注册处理器**（Bearer header 鉴权 → 处理 register 帧 → 维持连接）。
- 其余路径 → 维持现状，走 `bridge.handleConnection(ws)`（浏览器，cookie / `?token=` query 鉴权）。

**隐含前提文档化**：WS upgrade **不经过 express 的 `requireAuth` 中间件链**，鉴权全部在 WS 层自管（现有浏览器 WS 即此模式，`hub/server.cjs:472-489`）。实现者不要误把 `/api/hub/agent` 加进 express 鉴权白名单——那是 HTTP 中间件，对 WS upgrade 无效。

### 4.2 鉴权

注册连接握手时校验 `Authorization: Bearer`：

- 若 hub 配置了 `CC_WEB_HUB_REGISTER_TOKEN` → 必须匹配它（注册专用凭据，与看板登录 token 分离，见 §7）。
- 否则 → 匹配 `CC_WEB_HUB_TOKEN`。

不符 `ws.close(1008, 'Unauthorized')`（与现有浏览器 WS 鉴权失败 close 码一致，`hub/server.cjs:485`；单机侧据此进入长退避，见 §3.5）。

### 4.3 接受注册

收到 `register` 帧后：

1. 用 `hub/config.cjs` 现有的 `validateMachine` 规则校验 `id` / `url` / `token`（含 url 的 `http(s)://` 与 `169.254.169.254` SSRF 防护）。非法 → `close(1008)` + 日志告警。
2. 写入 `MachineRegistry`（`add`，见 §4.5）。
3. **同步创建 `AgentClient` 并放入 `clients` Map**（`new AgentClient({ id, url, token })`，参照 `hub/server.cjs:46` 启动期一次性创建的模式），使下游 aggregator 轮询与 bridge 出站 WS 立即可用。
4. **回连探测反馈**：注册后首轮 aggregator 轮询若拉取失败（url 不可达），经该反向 WS 回送一帧 `{ "type": "unreachable", "url": "<报告的url>", "error": "<错误>" }`，单机日志醒目输出「hub 回连你的 url 失败，请检查 CC_WEB_PUBLIC_URL」，形成排障闭环（产品/需求 Important）。

### 4.4 在线状态与下线（online 语义裁决）

两个概念解耦，消除「双写者共用一个布尔」的歧义（需求 Critical）：

- **条目存在性 = 注册连接在连**：注册连接 OPEN 即条目存在于 registry；连接 `close` / `error` → 整条 `remove(id)` + `clients.get(id).close()` + `clients.delete(id)`。条目存活只由注册连接决定。
- **`online` 字段 = 看板可达性**：仍由现有 `DashboardAggregator` 的 `registry.setOnline(id, bool, error)`（`hub/dashboard_aggregator.cjs:42-57`、`registry.cjs:23`）按轮询可达性写入。于是「注册连接在、但 url 不可达」= 条目存在 + `online:false` + `lastError`，符合用户预期。

**hub 侧注册连接空闲超时**（防单机假死，需求 Important）：hub 对每条注册连接设空闲计时器，若 **60s**（3 倍 ping 周期）未收到任何消息（ping/register/pong），主动 `close` 该连接 → 触发单机重连重建。仅靠 TCP keepalive 在半开连接下可能等数分钟，应用层超时保证在线状态及时收敛。

**纯内存**：registry 仅存内存，hub 重启全清，靠单机重连自愈（见 §3.5、§8）。

### 4.5 MachineRegistry 改动

`hub/registry.cjs` 现有 `MachineRegistry` 构造时接收静态数组、仅支持 `setOnline`（`hub/registry.cjs:4-38`）。新增：

- `add(machine, conn)`：`_byId.set(id, { ...machine, online: false, lastError: null, conn })`（`online` 初值 false，交由 aggregator 首轮探测置位）。保持不可变风格（新对象替换）。`conn`（注册 WS 句柄）仅用于下线感知与 unreachable 回送，**不得出现在对外快照里**——现有 `all()` / `getById()` 的解构 `({ token, ...rest })`（`hub/registry.cjs:13,19`）需改为 `({ token, conn, ...rest })` 同步剥离 `conn`。
- `remove(id)`：`_byId.delete(id)`（关联 `clients` 由调用方清理）。
- `getSecret(id)`：保持返回 `{ id, name, url, token }`（**不含 conn**），`/jump` ticket 流（`hub/server.cjs:194-235` 依赖 `getSecret`）零影响。

注册处理器是运行时增删的唯一入口，保证 registry 与 clients Map、注册连接三者一致。

`DashboardAggregator`（`hub/dashboard_aggregator.cjs:42-57`）仍调 `registry.all()`，无需改动；bridge 的 `getClient`（`hub/server.cjs:460-469`）仍 `clients.get(mid)`，自动可用。

### 4.6 hub 关闭清理

现有 `close()`（`hub/server.cjs:508-521`）清理 aggregator/clients/wss/server。新增的注册处理器若持有「注册连接集合」与「空闲超时定时器」，需在 `close` 里一并释放（遍历关闭所有注册连接、清定时器），避免进程退出拖延。

## 5. hub-machines.json：deprecate 窗口（种子并存）

**不硬断崖废弃**（专家 Critical：v3.0.0 已把该文件写进 README 正式部署流程，全局用户 `npm i -g` 升级后若静默忽略，机器表清空、hub 静默成功却没机器——无信号破坏）。改为 deprecate 窗口：

- hub 启动时**仍加载** `hub-machines.json`（若存在）作为**初始静态种子**（`hub/server.cjs:41` 的 `loadMachines` 保留）。
- 若文件存在，启动打印醒目 **WARN**：「hub-machines.json 已 deprecated，将在后续版本移除；请改为在各单机配置 CC_WEB_HUB_URL + CC_WEB_HUB_TOKEN（详见 README 迁移指引）」。
- 静态种子与运行时注册**合并去重**：以 `id` 为键，运行时注册的机器覆盖同 id 静态项；静态种子机器在 hub 重启前一直保留（无连接也可被 aggregator 探测，行为同现状）。
- **稳定 1-2 个版本后**移除文件加载，届时再走正常 deprecate 流程（CHANGELOG 顶置 + README 删除）。

这样老用户升级后机器表不丢（种子兜底）+ 收到明确迁移信号，新用户用运行时注册，零破坏过渡。

## 6. 配置

均走现有 `config_loader.cjs`（env 与 config.json 都支持，env 优先）。

### 6.1 单机新增

| env | 必填 | 说明 |
|---|---|---|
| `CC_WEB_HUB_URL` | 启用注册则必填 | hub 的 http(s) URL，如 `http://hub-host:7685` |
| `CC_WEB_HUB_TOKEN` | 启用注册则必填（无 register token 时） | 回退注册凭据，也是看板登录 token |
| `CC_WEB_HUB_REGISTER_TOKEN` | 否 | 注册专用凭据，设置后注册用它、看板仍用 `CC_WEB_HUB_TOKEN`（分离注册权与看板权，见 §7） |
| `CC_WEB_MACHINE_ID` | 否 | 覆盖默认 hostname（多机环境强烈建议显式设置） |
| `CC_WEB_PUBLIC_URL` | 否 | 覆盖单机报告的可达 URL（NAT/反代必填） |
| `CC_WEB_MACHINE_NAME` | 否（MVP 可不暴露） | 覆盖显示名 |

### 6.2 hub

| env | 说明 |
|---|---|
| `CC_WEB_HUB_REGISTER_TOKEN` | 否；设置后注册连接必须用它鉴权，看板登录仍用 `CC_WEB_HUB_TOKEN` |

（`CC_WEB_HUB_TOKEN` 已有，`hub/server.cjs:39`。）

### 6.3 配置文件与文档同步

`config.example.json` 与 README「配置文件」字段清单需同步新增 `hubUrl` / `hubToken` / `hubRegisterToken` / `machineId` / `publicUrl`（`machineName` MVP 不暴露则不同步），保证可发现性（产品 Minor）。README「hub 多机模式」章节改写部署流程：从「编辑 hub-machines.json + 重启 hub」改为「各单机配 CC_WEB_HUB_URL + token 启动」，并保留迁移指引。

### 6.4 CLI

子命令不变。`cc-web-control`（单机）配了 hub url 即自动注册；`cc-web-control hub`（多机）接受注册。

## 7. 安全考量

### 7.1 token 模型与越权面（产品/需求 Important）

`CC_WEB_HUB_TOKEN` 原本只在 hub 单点持有（浏览器登录看板用）。本方案让它（或独立的 register token）落到每台单机才能注册——单机操作者拿到看板 token 即可登录 hub 看板，跨人协作时是事实上的越权面，token 轮换也从改 1 处变成改 N 处。

缓解：

- **默认**：spec/README 显式记录该 trade-off，提示「内网单用户可接受；多操作者或不可信网络应设置独立的 `CC_WEB_HUB_REGISTER_TOKEN`」。
- **可选强化**：设 `CC_WEB_HUB_REGISTER_TOKEN` 后，注册凭据与看板登录凭据分离，注册 token 泄露不等于看板被登录。

### 7.2 SSRF 攻击面（需求 Important）

注册把「可被 hub 主动请求的 url」从静态清单动态化了——持有注册凭据者可让 hub 主动 HTTP 轮询 / WS 连接其声明的任意 url。现有 `validateMachine` 的 SSRF 防护只挡 `169.254.169.254` 一个地址。

缓解：本期复用现有 `validateMachine` 校验，**在 spec/README 显式记录该攻击面**，并建议「注册凭据仅发给可信机器」。更强网段白名单校验列为未来增强，本期不做（YAGNI + 内网定位）。

### 7.3 明文 ws 泄露单机 token（需求 Important）

§3.2 用 `CC_WEB_HUB_URL.replace(/^http/,'ws')`：若 hub url 是 `http://`，注册帧 `{token: CC_WEB_AUTH_TOKEN}`（正是 hub→单机所有调用的 bearer 凭据）全程明文。

缓解：跨不可信网络部署须用 `https`/`wss`；单机启动时若检测到 `ws://` + 非 loopback 的 hub 地址，打印 WARN「注册流量明文，建议 hub 启用 https/wss」。

## 8. 生命周期与自愈

| 事件 | 单机侧 | hub 侧 |
|---|---|---|
| 单机启动 | 连 hub → 发 register | add 到 registry + 建 client |
| 正常运行 | 定时 ping 保活 | 条目存在；aggregator 轮询写 online；bridge 出站 WS 可用 |
| 单机重启 | 旧连接断 → 退避重连 → 重发 register | 旧连接 close → remove；新连接 register → 重新 add |
| 单机优雅退出 | SIGINT/SIGTERM → close(1001) | 即时 remove |
| hub 重启 | 连接断 → jitter 退避重连 → 重发 register | 内存表清空（静态种子保留）；重连后逐个恢复 |
| 网络抖动 | 短退避重连 | close → remove；恢复后重新 add |
| hub token 轮换/配错 | 收 close(1008) → 长退避 + ERROR，达上限停止 | 拒绝连接 |
| 单机假死（半开） | — | 60s 空闲超时 → close → 触发单机重连 |
| url 不可达 | 收 unreachable 帧 → 日志告警 | aggregator 探测失败 → 回送 unreachable + online:false |

## 9. 边界与冲突

### 9.1 重复 id

新 `register` 帧到达时若 `id` 已存在（且来自不同连接）：

- **策略：后者覆盖前者**。关闭旧注册连接（若仍 OPEN），用新连接的元数据（url/token/name）替换；`clients` Map 先 `clients.get(id)?.close()`（释放旧 `AgentClient` 的出站连池）再 `set` 为新实例。
- **理由**：单机重启时旧连接可能尚未被 hub 感知断开，「拒绝后者」会误伤合法重连；「后者覆盖」对重启是正确的，对抢 id 则是配置错误，靠 WARN 日志让运维发现。
- **抢占振荡告警**：hub 检测到同一 id 被不同连接短时间（如 1min 内）反复覆盖 ≥3 次时，WARN 告警「id `<x>` 疑似多机冲突，请相关单机显式设置 CC_WEB_MACHINE_ID」。

### 9.2 token 传递

注册帧携带的单机 `CC_WEB_AUTH_TOKEN`，作用等同旧静态清单里的 `token` 字段——hub→单机的所有 Bearer 调用（`/api/dashboard` 轮询、出站 WS）零改动。

### 9.3 职责边界

反向 WS **只**做注册 / 在线探测 / 自愈 / unreachable 反馈。看板与终端一律走 ②③。未来若要演进成「反向 WS 也推送终端数据」是另一条路，本期不做（YAGNI）。

## 10. 错误处理

| 场景 | 行为 |
|---|---|
| 单机连不上 hub | 短退避重连；不阻断 :7684 本地服务；日志记录 |
| hub 鉴权失败（1008） | 单机长退避 + ERROR 告警；连续达上限停止（见 §3.5） |
| 注册帧字段非法 | hub 拒绝 + close(1008)；单机侧日志告警（id 含非法字符、url 不合法等） |
| 单机 url 不可达 | hub 回送 unreachable 帧 + aggregator 标 online:false + lastError；不影响其他机器 |
| hub 侧连接空闲超时 | close 连接，触发单机重连 |

## 11. 成功指标（产品 Important）

- **加机端到端步数**：从「编辑 hub-machines.json + 重启 hub」降到「单机配 2 个 env 启动」。
- **hub 重启自愈率**：hub 重启后 30s 内，原在线单机的自愈重注册比例（目标趋近 100%）。
- **升级无感知破坏**：升级后关于 `hub-machines.json` 机器消失的求助量趋零（deprecate 种子兜底 + WARN）。
- **配置错误可观测**：url 不可达时 unreachable 告警能被单机侧看到（排障闭环可用）。

## 12. 不做（YAGNI）

### 12.1 不引入 Nacos 等外部注册中心

已评估：Nacos 能替代「注册 + 健康检查 + 列表变更通知」，但 (a) 引入 Java+DB 的重量级外部依赖，与本工具 `express + ws` 的轻量定位不符；(b) 单机 `CC_WEB_AUTH_TOKEN` 的安全传递需额外处理（instance metadata 对所有订阅者可见，有泄露风险）；(c) 数据通道仍要 hub 主动回连，Nacos 并不减负。除非已有 Nacos 集群否则不引入；未来可把「服务发现」抽象成接口、Nacos 作为可选后端。

### 12.2 为何不接受更轻的「热重载 hub-machines.json」或「hub add-machine CLI」（产品 Important ROI 论证）

这两条能去掉「手编 JSON」或「重启 hub」之一，但都**仍需人主动登记、无自动生命周期**：

- 热重载清单：加机要登 hub 改文件；机器宕机后清单仍列着、看板持续 offline。
- add-machine CLI：加机要人主动执行命令；同样无自动上下线。

反向注册的核心增量价值是**自动生命周期管理**（连接即在线、断即下线、宕机即从看板消失、恢复即自愈）——这是热重载/CLI 都做不到的，也是用户「自动发现」诉求的本质。因此值得引入反向 WS 的额外复杂度。

### 12.3 其他不做

- 不做多 hub 订阅同一组单机的协调。
- 不做基于 mDNS 的局域网零配置发现（跨网不可行，且单机仍需知 hub 地址）。
- 不做注册 url 的网段白名单校验（复用现有 SSRF 防护 + 文档化，见 §7.2）。
- 不做持久化随机 id 后缀（见 §3.3 未来增强）。

## 13. 测试策略

沿用项目 `node --test test/*.test.cjs`（`package.json:26`）。

- **单机 client**（`test/register-client.test.cjs`）：连不上短退避重连、1008 长退避 + 达上限停止、1006/1011 短退避、成功后计数清零、jitter 存在性、注册帧字段与 id/url 推导、ping 保活、未配 hub url 时不启动、SIGINT 优雅 close、配置变更需重启。
- **hub 注册 server**（`test/hub-register-server.test.cjs`）：Bearer 鉴权拒绝（无/错 token，close 1008）、register 写入 registry + clients、断开移除、重复 id 后者覆盖 + 抢占振荡告警、路径分流（`/api/hub/agent` vs 浏览器路径）、60s 空闲超时 close、unreachable 帧回送。复用 `test/stub_machine.cjs` 思路构造假单机。
- **安全用例**（需求 Important）：register 帧 url 含 `169.254.169.254` 被拒；id 含 `/` 或超长被拒；`/api/machines`（或等价 snapshot 端点）既不含 `token` 也不含 `conn`；未授权注册被 close 1008；register token 设置后看板 token 不能用于注册。
- **集成**（`test/hub-register-e2e.test.cjs`）：单机注册后 hub 能轮询到看板、能经 bridge 出站 WS 连其终端；hub 重启后单机 jitter 重连自愈；deprecate 种子：hub-machines.json 存在时作为种子加载 + 打印 WARN + 与运行时注册去重。

## 14. 接入点速查（实现时对照）

| 关注点 | 位置 |
|---|---|
| hub WS 装配（路径分流入口） | `hub/server.cjs:454, 472-489` |
| hub 启动期 machines→registry→clients（deprecate：保留 loadMachines 作种子） | `hub/server.cjs:41-46` |
| aggregator fetchOne（无需改，写 online） | `hub/server.cjs:48-58` |
| bridge getClient（无需改） | `hub/server.cjs:460-469` |
| MachineRegistry 增删 + conn 剥离 | `hub/registry.cjs:4-38`（新增 add/remove，改 all/getById 解构） |
| 机器校验规则（复用） | `hub/config.cjs:7-32` `validateMachine` |
| 重连退避模式（参考，需加清零/jitter/分叉） | `hub/agent_client.cjs:106-114` |
| hub 入口（machinesFile 保留 + deprecate WARN） | `hub/server_entry.cjs:25, 36` |
| hub close（纳入注册连接/定时器清理） | `hub/server.cjs:508-521` |
| 单机 server 入口（挂载 register client + SIGINT 钩子） | `server.cjs` |
| 配置加载（单机 schema 加 hub url/token/registerToken/machineId/publicUrl） | `config_loader.cjs` |
| config.example.json + README 字段同步 | `config.example.json`、`README.md` |
| CLI 子命令（不变） | `bin/cc-web-control.cjs:38-56` |
