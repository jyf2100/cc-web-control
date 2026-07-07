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
test('theme-color/manifest 改浅色 #f2f1ed', () => {
  for (const f of ['index.html','dashboard.html','login.html']) {
    assert.ok(fs.readFileSync(`${P}/${f}`,'utf8').includes('theme-color" content="#f2f1ed"'));
  }
  const m = fs.readFileSync(`${P}/manifest.json`,'utf8');
  assert.ok(m.includes('"theme_color": "#f2f1ed"') && m.includes('"background_color": "#f2f1ed"'));
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
test('P5:--offline 与 --idle 拉开(≥2 倍 alpha 差或色相差)', () => {
  // --idle: rgba(38,37,30,0.3) alpha 0.3
  // --offline 须与 --idle 在 alpha 或色相上明显区分,否则两个状态点视觉不可分。
  const css = fs.readFileSync(`${P}/tokens.css`, 'utf8');
  const idleMatch = css.match(/--idle:\s*rgba\(38,\s*37,\s*30,\s*(0\.\d+)\)/);
  assert.ok(idleMatch, '--idle 应为 rgba(38,37,30,0.x)');
  const idleAlpha = parseFloat(idleMatch[1]);
  // 提取 --offline 值
  const offlineMatch = css.match(/--offline:\s*([^;]+);/);
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
