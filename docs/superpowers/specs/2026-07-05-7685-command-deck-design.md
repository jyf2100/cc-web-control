# :7685 三页面重构 · 看板扇出 + 多机控制台 + 单机控制台

> **状态**:方向已确认(2026-07-05),待 writing-plans
> **范围**:仅 :7685 hub;:7684 单机冻结。
> **依据**:3 个代码核实 agent(控制台 / 看板 / hub 后端)+ 用户四轮澄清。

---

## 1. 背景

用户把 :7685 hub 重新定义为三个页面,各司其职(原话最终版):

> 多机控制台:1、主控agent管理  2、只展现主agent的终端(其它被控agent的终端不在这里)  3、扇出全部放在看板

**三页面模型**:

| 页面 | URL | 职责 |
|---|---|---|
| **看板** | `/dashboard.html` | 监控所有 agent(按机分组)+ **扇出**(选被控卡片 + 底部 bar 直接 broadcast) |
| **多机控制台** | `/console.html`(无参) | 主控 agent 管理(启停)+ 主控终端(只读镜像 `#ma-screen`) |
| **单机控制台** | `/console.html?m=&s=` | 看单个被控 agent 终端(attach 单 agent + 发指令) |

**核心洞察**:`console.html` 现在身兼两职(多机控制台 + 单 agent 终端),按 URL 参数用 `detectMode` 分模式就是第三页,复用现有 `attachTarget`,最小改动。**扇出(给被控发消息)归看板,不归控制台。**

### 关键更正(相对早期"两页协同"设计)

核实代码后纠正三个早期误解:
1. **死路 bug 处置变了**:旧设计想"修复 console.js:137-140"。核实发现该分支发 `type:'input' target:only`(未 attach),被 `ws_bridge.cjs:44` 拒("target not attached")→ 命令静默丢失,blog 确实存在。但新设计**直接砍掉控制台的 `selected`**(扇出挪看板),看板扇出走 `broadcast`(`sendOneShot` 不要求 attach)→ 死路自然消解,**不改 ws_bridge**。
2. **没有 `detectMode`**:`console.js:405-421` `tryAttachFromUrl` 只决定是否 attach 终端,不切 hero/term 可见性;`poll`/`ensureMaWs`/hero 两模式都跑。三页面要**新增 `detectMode()`**。
3. **`broadcast_result` 是数组**:`ws_bridge.cjs:87` 回 `{results:[{target,ok,error}]}`,前端 reduce 自算 `{total,succeeded,failed}`,后端不聚合。

---

## 2. 决策记录

| # | 决策点 | 选定 | 否决 |
|---|---|---|---|
| D1 | 页面分职 | **三页面**:看板监控+扇出 / 多机控制台主控 / 单机控制台单被控 | 两页协同 + 跨页 sessionStorage(早期,作废) |
| D2 | console.html 形态 | **同页分模式**(无参=多机;`?m=&s=`=单机),新增 `detectMode` 切 hero/term 显隐 | 拆独立两文件(代码重复) |
| D3 | 扇出归属 | **看板**(选被控卡片 + 底部 bar `broadcast`) | 控制台(用户明确"扇出全部放在看板") |
| D4 | 按机分组 | **视觉分节**(`groupByMachine` 二次分组 + 离线机 `<details>` 折叠) | 扁平网格仅排序 |
| D5 | :7684 范围 | **单机冻结** | — |

---

## 3. 现状盘点(基于 3 核实 agent)

### 已有(复用,不改)
- **主控 agent 全套**:起停 `POST /api/main-agent/start|stop`(`server.cjs:324/352`)+ `GET /status`(:381),CSRF + 限流 6/min + 串行锁;镜像 maWs attach `{machine:'main-agent',session:'cc-main-agent'}`(`console.js:196-226`);`renderMaStatus`/`renderMaCallout`(`console.js:157-194`)。主控是只读参谋 T1(`main_agent_config.cjs:33`),`#ma-screen` 只读(`local_tmux_client.cjs:89` send() 返回 false)。
- **扇出后端**:WS `type:'broadcast', targets, data, enter` → `handleBroadcast`(`ws_bridge.cjs:53-87`,`sendOneShot` 临时连不要求 attach,上限 50,去重)→ `broadcast_result {results:[{target,ok,error}]}`。
- **单机 attach**:`type:'attach', target:{machine,session}` + `input/key/batch`(`ws_bridge.cjs:25-51`)。
- **看板数据**:`GET /api/global-dashboard`(`server.cjs:198`,2s 聚合),`mergeDashboards`(`dashboard_aggregator.cjs:4-18`)→ `machines[]`(**仅被控机**;main-agent 经独立端点 `/api/main-agent/start|stop|status` 管理,**不进 fleet** —— 2026-07-05 核实 `dashboard_aggregator.cjs:4-18` 仅聚合 `registry.all()` 被控机)。故**看板不展示主控**:主控是 T1 只读参谋、不能扇出(无操作价值),其监控/管理(启停+终端)归多机控制台。
- **`.card.card--selected` CSS 已存在**(`dashboard.css:171-172`)。
- **board_render 数据函数**:`flattenFleet`/`sortCardsByRelevance`/`partitionStale`/`summarizeFleet`/`relativeTime`。

