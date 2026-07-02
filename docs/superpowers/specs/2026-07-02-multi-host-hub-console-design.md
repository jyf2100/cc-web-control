# 多机统一控制台(Hub)— 一期设计

- 日期: 2026-07-02
- 状态: 待审阅
- 范围: **一期 = 人控多机**(§1–§5)。**二期「主控 agent」**(§6)见末尾「二期展望」,不在本期。

---

## 1. 背景与目标

cc-web-control 现为**单机单进程**:一个 Express+WS 服务 ↔ 本机 tmux ↔ 一个 `claude`。已具备「单机多会话看板」(`/api/dashboard` 聚合本机所有 tmux 会话状态)。

用户有**多台机器(全在同一内网)**,想从一个界面同时:

1. **监控** —— 一眼看全所有机器所有会话的执行状态;
2. **切换操控** —— 在一个界面快速切到某台某会话去对话;
3. **批量广播** —— 多选若干会话(可跨机),把同一条指令发给它们(每会话是独立 claude,各自响应)。

本期交付一个**中心 Hub 服务**,把多机聚合成单一入口。

---

## 2. 范围

### 2.1 一期做
- Hub(同包新子命令 `cc-web-control hub`)、机器清单、三层鉴权
- 全局看板聚合、单会话终端代理、多选批量广播

### 2.2 不做(YAGNI)
- ❌ 多用户/权限分级(个人使用)
- ❌ 跨网络隧道(全内网,hub 直连各机 IP)
- ❌ 会话内容 diff 同步(各 claude 独立,只广播输入)
- ❌ Hub 高可用/集群(单进程)
- ❌ 主控 agent(二期)

---

## 3. 架构总览(§1)

```
🌐 浏览器 ── 单 WS + 单 token ──►  Hub(cc-web-control hub)
                                    ├─ auth(hub token,复用根 auth.cjs)
                                    ├─ registry(机器清单 + 健康检查)
                                    ├─ dashboard_aggregator(轮询各机 → 全局看板)
                                    ├─ ws_bridge(终端代理 + 批量扇出)
                                    └─ agent_client × N(每机:HTTP + WS 客户端)
                                              │
                                    ▼ 各机已有接口,几乎零改动 ▼
                              机器A / 机器B / 机器C(cc-web-control 实例)
                              各自:/api/dashboard + WS + /api/sessions
```

**关键决策:**
- **Hub = 同包新子命令**(非独立包),复用根 `auth.cjs` 与前端 UI。
- **各机 cc-web-control 零改动**:hub 只调各机**已存在**的接口 —— `GET /api/dashboard`、WS(`?session=`)、`GET/POST/DELETE /api/sessions`。hub 作为服务端客户端不带 `origin` 头,各机 `isSameOrigin` 对空 origin 放行,故各机无需任何改动(见 §4.3)。
- **浏览器只连 hub**:单一入口、单一 token,不感知背后机器数量。

---

## 4. 机器清单与鉴权(§2)

### 4.1 机器清单
Hub 通过 JSON 文件得知有哪些机器,默认路径 `~/.cc-web-control/hub-machines.json`(可用 `CC_WEB_HUB_MACHINES_FILE` 覆盖),文件权限 **0600**(内含各机 token):

```json
{
  "machines": [
    {"id":"mc1","name":"MacBook",  "url":"http://192.168.1.10:7684","token":"<该机 CC_WEB_AUTH_TOKEN>"},
    {"id":"mc2","name":"开发服",   "url":"http://192.168.1.20:7684","token":"<该机 CC_WEB_AUTH_TOKEN>"}
  ]
}
```

字段约束(校验失败 → hub **fail-fast** 退出,不静默):
- `id`:稳定标识,正则 `^[A-Za-z0-9._-]{1,32}$`,**禁止含 `/`**(全局会话键分隔符);同清单内唯一。
- `name`:显示名。
- `url`:各机 cc-web-control 的内网地址(含端口,如 `http://192.168.1.10:7684`)。
- `token`:各机的 `CC_WEB_AUTH_TOKEN`。

