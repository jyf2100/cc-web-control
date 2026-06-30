# 按项目路径启动 Claude 会话(续接优先)设计

> 日期:2026-06-28
> 状态:已认可,经专家团队审核修订,待写实施计划
> 范围:cc-web-control 控制台「选项目即进入,优先续接该项目最近会话」
> 审核:后端架构 / 安全 / 前端 UX / 测试覆盖 四位专家并行评审,反馈已合并

## 背景与目标

cc-web-control 当前控制台以 Session 下拉框为主入口,用户按 tmux session 名选择会话。实际心智是「按项目」而非「按 session 名」,且希望同一项目每次进入都接着上次的 Claude 对话(连续性),而不是每次新建独立对话。

目标:

1. 把「项目路径」升为选择主入口(默认可见),Session 下拉框降为次要(桌面缩小、窄屏收起)
2. 选项目后,后端在该项目目录启动 claude,Node 层判断有无历史会话:有则 `claude -c` 续接,无则 `claude` 新建
3. 一个项目维护一条连续对话线
4. 切到已存在 session 时,若该 session 的 Claude 已退出(只剩 shell),给最小提示

## 现状(已确认)

- **项目列表机制已实现**:`GET /api/projects`(server.cjs:409-442)扫描 `CC_WEB_PROJECT_ROOTS` 各根目录的直接子目录作为项目。**`CC_WEB_PROJECT_ROOTS` 是逗号分隔**(server.cjs:45-48 `.split(',')`),不是冒号。安全校验 `normalizeProjectCwd`(server.cjs:106-123)确保 cwd 必须在 roots 内。
- **Project 下拉框已存在但默认隐藏**:index.html:42-46。`loadProjects`(client.js:702-729)在 roots 为空时**主动 `projectControl.hidden = true`**(client.js:707-710),只改 HTML 去掉 `hidden` 不够,会被这段 JS 藏回去。
- **启动强制新建、不续接**:`POST /api/sessions`(server.cjs:444-472)走 `startClaudeInSession(name, cwd, forceNew=true)`(server.cjs:125-144),forceNew 路径预生成 UUID(`createSessionBinding`)、`export CC_WEB_CLAUDE_SESSION_ID`、`claude --session-id <uuid>`,**故意不带 `-c`**(注释原话:强制新建独立 agent)。
- **已存在 session 直接切换**:前端 `startProjectSession`(client.js:731-790)对同名 session 直接切换,不重启,只发一句 `showSystemNote('已切换到会话')`,不检测 claude 状态。
- **看板定位**:靠 tmux session ↔ claude jsonl 的 UUID 绑定(`dashboard_binding.cjs`)精确定位;无绑定时降级为 cwd→slug→jsonl mtime(`dashboard_slug.cjs` + `dashboard_cache.cjs` 的 `latestJsonlByMtime`)。**无绑定降级路径已有测试**(test/dashboard_cache.test.cjs:157)。
- **claude CLI 选项**:`-c, --continue` 续接最近会话;`--resume <uuid>` 按 ID 恢复;`--session-id <uuid>` 指定 ID 新建。
- **jsonl 定位能力现成**:`dashboard_slug.cjs` 导出 `resolveProjectDir(cwd)`(返回 `~/.claude/projects/<slug>/`,不存在返 null)与 `listProjectJsonls(dir)`(列顶层 *.jsonl),可判断该项目有无历史会话。
- **现有测试基建**:`node --test test/*.test.cjs`,全是「require 纯模块 + 传 tmpDir」风格。无 jsdom、无 supertest、server.cjs 未导出内部函数。测试须沿用纯函数风格。

## 设计

### 总体

Project 下拉框升为主入口(默认可见),Session 下拉框降为次要。选项目后端在该项目目录启动 claude,Node 层判断有无历史会话:有则 `claude -c` 续接,无则 `claude` 新建。一个项目一条连续对话线。已存在该项目的 tmux session 时直接切换,不重启、不管 claude 当前状态(「只管切过去」),但切到只剩 shell 的死状态时给最小提示。

