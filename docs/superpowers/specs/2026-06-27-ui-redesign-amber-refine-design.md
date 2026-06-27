# cc-web-control 界面重设计 · 方向 A 琥珀精修

> 日期:2026-06-27
> 状态:设计已批准,经 plan-eng-review 评审 clean(commit 373a57c),待转 writing-plans 出实施计划
> 范围:整个站点(控制台 + 看板 + 登录),后端不动

## 1. 背景与目标

现状是两套割裂的界面:

- `public/index.html` 主控制台(旧,WebSocket 终端),样式来自 `public/style.css`。
- `public/dashboard.html` 多会话看板(新,Phase 1 刚交付),样式来自 `public/dashboard.css`。

两者视觉不统一,品牌色和组件风格各搞各的。

**目标**:整个站点统一重设计,采用方向 A 琥珀精修。延续现有的暖琥珀品牌识别度,做"统一 + 提升",而不是换皮。三页(控制台 / 看板 / 登录)共享同一套设计令牌,由统一的 header 与导航串起来。

## 2. 设计决策(已锁定)

| 决策 | 结论 | 依据 |
|------|------|------|
| 方向选型 | A 琥珀精修 | mockup 三方向对比(A 琥珀精修 / B 深夜终端 / C 现代中性),用户选 A |
| 整体设计 | 已批准 | 完整站点 mockup(三页)经用户确认 |
| 控制台终端 | 浅色(默认)+ 深色(跟随系统) | 与全站统一。深色随 `prefers-color-scheme: dark` 自动切换,沿用 style.css 现有暗色支持 |
| 主题策略 | 浅色默认 + 深色跟随系统 | 避免"浅色 only"回归现有暗色(style.css:439-541 已有完整暗色)。手动切换开关 YAGNI |
| 访问优先级 | 移动优先 | 手机经 cloudflared 隧道是主访问场景 |
| 后端 | 零改动 | 纯前端重设计,server.cjs / api / 认证逻辑不动 |

## 3. 设计令牌(Design Tokens)

全部以 CSS 自定义属性实现,集中在**独立文件 `public/tokens.css`** 的 `:root`(浅色默认)+ `@media (prefers-color-scheme: dark)`(深色),三页共用,单一事实来源。来源:已批准的 mockup `public/mockups/site-a.html`。

### 颜色(浅色,默认)

| 令牌 | 值 | 用途 |
|------|------|------|
| `--bg` | `#ffffff` | 页面背景 |
| `--surface` | `#faf7f2` | 卡片 / header 背景 |
| `--surface2` | `#f3ece0` | 徽章 / 输入区 / 分段控件背景 |
| `--border` | `#ece2d1` | 边框 |
| `--text` | `#1a1a1a` | 主文本 |
| `--muted` | `#8a7f6f` | 次要文本 / 路径 / 时间 |
| `--brand` | `#d4a574` | 品牌色(logo / 主按钮 / 当前导航) |
| `--brand-strong` | `#c08e54` | 品牌强调 / 计数 |

### 颜色(深色,`prefers-color-scheme: dark`)

