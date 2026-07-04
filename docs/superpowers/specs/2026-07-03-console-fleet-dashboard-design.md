# console.html · Fleet Dashboard 重构设计 (v2 · 审核修订版)

> **状态**:设计稿 v2(经 3 专家审核 + 用户决策修订,待 review)· **方向**:方案 C 现代多机仪表盘
> **作用域**:`public/console.html` + `public/dashboard.css`(console 段) + `public/console.js`(render + ensureWs 段)
>
> **v2 修订基础**:3 个 UI/UX 专家并行审核(UX/a11y、视觉/设计系统、技术/产品IA)+ 用户 3 项产品决策。关键修订见 §0。

---

## 0. v2 修订记录(相对 v1)

| # | 来源 | 修订 |
|---|---|---|
| C1 | 技术审核 🔴 | **纠正"418 测试覆盖 console.js"误判**:grep 全仓确认 console.js 的 render/WS/广播/主控逻辑**实际单测覆盖 = 0**(仅路由 302 + 静态缓存头测试)。本重构须**从零编写** console render 契约测试,工作量按 greenfield 估(见 §12) |
| C2 | a11y审核 🔴 | 卡片"最后活动时间" `--fg-3`(2.07:1)→ `--fg-2`;`.s-dot--idle`(0.3 alpha,1.8:1)加内描边达非文本 3:1 |
| C3 | a11y审核 🔴 | **补主终端 WS 重连 + 断线反馈**(原 spec 误以为"重连逻辑不改",实际 `ensureWs` 根本无 onclose/onerror)→ 新增 §5.5,纳入改动范围 |
| A1 | 技术审核 🟠 | **广播融合单输入**:`#term-input` 按 `selected.size` 分发(0/1→attach,≥2→broadcast);`#broadcast-bar`/`#bc-input`/`#bc-send` 作废(见 §5.4) |
| A2 | a11y+技术 🟠 | `renderBoard` 改 **keyed-diff 差分更新**(以 `machine/session` 为 key 复用 `<li>`),保留 scrollTop/focus/动画(原 2s 全量 `innerHTML=''` 重建) |
| A3 | a11y审核 🟠 | 卡片键盘可达:`<li>` → `<li><button class="card">` 或 `role="button"+tabindex`,加 `aria-label`;Enter/Space→attachTarget |
| A4 | 视觉审核 🟠 | 左色条优先级链 `errored > selected(.active) > waiting`;waiting 卡底改 `--waiting-bg`(原 = `--accent-bg` 与 selected 撞车);`.card--selected` 独立视觉(外描边+角标) |
| A5 | 技术审核 🟠 | HERO L3 展开改**浮层/抽屉覆盖**卡片网格(原 40vh 占布局会挤死网格) |
| A6 | a11y审核 🟠 | 移动纵向预算 + 终端**可下拉收起** + HERO 移动端**收进 topbar**;键盘弹起用 `visualViewport`(非 `100dvh`) |
| A7 | a11y+视觉 🟠 | 空态定义(无机器);状态图标 `aria-hidden`;HERO L1 数字/状态词一律 `--fg-2`(色仅图标+dot 承载) |
| A8 | 技术审核 | **`style.css` 兼容性已核实**:全局 `html,body{overflow:hidden}` + `#app` flex 与 console 兼容(console 无 `#app`),**无需改 style.css**;仅需 dashboard.css console 段补 `.console-app` 顶层 flex 声明(见 §6) |
| P1 | 用户决策 | callout L2:**默认隐藏,仅错误关键词触发**(非"最新非空块")→ §9 重写 |
| P2 | 用户决策 | **砍 filter chips + 最近活动排序**,只留默认 errored-first 排序(零 UI、无 lastActivityAt 依赖)→ §5.3/§8/§10 |
| P3 | 用户决策 | **省略底部 tab bar**,topbar 加返回 dashboard 入口(console 全屏 command bridge)→ §5.1 |

---

## 1. 目标 / 非目标

### 目标
1. **归顺 token**:console.html 是全站唯一没消费 `tokens.css` 的页;迁 `dashboard.css:121-150` 硬编码到既有 token(含修白线 bug)。
2. **看板可视化**:`<table>` → 卡片网格 + 状态四重编码(色/形/图标/文字),errored 默认置顶、左色条强化,一眼可辨。
3. **放大 T1 价值**:主控 agent 升 **hero 卡片**——健康摘要(L1)+ 诊断 callout(L2,默认隐藏·错误关键词触发)+ 折叠镜像(L3 浮层)。
4. **终端常驻 + 连接健壮**:终端始终在页面下方,点卡片切换 target;**补 WS 重连 + 断线反馈**(C3),隧道抖动不再静默死。

