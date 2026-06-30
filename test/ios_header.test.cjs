const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const P = 'public';
const readHtml = () => fs.readFileSync(`${P}/index.html`, 'utf8');
const readCss = () => fs.readFileSync(`${P}/style.css`, 'utf8');
const readClient = () => fs.readFileSync(`${P}/client.js`, 'utf8');
const readMulti = () => fs.readFileSync(`${P}/modules/multi_line_input.js`, 'utf8');

test('index.html header: brand 区 + brand-mark--sm + brand-name,无 brand-ver', () => {
    const h = readHtml();
    assert.ok(h.includes('class="brand"') || h.includes('class="header-left"'), 'header 有 brand 区');
    assert.ok(h.includes('class="brand-mark brand-mark--sm"'));
    assert.ok(h.includes('class="brand-name"'));
    assert.ok(!h.includes('class="brand-ver"'), 'brand-ver v2.4 应删除');
});

test('index.html header: live-dot role=status + aria-live polite + pulse + text', () => {
    const h = readHtml();
    assert.ok(/id="liveIndicator"[^>]*class="live-dot"[^>]*role="status"[^>]*aria-live="polite"/.test(h)
        || /class="live-dot"[^>]*role="status"[^>]*aria-live="polite"/.test(h),
        'live-dot 需 role=status + aria-live polite');
    assert.ok(h.includes('class="live-dot-pulse"'));
    assert.ok(h.includes('class="live-dot-text"'));
});

test('index.html header: project/session meta 元素齐全(metaProject/metaSession/meta-label/meta-sep)', () => {
    const h = readHtml();
    assert.ok(h.includes('id="metaProject"'));
    assert.ok(h.includes('id="metaSession"'));
    assert.ok(h.includes('class="meta-label"'));
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

test('style.css @media (max-width:1100px) 块含 #desktopControls display:none(中屏+移动折叠)', () => {
    const css = readCss();
    const head = '@media (max-width: 1100px) {\n';
    const start = css.indexOf(head);
    assert.ok(start >= 0, '存在多行 max-width:1100px 媒体查询块');
    const braceOpen = css.indexOf('{', start);
    let depth = 0, i = braceOpen;
    for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const block = css.slice(start, i);
    assert.ok(/#desktopControls\s*\{[^}]*display:\s*none/.test(block), '≤1100 时 desktopControls 应隐藏');
    assert.ok(/#switchToggle\.swap-btn\s*\{[^}]*display:\s*inline-flex/.test(block), '≤1100 时切换入口应显示');
});

test('style.css @media (min-width:1101px) 含 #switchToggle.swap-btn display:none(桌面控件外露)', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (min-width: 1101px)');
    assert.ok(block, '存在 min-width:1101px 媒体查询');
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

test('index.html: .console-card 卡片包裹 header + main', () => {
    const h = readHtml();
    assert.ok(h.includes('class="console-card"'), '应有 .console-card 包裹容器');
    const cardStart = h.indexOf('class="console-card"');
    const cardOpen = h.lastIndexOf('<div', cardStart);
    const headerIdx = h.indexOf('<header', cardStart);
    const mainIdx = h.indexOf('class="main"', cardStart);
    assert.ok(headerIdx > cardOpen, 'header 在 console-card 内');
    assert.ok(mainIdx > cardOpen, 'main 在 console-card 内');
});

test('index.html header: 单行结构 header-left + header-right', () => {
    const h = readHtml();
    assert.ok(h.includes('class="header-left"'));
    assert.ok(h.includes('class="header-right"'));
});

test('style.css: .console-card 限宽 1100 + 阴影 + 圆角', () => {
    const css = readCss();
    const block = css.match(/\.console-card\s*\{[^}]*\}/);
    assert.ok(block, '应有 .console-card 规则');
    assert.ok(/max-width:\s*1100px/.test(block[0]));
    assert.ok(/box-shadow:\s*var\(--shadow-card\)/.test(block[0]));
    assert.ok(/border-radius:\s*var\(--r\)/.test(block[0]));
});

test('style.css: header 单行 flex-direction row', () => {
    const css = readCss();
    const block = css.match(/\.header\s*\{[^}]*\}/);
    assert.ok(block && /flex-direction:\s*row/.test(block[0]), 'header 应为单行(row)');
});

test('style.css: .terminal-view 去外框(无 border,纳入卡片)', () => {
    const css = readCss();
    const block = css.match(/\.terminal-view\s*\{[^}]*\}/);
    assert.ok(block && /border:\s*none/.test(block[0]), 'terminal-view 应 border:none(卡片已有边框)');
});

test('style.css: welcome-message p 去 serif(用 sans)', () => {
    const css = readCss();
    const block = css.match(/\.welcome-message\s+p\s*\{[^}]*\}/);
    assert.ok(block && /font-family:\s*var\(--sans\)/.test(block[0]), 'welcome p 应用 sans(终端页字体收敛)');
    assert.ok(block && !/var\(--serif\)/.test(block[0]), 'welcome p 不应再用 serif');
});

test('style.css: switch-sheet 项目区分组 + 启动按钮样式', () => {
    const css = readCss();
    assert.ok(css.includes('.switch-sheet-projects'), '应有项目区容器样式');
    assert.ok(css.includes('.switch-sheet-section-title'), '应有分组标题样式');
    assert.ok(css.includes('.switch-sheet-btn--launch'), '应有启动按钮样式');
});

test('style.css: @media(768) 移动端登录收起(.nav .nav-link--login display:none,防 specificity 覆盖)', () => {
    const css = readCss();
    // .nav 前缀提 specificity:无前缀 .nav-link--login 在 source order 上早于
    // .nav-link 基础规则(同 specificity),会被后者 inline-flex 覆盖 → 登录入口在移动端不收起。
    // 此规则全文唯一一处(仅存在于 ≤768 收起语境),故全文直搜即可。
    assert.ok(/\.nav\s+\.nav-link--login\s*\{[^}]*display:\s*none/.test(css),
        '应有 .nav .nav-link--login { display:none }(带 .nav 前缀压过 .nav-link)');
});

test('style.css: 阅读文字 meta-label 不用 fg-3(WCAG AA)', () => {
    const css = readCss();
    const block = css.match(/\.meta-inline\s+\.meta-label\s*\{[^}]*\}/);
    assert.ok(block, '应有 .meta-inline .meta-label 规则');
    assert.ok(!/var\(--fg-3\)/.test(block[0]), 'meta-label 不应用 fg-3(禁承载阅读文字)');
    assert.ok(/var\(--fg-2\)/.test(block[0]), 'meta-label 应用 fg-2(达 AA)');
});

