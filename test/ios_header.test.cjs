const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const P = 'public';
const readHtml = () => fs.readFileSync(`${P}/index.html`, 'utf8');
const readCss = () => fs.readFileSync(`${P}/style.css`, 'utf8');
const readClient = () => fs.readFileSync(`${P}/client.js`, 'utf8');
const readMulti = () => fs.readFileSync(`${P}/modules/multi_line_input.js`, 'utf8');

test('index.html header: brand-row + brand-mark--sm + brand-name + brand-ver', () => {
    const h = readHtml();
    assert.ok(h.includes('class="brand-row"'));
    assert.ok(h.includes('class="brand-mark brand-mark--sm"'));
    assert.ok(h.includes('class="brand-name"'));
    assert.ok(h.includes('class="brand-ver"'));
});

test('index.html header: live-dot role=status + aria-live polite + pulse + text', () => {
    const h = readHtml();
    assert.ok(/id="liveIndicator"[^>]*class="live-dot"[^>]*role="status"[^>]*aria-live="polite"/.test(h)
        || /class="live-dot"[^>]*role="status"[^>]*aria-live="polite"/.test(h),
        'live-dot 需 role=status + aria-live polite');
    assert.ok(h.includes('class="live-dot-pulse"'));
    assert.ok(h.includes('class="live-dot-text"'));
});

test('index.html header: meta-bar role=group + labels + metaProject/metaSession + sep', () => {
    const h = readHtml();
    assert.ok(h.includes('class="meta-bar" role="group"'));
    assert.ok(h.includes('class="meta-label"'));
    assert.ok(h.includes('id="metaProject"'));
    assert.ok(h.includes('id="metaSession"'));
    assert.ok(h.includes('class="meta-sep"'));
});

test('index.html header: switchToggle aria-haspopup dialog + aria-expanded false + aria-controls switchSheet', () => {
    const h = readHtml();
    const m = h.match(/<button[^>]*id="switchToggle"[^>]*>/);
    assert.ok(m, 'switchToggle 按钮存在');
    const btn = m[0];
    assert.ok(btn.includes('aria-haspopup="dialog"'));
    assert.ok(btn.includes('aria-expanded="false"'));
    assert.ok(btn.includes('aria-controls="switchSheet"'));
});

test('index.html header: #switchSheet hidden 锚点存在', () => {
    const h = readHtml();
    assert.ok(h.includes('id="switchSheet"'));
    assert.ok(/<div id="switchSheet" hidden>/.test(h));
});

test('index.html header: desktopControls 含各 id(sessionSelect/refreshSessions/projectSelect/projectControl/projectsEmpty/startProject)', () => {
    const h = readHtml();
    assert.ok(h.includes('id="desktopControls"'));
    const start = h.indexOf('id="desktopControls"');
    const end = h.indexOf('</header>', start);
    assert.ok(end > start, 'desktopControls 在 header 内');
    const block = h.slice(start, end);
    for (const id of ['sessionSelect', 'refreshSessions', 'projectSelect', 'projectControl', 'projectsEmpty', 'startProject']) {
        assert.ok(block.includes(`id="${id}"`), `desktopControls 缺 id=${id}`);
    }
});

test('index.html header: 不含 connectionStatus(已删,状态改由 live 点承载)', () => {
    const h = readHtml();
    assert.ok(!h.includes('id="connectionStatus"'), 'connectionStatus 应已删除');
});

test('index.html welcome: eyebrow + eyebrow-id', () => {
    const h = readHtml();
    assert.ok(h.includes('class="eyebrow"'));
    assert.ok(h.includes('class="eyebrow-id"'));
    assert.ok(h.includes('[ ready ]'));
});

test('index.html toast-container: role=status + aria-live polite', () => {
    const h = readHtml();
    const m = h.match(/<div[^>]*id="toast-container"[^>]*>/);
    assert.ok(m, 'toast-container 存在');
    assert.ok(m[0].includes('role="status"'));
    assert.ok(m[0].includes('aria-live="polite"'));
});

test('style.css #app: 含 var(--vh-available, 100dvh)', () => {
    const css = readCss();
    assert.ok(css.includes('var(--vh-available, 100dvh)'));
});

// 提取一个 @media 块的完整内容(匹配括号到首个闭合)
function extractMediaBlock(css, mediaHead) {
    const start = css.indexOf(mediaHead);
    if (start < 0) return null;
    const braceOpen = css.indexOf('{', start);
    let depth = 0;
    let i = braceOpen;
    for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return css.slice(start, i);
}

