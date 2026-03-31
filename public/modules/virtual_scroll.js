const SCROLL_THRESHOLD_PX = 2;

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
        this.#spacerTop = document.createElement('div');
        this.#spacerTop.style.height = '0px';
        this.#viewport = document.createElement('div');
        this.#spacerBottom = document.createElement('div');
        this.#spacerBottom.style.height = '0px';
        container.append(this.#spacerTop, this.#viewport, this.#spacerBottom);
    }

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

    wasAtBottom(scrollTop) {
        return scrollTop + this.#container.clientHeight >= this.#container.scrollHeight - SCROLL_THRESHOLD_PX;
    }

    scrollToBottom() {
        this.#container.scrollTop = this.#container.scrollHeight;
    }

    get container() { return this.#container; }
}