### 缺失(本设计补齐)
- **`detectMode()`**:`console.js` 无,需新增 —— 按 `?m=&s=` 切 hero/term 可见性。(实现命名 `detectConsoleMode`,避撞 `dashboard.js:234` 已有的 `detectMode` hub 探测函数)
- **看板按机分节**:`renderBoard`(`dashboard.js:142-189`)用 `flattenFleet` 铺平线性 append,无 machine section → 二次分组 + 扩展 `<details>` open 继承(现仅继承 stale,`:161-174`)。
- **看板卡片多选**:`card__select`(`board_render.cjs:76`)纯视觉 `aria-hidden` 无 handler → 加 `data-toggle="select" role="checkbox" aria-checked="false" tabindex="0"` 多选语义(摘 `aria-hidden`)+ `selected` Map + click/keydown 委托 + 重建后重标。
- **看板扇出 bar**:无 `#fanout-bar` DOM/CSS → 加挂点(`dashboard.html:33-35` 间)+ broadcast + results reduce。

### 要砍(控制台扇出挪看板)
`console.js` / `console.html` 移除扇出相关:
- `selected` Map(`console.js:20`)
- `broadcast` 分支(`:132-136`)+ `size===1` 单发到勾选项(`:137-140`)
- `refreshBroadcast()` + `#bc-count` + `#bc-result`(`console.js:149-154`、`console.html:45-46`)
- 主 ws `broadcast_result` 处理(`console.js:78-82`)
- `multiSelectMode` + "切多选模式"按钮(`console.js:287,386-395`)
- `renderMachineItems` 多选 toggle 分支(`:371-377`)+ 按钮 ☑/☐ 前缀(`:369`)+ 抽屉"已选N·扇出"标题(`:345`)

---

## 4. 设计

### 4.0 布局总则(撑满,不塌陷)

**所有页面全高 app shell,内容撑满视口,禁止底部留白塌陷**(用户明确:"页面要撑满,不能吊在半空中")。

通用骨架:
```
html, body { height: 100%; }
根容器        { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
topbar/tabbar { flex-shrink: 0; }                /* 固定高,不被压缩 */
主内容区      { flex: 1; min-height: 0; overflow: auto; }  /* 撑满剩余,内部滚动 */
```

- 用 `100dvh`(动态视口高,移动端地址栏伸缩准确),非 `100vh`。
- **现状**:看板 `#app{100dvh}` + `.main{flex:1}` ✅ 已撑满;控制台 `.console-app{100dvh; flex column}` ✅ 全高,但子元素 `.console-hero`(无 grow)+ `.console-term{flex:0 0 40vh}`(固定)都不撑满 → **底部塌陷** ❌(本次修)。
- `min-height:0` 是 flex 子元素能正确收缩/滚动的关键(否则内容撑爆)。

### 4.1 多机控制台(console.html 无参模式)

`detectMode()` 无参分支:
- **显示**:主控 hero(`#main-agent-panel` `console.html:21-33`)+ `#ma-screen`(主控终端镜像)+ `#fleet-summary`
- **隐藏**:`.console-term` 区(`#term-screen`/`#term-input-form`/`#term-target`/折叠全屏)+ `⇄tab`(`#switchTab`)
- **保留**:`poll` + `renderMaStatus` + `ensureMaWs` + Start/Stop + ▾镜像折叠
- **砍**:上述"要砍"清单
- **布局(撑满)**:`#ma-screen` 从 `#main-agent-panel`(hero)内**提为 `.console-app` 直接子元素**(hero 之后、tabbar 之前),`#ma-screen{flex:1; min-height:0; overflow:auto}` 撑满剩余视口;`.console-hero`(管理控件行)`flex-shrink:0` 保持自然高。detectMode 无参时 hero + `#ma-screen` 可见,`.console-term` `hidden`。

主控 agent 只读参谋,`#ma-screen` 只读观察。控制台**不发消息、不看被控**。

