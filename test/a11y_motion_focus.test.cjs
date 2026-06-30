const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const style = fs.readFileSync('public/style.css', 'utf8');
const dash = fs.readFileSync('public/dashboard.css', 'utf8');

test('style.css 无裸 outline:none(基类)', () => {
    // 启发式:先剥 :focus 块内的 outline:none,再查裸 outline:none;最终以 8.4 grep + 人眼复核为准
    assert.ok(!/^[^{}]*\{[^}]*outline:\s*none/m.test(style.replace(/:focus[^{]*\{[^}]*outline:\s*none/g, '')));
});
test('style.css 含 :focus-visible', () => {
    assert.ok(style.includes(':focus-visible'));
});
test('reduced-motion 块含 animation:none(style.css)', () => {
    const m = style.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}/g) || [];
    const merged = m.join('\n');
    assert.ok(/animation:\s*none/.test(merged));
});
test('reduced-motion 覆盖 waiting 脉冲(dashboard.css)', () => {
    const m = dash.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}/g) || [];
    assert.ok(/s-dot--waiting[\s\S]*animation:\s*none/.test(m.join('\n')));
});
test('toast_manager.js 按 type 切 aria-live', () => {
    const tm = fs.readFileSync('public/modules/toast_manager.js', 'utf8');
    assert.ok(/type === 'error' \? 'alert' : 'status'/.test(tm));
    assert.ok(/type === 'error' \? 'assertive' : 'polite'/.test(tm));
});
test('live-dot-pulse 有 reduced-motion 降级(style.css)', () => {
    // spec §9 硬门:Task 7 引入的 live-dot-pulse(live-glow)必须有降级
    assert.ok(/prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.live-dot-pulse[\s\S]*?animation:\s*none/.test(style));
});
