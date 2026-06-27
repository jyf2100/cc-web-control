# Design: cc-web-control 多会话状态看板(手机 / 自托管 / 交互式驾驶)

Promoted from `/plan-ceo-review` CEO plan on 2026-06-27 (SELECTIVE EXPANSION, branch main).
Source CEO plan: `~/.gstack/projects/jyf2100-cc-web-control/ceo-plans/2026-06-27-multi-session-dashboard.md`
Source design doc (office-hours): `~/.gstack/projects/jyf2100-cc-web-control/roc-main-design-20260627-121459.md`

## Vision

### 10x Check
从手机一屏看到所有正在跑的 Claude Code 会话状态,谁在等我一眼跳出,点进去就能接管。终态是个人 Claude 舰队的"自托管指挥中心":准确多会话感知 + push(需要你时主动 ping)+ 每会话历史时间线 + 每会话 token/成本可见。差异化窄缝 = 自托管 + tmux send-keys 驱动交互式 TUI(能控制不只看)+ 已有安全手机隧道。官方 Agent View(CLI 优先用不了手机)和十几个克隆(只读日志 / SaaS)都没占这个组合。

## Scope Decisions

| # | Proposal | Effort | Decision | Reasoning |
|---|----------|--------|----------|-----------|
| 1 | capture-pane 启发式看板(原 v1) | M | SUPERSEDED | 评审中用户决定跳过启发式 throwaway,直上 JSONL(见"阶段决策") |
| 2 | JSONL 状态看板(原 v2,现 day-1) | M-L | ACCEPTED (Phase 1) | 启发式是整个风险面且迟早到 JSONL;直跳省 throwaway,且 dashboard 不再 spawn 爆炸(性能反而更好) |
| 3 | 推送通知(Approach C) | M | ACCEPTED (Phase 2) | 最贴"谁需要我现在出手"的反应式 job;升主动式指挥中心 |
| 4 | 每会话 token/成本追踪 | S-M | DEFERRED (Phase 2) | spike 准则 5 证伪:usage per-message,tail-only 算不准累计。Phase 2 用累加器 |
| 5 | UX 微增:标题计数 + 排顶 + idle 时间戳 | S | ACCEPTED (Phase 1) | 直接服务核心 job(自动跳转改默认关) |

### 阶段决策(评审中反转,关键)
原设计 "A 启发式 → B JSONL" 两步。评审 inversion 后用户拍板:**跳 A 直上 B**。理由:启发式是 v1 整个风险面(Claude TUI 帧乱、判不准),而 B 是终态,A 是注定被扔的过渡代码。直跳 B 的副作用是**性能反而更好** —— dashboard 状态源变纯 JSONL 文件读(**0 tmux spawn**),capture-pane 只服务"正在控制的那一个"会话。代价:承重风险从"启发式准不准"换成"**JSONL 实时性 + cwd 映射可靠性**"(更干净的 spike)。

## Accepted Scope

**Phase 1(JSONL 状态看板 + 成本 + UX 微增,day-1):**
- `/dashboard` 路由 + `public/dashboard.html` 视图
- `GET /api/dashboard` REST 聚合端点,客户端轮询(默认 2s,见 M7)。响应 schema:`{ sessions: [{ name, status, lastLine }] }`(cost 砍到 Phase 2,见 spike 准则 5)
- **状态源 = JSONL 文件读(0 tmux spawn):** `~/.claude/projects/<cwd-dashes>/*.jsonl` 事件解析出 status(idle|working|waiting|errored)+ lastLine + cost
- **[改动点]** `listSessions()`(server.cjs:129)扩 cwd:`#{session_name}|#{pane_current_path}|#{session_attached}`(改现有函数或加变体,**加字段别删字段**)
- tmux↔JSONL 映射:realpath(pane_current_path)→ 分隔符替换为 `-` → 拼项目目录命中。cwd 非项目目录 → unknown,不报错
- **控制层(只聚焦会话):** 现有 WS capture-pane + send-keys 不动;focused 会话预览可用 tail-only capture(`-S -20`)省流量
- 点行 → `?session=X` → 现有单会话全控
- **UX 微增:** 标题/favicon "N 个在等";waiting 排顶;每行 idle 时间戳(从 JSONL 时间戳派生)。自动跳转**默认关、设置里开**
- 失败降级:JSONL 解析错 → 该会话 unknown + 日志,**绝不 500**;别重复现有静默 catch(server.cjs:487、505)
- 频率限制 `/api/dashboard`(防锤)+ debug 日志(会话数/spawn 数/p95 + status 判定理由)
- 徽章 = 颜色+图标+文字(色盲友好),触控目标 ≥44px
- 5-10 会话:列表为主(非网格),暂不强制虚拟滚动