**全局会话键** = `{machineId}/{sessionName}`,如 `mc1/claude-web-session`,贯穿三条数据流。

### 4.2 三层鉴权
1. **浏览器 → hub**:hub 自己的 `CC_WEB_HUB_TOKEN`,复用根 `login.html` + `auth.cjs` + cookie(`cc_web_auth`),登录一次。
2. **hub → 各机**:hub 用清单里每台的 `token`,以 `Authorization: Bearer <token>` 调各机 HTTP 与 WS(各机 `auth.cjs` 已支持 authorization header)。
3. **各机对内网暴露**:各机设 `CC_WEB_HOST=0.0.0.0` + 必开 `CC_WEB_AUTH_TOKEN`(裸奔危险)。

### 4.3 各机零改动(hub 连接鉴权)
各机在开了 token 时,对 **POST/DELETE `/api/sessions`** 和 **WS 连接**有同源校验(`server.cjs:266` 与 `server.cjs:523`),调用 `auth.isSameOrigin`。但该函数对**空 origin 返回 `true`**(非浏览器客户端放行,见 `auth.cjs:54`)。

hub 是 Node 服务端客户端(`fetch` / `ws`),**默认不发送 `origin` 头**(origin 由浏览器自动添加)。各机读到的 `origin` 为空 → 校验直接通过。**结论:各机代码与配置零改动**,hub 只需带 `Authorization: Bearer <token>`(各机 `isAuthorized` 已支持)。

> 各机仍须设 `CC_WEB_HOST=0.0.0.0` 才能被内网访问、必开 `CC_WEB_AUTH_TOKEN`;安全由 token 把关,origin 校验对 hub 这类非浏览器客户端天然放行。

---

## 5. 数据流(§3)

全局键 `machine/session` 贯穿三流。

### 5.1 监控聚合(全局看板)
- Hub `dashboard_aggregator` 每 `CC_WEB_HUB_DASHBOARD_INTERVAL_MS`(默认 2000ms)并发 `GET {各机url}/api/dashboard`。
- 合并为全局 payload,供浏览器 **2s 轮询** hub 的 `GET /api/global-dashboard`(与现有单机看板轮询模型一致;终端 IO 才走 WS)。
- hub **不重算 status**,直接复用各机已算好的 `waiting/working/idle/errored/unknown`。
- 单机失败 → 该机标记 `online:false`,不影响其它机与整体 payload(继承各机「看板绝不 500」的韧性)。

全局 payload:
```json
{
  "machines": [
    {"id":"mc1","name":"MacBook","online":true,
     "sessions":[
       {"name":"claude-web-session","cwd":"/path","status":"working",
        "lastLine":"editing server.cjs…","lastTs":1782953000,"attached":false}
     ]}
  ]
}
```

### 5.2 切换操控(单会话终端代理)
- 浏览器开**一条**到 hub 的 WS,发送 `{type:'attach', target:{machine,session}}` 订阅某会话。
- Hub `ws_bridge` 命中该机的 `agent_client`,`agent_client` 维护 **per-session WS 池(懒连接)** 到该机 `ws://{url}/?session=...`(带 `Authorization: Bearer <token>`;hub 不发 origin 头,各机对空 origin 放行),双向转发:
  - 各机 → hub:`init`/`output`/`error` → hub 加 `target` 转发给浏览器;
  - 浏览器 → hub:`input`/`key`/`batch` → hub 透传到对应 agent WS。
- 切换 = `detach` 旧的 + `attach` 新的。agent WS **按 target 计引用计数**(同一 target 被多个浏览器 attach 时共享一条连接);引用归零即关闭,不额外保活(重新 attach 再懒连接)。