### 后端启动语义(server.cjs)

改造 `startClaudeInSession`:

- 移除 forceNew 路径的 UUID 预生成(`createSessionBinding`)与 `export CC_WEB_CLAUDE_SESSION_ID`、`--session-id`。
- 改为续接优先,判断抽成**纯函数 `shouldContinue(cwd)`**(新增模块 `claude_session.cjs`,server.cjs require 它):
  - `shouldContinue` 调 `resolveProjectDir(cwd)` + `listProjectJsonls(dir)`,返回 boolean(目录存在且 ≥1 个 jsonl → true)
  - 抽成纯函数是为可单测(沿用 dashboard_slug 等纯模块测试风格),不引入 server.cjs 集成测试基建
- `shouldContinue(cwd)` true → `claude -c`;false → `claude`(纯新建,claude 自己生成会话 ID)
- **时序竞态修正**:`cd "<cwd>"` 与续接命令合并为单条 `cd "<cwd>" && bash "<wrapper>" [-c]`,一次性 sendKeys。现状两次独立 sendKeys 在慢盘 / direnv hook 下可能 cd 未生效就发 claude,导致续接到错误项目。合并后消除竞态。
- `POST /api/sessions` 调用处(server.cjs:466)走续接语义,不再 forceNew。
- `buildClaudeLaunchCommand`(claude_launch.cjs)续接时拼 `-c`,新建时不拼。**此函数已 100% 覆盖**(test/claude_launch.test.cjs:6-14),无需改实现。
- `claude-wrapper.sh` 续接路径不设 `CC_WEB_CLAUDE_SESSION_ID`(wrapper 走 `exec claude "$@"`,`$@` 含 `-c`),已支持。

**范围限定**:本次只改 web 新建项目会话路径(forceNew=true)。服务启动默认会话 `DEFAULT_SESSION`(forceNew=false,沿用 `CC_WEB_CLAUDE_CONTINUE`)行为不变。

**旧绑定一次性迁移**:`createSessionBinding` 改完变死代码。`.cc-web-bindings` 目录下的旧绑定文件(sid 指向已不存在的 jsonl)会让 `listSessions` 的 `readBinding`(server.cjs:166)读到陈旧 sid,看板错位。新增**启动时一次性迁移**:扫描 `.cc-web-bindings`,对每个绑定文件校验其 sid 在对应 slug 目录下是否有同名 jsonl,无则删除。新流程不再写绑定,迁移后目录自然不再增长。`createSessionBinding` 导出删除(连同其唯一调用点),`deleteBinding` 保留(DELETE /api/sessions 清理用,幂等无害)。

### 前端入口(index.html + client.js)

- **Project 默认可见 + 空状态渲染**:index.html:42-46 去掉 `hidden`;同时改 `loadProjects`(client.js:707-710),空 projects 时不再 `projectControl.hidden = true`,改为渲染空状态提示文案 + 保留控件可见。提示文案:「未找到项目。在启动服务处设置 `export CC_WEB_PROJECT_ROOTS=/路径A,/路径B` 后重启服务。」(逗号分隔,占位符不塞真实路径)。空状态 DOM 需新增元素(如 `<p id="projectsEmpty">`),避免「显示提示」无落点。
- **Session 下拉框降次要(窄屏收起,桌面缩小)**:桌面端保留可见但缩小(label 已隐藏,缩 select 宽度),排在 Project 之后;窄屏(`@media (max-width: 768px)`)收起 Session 及其刷新按钮,只露 Project + 启动。呼应刚做完的 iOS 适配,避免 375px 下 6 个控件挤一行。URL `?session=` 显式指定的自动切换逻辑(client.js:644-675)保留(看板跳转控制依赖)。
- **死状态最小提示**:切到已存在 session 时(client.js:743-752),若 `/api/dashboard` 返回该 session 状态非活跃,或终端最近输出无 claude 交互标记,显示 toast「该会话的 Claude 可能已退出,可在终端输入 `claude -c` 续接,或删除会话后重建」。仅提示,不自动重启。
- **`startProjectSession`**(client.js:731-790)逻辑不变:同名 session 已存在则切换(加死状态提示),不存在则 POST 创建。续接由后端负责。
- **纯渲染函数 `projectsView`**(新增 public/projectsView.js):输入 `{projects, hasRoots}` → 输出 `{showSelect, showButton, emptyHint}`,把「空状态 / 可见」决策抽成纯函数便于单测,DOM 绑定留给 client.js 调用。沿用现有纯模块测试风格,不引入 jsdom。

