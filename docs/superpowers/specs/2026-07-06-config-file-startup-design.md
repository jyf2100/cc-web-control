# 配置文件启动设计(7684 单机 + 7685 hub)

> 日期:2026-07-06
> 状态:待审(brainstorm → spec)
> 关联:三页面(2026-07-05-7685-command-deck-design.md)的部署侧补充

## 1. 背景与目标

### 现状
- **7684 单机** `server.cjs`:12+ 个 `CC_WEB_*` 环境变量(PORT/HOST/SESSION/AUTH_TOKEN/PROJECT_ROOTS/CAPTURE_HISTORY/POLL_INTERVAL/CLAUDE_CONTINUE/NO_OPEN/NO_ATTACH/WEB_ONLY/LOGIN_MAX/LOGIN_WINDOW_MS/DASHBOARD_INTERVAL_MS/WS_PING_INTERVAL)
- **7685 hub** `hub/server_entry.cjs`:`CC_WEB_HUB_*` env + 已有 `CC_WEB_HUB_MACHINES_FILE`(默认 `~/.cc-web-control/hub-machines.json`)
- 已可复用:`hub/config.cjs` 的 `loadMachines()` —— 成熟的「JSON 加载+校验+容错」范式;`~/.cc-web-control/` 已是约定目录;`main_agent_config.cjs` 已有 `0o600` 文件权限先例

### 痛点
启动要敲一长串 env;token 散落 shell 历史 / 进程列表;无单处固化配置。

### 目标
- 7684 / 7685 读本地 JSON 配置文件启动
- env 保留作覆盖逃生口(CI / 临时调试)
- 复用 `hub/config.cjs` 的 `loadMachines` 范式

### 非目标
- 热重载(改配置不重启)
- JS / TOML / YAML 配置(选 JSON,零依赖)
- `init-config` 模板生成命令
- 远程 / 集中配置
- **MCP 子进程 env 不纳入**:`hub/mcp/stdio.cjs` 读的 `CC_WEB_HUB_URL` / `CC_WEB_HUB_TOKEN` 由 claude 经 `.mcp.json` 注入(独立进程生命周期),不走 config 文件加载

## 2. 方案选型

已 brainstorm 三方案(JSON / .env / JS),用户选 **A:JSON 文件 + env 覆盖**。理由:零新依赖、复用 `loadMachines` 校验范式、与 `hub-machines.json` 心智连贯、env 逃生口保留。

三方案对比要点:
- **A. JSON + env 覆盖**(选定):零依赖、有校验、env 逃生口、与 hub-machines.json 一致;缺点是 JSON 不能写注释。
- **B. .env + 现有 env 机制**:加载层零改动、迁移最无痛;缺点是引入 dotenv 依赖、无类型校验。
- **C. JS 配置 + schema + 热重载**:最灵活;缺点是配置即代码(注入风险)、最重、over-engineering。

## 3. 架构

### 3.1 文件布局(两份独立,已定)
- `~/.cc-web-control/config.json` —— 7684 单机
- `~/.cc-web-control/hub-config.json` —— 7685 hub
- `--config <path>` flag 覆盖路径(两入口都支持);不传 = 上述默认

### 3.2 优先级(每字段)
```
env 显式设置  >  文件值  >  代码默认
```
loader 读文件返回 `cfg`;各字段读取处:`process.env.X !== undefined ? process.env.X : (cfg.field ?? DEFAULT)`。

注:用 `!== undefined` 而非 `??` —— env 显式设为空串 `''` 仍算「已设置」,对齐现有代码 `process.env.X || ''` 口径,避免空串意外回退到文件值。

**向后兼容**:无配置文件 → 纯 env / 默认 = 现状行为不变。

### 3.3 新组件
| 组件 | 位置 | 职责 |
|---|---|---|
| `config_loader.cjs` | 根(7684/7685 共享) | `loadConfig({ filePath, schema, env })` → `{ config, warnings }`;JSON.parse 容错 + 字段校验 + 权限检测 |
| schema | 并入 `config_loader.cjs` | `SINGLE_SCHEMA`(7684)+ `HUB_SCHEMA`(7685):字段名(camelCase)/ 类型 / env 映射 / 默认 / 校验 |

复用:照搬 `hub/config.cjs` 的 `loadMachines`(JSON.parse + 容错 + validateMachine)模式为 `loadConfig`。`loadMachines` 本身不动(向后兼容)。

