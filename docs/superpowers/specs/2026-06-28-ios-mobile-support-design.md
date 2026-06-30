# iOS 手机支持 设计文档

> ⚠️ **部分作废:** 本 spec 中的「badge 深色变体」与「深色 badge/waiting 视觉」MVP-1 项,已被 [`2026-06-29-ios-editorial-redesign-design.md`](./2026-06-29-ios-editorial-redesign-design.md) **砍深色 + 废 badge** 双重取代,在此声明作废。其余 iOS 适配项(viewport/safe-area/PWA/止损键/快速回复)仍有效。

> **状态:** 已评审修订(工程/设计/产品三方评审,7/10、6/10、6/10)。实施计划见 `docs/superpowers/plans/2026-06-28-ios-mobile-support.md`,已按评审重排为 MVP-0/1/2,修 4 硬伤,纳入 4 个真需求(快捷回复、Esc/Ctrl+C 止损、等待 title 提示、WS 退避)。

## 背景与目标

cc-web-control 现在只能在桌面/笔记本浏览器用。目标是让 iPhone 也能用:

- 看多会话状态看板(谁在等输入、谁报错、谁在跑)
- 需要时进控制台发一条指令、回车、等结果(Claude agent CLI 的轻度操作)
- 做成可"添加到主屏"的 PWA,像原生 App 全屏启动

## 关键事实(专家调研发现)

1. **终端不是 xterm.js**。前端架构是:服务端 `tmux capture-pane -p` 每 100ms 轮询抓 tmux pane 文本快照,经 WebSocket 推到前端,写进 `<pre class="terminal-content">`(`server.cjs:535`、`client.js:212-232`)。输入是一个普通 `<textarea>`,用户敲完一行回车,前端拼成 `batch` 动作发回,服务端 `tmux send-keys` 注入(`client.js:251-284`)。这避开了 xterm.js 在 iOS 的一堆已知坑,但输入模型是"文本框 + 回车",不是真终端。
2. **看板改造量 L0,控制台是改造重点**。看板卡片触摸目标 64px 已达标,640px 断点已折叠末行预览,接近可用;控制台有阻断项。
3. **软键盘遮挡输入框是唯一阻断项**。`style.css` 用 `#app { height: 100vh }` + `html,body { overflow: hidden }`,iOS Safari 键盘弹出时压缩的是 visual viewport 不是 layout viewport,`100vh` 不变,输入框会被键盘盖住。
4. **网络走 Cloudflare Tunnel,不改监听到 0.0.0.0**。项目已有 `scripts/restart_tunnel.sh`,复用它一次性解决 HTTPS + cookie Secure + 隐藏内网 + PWA 可用。
5. **现有 `public/logo.png` 是 144×162 RGBA 透明非方形**,iOS 主屏图标三重不合格(非方形、有透明、尺寸不足),必须从零设计新图标。

## 范围决策(已与用户确认)

| 决策点 | 选择 |
|---|---|
| 使用场景 | 看板 + 轻度操作(含快捷回复 y/n、极简 Esc/Ctrl+C 止损;不做完整按键工具栏) |
| 访问方式 | Cloudflare Tunnel(复用 restart_tunnel.sh) |
| PWA | 做(可加主屏) |
| 交付节奏 | 三个 Phase 一起做 |
| 图标素材 | 从零设计,出 2-3 方案给用户挑 |

## 改造范围

### Phase 1:看板移动可用 + PWA 基础(~1 人天)

#### 1.1 viewport 适配(三页)
- `index.html` / `dashboard.html` / `login.html` 的 viewport meta 加 `viewport-fit=cover`
- **不加** `user-scalable=no`(无障碍合规)

#### 1.2 看板微调
- `dashboard.css`:`@media(prefers-color-scheme:dark)` 补 5 个 badge 状态(waiting/errored/working/idle/unknown)的暗色变体(背景 + 文字),消除深色模式下浅色 badge 刺眼
- 触摸高度:`.nav-link` 在 `style.css` 和 `dashboard.css` 两处 `.nav` 定义都加 `min-height: 44px`(项目自己标了"DRY 违反待 P3 合并",改两处)
- `.session-row` 加 `:active` 背景反馈(触摸点击有即时响应,避免重复点)
- `dashboard.js`:监听 `visibilitychange`,页面切后台暂停 2s 轮询,回前台立即刷新一次再恢复轮询(省电 + 避免后台 fetch 堆积)