### 非目标(YAGNI,本期不做)
- ❌ 暗色主题 / 主题 toggle(只做亮色,不推翻 `tokens.css:47` spec)
- ❌ 改 T1 后端 / 结构化 advice 标记(callout 前端关键词解析)
- ❌ **filter chips / 最近活动排序**(P2 砍;只留 errored-first 默认排序)
- ❌ 键盘快捷键层 / `/` 命令面板
- ❌ 底部 tab bar(P3 省略;topbar 返回入口替代)
- ❌ 联动 `index.html` / `dashboard.html`(console 先行)
- ❌ 虚拟滚动(N>20;现状 3-15)

---

## 2. 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 诊断 callout | **默认隐藏 + 错误关键词触发**(P1) | "最新非空块"多为噪音(进度行/日志);关键词触发信号噪音比高,且时间戳才有意义 |
| filter / sort | **只留 errored-first 默认排序**(P2) | N 通常 3-15,filter/sort 收益边际;errored 置顶+左条+图标已一眼可辨,零 UI 零字段依赖 |
| tab bar | **省略 + topbar 返回**(P3) | 终端常驻要空间;console 是全屏 command bridge |
| 终端形态 | 常驻底部,点卡片切换 target | 控制台本质:边看边发 |
| 主题 | 只做亮色,复用 tokens.css 暖灰米+暖橙 | 不推翻全站 spec、scope 不蔓延 |
| 配色策略 | **否决**子代理 cool grey 提议,复用现有 token | 全站一致性 |

---

## 3. 现状诊断(已核实)

### 3.1 `tokens.css` 已具备(直接复用)
底色 `--bg #f2f1ed`/`--bg-2`/`--surface`/`-2`/`-3`;前景 `--fg #26251e`/`--fg-2`(次文字 AA)/`--fg-3`(仅装饰,**禁承载可读文字**)/`--fg-4`(边框);边框 `--border`/`--border-2`;暖橙 `--accent #d9651a`(填色)/`--accent-2 #b54e0e`(文字/按钮 AA)/`--accent-bg`/`--accent-dim`;状态 `--waiting #c08532`/`--working #1f8a65`/`--idle rgba(38,37,30,.3)`/`--errored #c01a4b`;字体 `--sans`/`--mono`/`--serif`;圆角 `--r-xs/-sm/-r/-r-pill`;阴影 `--shadow-card`;组件 `.brand-mark`/`.btn-primary`/`.btn-ghost`/`.s-dot(+变体)`/`.s-status`/`.eyebrow`。

### 3.2 `dashboard.css:121-150` 硬编码迁移
| 行 | 现状 | 迁移目标 |
|---|---|---|
| 125 | `border-bottom:1px solid rgba(255,255,255,.08)`(白线 bug) | 卡片边框 `var(--border)` |
| 127 | `tr.row.active { background:rgba(96,165,250,.15) }`(蓝选中) | `var(--accent-bg)` + 左色条 `--accent-2` |
| 128 | `.st-* #34d399/#fbbf24/#f87171/#94a3b8/#64748b`(Tailwind) | 删,用 `.s-dot--*`+token |
| 130 | `.term-screen bg:#000 color:#e5e7eb` | 局部 `--term-bg:#1a1815`/`--term-fg:#e8e6df` |
| 133 | `.console-broadcast bg:rgba(245,158,11,.08)` | (作废,广播融入输入条 §5.4) |
| 135 | `.bc-count bg:rgba(245,158,11,.2)` | `var(--accent-dim)` |
| 136 | `.bc-send bg:#f59e0b` | (作废,用 `.btn-primary`) |
| 145-6 | `.dot.running #22c55e/.stopped #9ca3af` | 局部 `.dot.running{background:var(--working)}`/`.stopped{var(--idle)}`(无对应 s-dot 变体,保留 .dot 类) |
| 148 | `.ma-warn-banner color:#b45309` | `var(--fg-2)` + `⚠` |

