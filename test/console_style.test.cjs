const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');
const CONSOLE_SECTION = css.slice(css.indexOf('===== 多机控制台'));
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'console.html'), 'utf8');
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
test('终端色用局部 token --term-bg/--term-fg(非 #000)', () => {
  assert.match(CONSOLE_SECTION, /--term-bg:\s*#1a1815/);
  assert.match(CONSOLE_SECTION, /--term-fg:\s*#e8e6df/);
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
test('切换抽屉 trigger 44pt 触摸目标 + aria-haspopup', () => {
  assert.match(html, /id="switchTab"[^>]*aria-haspopup="dialog"/);
  assert.match(css, /\.tab\b[\s\S]*?min-height:\s*44/);  // 复用 .tab 44pt
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
test('switch-sheet 模态 CSS 在 dashboard.css(底部 fixed 抽屉 + backdrop 遮罩,非 static 挂下面) — 三页面 §4.2 P0', () => {
  // 三页面重构把 switch_sheet.cjs(JS)拉进控制台,但漏拉模态 CSS(原只在 style.css/index.html)→
  // 抽屉在控制台页 position:static 流式挂 body 末尾("挂在下面",2026-07-05 运行时坐实
  // sheetPosition:static / y:606 / 视口 646 / backdrop 也是 static 无遮罩)。
  // 修复:把 switch-sheet 模态 CSS 块从 style.css 迁入 dashboard.css(看板+控制台共用)。
  // backdrop:fixed inset:0 全屏遮罩 z-index:1000;sheet:fixed bottom:0 底部抽屉 z-index:1001 + sheetUp 动画。
  assert.match(css, /\.switch-sheet-backdrop\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*z-index:\s*1000/);
  assert.match(css, /\.switch-sheet\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*z-index:\s*1001/);
  assert.match(css, /@keyframes\s+sheetUp/);
  // 辅助元素一并迁移(handle/list/btn/meta/section-title/empty),否则抽屉内容裸样式
  assert.match(css, /\.switch-sheet-handle\s*\{/);
  assert.match(css, /\.switch-sheet-list\s*\{/);
  assert.match(css, /\.switch-sheet-btn\s*\{[^}]*min-height:\s*44/);
  assert.match(css, /\.switch-sheet-meta\s*\{/);
  assert.match(css, /\.switch-sheet-section-title\s*\{/);
  assert.match(css, /\.switch-sheet-projects-empty\s*\{/);
});
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
test('三页面样式:存在 .machine-group / .fanout-bar / .card__select[aria-checked] 规则', () => {
  assert.match(css, /\.machine-group\b/);
  assert.match(css, /\.machine-group--offline\b/);
  assert.match(css, /\.fanout-bar\b/);
  assert.match(css, /\.card__select\[aria-checked="true"\]/);
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