### 3.4 接入点(最小侵入)
- **7684** `server.cjs`:顶部 `const { config: cfg, warnings } = loadConfig({ filePath, schema: SINGLE_SCHEMA, env: process.env })`;现有 `const PORT = Number.parseInt(process.env.CC_WEB_PORT || '', 10) || 7684` 改为 `?? cfg.port` 合并(env 优先)
- **7685** `hub/server_entry.cjs`:`startHub({ ... })` 调用前 `loadConfig(HUB_SCHEMA)`,合并到 startHub 入参

## 4. 数据流

```
启动(bin/cc-web-control.cjs 解析 --config)
  → server.cjs / server_entry.cjs 顶部 loadConfig()
    → 读文件(不存在→默认;存在→JSON.parse)
    → 校验(类型 / 端口范围 / projectRoots 数组)
    → 权限检测(stat.mode & 0o077 且含 token → warnings)
  → 返回 { config, warnings }
  → 各字段读取:env ?? config.field ?? DEFAULT
  → 打印 warnings(若有)
  → 启动 server / hub
```

## 5. 配置 schema

### 5.1 7684 config.json(camelCase)
| 字段 | 类型 | env | 默认 | 校验 |
|---|---|---|---|---|
| port | number | CC_WEB_PORT | 7684 | 整数 1-65535 |
| host | string | CC_WEB_HOST | 127.0.0.1 | 非空 |
| session | string | CC_WEB_SESSION | claude-web-session | `/^[A-Za-z0-9._-]{1,64}$/` |
| authToken | string | CC_WEB_AUTH_TOKEN | '' | — |
| projectRoots | string[] | CC_WEB_PROJECT_ROOTS(逗号分) | [] | 数组,每元素 string |
| captureHistory | string | CC_WEB_CAPTURE_HISTORY | '' | 透传 `tmux.parseCaptureHistory`(空/非法/负→0,正整数 N→N 行 scrollback);config 层不做数值校验,由下游 parseCaptureHistory 容错 |
| pollInterval | number | CC_WEB_POLL_INTERVAL | 100 | >0 |
| claudeContinue | bool | CC_WEB_CLAUDE_CONTINUE('1') | false | — |
| noOpen | bool | CC_WEB_NO_OPEN | false | — |
| noAttach | bool | CC_WEB_NO_ATTACH | false | — |
| webOnly | bool | CC_WEB_WEB_ONLY | false | — |
| loginMax | number | CC_WEB_LOGIN_MAX | 5 | >0 |
| loginWindowMs | number | CC_WEB_LOGIN_WINDOW_MS | 900000 | >0 |
| dashboardIntervalMs | number | CC_WEB_DASHBOARD_INTERVAL_MS | 2000 | >0 |
| wsPingInterval | number | CC_WEB_WS_PING_INTERVAL | 30000 | >0 |

bool 约定:文件里 `true`/`false`;env 里 `'1'` = true(对齐现有 `CC_WEB_* === '1'` 口径)。

### 5.2 7685 hub-config.json
| 字段 | 类型 | env | 默认 |
|---|---|---|---|
| host | string | CC_WEB_HUB_HOST | 127.0.0.1 |
| port | number | CC_WEB_HUB_PORT | 7685 |
| intervalMs | number | CC_WEB_HUB_DASHBOARD_INTERVAL_MS | 2000 |
| machinesFile | string | CC_WEB_HUB_MACHINES_FILE | `~/.cc-web-control/hub-machines.json` |
| hubToken | string | CC_WEB_HUB_TOKEN | '' |
| noOpen | bool | CC_WEB_HUB_NO_OPEN | false |
| loginMax | number | CC_WEB_LOGIN_MAX | 5 |
| loginWindowMs | number | CC_WEB_LOGIN_WINDOW_MS | 900000 |
| mainAgentMax | number | CC_WEB_MAIN_AGENT_MAX | 6 |
| mainAgentWindowMs | number | CC_WEB_MAIN_AGENT_WINDOW_MS | 60000 |
| mainAgent | object | 见下表 | 见下表 |

**mainAgent 子段**(`config.mainAgent.*`,协同 `hub/main_agent_env.cjs` 的 `resolveMainAgentConfig`):

