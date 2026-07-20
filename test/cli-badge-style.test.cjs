'use strict';
// CLI 工具徽标样式:5 枚举色 token 齐全 + 两两可辨 + 组件色取自令牌(非魔法色值)。
// 对应 PRD 验收 #5(5 种枚举值各有可区分的颜色;颜色值从设计 token 取)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const TOKENS = fs.readFileSync('public/tokens.css', 'utf8');
const DASHBOARD_CSS = fs.readFileSync('public/dashboard.css', 'utf8');

const TOOLS = ['claude-code', 'grok-build', 'codex', 'cursor', 'unknown'];

test('tokens.css 定义 5 个 --cli-<tool> 徽标色 token', () => {
  for (const t of TOOLS) {
    assert.ok(new RegExp(`--cli-${t}:\\s*[^;]+;`).test(TOKENS), `缺 --cli-${t} token`);
  }
});

test('5 个徽标色 token 两两色值可辨(无重复)', () => {
  const vals = {};
  for (const t of TOOLS) {
    const m = TOKENS.match(new RegExp(`--cli-${t}:\\s*([^;]+);`));
    assert.ok(m, `--cli-${t} 未找到`);
    vals[t] = m[1].trim().toLowerCase();
  }
  const seen = new Set();
  for (const t of TOOLS) {
    assert.ok(!seen.has(vals[t]), `色值重复:${t} = ${vals[t]}`);
    seen.add(vals[t]);
  }
});

test('dashboard.css:每个 .cli-badge--<tool> 背景取自 var(--cli-<tool>) 令牌(非硬编码)', () => {
  // 验收 #5:颜色值从设计 token 取,不硬编码魔法色值
  for (const t of TOOLS) {
    const re = new RegExp(`\\.cli-badge--${t}\\s*\\{[^}]*background:\\s*var\\(--cli-${t}\\)`);
    assert.ok(re.test(DASHBOARD_CSS), `.cli-badge--${t} 应 background: var(--cli-${t})`);
  }
});

test('dashboard.css:.cli-badge 基类 + .cli-filter-bar + .cli-filter__chip 组件样式齐全', () => {
  assert.match(DASHBOARD_CSS, /\.cli-badge\s*\{/);
  assert.match(DASHBOARD_CSS, /\.cli-filter-bar\s*\{/);
  assert.match(DASHBOARD_CSS, /\.cli-filter__chip\s*\{/);
  assert.match(DASHBOARD_CSS, /\.cli-filter__chip--active\s*\{/);
});

test('徽标 token 为不透明实色(配白字可读,非 alpha 装饰)', () => {
  // 徽标承载短码文字,需不透明深底配白字达 AA;unknown 也用实色暖灰(非 --fg-3 那种 alpha 装饰)
  for (const t of TOOLS) {
    const m = TOKENS.match(new RegExp(`--cli-${t}:\\s*([^;]+);`));
    const v = m[1].trim();
    assert.ok(!/rgba?\([^)]*,\s*0\.\d+\)/.test(v), `--cli-${t} 不应为半透明 alpha(徽标承载文字): ${v}`);
    assert.ok(/^#/.test(v), `--cli-${t} 期望为 hex 实色(简洁可辨): ${v}`);
  }
});
