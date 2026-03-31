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
