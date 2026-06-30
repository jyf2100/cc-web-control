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
