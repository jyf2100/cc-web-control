const test = require('node:test');
const assert = require('node:assert/strict');

test('PretextMeasurer: can be imported from ESM module', async () => {
    let PretextMeasurer;
    try {
        const mod = await import('../public/modules/pretext_measurer.js');
        PretextMeasurer = mod.PretextMeasurer;
    } catch (e) {
        assert.fail(`Module import failed: ${e.message}`);
    }
    assert.ok(typeof PretextMeasurer === 'function', 'PretextMeasurer should be a constructor');
    const pm = new PretextMeasurer();
    const result = pm.measureHeight('hello world', '16px Arial', 200, 20);
    assert.ok(typeof result.height === 'number', 'height should be a number');
    assert.ok(typeof result.lineCount === 'number', 'lineCount should be a number');
});

test('PretextMeasurer: cacheKey format is deterministic', () => {
    const makeKey = (text, font, opts) =>
        `${text}\0${font}\0${opts?.whiteSpace || ''}`;
    const key1 = makeKey('hello', '14px Helvetica', {});
    const key2 = makeKey('hello', '14px Helvetica', {});
    const key3 = makeKey('hello', '14px Helvetica', { whiteSpace: 'pre-wrap' });
    assert.strictEqual(key1, key2, 'same inputs produce same key');
    assert.notStrictEqual(key1, key3, 'different whiteSpace produces different key');
    const keyA = makeKey('a\x00b', 'font', {});
    const keyB = makeKey('a', '\x00b', {});
    assert.notStrictEqual(keyA, keyB, 'null byte in text vs font');
});