#### 1.3 PWA 三件套
- 新建 `public/manifest.json`:`name` / `short_name`(≤6 字符)/ `display: "standalone"` / `theme_color` / `background_color` / `icons`(192/512/maskable)
- **图标从零设计**:产出 `apple-touch-icon.png`(理想 512×512 一张,iOS 自动缩放),不透明方形 PNG,不带圆角/曲线(iOS 自己裁)。出 2-3 个设计方案给用户挑,定稿后同时产出 manifest 用的 192/512/maskable 变体
- 三页 head 加:
  - `<link rel="manifest" href="manifest.json">`
  - `<link rel="apple-touch-icon" href="apple-touch-icon.png">`
  - `<meta name="apple-mobile-web-app-capable" content="yes">`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
  - `<meta name="apple-mobile-web-app-title" content="CC Control">`(主屏图标下文字)
  - `<meta name="theme-color" content="<品牌色>">`
- CSS 主容器(`.header` 顶部、`.main`、底部输入区)加 `env(safe-area-inset-*)` padding,避免 standalone 模式下内容被状态栏/Home Indicator 压住

### Phase 2:控制台轻度操作可用(~2 人天,核心)

#### 2.1 软键盘适配(唯一阻断项)
- `style.css`:`#app` 的 `100vh` → `100dvh`;`.terminal-view` 的 `max-height: calc(100vh - 130px)` → 用 `dvh`
- `client.js`:监听 `window.visualViewport` 的 `resize` / `scroll`,键盘弹出时动态算可用高度,把 `.terminal-view` 的 `max-height` 设为 `visualViewport.height - header`,输入框 `scrollIntoView({block:'end'})` 滚进可见区
- `focusInput`(`client.js:447-456`):去掉 `preventScroll: true` 或手动 `scrollIntoView`,让输入框在键盘弹出时滚进可见区
- 输入框加 `enterkeyhint="send"`(回车键显示"发送")

#### 2.2 header 窄屏重排
- 现状:375px 宽度塞不下 logo + Session 下拉 + 刷新 + Project 下拉 + 启动 + 状态 + 3 个导航链接
- `@media(max-width:768px)`:`.header-actions { flex-wrap: wrap }`,隐藏次要控件(登录导航用浏览器后退替代),必要时改两行布局
- 信息密度重新设计:哪些保留常驻、哪些折叠(决策成本高于编码,可能 2-3 轮调整)

#### 2.3 触摸目标 + 字号
- `.btn` / `.control-input` / `.nav-link` 在移动端断点 `min-height: 44px`(iOS HIG)
- `.terminal-inline-textarea` 字号全局提到 ≥16px(防 iOS 聚焦时自动放大页面)。移动端断点已提到 16px(`style.css:422-424`),改为全局统一

#### 2.4 复制 + 粘贴
- 加"复制最新输出"按钮:`navigator.clipboard.writeText(lastOutput)`,try/catch 回退 `document.execCommand('copy')`
- textarea `input` 事件检测内容含 `\n`,提示"将作为多行发送(换行会变成多个 Enter),是否继续",避免误发

#### 2.5 横屏鼓励
- 竖屏时(`@media(orientation:portrait)`)轻量提示"横屏体验更佳(80 列终端更完整)",可关闭,不强制

### Phase 3:网络接入 + 安全加固(~0.5-1 人天)

#### 3.1 Cloudflare Tunnel 接入
- 复用 `scripts/restart_tunnel.sh`(已用 `openssl rand -hex 16` 生成 128bit token + cloudflared Quick Tunnel)
- 文档化 iPhone 访问步骤:Mac 运行脚本 → 拿 `*.trycloudflare.com` URL → iPhone Safari 打开 → 输 token 登录
- 确认 `app.set('trust proxy', 1)`(`server.cjs:48`)已开,隧道下 `x-forwarded-proto: https` 让 cookie 自动带 `Secure`,无需改代码

#### 3.2 登录速率限制
- 新增 rate-limit middleware(~50 行),对 `POST /login` 按 IP 滑动窗口限流(每 IP 每分钟 N 次,默认 10),超阈值返回 429
- 隧道场景按 `x-forwarded-for` 取真实 IP(`trust proxy` 已开)
- 防 token 暴力撞库 / DoS(当前 token 强但无任何防护)