| 子字段 | 类型 | env | 默认 | 校验 |
|---|---|---|---|---|
| enabled | bool | CC_WEB_HUB_MAIN_AGENT_ENABLED('1') | false | — |
| session | string | CC_WEB_HUB_MAIN_AGENT_SESSION | (代码默认) | — |
| claudePath | string | CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH | (代码默认) | — |
| dataDir | string | CC_WEB_HUB_MAIN_AGENT_DATA_DIR | `~/.cc-web-control/main-agent` | — |
| auditFile | string | CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE | (代码默认) | — |
| settleMs | number | CC_WEB_HUB_MAIN_AGENT_SETTLE_MS | 60000 | >0 |
| maxSettleMs | number | CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS | 900000 | >0 |
| backoffBase | number | CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE | 2 | >0 |
| staleBump | number | CC_WEB_HUB_MAIN_AGENT_STALE_BUMP | 1 | >0 |

**协同机制(B2)**:loader 把 `config.mainAgent.*` 映射回虚拟 env(`enabled:true` → `CC_WEB_HUB_MAIN_AGENT_ENABLED='1'`;数值 → 字符串),与真实 `process.env` 合并(env 仍优先),整体传 `resolveMainAgentConfig(mergedEnv)`。`resolveMainAgentConfig` **零改动**,config 与 env 走同一入口。

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 文件不存在 | 静默 fallback 纯 env / 默认(向后兼容,不报错) |
| JSON 解析失败 | `throw` 明确错误(含文件路径 + 解析错误)→ 进程退出 |
| 字段类型错(port 非数字等) | `throw` |
| 端口越界(非 1-65535) | `throw` |
| projectRoots 非数组 / 元素非 string | `throw` |
| 未知字段 | 忽略(向前兼容)+ **warning 提示字段名**(帮发现拼写错误,如 `authoken`) |
| machinesFile 路径不存在 | 委托 `loadMachines` 报错(config 层不重复校验) |
| 权限过松(含 token 且 group/other 可读) | warnings(不阻断),启动日志打印建议 `chmod 600` |

## 7. 安全

- token(`authToken` / `hubToken`)明文存 config 文件 → loader 检测权限过松时**警告继续**(已定,不 enforce `0o600`,避免卡现有用户)
- token 不回显日志 / 错误信息(loader 返回的 warnings 不含 token 值)
- `~/.cc-web-control/` 不在 repo 内;若用户把 config 放项目内,文档提醒加 `.gitignore`
- 文档提供 `chmod 600 config.json` 命令

## 8. 测试计划(TDD)

`config_loader.cjs` 纯函数,易测。新建 `test/config_loader.test.cjs`:

**loader 核心**:
- 文件不存在 → 返回默认值,无 throw,无 warnings
- 文件存在 → 各字段正确读取
- env 显式设置 → 覆盖文件值
- 坏 JSON → throw 含文件路径
- port 非数字 → throw
- port 越界(0 / 70000)→ throw
- projectRoots 非数组 → throw
- 未知字段 → 忽略不报错
- 权限过松 + 含 token → warnings 含权限项(mock `fs.statSync` 返回 mode)
- warnings 不含 token 值(安全)

**schema**:
- 7684 SINGLE_SCHEMA:全字段映射 + 默认值
- 7685 HUB_SCHEMA:全字段映射 + 默认值

**接入(集成)**:
- server.cjs:config.json 的 port 经 env 覆盖(file=8000, CC_WEB_PORT=9000 → 9000)
- server_entry.cjs:hub-config.json 同理

**回归**:
- 无 config 文件时,现有 `test/*.test.cjs` 全绿(向后兼容不破坏)

## 9. 迁移与文档

- 完全向后兼容:无 config 文件 = 现状
- README 加「配置文件」段:两文件路径 + 字段表 + `chmod 600` + 模板
- 用户可逐步把启动 env 迁进 config.json

## 10. 风险与边界

- **JSON 无注释**:配置项多时无法 inline 文档。缓解:README 字段表 + 配套 `config.example.json` 模板(注释走 README)。
- **token 明文**:本质与 `.env` / `hub-machines.json` 同级风险;权限警告 + chmod 建议 + 不回显日志三层缓解。不接受则保留 env 方式(env 也明文,但可在 CI secret 注入)。
- **两文件漂移**:若用户 7684/7685 都跑,维护两份。可接受(两部署形态字段差异大,统一反耦合)。
