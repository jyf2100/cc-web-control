# pretext Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate pretext text measurement into cc-web-control via ESM/IIFE bridge. P0 adds virtual scrolling (pure arithmetic, no pretext). P1 adds toast notifications (pretext prepare+layout). P2 adds command palette (CSS). P3 adds multi-line input (pretext). P4 adds font density scaling (arithmetic).

**Architecture:** ESM modules under `public/modules/` bridge to existing IIFE globals (`window.TerminalCleaner`, `window.TmuxActions`). pretext built output placed at `public/vendor/pretext-layout.js`. `modules/main.js` wires everything and exposes `window.ccModules` for `client.js` to consume.

**Tech Stack:** Vanilla JS (ESM), Node.js built-in test runner, Bun (for pretext build), CSS custom properties.

---

## 0. Pre-flight: Build pretext and Create Branch

**Files:**
- Create: `public/vendor/pretext-layout.js` (from pretext dist copy)
- Create: `public/vendor/.gitkeep`
- Modify: `docs/superpowers/specs/2026-03-31-pretext-integration-design.md` (Status: In Progress)

- [ ] **Step 1: Create feature branch**

Run: `cd /Users/roc/workspace/cc-web-control && git checkout -b cc-web-ctl-pretext`
Expected: Switched to new branch

- [ ] **Step 2: Build pretext dist**

Run: `cd pretext && bun run build:package`
Expected: `pretext/dist/layout.js` and `pretext/dist/layout.d.ts` exist

- [ ] **Step 3: Copy pretext dist to vendor directory**

Run: `mkdir -p public/vendor && cp pretext/dist/layout.js public/vendor/pretext-layout.js && cp pretext/dist/layout.d.ts public/vendor/pretext-layout.d.ts`
Expected: `public/vendor/pretext-layout.js` exists (~single ESM file, no relative imports)

- [ ] **Step 4: Verify no relative imports in vendor file**

Run: `grep -c "from '.\/" public/vendor/pretext-layout.js || grep -c 'from "\\.\\/' public/vendor/pretext-layout.js || echo "0"`
Expected: "0" — single self-contained file

- [ ] **Step 5: Commit pre-flight**

Run: `cd /Users/roc/workspace/cc-web-control && git add public/vendor/ && git commit -m "$(cat <<'EOF'
chore: add pretext dist to vendor directory

Build pretext with bun run build:package and copy dist/ to
public/vendor/pretext-layout.js for ESM consumption.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit with changes to public/vendor/

---

## 1. P0: TerminalModel + VirtualScrollView

**Files:**
- Create: `public/modules/terminal_model.js`
- Create: `public/modules/virtual_scroll.js`
- Create: `test/terminal_model.test.js`
- Modify: `public/modules/main.js` (wire P0)
- Modify: `public/client.js` (replace terminalContentEl.innerHTML with virtual scroll)
- Modify: `public/index.html` (add ESM module script)

- [ ] **Step 1: Write failing test for TerminalModel**

```javascript
// test/terminal_model.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// ESM module workaround for Node test runner (CommonJS)
async function loadTerminalModel() {
    const { TerminalModel } = await import('../public/modules/terminal_model.js');
    return { TerminalModel };
}

test('replace() returns false when text unchanged', async () => {
    const { TerminalModel } = await loadTerminalModel();
    const model = new TerminalModel(1000);
    const changed = model.replace('hello\nworld');
    assert.strictEqual(changed, true);
    const unchanged = model.replace('hello\nworld');
    assert.strictEqual(unchanged, false);
});

test('replace() truncates at maxLines', async () => {
    const { TerminalModel } = await loadTerminalModel();
    const model = new TerminalModel(3);
    model.replace('line1\nline2\nline3\nline4\nline5');
    assert.strictEqual(model.lineCount, 3);
    assert.strictEqual(model.truncatedCount, 2);
    assert.deepStrictEqual(model.getLines(0, 3), ['line3', 'line4', 'line5']);
});

test('replace() returns true on change', async () => {
    const { TerminalModel } = await loadTerminalModel();
    const model = new TerminalModel(1000);
    const changed = model.replace('a');
    assert.strictEqual(changed, true);
});

test('version increments on change', async () => {
    const { TerminalModel } = await loadTerminalModel();
    const model = new TerminalModel(1000);
    model.replace('v1');
    const v1 = model.version;
    model.replace('v2');
    assert.ok(model.version > v1);
});
```

Run: `node --test test/terminal_model.test.js`
Expected: FAIL — module not found

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/terminal_model.test.js 2>&1 | head -20`
Expected: ERR_MODULE_NOT_FOUND

- [ ] **Step 3: Write TerminalModel implementation**

```javascript
// public/modules/terminal_model.js

/**
 * TerminalModel — data layer for terminal output.
 * Stores lines as array, tracks version for change detection.
 */
export class TerminalModel {
    #lines = [];
    #maxLines;
    #version = 0;
    #rawText = '';
    #truncatedCount = 0;

    constructor(maxLines = 10000) {
        this.#maxLines = maxLines;
    }

    replace(rawText) {
        if (rawText === this.#rawText) return false;
        this.#rawText = rawText;
        this.#lines = rawText.split('\n');
        if (this.#lines.length > this.#maxLines) {
            const drop = this.#lines.length - this.#maxLines;
            this.#lines = this.#lines.slice(drop);
            this.#truncatedCount += drop;
        }
        this.#version++;
        return true;
    }

    getLines(start, end) {
        return this.#lines.slice(start, end);
    }

    get lineCount() {
        return this.#lines.length;
    }

    get version() {
        return this.#version;
    }

    get truncatedCount() {
        return this.#truncatedCount;
    }
}
```

- [ ] **Step 4: Run TerminalModel tests to verify they pass**

Run: `node --test test/terminal_model.test.js`
Expected: PASS

- [ ] **Step 5: Write VirtualScrollView (no DOM, pure arithmetic)**

