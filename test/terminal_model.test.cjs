const test = require('node:test');
const assert = require('node:assert/strict');

async function loadTerminalModel() {
    const { TerminalModel } = await import('../public/modules/terminal_model.js');
    return { TerminalModel };
}

test('replace() returns false when text unchanged', async () => {
    const { TerminalModel } = await loadTerminalModel();
    const model = new TerminalModel(1000);
    model.replace('hello\nworld');
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