// === 底部 tab 重构契约(2026-06-30 spec)===

test('index.html header: 只有 header-left(无 header-right)', () => {
    const h = readHtml();
    assert.ok(h.includes('class="header-left"'), '应有 header-left');
    assert.ok(!h.includes('class="header-right"'), 'header-right 应已删除(控件入抽屉)');
});

test('index.html header: 极简 session meta 只含 s(无 metaProject/meta-sep)', () => {
    const h = readHtml();
    assert.ok(h.includes('id="metaSession"'), '极简 session 标识 metaSession 存在');
    assert.ok(h.includes('class="meta-label"'), 'meta-label 存在');
    assert.ok(!h.includes('id="metaProject"'), 'header 不应再有 metaProject(project 入抽屉)');
    assert.ok(!h.includes('class="meta-sep"'), 'header 不应再有 meta-sep(只剩 s)');
});

test('index.html: 无 #desktopControls / nav / #switchToggle / refreshSessions / 登录', () => {
    const h = readHtml();
    assert.ok(!h.includes('id="desktopControls"'), 'desktopControls 应已删除');
    assert.ok(!h.includes('class="nav"'), 'header nav 应已删除(导航下沉底部 tab)');
    assert.ok(!h.includes('id="switchToggle"'), 'switchToggle 应已删除(改 #switchTab)');
    assert.ok(!h.includes('id="refreshSessions"'), 'refreshSessions 应已删除(onOpen 刷新)');
    assert.ok(!/class="nav-link--login"/.test(h), '登录 nav-link 应已删除');
});

test('index.html: 隐藏 #stateCarriers 含原控件 id(不含 refreshSessions)', () => {
    const h = readHtml();
    const m = h.match(/<div id="stateCarriers" hidden>[\s\S]*?<\/div>/);
    assert.ok(m, '应有 <div id="stateCarriers" hidden>');
    const block = m[0];
    for (const id of ['sessionSelect', 'projectSelect', 'projectControl', 'projectsEmpty', 'startProject']) {
        assert.ok(block.includes(`id="${id}"`), `#stateCarriers 应含 id=${id}(client.js 守卫依赖)`);
    }
    assert.ok(!block.includes('id="refreshSessions"'), '#stateCarriers 不应含 refreshSessions(已删)');
});

test('index.html: 无 #switchSheet 空锚点(改由 switch_sheet.cjs 动态挂 id)', () => {
    const h = readHtml();
    assert.ok(!/<div id="switchSheet" hidden>/.test(h), '#switchSheet 空锚点应已删除');
    assert.ok(!/id="switchSheet"/.test(h), 'index.html 不应再有 switchSheet(switch_sheet.cjs 动态创建)');
});

test('index.html: <main> 内有 visually-hidden <h1>', () => {
    const h = readHtml();
    assert.ok(/<h1 class="visually-hidden">/.test(h), 'main 应有 visually-hidden h1(建立大纲)');
});

test('index.html: .bottom-tabbar 三项(控制台 active + 看板 + #switchTab button)', () => {
    const h = readHtml();
    assert.ok(h.includes('class="bottom-tabbar"'), '应有 .bottom-tabbar');
    assert.ok(/class="tab tab--active"[^>]*href="\/"[^>]*aria-current="page"/.test(h), '控制台 tab=active + aria-current');
    assert.ok(/class="tab"[^>]*href="\/dashboard\.html"/.test(h), '看板 tab');
    const m = h.match(/<button[^>]*id="switchTab"[^>]*>/);
    assert.ok(m, 'switchTab 按钮存在');
    assert.ok(m[0].includes('aria-haspopup="dialog"'), 'switchTab aria-haspopup=dialog');
    assert.ok(m[0].includes('aria-expanded="false"'), 'switchTab aria-expanded=false');
    assert.ok(m[0].includes('aria-controls="switchSheet"'), 'switchTab aria-controls=switchSheet');
});
