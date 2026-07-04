# 单机多会话 看板/控制台 重设计 Design Spec

- **日期**:2026-07-04
- **状态**:待用户 review(3 个决策点待定,见 §7)
- **方向**(用户 AFK 时代决,基于最佳判断):针对**单机多会话开发**场景重设计,保留多机扩展性
- **前提确认**:配色已与参考稿对齐(暖米白 `#f2f1ed` + 暖橙 `#d9651a` + 终端 `#1a1815`),**无需改动**

---

## 1. 背景与根因

参考设计稿(localhost:62876 / ios-mockup)面向**「多机运维监控」**场景:
- 5-6 台不同机器(api-gw / worker-1 / build-srv …)
- 近期会话(5m / 1m 前)
- 简短进度行("npm install ✓ · tsc 编译中…")
- 状态丰富(working 绿 / idle / errored / waiting 混合)

实际 :7685 是**「单机多会话开发」**场景(一手数据):
- 1 台机器 `mac-pro`,9 个会话
- 几乎全是陈旧 waiting / unknown(633h / 148h / 32h 前 = 26天 / 6天 / 1天前)
- `lastLine` 是终端整段 markdown 原文(`"## 收尾完成 ✅ \`memory→harness-memory\`…"`)
- `0 working`(无活跃)

**"惨不忍睹"的真因 = 场景错配**,不是配色、不是布局 bug:
- 面向"多机运维"的设计,喂入"单机开发"数据 → 卡片全是 `mac-pro`(机器名重复无信息量)、一片琥珀 waiting(死气)、`633h 前`(时间难看)、markdown 残留当摘要(不专业)。

**本设计的"对齐"目标**:对齐参考稿的**设计语言**(配色 / 排版 / 信息层次 / 专业感),而非其**多机数据形态**。字面照搬多机布局在单机下会更糟。

## 2. 设计原则

1. **单机时弱化机器维度,强化会话/项目维度** —— 机器名 `mac-pro` 重复无信息量;会话名 / 项目路径才是主语。
2. **lastLine 净化为干净摘要** —— 去终端 ANSI + markdown 标记,截断 1 行。
3. **时间分级友好** —— 加天 / 周档,告别 `633h 前`。
4. **陈旧会话降权 / 折叠** —— 实时状态(working / errored / waiting/unknown<24h)置顶,陈旧 waiting/unknown(>24h)折叠(§1 痛点:633h unknown 与 waiting 同为死会话,一并折叠)。
5. **保留多机扩展性** —— ≥2 台机器自动恢复机器维度(机器名 + 分组),响应式。

## 3. 单机判定

- **规则**:`flattenFleet(machines)` 后,不同 `machine.id` 数量 `≤ 1` → 单机模式。
- 单机触发:卡片弱化机器名、HERO 简化、fleet summary 改"会话维度"措辞、抽屉显示会话列表。
- 多机(≥2):维持现有多机布局(机器名当主标题),仅享受 lastLine 净化 + relativeTime 天档 + 陈旧排序的通用改进。

## 4. 改动清单

### A. 纯函数层(UMD,浏览器 + node --test 双跑)

#### A1. `terminal_cleaner.cjs` 新增 `cleanSummary(raw, maxLen)`
- 复用 `cleanOutput`(去 ANSI / OSC / 分隔线)。
- 去 markdown 行内标记:`## `/`### `(标题前缀)、`**x**`/`__x__`/`*x*`/`_x_`(强调)、`` `x` ``(行内码)、`- `/`* `(列表符)、`> `(引用)→ 纯文本(保留文字)。
- 折叠连续空白为单空格,trim。
- 截断 `maxLen`(默认 `60`),超出加 `…`。
- 纯函数,`null/undefined → ''`。
- 导出:`return { cleanOutput, cleanSummary }`。

#### A2. `relativeTime` 加天 / 周档 —— `board_render.cjs` + `console_render.cjs` 双处同步
现:`≥1h → "Nh 前"`(导致 `633h 前`)。改为:
- `<5s → "now"` / `<60s → "{N}s 前"` / `<60m → "{N}m 前"` / `<24h → "{N}h 前"` / `<7d → "{N}d 前"` / `<30d → "{N}w 前"` / `≥30d → "{M}个月前"`
- 两处独立(UMD 模块独立性),保留"改一处需同步另一处"注释。
- **不**抽取共享模块(避免改 UMD 加载方式,YAGNI)。

