# 按项目路径启动 Claude 会话(续接优先)设计

> 日期:2026-06-28
> 状态:已认可,待写实施计划
> 范围:cc-web-control 控制台「选项目即进入,优先续接该项目最近会话」

## 背景与目标

cc-web-control 当前控制台以 Session 下拉框为主入口,用户按 tmux session 名选择会话。实际心智是「按项目」而非「按 session 名」,且希望同一项目每次进入都接着上次的 Claude 对话(连续性),而不是每次新建独立对话。

目标:

1. 把「项目路径」升为选择主入口(默认可见),Session 下拉框降为高级切换
2. 选项目后,后端在该项目目录启动 claude,优先 `claude -c` 续接该项目最近会话;无历史则 `claude` 新建
3. 一个项目维护一条连续对话线

## 现状(已确认)

- **项目列表机制已实现**:`GET /api/projects`(server.cjs:409-442)扫描 `CC_WEB_PROJECT_ROOTS` 各根目录的直接子目录作为项目,返回 `{roots, projects:[{name,path,root}]}`。安全校验 `normalizeProjectCwd`(server.cjs:106-123)确保 cwd 必须在 roots 内。
- **Project 下拉框已存在但默认隐藏**:index.html:42-46,仅当后端返回非空 roots 时才显示。
- **启动强制新建、不续接**:`POST /api/sessions`(server.cjs:444-472)走 `startClaudeInSession(name, cwd, forceNew=true)`(server.cjs:125-144),forceNew 路径预生成 UUID(`createSessionBinding`)、`export CC_WEB_CLAUDE_SESSION_ID`、`claude --session-id <uuid>`,**故意不带 `-c`**(注释原话:强制新建独立 agent)。
- **已存在 session 直接切换**:前端 `startProjectSession`(client.js:731-785)对同名 session 直接切换,不重启。
- **看板定位**:靠 tmux session ↔ claude jsonl 的 UUID 绑定(`dashboard_binding.cjs`)精确定位;无绑定时降级为 cwd→slug→jsonl mtime(`dashboard_slug.cjs` + `dashboard_cache.cjs`)。
- **claude CLI 选项**:`-c, --continue` 续接最近会话;`--resume <uuid>` 按 ID 恢复;`--session-id <uuid>` 指定 ID 新建。
- **jsonl 定位能力现成**:`dashboard_slug.cjs` 导出 `resolveProjectDir(cwd)`(返回 `~/.claude/projects/<slug>/`,不存在返 null)与 `listProjectJsonls(dir)`(列顶层 *.jsonl),可判断该项目有无历史会话。

## 设计

### 总体

Project 下拉框升为主入口(默认可见),Session 下拉框降为次要。选项目后端在该项目目录启动 claude,Node 层判断有无历史会话:有则 `claude -c` 续接,无则 `claude` 新建。一个项目一条连续对话线。已存在该项目的 tmux session 时直接切换,不重启、不管 claude 当前状态(「只管切过去」)。

### 后端启动语义(server.cjs)

改造 `startClaudeInSession`:

- 移除 forceNew 路径的 UUID 预生成(`createSessionBinding`)与 `export CC_WEB_CLAUDE_SESSION_ID`、`--session-id`。
- 改为续接优先,判断放在 Node 层(不在 tmux 里盲重试):
  - 复用 `dashboard_slug.cjs` 的 `resolveProjectDir(cwd)` + `listProjectJsonls(dir)`,查该项目 cwd 的 `~/.claude/projects/<slug>/` 下是否存在 jsonl
  - 有 jsonl → tmux 发 `claude -c`
  - 无 jsonl → tmux 发 `claude`(纯新建,claude 自己生成会话 ID)
- 保留 `cd "<cwd>"` 这步(进入项目目录)。
- `POST /api/sessions` 调用处(server.cjs:466)相应调整:走续接语义,不再 forceNew。

`claude-wrapper.sh` / `claude_launch.cjs`:

- 续接路径不设 `CC_WEB_CLAUDE_SESSION_ID`(wrapper 走 `exec claude "$@"`,`$@` 含 `-c`)。
- `buildClaudeLaunchCommand` 续接时拼 `-c`,新建时不拼。

