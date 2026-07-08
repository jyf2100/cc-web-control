# Hub 看板重设计:摘要为中心的信息架构

> 状态:**设计已确认(2026-07-07 brainstorming)+ demo 定标(2026-07-08)**,待 spec review + writing-plans。
> 2026-07-08 高保真 demo(`/tmp/dashboard-redesign-demo.html`,专家团队三视角修订:布局实测 Playwright / 信息架构 / 可访问性)已落地并验收,本文档已据此订正——几何一致性、可访问性、离线卡内容、计数符号(见 §4/§7/§8 及各节订正)。
> 实现依赖 `feat/hub-dashboard-only-jump` 先合并到 main;实现分支基于合并后的 main 开。
> 本文件先写工作区、暂不提交,等看板重设计分支建好时作为首个 commit。

## 背景 / 动机

当前 hub 看板(`:7685/dashboard.html`)单卡把 **6 个字段平铺**在一个 grid 行(`auto auto 1fr auto`):
`.s-dot`(色点)+ `.s-icon`(emoji 图标 ▶⏸✕⏳⌽)+ `.card__name`(机器名)+ `.card__session`(会话名)+ `.card__last`(摘要)+ `.card__time`(时间)。

三个信息架构层面的真问题:

1. **字段平铺、无主次层级** —— 6 个东西一行,扫视时眼睛找不到锚点。
2. **状态双编码冗余** —— 色点(`--working` 绿等)与 emoji 图标重复表达同一状态,占两格不增信息,且与 editorial 风格不搭。
3. **机器名重复** —— hub 已按机器分组(`.machine-group` 组标题 = 机器名),卡片里机器名又当主标题,会话名反被压成副行。同一机器名出现两次,挤掉真正有用的「会话名 / 最近在干啥」。

## 目标

重设计 hub 看板单卡信息架构为「**摘要为中心**」:会话名为主锚、摘要独占 2 行成为视觉主角、机器名退到组标题。让用户一眼扫到「哪个会话、在干啥」。

## 非目标

- 不动顶栏结构(只统一 `fleet-summary` 状态计数呈现语言)
- 不改单机模式 `:7684` 卡片(保留旧排版)
- 不引入深色模式(`tokens.css` 纯浅色)
- 不引入全卡状态染色(用户明确未选「状态条强调」方向)
- `errored` 不额外强化(只靠色点,不染色、不加左缘条)

## 依赖

`board_render.cjs` 是 `feat/hub-dashboard-only-jump` 分支(Task 7)从 `console_render.cjs` 抽出的;main 上尚无此文件。本重设计**依赖 hub 分支先合并到 main**。实现分支基于合并后的 main 开。

## 设计

### 三级信息层次

| 层级 | 载体 | 内容 |
|---|---|---|
| 全 fleet 概览 | 顶栏 `fleet-summary` | N 机在线 · M 会话 · 各状态计数 |
| 单机概览 | `.machine-group` 组标题 | 机器名 + 在线/离线 + 该机状态计数 + 会话数 |
| 单会话详情 | `.card` 卡片 | 会话名 + 状态 + 摘要 + 时间 |

### 1. 单卡(hub 模式)

字段权重三层:

- **L1 主锚(扫视)**:状态点(9→**11px**)+ **会话名**(semibold,`--fg`)
- **L2 信息(判断在干啥)**:摘要 **2 行**(`-webkit-line-clamp:2`,`--fg-2`)—— 视觉主角
- **L3 元数据(细节)**:时间(右上,11px mono,`--fg-2`)—— demo 订正:原 `--fg-3`(rgba .35)对比度仅 ≈2:1 不过 WCAG AA,改 `--fg-2`(≈5.2:1 过 AA)

DOM 调整(基于现有 `buildCardInner`):

- **删** `<span class="s-icon">`(emoji 图标,与色点冗余)
- `card__name` = **会话名**(hub 模式);单机模式仍 = 机器名(见 §2)
- `card__session` = hub 模式机器名退到组标题后,此 span 可省(或保留空)
- `card__last` = 摘要,2 行 line-clamp
- `card__time` = 时间,grid 末列 / 绝对定位右上

样式细则:

