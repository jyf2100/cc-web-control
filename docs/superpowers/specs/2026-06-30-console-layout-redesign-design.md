# 控制台 header 重新布局 设计文档

> **状态:** 待评审。定稿方向已与用户确认(A 单行 header + C 卡片框)。实施计划由 writing-plans skill 另出。
> **关联:** 承接 [`2026-06-29-ios-editorial-redesign-design.md`](./2026-06-29-ios-editorial-redesign-design.md) 的暖灰 tokens;本次聚焦控制台 header 的「乱」。

## 背景与问题

控制台页(`index.html`)header 在真机/桌面走查中发现「乱」,用户反馈(逐字):

- 「整个UI没有包裹起来与设计不一样」
- 「① brand-row　② meta-bar ③ nav 高低低看起来极端不整齐」

代码定位到两个根因:

1. **header 全宽 vs 终端限宽,左右不对齐(「空挂」)**
   - `.messages`(终端/对话主体)`max-width:1100px; margin:0 auto`(`style.css:141-145`)居中限宽。
   - `.header` **没有限宽**,100% 全宽(`style.css:32-36`)。
   - 大屏(如 2476px)上:header 横跨整屏,终端缩在中间 1100px,header 左沿与终端左沿错开约 688px → header 两侧「空挂」,不是一个对齐的包裹。

2. **header 三段高度不齐 + 形状不一(「高高低低」)**
   - `brand-row` 约 30px(logo 16px,无 44px 元素)
   - `meta-bar` 约 60px(被「切换」按钮 `min-height:44px` + padding 撑高,`style.css:59-64`)
   - `nav` 约 50px(胶囊 `padding:3px` + link `min-height:44px`,`style.css:300-307`)
   - 三段「形状」还不一:brand-row 是裸文字、meta-bar 是带顶分隔线的文字行、nav 是带背景的胶囊 → 堆叠高高低低、散。

附带(专家诊断共识,本次顺带治):

- terminal-view「卡片套卡片」:外有 border+圆角,内 terminal-header/quick-reply 又各自带边框(`style.css:155-200`),5 道边框碎裂感。
- WCAG:`.meta-label` 用 `--fg-3`(约 2.3:1)不达 AA(违反 tokens.css 契约:fg-3 禁用于阅读文本)。
- serif 大标题插在 mono 终端里,字体三混(`style.css:150-153` welcome-message 用 `--serif`)。

## 目标

重新布局控制台 header,治上述「乱」;**两端(桌面 + 移动)都要**;**视觉 + 结构全改**。

## 范围决策(已与用户确认)

| 决策点 | 选择 |
|---|---|
| 重新布局方向 | **A 单行 header + C 卡片框**(用户混合选定) |
| 目标端 | 桌面 + 移动两端 |
| 改动程度 | 视觉 + 结构全改 |
| 页面范围 | 控制台页(`index.html`)header 为主;看板/登录页本次不改 |

## 设计

### 核心思路:卡片容器 + 单行等高 header

整个 `#app` 内容包进一张**卡片容器**(居中限宽、边框+圆角+轻阴影);header 重排为**单行等高**;header 与终端都在卡片内 → **左右天然对齐**(治「空挂」)+ **垂直只占一行**(终端最大化,治「高高低低」)。

### 1. 卡片容器(包裹,治「空挂」)

- 在 `#app` 内加卡片壳(或 `#app` 自身充当):`max-width:1100px; margin:0 auto; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); box-shadow:<轻阴影>`;`overflow:hidden` 让 header 顶部圆角与卡片一致。
- header + main 都在卡片内。
- 效果:header 与终端左右边界都在 1100px 卡片内,**天然对齐**,大屏两边留白成整齐包裹。
- 移动端(≤768px):卡片**贴边**(去 margin、保留 safe-area padding、小圆角),不浪费窄屏。

### 2. header 单行等高(治「高高低低」)

合并现有 4 段(brand-row / meta-bar / nav / desktopControls)为**桌面单行**:

- 单行布局:`[◇ brand] [● live] [project ~/…] …… [Session⌄] [Project⌄] [启动] [控制台 看板 登录]`
- **所有控件统一等高**(触摸目标 44px),形状统一(一致的胶囊/方块风格),消除 30/60/50 的高差。
- 删除:`brand-ver`「v2.4」、meta-bar 的 `border-top` 分隔线(卡片内不需要)、三段各自的 padding 差异。
- `project` 信息从独立 meta-bar 段并入单行(等高 mono 文本)。
- 字体:UI 用 `--sans`,数据/路径用 `--mono`;删除 `welcome-message` 的 serif。