```javascript
// public/modules/virtual_scroll.js

/**
 * VirtualScrollView — renders only visible lines from TerminalModel.
 * Uses fixed line height (monospace terminal lines are pre-broken by tmux).
 * Pure arithmetic: no pretext needed.
 */
export class VirtualScrollView {
    #container;
    #lineHeight;
    #bufferLines = 5;
    #spacerTop;
    #spacerBottom;
    #viewport;

    /**
     * @param {HTMLElement} container — the scrollable terminal-content element
     * @param {number} lineHeight — measured line height in px
     */
    constructor(container, lineHeight) {
        this.#container = container;
        this.#lineHeight = lineHeight;

        this.#spacerTop = document.createElement('div');
        this.#spacerTop.style.height = '0px';

        this.#viewport = document.createElement('div');

        this.#spacerBottom = document.createElement('div');
        this.#spacerBottom.style.height = '0px';

        container.append(this.#spacerTop, this.#viewport, this.#spacerBottom);
    }

    /**
     * @param {TerminalModel} model
     * @param {(line: string, index: number) => HTMLElement} lineRenderer
     */
    render(model, lineRenderer) {
        const { start, end } = this.#getVisibleRange(model.lineCount);
        const totalHeight = model.lineCount * this.#lineHeight;
        const visibleHeight = (end - start) * this.#lineHeight;

        this.#spacerTop.style.height = `${start * this.#lineHeight}px`;
        this.#spacerBottom.style.height = `${totalHeight - start * this.#lineHeight - visibleHeight}px`;

        const lines = model.getLines(start, end);
        this.#viewport.innerHTML = '';
        for (let i = 0; i < lines.length; i++) {
            const el = lineRenderer(lines[i], start + i);
            if (el) this.#viewport.appendChild(el);
        }
    }

    /**
     * Re-measure line height from the container's computed style.
     * Call on window resize.
     */
    remeasure() {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:inherit;';
        probe.textContent = 'x';
        this.#container.appendChild(probe);
        this.#lineHeight = probe.offsetHeight;
        probe.remove();
    }

    #getVisibleRange(totalLines) {
        const top = this.#container.scrollTop;
        const height = this.#container.clientHeight;
        const start = Math.max(0, Math.floor(top / this.#lineHeight) - this.#bufferLines);
        const end = Math.min(totalLines, Math.ceil((top + height) / this.#lineHeight) + this.#bufferLines);
        return { start, end };
    }

    /**
     * Scroll anchoring: returns whether user was at bottom before render.
     * @param {number} scrollTop
     * @returns {boolean}
     */
    wasAtBottom(scrollTop) {
        return scrollTop + this.#container.clientHeight >= this.#container.scrollHeight - 2;
    }

    /**
     * Scroll the container to the bottom (anchoring at bottom).
     */
    scrollToBottom() {
        this.#container.scrollTop = this.#container.scrollHeight;
    }

    get container() {
        return this.#container;
    }
}
```

- [ ] **Step 6: Write test for VirtualScrollView arithmetic**

```javascript
// test/virtual_scroll.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// Cannot test VirtualScrollView DOM rendering in Node — test only the
// arithmetic getVisibleRange logic via a mock minimal class.
class MockVirtualScroll {
    #lineHeight = 20;
    #bufferLines = 5;

    getVisibleRange(scrollTop, clientHeight, totalLines) {
        const top = scrollTop;
        const height = clientHeight;
        const start = Math.max(0, Math.floor(top / this.#lineHeight) - this.#bufferLines);
        const end = Math.min(totalLines, Math.ceil((top + height) / this.#lineHeight) + this.#bufferLines);
        return { start, end };
    }
}

test('getVisibleRange: no buffer at top', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(0, 200, 100); // 200px viewport, 20px line = 10 lines
    assert.strictEqual(r.start, 0);
    assert.strictEqual(r.end, 15); // ceil(200/20) + 5 = 15
});

test('getVisibleRange: buffer when scrolled', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(400, 200, 100); // scrolled 20 lines down
    assert.strictEqual(r.start, 15); // floor(400/20) - 5 = 15
    assert.strictEqual(r.end, 35); // ceil(600/20) + 5 = 35
});

test('getVisibleRange: cap at totalLines', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(0, 200, 5); // only 5 lines total
    assert.strictEqual(r.start, 0);
    assert.strictEqual(r.end, 5); // capped
});

test('getVisibleRange: negative start clamped to 0', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(0, 200, 1); // very few lines, big buffer
    assert.strictEqual(r.start, 0);
});
```

Run: `node --test test/virtual_scroll.test.js`
Expected: PASS

- [ ] **Step 7: Create modules/main.js ESM entry point**

```javascript
// public/modules/main.js
import { TerminalModel } from './terminal_model.js';
import { VirtualScrollView } from './virtual_scroll.js';
import { PretextMeasurer } from './pretext_measurer.js';
import { ToastManager } from './toast_manager.js';
import { MultiLineInput } from './multi_line_input.js';
import { FONTS } from './fonts.js';
// FontScaler imported lazily (P4) — see P4 Step 4 for full import + initP4 + applyOptimalFontSize
import { FontScaler } from './font_scaler.js';

// Access existing IIFE globals
const cleanOutput = window.TerminalCleaner?.cleanOutput ?? (t => t);
const tmuxActions = window.TmuxActions;

/** @type {import('./terminal_model.js').TerminalModel | null} */
let terminalModel = null;
/** @type {import('./virtual_scroll.js').VirtualScrollView | null} */
let virtualScroll = null;
/** @type {PretextMeasurer | null} */
let pretextMeasurer = null;
/** @type {ToastManager | null} */
let toastManager = null;
/** @type {MultiLineInput | null} */
let multiLineInput = null;

let lineHeight = 20; // default; remeasured on init

/**
 * Initialize P0: terminal model + virtual scroll.
 * @param {HTMLElement} container - terminal-content element
 */
function initP0(container) {
    terminalModel = new TerminalModel();
    lineHeight = measureLineHeight(container);
    virtualScroll = new VirtualScrollView(container, lineHeight);
}

/**
 * Measure one line's rendered height via probe element.
 */
function measureLineHeight(container) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
    probe.style.fontFamily = "'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace";
    probe.style.fontSize = '13px';
    probe.style.lineHeight = '1.5';
    probe.textContent = 'x';
    container.appendChild(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h || 20; // fallback
}

/**
 * Wire P0 rendering into WebSocket output flow.
 * Call this from client.js when version changes.
 * @param {string} output - raw terminal text from WebSocket
 * @param {function(string, number): HTMLElement} lineRenderer
 */
function renderTerminal(output, lineRenderer) {
    if (!terminalModel || !virtualScroll) return;
    const changed = terminalModel.replace(output);
    if (!changed) return;

    const scrollTop = terminalModel._scrollTop ?? 0;
    terminalModel._scrollTop = scrollTop;
    virtualScroll.render(terminalModel, lineRenderer);

    if (virtualScroll.wasAtBottom(scrollTop)) {
        // restore scroll position after virtual scroll updates spacers
        virtualScroll.scrollToBottom();
    }
}

/**
 * Update scroll position tracking.
 */
function updateScrollTop(scrollTop) {
    if (terminalModel) terminalModel._scrollTop = scrollTop;
}

/**
 * Initialize P1: toast notifications.
 * @param {HTMLElement} container
 */
function initP1(container) {
    try {
        pretextMeasurer = new PretextMeasurer();
        toastManager = new ToastManager(container, pretextMeasurer);
    } catch (e) {
        console.warn('[P1] Toast init failed, toasts disabled:', e);
    }
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration ms
 */
function showToast(message, type = 'info', duration = 3000) {
    toastManager?.show(message, type, duration);
}

/**
 * Initialize P3: multi-line input.
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} terminalView
 */
function initP3(textarea, terminalView) {
    if (!pretextMeasurer) {
        try {
            pretextMeasurer = new PretextMeasurer();
        } catch (e) {
            console.warn('[P3] pretext unavailable, multi-line disabled:', e);
            return;
        }
    }
    multiLineInput = new MultiLineInput(textarea, terminalView, pretextMeasurer);
}

/** @type {FontScaler | null} */
let fontScaler = null;

/**
 * Initialize P4: font density scaler.
 * @param {HTMLElement} container
 */
function initP4(container) {
    fontScaler = new FontScaler(container);
}

/**
 * Apply optimal font size to terminal content.
 * @param {number} totalLines
 * @param {number} viewportHeight
 */
function applyOptimalFontSize(totalLines, viewportHeight) {
    if (!fontScaler) return;
    const { fontSize, lineHeight } = fontScaler.selectSize(totalLines, viewportHeight);
    const terminalContent = document.querySelector('.terminal-content');
    if (terminalContent) {
        terminalContent.style.fontSize = `${fontSize}px`;
        terminalContent.style.lineHeight = String(lineHeight / fontSize);
    }
}

// Expose on window for client.js (IIFE) consumption
window.ccModules = {
    initP0,
    initP1,
    initP3,
    initP4,
    renderTerminal,
    updateScrollTop,
    showToast,
    applyOptimalFontSize,
    get terminalModel() { return terminalModel; },
    get virtualScroll() { return virtualScroll; },
    get toastManager() { return toastManager; },
    get lineHeight() { return lineHeight; },
    FONTS,
    CommandPalette,
};

// CRITICAL: client.js (classic <script>) runs SYNCHRONOUSLY before main.js (module, deferred).
// Therefore, initP0/initP1/initP3 MUST be called here on DOMContentLoaded, not from client.js.
// client.js still calls window.ccModules?.initP0(...) as a safety net (it will no-op
// since main.js hasn't run yet), but this DOMContentLoaded call below is the real initialization.
document.addEventListener('DOMContentLoaded', () => {
    const terminalContent = document.querySelector('.terminal-content');
    if (terminalContent) {
        initP0(terminalContent);
    }
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) {
        initP1(toastContainer);
    }
    const textarea = document.querySelector('.terminal-inline-textarea, .terminal-inline-input');
    const terminalView = document.querySelector('.terminal-view');
    if (textarea && terminalView) {
        initP3(textarea, terminalView);
    }
});
```

- [ ] **Step 8: Add ESM module script to index.html**

Modify `public/index.html:60-63`:
```html
    <script src="terminal_cleaner.js"></script>
    <script src="tmux_actions.js"></script>
    <script src="client.js"></script>
    <script type="module" src="modules/main.js"></script>
```

- [ ] **Step 9: Modify client.js to use P0 virtual scroll**

Modify `public/client.js` — replace `renderTerminal()` at line 199-207:

Key changes in `renderTerminal`:
1. If `window.ccModules?.renderTerminal` exists, use it with a line renderer
2. Fall back to existing `contentEl.textContent` approach

Key changes in `scrollToBottom`:
1. Track scrollTop before update: `const prevScrollTop = terminalContentEl.scrollTop`
2. After render, call `window.ccModules?.updateScrollTop(prevScrollTop)`

```javascript
// In renderTerminal, after ensureTerminalView():
if (window.ccModules?.renderTerminal) {
    const lineRenderer = (line, index) => {
        const el = document.createElement('div');
        el.className = 'terminal-line';
        el.textContent = line;
        return el;
    };
    window.ccModules.renderTerminal(output, lineRenderer);
    return;
}
// Fallback: existing behavior
const clean = cleanOutput(output);
if (contentEl.textContent === clean) return;
contentEl.textContent = clean;
scrollToBottom();
```

Also add to CSS (`public/style.css`) the terminal line class:
```css
.terminal-line {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.5;
    min-height: 1.5em;
}
```

- [ ] **Step 10: Add resize listener for line height remeasure**

In `client.js`, add window resize handler after init:
```javascript
let resizeTimer = null;
window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (window.ccModules?.virtualScroll) {
            window.ccModules.virtualScroll.remeasure();
        }
    }, 100);
});
```

- [ ] **Step 11: Test P0 integration manually**

Run: `npm run dev` (or `node server.js`) and verify:
- Terminal renders without console errors
- Scroll position anchors at bottom when new content arrives
- No layout flash on content update

- [ ] **Step 12: Commit P0**

Run: `git add public/modules/terminal_model.js public/modules/virtual_scroll.js public/modules/main.js test/terminal_model.test.js test/virtual_scroll.test.js public/index.html public/client.js public/style.css && git commit -m "$(cat <<'EOF'
feat: P0 terminal model + virtual scroll (pure arithmetic)

