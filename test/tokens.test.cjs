const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');

const P = 'public';
function grepCount(re) {
  try {
    const out = execSync(`grep -rlE '${re}' ${P}/ --include='*.css' --include='*.html' --include='*.js' | grep -v 'tokens.css' || true`, { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).length;
  } catch { return -1; }
}

test('无旧令牌引用(含 JS)', () => {
  assert.equal(grepCount('\\-\\-(brand|brand-strong|text|muted|font|surface2|r-lg)\\b'), 0);
});
test('tokens.css 无深色 media + color-scheme: light', () => {
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  assert.ok(!css.includes('prefers-color-scheme: dark'));
  assert.ok(css.includes('color-scheme: light'));
});
test('无琥珀硬编码 rgba(212,165,116)', () => {
  assert.equal(grepCount('212,\\s*165,\\s*116'), 0);
});
test('theme-color:HTML 双 meta(light/dark media 各一),manifest 深色默认 #121110', () => {
  // Modern Mission Control 重构:深色为默认主题。HTML 用 media 属性各写一份
  // theme-color(初始 hint),运行时由 theme.js 按 localStorage 'cc-theme' 同步内容。
  for (const f of ['index.html','dashboard.html','login.html']) {
    const h = fs.readFileSync(`${P}/${f}`,'utf8');
    assert.ok(h.includes('theme-color" content="#f2f1ed"'), f + ' 缺浅色 theme-color meta');
    assert.ok(h.includes('theme-color" content="#121110"'), f + ' 缺深色 theme-color meta');
    assert.ok(h.includes("localStorage.getItem('cc-theme')"), f + ' 缺 anti-FOUC 主题脚本');
  }
  const m = fs.readFileSync(`${P}/manifest.json`,'utf8');
  assert.ok(m.includes('"theme_color": "#121110"') && m.includes('"background_color": "#121110"'),
    'manifest 应同步深色默认 #121110');
});
test('关键新令牌齐全', () => {
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  for (const tok of ['--accent: #d9651a','--accent-2: #b54e0e','--waiting: #c08532','--fg-2: rgba(38,37,30,0.70)','--r-xs: 3px','--serif:','--surface-3:','--bg-2:']) {
    assert.ok(css.includes(tok), '缺令牌 ' + tok);
  }
});
test('client.js 无 var(--brand)/var(--brand-strong)', () => {
  const js = fs.readFileSync(`${P}/client.js`,'utf8');
  assert.ok(!/var\(--brand(-strong)?\b/.test(js));
});

test('login.html 结构:brand-mark + eyebrow + 成套输入属性 + 主/ghost 按钮 + POST 契约', () => {
  const html = fs.readFileSync(`${P}/login.html`, 'utf8');
  assert.ok(!/var\(--(brand|brand-strong|text|muted|font|r-lg)\b/.test(html), '残留旧令牌');
  assert.ok(!/rgba\(212,\s*165,\s*116/.test(html), '残留琥珀硬编码');
  assert.ok(html.includes('brand-mark brand-mark--lg'));
  assert.ok(html.includes('Roc-CC'));                 // brand mark 旁可见文本(可达性)
  assert.ok(html.includes('[ login ]'));
  assert.ok(/id="token"[^>]*autocomplete="off"/.test(html));
  assert.ok(/enterkeyhint="go"/.test(html));
  assert.ok(html.includes('class="btn-primary"'));
  assert.ok(html.includes('id="pasteBtn"') && html.includes('btn-ghost'));
  assert.ok(/<form[^>]*method="POST"[^>]*action="\/login"/.test(html));
  assert.ok(html.includes('id="next"') && html.includes('name="next"'));
  // .token-input 基类无裸 outline:none
  const base = html.match(/\.token-input\s*\{[^}]*\}/)[0];
  assert.ok(!/outline:\s*none/.test(base));
});

test('tokens.css 含 --shadow-card 卡片阴影令牌', () => {
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  assert.ok(css.includes('--shadow-card'), 'tokens.css 应定义 --shadow-card(控制台卡片容器用)');
});

// ============================================================
// P5:--offline token + 与 --idle 拉开(WCAG 1.4.3 AA 离线可辨)
// 迁自 console_style.test.cjs(Task 13 拆分)。仅锁 tokens.css 内的 token 定义与差距;
// 读 dashboard.css 的离线视觉规则(.machine-group--offline / .s-dot--offline)见
// dashboard_style.test.cjs(按"断言读哪个源文件就归哪个测试文件"的路由原则)。
// ============================================================
test('P5:tokens.css 存在 --offline token(与 --idle 拉开,用于离线状态)', () => {
  // 原 .s-dot--offline 退回 --fg-3,与 --idle 几乎不可分;机名用 --fg-3 仅 ~2:1 不达 4.5:1。
  // tokens.css 自己注释「fg-3 仅装饰禁承载阅读文字」。修:新增 --offline 独立 token。
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  assert.match(css, /--offline:/);
});
test('P5:--idle 对比度 ≥0.5(图形 3:1);offline/idle 区分改为形状(见 dashboard_style)', () => {
  // spec §8 决策11:idle/offline 区分机制从 alpha-ratio 改为 SHAPE
  //   idle   = 实心点(bg --idle)+ 1.5px --fg-2 描边环
  //   offline = 空心环(bg transparent + 1.5px --offline border,demo L84)
  // 故此处不再锁 offline≥2×idle alpha(旧 P5 alpha-invariant 已被 spec 显式 supersede);
  // 形状区分(实心 vs 空心)由 dashboard_style.test.cjs 的 .s-dot--offline 空心环断言锁定。
  // 此锁改为断言 token 级对比目标:--idle alpha ≥ 0.5(图形对比过 WCAG 3:1)+ --offline 存在。
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  const idleMatch = css.match(/--idle:\s*rgba\(38,\s*37,\s*30,\s*(0\.\d+)\)/);
  assert.ok(idleMatch, '--idle 应为 rgba(38,37,30,0.x)');
  const idleAlpha = parseFloat(idleMatch[1]);
  assert.ok(
    idleAlpha >= 0.5,
    `--idle alpha ${idleAlpha} 应 ≥ 0.5(spec §8 决策11,图形对比过 WCAG 3:1)`
  );
  assert.match(css, /--offline:/, '--offline token 应存在(offline 空心环 border 用)');
});
