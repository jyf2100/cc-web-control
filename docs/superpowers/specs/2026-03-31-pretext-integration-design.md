# Design: pretext Integration into cc-web-control

> Date: 2026-03-31
> Branch: cc-web-ctl-pretext
> Status: Implementation Complete
> Motivation: Practice pretext text measurement/layout technology in a real project

---

## 1. Background

cc-web-control is a web-based tmux remote control tool for Claude Code. The frontend renders terminal output as a `<pre>` element with monospace font, updated via WebSocket every 100ms.

`@chenglou/pretext` is a text measurement and layout library that can measure paragraph height without DOM reflow, handle CJK/emoji/bidi text, and compute shrinkwrap widths.

Three rounds of architecture review established that pretext is **unsuitable for terminal rendering** (pre-broken lines, whitespace normalization destroys formatting, segments don't match ANSI boundaries) but **well-suited for proportional-font UI features**.

---

## 2. Three Approaches Considered

### Approach A: Minimal Integration
- Virtual scrolling with pretext measurement
- Scope: `prepare()` + `layout()` only
- Risk: pretext unnecessary for fixed-height monospace lines

### Approach B: Moderate Integration (CHOSEN)
- Virtual scrolling (no pretext) + Toast notifications + Multi-line input
- pretext APIs: `prepare`, `layout`, `clearCache` (P1, P3 only)
- Scope: P0 virtual scroll + P1 toast + P2 CSS palette + P3 multi-line input + P4 arithmetic font scale
- Note: `prepareWithSegments`, `walkLineRanges`, `layoutWithLines` reserved for Approach C upgrade

### Approach C: Deep Integration (FUTURE)
- Canvas/SVG terminal renderer, custom text shaping
- pretext APIs: all APIs including `layoutNextLine()`, `layoutWithLines()`
- Upgrade path from B without breaking interfaces

---

## 3. Architecture

```
TerminalModel (data layer, P0)
  └── VirtualScrollView (pure arithmetic, P0)

PretextMeasurer (pretext wrapper)
  ├── ToastManager (P1: prepare + layout)
  └── MultiLineInput (P3: prepare + layout per keystroke)

CommandPalette (P2: CSS max-content, no pretext)
FontScaler (P4: monospace arithmetic, no pretext)
```

### Data Flow

```
WS onmessage(output)
  → terminalModel.replace(output)
  → if version changed:
      → virtualScroll.render(model)           // P0: arithmetic

User types in input:
  → multiLineInput.scheduleMeasure()          // P3: pretext measured

System event (connect/disconnect/error):
  → toastManager.show(message, type)          // P1: pretext measured

User types "/" in input:
  → commandPalette.show(filter)               // P2: CSS max-content
```

### Module Integration (ESM/IIFE Bridge)

Existing code is IIFE scripts (`terminal_cleaner.js`, `tmux_actions.js`). New modules use ESM (`export`/`import`). Bridge pattern:

**index.html (modified):**
```html
<!-- Existing IIFE scripts (load first, synchronous) -->
<script src="terminal_cleaner.js"></script>
<script src="tmux_actions.js"></script>

<!-- New ESM module entry point (deferred, runs after DOM ready) -->
<script type="module" src="modules/main.js"></script>
```

**modules/main.js (new entry point):**
```javascript
import { TerminalModel } from './terminal_model.js';
import { VirtualScrollView } from './virtual_scroll.js';
import { PretextMeasurer } from './pretext_measurer.js';
import { ToastManager } from './toast_manager.js';
import { MultiLineInput } from './multi_line_input.js';

// Access existing IIFE globals
const cleanOutput = window.TerminalCleaner?.cleanOutput ?? (t => t);
const tmuxActions = window.TmuxActions;

// Wire modules together and expose on window for client.js compatibility
window.ccModules = {
  terminalModel: new TerminalModel(),
  toastManager: new ToastManager(document.getElementById('toast-container'), new PretextMeasurer()),
};
```

**client.js (modified):** Check for `window.ccModules` availability, fall back to current behavior if not present.

---

## 4. Phased Implementation

### P0: TerminalModel + Virtual Scroll (No Pretext)

**Files:**
- `public/modules/terminal_model.js` — line storage, version tracking
- `public/modules/virtual_scroll.js` — fixed-height virtual scroll

**TerminalModel:**
```javascript
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

  getLines(start, end) { return this.#lines.slice(start, end); }
  get lineCount() { return this.#lines.length; }
  get version() { return this.#version; }
  get truncatedCount() { return this.#truncatedCount; }
}
```

**VirtualScrollView:**
```javascript
export class VirtualScrollView {
  #container;
  #lineHeight;
  #bufferLines = 5;
  #spacerTop;
  #spacerBottom;
  #viewport;

  constructor(container, lineHeight) {
    this.#container = container;
    this.#lineHeight = lineHeight;

    // Create DOM structure: top-spacer + viewport + bottom-spacer
    this.#spacerTop = document.createElement('div');
    this.#viewport = document.createElement('div');
    this.#spacerBottom = document.createElement('div');
    container.append(this.#spacerTop, this.#viewport, this.#spacerBottom);
  }

  #getVisibleRange(totalLines) {
    const top = this.#container.scrollTop;
    const height = this.#container.clientHeight;
    const start = Math.max(0, Math.floor(top / this.#lineHeight) - this.#bufferLines);
    const end = Math.min(totalLines, Math.ceil((top + height) / this.#lineHeight) + this.#bufferLines);
    return { start, end };
  }

  render(model, lineRenderer) {
    const { start, end } = this.#getVisibleRange(model.lineCount);
    const totalHeight = model.lineCount * this.#lineHeight;
    const visibleHeight = (end - start) * this.#lineHeight;

    this.#spacerTop.style.height = `${start * this.#lineHeight}px`;
    this.#spacerBottom.style.height = `${totalHeight - start * this.#lineHeight - visibleHeight}px`;

    // Render only visible lines
    const lines = model.getLines(start, end);
    this.#viewport.innerHTML = '';
    for (let i = 0; i < lines.length; i++) {
      const el = lineRenderer(lines[i], start + i);
      if (el) this.#viewport.appendChild(el);
    }
  }
}
```

**Scroll anchoring:**
```javascript
const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
// ... render new content ...
if (wasAtBottom) container.scrollTop = container.scrollHeight;
// else: scrollTop stays, content shifts naturally
```

**Line height measurement:** Create a probe `<div>` with one line of text, measure `offsetHeight` once, destroy probe. Re-measure on window resize.

---

### P1: Toast Notification System (Pretext)

**Files:**
- `public/modules/pretext_measurer.js` — pretext wrapper
- `public/modules/toast_manager.js` — toast lifecycle

**PretextMeasurer wrapper:**
```javascript
import { prepare, layout, clearCache } from '../vendor/pretext-layout.js';