### 4.2 单机控制台(console.html?m=&s= 模式)

`detectMode()` 带参分支:
- **显示**:`.console-term` 区(`#term-screen` + `#term-input` + `#term-target` + 折叠/全屏)+ `⇄tab`(切换 attach 其他被控)
- **隐藏**:主控 hero / `#ma-screen`
- **复用**:`attachTarget`(`console.js:116-126`)+ submit fallback(`size===0`→`currentTarget`,`:141-142`)+ `tryAttachFromUrl`(`:405-421`)
- **⇄抽屉只保留单选 attach**(点 agent→`attachTarget`+关抽屉,`:378-379`),砍多选
- **布局(撑满)**:`.console-term` 改 `flex:1; min-height:0`(原 `flex:0 0 40vh`,`:215`),撑满剩余视口;`#term-screen` 已 `flex:1; min-height:0; overflow:auto`(`:226`)✅。折叠态 `[data-collapsed]`(`:233`)收起不撑满;全屏态 `[data-fullscreen]`(`:237`)保持 `position:fixed; inset:0`。

### 4.3 看板(dashboard.html)

**① 按机视觉分节**:
- `renderBoard`(`dashboard.js:142-189`)排序后二次分组:`sorted` → `Map(machine.id → cards[])`
- 每机 `<li class="machine-group"><details open><summary>{name} · {n}</summary><ul class="board-grid">…`
- 离线机(`online:false`)排末尾 + 默认折叠
- 扩展 `<details>` open 继承(现仅 stale,`:161-174`)→ Map 记录所有 machineId 的 open,重建后恢复
- 保留 stale 折叠区(`board-stale-group`)

**② 卡片多选**:
- `buildCardInner`(`board_render.cjs:76`)给 `.card__select` 加 `data-toggle="select"` + `role="checkbox" aria-checked="false"`(去 `aria-hidden`)
- `dashboard.js` 新增 `selected = new Map()`(key→`{machine,session}` 对象,免 `split('/')` 截断),key = `${m.id}/${s.name}`(card.key)
- click 委托(`#board-body`):命中 `[data-toggle="select"]` → `preventDefault`(阻止 `<a>` 跳转)+ toggle Map(set/delete)+ 切 `card--selected` class + 更新 `aria-checked`;旁挂 keydown 委托(Enter/Space→`.click()`,WCAG 2.1.1)
- `renderBoard` 重建后(`:166-169` append 循环):`if (selected.has(card.key))` → 加 `card--selected` + `aria-checked=true`
- 视觉复用 `.card.card--selected`(`dashboard.css:171`,已存在)

**③ 扇出 bar**:
- `dashboard.html` 在 `</main>`(`:33`)与 `.bottom-tabbar`(`:35`)间加 `<form id="fanout-bar" class="fanout-bar" hidden>`
- **布局**:`#fanout-bar` 纳入 `#app` flex 列(`.main` 之后、`.bottom-tabbar` 之前),`flex-shrink:0` 随选中态 `hidden` 切换 —— **非 `position:fixed`**,不破坏 `.main{flex:1}` 撑满。看板 app shell 已撑满(`#app{100dvh}`+`.main{flex:1}`),无需改骨架。
- `selected.size > 0` → 显示,`sel-count` = size
- Enter → WS `{type:'broadcast', targets:[{machine,session}...], data, enter:true}`
- 回执 `broadcast_result.results` → reduce `{total, succeeded, failed}` → `#bc-result` "成功 N/M"
- 清除按钮 → 清 Map + 重标卡片 + 隐藏 bar

**卡片点击(非勾选区)→ 跳单机控制台**:`board_render.cjs:74` href 已是 `/console.html?m=&s=`,无需改(自然走 `detectMode` 单机模式)。

### 4.4 扇出协议

- **请求**:WS `{type:'broadcast', targets:[{machine,session}], data:<string>, enter:true}`
- **回执**:`{type:'broadcast_result', results:[{target:{machine,session}, ok:bool, error?}]}`
- **前端 reduce**:`total = results.length`、`succeeded = results.filter(r=>r.ok).length`、`failed = total - succeeded`
- 上限 50 targets(`ws_bridge.cjs:3`),超限后端回 error
- `sendOneShot` 临时连,不要求 attach(扇出目标无需先 attach)

---

## 5. 文件清单