**Phase 2(push 通知,Phase 1 后):**
- 会话进 waiting/errored 时经隧道 + web push 到手机

### Status source spike — hard go/no-go gate(先做,Phase 1 第一步)

**工程评审 + 工程向外部声音后,从 3 准则扩到 5 准则。** 任一不过 → 回退 capture-pane 启发式(注意:heuristic 自己也要先有最小设计,回退不是省事是换一个更难的实现,见下"回退路径")。

1. **`end_turn`→waiting 成立**:交互式会话最后事件 `stop_reason:end_turn` 就是 waiting 信号(已实证 881 个 end_turn),**并实测它写盘实时延迟**(<1s 是目标,要真测不是假设)。
2. **cwd→目录映射命中率 + slug 碰撞反向测试**:真实路径命中达标(含脏路径 `-Users-roc-dailywork-----` 非 ASCII 段、symlink、cd 后启动)。**新增反向测试**:找两个不同真实 cwd(空格 / 非 ASCII),验证 slug 不碰撞。碰撞 = 多个会话抢同一份状态文件,路线不可行。
3. **cwd 漂移测试(新增)**:`#{pane_current_path}` 是 shell 当前目录不是启动目录。启动 session → pane 里 `cd` 到别处 → 面板是否还能正确归位。大面积漂移导致 unknown 则路线不可行(或接受漂移 = unknown)。
4. **autonomous 循环可判**:从不 end_turn 的自主循环(全 `tool_use`)判 working vs idle。**先解析真实 jsonl 钉死时间戳字段名**,用真实长任务(`sleep 60` / `npm install`)测自然静默期,据此定阈值,做成 `CC_WEB_IDLE_THRESHOLD_S` 环境变量。
5. **cost/usage 字段可累加(新增,用户决定保留 cost 挂此验证)**:解析真实 jsonl 确认 usage 字段路径 + 是 cumulative 还是 per-message。per-message 且无 cumulative 标记 → tail-only 算不准累计 → Phase 1 砍 cost 字段,留 Phase 2 累加器。

交付物:5 条结论 + status 判定规则表(idle|working|waiting|errored)+ cost 去留结论。

### 实现铁律(工程评审 + 外部声音补强,build 时必须遵守)

- **M1 tail-read 绝不整文件读**(59MB 实测)。从尾部读最后 N 事件。
- **M2 按 mtime 选最新 jsonl**(每目录多个 jsonl 实测)。
- **M3 无静默 catch**:单会话失败 → unknown + 结构化日志,绝不 500。区分 tmux-down(加 `tmuxOk` 标志)与空列表。别重复 server.cjs:487、505。
- **M4 非递归 readdir + 排除子目录**:项目目录实测含 `subagents/`、`memory.backup.*/`,递归 glob 会扫到 subagent 事件流污染状态(subagent 刚跑过 mtime 最新会胜出)。只取顶层 `*.jsonl`。
- **M5 全局单例 tailer(DashboardCache)**:一个 `setInterval` 驱动的 tailer 维护所有会话 jsonl 的 offset,所有 `/api/dashboard` 请求读同一内存快照(TTL)。绝不照搬 WS"每客户端独立 interval"反模式(server.cjs:489)。否则多 tab / 手机预渲染会叠乘成 3-5 倍请求。
- **M6 stat 守卫**:每次 stat,若 `size < lastOffset` 或 mtime 回退或 inode 变(macOS inode 复用)→ 重置 offset,重读末尾 N 行。处理 truncate / rotate / replace。
- **M7 节拍 2s 起步不是 1s**:1s 是零证据假设。libuv 线程池默认 4,10 个大文件并发 tail 会排队,p95 远超 1s。实测 p95 再调,做成 `CC_WEB_DASHBOARD_INTERVAL_MS`。
- **M8 listSessions 分隔符换 tab**:加 `#{pane_current_path}` 后,路径含 `|` 会破坏 `split('|')`(server.cjs:138)。换 `\t` 分隔。
- **M9 tmux 探测缓存**:`isCommandAvailable('tmux')`(server.cjs:328)启动时探一次,缓存模块级变量,失败每 60s 重试。
- **测试**:`parseEvents(jsonlSlice, now) → {status, lastLine}` 拆纯函数,套现有 `test/*.test.cjs` node:test 模式(现有 8 个全是纯函数测试,无 fs mock 先例)。fixture 用 `fs.mkdtemp` 造临时目录(含子目录 + 多 jsonl + 坏行)。