### 3.3 测试覆盖事实(C1 纠正)
grep 全仓 `test/*.test.cjs`:`console.js` 的 render/WS/广播/主控逻辑**单测覆盖 = 0**。仅 `hub-server.test.cjs:294`(路由 302)+ `hub-static-cache.test.cjs:33`(`/console.js` 缓存头)间接命中,均与 render 无关。**本重构须从零编写 console 测试**(§12)。

### 3.4 `console.js` 锚点
- `ensureWs()` L32-61:**无 onclose/onerror**(C3 要补)
- `renderBoard(payload)` L86-108:全量 `innerHTML=''` 重建 `<tr>`(A2 要改 keyed-diff + 卡片)
- `refreshBroadcast()` L110-113、`bcSend.click` L115-122:A1 改融合单输入分发
- `poll()` L124-134(2s)、`renderMaStatus()` L136-153、`ensureMaWs()` L155-185(重连范本):逻辑保留

---

## 4. 信息架构与布局

### 4.1 桌面(≥1024px)
```
┌──────────────────────────────────────────────────────────────────┐
│ ◇ 多机控制台  ←看板    在线 4/5 · ▶3 ⏸1 ✕1           [#hub-status]│ topbar(返回+摘要)
├──────────────────────────────────────────────────────────────────┤
│ ◈ COMMAND BRIDGE  主控 agent (T1)         ● running    [▾镜像]    │ HERO L0+L1
│  ▶3 working · ⏸1 idle · ✕1 errored               [Start] [Stop]  │ (L2 默认隐藏)
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │✕ errored │ │▶ working │ │▶ working │ │▶ working │ │⏸ idle    │ │ 卡片网格
│ │machine-b │ │machine-a │ │machine-d │ │machine-e │ │machine-c │ │ (errored-first)
│ │ses-2 npm │ │ses-1 build│ │ses-4 push│ │ses-5 tsc │ │ses-3 idle │ │ auto-fill
│ │2m ago    │ │12s ago   │ │now       │ │40s ago   │ │8m ago    │ │ minmax(220,1fr)
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
├──────────────────────────────────────────────────────────────────┤
│ 终端 · machine-a / ses-1                              ● live [⌃] │ 终端(常驻)
│ $ npm run build                                                  │ #term-screen
│ ❯ input___                                          [扇出 N]     │ 输入(融合广播)
└──────────────────────────────────────────────────────────────────┘
HERO L3 展开 = 浮层抽屉,覆盖卡片网格区(不挤布局)
HERO L2 callout = 仅错误关键词触发时点亮
```

### 4.2 移动(<768px)—— 纵向预算硬算(A6)
iPhone 12 竖屏 ~390×780,扣 topbar(44+safe)≈60、卡片网格、终端、输入条(44+safe)。
- **HERO 默认收进 topbar**(单行 `◈ ✕1 errored · ▶3`,点开才展 L0/L1/L3)→ 省 ~80px。
- **终端可下拉收起**:默认占 ~40vh;用户下拉到 60px high-bar(只留 `● target · 输入条`),纵向还给卡片网格;上拉恢复。
- 卡片单列;终端常驻但**可收起**,解决"半屏挤死卡片只剩 2-3 张"。
- 键盘弹起:监听 `visualViewport.resize`,`--vh-available=visualViewport.height`;`#term-input` 聚焦时终端 `flex-basis:40vh` 留输入可见区(**不用 `100dvh`**——iOS 不响应键盘)。

---

## 5. 组件设计

### 5.1 topbar(P3 返回入口)
`◇ brand-mark` + `<h1>多机控制台`(visually-hidden 保大纲)+ 右侧 `← 看板` 链接(回 `/dashboard.html`)+ fleet 摘要 `在线 N/M · ▶a ⏸b ✕c` + `#hub-status`。**无底部 tab bar**。