export class PretextMeasurer {
  #preparedCache = new Map();

  measureHeight(text, font, width, lineHeight, options) {
    const cacheKey = `${text}\0${font}\0${options?.whiteSpace || ''}`;
    let prepared = this.#preparedCache.get(cacheKey);
    if (!prepared) {
      prepared = prepare(text, font, options);
      this.#preparedCache.set(cacheKey, prepared);
    }
    return layout(prepared, width, lineHeight);
  }

  clearCache() {
    this.#preparedCache.clear();
    clearCache();
  }
}
```

**Shared font constants:**
```javascript
// Must match CSS declarations in style.css exactly
export const FONTS = {
  toast: '14px "Helvetica Neue", Helvetica, Arial, sans-serif',  // matches body font
  mono: '13px "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace',  // matches .terminal-content
};
```

**ToastManager:**
```javascript
import { FONTS } from './fonts.js';

export class ToastManager {
  #container;
  #toasts = [];
  #measurer;
  #toastWidth = 320;
  #toastLineHeight = 20;
  #toastGap = 8;

  constructor(container, measurer) {
    this.#container = container;
    this.#measurer = measurer;
  }

  show(message, type = 'info', duration = 3000) {
    const { height } = this.#measurer.measureHeight(
      message, FONTS.toast, this.#toastWidth, this.#toastLineHeight
    );

