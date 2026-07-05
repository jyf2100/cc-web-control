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
  // 注:.console-term flex:1 由 Task 6 加(与 detectConsoleMode 同提交),此处不断言
});
