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
        let best = {
            fontSize: this.#baseFontSize,
            lineHeight: this.#baseFontSize * this.#lineHeightRatio,
            lineCount: totalLines,
        };

        for (let fontSize = this.#maxFontSize; fontSize >= this.#minFontSize; fontSize--) {
            const lineHeight = this.#probeLineHeight(fontSize);
            const contentHeight = totalLines * lineHeight;
            if (contentHeight <= viewportHeight) {
                best = { fontSize, lineHeight, lineCount: totalLines };
                break;
            }
        }

        return best;
    }

    get baseFontSize() { return this.#baseFontSize; }
    get minFontSize() { return this.#minFontSize; }
    get maxFontSize() { return this.#maxFontSize; }
}
