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

test('client.js: updateSessionUi 同步 metaSession(getElementById) + live 点文本', () => {
    const js = readClient();
    assert.ok(js.includes("getElementById('metaSession')"));
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

// === Task 2: tab 样式 + 色彩收敛 + a11y + 断点清理 ===

test('style.css: .bottom-tabbar + .tab + .tab--active 顶部指示条(--accent-2)', () => {
    const css = readCss();
    assert.ok(/\.bottom-tabbar\s*\{/.test(css), '应有 .bottom-tabbar');
    assert.ok(/\.tab\s*\{[^}]*min-height:\s*44px/.test(css), '.tab 应 min-height 44px');
    assert.ok(/\.tab--active\s*\{[^}]*color:\s*var\(--accent-2\)/.test(css), '.tab--active 用 --accent-2');
    assert.ok(/\.tab--active::before\s*\{[^}]*background:\s*var\(--accent-2\)/.test(css),
        '.tab--active::before 指示条用 --accent-2(不整块染色)');
    assert.ok(/\.tab:focus-visible/.test(css), '.tab 应有 :focus-visible');
});

test('style.css: .bottom-tabbar.is-hidden 仅在 @media(≤768)内(>768 不隐藏)', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (max-width: 768px)');
    assert.ok(block, '存在 max-width:768px 块');
    assert.ok(/\.bottom-tabbar\.is-hidden\s*\{[^}]*display:\s*none/.test(block),
        '≤768 块内应有 .bottom-tabbar.is-hidden { display:none }');
    const base = css.replace(/@media[^{]*\{[\s\S]*?\}(?=\s*@media|\s*$)/g, '').replace(/@media[^{]*\{[\s\S]*?\}/g, '');
    assert.ok(!/\.bottom-tabbar\.is-hidden\s*\{\s*display:\s*none/.test(base),
        '基础区不应有无条件 .bottom-tabbar.is-hidden(否则桌面也隐藏)');
});

test('style.css: 断点清理(无 #desktopControls/.nav-link--login/#switchToggle 残留规则)', () => {
    const css = readCss();
    assert.ok(!/#desktopControls\s*\{/.test(css), '#desktopControls 规则应已删除');
    assert.ok(!/\.nav-link--login/.test(css), '.nav-link--login 规则应已删除');
    assert.ok(!/#switchToggle/.test(css), '#switchToggle 规则应已删除');
});

test('style.css: placeholder 用 --fg-2(非 fg-3,达 AA)', () => {
    const css = readCss();
    const inlinePh = css.match(/\.terminal-inline-input::placeholder\s*\{[^}]*\}/);
    const taPh = css.match(/\.terminal-inline-textarea::placeholder\s*\{[^}]*\}/);
    assert.ok(inlinePh && /var\(--fg-2\)/.test(inlinePh[0]), 'terminal-inline-input placeholder 应用 --fg-2');
    assert.ok(taPh && /var\(--fg-2\)/.test(taPh[0]), 'terminal-inline-textarea placeholder 应用 --fg-2');
    [inlinePh, taPh].forEach((m) => assert.ok(m && !/var\(--fg-3\)/.test(m[0]), 'placeholder 不应用 fg-3'));
});

test('style.css: .live-dot-text 去橙(不用 --accent/--accent-2,色彩收敛)', () => {
    const css = readCss();
    const block = css.match(/\.live-dot\s*\{[^}]*\}/);
    assert.ok(block, '应有 .live-dot 规则');
    assert.ok(!/color:\s*var\(--accent/.test(block[0]), '.live-dot 文字不应再用 --accent(收敛)');
    assert.ok(/color:\s*var\(--fg-2\)/.test(block[0]), '.live-dot 文字应用 --fg-2');
});

test('style.css: .console-card ≤1100 保留边框(只去 max-width/阴影,非硬切)', () => {
    const css = readCss();
    const block = extractMediaBlock(css, '@media (max-width: 1100px)');
    assert.ok(block, '存在 max-width:1100px 块');
    assert.ok(/\.console-card\s*\{[^}]*max-width:\s*100%/.test(block), '≤1100 console-card 贴边');
    assert.ok(!/border:\s*none/.test(block), '≤1100 块内不应有 border:none(保留边框)');
});

test('style.css: .visually-hidden 工具类', () => {
    const css = readCss();
    assert.ok(/\.visually-hidden\s*\{/.test(css), '应有 .visually-hidden');
    assert.ok(/clip:\s*rect/.test(css) || /clip-path:\s*polygon/.test(css), 'visually-hidden 应 clip 隐藏');
});

test('style.css: .btn 补 :focus-visible', () => {
    const css = readCss();
    assert.ok(/\.btn:focus-visible/.test(css), '.btn 应有 :focus-visible(焦点可见)');
});

test('style.css: toast-info/success 底色加深达 AA(深底白字 ≥4.5:1)', () => {
    const css = readCss();
    const info = css.match(/\.toast-info\s*\{[^}]*\}/)?.[0] || '';
    const succ = css.match(/\.toast-success\s*\{[^}]*\}/)?.[0] || '';
    assert.ok(info, '应有 .toast-info');
    assert.ok(succ, '应有 .toast-success');
    assert.ok(!/background-color:\s*var\(--waiting\)/.test(info), 'toast-info 不应再用 --waiting 浅底(对比不足)');
    assert.ok(!/background-color:\s*var\(--success\)/.test(succ), 'toast-success 不应再用 --success 浅底(对比不足)');
    assert.ok(/#[0-9a-fA-F]{3,6}/.test(info), 'toast-info 应改用加深的具体十六进制底色');
    assert.ok(/#[0-9a-fA-F]{3,6}/.test(succ), 'toast-success 应改用加深的具体十六进制底色');
});

// === Task 4: client.js 交互契约 ===

test('client.js: switchTab 装配(原 switchToggle)+ 抽屉 onOpen 刷新 + 传 meta', () => {
    const js = readClient();
    assert.ok(/getElementById\(\s*['"]switchTab['"]\s*\)/.test(js), '应 getElementById switchTab(原 switchToggle)');
    assert.ok(!/getElementById\(\s*['"]switchToggle['"]\s*\)/.test(js), 'switchToggle 引用应已改名');
    // onOpen 刷新:点击先 await loadSessions
    assert.ok(/switchTab[\s\S]*await\s+loadSessions\(\)/.test(js), '点击 switchTab 应先 await loadSessions(onOpen 刷新)');
    // 传 meta:buildMeta()(buildMeta 构造 {project,session})
    assert.ok(/meta\s*:\s*buildMeta\(\)/.test(js), 'createSwitchSheet 应传 meta: buildMeta()');
    assert.ok(/buildMeta[\s\S]*project[\s\S]*session/.test(js), 'buildMeta 应构造 {project,session}');
});

test('client.js: sessionStorage openSwitchSheet 跨页开抽屉(检测+removeItem)', () => {
    const js = readClient();
    assert.ok(/sessionStorage\.getItem\(\s*['"]openSwitchSheet['"]\s*\)/.test(js), '应检测 sessionStorage openSwitchSheet');
    assert.ok(/sessionStorage\.removeItem\(\s*['"]openSwitchSheet['"]\s*\)/.test(js), '检测后应立即 removeItem(防残留)');
});

test('client.js: ≤768 终端输入聚焦折叠 tab bar(focus 加 is-hidden / blur 移除)', () => {
    const js = readClient();
    assert.ok(/addEventListener\(\s*['"]focus['"][\s\S]*classList\.add\(\s*['"]is-hidden['"]\s*\)/.test(js),
        '终端 input focus 应给 .bottom-tabbar 加 is-hidden');
    assert.ok(/addEventListener\(\s*['"]blur['"][\s\S]*classList\.remove\(\s*['"]is-hidden['"]\s*\)/.test(js),
        '终端 input blur 应移除 is-hidden');
    assert.ok(/bottom-tabbar/.test(js), '应引用 .bottom-tabbar');
});

test('client.js: 终端 textarea 加 aria-label(命令输入)', () => {
    const js = readClient();
    assert.ok(/setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]命令输入['"]\s*\)/.test(js),
        'ensureTerminalView 应给 inlineInput textarea 加 aria-label="命令输入"');
});

test('client.js: updateSessionUi 不再写 metaProject DOM(元素已删)', () => {
    const js = readClient();
    assert.ok(!/getElementById\(\s*['"]metaProject['"]\s*\)/.test(js), 'updateSessionUi 不应再 getElementById metaProject(元素已删,project 入抽屉 meta)');
});

test('client.js: sheetHandle/rebuildSheet 提升到 init 作用域(跨页 IIFE 可见,防块作用域 ReferenceError)', () => {
    const js = readClient();
    const switchTriggerIdx = js.indexOf("getElementById('switchTab')");
    const sheetDecl = js.indexOf('let sheetHandle = null');
    const rebuildDecl = js.indexOf('let rebuildSheet = null');
    assert.ok(sheetDecl > -1, '应有 let sheetHandle = null 声明');
    assert.ok(rebuildDecl > -1, '应有 let rebuildSheet = null 声明');
    // 声明须在 switch 装配(switchTrigger)之前 = init 顶层作用域;若落回下方 if 块内(在 switchTrigger 之后)
    // 则块作用域隔离、bootstrap IIFE 不可见 → 跨页开抽屉时 ReferenceError
    assert.ok(sheetDecl < switchTriggerIdx, 'let sheetHandle 应在 switch 装配前(init 作用域,非 if 块内)');
    assert.ok(rebuildDecl < switchTriggerIdx, 'let rebuildSheet 应在 switch 装配前(init 作用域,非 if 块内)');
});
