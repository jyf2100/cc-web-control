const test = require('node:test');
const assert = require('node:assert/strict');

test('FontScaler: can be imported from ESM module', async () => {
    let FontScaler;
    try {
        const mod = await import('../public/modules/font_scaler.js');
        FontScaler = mod.FontScaler;
    } catch (e) {
        assert.fail(`Module import failed: ${e.message}`);
    }
    assert.ok(typeof FontScaler === 'function', 'FontScaler should be a constructor');
    // FontScaler needs DOM for probeLineHeight, so just verify it exists
    assert.ok(FontScaler.prototype.selectSize, 'should have selectSize method');
});
