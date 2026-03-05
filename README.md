# Claude Code Web

通过 Web 页面对话形式控制本地 Claude Code，实现双向同步：Web 输入发送给 Claude Code，Claude Code 输出显示在 Web 上。

> 部署与运维入口：`docs/部署使用文档.md`  
> 完整中文手册：`docs/操作手册.md`

## 功能特性

- **自动启动 Claude Code**: `npm start` 自动创建 tmux 会话并启动 Claude Code
- **对话式界面**: Web 端以聊天形式与 Claude Code 交互
- **实时双向同步**: WebSocket 实时同步终端内容
- **深色主题**: 类似 Claude Code 的深色界面风格
- **单行输入**: Enter 发送（当前输入框为单行）
- **补全/命令面板按键**: 支持 `Tab` 补全、`↑/↓` 选择、`Esc` 退出（输入框为空时发送按键）

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
cd /Users/pan/cc-control/tmux-web-control
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

- Node.js >= 14
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
export CC_WEB_PROJECT_ROOTS="/Volumes/work/workspace"
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
- `CC_WEB_PROJECT_ROOTS`：允许扫描的项目根目录（逗号分隔；不设置则不展示项目下拉框）
- `CC_WEB_AUTH_TOKEN`：开启鉴权（设置后需要先访问 `/login` 输入 token 才能进入主页面；WS/API 同样受保护）
- `CC_WEB_CLAUDE_CONTINUE=1`：当服务端需要新启动 `claude` 时，使用 `claude -c/--continue`（在项目目录继续最近一次对话，减少“记忆断层”）
- `CC_WEB_WEB_ONLY=1` 或 `--web-only`：只启动 Web（不创建/附加 tmux 会话）
- `CC_WEB_NO_OPEN=1` 或 `--no-open`：不自动打开浏览器
- `CC_WEB_NO_ATTACH=1` 或 `--no-attach`：不在当前终端 attach 到 tmux 会话

## 外网访问（安全隧道 / 手机访问）

推荐用 Cloudflare Quick Tunnel（`cloudflared`）把本机服务安全暴露到外网，并开启 token 鉴权。

### 一键重启并打印 URL + 新 token

脚本：`scripts/restart_tunnel.sh`

```bash
cd /Volumes/work/workspace/cc-control
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
