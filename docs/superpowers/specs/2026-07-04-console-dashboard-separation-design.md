# 控制台与看板功能分离 设计文档

> **状态**:已 brainstorm + mockup 确认(2026-07-04)。下一步:writing-plans 出实现计划。
> **前置 spec**:[2026-07-03-console-fleet-dashboard-design.md](./2026-07-03-console-fleet-dashboard-design.md)(Fleet Dashboard 融合方案,本 spec 在其上做分离重构)、[2026-07-02-multi-host-hub-console-design.md](./2026-07-02-multi-host-hub-console-design.md)
> **Mockup**:`.superpowers/brainstorm/14865-1783145190/content/separation-mockup.html`

## 1. 背景与问题

**现状**(cc-web-control):

| 模式 | 控制台 | 看板 | 底部 tab |
|---|---|---|---|
| 单机(7684) | `index.html`(对话镜像+输入) | `dashboard.html`(session-list) | 控制台/看板/切换 ✓ |
| hub(7685) | `console.html`(Fleet Dashboard)**三合一融合** | `dashboard.html` 被 **302 重定向**回 `console.html` | **无** |

**问题**:
- hub 单页信息密度过高:卡片网格(监控所有机器)+ 终端(操作某机器)+ main-agent 三种心智模式挤在一页
- 单机/hub 导航不一致(单机有三项 tab,hub 无)
- `dashboard.html` 在 hub 上「不可用」(重定向),看板与控制台职责未分离 —— 上一轮 bug 3 用重定向兜底,治标不治本

## 2. 目标

- hub 的「看板(监控)」与「控制台(操作)」**分离为两个独立页面**(各自 URL)
- 底部三项 tab(控制台/看板/切换)单机与 hub **全局统一**
- `dashboard.html` 在 hub 上**恢复为独立多机看板**(不再重定向)
- **单机行为不动**(已分离)

## 3. 方案(已确认:方案 A + 切换抽屉)

### 3.1 两页职责(hub)

| | `/dashboard.html` 看板 | `/console.html` 控制台 |
|---|---|---|
| topbar | 品牌 + fleet 摘要(工作/等待/错误/空闲计数) | 品牌 + 返回看板 + fleet 摘要 |
| 主体 | **卡片网格**(全机器,错误优先排序,只读监控) | **main-agent panel**(状态/Start-Stop/镜像/callout)+ **终端区**(含全屏) |
| 底部 tab | 控制台 / **看板**(active) / 切换 | **控制台**(active) / 看板 / 切换 |
| 关键交互 | 卡片点击 → `/console.html?m=<machine>&s=<session>` | 机器选择走「切换」抽屉 |

**main-agent 归控制台**:Start/Stop 是操作,与终端同属控制台;看板纯监控,职责清晰。

### 3.2 机器切换抽屉(新组件)

控制台页底部「切换」tab 点击 → 弹出机器列表抽屉(类似单机 `switch_sheet.cjs` 的 switchSheet):
- 数据复用 `/api/global-dashboard` 的 machines
- 每项:状态点 + 机器名 + session
- 选中 → attach 终端 + 关抽屉
- 与单机 switchSheet 概念一致 → 实现全局统一

### 3.3 卡片跳转

看板卡片点击 → `/console.html?m=<machine>&s=<session>`(URL query,可书签 + sessionStorage 兜底)。`console.js` 读 param 自动 attach 选中机器。

## 4. 文件组织与模块迁移

**核心**:卡片网格渲染**从控制台迁移到看板**。

### 4.1 新增 `public/board_render.cjs`(UMD 纯模块)

从 `console_render.cjs` 抽出卡片渲染纯函数:
- `buildCardHTML(c)` / `updateCardNode(li, c)` / `parseCallout(text)` 及卡片状态/排序相关

由看板页(`dashboard.html`)加载。遵循现有 UMD 纯模块模式(浏览器 `root.BoardRender=factory(...)` + Node `module.exports`),测试 `require` 纯函数。

### 4.2 `dashboard.html` 双模式(单机不动 / hub 新增,同一文件两分支)

加载即探测:`fetch('/api/global-dashboard')`
- **200 → hub 模式**:卡片网格(`board_render.cjs` 渲染,错误优先,poll `/api/global-dashboard` 2s),卡片点击跳控制台
- **404 → 单机模式**:现有 session-list(`dashboard_render.cjs`,poll `/api/dashboard`)**原样不动**

加载 `board_render.cjs`(hub 用)+ `dashboard_render.cjs`(单机用,现有)。新增底部三项 tab(看板 active)。

### 4.3 `console.html` 精简

- **移除** `<section class="console-board">` 卡片网格
- **保留**:topbar + main-agent panel + 终端区(含刚做的全屏)
- **新增**:底部三项 tab(控制台 active)+ 机器切换抽屉(`#switch-sheet`)
- `console.js`:移除 board 渲染/选择,保留终端/main-agent,新增切换抽屉 + 底部 tab + URL `?m=&s=` 读取