### 5.3 批量广播(多选扇出)
- 浏览器发 `{type:'broadcast', targets:[{machine,session},...], data, enter}`(targets 上限 50,与各机 batch 上限一致)。
- Hub `ws_bridge` 对每个 target,经对应 `agent_client` 取得 WS(**该 target 已被某浏览器 attach 则复用同一条;否则临时建连、发完即关**)并发送 input;**hub 一次扇出**。
- 每会话是独立 claude 上下文,各自响应;hub 回 `{type:'broadcast_result', results:[{target,ok,error?}]}`。

### 5.4 浏览器 ↔ Hub WS 协议(契约)

浏览器 → hub:
| type | 字段 | 说明 |
|---|---|---|
| `attach` | `target:{machine,session}` | 订阅某会话终端 IO |
| `detach` | — | 取消订阅当前会话 |
| `input` | `target,data,enter` | 给当前会话发输入 |
| `key` | `target,data` | 发特殊键(限各机 `allowedKeyNames`) |
| `batch` | `target,data[]` | 批量键入(≤50) |
| `broadcast` | `targets[],data,enter` | 多会话扇出 |

hub → 浏览器:
| type | 字段 | 说明 |
|---|---|---|
| `init` | `target,data` | attach 成功,初始屏幕 |
| `output` | `target,data` | 终端输出增量 |
| `error` | `target,data` | 该会话错误 |
| `broadcast_result` | `results[]` | 扇出逐 target 成败 |

广播独立于 attach(广播不改变当前 attach 的会话)。

---

## 6. 前端布局(§4)

整合态单页面(hub 提供的新页面,如 `public/console.html`),一屏含三区,复用现有 `dashboard.css` + 终端样式:

1. **全局看板**(顶部):扁平表,每行一个会话,列 = `[多选框] 机器/会话 · 状态(色块) · 最后输出`;2s 轮询刷新;状态色复用现有语义(`working`绿/`waiting`黄/`idle`灰/`errored`红/`unknown`暗)。
2. **终端**(中部):点击看板任一行 → `attach` 该会话,终端区切换;复用现有终端渲染(`client.js`/`modules/*`),仅 WS target 从 `{session}` 改为 `{machine,session}`。
3. **广播栏**(底部,多选 ≥2 时出现):显示「已选 N 个会话」+ 输入框 + `扇出` 按钮。

机器/会话的 REST 操作(新建/删除会话)经 hub 代理(见 §9)。

---

## 7. 错误处理(§5)

- **某机离线**:`registry` 健康检查(随 dashboard 轮询)标 `online:false`,看板该机灰显;`attach` 返回 `error`;广播该 target 记 `fail`。
- **agent WS 断开**:自动重连(指数退避,上限 30s),向相关浏览器推 `{type:'error',target,...}`。
- **广播部分失败**:回 `broadcast_result`,每个 target 独立 `ok|error`;前端逐条显示。
- **清单解析失败**(id 含 `/`、缺 url/token、id 重复):hub 启动 **fail-fast** 报错退出。
- **某机 token 错/无权限**:聚合标 `online:false` + 原因,不影响其它机。
- 继承各机「dashboard 绝不 500、降级空 payload」韧性;hub 聚合不因单机失败而整体崩。

---

## 8. 测试策略(§5)

TDD,80%+,沿用 `node --test test/*.test.cjs`。

**纯函数单测:**
- `config`:清单解析(合法 / id 含 `/` / 缺字段 / id 重复)、文件权限。
- `dashboard_aggregator`:多机 payload 合并、单机失败降级、`online` 判定、合并后 session 键带 `machineId`。
- `registry`:健康状态机、离线判定。
- `ws_bridge`:target 解析、`broadcast` targets 去重与上限(>50 拒绝)、`attach`/`detach` 引用计数。

**集成测(stub agent):** 起 N 个 stub(fake `GET /api/dashboard` + fake WS),验证:
- 聚合输出正确;
- 终端双向代理(浏览器 WS ↔ agent WS 的 input/output 转发);
- 扇出 + 部分失败(`broadcast_result`);
- 鉴权:hub token 校验、agent token 透传、未授权 401/关闭。