### 看板定位

- 续接路径不再写 UUID 绑定。`listSessions`(server.cjs:149-179)的 `readBinding` 回填返回 null,看板走已有的 mtime 降级路径(`dashboard_cache.cjs`)。**该降级已由 test/dashboard_cache.test.cjs:157 覆盖,无需新增测试。**
- 一条线下每项目一个 jsonl,mtime 推断准。
- `DELETE /api/sessions` 的 `deleteBinding`(server.cjs:484)保留(清理,幂等无害)。

### 边界(只管切过去 + 死状态提示)

- 选项目 → 该项目 tmux session 不存在:`createSession` + `startClaudeInSession`(`shouldContinue` 判断 -c/新建)。
- 选项目 → 该项目 tmux session 已存在:直接切换(连接 ws),不重启 claude,不检测 claude 是否交互中。**若该 session 只剩 shell(claude 已退出),前端给最小提示**(见前端入口节),不自动重启。
- claude 退出后只剩 shell:用户在该 session 终端里手动 `claude -c`,或删掉 session 重建。本设计不自动重启。

## 改动清单

| 文件 | 位置 | 改动 |
|---|---|---|
| server.cjs | 125-144 startClaudeInSession | 移除 forceNew UUID 预生成;改续接优先;`cd && bash wrapper [-c]` 单条命令 |
| server.cjs | 466 POST /api/sessions | 调用调整(续接语义,不 forceNew) |
| server.cjs | 149-179 listSessions | 无需改(readBinding 返 null 自动降级) |
| server.cjs | 启动初始化 | 新增旧绑定一次性迁移(校验 .cc-web-bindings,删陈旧 sid) |
| claude_session.cjs | 新建 | `shouldContinue(cwd)` 纯函数(resolveProjectDir + listProjectJsonls) |
| claude_launch.cjs | buildClaudeLaunchCommand | 无需改(已有测试覆盖 -c 拼接) |
| claude-wrapper.sh | — | 续接路径不设 CC_WEB_CLAUDE_SESSION_ID(已支持 $@ 透传) |
| dashboard_binding.cjs | — | 删 createSessionBinding 导出 + 调用;保留 deleteBinding |
| public/index.html | 42-46 | Project 下拉框去 hidden;新增空状态元素 `<p id="projectsEmpty">` |
| public/projectsView.js | 新建 | 纯渲染决策函数(projects/hasRoots → 显示状态 + 提示文案) |
| public/client.js | loadProjects 702-729 | 空状态不再 hidden,改渲染提示;调用 projectsView |
| public/client.js | 743-752 切换路径 | 死状态最小提示 |
| public/style.css | .controls + 窄屏 | Session 桌面缩小;窄屏(<768px)收起 Session |
| test/claude_session.test.cjs | 新建 | shouldContinue 纯函数测试 |
| test/projectsView.test.cjs | 新建 | projectsView 纯函数测试 |

## 测试

沿用 `node --test test/*.test.cjs`,纯函数风格,不引入 jsdom/supertest。