### 3. 终端区(卡片内,治「卡片套卡片」)

- 终端区填满卡片剩余高度(`flex:1`)。
- `terminal-view` **去掉外 border/圆角**(卡片已有边框),消除「卡片套卡片」5 道边框。
- terminal-header / quick-reply / input-row 在终端区内,用背景色差区隔(而非多余边框)。

### 4. 移动端(≤768px,折叠 + 治「死路」)

- 卡片贴边。
- header 单行只留:`brand + live + nav(控制台/看板)`;登录收起。
- `project / Session / Project / 启动` **收进「切换」抽屉**(复用 `switch_sheet.cjs`)。
- **扩展 `switch_sheet`**:现有仅列会话(`buildSessionItems`);新增**项目列表 + 启动操作**(复用 `index.html` 已有的 `projectSelect` / `startProject` 逻辑)→ 顺带解决之前「移动端无法启动项目」的死路。
- 抽屉入口在 header 精简单行内的「切换 ⌄」。

### 5. 无障碍 / WCAG

- `.meta-label` 等 `--fg-3` → `--fg-2`(达 AA,守 tokens.css 契约)。
- 触摸目标 44px(沿用 ios spec)。
- `:focus-visible` 焦点环(沿用现有 accent-2 环)。

## 关键文件(改造对象)

- `public/index.html`:DOM 从 4 段 → 卡片壳 + 单行 header(移动端折叠结构)。
- `public/style.css`:卡片壳、header 单行等高、terminal 去外边框、移动端折叠断点、fg-3→fg-2。
- `public/client.js`:`ensureTerminalView` 终端纳入卡片、去外边框;单行 header 元素构建。
- `public/modules/switch_sheet.cjs`:扩展 `buildSessionItems` → 加项目列表 + 启动。
- `public/tokens.css`:如需,加卡片阴影 token(如 `--shadow-card`)。

## 明确不做(范围控制)

- 不改终端输入模型(textarea + 回车,保持)。
- 不改 tmux 轮询 / WebSocket 架构。
- 不做完整按键工具栏(ios spec 已排除;保留 Esc/Ctrl+C + 快捷回复)。
- 不改看板页 / 登录页布局(本次只控制台 header)。
- 不改后端 `server.cjs`(纯前端布局;项目/启动逻辑已存在,前端复用)。

## 测试策略

- 原生 `node:test`(DOM JS 用 UMD `.cjs` + 手动 stub,沿用项目惯例;浏览器 IIFE 不测)。
- `switch_sheet` 扩展:测项目列表渲染 + 启动动作触发。
- `client.js` 单行 header 构建:测元素结构 / 等高。
- 视觉走查:桌面 1100+ 居中卡片对齐、中屏(768-1100)断点、移动 375 贴边 + 抽屉。
- WCAG:对比度检查(fg-2 替 fg-3)。

## 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| 中屏(768-1100px)单行 header 拥挤(Session/Project 下拉 + nav 放不下) | 中 | 中屏断点也折叠部分控件到抽屉,不只移动端 |
| 卡片边框 + terminal 去边框后,终端区与 header 视觉区隔变弱 | 低 | 用背景色差(header `surface-2` / 终端 `surface`)区隔 |
| `switch_sheet` 加项目+启动需接现有 projectSelect/startProject 数据流 | 中 | plan 阶段核实数据源(`projectsView.cjs`),复用而非重写 |

## 工作量估算

| 项 | 工作量 |
|---|---|
| 卡片壳 + 桌面单行等高 header | ~0.5 人天 |
| 移动端折叠 + switch_sheet 扩展(项目+启动) | ~0.5 人天 |
| 终端去边框 + WCAG(fg-3→fg-2)+ 字体收敛 | ~0.3 人天 |
| 测试 + 桌面/真机走查 | ~0.3 人天 |
| **合计** | **~1.5 人天** |

## 后续

本 design doc 审阅通过后,用 writing-plans skill 出分任务实施计划(每任务可独立提交,遵循 TDD)。