### 回退路径(spike 失败时)

spike 任一准则不过 → 回退 capture-pane 启发式做状态。但 heuristic 自己需要先有最小设计(检测 `$ ` / `> ` / spinner / 空白行等),确认它真比 jsonl 简单,否则回退是空头支票。spike 开始前先写这份 heuristic 设计。

## Deferred to TODOS.md
- 控制路径 capturePane spawn 成本改造(tail-only + 并发上限)— **P2**,见 `TODOS.md`。评审发现的老债务,看板不动控制路径,独立改。
- 每会话历史时间线 — **P3**,见 `TODOS.md`。10x 愿景项,Phase 1 先出货。

## NOT in scope
- 重写现有单会话控制 WS 流(不动)
- 多用户 / 团队协作(自托管单用户)
- 服务端持久化存储(无 DB,内存/文件足够)
- 非 Claude pane 的深度识别(v1 显示 unknown 即可,v2 靠 cwd 映射)

## Open Decisions (评审后状态)
- ~~典型会话数~~ → 已确认 **5-10(中)**:列表为主,暂不强制虚拟滚动
- ~~heuristic spike~~ → **作废**(跳 v1 启发式)。新 spike = JSONL 实时性 + event→status + cwd 映射(见上)
- ~~createdSessions~~ → **砍**:设计引错不存在的变量;Phase 1 的 cwd→JSONL 映射让"哪些是 Claude 会话"自然可判
- ~~JSONL 看不见 waiting~~ → **推翻**:`end_turn` = waiting 信号(881 实证);outside voice 头条论断不成立,次要警告(映射脆/覆盖/双源)已被 spike + unknown 降级吸收

## Review status
- **CEO Review:** CLEAN (SELECTIVE EXPANSION, 3 proposed → 3 accepted, 0 critical gaps, 2026-06-27)
- **Outside Voice(战略向):** ran(claude fallback;headline refuted,secondary risks absorbed)
- **Eng Review:** COMPLETE 2026-06-27。Step 0 范围挑战通过(范围精简,无缩减触发)。但实现层 NOT READY:外部声音抓到 M1/M2/M3 之外的 6 条 blocking(子目录污染、slug 碰撞、cwd 漂移、IO 并发预算、offset 失效、idle 阈值 / 字段未验证)。spike 从 3 准则扩到 5,加实现铁律 M4-M9。关卡 = spike(5 准则)必须先过才 build。
- **Outside Voice(工程向):** ran(claude architect;codex 自定义 provider 404,fallback)。6 blocking 已 fold 进 spike / 铁律,cost 挂 spike 准则 5 验证(用户决定保留)。
- **Design Review:** COMPLETE 2026-06-27(文字线框,聚焦真问题)。补 UI 决策:徽章 5 态 amber 色板(色盲三重编码:色+图标+文字)+ 列表行线框(桌面末行预览/手机 <640px 折叠)+ 5 态空错误文案 + title 计数 + App UI 规则对齐。评分 **4→9/10**,0 unresolved。见下"UI 设计决策"section。

## Spike 实证结果(2026-06-27,go/no-go)

5 准则全测完。**结论:GO,JSONL 路线可行**,带 2 条已知风险用 unknown 降级应对,cost 砍到 Phase 2。

| 准则 | 结果 | 证据 |
|---|---|---|
| 1 end_turn→waiting + 写盘延迟 | ✅ 通过 | 当前会话 jsonl `mtime - last_ts` 延迟 **0.15s**(<1s 目标),end_turn 落盘 10 个确认持久化。dashboard 轮询能捕捉。stop_reason 分布:tool_use 314 / end_turn 10 / stop_sequence 1 |
| 2 cwd→slug 映射 + 碰撞 | ⚠ 部分通过 | 脏 slug `-Users-roc-dailywork-----`(5 连字符)真实存在,非 ASCII 折叠机制确认。扫 19 个真实项目目录**未见碰撞**(各自独特)。残余风险用 unknown 降级应对 |
| 3 cwd 漂移 | ⚠ 风险确认,需应对 | 实测 pane_current_path **0.7s** 跟随 shell cd。漂移真实。应对:实时映射,漂移时该会话 unknown,或服务端缓存 session→jsonl 首次匹配后固定 |
| 4 时间戳字段 | ✅ 通过 | 字段 = `timestamp`,ISO8601 带毫秒 + Z(`2026-06-27T06:28:01.366Z`)。idle 阈值基于此派生,做成 `CC_WEB_IDLE_THRESHOLD_S`。事件 type:user/attachment/assistant/last-prompt/ai-title/mode/permission-mode |
| 5 cost/usage | ❌ → 砍 cost | usage 在 `message.usage`,**per-message**(每条 assistant 各自消耗),非会话累计。tail-only 拿最后一条 ≠ 会话总成本。Phase 1 砍,留 Phase 2 累计 offset 累加器 |