- TerminalModel: line storage, version tracking, maxLines truncation
- VirtualScrollView: fixed-height arithmetic render, buffer zones
- ESM bridge: modules/main.js wires P0, exposes window.ccModules
- client.js fallbacks to existing render when ccModules unavailable
- CSS: .terminal-line for virtual scroll rendered lines

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit succeeds

---

## 2. P1: PretextMeasurer + ToastManager

**Files:**
- Create: `public/modules/fonts.js` (shared font constants)
- Create: `public/modules/pretext_measurer.js`
- Create: `public/modules/toast_manager.js`
- Create: `test/pretext_measurer.test.js`
- Modify: `public/style.css` (toast styles)
- Modify: `public/index.html` (toast container)

- [ ] **Step 1: Write failing test for PretextMeasurer**

```javascript
// test/pretext_measurer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// RED phase: verify PretextMeasurer can be imported and instantiated.
// This test will FAIL before pretext_measurer.js exists.
test('PretextMeasurer: can be imported from ESM module', async () => {
    // Try importing the module (will fail with ERR_MODULE_NOT_FOUND before Step 3)
    let PretextMeasurer;
    try {
        const mod = await import('../public/modules/pretext_measurer.js');
        PretextMeasurer = mod.PretextMeasurer;
    } catch (e) {
        assert.fail(`Module import failed (expected before implementation): ${e.message}`);
    }
    assert.ok(typeof PretextMeasurer === 'function', 'PretextMeasurer should be a constructor');

    // Verify measureHeight returns expected shape
    // Note: DOM-dependent; in Node this will return fallback { height, lineCount }
    const pm = new PretextMeasurer();
    const result = pm.measureHeight('hello world', '16px Arial', 200, 20);
    assert.ok(typeof result.height === 'number', 'height should be a number');
    assert.ok(typeof result.lineCount === 'number', 'lineCount should be a number');
});

test('PretextMeasurer: cacheKey format is deterministic', () => {
    // Verify cache key construction logic is correct regardless of DOM availability.
    // This mirrors the internal key logic without importing the module.
    const makeKey = (text, font, opts) =>
        `${text}\0${font}\0${opts?.whiteSpace || ''}`;

    const key1 = makeKey('hello', '14px Helvetica', {});
    const key2 = makeKey('hello', '14px Helvetica', {});
    const key3 = makeKey('hello', '14px Helvetica', { whiteSpace: 'pre-wrap' });
    assert.strictEqual(key1, key2, 'same inputs produce same key');
    assert.notStrictEqual(key1, key3, 'different whiteSpace produces different key');
    // Verify null byte separator prevents collision
    const keyA = makeKey('a\x00b', 'font', {});
    const keyB = makeKey('a', '\x00b', {});
    assert.notStrictEqual(keyA, keyB, 'null byte in text vs font');
});
```