#### A3. `board_render.cjs` 接入 `cleanSummary`
- UMD factory 改为依赖 `TerminalCleaner`(对齐 `console_render.cjs`):`factory(require('./terminal_cleaner.cjs'))`,浏览器侧 `root.TerminalCleaner`。
- `dashboard.html` 增加 `<script src="terminal_cleaner.cjs">`(在 board_render 之前)。
- `buildCardInner` 的 `card__last`:`escapeHtml(cleanSummary(lastRaw, 60))` 替代 `escapeHtml(lastRaw)`。
- 离线回退 `'(离线)'` 不经净化。

#### A4. `sortCardsErroredFirst` → `sortCardsByRelevance`(陈旧降权)
现排序键:`errored < working < waiting < idle < unknown < offline`(只按 status,陈旧堆顶)。改为二级:
- 一级(status rank):`errored(0) < working(1) < waiting(2) < idle(3) < unknown(4) < offline(5)`(不变)
- 二级(时间,新→旧):同 status 内按 `lastTs` 降序(最新活动置顶)
- **陈旧降权**:`waiting` 且 `lastTs < now - 24h` → rank `4.5`(降到 unknown 之后、offline 之前),落入"陈旧区"。
- 重命名导出为 `sortCardsByRelevance`,同步更新 `board_render.test.cjs`(原 `sortCardsErroredFirst` 测试改名 + 新增陈旧降权用例)。不保留别名(避免技术债)。

#### A5. `buildCardInner` 单机感知
- `opts.singleMachine`(boolean):
  - `true`:card__name = 会话名(`s.name`);card__session = 项目路径(若 `s.cwd`)或留空;不渲染重复机器名。
  - `false`(多机,现状):card__name = 机器名,card__session = 会话名。
- `flattenFleet` 透传 `cwd`(若 hub 提供)到 session,供单机副行。

#### A6. 新增 `isStale(card, now)` 纯函数
- `(card.status === 'waiting' || card.status === 'unknown')` 且 `card.lastTs && (now - card.lastTs) > 24h` → `true`。
- waiting 与 unknown 同为"挂起无进展"语义(§1 痛点:633h unknown 与 waiting 并列),陈旧阈值统一,一并折叠。
- 供 `sortCardsByRelevance` 与 dashboard.js 分组折叠共用,单一真相源。

### B. 看板渲染(`dashboard.js` / `dashboard.css` / `dashboard.html`)

#### B1. `dashboard.js` renderBoard:单机感知 + 陈旧折叠
- 计 `machines` 不同 `id` 数 `≤ 1` → `singleMachine = true`,传入每张卡片 `buildCardInner`。
- `sorted` 后按 `isStale` 分两组:
  - **活跃组**(非陈旧):照常渲染到 `#board-body`。
  - **陈旧组**(陈旧 waiting):渲染进 `<details class="board-stale-group"><summary>N 个陈旧会话(>24h)</summary>…</details>`,默认 `closed`。
- 无陈旧会话时不出现折叠区(零陈旧 → 零噪音)。

#### B2. fleet summary 单机措辞 + 提权
- 现(header 角落):`▶ 0 ⏸ 0 ✕ 1 在线 1/1`(机器维度)。
- 单机时改会话维度:`{active} 活跃 · {stale} 陈旧 · {errored} 异常`(例:`0 活跃 · 6 陈旧 · 1 异常`)。
- 位置:仍用 `#fleet-summary`(header),CSS 提权(font-size 增大);多机时维持原机器维度措辞。

#### B3. `dashboard.css` 卡片单机态 + 折叠区样式
- `.card[data-single="true"] .card__name`(会话名当主标题,字号/字重保留)。
- `<details class="board-stale-group">` 样式:summary 触摸目标 44pt、`var(--fg-2)`、展开内容继承 `.board-grid`。