### status 判定规则表(idle|working|waiting|errored|unknown)

读最新 jsonl 末尾事件(spike 钉死的字段):
- **waiting**:最后一条 assistant 事件 `message.stop_reason == 'end_turn'`(0.15s 落盘,轮询能捕捉)
- **working**:最后事件 `tool_use` / `stop_reason=='tool_use'`,timestamp 在 idle 阈值内(autonomous 循环判 working)
- **idle**:最后事件 timestamp 距 now > `CC_WEB_IDLE_THRESHOLD_S`(默认 30s 起步,build 时用真实长任务样本校准)
- **errored**:最后事件含 error 字段 / 异常 stop_reason(需解析真实 error 样本确认字段,build 时补)
- **unknown**:cwd→slug miss / slug 碰撞 / cwd 漂移 / jsonl 解析错 → unknown + 日志,绝不 500

### cost 决定(用户拍板:砍)

Phase 1 **砍 cost 字段**。response schema 改为 `{ sessions: [{ name, status, lastLine }] }`。Scope Decisions 表第 4 行从 ACCEPTED Phase 1 改 DEFERRED Phase 2。理由:usage per-message,tail-only 数学上算不准累计,显示会撒谎的数字比不显示更糟(同类"状态不准摧毁核心价值"问题)。

### heuristic 回退最小设计(M11,B 计划)

spike 已 GO,heuristic 不启用。留设计防准则 2/3 在真实多会话下恶化:
- **三态**:working(连续两次 capture-pane 内容不同)/ waiting(末行匹配 Claude TUI 提示符候选:`>` 空输入行、`❯`、`Do you want to`、Yes/No)/ idle-unknown(内容稳定无提示符)
- **二态降级**(三态准确率 <80%):working(内容在变)/ idle(内容稳定),纯时间差,始终可派生
- **errored**:heuristic 不判,留 JSONL
- 定位:JSONL 是主路径,heuristic 仅作 JSONL 完全失效(tmux 挂、目录全 miss)的兜底显示

### go 决定

JSONL 路线 **GO**。命门(准则 1 实时 + 4 字段)通过。准则 2/3 风险用 unknown 降级 + 缓存映射应对。准则 5 砍 cost。下一步:按 M1-M9 铁律 build Phase 1。

## UI 设计决策(2026-06-27 design review,build 时必须遵守)

`plan-design-review` 产出(文字线框模式,聚焦真问题)。补全设计文档原本只写功能、没定死"用户看到什么"的部分。色板/线框/文案/断点定死后 build 照此执行。

### 视觉锚点(对齐现有 `public/index.html` + `style.css`)

- **浅色主题**(非深色):底 `#ffffff`,字 `#1a1a1a`(style.css:16-17)。dashboard 必须浅色,与 index.html 一致。
- 字体:系统栈 `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto...`(style.css:14)。
- 复用间距:行 padding `12px 20px`(同 header),gap `12px`。
- 圆角:徽章 pill `12px`(复用 `.status`,style.css:70)。
- **引入 CSS 变量**:现有 style.css 用硬编码色值,无 `:root` 变量。dashboard 新建 `dashboard.css` 时定义 `:root` 变量(`--color-waiting` 等),服务 dashboard 也给现有 UI 升级路径。**不强制**回改 index.html(scope 控制)。

### 徽章色板(色盲安全 = 颜色 + 图标 + 文字三重编码)

红/绿对色盲最难区分,**绝不只靠色**。每态独立图标 + 文字。

| 状态 | 色值 | 图标 | 文案 | 排序权重 | 动画 |
|---|---|---|---|---|---|
| waiting | amber `#f59e0b` | ⏳ 沙漏 | 等待 | 0(顶) | 呼吸脉冲 |
| errored | 红 `#ef4444` | ✕ | 出错 | 0(顶) | 无 |
| working | 品牌 `#d4a574` | ◐ 转 | 进行中 | 1 | 无 |
| idle | 灰 `#9ca3af` | ○ | 空闲 | 2 | 无 |
| unknown | 虚线描边 `#ccc` 无填充 | ? | 未知 | 3 | 无 |