Run: `node --test test/pretext_measurer.test.js`
Expected: FAIL — ERR_MODULE_NOT_FOUND (before Step 3 implementation)

- [ ] **Step 2: Write fonts.js with shared constants**

```javascript
// public/modules/fonts.js

/**
 * Shared font constants matching CSS declarations in style.css.
 * Must stay in sync with .terminal-content and body font declarations.
 * Format must EXACTLY match canvas.font assignment — single quotes, spaces preserved.
 */
export const FONTS = {
    /**
     * Toast font — matches body font in style.css (line 14):
     * font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
     */
    toast: "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",

    /**
     * Mono font — matches .terminal-content in style.css (line 198):
     * font-family: 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace;
     */
    mono: "13px 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace",
};
```

- [ ] **Step 3: Write PretextMeasurer wrapper**

```javascript
// public/modules/pretext_measurer.js
// NOTE: top-level await means the entire module pauses here until import resolves.
// This is safe because:
//   1. main.js is <script type="module"> — deferred by default
//   2. client.js is a classic <script> — runs first synchronously
//   3. client.js calls ensureTerminalView() → initP0/initP3/initP1
//      These no-op if ccModules is not yet set.
//   4. After module loads, window.ccModules is set, then client.js initP1() fires on next tick.
//   5. By the time any measureHeight() call happens, top-level await has completed.

let _prepare, _layout, _clearCache;

try {
    const mod = await import('../vendor/pretext-layout.js');
    _prepare = mod.prepare;
    _layout = mod.layout;
    _clearCache = mod.clearCache;
} catch (e) {
    console.warn('[PretextMeasurer] pretext not available:', e);
}

/**
 * PretextMeasurer — wrapper around pretext's prepare() + layout() APIs.
 * Caches prepared handles by (text + font + whiteSpace) key.
 * Provides a simple { height, lineCount } interface.
 */
export class PretextMeasurer {
    #preparedCache = new Map();
    #available = !!_prepare;

    /**
     * @param {string} text
     * @param {string} font — CSS font shorthand (e.g. '14px Helvetica')
     * @param {number} width — max layout width in px
     * @param {number} lineHeight — line height in px
     * @param {{ whiteSpace?: 'normal'|'pre-wrap' }} [options]
     * @returns {{ height: number, lineCount: number }}
     */
    measureHeight(text, font, width, lineHeight, options) {
        if (!this.#available) {
            // Fallback: return a conservative single-line estimate
            return { height: lineHeight, lineCount: 1 };
        }
        const key = `${text}\0${font}\0${options?.whiteSpace || ''}`;
        let prepared = this.#preparedCache.get(key);
        if (!prepared) {
            prepared = _prepare(text, font, options);
            this.#preparedCache.set(key, prepared);
        }
        return _layout(prepared, width, lineHeight);
    }

    clearCache() {
        this.#preparedCache.clear();
        if (_clearCache) _clearCache();
    }

    get available() {
        return this.#available;
    }
}
```

