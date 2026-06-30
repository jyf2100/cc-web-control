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