### C. 控制台(`console.html` / `console.js` / `console_render.cjs`)

#### C1. HERO 单机简化
- 现:`Command Bridge / 主控 agent / [Start][Stop][▾镜像]` —— 单机开发场景概念过重。
- 单机时改为**会话状态 hero**:会话名 + 状态点 + 项目路径 + `relativeTime(最后活动)` + 干净摘要(`cleanSummary`)。
- "主控 agent / Command Bridge" 单机时**完全去掉**(多机时保留)—— §7-2 已定。

#### C2. 空态优化(未选机器直接访问 console.html)
- 现:`data-disabled="true"` 整页 `opacity:.5` 灰掉。
- 改为:HERO 区引导"从看板选一个会话开始"+ 最近会话快捷入口(读 hub fleet 取最近 N 个,点击带 `?m=&s=` 跳入)。

### D. 抽屉(`switch_sheet.cjs` / `console.js`)
- 单机时抽屉展示**会话列表**(`buildSessionItems`),快速切到某会话终端(带 `?m=&s=` 跳 console)。
- 多机时维持现状(项目启动 / 机器会话两级)。
- `switch_sheet.cjs` 已有 a11y 契约(role=dialog / aria-modal / inert / tab trap / Esc),不破坏。

## 5. 测试策略(TDD,`node --test test/*.test.cjs` 同步)

现有 **506 测试全绿**为基线,改动须保持绿(契约变更同步更新测试)。

**新增/更新**:
- `terminal_cleaner.test.cjs`:`cleanSummary` —— markdown 剥离(`## ` `**x**` `` `x` `` `- `)、截断 + `…`、`null → ''`、ANSI 残留净化。
- `board_render.test.cjs` + `console_render.test.cjs`:`relativeTime` 天/周/月档(`<7d → Nd 前`、`<30d → Nw 前`、`≥30d → N个月前`)。
- `board_render.test.cjs`:
  - `isStale`:边界(23h59m → false、24h01m → true、无 lastTs → false)。
  - `sortCardsByRelevance`:errored 仍首位;陈旧 waiting 降到活跃 waiting 之后;同级按 lastTs 降序。
  - `buildCardInner({singleMachine:true})`:card__name = 会话名、不含机器名重复。
  - `buildCardInner` lastLine 经 cleanSummary:`"## 收尾 ✅"` → `"收尾"`。
- `console_style.test.cjs`:若有 markup 锁定单机 hero 文案,同步更新;新增 `<details class="board-stale-group">` 与 `data-single` 契约。

## 6. 非目标(YAGNI)
- 不改配色(已对齐)。
- 不重构 UMD 加载方式(保持各 `.cjs` 独立 dual-load)。
- 不做多机视图重设计(单机为主;多机维持现状 + 通用改进)。
- 不引入构建工具 / 框架(原生 JS + UMD)。

## 7. 已定决策(用户 2026-07-04 确认)

1. **陈旧会话处理**:折叠,默认收起(`<details closed>`)。
2. **"Command Bridge / 主控 agent" 概念**:单机时**完全去掉**(多机时保留)。
3. **单机判定阈值**:不同 `machine.id ≤ 1` 即单机。

---

## 附:目标视觉(ASCII,单机看板态)

**卡片(单机,会话名当主标题)**:
```
┌──────────────────────────────────┐
│ ▶ cc-web-control         2h 前    │   ← 会话名(主,working 绿点)
│ ~/workspace/cc-web-control       │   ← 项目路径(副,mono fg-2)
│ 全部测试通过 73/73 绿…            │   ← 干净摘要(cleanSummary 后)
└──────────────────────────────────┘
```
对比现状:机器名 `mac-pro` 当主标题(9 张全重复)。

**陈旧折叠区**:
```
▶ 活跃会话 (3)
  [卡片] …

▼ 陈旧会话 (6,>24h)        ← <details> 默认折叠,点击展开
```

**fleet summary(单机,会话维度)**:
```
CC 看板     0 活跃 · 6 陈旧 · 1 异常
```
对比现状:`▶0 ⏸0 ✕1 在线1/1`(机器维度,角落 .85em)。
