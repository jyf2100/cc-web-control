# 控制台滚动修复 + 看板状态闪动 + 切换抽屉瘦身 设计

> 日期: 2026-07-01
> 状态: 待审
> 关联: docs/superpowers/specs/2026-06-29-ios-editorial-redesign-design.md(切换 sheet / 看板渲染基础)、2026-06-30-console-layout-redesign-design.md(控制台布局,需求1 修复其 flex 链 bug)

## 目标

三个独立 UI 反馈增强,彼此无依赖,分三个任务实现:

1. **控制台对话区能滚动** — 修复 flex 链断裂导致输出区滚不动的布局 bug
2. **看板状态变化闪动** — agent status 切换时对应卡片视觉脉冲(低频强信号)
3. **切换抽屉移除会话列表** — 抽屉与看板去重,只留项目启动

## 需求 1:控制台对话区滚动修复

### 根因

控制台布局高度链(应逐层受限才能内部滚动):

```
html/body(100%, overflow:hidden)
  → #app(100dvh, flex column, min-height:0)
    → .console-card(flex:1, min-height:0, flex column, overflow:hidden)
      → .main(flex:1, flex column, overflow:hidden)
        → .chat-container(flex:1, overflow-y:auto)   ← 断点(缺 display:flex)
          → .messages(flex:1)                          ← 断点(缺 display:flex)
            → .terminal-view(flex:1, min-height:0)
              → .terminal-content(overflow:auto, 缺 flex:1/min-height:0)
```

链在 `.chat-container` 断裂:它**没有 `display:flex`**,子项 `.messages` 的 `flex:1` 无效;`.messages` 也没 `display:flex`,`.terminal-view` 的 `flex:1` 同样失效。后果:

- `.terminal-view` 无受限高度,随输出无限增高
- `.terminal-content`(style.css:209,有 `overflow:auto` 但缺 `flex:1; min-height:0`)不触发自身滚动
- 输出堆叠,被外层 `overflow:hidden` 裁掉 → 看不到历史、滚不动
- `client.js:142` 的 `chatContainer.scrollTop = chatContainer.scrollHeight` 对着非滚动容器空转

### 方案(纯 CSS)

`public/style.css` 改三处:

- `.chat-container`(148):加 `display:flex; flex-direction:column` — 成为 flex 容器,子项 flex:1 生效
- `.messages`(154):加 `display:flex; flex-direction:column; min-height:0` — 传递受限高度给 terminal-view
- `.terminal-content`(209):加 `flex:1; min-height:0` — 在 terminal-view 的 flex column 里占满剩余空间且可收缩,配合已有 `overflow:auto` 成为唯一内部滚动容器

`.terminal-view`(168,已有 `flex:1; min-height:0; overflow:hidden`)无需改。

### 效果

- 输入框(`.terminal-input-row`)常驻底部
- 输出区(`.terminal-content`)可自由上下滚,看全部历史
- `client.js:142` 自动滚到底随之真正生效

### 测试

CSS 布局难纯单测。策略:浏览器手动验证(输出多屏后能滚、输入框不跟着滚、新输出自动到底)+ 现有 `test/ios_header.test.cjs` 等 DOM 回归不破。computed-style 烟雾测试收益低,跳过。

## 需求 2:看板状态变化闪动

### 方案(纯前端 diff,不上 WebSocket)

status 变化是低频信号(`working↔idle↔waiting↔errored`),2s 轮询检出无感,不引入 WS(YAGNI)。

**`public/dashboard_render.cjs`**(纯逻辑,可测):

- 新增 `diffChangedStatus(prev, next) → Set<name>`:对比两个 sessions 数组,返回 status 发生变化的 session name 集合;空数组/缺字段兜底;新会话(旧值无)不视为"变化"

**`public/dashboard.js`**(浏览器胶水):

- 模块级维护 `prevStatus = new Map()`(name → status)与上一次 sessions 数组
- `render(payload)` 前:用 `R.diffChangedStatus(prevSessions, payload.sessions)` 算变化集
- `list.innerHTML = R.renderSessionList(sessions)` 后(全量重建),遍历变化集,给 `data-session=name` 的 `<li>` 加 class `session--flash`
- render 末尾把当前 sessions 的 status 写回 prevStatus、sessions 存为 prevSessions

**`public/dashboard.css`**:

```css
@keyframes session-flash {
  0%   { box-shadow: 0 0 0 0 var(--accent-dim); }
  50%  { box-shadow: 0 0 0 4px var(--accent-dim); background: var(--accent-bg); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.session--flash { animation: session-flash 1s ease-out 1; }
```

(token 名 `--accent-dim` / `--accent-bg` 实现时核对 `tokens.css`,取已存在的等价令牌)

**重播机制**:innerHTML 全量重建会丢弃旧 DOM,flash class 加在新 `<li>` 上,动画正常播放;同一会话连续两次变化时新 li 是全新元素,动画自然重播,无需手动移除/重加 class。

### 效果

某 agent `idle→working`,看板对应卡片闪一下(~1s),其余卡片不受影响。

### 测试

`test/dashboard_render.test.cjs` 加 `diffChangedStatus` 用例:空输入、status 不变→空集、单/多变、新会话出现→不在变化集。dashboard.js 的 flash 绑定靠浏览器手动验证。

## 需求 3:切换抽屉移除会话列表

### 现状

`createSwitchSheet`(switch_sheet.cjs:65)构建三段:

1. meta 行(project · s:NNn)— 85-93
2. **会话标题 + 列表** — 95-113(本次删除)
3. 项目启动区 — 115-146

看板页(dashboard.html)本身已是会话列表,抽屉里的会话段重复。

### 方案

- `createSwitchSheet` 删除第 2 段(95-113:会话标题 `sessTitle`、`list` 构建、`items.forEach`)
- **保留** `buildSessionItems` 纯函数(仍可单测,只是不再被 createSwitchSheet 调用)
- `aria-label="切换会话"` → `"启动项目"`(sheet:80)
- 焦点陷阱(`focusables` / `handleTabTrap`)逻辑不变,自动适配剩余 focusable
- `onPick` 回调签名保留(向后兼容,虽不再由会话段触发)

### 效果

抽屉只剩 meta + 项目两段;会话切换完全靠看板页点卡片。

### 测试

`test/switch_sheet.test.cjs`:`createSwitchSheet` 相关用例更新(断言无会话段、有项目段、aria-label 为"启动项目");`buildSessionItems` 用例保留通过;焦点顺序回归。

## 非目标(YAGNI)

- 不引入 WebSocket 推送看板变化(需求 2 用前端 diff 足够)
- 不重构 `.terminal-view` 内部布局(仅补 flex 链)
- 不删除 `buildSessionItems`(保留向后兼容 + 单测)
- 不改 dashboard 轮询间隔

## 风险

- **需求 1**:补 flex 链后输入框是否仍可见 — 是,`.terminal-view` flex column 里 header/content/input 依次排,content `flex:1` 占中间,输入框 `flex-shrink:0` 留在底部
- **需求 2**:innerHTML 每 2s 重建,flash 动画可能被下一次重建打断 — 可接受(status 变化后 1s 内通常不会再变;即便打断,语义已传达,下次变化重播)
- **需求 3**:`onPick` 不再触发,若有外部代码依赖 — 实现时 grep `createSwitchSheet` 调用处(client.js)确认无依赖;保留签名降低风险