    const top = this.#toasts.reduce((sum, t) => sum + t.height + this.#toastGap, this.#toastGap);
    const toast = { message, type, height, top, el: null };

    toast.el = document.createElement('div');
    toast.el.className = `toast toast-${type}`;
    toast.el.setAttribute('role', 'alert');
    toast.el.setAttribute('aria-live', 'assertive');
    toast.el.style.top = `${top}px`;
    toast.el.style.width = `${this.#toastWidth}px`;
    toast.el.textContent = message;

    this.#container.appendChild(toast.el);
    this.#toasts.push(toast);

    setTimeout(() => this.#dismiss(toast), duration);
  }

  #dismiss(toast) {
    toast.el.remove();
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

**Key decisions:**
- Font constants shared across modules, match CSS exactly
- Toasts use `role="alert"` + `aria-live="assertive"` for accessibility
- Prepared handles cached by text+font for reuse
- Toasts auto-dismiss after configurable duration
- Graceful fallback: if pretext fails to load, use single-reflow DOM measurement

---

### P2: Command Palette (CSS, No Pretext)

**Files:**
- `public/modules/command_palette.js`

**Implementation:**
- CSS `max-content` + `white-space: nowrap` for shrinkwrap width
- Standard DOM measurement for panel height
- Keyboard navigation (up/down/enter/escape)
- Text filtering on input

---

### P3: Multi-Line Input (Pretext)

**Files:**
- `public/modules/multi_line_input.js`

**Implementation:**
```javascript
import { FONTS } from './fonts.js';

// Layout constants (named, not magic numbers)
const HEADER_HEIGHT = 48;       // .header padding + height
const INPUT_ROW_BASE = 40;     // .terminal-input-row base height
const LINE_HEIGHT_INPUT = 21;  // matches CSS line-height for input

export class MultiLineInput {
  #measurer;
  #textarea;
  #terminalView;
  #rafId = null;
  #composing = false;

  constructor(textarea, terminalView, measurer) {
    this.#textarea = textarea;
    this.#terminalView = terminalView;
    this.#measurer = measurer;

    textarea.addEventListener('input', () => this.#scheduleMeasure());
    textarea.addEventListener('compositionstart', () => { this.#composing = true; });
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
      text, FONTS.mono, width, LINE_HEIGHT_INPUT, { whiteSpace: 'pre-wrap' }
    );

    const expandedHeight = Math.max(LINE_HEIGHT_INPUT, height);
    this.#textarea.style.height = `${expandedHeight}px`;
    this.#terminalView.style.maxHeight = `calc(100vh - ${HEADER_HEIGHT + INPUT_ROW_BASE + expandedHeight - LINE_HEIGHT_INPUT}px)`;
  }
}
```

**Key decisions:**
- Named layout constants replace magic numbers
- Shared font constant matches CSS `.terminal-content` declaration
- `requestAnimationFrame` debounce: one measurement per frame max
- Skip measurement during IME composition
- `{ whiteSpace: 'pre-wrap' }` passed to pretext for textarea behavior
- Terminal viewport shrinks simultaneously to prevent layout flash

---

### P4: Font Density Adaptive (Arithmetic, No Pretext)

**Implementation:**
- Measure line height at each candidate font size once via probe element
- Compute `lineCount * lineHeight` arithmetically
- Select largest font size where content fits in viewport
- Re-measure only when output content changes significantly

---

## 5. File Structure

```
public/
├── modules/
│   ├── main.js                # ESM entry point, wires all modules
│   ├── fonts.js               # Shared font constants matching CSS
│   ├── terminal_model.js      # P0
│   ├── virtual_scroll.js      # P0
│   ├── pretext_measurer.js    # P1, P3
│   ├── toast_manager.js       # P1
│   ├── command_palette.js     # P2 (no pretext)
│   └── multi_line_input.js    # P3
├── vendor/
│   └── pretext-layout.js      # pretext build output (ESM)
├── client.js                  # Modified: use window.ccModules
├── style.css                  # Modified: toast, palette, multi-line styles
├── terminal_cleaner.js        # Unchanged
├── tmux_actions.js            # Unchanged
└── index.html                 # Modified: add <script type="module">
```

---

## 7. Test Plan

### P0: TerminalModel + VirtualScrollView

| Test Case | Verification |
|-----------|-------------|
| `replace()` with same text returns false | No version increment, no re-render |
| `replace()` truncates at maxLines | `truncatedCount` accurate, `lineCount <= maxLines` |
| Virtual scroll visible range | Correct start/end for given scrollTop |
| Scroll anchoring at bottom | Auto-scrolls on new content |
| Scroll anchoring mid-scroll | Position preserved on new content |
| Line height probe | Matches actual rendered height |

### P1: PretextMeasurer + ToastManager

| Test Case | Verification |
|-----------|-------------|
| `measureHeight()` returns correct height | Matches DOM measurement within 1px |
| Prepared cache hit | Second call with same text skips `prepare()` |
| Toast stack positioning | Each toast at correct `top` offset |
| Toast auto-dismiss | Element removed after duration |
| Accessibility | `role="alert"` and `aria-live` present |
| Fallback without pretext | DOM measurement used instead |

### P2: CommandPalette

| Test Case | Verification |
|-----------|-------------|
| Filter by input text | Only matching commands shown |
| Keyboard navigation | Up/down/enter/escape work |
| CSS max-content width | Panel shrinks to fit content |

### P3: MultiLineInput

| Test Case | Verification |
|-----------|-------------|
| Single line stays single height | No expansion for short text |
| Long text expands textarea | Height matches pretext measurement |
| Terminal viewport shrinks | Combined height stays within viewport |
| IME composition skipped | No measurement during composition |
| RAF debounce | One measurement per frame max |

---

## 6. pretext API Coverage

| API | Usage | Phase |
|-----|-------|-------|
| `prepare(text, font, options)` | Pre-measure text for height | P1, P3 |
| `layout(prepared, width, lineHeight)` | Compute wrapped height | P1, P3 |
| `clearCache()` | Release internal caches | P1, P3 |

---

## 7. Infrastructure Prerequisites

1. **Build pretext dist:** `cd pretext && bun run build:package`
2. **Copy to vendor:** `cp pretext/dist/layout.js public/vendor/pretext-layout.js`
3. **Verify single-file output:** ensure no relative imports in built file
4. **ESM/CJS coexistence:** IIFE scripts + `<script type="module">` in index.html
5. **Fallback:** if module fails to load, degrade to DOM measurement

---

## 8. Upgrade Path to Approach C

| Component | Approach B | Approach C Upgrade |
|-----------|-----------|-------------------|
| TerminalRenderer | `<pre>` element | Canvas/SVG with `layoutNextLine()` |
| AnsiColorRenderer | regex stripping | Custom rendering with `layoutWithLines()` |
| PretextMeasurer | `prepare` + `layout` | Add `walkLineRanges()` for shrinkwrap |
| Layout | CSS-based | pretext `layoutWithLines()` for precise sizing |

All interfaces in Approach B are stable; upgrading to C only changes internal implementations.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| pretext dist not single-file | Verify build output before P1 |
| pretext fails to load (ESM) | Graceful fallback to DOM measurement |
| Canvas not available in tests | Mock or browser-only tests |
| Prepared handle cache grows | Clear cache on font/size changes |
| IME composition conflicts | Skip measurement during composition |

---

## 10. Not Using Pretext (Expert Decision Record)

Three architecture review rounds concluded:

- **Virtual scrolling**: terminal lines pre-broken by tmux, fixed height, pure arithmetic
- **ANSI color rendering**: pretext segments are word-boundary, not ANSI-boundary
- **Command palette**: CSS `max-content` solves shrinkwrap without pretext
- **Font scaling**: monospace arithmetic is simpler and faster than pretext measurement

pretext is used only where it provides genuine value: proportional-font pre-DOM measurement for toast sizing and multi-line input expansion.