### 5.2 卡片(看板单元,A3/A4/A7)
```
<li key="machine/session">
  <button class="card" aria-label="{机器}/{会话},{状态},最后:{lastLine 截断},{N}前">
    <span class="card__select">☐</span>          ← 多选圈(44px,桌面点击/移动长按)
    <span class="s-dot s-dot--{status}" aria-hidden="true"></span>
    <span class="s-icon" aria-hidden="true">{▶/⏸/✕/⏳/?}</span>
    <span class="card__name">{机器}</span>         ← --fg
    <span class="card__session">{会话}</span>      ← --fg-2
    <span class="card__last">{lastLine 截断}</span>← --fg-2
    <span class="card__time">{N}前</span>          ← --fg-2(C2:原 --fg-3 违规)
  </button>
</li>
```
- **键盘可达(A3)**:`<button>` 天然 Tab 可聚焦,Enter/Space→attachTarget。
- **左色条优先级链(A4)**:`errored > selected(.active) > waiting`,用 `box-shadow: inset 3px 0 0 var(<色>)` 叠加,按优先级单选一条。
- **waiting 底改 `--waiting-bg`**(`rgba(192,133,50,.08)`,console 局部),不再撞 `--accent-bg`。
- **`.card--selected`**(广播成员,与 `.active` 正交):`2px solid var(--accent-2)` 外描边 + 右上角扇出角标。
- **errored 卡**:左 `--errored` 色条 + 图标放大(最高视觉优先级)+ 默认置顶。
- **空态(A7)**:`machines=[]` → `<ul>` 替换 `<div class="state-message">`(复用 `dashboard.css:72`),`eyebrow: NO MACHINES` + lede `尚无机器注册到 hub`。
- **多选圈**:桌面保留可见 44px checkbox(放大);移动增长按(≥450ms+触觉)快捷进入多选 + `user-select:none;-webkit-touch-callout:none;touch-action:manipulation` 抑制系统手势。

### 5.3 排序(P2 砍 filter)
仅默认 **errored-first** 排序:`errored → working → waiting → idle → unknown → name`。纯前端 sort,无 UI、无 lastActivityAt 依赖。

### 5.4 终端(常驻)+ 广播融合单输入(A1)
- `#term-target`(含连接态,见 §5.5)+ `#term-screen`(flex:1,`min-height:220px`)+ `#term-input-form`。
- **单 `#term-input`**:`submit` 时按 `selected.size` 分发——`0/1` → `{type:'input',target:currentTarget}`;`≥2` → `{type:'broadcast',targets,enter:true}`。
- `#broadcast-bar`/`#bc-input`/`#bc-send` **作废**;`#bc-count` 改输入条上"扇出 N"徽章(`var(--accent-dim)` 底);`#bc-result` 保留为结果回显(`aria-live="polite"`)。
- `refreshBroadcast()` 改:切输入条 class(普通/广播态)+ 徽章显隐。
- **scroll lock**:`#term-screen` 用户向上滚(`scrollHeight-scrollTop-clientHeight>80`)时暂停自动滚底,顶部 `↓ 新输出` 浮标。

### 5.5 终端连接态(C3 新增,补 ensureWs 重连)
`ensureWs()` 补对称实现(对齐 `ensureMaWs` L155-185):
- `onclose`/`onerror`:把 `#term-target` 切 `data-state="disconnected"`(CSS 给 `--errored` 左条 + `● 断线,重连中…`);`#term-input` `disabled`(防吞字)。
- `setInterval` 重连 3s,**指数退避**(3s→6s→12s→30s 上限,复用 ensureMaWs 模式)。
- 重连成功:重新 `sendWhenOpen({type:'attach',target:currentTarget})` + `#term-screen` 追加 `[已重连]`;`#term-target` 复原。
- 轮询 poll 失败连续 N 次:HERO L1 加 `● 数据 Ns 前`(基于上次成功 poll 时间戳),>10s 变 `--waiting` 色。

### 5.6 HERO(主控 agent)
| 层 | 内容 | 数据源 |
|---|---|---|
| L0 标题条 | `◈ COMMAND BRIDGE` eyebrow + 标题 + `● running/stopped/disabled`(.dot)+ Start/Stop(`.btn-ghost`/`.btn-primary`)+ `[▾镜像]`(`aria-expanded`+`aria-controls="ma-screen"`)**A7** | `renderMaStatus()` |
| L1 健康摘要 | `▶N working · ⏸N idle · ✕N errored`(数字/词一律 `--fg-2`,色仅图标+dot 承载)**A7** | 前端算 |
| L2 诊断 callout | **默认隐藏**,仅错误关键词触发(P1,见 §9) | 前端解析 ma-screen |
| L3 镜像 | `#ma-screen`,`max-height:0` 折叠;`[▾]` 展开为**浮层抽屉**覆盖卡片网格(A5,不占布局) | maWs init |

- 警告 banner 降级为 L3 内一行 mono 小字 + `⚠`。
- 移动端 HERO 收进 topbar(A6),点开才展。