**回归保护:** 单测 `auth.isSameOrigin(undefined, ...)` 返回 `true`(确保 hub 这类非浏览器客户端不会被各机 origin 校验误拦)。

---

## 9. 组件与接口

Hub 侧(新增,建议放 `hub/` 目录):
| 文件 | 职责 |
|---|---|
| `hub/server.cjs` | hub 的 HTTP+WS 服务(对浏览器),复用根 `auth.cjs` |
| `hub/config.cjs` | 解析+校验机器清单(JSON 文件),fail-fast |
| `hub/registry.cjs` | 机器清单持有 + 健康检查 + `online` 状态 |
| `hub/dashboard_aggregator.cjs` | 并发轮询各机 `/api/dashboard` → 合并 payload(纯函数 `mergeDashboards` 可单测) |
| `hub/agent_client.cjs` | 每机一个:HTTP 客户端 + per-session WS 池(懒连接、重连) |
| `hub/ws_bridge.cjs` | 浏览器 WS ↔ agent WS 代理 + 扇出 + 引用计数 |

Hub 对浏览器的 REST:
- `GET /api/config` — hub 配置
- `GET /api/global-dashboard` — 聚合看板
- `GET /api/machines` — 机器清单 + online
- `POST /api/sessions` `{machine,name,cwd}` — 代理到该机 `POST /api/sessions`
- `DELETE /api/sessions/:machine/:name` — 代理到该机 `DELETE /api/sessions/:name`

各机改动:**无**(见 §4.3)。

bin:
- `cc-web-control hub` 子命令(在 `bin/cc-web-control.cjs` 分发,或新 bin `cc-web-control-hub`)。

---

## 10. 配置项

Hub:
- `CC_WEB_HUB_TOKEN` — hub 鉴权 token(必设,否则裸奔)
- `CC_WEB_HUB_MACHINES_FILE` — 机器清单路径(默认 `~/.cc-web-control/hub-machines.json`)
- `CC_WEB_HUB_HOST` — 监听地址(默认 `127.0.0.1`)
- `CC_WEB_HUB_PORT` — 端口(默认 `7685`,避开各机默认 7684)
- `CC_WEB_HUB_DASHBOARD_INTERVAL_MS` — 聚合轮询间隔(默认 2000)

各机:无新增配置(见 §4.3)。

---

## 11. 验收标准(一期)

1. hub 能从清单连上 ≥2 台内网机器,`/api/global-dashboard` 返回所有机器所有会话状态。
2. 点击看板某行 → 切到该会话终端,能双向交互(input/output 实时)。
3. 多选 ≥2 会话 + 广播栏输入 → 各会话各自收到指令,UI 显示每个 target 成败。
4. 关闭某机 → 该机看板标 `offline`,其余机器与会话不受影响;该机恢复后自动重连。
5. 全程单 token 登录;未授权请求被拒。
6. 各机代码与配置零改动,原有单机用法零回归。
7. 测试覆盖率 ≥ 80%。

---

## 12. 二期展望:主控 agent(§6,不在本期)

二期引入一个 **AI 调度者**(和「人」并列的指挥者),持续监控所有会话、分析、下发指令。**待一期稳定后** 单独 brainstorm 成 spec。当前记录的默认方向(供二期起点):

1. 自主程度 = **审批后执行**(建议指令需人批准;claude 指挥 claude 有失控/成本风险)。
2. 监控依据 = **状态为主 + 按需读输出尾部**(控 token)。
3. 触发 = **事件优先**(errored/idle/waiting 触发)+ 人手动唤起 + 可选定时。
4. 形态 = **hub 上的一个 claude 实例**,带工具:`list_sessions` / `read_session` / `send_instruction`。
5. 安全护栏:扇出上限、危险操作强制审批、频率/成本预算、全程可审计日志、一键冻结。
