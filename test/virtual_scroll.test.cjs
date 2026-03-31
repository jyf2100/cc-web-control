const test = require('node:test');
const assert = require('node:assert/strict');

class MockVirtualScroll {
    #lineHeight = 20;
    #bufferLines = 5;
    getVisibleRange(scrollTop, clientHeight, totalLines) {
        const start = Math.max(0, Math.floor(scrollTop / this.#lineHeight) - this.#bufferLines);
        const end = Math.min(totalLines, Math.ceil((scrollTop + clientHeight) / this.#lineHeight) + this.#bufferLines);
        return { start, end };
    }
}

test('getVisibleRange: no buffer at top', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(0, 200, 100);
    assert.strictEqual(r.start, 0);
    assert.strictEqual(r.end, 15);
});

test('getVisibleRange: buffer when scrolled', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(400, 200, 100);
    assert.strictEqual(r.start, 15);
    assert.strictEqual(r.end, 35);
});

test('getVisibleRange: cap at totalLines', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(0, 200, 5);
    assert.strictEqual(r.start, 0);
    assert.strictEqual(r.end, 5);
});

test('getVisibleRange: negative start clamped to 0', () => {
    const vs = new MockVirtualScroll();
    const r = vs.getVisibleRange(0, 200, 1);
    assert.strictEqual(r.start, 0);
});
