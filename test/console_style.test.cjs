const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');
const tokens = fs.readFileSync(path.join(__dirname, '..', 'public', 'tokens.css'), 'utf8');
const CONSOLE_SECTION = css.slice(css.indexOf('===== 多机控制台'));
const switchSheetSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'switch_sheet.cjs'), 'utf8');

test('console 段无硬编码 Tailwind 状态色', () => {
  assert.ok(css.indexOf('===== 多机控制台') > 0, 'console 段锚点注释丢失,console_style 测试可能误判');
  for (const hex of ['#34d399', '#fbbf24', '#f87171', '#94a3b8', '#64748b', '#22c55e', '#9ca3af', '#f59e0b', '#000', '#b45309']) {
    assert.ok(!CONSOLE_SECTION.includes(hex), `不应残留硬编码色 ${hex}`);
  }
});
test('console 段无白线 bug / 蓝选中行 / 琥珀广播底', () => {
  assert.ok(!/rgba\(255,\s*255,\s*255,\s*\.08\)/.test(CONSOLE_SECTION), '白线 bug 应清除');
  assert.ok(!/rgba\(96,\s*165,\s*250/.test(CONSOLE_SECTION), '蓝色选中行应改 token');
  assert.ok(!/rgba\(245,\s*158,\s*11/.test(CONSOLE_SECTION), '琥珀广播底应清除');
});
test('.console-app 是顶层 flex 列容器', () => {
  const m = CONSOLE_SECTION.match(/\.console-app\s*\{([^}]*)\}/);
  assert.ok(m, '.console-app 规则应存在');
  assert.match(m[1], /height:\s*100dvh/);
  assert.match(m[1], /display:\s*flex/);
  assert.match(m[1], /flex-direction:\s*column/);
  assert.match(m[1], /overflow:\s*hidden/);
});
test('终端色用局部 token --term-bg/--term-fg(浅化对齐 7684,alias 到设计 token)', () => {
  // 终端对齐 7684 浅色 editorial:`--term-bg` alias 到 `--surface`(暖灰米 #ebeae5),
  // `--term-fg` alias 到 `--fg`(暖黑 #26251e);屏元素仍引 `var(--term-bg/--term-fg)`。
  assert.match(CONSOLE_SECTION, /--term-bg:\s*var\(--surface\)/);
  assert.match(CONSOLE_SECTION, /--term-fg:\s*var\(--fg\)/);
  assert.match(CONSOLE_SECTION, /background:\s*var\(--term-bg\)/);
  assert.match(CONSOLE_SECTION, /color:\s*var\(--term-fg\)/);
});
test('.s-dot--idle 加内描边满足非文本 3:1', () => {
  // ring 加粗 1.5px + 深色 --fg-2(0.70 alpha,在 --bg 上合成对比 ~5.6:1 达非文本 3:1)。
  // 旧值 1px var(--border-2) 仅 ~1.6:1 不达标;此处锁新契约。
  assert.match(CONSOLE_SECTION, /\.s-dot--idle\s*\{[^}]*box-shadow:\s*0 0 0 1\.5px var\(--fg-2\)/);
});
test('卡片网格 auto-fill minmax', () => {
  assert.match(CONSOLE_SECTION, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(220px,\s*1fr\)\)/);
});
test('waiting 卡底用独立 --waiting-bg', () => {
  assert.match(CONSOLE_SECTION, /--waiting-bg:\s*rgba\(192,\s*133,\s*50,\s*0\.08\)/);
});
test('prefers-reduced-motion 降级存在', () => {
  assert.match(CONSOLE_SECTION, /prefers-reduced-motion:\s*reduce/);
});
test('.console-hero.disabled 存在(连接态视觉,Task 10 toggle 目标)', () => {
  assert.match(CONSOLE_SECTION, /\.console-hero\.disabled\s*\{[^}]*opacity:\s*\.5/);
});
test('errored 卡片与 selected 叠加不被覆盖', () => {
  assert.match(CONSOLE_SECTION, /\.card\.card--selected\[data-status="errored"\]/);
});
test('board_render.buildCardHTML 输出的 class 在 markup 中齐全(看板卡片契约,无 selected)', () => {
  const B = require('../public/board_render.cjs');
  const html = B.buildCardHTML({ id: 'm1', name: 'M1' }, { name: 's1', status: 'errored' }, { active: true });
  for (const sel of ['card', 'active', 'card__name', 'card__session', 'card__last', 'card__time', 's-dot--errored', 's-icon']) {
    assert.ok(html.includes(sel), `buildCardHTML 应输出含 "${sel}"`);
  }
  assert.match(html, /data-status="errored"/);
  assert.match(html, /aria-label=/);
});
test('P3 回归防护:.ma-warn-line 安全警告常驻可见(不被 data-ma-open 死门控隐藏)', () => {
  // P3 删 #ma-toggle-btn 清了 HTML/JS 的 data-ma-open 设置点,但 CSS 唯一让 .ma-warn-line
  // 可见的规则 .console-hero[data-ma-open="true"] .ma-warn-line{display:block} 漏网 →
  // 警告恒 display:none,操作者看不到「⚠ 不可信远程数据」安全提示( HIGH 回归)。
  // 锁:CSS 无 data-ma-open 残留 + .ma-warn-line 默认 display:block 常驻可见。
  assert.doesNotMatch(css, /data-ma-open/, 'CSS 不应残留 data-ma-open 死门控(P3 清理留尾)');
  assert.match(css, /\.ma-warn-line\s*\{[^}]*display:\s*block/, '.ma-warn-line 应常驻 display:block 可见');
});
test('switch-sheet a11y:role=dialog + aria-modal + inert 背景', () => {
  // switch_sheet.cjs 用 setAttribute('role','dialog') 两参形式,非属性字面量 → 按实际源码匹配
  assert.match(switchSheetSrc, /['"]role['"],\s*['"]dialog['"]/);
  assert.match(switchSheetSrc, /['"]aria-modal['"],\s*['"]true['"]/);
  assert.match(switchSheetSrc, /setAttribute\(['"]inert['"]/);
});
test('switch-sheet 焦点陷阱 + Esc/Ctrl-C 关闭 + focus return', () => {
  assert.match(switchSheetSrc, /handleTabTrap/);
  assert.match(switchSheetSrc, /shouldCloseOnKey/);
  assert.match(switchSheetSrc, /lastFocused\.focus/);
});
// switch-sheet 模态 CSS 块已随 Task 9 删除(switch-sheet 功能随三页面收尾移除);
// switch_sheet.cjs JS 暂留,T13/T11 处理源码清理。CSS 锁测试随之移除。
test('陈旧折叠区 + stale-grid CSS 契约(card--single 已随 singleMachine 移除)', () => {
  assert.match(CONSOLE_SECTION, /\.board-stale-group\b/);
  assert.match(CONSOLE_SECTION, /\.board-stale-grid\b/);
  assert.match(CONSOLE_SECTION, /\.board-stale-group[\s\S]*?grid-column:\s*1\s*\/\s*-1/); // 折叠区占整行
});
test('fleet summary 提权(字体 ≥ .9em,原 .85em)', () => {
  assert.match(CONSOLE_SECTION, /\.fleet-summary\s*\{[^}]*font-size:\s*\.9/);
});
test('陈旧折叠 summary 有展开指示符 + 展开态旋转(对齐 ASCII ▼ 目标)', () => {
  assert.match(CONSOLE_SECTION, /\.board-stale-group\s*>\s*details\s*>\s*summary::before/);
  assert.match(CONSOLE_SECTION, /content:\s*['"]▶['"]/);
  assert.match(CONSOLE_SECTION, /\.board-stale-group\s*>\s*details\[open\]\s*>\s*summary::before[\s\S]*?rotate/);
});
test('陈旧折叠 summary 有 focus-visible 焦点环(WCAG 2.4.7)', () => {
  assert.match(CONSOLE_SECTION, /\.board-stale-group\s*>\s*details\s*>\s*summary:focus-visible/);
  assert.match(CONSOLE_SECTION, /\.board-stale-group\s*>\s*details\s*>\s*summary:focus-visible[\s\S]*?outline/);
});
test('三页面样式:存在 .machine-group / .fanout-bar / .card__select[aria-pressed] 规则', () => {
  assert.match(css, /\.machine-group\b/);
  assert.match(css, /\.machine-group--offline\b/);
  assert.match(css, /\.fanout-bar\b/);
  assert.match(css, /\.card__select\[aria-pressed="true"\]/);   // Task 9:Plan A button+a,aria-checked→aria-pressed
  assert.match(css, /\.card__select\b[^}]*min-height:\s*44/);   // 触摸目标 44px(WCAG 2.5.5)
  assert.match(css, /#ma-screen\s*\{[^}]*flex:\s*1/);           // 主控终端撑满
  assert.match(css, /#ma-screen\s*\{[^}]*max-height:\s*none/);  // 覆盖原 max-height:0,否则 flex:1 被锁死
  assert.match(css, /\.console-term\s*\{[^}]*flex:\s*1;\s*min-height:\s*0/);  // 三页面:单机模式 term 撑满剩余视口(Task 6 detectConsoleMode 同提交)
});

test('三页面显隐:[hidden] 兜底(display:flex 不盖过 UA [hidden],detectConsoleMode 切换才视觉生效) — T8 §4.1/§4.2', () => {
  // .console-hero/.console-term/.tab 的 display:flex 覆盖 UA [hidden]{display:none},
  // 须显式 [hidden]{display:none} 兜底,否则单机 hero 不隐 / 多机 term+⇄ 不隐(违反职责分离)
  assert.match(css, /#main-agent-panel\[hidden\][^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.console-term\[hidden\][^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.tab\[hidden\][^{]*\{[^}]*display:\s*none/);
  // P0-1:.fanout-bar{display:flex} 顶穿 UA [hidden](同款 commit 242c486 控制台 C1),看板遗漏;
  // 首次进看板(无选中)底部常驻「已选 0…」bar(2026-07-05 运行时坐实 offsetTop:535/可见)。
  assert.match(css, /\.fanout-bar\[hidden\][^{]*\{[^}]*display:\s*none/);
});
test('看板主内容区 .main flex:1 + min-height:0(多卡时不撑爆 #app 推走 tabbar) — T8 §4.0', () => {
  assert.match(css, /\.main\s*\{[^}]*flex:\s*1/);
  assert.match(css, /\.main\s*\{[^}]*min-height:\s*0/);
});
test('#app overflow:hidden 兜底(内容溢出不外溢视口) — T8 §4.0', () => {
  assert.match(css, /#app\s*\{[^}]*overflow:\s*hidden/);
});
test('.ma-btn 触摸目标 ≥44px(WCAG 2.5.5,主控 Start/Stop/镜像) — T8 §7', () => {
  assert.match(css, /\.ma-btn\s*\{[^}]*min-height:\s*44/);
});
test('.board-body 纯 list 重置(非 grid,避免外层网格把 machine-group 压成单格 → 卡片一列) — 三页面 §4.3①', () => {
  // #board-body 装的是 <li class="machine-group"> 分组容器,非卡片;若它自带 board-grid(display:grid),
  // 每个 machine-group 只占 1 格(~251px),组内 .board-grid inherits → minmax(220px) 仅 1 列(2026-07-05 实测)。
  assert.match(css, /\.board-body\s*\{[^}]*list-style:\s*none/);
});

// ============================================================
// P5:--offline token + 离线对比度(WCAG 1.4.3 AA)
// ============================================================
test('P5:tokens.css 存在 --offline token(与 --idle 拉开,用于离线状态)', () => {
  // 原 .s-dot--offline 退回 --fg-3,与 --idle 几乎不可分;机名用 --fg-3 仅 ~2:1 不达 4.5:1。
  // tokens.css 自己注释「fg-3 仅装饰禁承载阅读文字」。修:新增 --offline 独立 token。
  assert.match(tokens, /--offline:/);
});
test('P5:--offline 与 --idle 拉开(≥2 倍 alpha 差或色相差)', () => {
  // --idle: rgba(38,37,30,0.3) alpha 0.3
  // --offline 须与 --idle 在 alpha 或色相上明显区分,否则两个状态点视觉不可分。
  const idleMatch = tokens.match(/--idle:\s*rgba\(38,\s*37,\s*30,\s*(0\.\d+)\)/);
  assert.ok(idleMatch, '--idle 应为 rgba(38,37,30,0.x)');
  const idleAlpha = parseFloat(idleMatch[1]);
  // 提取 --offline 值
  const offlineMatch = tokens.match(/--offline:\s*([^;]+);/);
  assert.ok(offlineMatch, '--offline 应有值');
  const offlineVal = offlineMatch[1];
  // 若 --offline 也是 rgba(38,37,30,a),则 alpha 须 >= 2*idle 或 <= 0.5*idle,拉开层次
  const offlineAlphaMatch = offlineVal.match(/rgba\(38,\s*37,\s*30,\s*(0\.\d+)\)/);
  if (offlineAlphaMatch) {
    const offlineAlpha = parseFloat(offlineAlphaMatch[1]);
    assert.ok(
      offlineAlpha >= idleAlpha * 2 || offlineAlpha <= idleAlpha * 0.5,
      `--offline alpha ${offlineAlpha} 须与 --idle alpha ${idleAlpha} 拉开 ≥2 倍`
    );
  }
  // 若 --offline 用不同色相(如偏紫灰/偏蓝灰)也算通过(色相差路径),此处不强制。
});
test('P5:离线机名 .machine-group--offline .machine-group__name 不再用 --fg-3(达 4.5:1)', () => {
  // 原规则:color:var(--fg-3) → ~2:1 不达 WCAG AA 4.5:1。
  // 修:改用 --fg-2(达 ~5.4:1)或新 --offline(若该 token 达对比)。
  const rule = css.match(/\.machine-group--offline\s+\.machine-group__name\s*\{[^}]*\}/);
  assert.ok(rule, '离线机名规则应存在');
  assert.ok(
    !/var\(--fg-3\)/.test(rule[0]),
    '离线机名不应再用 --fg-3(对比度仅 ~2:1,不达 WCAG AA)'
  );
});
test('P5:.s-dot--offline 用 --offline token(非 --fg-3)', () => {
  // 原 background:var(--fg-3) 与 --idle 几乎不可分;改用 --offline 与 idle 拉开。
  const rule = css.match(/\.s-dot--offline\s*\{[^}]*\}/);
  assert.ok(rule, '.s-dot--offline 规则应存在');
  assert.match(rule[0], /var\(--offline\)/, '.s-dot--offline 应用 --offline token');
  assert.ok(!/var\(--fg-3\)/.test(rule[0]), '.s-dot--offline 不应再退回 --fg-3');
});

// ============================================================
// P6:批量补 :focus-visible(WCAG 2.4.7 AA)
// ============================================================
test('P6:机分组 summary(普通组)有 :focus-visible(原仅 stale-group 有)', () => {
  // .board-stale-group > details > summary:focus-visible 已存在;普通组 .machine-group > details > summary 漏。
  assert.match(
    css,
    /\.machine-group\s*>\s*details\s*>\s*summary:focus-visible[\s\S]*?outline/
  );
});
test('P6:.card__select(tabindex=0)有 :focus-visible', () => {
  assert.match(css, /\.card__select:focus-visible[\s\S]*?outline/);
});
test('P6:#term-input 有 :focus-visible', () => {
  assert.match(css, /#term-input:focus-visible[\s\S]*?outline/);
});
test('P6:.topbar-back 有 :focus-visible', () => {
  assert.match(css, /\.topbar-back:focus-visible[\s\S]*?outline/);
});
test('P6:.fanout-bar .term-input 焦点环改 :focus → :focus-visible(避免鼠标点击常驻)', () => {
  // 原 :focus 在鼠标点击后常驻,违反焦点可见性最佳实践;改 :focus-visible 仅键盘触发。
  assert.match(css, /\.fanout-bar\s+\.term-input:focus-visible[\s\S]*?outline/);
  // 旧 :focus 规则应被替换(不应残留 :focus,需区分 :focus-visible)
  assert.ok(
    !/\.fanout-bar\s+\.term-input:focus\s*\{/.test(css),
    '.fanout-bar .term-input 不应再用裸 :focus(改 :focus-visible)'
  );
});

// ============================================================
// P8:input 字号锁 16px(iOS Safari 防聚焦自动放大)
// ============================================================
test('P8:.fanout-bar .term-input 显式 font-size:16px(原 font:inherit 继承 14px)', () => {
  // iOS Safari <16px 聚焦自动放大整页,失焦不还原。修:显式 16px。
  const rule = css.match(/\.fanout-bar\s+\.term-input\s*\{[^}]*\}/);
  assert.ok(rule, '.fanout-bar .term-input 规则应存在');
  assert.match(rule[0], /font-size:\s*16px/, '.fanout-bar .term-input 应显式 font-size:16px');
});
test('P8:#term-input 显式 font-size:16px', () => {
  const rule = css.match(/#term-input\s*\{[^}]*\}/);
  assert.ok(rule, '#term-input 规则应存在');
  assert.match(rule[0], /font-size:\s*16px/, '#term-input 应显式 font-size:16px');
});
