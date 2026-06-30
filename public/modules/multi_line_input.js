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

        // Simultaneously shrink terminal viewport to prevent layout flash.
        // 读 visualViewport 高度(iOS 软键盘弹出时收缩),回退 innerHeight。
        const vh = (window.visualViewport && window.visualViewport.height)
            ? window.visualViewport.height
            : window.innerHeight;
        const totalInputHeight = HEADER_HEIGHT + INPUT_ROW_BASE + expandedHeight - LINE_HEIGHT_INPUT;
        this.#terminalView.style.maxHeight = `calc(${vh}px - ${totalInputHeight}px)`;
    }
}
