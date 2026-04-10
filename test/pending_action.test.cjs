const test = require('node:test');
const assert = require('node:assert/strict');

test('createPendingActionController toggles pending label and disabled state', async () => {
    const { createPendingActionController } = await import('../public/modules/pending_action.js');

    const button = {
        disabled: false,
        textContent: '刷新',
        dataset: {},
    };
    const sessionSelect = {
        disabled: false,
    };
    const startButton = {
        disabled: false,
    };

    const controller = createPendingActionController(button, {
        idleLabel: '刷新',
        pendingLabel: '刷新中...',
        relatedControls: [sessionSelect, startButton],
    });

    assert.equal(button.textContent, '刷新');
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.pending, 'false');
    assert.equal(sessionSelect.disabled, false);
    assert.equal(startButton.disabled, false);

    assert.equal(controller.start(), true);
    assert.equal(controller.isPending(), true);
    assert.equal(button.textContent, '刷新中...');
    assert.equal(button.disabled, true);
    assert.equal(button.dataset.pending, 'true');
    assert.equal(sessionSelect.disabled, true);
    assert.equal(startButton.disabled, true);

    assert.equal(controller.start(), false);

    controller.finish();
    assert.equal(controller.isPending(), false);
    assert.equal(button.textContent, '刷新');
    assert.equal(button.disabled, false);
    assert.equal(button.dataset.pending, 'false');
    assert.equal(sessionSelect.disabled, false);
    assert.equal(startButton.disabled, false);
});