## 5. 文件清单

| 文件 | 动作 |
|---|---|
| `public/board_render.cjs` | **新增**(卡片渲染纯函数,从 console_render 抽出) |
| `public/dashboard.html` | 改(双模式 + 底部 tab) |
| `public/dashboard.js` | 改(双模式 poll + 渲染分发 + 卡片跳转) |
| `public/console.html` | 改(移除 board,加 tab + 切换抽屉) |
| `public/console.js` | 改(移除 board,加切换抽屉 + tab + URL param) |
| `public/console_render.cjs` | 改(移除卡片函数,留 main-agent/hero 相关) |
| `public/dashboard.css` | 改(切换抽屉 `.switch-sheet` 样式 + 双模式共用) |
| `hub/server.cjs` | 改(移除 `/dashboard.html → /console.html` 重定向) |
| `test/board_render.test.cjs` | **新增**(从 console_render.test.cjs 迁移卡片测试) |
| `test/dashboard-dual-mode.test.cjs` | **新增**(双模式探测) |
| `test/console_html.test.cjs` | 改(契约:console.html 无 board、有 tab/抽屉) |
| `test/console_style.test.cjs` | 改(切换抽屉 a11y) |
| `test/hub-server.test.cjs` | 改(`/dashboard.html` 不再重定向,直服) |
| `test/console_render.test.cjs` | 改(移除已迁移的卡片测试) |

## 6. 数据流

- **看板页 poll**:hub `/api/global-dashboard`(2s)/ 单机 `/api/dashboard`(2s)
- **控制台页**:终端 WS(attach 选中机器,指数退避重连)+ main-agent poll `/api/main-agent/*`
- **切换抽屉**:复用 `/api/global-dashboard` 的 machines 字段(单一数据源,与看板一致;不再额外调 `/api/machines`)
- **卡片跳转**:`?m=&s=` → console.js 读取 → 自动 attach

## 7. hub 路由反转(关键决策)

**移除** `hub/server.cjs` 的 `/dashboard.html → /console.html` 重定向(上一轮 bug 3 修复)。
`dashboard.html` 恢复 `express.static` 直服(双模式自适配 hub/单机)。
这是 bug 3 的**根治版**:不再「重定向兜底」,而是让 `dashboard.html` 在 hub 上真正可用为多机看板。

## 8. 错误处理

- **双模式探测**:`global-dashboard` 200=hub / 404=单机 fallback;两者都失败 → 错误态(复用 `dashboard.js` 现有 `showState`)
- **WS 断连**:指数退避重连(已有)
- **看板 poll 失败**:重试 + stale 提示(已有 `pollFailCount`/`hero-stale` 机制迁移到看板页)
- **切换抽屉空**:无机器时显示空态
- **探测时序**:首次加载探测期间显示 loading(避免空屏)

## 9. 测试策略

- `board_render.cjs` 纯函数测试(从 `console_render.test.cjs` 迁移:`buildCardHTML`/`updateCardNode`/`parseCallout`)
- `dashboard.html` 双模式探测测试(`global-dashboard` 200→hub / 404→单机)
- `console.html` 结构测试(移除 board,含 tab + 抽屉 + URL param 读取)
- hub 路由测试更新(`/dashboard.html` 直服,不再 302)
- a11y/console_style 测试(切换抽屉触摸目标/对比度/reduced-motion)
- 全量 `node --test test/*.test.cjs` 保持绿

## 10. 范围与非目标

- ✅ hub 看板/控制台分离 + 全局 tab 统一 + 切换抽屉 + main-agent 归控制台
- ✅ `dashboard.html` 双模式(单机/hub)
- ✅ `board_render.cjs` 抽取 + 测试迁移
- ❌ 单机 `index.html` / `dashboard.js` 的 session-list 逻辑不动
- ❌ 不重构单机控制台(`client.js`)
- ❌ 不改后端 API(复用现有 `global-dashboard`/`machines`/`main-agent` 端点)

## 11. 风险

- `console.js` 拆分(移除 board)可能影响现有终端/main-agent 逻辑 → 需回归测试
- `board_render.cjs` 抽取需保持纯函数契约(UMD 模式,浏览器 + Node 测试)
- hub 路由反转破坏既有重定向测试 → 同步更新测试契约
- 双模式探测的时序(首次加载探测可能延迟)→ 探测期间显示 loading

## 12. 设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 分离范围 | 全局导航统一 | 用户确认:hub 向单机对齐 |
| 分离形式 | 两个独立页面(各自 URL) | 与单机一致,可书签/PWA,切页重连有退避 |
| main-agent 归属 | 控制台页 | Start/Stop 是操作,与终端同属控制台;看板纯监控 |
| 机器选择形式 | 切换抽屉 + 三项 tab | 与单机 switchSheet 对称,真正全局统一 |
| hub 路由 | 移除重定向,恢复直服 | bug 3 根治,让 dashboard.html 真正可用 |