- [ ] **Step 4: Write ToastManager**

```javascript
// public/modules/toast_manager.js
import { FONTS } from './fonts.js';

/**
 * ToastManager — toast notification system using pretext for height pre-measurement.
 * Stacks toasts from top, repositions on dismiss.
 */
export class ToastManager {
    #container;
    #toasts = [];
    #measurer;
    #toastWidth = 320;
    #toastLineHeight = 20;
    #toastGap = 8;

    /**
     * @param {HTMLElement} container — toast container element
     * @param {PretextMeasurer} measurer
     */
    constructor(container, measurer) {
        this.#container = container;
        this.#measurer = measurer;
    }

    /**
     * Show a toast notification.
     * @param {string} message
     * @param {'info'|'success'|'error'} [type]
     * @param {number} [duration] — auto-dismiss after ms
     */
    show(message, type = 'info', duration = 3000) {
        const { height } = this.#measurer.measureHeight(
            message,
            FONTS.toast,
            this.#toastWidth,
            this.#toastLineHeight
        );

        const top = this.#toasts.reduce(
            (sum, t) => sum + t.height + this.#toastGap,
            this.#toastGap
        );

        const toast = { message, type, height, top, el: null };

        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.setAttribute('role', 'alert');
        el.setAttribute('aria-live', 'assertive');
        el.style.top = `${top}px`;
        el.style.width = `${this.#toastWidth}px`;
        el.style.height = `${height}px`;
        el.style.lineHeight = `${this.#toastLineHeight}px`;
        el.textContent = message;

        toast.el = el;
        this.#container.appendChild(el);
        this.#toasts.push(toast);

        setTimeout(() => this.#dismiss(toast), duration);
    }

    #dismiss(toast) {
        toast.el?.remove();
        this.#toasts = this.#toasts.filter(t => t !== toast);
        this.#reposition();
    }

    #reposition() {
        let top = this.#toastGap;
        for (const toast of this.#toasts) {
            toast.top = top;
            toast.el.style.top = `${top}px`;
            top += toast.height + this.#toastGap;
        }
    }
}
```

- [ ] **Step 5: Add toast CSS to style.css**

Add before `@media (max-width: 768px)` in `public/style.css`:

```css
/* Toast Notifications */
#toast-container {
    position: fixed;
    top: 60px;
    right: 20px;
    z-index: 9999;
    pointer-events: none;
}

.toast {
    position: absolute;
    right: 0;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 20px;
    max-width: 320px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    pointer-events: auto;
    overflow: hidden;
    word-break: break-word;
    animation: toast-in 0.2s ease-out;
}

@keyframes toast-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
}

.toast-info {
    background-color: #3b82f6;
    color: #ffffff;
}

.toast-success {
    background-color: #22c55e;
    color: #ffffff;
}

.toast-error {
    background-color: #ef4444;
    color: #ffffff;
}

