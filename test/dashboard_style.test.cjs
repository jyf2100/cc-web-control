const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');

// Task 9 CSS 锁:对齐 Plan A DOM(<li.card-row> 同级 <button.card__select aria-pressed>
// + <a.card>)。卡住结构:card-row flex 一行、grid 减列、aria-pressed、safe-area、死代码清理。

test('.card-row is flex (button + a 同行)', () => {
  assert.match(css, /\.card-row\s*{[^}]*display:\s*flex/);
  assert.match(css, /\.card-row\s*>\s*\.card\s*{[^}]*flex:\s*1/);
});

test('.card__select uses aria-pressed not aria-checked', () => {
  assert.match(css, /\.card__select\[aria-pressed="true"\]/);
  assert.ok(!/\.card__select\[aria-checked="true"\]/.test(css));
});

test('.card grid has 4 columns (card__select 移出后)', () => {
  assert.match(css, /\.card\s*{[^}]*grid-template-columns:\s*auto auto 1fr auto/);
});

test('.main has safe-area bottom padding', () => {
  assert.match(css, /\.main\s*{[^}]*env\(safe-area-inset-bottom\)/);
});

test('.ma-warn-line retained (P3 regression lock)', () => {
  assert.match(css, /\.ma-warn-line/);
});

test('tabbar and switch-sheet dead CSS removed', () => {
  assert.ok(!/\.bottom-tabbar/.test(css));
  assert.ok(!/\.switch-sheet-backdrop/.test(css));
});