#### 3.3 cookie maxAge
- cookie 加显式 `maxAge`(可配 `CC_WEB_SESSION_TTL`,默认如 24h),到期自动失效重登,避免 cookie 长期持有

## 明确不做(避免范围蔓延)

- **完整按键工具栏**(Tab/方向键等):用户选了轻度操作。但保留极简 Esc + Ctrl+C 两个止损键(服务端 key 白名单 `server.cjs:481` 已含,见 plan Task 13),不做 Tab/方向键全键盘。快捷回复 Yes/No/Continue 另做(plan Task 12)
- **真 80×24 TUI resize-pane**:手机竖屏物理上放不下 80 列,对抗物理限制,放弃。文档写"鼓励横屏"
- **Service Worker 离线壳**:iOS 加主屏不卡 SW 这关,且本应用断网即失联,离线价值低
- **IP 白名单**:走 Cloudflare Tunnel 不需要(Cloudflare 边缘已是反向代理)
- **单设备登出会话表**:对个人工具过度,token 轮换等价全设备登出
- **mDNS 改造**:tunnel 方案用公网 URL,不需要 `.local` 发现

## 测试策略

- **真机**:iPhone Safari 直接访问 + 加主屏后 standalone 模式,覆盖两个界面
- **软键盘 5 种状态**:聚焦 / 失焦 / 中文拼音键盘 / 表情键盘 / 第三方键盘
- **横竖屏切换**:转屏后终端视口重算
- **弱网 / 切后台重连**:锁屏 → 回前台,WS 重连 + capture-pane 重新拉屏
- **隧道访问端到端**:Mac 跑 tunnel → iPhone 访问 HTTPS URL → 登录 → 看板 → 控制台发指令
- **速率限制**:脚本压测 `/login` 验证 429

## 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| 软键盘适配在不同 iOS 版本行为差异(visualViewport 更新时机) | 高 | 真机反复测 5 种键盘状态,留出调试时间 |
| header 重排是设计决策,可能 2-3 轮调整 | 中 | Phase 2 单独预留调整轮次 |
| Cloudflare Tunnel 免费版 URL 每次重启变化 | 高 | iPhone 主屏图标点进去会变死链,高频痛点。文档推荐命名隧道固定域名,Quick Tunnel 仅一次性测试 |
| apple-mobile-web-app-status-bar-style `black-translucent` 在不同机型状态栏表现 | 低 | safe-area padding 兜底 |

## 工作量估算

| MVP | 内容 | 工作量 |
|---|---|---|
| MVP-0 | 验证手机能连 + 能看 + 能加主屏(viewport/暂停轮询/title/manifest/rate-limit/tunnel 文档) | ~0.5-0.7 人天 |
| MVP-1 | 看板打磨 + 图标(深色 badge/waiting 视觉/触摸/focus-visible/图标设计限 2 轮) | ~0.5 人天 |
| MVP-2 | 控制台可用(软键盘/header/快捷回复/Esc+Ctrl+C/复制/WS 退避/cookie) | ~1 人天 |
| **合计** | | **~5.5-6.5 人天**(软键盘真机调试通常超预期,图标限 2 轮定稿) |

## 关键文件清单(改造对象)

- `public/index.html` / `dashboard.html` / `login.html`:viewport meta、PWA link/meta
- `public/style.css`:100vh → 100dvh、header 重排、触摸目标、字号
- `public/client.js`:visualViewport 监听、focusInput 调整、复制按钮、多行粘贴提示、横屏提示
- `public/dashboard.css`:badge 暗色变体、nav 触摸高度、:active 反馈
- `public/dashboard.js`:visibilitychange 暂停轮询
- `public/manifest.json`:新建
- `public/apple-touch-icon.png` + 192/512/maskable 变体:新建(从零设计)
- `server.cjs`:rate-limit middleware、cookie maxAge
- `scripts/restart_tunnel.sh`:复用,补文档

## 后续

本 design doc 审阅通过后,用 writing-plans skill 出分任务的实施计划(每个 Phase 拆成可独立提交的任务,遵循 TDD)。