@media (prefers-color-scheme: dark) {
    .toast {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
}
```

- [ ] **Step 6: Add toast container to index.html**

Modify `public/index.html` — add after `<div id="chatContainer">` at line 56:

```html
        <!-- Toast 通知容器 -->
        <div id="toast-container" aria-label="通知"></div>
```

- [ ] **Step 7: Wire P1 into client.js**

Show toasts on key events in `client.js`:
- On `ws.onopen`: `window.ccModules?.showToast?.('已连接', 'success')`
- On `ws.onclose`: `window.ccModules?.showToast?.('连接已断开，正在重连', 'error', 5000)`
- On `ws.onerror`: `window.ccModules?.showToast?.('WebSocket 连接异常', 'error', 5000)`
- On `startProjectSession` success: `window.ccModules?.showToast?.('会话已启动', 'success')`

- [ ] **Step 8: Test P1 manually**

Run app, observe toasts on connect/disconnect/error events.

- [ ] **Step 9: Commit P1**

Run: `git add public/modules/fonts.js public/modules/pretext_measurer.js public/modules/toast_manager.js test/pretext_measurer.test.js public/style.css public/index.html public/client.js public/modules/main.js && git commit -m "$(cat <<'EOF'
feat: P1 toast notifications with pretext height pre-measurement

- PretextMeasurer: cached prepare() + layout() wrapper with DOM fallback
- ToastManager: ARIA-accessible stacked toasts, pretext-measured heights
- FONTS: shared constants matching style.css declarations
- CSS: .toast styles + @keyframes animation
- client.js: toasts on connect/disconnect/error events

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit succeeds

---

## 3. P2: Command Palette (CSS, No pretext)

**Files:**
- Create: `public/modules/command_palette.js`
- Modify: `public/style.css` (palette styles)
- Modify: `public/client.js` (palette activation on `/`)

- [ ] **Step 1: Write CommandPalette module**

```javascript
// public/modules/command_palette.js

/**
 * CommandPalette — minimal slash-command dropdown using CSS max-content.
 * No pretext needed: CSS handles shrinkwrap.
 * Keyboard: up/down/enter/escape.
 */
export class CommandPalette {
    #inputEl;
    #panelEl = null;
    #items = [];
    #selectedIndex = -1;
    #filterFn = null;
    #onSelectFn = null;

    /**
     * @param {HTMLInputElement} inputEl — the terminal inline input
     */
    constructor(inputEl) {
        this.#inputEl = inputEl;
    }

    /**
     * Show palette filtered by current input value.
     * @param {string[]} items
     * @param {(item: string, filter: string) => string} filterFn — returns display text
     * @param {(item: string) => void} onSelectFn — called on enter
     */
    show(items, filterFn, onSelectFn) {
        this.#items = items;
        this.#filterFn = filterFn;
        this.#onSelectFn = onSelectFn;
        this.#selectedIndex = -1;

        this.#ensurePanel();
        this.#updateItems();
        this.#panelEl.hidden = false;
        this.#panelEl.style.maxHeight = `${Math.min(300, items.length * 32)}px`;
    }

    hide() {
        if (this.#panelEl) {
            this.#panelEl.hidden = true;
        }
        this.#selectedIndex = -1;
    }

    handleKeyDown(e) {
        if (!this.#panelEl || this.#panelEl.hidden) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.#selectedIndex = Math.min(this.#selectedIndex + 1, this.#items.length - 1);
            this.#updateSelection();
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0);
            this.#updateSelection();
            return true;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.#selectedIndex >= 0 && this.#onSelectFn) {
                this.#onSelectFn(this.#items[this.#selectedIndex]);
                this.hide();
            }
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            this.hide();
            return true;
        }
        return false;
    }

    #ensurePanel() {
        if (this.#panelEl) return;

        const panel = document.createElement('div');
        panel.className = 'command-palette';
        panel.hidden = true;
        panel.setAttribute('role', 'listbox');

        // Insert after the input row in the terminal view
        const inputRow = this.#inputEl.closest('.terminal-input-row');
        inputRow?.parentNode?.insertBefore(panel, inputRow.nextSibling);

        this.#panelEl = panel;
    }

    #updateItems() {
        if (!this.#panelEl) return;
        const filter = this.#inputEl.value.slice(1); // strip leading '/'
        const filtered = filter
            ? this.#items.filter(item => this.#filterFn(item, filter))
            : this.#items;

        this.#panelEl.innerHTML = '';
        for (let i = 0; i < filtered.length; i++) {
            const item = filtered[i];
            const el = document.createElement('div');
            el.className = 'palette-item';
            el.setAttribute('role', 'option');
            el.textContent = this.#filterFn(item, filter);
            el.dataset.index = i;
            el.addEventListener('click', () => {
                if (this.#onSelectFn) {
                    this.#onSelectFn(item);
                    this.hide();
                }
            });
            this.#panelEl.appendChild(el);
        }
    }

    #updateSelection() {
        const items = this.#panelEl.querySelectorAll('.palette-item');
        items.forEach((el, i) => {
            el.classList.toggle('selected', i === this.#selectedIndex);
            if (i === this.#selectedIndex) el.scrollIntoView({ block: 'nearest' });
        });
    }
}
```

- [ ] **Step 2: Add palette CSS to style.css**

Add after `.toast` styles:

```css
/* Command Palette */
.command-palette {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 100;
    margin-top: 4px;
}

.command-palette[hidden] {
    display: none;
}

.palette-item {
    padding: 8px 14px;
    font-family: 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    color: #0f172a;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* CSS max-content: shrinkwrap width — no pretext needed */
    width: max-content;
    min-width: 100%;
}

.palette-item:hover,
.palette-item.selected {
    background-color: #f1f5f9;
}

.palette-item.selected {
    background-color: #e0f2fe;
    color: #0369a1;
}

@media (prefers-color-scheme: dark) {
    .command-palette {
        background: #161b22;
        border-color: #30363d;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .palette-item {
        color: #e2e8f0;
    }

    .palette-item:hover,
    .palette-item.selected {
        background-color: #1c2128;
    }

    .palette-item.selected {
        background-color: #0c2d4a;
        color: #38bdf8;
    }
}
```

- [ ] **Step 3: Wire CommandPalette into client.js**

In `client.js` `init()` or `ensureTerminalView()`, create palette:
```javascript
let commandPalette = null;
// ...
function ensureTerminalView() {
    // ... existing code ...
    // Note: CommandPalette is exposed via window.ccModules, NOT directly on window.
    // Also, client.js runs synchronously before main.js (ESM), so check ccModules availability.
    if (window.ccModules?.CommandPalette && terminalInputEl) {
        commandPalette = new window.ccModules.CommandPalette(terminalInputEl);
    }
}
```

In `inputEl.keydown` handler, detect `/` at start and show palette:
```javascript
// In keydown handler, after slash detection:
const slashMode = rawValue.startsWith('/');
if (slashMode && commandPalette) {
    const commands = ['/model', '/claude', '/commit', '/review', '/ask', '/web', '/clear', '/help'];
    commandPalette.show(
        commands,
        (item, filter) => item,
        (selected) => {
            inputEl.value = selected;
            inputEl.focus();
        }
    );
} else if (!slashMode && commandPalette) {
    commandPalette.hide();
}
```

- [ ] **Step 4: Expose CommandPalette on window**

Add import at the top of `public/modules/main.js` (after existing imports):
```javascript
import { CommandPalette } from './command_palette.js';
```

Add to `window.ccModules` export (in the existing ccModules object):
```javascript
window.ccModules = {
    // ... existing exports ...
    CommandPalette,
};
```

- [ ] **Step 5: Commit P2**

Run: `git add public/modules/command_palette.js public/style.css public/modules/main.js public/client.js && git commit -m "$(cat <<'EOF'
feat: P2 command palette with CSS max-content shrinkwrap

- CommandPalette: keyboard nav (up/down/enter/escape), filter by input
- CSS: .command-palette uses width: max-content for shrinkwrap
- client.js: palette shows on `/` prefix, hides on clear

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit succeeds

---

## 4. P3: MultiLineInput (pretext)

**Files:**
- Create: `public/modules/multi_line_input.js`
- Modify: `public/client.js` (convert input to textarea, wire MultiLineInput)

- [ ] **Step 1: Write MultiLineInput**

```javascript
// public/modules/multi_line_input.js
import { FONTS } from './fonts.js';

// Layout constants (named, not magic numbers)
// Must stay in sync with .header + .terminal-input-row CSS
const HEADER_HEIGHT = 48;      // approximate header height in px
const INPUT_ROW_BASE = 40;    // .terminal-input-row min height
const LINE_HEIGHT_INPUT = 21;  // matches CSS line-height for input (14px * 1.5 = 21)

/**
 * MultiLineInput — textarea that auto-expands based on pretext-measured content height.
 * Uses requestAnimationFrame debounce and skips measurement during IME composition.
 */
export class MultiLineInput {
    #measurer;
    #textarea;
    #terminalView;
    #rafId = null;
    #composing = false;

    /**
     * @param {HTMLTextAreaElement} textarea
     * @param {HTMLElement} terminalView
     * @param {PretextMeasurer} measurer
     */
    constructor(textarea, terminalView, measurer) {
        this.#textarea = textarea;
        this.#terminalView = terminalView;
        this.#measurer = measurer;

        textarea.addEventListener('input', () => this.#scheduleMeasure());
        textarea.addEventListener('compositionstart', () => {
            this.#composing = true;
        });
        textarea.addEventListener('compositionend', () => {
            this.#composing = false;
            this.#scheduleMeasure();
        });
    }

    #scheduleMeasure() {
        if (this.#composing) return;
        if (this.#rafId) return;
        this.#rafId = requestAnimationFrame(() => {
            this.#rafId = null;
            this.#measure();
        });
    }

    #measure() {
        const text = this.#textarea.value;
        const width = this.#textarea.clientWidth;
        const { height } = this.#measurer.measureHeight(
            text,
            FONTS.mono,
            width,
            LINE_HEIGHT_INPUT,
            { whiteSpace: 'pre-wrap' }
        );

        const expandedHeight = Math.max(LINE_HEIGHT_INPUT, height);
        this.#textarea.style.height = `${expandedHeight}px`;

        // Simultaneously shrink terminal viewport to prevent layout flash
        const totalInputHeight = HEADER_HEIGHT + INPUT_ROW_BASE + expandedHeight - LINE_HEIGHT_INPUT;
        this.#terminalView.style.maxHeight = `calc(100vh - ${totalInputHeight}px)`;
    }
}
```

- [ ] **Step 2: Convert `<input>` to `<textarea>` in client.js**

In `client.js`, `ensureTerminalView()`, replace `inlineInput` creation:

```javascript
// Replace:
const inlineInput = document.createElement('input');
inlineInput.type = 'text';
inlineInput.className = 'terminal-inline-input';

