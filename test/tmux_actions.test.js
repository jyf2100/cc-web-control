const test = require('node:test');
const assert = require('node:assert/strict');

const actions = require('../public/tmux_actions');

test('buildTabComplete clears line, syncs input, then sends Tab', () => {
  const seq = actions.buildTabComplete('/m');
  assert.deepEqual(seq, [
    { type: 'key', data: 'C-u' },
    { type: 'input', data: '/m', enter: false },
    { type: 'key', data: 'Tab' },
  ]);
});

test('buildSubmitLine clears line then submits input with Enter', () => {
  const seq = actions.buildSubmitLine('/model');
  assert.deepEqual(seq, [
    { type: 'key', data: 'C-u' },
    { type: 'input', data: '/model', enter: true },
  ]);
});

test('buildSyncLine clears line then types input without Enter', () => {
  const seq = actions.buildSyncLine('/m');
  assert.deepEqual(seq, [
    { type: 'key', data: 'C-u' },
    { type: 'input', data: '/m', enter: false },
  ]);
});
