# 单机看板 session 删除(kill)+ 当前激活标记 设计

> 日期:2026-07-08
> 关联:看板重设计(2026-07-07-dashboard-redesign)、session 默认名派生(PR #21,commit 676719a)
> 状态:脑暴定稿,待 writing-plans 出实现计划

## Goal

在单机看板(`/dashboard.html` 单机分支)上,为每个 session 卡片加「删除」入口,带**卡片就地二次确认**与**当前激活会话防自杀护栏**(前端禁用 + 后端 WS 活跃保护双护栏)。后端 `DELETE /api/sessions/:name` 已就绪,仅**新增 WS 活跃保护**;删除语义(kill 进程 + 清绑定、保留历史)零改。

## 背景 / 现状

- **单机看板已存在**:`dashboard.html` + `dashboard.js` 单机分支轮询 `/api/dashboard` → `renderSessionList`(dashboard_render.cjs)渲染卡片;卡片显示状态圆点/中文状态/会话名/cwd 末段/lastLine,点击跳控制台 `/?session=<name>`。
- **后端能力**:`list/create/kill/status` 齐全;`DELETE /api/sessions/:name`(server.cjs:547)= kill 进程 + 清 `claudeSessionId` 绑定,**保留** `~/.claude/projects/<slug>/*.jsonl` 历史。
- **三个缺口**(本次要解):① 看板卡片**零操作**——DELETE 前端零调用,孤儿会话只能手动 `tmux kill-session`(用户曾因此攒出 `claude-web-session`);② **无「当前激活」标记**,看不出哪条是控制台正连着的;③ **多标签下无后端防自杀**。
- **当前 session 持久化**:client.js:46 `const STORAGE_KEY_LAST_SESSION = 'cc_web_last_session';`(localStorage);看板侧 dashboard.js **尚未读它**。

## 范围

**In**:单机看板卡片删除入口 + 卡片就地确认 + 当前激活标记 + 后端 WS 活跃保护(409)。

**Out(明确不做)**:
- 不动 hub:`board_render.cjs`、`hub/**`、`/api/global-dashboard`、dashboard.js 的 hub 分支(`renderBoard`/`pollHub`/`hubLoop`/`detectMode`/`boardBody` click 委托/`fanout-bar` 多选广播)。
- 不做 rename / clone / 从看板 create(全 YAGNI,后端无 rename/clone 封装,做了要大改)。
- 不做批量勾选删(单机无扇出广播需求,不引 hub 的 `card__select` + `fanout-bar`)。

## 设计决策(已与用户敲定)

1. **操作范围**:仅 kill(删除会话)。
2. **交互**:单卡快捷删除(每卡片一个删除图标 + 卡片就地二次确认);不引批量。
3. **确认形态**:点 🗑 → 卡片红框 + 内联 `[取消][🔴 删除?]` → 再点「删除?」才发 DELETE。
4. **当前会话保护**:前端禁用(删除按钮 `disabled` + 提示)+ **后端 WS 活跃保护**(双护栏)。
5. **删除语义**:kill 进程 + 清绑定,**保留** jsonl 历史(=当前 DELETE 端点行为,后端语义零改)。
6. **不动 hub**。

## 架构 / 组件改动

### A. `public/dashboard_render.cjs`(纯函数,保持可单测)

`renderSession(s, index, opts)` 增 `opts` 形参(`{ isCurrent, confirming }`,均可选 boolean):

- **始终产**删除按钮 `<button class="session__del" type="button" aria-label="删除会话" data-act="del">🗑</button>`。
- `isCurrent === true`:按钮加 `disabled` + `title="当前会话,先切换再删"`;卡片 class 追加 `session--current`。
- `confirming === true`:卡片 class 追加 `session--confirming`;删除按钮**替换**为内联 `[取消](data-act="cancel")` + `[🔴 删除?](data-act="confirm")` 两按钮。
- 现有 `STATUS_WEIGHT`/`STATUS_LABEL`/`sortSessions`/`escapeHtml`/`relativeTime`/`shortPath`/`diffChangedStatus` 不变。

`renderSessionList(sessions, currentName, confirmingSet)`:
- `currentName` 为 string(可空);`confirmingSet` 为 `Set`(可空)。
- 对每个 session:`isCurrent = (s.name === currentName)`;`confirming = !!(confirmingSet && confirmingSet.has(s.name))`;透传 renderSession。
- 向后兼容:第二参未传时 `isCurrent=false`、第三参未提时 `confirming=false`(现有调用 `R.renderSessionList(sessions)` 仍工作)。

### B. `public/dashboard.js`(仅单机分支 `render` / `list` click 委托 / `loop`)

- **常量**:`var CURRENT_KEY = 'cc_web_last_session';`(与 client.js:46 同值)。
- **当前会话名**:`render(payload)` 开头 `var currentName = localStorage.getItem(CURRENT_KEY) || '';`,传 `R.renderSessionList(sessions, currentName, confirming)`。
- **确认态集合**:`var confirming = new Set();`——renderSessionList 第三参。**作用:让确认态在每 2s 全量 `innerHTML` 重建中存活**(否则用户确认中途被轮询冲掉)。
- **`list` click 委托**(dashboard.js:25 现有 handler 内,**在 goToSession 分支之前**新增):
  - `e.target.closest('[data-act="del"]')` 命中 → `e.stopPropagation(); e.preventDefault();`;非当前会话:`confirming.add(name)` → `rerender()`;当前会话:按钮 `disabled` 不触发(无操作)。
  - `e.target.closest('[data-act="cancel"]')` → `confirming.delete(name)` → `rerender()`(+ stopPropagation/preventDefault)。
  - `e.target.closest('[data-act="confirm"]')` → `await deleteSession(name)`(+ stopPropagation/preventDefault)。
  - 未命中上述 → 落回现有 `goToSession` 导航(不变)。
- **`async function deleteSession(name)`**:
  ```
  fetch('/api/sessions/' + encodeURIComponent(name),
        { method:'DELETE', headers:{ Accept:'application/json' } })
  ```
  - **2xx 或 404**:`confirming.delete(name)`;乐观移除该会话卡片——name 受 `isValidSessionName` 约束(字符集 `[A-Za-z0-9._-]`,无引号/特殊字符),可直接 `list.querySelector('li[data-session="'+name+'"]')?.remove()`(或遍历 `li.dataset.session` 匹配,更稳);toast(404→"会话已不存在",2xx→"已删除 <name>")。
  - **409**(WS 活跃保护):toast"该会话正被控制台使用,无法删除";`confirming.delete(name)` 退出确认态;卡片保留。
  - **其他非 2xx / 网络错**:toast"删除失败:<msg>";`confirming.delete(name)` 退出确认态;卡片保留。
- **`rerender()`**:基于缓存的最近一次 `payload`(模块级 `var lastPayload;`,在 `poll` 成功 render 后更新;首次未 poll 时 `lastPayload` 为空则跳过 rerender)+ `currentName` + `confirming` 重画 `list.innerHTML`(不等下次 2s 轮询),供删除/取消/确认态切换即时反馈。
- **hub 分支**(`renderBoard`/`pollHub`/`hubLoop`/`boardBody` click 委托/`fanoutBar`)**完全不动**。

### C. `public/dashboard.css`

- `.session__del`:右上角图标按钮(透明底、hover 高亮);`disabled` 灰化 + `cursor:not-allowed`。
- `.session--current`:左侧高亮条(`border-left:3px solid var(--accent)`)+ 角标「当前」。
- `.session--confirming`:卡片红框(`outline:2px solid var(--errored)`)+ 内联 `[取消][🔴 删除?]` 按钮样式(取消灰、确认红)。
- 复用现有 token(tokens.css:`--accent`/`--errored`/`--waiting` 等)。

### D. `server.cjs`(单机入口,**仅 DELETE 加 WS 活跃保护**)

- `DELETE /api/sessions/:name` handler(server.cjs:547)**前置检查**:该 session 名若有**活跃 WS 连接** → 返回 `409 { success:false, error:'session_in_use' }`,不 kill。
- **活跃 WS 来源**:WS upgrade(server.cjs:594)按 `?session=<name>` 绑定连接。需维护 `session 名 → 活跃连接计数` 的 Map(若 server.cjs 现无此结构则新增;**writing-plans 阶段核实 server.cjs WS 连接管理的现有数据结构**,优先复用)。
- 其余(kill + 清绑定、保留历史、isValidSessionName 校验)**零改**。

## 数据流

- **删除**:点 🗑 → `confirming.add` → 点「删除?」→ `DELETE` → 后端先查 WS 活跃(活跃→409 拒;否则 kill+清绑定)→ 200 → 前端乐观移除 li + toast;404 → 移除 + 「已不存在」;409 → toast 拒、卡片保留;其他 → toast + 退出确认。
- **当前标记**:每轮 render 读 `localStorage['cc_web_last_session']` → 匹配卡片 `.session--current` + 删除 `disabled`。
- **轮询**:`loop` 每 `POLL_MS` 全量重建 `list.innerHTML`;`confirming` Set 作为 renderSessionList 第三参 → 确认态跨轮询存活。

## 错误处理

- `DELETE 409`:会话正被控制台使用(WS 活跃)→ 拒、toast、卡片保留(退出确认态)。
- `DELETE 404`:会话已不存在(被别处删)→ 移除 + 「已不存在」。
- `DELETE` 其他非 2xx / 网络错:toast「删除失败」;退出确认态;不移除。
- **双护栏**:前端当前会话删除按钮 `disabled`(第一道,单标签生效);后端 WS 活跃保护(兜底,防多标签/多设备 localStorage 不一致导致的误杀)。

## 边界与注意

- **轮询全量重建 vs 确认态存活**:`renderSessionList` 每 `POLL_MS` 全量重建 `innerHTML`;`confirming` 必须作为渲染入参(Set)才能在轮询中存活,否则用户确认中途被冲掉。
- **事件委托 vs 逐个绑定**:删除/取消/确认按钮走 `list` click 委托(复用 dashboard.js:25 handler),不依赖 render 后逐个 `addEventListener`(避免轮询重建后失绑)。
- **stopPropagation**:删除交互命中 data-act 时 `stopPropagation()` + `preventDefault()`,不触发 `goToSession` 导航。
- **乐观移除**:DELETE 成功立即 `remove()` li,不等 2s 轮询;下次轮询数据自然一致(session 已被 kill,不再返回)。
- **跨页 localStorage**:看板页与控制台页同源,共享 `cc_web_last_session`;控制台切换会写、看板轮询读 → 「当前」标记随控制台当前会话变化。
- **向后兼容**:`renderSessionList(sessions)`(旧两参/单参调用)仍工作(见 A 节);现有 dashboard_render 单测不受影响。

## 测试策略

1. **`dashboard_render.cjs` 纯函数单测**(新增 `test/dashboard_delete_render.test.cjs`,`node --test`):
   - `renderSession(s,0)` 默认含 `[data-act="del"]` 删除按钮。
   - `renderSession(s,0,{isCurrent:true})` → 按钮 `disabled` + class 含 `session--current`。
   - `renderSession(s,0,{confirming:true})` → class 含 `session--confirming` + 含 `[data-act="cancel"]` 与 `[data-act="confirm"]`、不含 `[data-act="del"]`。
   - `renderSessionList(sessions, currentName, confirmingSet)` 正确透传 isCurrent/confirming。
   - 向后兼容:`renderSessionList(sessions)` 不抛错。
2. **`dashboard.js` 交互(浏览器逻辑,契约测试 grep 源码 + 手动冒烟)**:
   - 契约 `test/dashboard_delete_contract.test.cjs`:断言 dashboard.js 源码含 `method:'DELETE'`(或 `method: "DELETE"`)、`data-act` 三分支、`stopPropagation`、`confirming`(`Set`)、`CURRENT_KEY = 'cc_web_last_session'`、`/api/sessions/` DELETE fetch。
   - 冒烟:看板删一个非当前会话(成功移除)、点当前会话删除按钮(disabled 无反应)、多标签 WS 保护(开两标签 A 控制台连 X、B 看板删 X → 409 toast)。
3. **`server.cjs` DELETE WS 保护**:契约/单测(writing-plans 阶段据 WS 连接管理结构定可测性)或手动(同冒烟第 3 条)。
4. **回归**:现有 `dashboard_*` / `session_default` / `console_style` / `startClaudeInSession_contract` 测试 0 失败;新增后总数 = 基线 + N、0 失败。

## 不改动清单(明确边界)

- `public/board_render.cjs`、`hub/**`、`/api/global-dashboard`、dashboard.js hub 分支。
- `POST /api/sessions`、WS 握手与 output/input 推送、`initAndAttachSession`、`session_default.cjs`、`tmux.cjs`。
- 后端 DELETE 的 kill + 清绑定语义(保留历史)——仅前置加 WS 活跃检查。