**范围限定**:本次只改 web 新建项目会话路径(forceNew=true)。服务启动默认会话 `DEFAULT_SESSION`(forceNew=false,沿用 `CC_WEB_CLAUDE_CONTINUE`)行为不变。

### 前端入口(index.html + client.js)

- Project 下拉框(index.html:42-46)去掉 `hidden`,默认可见。
- 空状态:`CC_WEB_PROJECT_ROOTS` 未配置时(`GET /api/projects` 返回空 projects),Project 区域显示提示文案(「未配置项目根目录,设置 `CC_WEB_PROJECT_ROOTS=<目录1>:<目录2>` 后重启」),而非空下拉框。
- Session 下拉框保留,视觉降为次要(如收起或小字)。
- `startProjectSession`(client.js:731-785)逻辑不变:同名 session 已存在则切换,不存在则 POST 创建。续接由后端负责。

### 看板定位

- 续接路径不再写 UUID 绑定。`listSessions`(server.cjs:149-179)的 `readBinding` 回填会返回 null,看板走已有的 mtime 降级路径(`dashboard_cache.cjs`)。
- 一条线下每项目一个 jsonl,mtime 推断准,体验不降级。
- `DELETE /api/sessions` 的 `deleteBinding`(server.cjs:484)保留(清理可能的残留绑定),无害。
- 实施时确认 `dashboard_cache.cjs` 的 mtime 降级路径在无绑定时正常工作。

### 边界(只管切过去)

- 选项目 → 该项目 tmux session 不存在:`createSession` + `startClaudeInSession`(Node 层判断 -c/新建)。
- 选项目 → 该项目 tmux session 已存在:直接切换(连接 ws),不重启 claude,不检测 claude 是否在交互中。
- claude 退出后只剩 shell:用户在该 session 终端里手动 `claude -c`,或删掉 session 重建。本设计不自动重启。

## 改动清单

| 文件 | 位置 | 改动 |
|---|---|---|
| server.cjs | 125-144 startClaudeInSession | 移除 forceNew UUID 预生成;改续接优先(Node 层查 jsonl) |
| server.cjs | 466 POST /api/sessions | 调用调整(续接语义,不 forceNew) |
| server.cjs | 149-179 listSessions | 无需改(readBinding 返 null 自动降级) |
| claude_launch.cjs | buildClaudeLaunchCommand | 续接时拼 -c |
| claude-wrapper.sh | — | 续接路径不设 CC_WEB_CLAUDE_SESSION_ID(已支持 $@ 透传) |
| public/index.html | 42-46 | Project 下拉框去 hidden |
| public/client.js | startProjectSession 附近 | 空状态提示;Session 下拉框降次要 |
| dashboard_binding.cjs | — | createSessionBinding 不再被调用(保留导出,不删) |

## 测试

- **后端单元**(test/*.test.cjs,`node --test`):
  - `startClaudeInSession` 续接判断:mock `tmux.sendKeys`,给定 cwd 有 jsonl → 发送含 `-c`;无 jsonl → 发送 `claude`(不含 -c、不含 --session-id)
  - 不再 `export CC_WEB_CLAUDE_SESSION_ID`、不再 `writeBinding`
- **后端集成**:
  - `POST /api/sessions` 在有/无历史 cwd 下的启动命令差异
- **前端**:
  - Project 下拉框默认可见;无 `CC_WEB_PROJECT_ROOTS` 时显示空状态提示
- 覆盖率维持 80%+。

## 非目标(YAGNI)

- 不做同项目多对话线(`--resume <uuid>` 精确恢复)。用户确认一个项目一条线。
- 不做网页端动态增删项目路径。沿用 `CC_WEB_PROJECT_ROOTS` 环境变量。
- 不做 claude 退出后自动续接重启(只管切过去)。
- 不改 WebSocket 协议、不改 tmux session 命名规则(`claude-<project>`)。

## 配置与安全

- `CC_WEB_PROJECT_ROOTS`:冒号分隔的根目录列表,各根目录的直接子目录作为项目。未配置 → 前端空状态提示。
- `normalizeProjectCwd` 校验保留:web 传入的 cwd 必须在 roots 内,防止任意目录启动 claude。
- 续接不削弱安全(`-c` 只在该 cwd 内活动,jsonl 由 claude 自己管)。