- 状态点 `width/height: 11px`;`errored`/`working` 加 `box-shadow: 0 0 0 3px var(--<status>)33`(同色半透明环),活跃态更跳但克制
- 摘要:`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; line-height:1.4`;颜色 `--fg-2`(承载真实信息,非装饰 `--fg-3`);`cleanSummary` 60 字符逻辑截断 + CSS 2 行视觉截断双层兜底
- 时间:11px `--mono`,`--fg-3`,不抢主锚
- `errored`:**只**靠玫红色点 + 环(不染色摘要、不加左缘条)
- `button.card__select`(多选):左上 24×24 命中区,默认 `--fg-3` 弱化;`:hover` 高亮 `--fg-2`、`[aria-pressed="true"]` 选中高亮 `--fg` + `--accent-dim` 边框(demo 订正:原 `--accent-2` 在 `--accent-bg` 上仅 4.2:1 不过 AA);加 `:focus-visible` 统一 2px `--accent-2` 焦点环
- **选中态卡级高亮**(demo 新增):`.card-row:has(.card__select[aria-pressed="true"]) .card { border-color:var(--accent); background:var(--accent-bg); }` —— 选中只写在 22px 小按钮上会被肉眼漏看(曾被误判"卡片消失"),必须有卡级 affordance

### 2. 单机模式 `:7684`

保留旧排版(机器名主 + 会话名副行)。`buildCardInner(machine, session, opts)` 加 `opts.mode`(`'hub' | 'single'`),默认 `'single'`(向后兼容现有调用);hub 渲染路径传 `'hub'`。

### 3. 分组(组标题增强)

`.machine-group` 组标题现为机器身份唯一锚点,增强为:

- 机器名(`--fg`,semibold)+ 在线/离线标签
- 状态计数:色谱小圆点 + 数字(`--mono` 小字),**无 `×` 符号、无 emoji**(用户明确要求"不要出现 X"),如「●2  ●1  ●1」;单机维度从 `summarizeFleet` 类似逻辑算;每点带 `title` 中文语义(工作中/等待用户/出错/空闲/离线)
- 会话数:`N 会话`(`--fg-3`)
- 离线机组:灰、排末尾(`groupByMachine` 已有)
- **不折叠**

### 4. 网格(几何一致性 —— demo 定标核心)

- 列宽:`repeat(auto-fill, 244px)`(固定列宽,避免稀疏行被 `1fr` 拉伸致宽窄不一)
- **等高**:`grid-auto-rows: 104px`(经 grid → `li.card-row` → `a.card` 两级 `align-items:stretch` 完整传递,所有卡片同高)
- **等宽**:`.card { flex:1 1 0%; min-width:0 }` —— **这是「卡片大小不一」的真根因**:`.card-row` 是 row 向 flex(`button.card__select` + `a.card`),若 `.card` 不设 flex(默认 `0 1 auto`),离线卡内容少会缩到 ~106px、在线卡被摘要撑到 217px,眼睛把「变窄 + 内部留白」误读成「变矮」。`flex:1 1 0%` 让 basis 归零、grow 吃满剩余主轴,所有卡同宽;`min-width:0` 防 min-content 撑爆单元格。实测 7 张卡统一 217×104。**别用 `min-height` 兜高度**(治标,真问题是宽度塌缩)。
- `gap:10px`;`.card-row` 内 `gap:8px`(降低小按钮与大卡片误触)

### 5. 边缘态

- 无机器注册 → 居中引导文案(注册机器到 `hub-machines.json`)
- 有机器无会话 →「该机暂无活跃会话」
- 加载中(首次拉取前)→ 轻量「正在拉取 fleet…」(2s 轮询,转瞬)
- 过时(>24h `waiting`/`unknown`)→ `partitionStale` 折叠到底部 `.board-stale-group`(已有,保留)
- 离线机组 → 排末尾;卡片**补占位内容**(demo 订正:原单字「(离线)」空洞,且宽度塌缩后几乎不可见):`card__last` =「主机离线,暂无实时状态。上次摘要:…」(向在线卡 L2 看齐)、`card__time` =「Nh 前在线」(替「—」)、`card__head` 加 `<span class="card__off">离线</span>` 文字标签、offline 点用空心环(见 §1)、离线卡 `aria-disabled="true"` + `cursor:not-allowed` + 抑制 hover

### 6. 顶栏

**不动结构**。`fleet-summary` 状态计数统一用色谱小圆点 + 数字(与组标题一致),**无 `×`、无 emoji**;计数须自洽——**点和 = 总会话数**(补齐 working/waiting/errored/idle/offline 五通道),如「2 1 1 1 2」= 7;文案「1 机在线 · 1 机离线 · 7 会话」(机维度如实区分在线/离线,不写「2 机在线」)。

### 7. 几何一致性总则(demo 实测结论)

> 见 §4。一句话:**等高靠 `grid-auto-rows` + 两级 stretch;等宽靠 `.card { flex:1 1 0% }`**。布局专家用 Playwright 实测:7 张卡统一 217×104,「离线卡变矮」是误判,真因是宽度塌缩。

### 8. 可访问性(demo 新增)