暖调暗色,与琥珀品牌协调,替换 style.css 现有的冷蓝暗色(#0d1117 系,style.css:439-541)。只覆盖以上 8 个令牌,状态色不变。

| 令牌 | 值 | 用途 |
|------|------|------|
| `--bg` | `#1c1815` | 暖黑页面背景 |
| `--surface` | `#251f1a` | 卡片 / header |
| `--surface2` | `#2e2620` | 徽章 / 输入区 |
| `--border` | `#3d342b` | 边框 |
| `--text` | `#f2ebe0` | 主文本 |
| `--muted` | `#a89b88` | 次要文本 |
| `--brand` | `#d4a574` | 品牌色(不变) |
| `--brand-strong` | `#e6b785` | 深色下提亮,保证对比度 |

### 状态色(5 状态徽章,三重编码,浅深色共用)

| 令牌 | 值 | 状态 |
|------|------|------|
| `--waiting` | `#f59e0b` | 等待用户(脉冲) |
| `--working` | `#d4a574` | 工作中 |
| `--idle` | `#b8ad9a` | 空闲 |
| `--errored` | `#ef4444` | 出错 |

### 字体

| 令牌 | 值 |
|------|------|
| `--font` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| `--mono` | `'SF Mono', ui-monospace, Menlo, monospace` |
| 基准字号 | `14px`,行高 `1.5` |

### 圆角与间距

| 令牌 | 值 | 用途 |
|------|------|------|
| `--r` | `12px` | 卡片 / header |
| `--r-sm` | `8px` | 小元素 / 输入框 |
| `--r-lg` | `14px` | 登录卡 |
| 间距尺度 | `4 / 8 / 12 / 14 / 18 / 24 px` | 统一使用,禁止随意数值 |

### 布局

- 内容区 `max-width: 680px`,居中。移动优先,桌面自动收窄居中。
- 卡片默认无阴影,靠边框区分;交互态(hover / active)可加微阴影。

## 4. 全站统一结构

三页共享一个 header:

- 左:`cc` logo 方块(琥珀底白字,34×34,圆角 9px)+ 站点名 "cc-web-control" + 副标题。
- 右:胶囊分段导航(控制台 / 看板 / 登录),当前页高亮(白底 + 微阴影)。

这个 header 把三个页面串成一体,是"整个站点统一"的核心载体。

## 5. 各页设计

### 5.1 控制台(`index.html`)

主功能页,纵向三段:

1. **工具栏**:会话选择器(下拉,显示当前会话名)+ 状态徽章 + "新建会话" + "中断"。
2. **终端区**:浅色 surface 背景,mono 字体,按角色着色(用户输入 = `--brand-strong`;Claude 回复 = `--text`;工具调用 = `--muted`,带 `⎿` 前缀;错误 = `--errored`)。深色系统下自动切换深色 surface。
3. **输入区**:多行 textarea + "发送" 主按钮。

### 5.2 看板(`dashboard.*`)

状态卡片列表,沿用 Phase 1 已交付的 `dashboard.css` 徽章系统(已对齐令牌):

- 每张卡:状态徽章 + 相对时间 + 会话名 + cwd 路径(mono)+ 预览行。
- 排序:状态权重(waiting > errored > working > idle > unknown),再按 `lastTs` 倒序。
- 徽章三重编码(颜色 + 图标 + 文本),`prefers-reduced-motion` 关闭脉冲。

### 5.3 登录(`login.html`)

居中卡片:logo + "登录" 标题 + 副标题(单用户自托管说明)+ 令牌密码框 + "登录" 主按钮。圆角 `--r-lg`,与全站品牌一致。`login.html` 现有内联 `<style>` 改为 link `tokens.css` + 极简页面样式。

## 6. 落地范围

### 改

- `public/tokens.css`(**新建**):设计令牌单一事实来源,`:root` 浅色 + `@media (prefers-color-scheme: dark)` 深色。被三页统一引用。
- `public/style.css`:重构为令牌系统,删除硬编码颜色(50+ 处),导入 `tokens.css`,组件改用变量。合并现有两处 `@media (prefers-color-scheme: dark)` 块(行 376-400 与 439-541)为令牌驱动,冷蓝暗色值换成本 spec 第 3 节的暖调令牌。
- `public/index.html`:套用统一 header + 工具栏 + 终端 + 输入结构,消费令牌。
- `public/login.html`:居中卡片结构,link `tokens.css`,消费令牌。
- `public/dashboard.css` / `dashboard.html`:对齐令牌变量(徽章系统已基本就位,主要是变量统一 + link tokens.css)。

### 不动

- `server.cjs`、`auth.cjs`、`dashboard_slug.cjs`、`dashboard_cache.cjs`:后端与状态聚合逻辑零改动。
- `client.js`(控制台 WebSocket 客户端逻辑):行为不变,只调整外观。

**client.js DOM 锁定清单(硬约束,绝不重命名)**:client.js 通过 `getElementById` / `classList` 直接操纵终端 DOM。改名 = WS 终端镜像立刻断裂。实施全程保留以下标识符:

- **id**:`messages`、`connectionStatus`、`chatContainer`、`sessionSelect`、`refreshSessions`、`projectControl`、`projectSelect`、`startProject`、`logoFallback`。
- **class**(JS 创建 / 切换):`connected`(connectionStatus)、`terminal-view`、`terminal-header`、`terminal-content`、`terminal-input-row`、`terminal-prompt`、`terminal-inline-input`、`terminal-inline-textarea`、`terminal-line`、`welcome-message`。

### 清理

- `public/mockups/`:临时 mockup 目录,选型已完成。实施落地并验证后删除。

## 7. 不在范围(YAGNI)

- 手动主题切换开关:深色随系统自动(`prefers-color-scheme`),不做 `[data-theme]` JS 手动切换。
- 任何后端或 API 改动。
- 新功能(只重设计现有界面)。

## 8. 测试

纯 CSS / HTML 改动,测试策略:

- **手动真机**:经 cloudflared 隧道在手机 + 桌面验证三页视觉统一、徽章状态、移动端布局。**桌面系统切深色模式,验证三页深色不破。**
- **回归(前端锁定清单)**:实施后 `grep` client.js 锁定清单的所有 id / class,确认 index.html 仍全部存在,未被重命名。
- **回归(后端)**:现有后端测试套件(dashboard_slug / dashboard_cache 等)不受影响,跑一遍确认零破坏。
- **无障碍**:徽章三重编码检查,`prefers-reduced-motion` 验证。

## 9. 风险

- `index.html` / `client.js` 是旧代码,重构外观时可能踩到内联样式或 JS 依赖的 class 名。client.js 锁定清单(10 id + 10 class)是硬约束,改名 = WS 镜像断。实施时先读清结构再改,小步验证,改完 grep 锁定清单兜底。
- 控制台终端浅色 + 深色跟随系统是本期决定;深色令牌集替换现有冷蓝暗色为暖调,需逐页验证深色不破。
- `tokens.css` 单一来源:三页都要 link,漏 link = 该页令牌失效回退硬编码。落地后逐页开 DevTools 确认 `:root` 变量已应用。