- **绿 `#22c55e` 不用于状态**(留给 `.status.connected` 连接成功语义,style.css:75)。waiting 用 amber(语义"需你出手"= 注意,非"成功")。
- **脉冲仅 waiting**,且 `@media (prefers-reduced-motion: reduce)` 关闭(无障碍)。
- **对比度警告**:amber `#f59e0b` 在白底做小文字对比度不足(~2.9,< WCAG AA 4.5)。amber 徽章用**填充底 + 深字**(`#f59e0b` 底 + `#7c2d12` 深棕字)或**深 amber 边 + `#b45309` 字**。build 时用对比度工具验证 5 态文字 ≥4.5:1。

### 列表行布局

桌面(≥640px):
```
● 等待  cc-web-control              2m
        ▸ 最后: "现在帮我重构 server.cjs"
```
- 行 1:徽章 pill + 会话名(`font-weight:600`) + idle 时间戳(右对齐,灰 `#666`,12px,同 `.status` style.css:67)
- 行 2:末行预览 `lastLine`,缩进对齐会话名,灰 `#666`,`white-space:nowrap; text-overflow:ellipsis` 单行截断
- 整行可点(`<a>`/`<button>`),`min-height:48px`(≥44px 触控),hover 底 `#f5f5f5`
- 点行 → `?session=X` → 现有单会话全控
- 排序:排序权重升序(waiting/errored 0 → unknown 3),同级按时间戳倒序(最新在上)
- idle 时间戳派生:`now - 末事件 timestamp`(准则 4 钉死的 ISO8601 字段),<60s "刚刚",<60m "Nm",否则 "Nh"

移动端(<640px):
- 末行预览 `display:none` 折叠
- 行 `min-height:48px`,会话名 `text-overflow:ellipsis`
- 三件套:徽章 + 名字 + 时间戳
- header 标题计数并入标题文字

### 空状态 / 错误状态文案(温度 + 动作,设计原则 1)

| 场景 | 用户看到 | 主动作 |
|---|---|---|
| 无会话(tmux 0 sessions) | "还没有会话。开一个 Claude 会话,这里自动出现。" | 文字引导(不报错) |
| tmux 没起(tmuxOk=false) | "tmux 没起来或没装。装好再刷新。" | 刷新按钮 |
| 全 unknown(都 cwd miss) | "看不到会话状态,可能是目录没匹配上。" | 提示看 debug 日志 |
| 首次 loading | 骨架行 / "加载会话…" | — |
| 单会话 unknown | 该行徽章 `?` + "未知",其余正常 | 点进去仍可用 |

绝不 500、绝不空白(M3)。unknown 是特性不是 bug。

### 标题 / favicon 计数

- **`document.title`**:waiting>0 → `(N 等待) CC Remote`,N=0 → `CC Remote`。纯 JS,Phase 1。
- **favicon 动态徽章**(canvas 画 N 角标):**Phase 2**(避免 canvas/favicon API 复杂度)。Phase 1 只 title 计数。

### App UI 规则对齐

这页是 **App UI**(数据密集工具列表),非营销页:
- 单一职责:列表只做"看状态 + 点进去",不塞其他
- 不用卡片网格,**行 IS 交互单元**(AI slop 规则:cards earn existence,这里行够)
- copy 是工具语言(等待/进行中/空闲/出错/未知),非 mood/brand
- 无装饰阴影、无渐变、无装饰图标(设计原则 8 减法默认)

### 5-10 会话密度

5-10 会话(中),列表为主,**不强制虚拟滚动**(已定)。行高 48px,10 行 = 480px,手机一屏可滚完。>20 会话才考虑虚拟滚动(留 TODO)。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | SELECTIVE EXPANSION, 3 proposed / 3 accepted / 2 deferred |
| Outside Voice | `/codex review` | Independent 2nd opinion | 1 | issues_found | 战略向(claude fallback);headline refuted, secondary risks absorbed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | complete-not-ready → spike GO;M1-M9 铁律 + spike 5 准则全过 |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 4→9/10, 8 decisions, 0 unresolved |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** CEO + ENG + DESIGN CLEARED。spike GO(5 准则),UI 决策定死。**ready to build Phase 1**(按 M1-M9 铁律 + "UI 设计决策" section 执行)。
