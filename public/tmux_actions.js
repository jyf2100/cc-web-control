/**
 * Build WS payloads to drive tmux in a Claude-Code-like way.
 *
 * Key idea: before sending completion keys (Tab) or submitting a line (Enter),
 * sync the current web input into the tmux prompt line by clearing it (C-u)
 * and re-typing the full line (enter=false). This avoids "Tab has no results"
 * when the tmux line does not match the web input value.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TmuxActions = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function key(name) {
    return { type: 'key', data: name };
  }

  function input(text, enter) {
    return { type: 'input', data: String(text ?? ''), enter: enter !== false };
  }

  function batch(actions) {
    return { type: 'batch', data: actions };
  }

  function buildClearLine() {
    return [key('C-u')];
  }

  function buildSyncLine(line) {
    const text = String(line ?? '');
    return [...buildClearLine(), input(text, false)];
  }

  function buildSubmitLine(line) {
    const text = String(line ?? '');
    return [...buildClearLine(), input(text, true)];
  }

  function buildSyncAndKey(line, keyName) {
    const text = String(line ?? '');
    const k = String(keyName ?? '');
    if (!k) throw new Error('keyName must be a non-empty string');
    return [...buildSyncLine(text), key(k)];
  }

  function buildTabComplete(line) {
    const text = String(line ?? '');
    return [...buildClearLine(), input(text, false), key('Tab')];
  }

  return {
    key,
    input,
    batch,
    buildClearLine,
    buildSyncLine,
    buildSyncAndKey,
    buildSubmitLine,
    buildTabComplete,
  };
});