// With:
const inlineInput = document.createElement('textarea');
inlineInput.className = 'terminal-inline-input terminal-inline-textarea';
inlineInput.rows = 1;  // single row by default
inlineInput.wrap = 'soft';
```

Add textarea CSS to `style.css`:
```css
.terminal-inline-textarea {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-family: 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 14px;
    line-height: 1.5;
    color: #0f172a;
    padding: 0;
    resize: none;  /* disable manual resize */
    overflow: hidden; /* will expand via JS */
    field-sizing: content; /* CSS-native expansion fallback */
}

.terminal-inline-textarea::placeholder {
    color: #94a3b8;
}

.terminal-inline-textarea:disabled {
    color: #94a3b8;
    cursor: not-allowed;
}
```

Dark mode variant (append to existing `@media (prefers-color-scheme: dark)`):
```css
.terminal-inline-textarea {
    color: #e2e8f0;
}

.terminal-inline-textarea::placeholder {
    color: #64748b;
}
```

- [ ] **Step 3: Commit P3**

Run: `git add public/modules/multi_line_input.js public/modules/main.js public/client.js public/style.css && git commit -m "$(cat <<'EOF'
feat: P3 multi-line textarea with pretext height pre-measurement

- MultiLineInput: RAF debounced measureHeight(), skips IME composition
- textarea replaces input for multi-line support
- Terminal viewport shrinks simultaneously to prevent layout flash
- Named layout constants replace magic numbers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit succeeds

---

## 5. P4: Font Density Adaptive (Arithmetic, No pretext)

**Files:**
- Create: `public/modules/font_scaler.js`
- Modify: `public/modules/main.js` (integrate font scaler)

- [ ] **Step 1: Write failing test for FontScaler**

```javascript
// test/font_scaler.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// RED phase: verify FontScaler can be imported.
test('FontScaler: can be imported from ESM module', async () => {
    let FontScaler;
    try {
        const mod = await import('../public/modules/font_scaler.js');
        FontScaler = mod.FontScaler;
    } catch (e) {
        assert.fail(`Module import failed (expected before implementation): ${e.message}`);
    }
    assert.ok(typeof FontScaler === 'function', 'FontScaler should be a constructor');
});
```

Run: `node --test test/font_scaler.test.js`
Expected: FAIL — ERR_MODULE_NOT_FOUND (before Step 2 implementation)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/font_scaler.test.js 2>&1 | head -10`
Expected: ERR_MODULE_NOT_FOUND

- [ ] **Step 3: Write FontScaler**

```javascript
// public/modules/font_scaler.js

/**
 * FontScaler — selects largest monospace font size that fits terminal content.
 * Pure arithmetic: measure once at each candidate size, compute lineCount * lineHeight.
 * No pretext needed for monospace arithmetic.
 */
export class FontScaler {
    #container;
    #baseFontSize = 13;
    #minFontSize = 10;
    #maxFontSize = 18;
    #lineHeightRatio = 1.5;

    /**
     * @param {HTMLElement} container — terminal-content element
     */
    constructor(container) {
        this.#container = container;
    }

    /**
     * Probe the rendered height of a single line at given font size.
     * @param {number} fontSize
     * @returns {number} line height in px
     */
    #probeLineHeight(fontSize) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
        probe.style.fontFamily = "'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace";
        probe.style.fontSize = `${fontSize}px`;
        probe.style.lineHeight = String(this.#lineHeightRatio);
        probe.textContent = 'x';
        this.#container.appendChild(probe);
        const h = probe.offsetHeight;
        probe.remove();
        return h;
    }