---

## 6. 配色 + 顶层布局声明

console 局部新增(作用域 `.console-app`,不进 tokens.css):
```css
.console-app {
  height: 100dvh; display: flex; flex-direction: column; overflow: hidden;  /* A8:顶层 flex 上下文 */
  --term-bg: #1a1815;   --term-fg: #e8e6df;       /* 暖近黑/暖白,14.7:1 AAA */
  --waiting-bg: rgba(192,133,50,0.08);            /* A4:waiting 卡底,与 --accent-bg 分离 */
}
.s-dot--idle { box-shadow: 0 0 0 1px var(--border-2); }  /* C2:idle 点达非文本 3:1 */
.dot.running { background: var(--working); } .dot.stopped { background: var(--idle); }
.s-icon { font-variant-emoji: text; }            /* 防 ⏳ 被 emoji 字体彩色化 */
```
其余全 `var(--*)`。**无需改 style.css**(A8 已核实)。

---

## 7. 状态可视化(四重编码 + A7 aria + A4 优先级)

| status | 色(token) | 图标(aria-hidden) | 文字(.s-status) | 卡片强化 |
|---|---|---|---|---|
| working | `--working` | `▶` | working | — |
| idle | `--idle`+描边 | `⏸` | idle | — |
| errored | `--errored` | `✕` | errored | 左色条 + 置顶 |
| waiting | `--waiting` | `⏳` | waiting | `--waiting-bg` 轻底 |
| unknown | `--fg-3` | `?` | unknown | 虚线 |
| offline | `--fg-3` | `⌽` | offline | lastLine `(离线)` |

- 图标 `<span aria-hidden="true">`,语义走 `.s-status` 文字 + `aria-label`。
- 左色条优先级:`errored > .active > waiting`。

---

## 8. 交互

| 操作 | 行为 |
|---|---|
| 点卡片 / Enter / Space | `attachTarget` + `.active` + 终端切换(A3) |
| 多选圈点击 / 移动长按 | toggle `selected` + `refreshBroadcast()`。**事件隔离**:`card__select` 独立可点 + `stopPropagation()`,不冒泡触发卡片 attach;键盘多选(无鼠标场景)方案由 plan 细化(候选:Shift+Enter 批选、或广播输入条内置目标勾选列表) |
| `[▾镜像]` | toggle `#ma-screen` 浮层抽屉(A5)+ `aria-expanded` |
| Start/Stop | 现有 `maAction()` |
| 终端输入 submit | 按 `selected.size` 分发 attach/broadcast(A1) |
| 终端下拉(移动) | 收起到 high-bar / 恢复(A6) |
| HERO 点开(移动) | topbar 单行 → 展 L0/L1/L3(A6) |

微交互:hover `translateY(-1px)` 包 `@media (hover:hover)`(触屏走 `:active`);状态过渡 150ms;`prefers-reduced-motion` 全降级(含终端自动滚底)。Tab 顺序:topbar → HERO 按钮 → HERO 镜像开关 → 第一张卡片 → … → 终端 input。

---

## 9. callout 解析(P1 默认隐藏 + 错误关键词触发)

```
function renderMaCallout() {
  const raw = maScreen.textContent;
  const clean = stripAnsi(raw);                         // 防 ANSI 残留(terminal_cleaner.cjs 正则)
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return hide(L2);
  const block = lastNonEmptyBlock(lines);               // 最后一个连续非空块
  const text = block.slice(0, 1)[0].slice(0, 120);      // 首行截断
  if (!ERROR_RE.test(text)) return hide(L2);            // 默认隐藏
  show(L2, '⚠ ' + text + '…');                          // 命中才点亮
  ts = stableSince(text, 10000);                        // 稳定>10s 才记时间戳(活跃期不刷"now")
}
```
- `ERROR_RE = /\b(error|fail(ed)?|traceback|exception|EACCES|errno|panic|✕)\b/i`
- `stripAnsi`:复用 `public/terminal_cleaner.cjs` 的正则(注:它现仅在 test 引用,runtime 需 require 或内联正则)。
- 块定义:`split('\n')` → `trim()` 判空 → filter → 取最后连续非空块 → 首行。
- 时间戳:文本"稳定不变 >10s"才记(`Date.now()`),活跃期显示"实时输出中…",避免永远"now"。
- 相对时间每 30s `setInterval` 刷新文案(不依赖 poll)。
- 失败/未命中 → 隐藏 L2,不阻塞 HERO 其余层。

