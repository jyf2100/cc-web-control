// NOTE: top-level await means the entire module pauses here until import resolves.
// This is safe because:
//   1. main.js is <script type="module"> — deferred by default
//   2. client.js is a classic <script> — runs first synchronously
//   3. client.js calls ensureTerminalView() → initP0/initP3/initP1
//      These no-op if ccModules is not yet set.
//   4. After module loads, window.ccModules is set, then DOMContentLoaded fires.
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

export class PretextMeasurer {
    #preparedCache = new Map();
    #available = !!_prepare;

    measureHeight(text, font, width, lineHeight, options) {
        if (!this.#available) {
            return { height: lineHeight, lineCount: 1 };
        }
        const key = `${text}\0${font}\0${options?.whiteSpace || ''}`;
        let prepared = this.#preparedCache.get(key);
        if (!prepared) {
            try {
                prepared = _prepare(text, font, options);
                this.#preparedCache.set(key, prepared);
            } catch (e) {
                console.warn('[PretextMeasurer] prepare failed, using fallback:', e);
                return { height: lineHeight, lineCount: 1 };
            }
        }
        try {
            return _layout(prepared, width, lineHeight);
        } catch (e) {
            console.warn('[PretextMeasurer] layout failed, using fallback:', e);
            return { height: lineHeight, lineCount: 1 };
        }
    }

    clearCache() {
        this.#preparedCache.clear();
        if (_clearCache) _clearCache();
    }

    get available() {
        return this.#available;
    }
}