- **后端纯函数 `shouldContinue`**(test/claude_session.test.cjs):
  - cwd 对应 `~/.claude/projects/<slug>/` 存在且 ≥1 jsonl → true → 发 `claude -c`
  - cwd 对应目录不存在(resolveProjectDir 返 null)→ false → 发 `claude`(不含 -c、不含 --session-id)
  - **目录存在但 0 jsonl**(listProjectJsonls 返 [])→ false → 发 `claude`(关键边界,目录在 ≠ 有可续接会话)
  - 不再 `export CC_WEB_CLAUDE_SESSION_ID`、不再 writeBinding(行为断言)
- **前端纯函数 `projectsView`**(test/projectsView.test.cjs):
  - `{projects:[...], hasRoots:true}` → `{showSelect:true, showButton:true, emptyHint:''}`
  - `{projects:[], hasRoots:false}` → `{showSelect:false, showButton:false, emptyHint:'未找到项目...'}`
  - `{projects:[], hasRoots:true}`(配了根但目录无子项)→ emptyHint 区分「未配置」与「目录为空」
- **复用现有**:
  - `claude_launch.cjs` 续接拼接已覆盖(test/claude_launch.test.cjs:6-14),无需新增
  - 看板无绑定降级已覆盖(test/dashboard_cache.test.cjs:157),无需新增
- 覆盖率维持 80%+。纯函数路线下,新增模块即新增测试,达标现实。

## 非目标(YAGNI)

- 不做同项目多对话线(`--resume <uuid>` 精确恢复)。用户确认一个项目一条线。
- 不做网页端动态增删项目路径。沿用 `CC_WEB_PROJECT_ROOTS` 环境变量。
- 不做 claude 退出后自动续接重启(只管切过去 + 最小提示)。
- 不改 WebSocket 协议、不改 tmux session 命名规则(`claude-<project>`)。
- 不引入 jsdom / 前端 DOM 测试栈(前端走纯函数 projectsView)。
- 不引入 server.cjs HTTP 集成测试基建(后端走纯函数 shouldContinue)。

## 配置与安全

- `CC_WEB_PROJECT_ROOTS`:**逗号分隔**的根目录列表,各根目录的直接子目录作为项目。未配置 → 前端空状态提示。
- `normalizeProjectCwd` 校验保留:web 传入的 cwd 必须在 roots 内,防止任意目录启动 claude。
- 续接不削弱安全(`-c` 只在该 cwd 内活动,jsonl 由 claude 自己管)。
- **单用户本机假设**:`claude -c` 续接的是该 cwd 下机器级最近会话(按 claude 内部规则,通常 mtime 最新),不区分谁创建。cc-web-control 面向单用户可信本机;多用户 / 共享机器不应默认续接。
- **绝对路径回传**:`/api/projects` 与 `/api/sessions` 在 roots 配置后会回传服务器绝对路径(project.path),属预期。公网暴露必须开 `AUTH_TOKEN`。

## 已知限制(接受降级)

- **多 jsonl 错位**:若用户在该项目下混用 `--resume/--session-id` 或外部手动跑过 claude,留下多个 jsonl,`-c` 续接的对象与看板 mtime 取的可能是不同条,状态会与实际对话错位。接受该降级(YAGNI 不做 `--resume <uuid>` 精确恢复),一条线场景下两者大概率一致。
- **中文路径 slug miss**:`cwdToSlug` 的 `/ → -` 规则与 claude 内部 slug 规则在非 ASCII 段不完全一致,中文项目路径可能 `resolveProjectDir` miss → 误判无历史 → 走新建。接受该降级(与看板 mtime 降级同源)。
- **`claude -c` 无历史行为未实测**:若 claude 在无历史时 `-c` 不报错而是直接开新会话,则 `shouldContinue` 判断冗余但无害。实施前建议 spike 实测一次,若 claude 能自降级,可简化为永远 `-c`(优化项,非必须)。