- **对比度**(WCAG AA 4.5:1 小字 / 3:1 图形):时间、会话总数、离线文字一律 `--fg-2`(原 `--fg-3` 仅 ≈2:1);`--idle` 透明度 0.3→0.55(图形对比过 3:1);选中/悬停文字 `--fg`/`--fg-2`
- **状态不唯一靠色**:每张卡 `card__head` 内加 `<span class="sr-only">运行中/等待中/出错/空闲/离线</span>`(色盲/低视力冗余);idle(实心)与 offline(空心环)形状区分,不靠 alpha
- **离线卡**:`aria-disabled="true"` + `cursor:not-allowed`,不再作可激活链接误导
- **命中区**:`.card__select` 24×24(WCAG 2.2 SC 2.5.8)
- **焦点**:`.card__select:focus-visible` 与 `.card`/`.logout` 统一 2px `--accent-2` 环
- **动效**:`@media (prefers-reduced-motion: reduce)` 禁用 `.card`/`.card__select`/`.logout` 的 transition

## 实现要点(供 writing-plans 细化)

- `public/board_render.cjs`:`buildCardInner` 加 `opts.mode` 分支;组标题渲染加状态计数(扩展 `groupByMachine` 输出或新函数)
- `public/dashboard.css`:单卡 IA 重写 / 组标题样式 / 状态点 11px + 环 / 摘要 line-clamp / 多选 button 位置
- `public/dashboard.js`:组标题或多选交互变化(预计小)
- 测试同步:
  - `test/board_render.test.cjs`(DOM 契约:删 `s-icon`、hub 模式 `card__name`=会话名、组标题状态计数 DOM)
  - `test/dashboard_style.test.cjs`(CSS 断言:状态点 11px、摘要 line-clamp、无 `.s-icon` 规则)
- 顺带清理(卡片段重写时一并):`feat/hub-dashboard-only-jump` 遗留的死 CSS(`.console-app`/`.console-hero`/`.console-term`/`#ma-screen`/`.ma-btn`/`#term-input`/`.topbar-back`/`#main-agent-panel` 等)+ 假阳性断言(`#ma-screen` flex / `.console-term` flex / `.ma-btn` 44px / `#term-input` focus+font / `.topbar-back` focus / `#main-agent-panel[hidden]` / `.console-term[hidden]`)

## 风险 / 取舍

- 卡片变高 → 一屏卡片变少(用户已接受:换信息量)
- 单机/hub 双模式分支增加 `buildCardInner` 复杂度(用户选保留单机旧排版的代价)
- `board_render.cjs` 的 `relativeTime` 与 `console_render.cjs` 重复(预存技术债,本设计不动)

## 不变项(安全 / 行为契约)

- `/jump` + 15s 一次性 ticket 自动登录流程不变
- hub/单机 cookie 隔离(`cc_web_hub_auth` vs `cc_web_auth`)不变
- 卡片 click 仍新标签跳转(`target="_blank"` + `rel="noopener noreferrer"`)
- 多选 + 扇出广播不变
- Referrer-Policy same-origin 双端不变

## 决策日志(2026-07-07 brainstorming)

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | 重设计方向 | 信息密度与排版 → 摘要为中心 | 摘要最有信息量,应为主角 |
| 2 | 单卡排版方向 | 摘要为中心(非紧凑单行/非状态条) | 优先「看每台在干啥」 |
| 3 | `errored` 强化 | 只靠色点(不染色/不加左缘条) | 克制,尊重「摘要为中心」 |
| 4 | 单机模式 `:7684` | 保留旧排版 | 单机场景不同,不改动 |
| 5 | 组标题 | 增强组标题(机器名+状态计数+会话数) | 机器名移走后补全单机概览层 |
| 6 | 分支策略 | 先合并 hub 再重设计 | base 干净,避免 rebase 冲突 |
| 7 | 卡片等宽 | `.card { flex:1 1 0% }` | demo 实测:不设 flex 则离线卡内容少缩到 ~106px,误读"变矮"(2026-07-08) |
| 8 | 选中态 | 卡级 `:has()` 高亮 | 只写小按钮会被漏看,曾误判 sess-3"消失"(2026-07-08) |
| 9 | 离线卡内容 | 补占位摘要 + "Nh 前在线" | 原「(离线)」空洞且塌缩后不可见,密度向在线看齐(2026-07-08) |
| 10 | 计数符号 | 圆点+数字,无 `×`/emoji | 用户明确"不要出现 X"(2026-07-08) |
| 11 | 对比度 | `--fg-3`→`--fg-2`、`--idle` 0.55 | 过 WCAG AA / 图形对比(2026-07-08) |
| 12 | a11y | sr-only 状态 + 24×24 + reduced-motion | 状态不唯一靠色、命中区达标(2026-07-08) |