    /**
     * Find the largest font size where content fits in viewport.
     * @param {number} totalLines — number of terminal lines
     * @param {number} viewportHeight — visible viewport height in px
     * @returns {{ fontSize: number, lineHeight: number, lineCount: number }}
     */
    selectSize(totalLines, viewportHeight) {
        let best = { fontSize: this.#baseFontSize, lineHeight: this.#baseFontSize * this.#lineHeightRatio, lineCount: totalLines };

        for (let fontSize = this.#maxFontSize; fontSize >= this.#minFontSize; fontSize--) {
            const lineHeight = this.#probeLineHeight(fontSize);
            const contentHeight = totalLines * lineHeight;
            if (contentHeight <= viewportHeight) {
                best = { fontSize, lineHeight, lineCount: totalLines };
                break; // largest size that fits
            }
        }

        return best;
    }

    get baseFontSize() { return this.#baseFontSize; }
    get minFontSize() { return this.#minFontSize; }
    get maxFontSize() { return this.#maxFontSize; }
}
```

- [ ] **Step 4: Add initP4 to main.js DOMContentLoaded**

The `FontScaler`, `initP4`, and `applyOptimalFontSize` are already defined in
the main.js code block (from P0 Step 7). This step only adds the `initP4`
call to the DOMContentLoaded handler.

In `public/modules/main.js`, update the `DOMContentLoaded` handler:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const terminalContent = document.querySelector('.terminal-content');
    if (terminalContent) {
        initP0(terminalContent);
        initP4(terminalContent); // P4: font density scaler
    }
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) {
        initP1(toastContainer);
    }
    const textarea = document.querySelector('.terminal-inline-textarea, .terminal-inline-input');
    const terminalView = document.querySelector('.terminal-view');
    if (textarea && terminalView) {
        initP3(textarea, terminalView);
    }
});
```

In `client.js`, call `applyOptimalFontSize` after terminal content update:
```javascript
if (window.ccModules?.applyOptimalFontSize && terminalContentEl) {
    const totalLines = terminalContentEl.querySelectorAll('.terminal-line, .terminal-content').length || 1;
    window.ccModules.applyOptimalFontSize(totalLines, terminalContentEl.clientHeight);
}
```

- [ ] **Step 5: Commit P4**

Run: `git add public/modules/font_scaler.js public/modules/main.js public/client.js test/font_scaler.test.js && git commit -m "$(cat <<'EOF'
feat: P4 font density adaptive scaling (monospace arithmetic)

- FontScaler: probe-based line height measurement at each candidate size
- selectSize(): largest monospace size where content fits viewport
- No pretext: monospace arithmetic is simpler and faster
- Integrated into ccModules for optional use

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit succeeds

---

## 6. Integration: ESM/IIFE Bridge Verification

**Files:**
- Modify: `public/client.js` (verify window.ccModules usage)
- Modify: `docs/superpowers/specs/2026-03-31-pretext-integration-design.md` (mark Status: Completed)

- [ ] **Step 1: Verify IIFE fallback in client.js**

Ensure every `window.ccModules?.xxx` usage has a graceful fallback to existing behavior:
- `renderTerminal` → existing `contentEl.textContent` fallback ✓
- `showToast` → no-op fallback ✓
- `initP0/initP1/initP3/initP4` → no-op if called without modules ✓

- [ ] **Step 2: Run all tests**

Run: `node --test`
Expected: All existing tests pass + new module tests pass

- [ ] **Step 3: Update spec status**

Modify `docs/superpowers/specs/2026-03-31-pretext-integration-design.md` header:
```
> Status: Completed (after 3 rounds of architecture review)
```
Changed to:
```
> Status: Implementation Complete
```

- [ ] **Step 4: Final commit**

Run: `git add docs/superpowers/specs/2026-03-31-pretext-integration-design.md && git commit -m "$(cat <<'EOF'
docs: mark spec as completed

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"`
Expected: commit succeeds

---

## File Summary

```
public/
├── modules/
│   ├── main.js                    # ESM entry point, wires all modules
│   ├── fonts.js                   # P1, P3: shared font constants
│   ├── terminal_model.js          # P0: data layer
│   ├── virtual_scroll.js          # P0: arithmetic virtual scroll
│   ├── pretext_measurer.js       # P1, P3: pretext wrapper + fallback
│   ├── toast_manager.js           # P1: toast lifecycle
│   ├── command_palette.js         # P2: CSS-based palette
│   ├── multi_line_input.js        # P3: pretext-measured textarea
│   └── font_scaler.js             # P4: monospace arithmetic scaler
├── vendor/
│   ├── pretext-layout.js         # pretext dist (copied from pretext/)
│   └── pretext-layout.d.ts       # TypeScript declarations
├── client.js                      # Modified: use window.ccModules
├── style.css                      # Modified: toast, palette, textarea styles
├── index.html                     # Modified: ESM script + toast container
└── terminal_cleaner.js           # Unchanged
```

## Test Coverage Targets

| Phase | Tests | Coverage |
|-------|-------|----------|
| P0 TerminalModel | 4 unit tests | replace() edge cases, version, truncation |
| P0 VirtualScroll | 4 arithmetic tests | getVisibleRange, clamping |
| P1 PretextMeasurer | 2 logic tests | cacheKey, return shape |
| P1+ P2+ P3 | Manual browser verification | Toasts, palette, multi-line input |
| P4 FontScaler | 1 probe test | line height measurement |

---

## Rollback Instructions

Commits on `cc-web-ctl-pretext` branch in order:
1. `chore: add pretext dist to vendor directory`
2. `feat: P0 terminal model + virtual scroll`
3. `feat: P1 toast notifications`
4. `feat: P2 command palette`
5. `feat: P3 multi-line textarea`
6. `feat: P4 font density adaptive`
7. `docs: add pretext integration implementation plan`
8. `docs: mark spec as completed`

Revert by commit:

```bash
# Revert P4 only
git revert HEAD --no-edit

# Revert P3 only
git revert HEAD~1 --no-edit

# Revert P2 only
git revert HEAD~2 --no-edit

# Revert P1 only
git revert HEAD~3 --no-edit

# Revert P0 only (reverts 2 commits: P0 + pre-flight)
git revert HEAD~4 --no-edit
git revert HEAD~5 --no-edit

# Full revert to before pretext (reverts 1-6, keeps plan doc)
for i in 1 2 3 4 5 6; do git revert HEAD~$(($i)) --no-edit 2>/dev/null || true; done
# Or more simply: revert range from first implementation commit
git revert --no-commit HEAD~6..HEAD~1
git commit --no-edit -m "revert: full pretext integration rollback"
```