| 文件 | 改动 |
|---|---|
| `public/console.js` | 新增 `detectMode()`(按 `?m=&s=` 切 hero/term 显隐);砍 `selected`/`broadcast`/`refreshBroadcast`/`multiSelectMode`/抽屉多选;保留 `attachTarget`/`tryAttachFromUrl`/submit-fallback(单机用) |
| `public/console.html` | hero 与 `.console-term` 两区(detMode 切换 `hidden`);**`#ma-screen` 提为 `.console-app` 直接子元素**(hero 之后,撑满);砍 `#bc-count`/`#bc-result`;`⇄tab` 仅单机模式显示 |
| `public/dashboard.js` | `renderBoard` 按机分节(groupByMachine + details open 继承扩展);`selected` Map + click/keydown 委托 + 重建后重标;`#fanout-bar` 逻辑(broadcast + results reduce;`hubWsUrl` 带 `?token=` fallback) |
| `public/dashboard.html` | 新增 `#fanout-bar` 挂点(`</main>` 与 `.bottom-tabbar` 间) |
| `public/dashboard.css` | 新增 `.machine-group` / `.fanout-bar`(`flex-shrink:0`,非 fixed);`.card__select` 加 `cursor:pointer` + hover;**撑满**:`#ma-screen{flex:1;min-height:0}`、`.console-term` 改 `flex:1;min-height:0`(原 `flex:0 0 40vh`)、`.console-hero{flex-shrink:0}` |
| `public/board_render.cjs` | `buildCardInner` 的 `.card__select` 加 `data-toggle` + `role`/`aria-checked` |
| `hub/` | **零改动**(已核实 `agent_client.cjs:162` 带 5s 超时,broadcast 无需补超时) |

---

## 6. 测试策略(TDD)

`node --test test/*.test.cjs`(同步,严禁 background)。基准 522 GREEN。

- **`test/board_render.test.cjs`**:`buildCardInner` 输出含 `data-toggle` + `role="checkbox"`;`groupByMachine`(若抽函数)按机分组 + 离线排末尾。
- **`test/dashboard_three_page.test.cjs`**(新建,与 plan 一致):`groupByMachine` 分组/离线排末尾契约;`selected` Map key 契约(`${m.id}/${s.name}`);fanout broadcast payload 契约;`results` reduce `{total,succeeded,failed}`。(注:`renderBoard` 在 IIFE 内无法直测 DOM,可抽 DOM 拼装为纯函数补测 —— 待测试深度决策)
- **`test/console.test.cjs`**(扩展):`detectMode` 无参→hero 可见/term 隐藏;带参→反之;砍 `broadcast` 后单机 submit 仍发 `type:'input'`。
- **源码契约测试**:`console_style.test.cjs` 加 `.machine-group`/`.fanout-bar` CSS 存在性锁。

---

## 7. 移动端
- `.card__select` 命中区 ≥44×44px(WCAG 2.5.5)
- `fanout-bar` 固定底部 + `env(safe-area-inset-bottom)`
- 机器分组标题触摸目标 ≥44px

---

## 8. 非目标(YAGNI)
全选/区间多选、batch 扇出(多行)、广播失败逐条重试、扇出审计日志、离线机预过滤、主控模型配置。(broadcast 超时已核实 `agent_client.cjs:162` 已带 5s,非问题)

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 2s 全量重建丢选中态 | `selected` 存 Map(闭包变量,不被 innerHTML 清),重建后 reapplySelected 重标 |
| click 跳转 vs 选中冲突 | `data-toggle` 命中区 + `preventDefault` |
| console.html 两模式切换遗漏 | `detectMode` 显式切 hero/term `hidden` + 测试覆盖 |
| 控制台底部塌陷("吊半空") | `#ma-screen`/`.console-term` 各模式 `flex:1;min-height:0` 撑满;`100dvh` fallback `100vh` |
| broadcast 无超时挂起 | ✅ 已核实 `agent_client.cjs:162` 带 5s 超时,风险关闭 |

---

## 10. 视觉依据(mockup)
- **看板**:`docs/superpowers/specs/mockups/dashboard-multiselect.html`(按机分节 + 多选 + 扇出 bar)
- **多机控制台**:`docs/superpowers/specs/mockups/console-crosspage-fanout.html`(主控管理 + 主控终端只读)
- **单机控制台**:`docs/superpowers/specs/mockups/console-single-agent.html`(单被控终端撑满 + term-input 单发 + ⇄单选切换 attach)

> 三页 mockup 齐全,均采用全高 flex shell(撑满,不塌陷)。前两文件名为历史命名,实际职责见括号。

---

## 11. 下一步
1. `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-05-7685-three-page.md`(bite-sized TDD 任务)。
2. 实现 → 522→新基线 GREEN → 提交。