---

## 10. 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `console.html` | 重排为 `<div class="console-app">`(topbar/HERO/卡片网格/终端);**不用 `#app`**;保留功能 ID(`#hub-status` `#main-agent-panel` `#ma-*` `#ma-screen` `#board-body`(改 `<ul>`) `#term-target/screen/input/input-form` `#bc-count/result`);`#global-board`/`#broadcast-bar`/`#bc-input`/`#bc-send` 作废 |
| 2 | `dashboard.css` | **删 121-150 硬编码**,重写 console 段(全 `var(--*)` + `.console-app` flex 声明 + `--term-bg/-fg`/`--waiting-bg` 局部变量 + 卡片网格 + HERO + 浮层抽屉 + 连接态 + 空态) |
| 3 | `console.js` | (a)`renderBoard` `<tr>`→卡片 `<li><button>` + **keyed-diff**(A2);(b)`ensureWs` 补 onclose/onerror + 重连 + 断线态(C3);(c)广播融合单输入分发(A1);(d)`renderMaCallout`(P1);(e)errored-first sort;(f)键盘/aria |
| 4 | 测试 | **从零写**(C1):renderBoard 卡片契约、attachTarget、refreshBroadcast、renderMaStatus、ensureWs 重连/断线态、callout 解析(关键词/ANSI/块/时间戳)、keyed-diff 保留 scroll/focus、健康摘要、errored-first sort;grep 断言 console 段无硬编码色 |

**不改**:`tokens.css`、`index.html`、`dashboard.html`、`style.css`、后端 `.cjs`、WS/轮询/主控起停/`ensureMaWs` 既有逻辑。

---

## 11. 风险与回归

1. **console.js 零测试(C1)**:回归面近零(没测试可破),但保障面也近零——必须从零补齐(§12)。**这是最大工作量所在,非"同步"。**
2. **renderBoard keyed-diff 重写**:以 key 复用 `<li>`,保留 scrollTop/focus/动画;TDD 先写差分测试。
3. **ensureWs 重连新逻辑**:对齐 ensureMaWs 模式,指数退避;需测断线→重连→重 attach 全链路。
4. **移动纵向预算**:终端可收起 + HERO 收进 topbar 已设计兜底;实现时三档机型(SE/12/ProMax)实测。
5. **L3 浮层抽屉**:absolute 覆盖网格,z-index 与 toast(9999)协调。
6. **callout 解析脆弱**:已用关键词门控 + ANSI strip + 失败隐藏降级。

---

## 12. 测试策略(C1 从零)

- **renderBoard 卡片契约**:每张 `<li>` 含机器名/会话/`.s-dot--{status}`/lastLine/时间;click/Enter→attachTarget;多选圈→selected。
- **keyed-diff(A2)**:2 次 poll 间 scrollTop/focus/`.active` 保留;新增/删除机器才动 DOM。
- **ensureWs 重连(C3)**:模拟 onclose→`data-state=disconnected` + input disabled;重连成功→重 attach + `[已重连]`;指数退避时序。
- **广播融合(A1)**:`selected.size=0/1`→attach;`≥2`→broadcast;徽章/结果回显。
- **callout(P1)**:空/纯进度行→隐藏;含 error 关键词→点亮;ANSI 残留→正确 strip;超长→截断;时间戳稳定阈值。
- **errored-first sort**:errored 永远置顶。
- **CSS grep 断言**:dashboard.css console 段无 `#34d399/#fbbf24/#f87171/rgba(96,165,250/rgba(255,255,255,.08)/#f59e0b/#22c55e/#000`。
- **覆盖率 ≥80%**;手动 smoke:HERO 折叠/展开、卡片切换、广播、断线重连、移动竖屏+键盘弹起+终端收起。

---

## 关联
- 审核依据:本会话 3 专家并行审核(UX/a11y、视觉/设计系统、技术/产品IA)
- 三套备选探索:本会话 UI/UX 专家团队(方案 A/B/C)
- 前序:`docs/superpowers/plans/2026-07-03-main-agent-ui-control.md`(main-agent T1,PR #15)
- 现状:`public/console.html`、`public/console.js`、`public/dashboard.css:121-150`、`public/tokens.css`、`public/style.css`
