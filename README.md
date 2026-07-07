# Claude Code Web

通过 Web 页面对话形式控制本地 Claude Code，实现双向同步：Web 输入发送给 Claude Code，Claude Code 输出显示在 Web 上。

另支持 **hub 多机模式**：一条 `cc-web-control hub` 子命令聚合多台机器的 cc-web-control，提供统一看板、点卡片新标签直达任一单机、多选批量广播。详见下文 [hub 多机模式](#hub-多机模式)。

## 快速开始

```bash
# 方式一：无需安装，直接运行
npx cc-web-control

# 方式二：全局安装后使用
npm install -g cc-web-control
cc-web-control
```

### 前置依赖

本工具在本机通过 tmux 操控 `claude` CLI，运行前请确保已安装：

- **Node.js** ≥ 18
- **tmux**（macOS: `brew install tmux`；Ubuntu: `sudo apt install tmux`）
- **Claude Code CLI**（已完成 Claude 登录认证）

首次启动若缺少依赖，程序会打印安装提示并退出（exit code 1）。

> 部署与运维入口：`docs/部署使用文档.md`  
> 完整中文手册：`docs/操作手册.md`

## 功能特性

- **自动启动 Claude Code**: `npm start` 自动创建 tmux 会话并启动 Claude Code
- **对话式界面**: Web 端以聊天形式与 Claude Code 交互
- **实时双向同步**: WebSocket 实时同步终端内容
- **深色主题**: 类似 Claude Code 的深色界面风格
- **单行输入**: Enter 发送（当前输入框为单行）
- **补全/命令面板按键**: 支持 `Tab` 补全、`↑/↓` 选择、`Esc` 退出（输入框为空时发送按键）
- **多机 hub 聚合**: `cc-web-control hub` 子命令聚合 N 台机器，统一全局看板 / 点卡片新标签直达单机 / 多选批量广播

## 技术架构

```
┌─────────────┐      WebSocket       ┌─────────────┐      tmux cmd      ┌─────────────┐
│  浏览器      │  ◄────────────────►  │  Node.js    │  ◄──────────────►  │    tmux     │
│ (对话界面)   │    实时双向通信       │  (服务端)    │   capture-pane    │  claude-web │
│             │                      │             │   send-keys       │   -session  │
└─────────────┘                      └─────────────┘                   └─────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
cd <项目目录>/cc-web-control
npm install
```

### 2. 启动服务

```bash
npm start
```

服务将在 http://localhost:7684 启动，并自动打开浏览器。

### 3. 使用说明

1. 在底部输入框输入消息
2. 按 **Enter** 发送消息给 Claude Code
3. Claude Code 的回复将实时显示在对话区域
4. **补全/命令面板**：
   - `Tab`：发送给 tmux 用于补全
   - 输入框为空时：`↑/↓/Esc/Enter` 会作为按键发送给 tmux（用于在面板里移动/确认/退出）

## 文件结构

```
tmux-web-control/
├── package.json          # 项目配置
├── server.js             # HTTP + WebSocket 服务
├── tmux.js               # tmux 控制封装
├── claude-wrapper.sh     # Claude Code 启动包装脚本
├── README.md             # 项目说明
└── public/
    ├── index.html        # 页面结构
    ├── style.css         # 对话式界面样式
    └── client.js         # 前端逻辑
```

## 关键技术

| 组件 | 用途 |
|------|------|
| `tmux capture-pane -p` | 捕获 Claude Code 输出 |
| `tmux send-keys` | 向 Claude Code 发送输入 |
| `WebSocket` | 实时双向通信 |
| `claude-wrapper.sh` | 绕过嵌套会话检测 |

## 数据流

1. **输入方向**: Web 输入 → WebSocket → `send-keys` → tmux → Claude Code
2. **输出方向**: Claude Code → tmux → `capture-pane` → WebSocket → 对话界面

## 环境要求

- Node.js >= 18
- tmux >= 3.0
- Claude Code CLI 已安装
- 现代浏览器（支持 WebSocket）

## 注意事项

- 启动时会自动创建名为 `claude-web-session` 的 tmux 会话
- 通过 `claude-wrapper.sh` 绕过 Claude Code 的嵌套会话检测
- WebSocket 实时捕获会话内容（每 100ms）
- 关闭服务端不会终止 Claude Code 会话（会话保持运行）

## 项目切换（多项目/多会话）

这个工具的“项目”本质上对应一个 tmux session（每个 session 可在不同目录启动 `claude`）。

### 1) 开启项目列表（推荐）

设置允许扫描的项目根目录（逗号分隔）：

```bash
export CC_WEB_PROJECT_ROOTS="<项目父目录>"
```

启动服务后，页面顶部会出现 `Project` 下拉框，选择项目并点击 `启动` 会：

- 创建一个新会话（会话名形如 `claude-<project>`）
- 在该项目目录里启动 `claude`

### 2) 手动切换会话

页面顶部 `Session` 下拉框可直接切换到其它 tmux session。

也可以通过 URL 参数指定：

```
http://127.0.0.1:7684/?session=claude-web-session
```

## “/” 命令面板

Claude Code 有些交互会在输入 `/` 后弹出命令面板（不一定需要回车）。

本项目默认会在你只输入 `/` 并回车发送时，**仅发送 `/` 不附带 Enter**，避免把 `/` 当作一条完整命令提交。

## 配置项（环境变量 / 启动参数）

- `CC_WEB_HOST`：监听地址（默认 `127.0.0.1`）
- `CC_WEB_PORT`：端口（默认 `7684`）
- `CC_WEB_SESSION`：默认会话名（默认 `claude-web-session`）
- `CC_WEB_POLL_INTERVAL`：输出轮询间隔 ms（默认 `100`）
- `CC_WEB_CAPTURE_HISTORY`：控制台可回看的 tmux scrollback 历史行数。未设/`0`=原行为（只抓当前可见屏）；正整数 N=抓当前屏 + 往上 N 行（受 tmux `history-limit` 上限约束，默认 2000）。例：`CC_WEB_CAPTURE_HISTORY=2000` 让滚动条能回看更早的历史输出。
- `CC_WEB_PROJECT_ROOTS`：允许扫描的项目根目录（逗号分隔；不设置则不展示项目下拉框）
- `CC_WEB_AUTH_TOKEN`：开启鉴权（设置后需要先访问 `/login` 输入 token 才能进入主页面；WS/API 同样受保护）
- `CC_WEB_CLAUDE_CONTINUE=1`：当服务端需要新启动 `claude` 时，使用 `claude -c/--continue`（在项目目录继续最近一次对话，减少“记忆断层”）
- `CC_WEB_WEB_ONLY=1` 或 `--web-only`：只启动 Web（不创建/附加 tmux 会话）
- `CC_WEB_NO_OPEN=1` 或 `--no-open`：不自动打开浏览器
- `CC_WEB_NO_ATTACH=1` 或 `--no-attach`：不在当前终端 attach 到 tmux 会话

## 配置文件（可选）

除了环境变量，也可以用 JSON 配置文件管理启动参数。适合多参数 / 固定配置 / 不想污染 shell 环境的场景。

### 文件路径与 flag

- 单机（7684）：`~/.cc-web-control/config.json`
- hub 多机（7685）：`~/.cc-web-control/hub-config.json`

用 `--config <path>` flag 覆盖默认路径（两个入口都支持）：

```bash
cc-web-control --config /path/to/my-config.json
cc-web-control hub --config /path/to/my-hub-config.json
```

### 优先级与向后兼容

每个字段按 **环境变量 > 文件值 > 代码默认** 解析：

- 环境变量是逃生口，适合 CI / 临时调试；
- 文件值是日常固定配置；
- 两者都没有则用代码默认 —— **不写配置文件 = 现状行为完全不变**，纯 env / 默认仍照旧。

### 字段清单

字段名、类型、默认值的权威清单见仓库根的两份模板（避免本节与 schema 漂移）：

- 单机 15 字段：[`config.example.json`](./config.example.json)
- hub 11 顶层字段（含 `mainAgent` 子对象）：[`hub-config.example.json`](./hub-config.example.json)

复制模板作起点：

```bash
cp config.example.json ~/.cc-web-control/config.json            # 单机
cp hub-config.example.json ~/.cc-web-control/hub-config.json    # hub
```

然后按需改字段值即可。

### 字段约定

- **bool**：文件里写字面 `true` / `false`（勿加引号）；环境变量里 `'1'` = true。
- **number**：文件里写裸数字（如 `100`，勿加引号）。
- **projectRoots**：文件里是 JSON 数组（环境变量则逗号分隔）。
- **路径字段写绝对路径**：`projectRoots`、`mainAgent.dataDir` 等路径字段在 JSON 里写**绝对路径**，不要写 `~/`。JSON 中 `~` 是字面字符串，loader 不展开 homedir。
- **mainAgent 数值非法**：`mainAgent.settleMs` 等数值字段若 ≤0 或非数字，hub 启动逻辑会自动 clamp 回默认值，不阻断启动。

### token 安全

`authToken` / `hubToken` 在配置文件里是明文，建议收紧文件权限：

```bash
chmod 600 ~/.cc-web-control/config.json
chmod 600 ~/.cc-web-control/hub-config.json
```

loader 检测到文件权限过松（group/other 可读）且含非空 token 时，启动会打印 warning（不阻断）。

## hub 多机模式

`cc-web-control hub` 启动一个中央服务，聚合多台机器上各自运行的 cc-web-control 实例：一个全局看板轮询所有机器、点行切换任一会话终端、多选会话批量广播同一条输入。浏览器只连 hub，单一入口、单一 token。

### 1) 机器侧准备

每台被聚合的机器照常运行 `cc-web-control`，但需对内网暴露并开启 token 鉴权：

```bash
# 在每台机器上
CC_WEB_HOST=0.0.0.0 CC_WEB_AUTH_TOKEN=<各机 token> cc-web-control
```

> 也可把 `CC_WEB_HOST` 设为该机的局域网 IP（如 `192.168.1.10`）。`CC_WEB_AUTH_TOKEN` 必设——裸奔危险。

### 2) hub 侧配置

hub 通过一个 JSON 文件得知机器清单，默认路径 `~/.cc-web-control/hub-machines.json`（可用 `CC_WEB_HUB_MACHINES_FILE` 覆盖）。文件内含各机 token，建议权限 **0600**：

```json
{
  "machines": [
    { "id": "mac1", "name": "MBP",  "url": "http://192.168.1.10:7684", "token": "<机器 mac1 的 CC_WEB_AUTH_TOKEN>" },
    { "id": "srv1", "name": "开发服", "url": "http://192.168.1.20:7684", "token": "<机器 srv1 的 CC_WEB_AUTH_TOKEN>" }
  ]
}
```

字段约束（校验失败 hub 会 fail-fast 退出，不静默）：

- `id`：稳定标识，正则 `^[A-Za-z0-9._-]{1,32}$`，**禁止含 `/`**（全局会话键分隔符），清单内唯一。
- `name`：显示名（可省略，默认取 `id`）。
- `url`：该机的内网地址（含端口）。
- `token`：该机的 `CC_WEB_AUTH_TOKEN`。

```bash
chmod 0600 ~/.cc-web-control/hub-machines.json
```

### 3) 启动 hub

```bash
CC_WEB_HUB_TOKEN=<hub 访问 token> cc-web-control hub
```

hub 专用环境变量：

- `CC_WEB_HUB_TOKEN` — 浏览器访问 hub 用的 token（**必设**，否则裸奔退出）。
- `CC_WEB_HUB_MACHINES_FILE` — 机器清单路径（默认 `~/.cc-web-control/hub-machines.json`）。
- `CC_WEB_HUB_HOST` — hub 监听地址（默认 `127.0.0.1`）。
- `CC_WEB_HUB_PORT` — hub 端口（默认 `7685`，避开单机默认 7684）。
- `CC_WEB_HUB_DASHBOARD_INTERVAL_MS` — 看板聚合轮询间隔（默认 `2000` ms）。
- `CC_WEB_HUB_NO_OPEN` — 设为 `1`（或传 `--no-open`）禁用 hub 启动后自动开浏览器（对齐单机 `CC_WEB_NO_OPEN`）。

### 4) 使用

浏览器打开 `http://<hub 所在机>:7685/` → 输入 `CC_WEB_HUB_TOKEN` 登录 → 进入多机看板（hub 只服务 `/dashboard.html`）：

- **看板**：顶部全局 dashboard 展示所有机器及其会话状态（每 2s 聚合一次）。
- **点卡片新标签直达**：点任一会话卡片 → hub 颁一张 15s TTL 一次性 ticket 并 302 → 浏览器新标签打开该机 `:7684` 单机页（已登录态）。中键 / Cmd+点击 等浏览器原生行为均可用。
- **批量广播**：多选若干会话 → 在广播栏输入 → 一次性扇出到所有选中会话。

> `http://<hub>/?token=<CC_WEB_HUB_TOKEN>` 直链可跳过登录页，**仅供本地测试**，勿用于日常/外网。

### 5) 安全提示

三层 token 各自独立、互不通用：

1. **浏览器 → hub**：`CC_WEB_HUB_TOKEN`，登录后写 httpOnly + sameSite=lax cookie（`cc_web_hub_auth`，与单机 `cc_web_auth` 同 localhost 不互染）。
2. **hub → 各机**：hub 用清单里每台的 `token`，以 `Authorization: Bearer <token>` 调各机 HTTP 与 WS。
3. **各机对内网暴露**：各机自己的 `CC_WEB_AUTH_TOKEN` 把关。

建议把 hub 部署在内网，如需外网访问请走安全隧道（见下节）并保留 `CC_WEB_HUB_TOKEN` 鉴权。

反向代理部署时，登录限流按 socket 对端 IP 计数（未启用 `trust proxy`），内网单用户无影响；公网部署需自行配置 `trust proxy`。

## 外网访问（安全隧道 / 手机访问）

推荐用 Cloudflare Quick Tunnel（`cloudflared`）把本机服务安全暴露到外网，并开启 token 鉴权。

### 一键重启并打印 URL + 新 token

脚本：`scripts/restart_tunnel.sh`

```bash
cd <项目目录>
bash scripts/restart_tunnel.sh
```

输出会包含：

- `URL: https://*.trycloudflare.com`
- `TOKEN: <new token>`

手机打开 URL 后会进入 `/login`，输入 token 才能进入主页面。

### 代理（按需开启）

`scripts/restart_tunnel.sh` 默认不走代理；仅在设置 `CC_WEB_PROXY_URL` 时启用。

可按需覆盖：

```bash
CC_WEB_PROXY_URL="http://127.0.0.1:7890" bash scripts/restart_tunnel.sh
```
