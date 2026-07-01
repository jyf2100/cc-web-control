# cc-web-control npm 发布(npx 分发)设计

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:writing-plans 基于本 spec 出分步实施计划。

## 目标
将 cc-web-control 发布到 npm 公共仓库,用户通过 `npx cc-web-control` 或 `npm i -g cc-web-control && cc-web-control` 一键启动,无需手动 clone 仓库与配置。发布后保持现有全部运行行为不变。

## 背景与硬约束
cc-web-control(当前 package.json `name` = `tmux-web-control`)是**本机 Claude Code 的 Web 遥控器**:通过 tmux 操控本机 `claude` CLI,Web 双向同步。

**分发硬约束**——任何用户机器必须先具备:
- `claude` CLI(且已完成 Claude 认证)
- `tmux`
- Node.js >= 18

npm 包只分发"控制层"代码 + 自动管 express/ws 依赖;它**不安装也无法安装** claude/tmux。因此 bin 入口必须在启动前检测这两者,缺失时友好报错退出。

依赖极轻(express + ws),无前端构建。`claude-wrapper.sh` 已是 git 可执行位(`100755`),`server.cjs:43` 的 `CLAUDE_WRAPPER = path.join(__dirname, 'claude-wrapper.sh')` 已是相对路径——npm 安装后能正确定位。

## 现状(发布前需处理)
- 现有分发方式:git clone + npm install + `npm start` / `scripts/restart_tunnel.sh`
- package.json:`name=tmux-web-control`,无 `bin`/`files`/`engines`/`publishConfig`
- 路径硬编码:README `/Users/pan/cc-control/tmux-web-control`、docs/部署使用文档.md `/Volumes/work/workspace/cc-control`
- server.cjs 为**顶层自执行脚本**(无 `module.exports`;末尾直接 `initAndAttachSession()` / `startWebServer()`;`server.listen` 在 L678)

## 架构
新增 `bin/cc-web-control.cjs` 作为 npm `bin` 入口,职责仅三步:
1. **依赖检测**:`which tmux`、`which claude`;任一缺失 → 打印安装指引 + `process.exit(1)`
2. **透传**:继承 `CC_WEB_*` 环境变量与 `process.argv`(`--no-open`/`--web-only` 等)
3. **启动**:`require(path.join(__dirname, '..', 'server.cjs'))`——因 server.cjs 顶层自执行,require 即在 bin 进程内启动 Web 服务,无需 spawn 子进程

server.cjs / claude-wrapper.sh / public/ / 其余 *.cjs **不改**。

## 关键决策
1. **claude-wrapper.sh 保留**:claude 在 tmux session 内以 shell 启动,wrapper 作为 shell 入口天然合适;路径已 `__dirname` 相对;权限位已 `100755`。仅纳入 `files`。
2. **bin 入口做依赖检测**:缺失 tmux/claude 时**报错退出**(不尝试降级运行——没有 claude/tmux 工具无法工作)。
3. **package.json**:`name` → `cc-web-control`;新增 `bin` / `files` / `engines: {"node": ">=18"}`;`version` 保持 `1.0.0`;`main` 保持 `server.cjs`;`scripts.start` 保持 `node server.cjs`。
4. **files 发布清单**(最简 glob 策略):`["*.cjs", "public/", "claude-wrapper.sh", "bin/"]`
   - `*.cjs` 覆盖根目录所有 server 依赖:`server.cjs`/`auth.cjs`/`claude_launch.cjs`/`claude_session.cjs`/`dashboard_binding.cjs`/`dashboard_cache.cjs`/`dashboard_parse.cjs`/`dashboard_slug.cjs`/`dashboard_tail.cjs`/`rate_limit.cjs`/`tmux.cjs`(根目录无测试/脚本类 .cjs,安全)
   - `public/` 整目录:含所有前端 `*.cjs`(`terminal_cleaner`/`tmux_actions`/`projectsView`/`deadState`/`session_switch`/`switch_sheet`/`dashboard_render`)+ `client.js`/`dashboard.js`/`index.html`/`dashboard.html`/`login.html`/`style.css`/`tokens.css`/`logo.png`/`manifest.json`/图标
   - 排除(默认不在 files 即不发布):`docs/`/`test/`/`scripts/`/`pretext/`/`.worktrees/`/`.playwright-mcp/`/`.superpowers/`/`.claude/`/`TODOS.md`/`package-lock.json`(npm 自动按需处理)
5. **路径相对化(仅文档)**:server 侧已相对 ✓;改 README.md 与 docs/部署使用文档.md 的硬编码示例路径为通用占位(如 `<项目目录>` 或 `$(pwd)`)。
6. **可见性 + 发包**:公开包(MIT,无 scope);流程 `npm pack --dry-run` 核对清单 → `npm publish`。
7. **README 更新**:新增 `npx cc-web-control` / 全局安装快速开始章节置顶;显式声明"需先有 tmux + claude CLI";保留现有功能/配置说明。

## 文件改动清单
| 操作 | 文件 | 改动 |
|---|---|---|
| 新建 | `bin/cc-web-control.cjs` | 依赖检测 + 透传 + require server |
| 改 | `package.json` | name→cc-web-control;加 bin/files/engines |
| 改 | `README.md` | 路径相对化 + npx 快速开始置顶 |
| 改 | `docs/部署使用文档.md` | 路径相对化 |
| 不动 | `server.cjs` 及其余根目录 `*.cjs`、`public/`、`claude-wrapper.sh` | 行为不变 |

## bin 入口行为规格
- 检测 `tmux`:`which tmux` 失败 → `console.error` 含安装提示(macOS `brew install tmux`、Ubuntu `apt install tmux`) + `process.exit(1)`
- 检测 `claude`:`which claude` 失败 → 提示安装 Claude Code CLI + `process.exit(1)`
- 两者齐备:`require('../server.cjs')`,server 读 bin 进程的 `process.argv`/`process.env` 正常启动
- `--web-only` 模式:仍检测 tmux/claude(保持一致;tmux.cjs 即使 web-only 也被 server 顶层 require)。若 plan 阶段验证 --web-only 确实不触达 tmux,可考虑豁免——默认不豁免。

## 风险与对策
- **npm name 抢注**:已查 `cc-web-control` 可用(2026-07-01);发布前 `npm view cc-web-control` 复查
- **wrapper 权限**:git mode 已 `100755`,npm 保留 ✓
- **server 顶层副作用**:server.cjs 顶层自执行,require 即启动;bin 不额外调用 main
- **node 版本**:`engines>=18`(部署文档已建议 >=18)
- **首次发布登录**:`npm publish` 前需 `npm adduser`(一次性,凭据由用户提供)
- **package-lock.json**:不纳入 files;npm publish 默认行为已处理

## 范围外(明确不做)
- Docker 镜像 / 单文件二进制(pkg/sea)(已论证与本机控制定位不契合)
- 改 claude 启动机制(wrapper 保留)
- CI 自动发版(手动 `npm publish`)
- 重写 claude-wrapper.sh 为 node(无必要)
- scope 包(用公开无 scope 名)