test('.visually-hidden retained (a11y helper, survives tabbar removal — 迁自 dashboard_tabbar.test.cjs)', () => {
  assert.match(css, /\.visually-hidden\s*\{/);
});

// Task 13 补:T9-deferred .card-row > .card__select flex 锁(select 不被 flex:1 撑满)
// .card-row > .card { flex:1 } 已锁,但 select 漏;dashboard.css:151 有 flex:0 0 auto。
test('.card-row > .card__select 用 flex:0 0 auto(不被 flex:1 撑满,留按钮固有宽)', () => {
  assert.match(css, /\.card-row\s*>\s*\.card__select\s*\{[^}]*flex:\s*0 0 auto/);
});

// ============================================================
// 迁自 console_style.test.cjs(Task 13 拆分)
// 旧变量名 CONSOLE_SECTION 误导:锚点「===== 多机控制台」实为 dashboard.html
// (Fleet Dashboard 多机 hub 看板)的样式段,非已删的 console.html。重命名为
// DASHBOARD_SECTION 对齐语义。逐段迁移保持断言逻辑不变(只搬不重写契约)。
// 注:段内部分类(.console-app/.console-hero/.console-term/#ma-screen 等)属已删
// console.html 的死 CSS,dashboard.html 不引用 —— 暂保留其测试(避免删 CSS 牵连),
// 死 CSS 清理留给最终 review。此处仅迁非 console-html-specific 的契约。
// ============================================================
const DASHBOARD_SECTION = css.slice(css.indexOf('===== 多机控制台'));

test('dashboard 段无硬编码 Tailwind 状态色(迁自 console_style)', () => {
  assert.ok(css.indexOf('===== 多机控制台') > 0, 'dashboard 段锚点注释丢失,测试可能误判');
  for (const hex of ['#34d399', '#fbbf24', '#f87171', '#94a3b8', '#64748b', '#22c55e', '#9ca3af', '#f59e0b', '#000', '#b45309']) {
    assert.ok(!DASHBOARD_SECTION.includes(hex), `不应残留硬编码色 ${hex}`);
  }
});
test('dashboard 段无白线 bug / 蓝选中行 / 琥珀广播底(迁自 console_style)', () => {
  assert.ok(!/rgba\(255,\s*255,\s*255,\s*\.08\)/.test(DASHBOARD_SECTION), '白线 bug 应清除');
  assert.ok(!/rgba\(96,\s*165,\s*250/.test(DASHBOARD_SECTION), '蓝色选中行应改 token');
  assert.ok(!/rgba\(245,\s*158,\s*11/.test(DASHBOARD_SECTION), '琥珀广播底应清除');
});
test('终端色用局部 token --term-bg/--term-fg(浅化对齐 7684,alias 到设计 token)(迁自 console_style)', () => {
  // --term-bg/--term-fg 定义在 dashboard.css 的「===== 多机控制台」段内(非 tokens.css),
  // 故此断言读 DASHBOARD_SECTION;tokens.test.cjs 不含此契约(按"读哪个源就归哪"路由)。
  // 终端对齐 7684 浅色 editorial:`--term-bg` alias 到 `--surface`(暖灰米 #ebeae5),
  // `--term-fg` alias 到 `--fg`(暖黑 #26251e);屏元素仍引 `var(--term-bg/--term-fg)`。
  assert.match(DASHBOARD_SECTION, /--term-bg:\s*var\(--surface\)/);
  assert.match(DASHBOARD_SECTION, /--term-fg:\s*var\(--fg\)/);
  assert.match(DASHBOARD_SECTION, /background:\s*var\(--term-bg\)/);
  assert.match(DASHBOARD_SECTION, /color:\s*var\(--term-fg\)/);
});
test('.s-dot--idle 加内描边满足非文本 3:1(迁自 console_style)', () => {
  // ring 加粗 1.5px + 深色 --fg-2(0.70 alpha,在 --bg 上合成对比 ~5.6:1 达非文本 3:1)。
  // 旧值 1px var(--border-2) 仅 ~1.6:1 不达标;此处锁新契约。
  assert.match(DASHBOARD_SECTION, /\.s-dot--idle\s*\{[^}]*box-shadow:\s*0 0 0 1\.5px var\(--fg-2\)/);
});
test('waiting 卡底用独立 --waiting-bg(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /--waiting-bg:\s*rgba\(192,\s*133,\s*50,\s*0\.08\)/);
});
test('prefers-reduced-motion 降级存在(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /prefers-reduced-motion:\s*reduce/);
});
test('errored 卡片与 selected 叠加不被覆盖(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /\.card\.card--selected\[data-status="errored"\]/);
});
test('P3 回归防护:.ma-warn-line 安全警告常驻可见(不被 data-ma-open 死门控隐藏)(迁自 console_style)', () => {
  // P3 删 #ma-toggle-btn 清了 HTML/JS 的 data-ma-open 设置点,但 CSS 唯一让 .ma-warn-line
  // 可见的规则 .console-hero[data-ma-open="true"] .ma-warn-line{display:block} 漏网 →
  // 警告恒 display:none,操作者看不到「⚠ 不可信远程数据」安全提示( HIGH 回归)。
  // 锁:CSS 无 data-ma-open 残留 + .ma-warn-line 默认 display:block 常驻可见。
  assert.doesNotMatch(css, /data-ma-open/, 'CSS 不应残留 data-ma-open 死门控(P3 清理留尾)');
  assert.match(css, /\.ma-warn-line\s*\{[^}]*display:\s*block/, '.ma-warn-line 应常驻 display:block 可见');
});
test('陈旧折叠区 + stale-grid CSS 契约(card--single 已随 singleMachine 移除)(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /\.board-stale-group\b/);
  assert.match(DASHBOARD_SECTION, /\.board-stale-grid\b/);
  assert.match(DASHBOARD_SECTION, /\.board-stale-group[\s\S]*?grid-column:\s*1\s*\/\s*-1/); // 折叠区占整行
});
test('fleet summary 提权(字体 ≥ .9em,原 .85em)(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /\.fleet-summary\s*\{[^}]*font-size:\s*\.9/);
});
test('陈旧折叠 summary 有展开指示符 + 展开态旋转(对齐 ASCII ▼ 目标)(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /\.board-stale-group\s*>\s*details\s*>\s*summary::before/);
  assert.match(DASHBOARD_SECTION, /content:\s*['"]▶['"]/);
  assert.match(DASHBOARD_SECTION, /\.board-stale-group\s*>\s*details\[open\]\s*>\s*summary::before[\s\S]*?rotate/);
});
test('陈旧折叠 summary 有 focus-visible 焦点环(WCAG 2.4.7)(迁自 console_style)', () => {
  assert.match(DASHBOARD_SECTION, /\.board-stale-group\s*>\s*details\s*>\s*summary:focus-visible/);
  assert.match(DASHBOARD_SECTION, /\.board-stale-group\s*>\s*details\s*>\s*summary:focus-visible[\s\S]*?outline/);
});
test('三页面样式:存在 .machine-group / .fanout-bar / .card__select[aria-pressed] 规则(迁自 console_style)', () => {
  assert.match(css, /\.machine-group\b/);
  assert.match(css, /\.machine-group--offline\b/);
  assert.match(css, /\.fanout-bar\b/);
  assert.match(css, /\.card__select\[aria-pressed="true"\]/);   // Task 9:Plan A button+a,aria-checked→aria-pressed
  assert.match(css, /\.card__select\b[^}]*min-height:\s*44/);   // 触摸目标 44px(WCAG 2.5.5)
  assert.match(css, /#ma-screen\s*\{[^}]*flex:\s*1/);           // 主控终端撑满
  assert.match(css, /#ma-screen\s*\{[^}]*max-height:\s*none/);  // 覆盖原 max-height:0,否则 flex:1 被锁死
  assert.match(css, /\.console-term\s*\{[^}]*flex:\s*1;\s*min-height:\s*0/);  // 三页面:单机模式 term 撑满剩余视口(Task 6 detectConsoleMode 同提交)
});

test('三页面显隐:[hidden] 兜底(display:flex 不盖过 UA [hidden],detectConsoleMode 切换才视觉生效) — T8 §4.1/§4.2(迁自 console_style)', () => {
  // .console-hero/.console-term/.tab 的 display:flex 覆盖 UA [hidden]{display:none},
  // 须显式 [hidden]{display:none} 兜底,否则单机 hero 不隐 / 多机 term+⇄ 不隐(违反职责分离)
  assert.match(css, /#main-agent-panel\[hidden\][^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.console-term\[hidden\][^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.tab\[hidden\][^{]*\{[^}]*display:\s*none/);
  // P0-1:.fanout-bar{display:flex} 顶穿 UA [hidden](同款 commit 242c486 控制台 C1),看板遗漏;
  // 首次进看板(无选中)底部常驻「已选 0…」bar(2026-07-05 运行时坐实 offsetTop:535/可见)。
  assert.match(css, /\.fanout-bar\[hidden\][^{]*\{[^}]*display:\s*none/);
});
test('看板主内容区 .main flex:1 + min-height:0(多卡时不撑爆 #app 推走 tabbar) — T8 §4.0(迁自 console_style)', () => {
  assert.match(css, /\.main\s*\{[^}]*flex:\s*1/);
  assert.match(css, /\.main\s*\{[^}]*min-height:\s*0/);
});
test('#app overflow:hidden 兜底(内容溢出不外溢视口) — T8 §4.0(迁自 console_style)', () => {
  assert.match(css, /#app\s*\{[^}]*overflow:\s*hidden/);
});
test('.ma-btn 触摸目标 ≥44px(WCAG 2.5.5,主控 Start/Stop/镜像) — T8 §7(迁自 console_style)', () => {
  assert.match(css, /\.ma-btn\s*\{[^}]*min-height:\s*44/);
});
test('.board-body 纯 list 重置(非 grid,避免外层网格把 machine-group 压成单格 → 卡片一列) — 三页面 §4.3①(迁自 console_style)', () => {
  // #board-body 装的是 <li class="machine-group"> 分组容器,非卡片;若它自带 board-grid(display:grid),
  // 每个 machine-group 只占 1 格(~251px),组内 .board-grid inherits → minmax(220px) 仅 1 列(2026-07-05 实测)。
  assert.match(css, /\.board-body\s*\{[^}]*list-style:\s*none/);
});

// ============================================================
// P5(dashboard.css 段):离线视觉规则用 --offline / 机名不用 --fg-3(迁自 console_style)
// 按路由原则:这些断言读 dashboard.css,故归 dashboard_style.test.cjs(非 tokens.test.cjs)。
// ============================================================
test('P5:离线机名 .machine-group--offline .machine-group__name 不再用 --fg-3(达 4.5:1)(迁自 console_style)', () => {
  // 原规则:color:var(--fg-3) → ~2:1 不达 WCAG AA 4.5:1。
  // 修:改用 --fg-2(达 ~5.4:1)或新 --offline(若该 token 达对比)。
  const rule = css.match(/\.machine-group--offline\s+\.machine-group__name\s*\{[^}]*\}/);
  assert.ok(rule, '离线机名规则应存在');
  assert.ok(
    !/var\(--fg-3\)/.test(rule[0]),
    '离线机名不应再用 --fg-3(对比度仅 ~2:1,不达 WCAG AA)'
  );
});
test('P5:.s-dot--offline 用 --offline token(非 --fg-3)(迁自 console_style)', () => {
  // 原 background:var(--fg-3) 与 --idle 几乎不可分;改用 --offline 与 idle 拉开。
  const rule = css.match(/\.s-dot--offline\s*\{[^}]*\}/);
  assert.ok(rule, '.s-dot--offline 规则应存在');
  assert.match(rule[0], /var\(--offline\)/, '.s-dot--offline 应用 --offline token');
  assert.ok(!/var\(--fg-3\)/.test(rule[0]), '.s-dot--offline 不应再退回 --fg-3');
});

// ============================================================
// P6:批量补 :focus-visible(WCAG 2.4.7 AA)(迁自 console_style)
// ============================================================
test('P6:机分组 summary(普通组)有 :focus-visible(原仅 stale-group 有)(迁自 console_style)', () => {
  // .board-stale-group > details > summary:focus-visible 已存在;普通组 .machine-group > details > summary 漏。
  assert.match(
    css,
    /\.machine-group\s*>\s*details\s*>\s*summary:focus-visible[\s\S]*?outline/
  );
});
test('P6:.card__select(tabindex=0)有 :focus-visible(迁自 console_style)', () => {
  assert.match(css, /\.card__select:focus-visible[\s\S]*?outline/);
});
test('P6:#term-input 有 :focus-visible(迁自 console_style)', () => {
  assert.match(css, /#term-input:focus-visible[\s\S]*?outline/);
});
test('P6:.topbar-back 有 :focus-visible(迁自 console_style)', () => {
  assert.match(css, /\.topbar-back:focus-visible[\s\S]*?outline/);
});
test('P6:.fanout-bar .term-input 焦点环改 :focus → :focus-visible(避免鼠标点击常驻)(迁自 console_style)', () => {
  // 原 :focus 在鼠标点击后常驻,违反焦点可见性最佳实践;改 :focus-visible 仅键盘触发。
  assert.match(css, /\.fanout-bar\s+\.term-input:focus-visible[\s\S]*?outline/);
  // 旧 :focus 规则应被替换(不应残留 :focus,需区分 :focus-visible)
  assert.ok(
    !/\.fanout-bar\s+\.term-input:focus\s*\{/.test(css),
    '.fanout-bar .term-input 不应再用裸 :focus(改 :focus-visible)'
  );
});

// ============================================================
// P8:input 字号锁 16px(iOS Safari 防聚焦自动放大)(迁自 console_style)
// ============================================================
test('P8:.fanout-bar .term-input 显式 font-size:16px(原 font:inherit 继承 14px)(迁自 console_style)', () => {
  // iOS Safari <16px 聚焦自动放大整页,失焦不还原。修:显式 16px。
  const rule = css.match(/\.fanout-bar\s+\.term-input\s*\{[^}]*\}/);
  assert.ok(rule, '.fanout-bar .term-input 规则应存在');
  assert.match(rule[0], /font-size:\s*16px/, '.fanout-bar .term-input 应显式 font-size:16px');
});
test('P8:#term-input 显式 font-size:16px(迁自 console_style)', () => {
  const rule = css.match(/#term-input\s*\{[^}]*\}/);
  assert.ok(rule, '#term-input 规则应存在');
  assert.match(rule[0], /font-size:\s*16px/, '#term-input 应显式 font-size:16px');
});

// ============================================================
// Task 4:.card--hub IA(对齐 demo — flex column + card__head + line-clamp + 清状态染色)
// ============================================================
test('T4: .card--hub 用 flex column(非基础 grid)', () => {
  const rule = css.match(/\.card--hub\s*\{[^}]*\}/);
  assert.ok(rule, '.card--hub 规则应存在');
  assert.match(rule[0], /display:\s*flex/);
  assert.match(rule[0], /flex-direction:\s*column/);
});
test('T4: .card--hub .card__head flex 包裹层', () => {
  assert.match(css, /\.card--hub\s+\.card__head\s*\{[^}]*display:\s*flex/);
});
test('T4: hub 摘要 .card--hub .card__last line-clamp:2 + min-height:38 + --fg-2', () => {
  const rule = css.match(/\.card--hub\s+\.card__last\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /-webkit-line-clamp:\s*2/);
  assert.match(rule[0], /min-height:\s*38px/);
  assert.match(rule[0], /var\(--fg-2\)/);
  assert.ok(!/var\(--fg-3\)/.test(rule[0]), 'hub 摘要不应 --fg-3');
});
test('T4: hub 状态点 11px(.card--hub .s-dot)', () => {
  const rule = css.match(/\.card--hub\s+\.s-dot\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /width:\s*11px/);
  assert.match(rule[0], /height:\s*11px/);
});
test('T4: hub 清状态染色 — .card--hub[data-status="errored"] 无左缘条(box-shadow:none)', () => {
  // spec 非目标:errored 只靠色点,不加左缘条。基础 .card[data-status=errored] 有左缘条,hub 必须清。
  const rule = css.match(/\.card--hub\[data-status="errored"\]\s*\{[^}]*\}/);
  assert.ok(rule, '.card--hub[data-status=errored] 覆盖规则应存在');
  assert.match(rule[0], /box-shadow:\s*none/);
});
test('T4: .card--hub hover border+bg(demo L76)', () => {
  assert.match(css, /\.card--hub:hover\s*\{[^}]*border-color:\s*var\(--accent-dim\)/);
  assert.match(css, /\.card--hub:hover\s*\{[^}]*background:\s*var\(--surface-2\)/);
});
test('T4: .sr-only 类定义(色盲状态冗余,demo L99)', () => {
  assert.match(css, /\.sr-only\s*\{[^}]*position:\s*absolute/);
});
test('T4: .card__off 离线标签样式(demo L86)', () => {
  const rule = css.match(/\.card__off\s*\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /var\(--offline\)/);
});

// ============================================================
// Task 5:几何一致性(spec §4/§7,demo L64/L67/L75)
// ============================================================
test('T5: .board-grid 固定列宽 244px(demo L64)', () => {
  assert.match(css, /\.board-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*244px\)/);
});
test('T5: .board-grid 等高 grid-auto-rows:104px', () => {
  assert.match(css, /\.board-grid\s*\{[^}]*grid-auto-rows:\s*104px/);
});
test('T5: .card-row > .card 用 flex:1 1 0%(等宽真根因)', () => {
  assert.match(css, /\.card-row\s*>\s*\.card\s*\{[^}]*flex:\s*1 1 0%/);
  assert.match(css, /\.card-row\s*>\s*\.card\s*\{[^}]*min-width:\s*0/);
});
test('T5: .card-row align-items:stretch + gap:8px(两级 stretch 传等高,demo L67)', () => {
  assert.match(css, /\.card-row\s*\{[^}]*align-items:\s*stretch/);
  assert.match(css, /\.card-row\s*\{[^}]*gap:\s*8px/);
});