test('style.css @media (max-width:768px) 块含 #desktopControls display:none', () => {
    const css = readCss();
    // 文件里可能有多处 @media (max-width: 768px)(含行内短块),取多行块(头后跟换行+缩进的那块)
    const head = '@media (max-width: 768px) {\n';
    const start = css.indexOf(head);
    assert.ok(start >= 0, '存在多行 max-width:768px 媒体查询块');
    const braceOpen = css.indexOf('{', start);
    let depth = 0, i = braceOpen;
    for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const block = css.slice(start, i);
    assert.ok(block.includes('#desktopControls'));
    assert.ok(/#desktopControls\s*\{[^}]*display:\s*none/.test(block), 'desktopControls 在窄屏应 display:none');
});

test('style.css @media (min-width:769px) 含 #switchToggle.swap-btn display:none', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (min-width: 769px)');
    assert.ok(block, '存在 min-width:769px 媒体查询');
    assert.ok(block.includes('#switchToggle.swap-btn'));
    assert.ok(/#switchToggle\.swap-btn\s*\{[^}]*display:\s*none/.test(block));
});

test('client.js: enterkeyhint + inputmode setAttribute', () => {
    const js = readClient();
    assert.ok(js.includes("setAttribute('enterkeyhint', 'send')"));
    assert.ok(js.includes("setAttribute('inputmode', 'text')"));
});

test('client.js: setupVisualViewport 函数定义(不含已删的 setupSwitchSheet 死代码)', () => {
    const js = readClient();
    assert.ok(/function\s+setupVisualViewport\s*\(/.test(js));
    assert.ok(!/function\s+setupSwitchSheet\s*\(/.test(js), 'setupSwitchSheet 死代码应已删除');
});

test('client.js: --vh-available setProperty + init 调用', () => {
    const js = readClient();
    assert.ok(js.includes("setProperty('--vh-available'"));
    // init 内调用顺序
    const idx = js.indexOf('setupVisualViewport();');
    assert.ok(idx > 0, 'setupVisualViewport() 被调用');
});

// switchToggle 静态 aria(HTML 保证初始态,运行时由 createSwitchSheet 更新)
test('index.html switchToggle: 静态 aria-haspopup/aria-expanded/aria-controls', () => {
    const html = readHtml();
    assert.ok(/id="switchToggle"[^>]*aria-haspopup="dialog"/.test(html), 'switchToggle 有 aria-haspopup=dialog');
    assert.ok(/id="switchToggle"[^>]*aria-expanded="false"/.test(html), 'switchToggle 有 aria-expanded=false');
    assert.ok(/id="switchToggle"[^>]*aria-controls="switchSheet"/.test(html), 'switchToggle 有 aria-controls=switchSheet');
});

test('client.js: updateSessionUi 同步 metaSession + metaProject(getElementById)', () => {
    const js = readClient();
    assert.ok(js.includes("getElementById('metaSession')"));
    assert.ok(js.includes("getElementById('metaProject')"));
    // live 点文本切换
    assert.ok(js.includes("'.live-dot-text'"));
    assert.ok(js.includes("'live'"));
});

test('client.js: focusInput rAF + scrollIntoView + prefersReducedMotion', () => {
    const js = readClient();
    assert.ok(/prefersReducedMotion\s*=/.test(js));
    assert.ok(js.includes('requestAnimationFrame('));
    assert.ok(js.includes("scrollIntoView({ block: 'end'"));
});

test('multi_line_input.js: 读 visualViewport 高度', () => {
    const js = readMulti();
    assert.ok(js.includes('window.visualViewport'), 'multi_line_input 应读 visualViewport');
    assert.ok(!/maxHeight\s*=\s*`calc\(100vh/.test(js), '不应再用 100vh');
});

test('client.js: cachedProjects 缓存 + switch_sheet 注入 projects/onLaunch', () => {
    const js = readClient();
    assert.ok(/let\s+cachedProjects\b/.test(js), '应有模块级 cachedProjects');
    assert.ok(js.includes('SwitchSheet.buildProjectItems'), 'rebuildSheet 应构建项目项');
    assert.ok(js.includes('projects: projectItems'), 'createSwitchSheet 应传入 projects');
    assert.ok(/onLaunch\s*:/.test(js), 'createSwitchSheet 应注入 onLaunch');
    // onLaunch 应写回 projectSelect.value 并复用 startProjectSession
    assert.ok(/onLaunch[\s\S]*projectSelect\.value\s*=/.test(js), 'onLaunch 应写回 projectSelect.value');
    assert.ok(/onLaunch[\s\S]*startProjectSession\(\)/.test(js), 'onLaunch 应复用 startProjectSession');
});
