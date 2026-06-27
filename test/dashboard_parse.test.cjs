const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStatus } = require('../dashboard_parse.cjs');

const NOW = Date.parse('2026-06-27T06:30:00.000Z');
const IDLE = 30;

function ts(ageS) {
  return new Date(NOW - ageS * 1000).toISOString();
}
function assistant(stopReason, content, ageS = 10) {
  return { type: 'assistant', timestamp: ts(ageS), message: { role: 'assistant', content, stop_reason: stopReason } };
}
function user(text, ageS = 10) {
  return { type: 'user', timestamp: ts(ageS), message: { role: 'user', content: text } };
}

test('empty / undefined events → unknown', () => {
  assert.deepEqual(parseStatus([], NOW, IDLE), { status: 'unknown', lastLine: '', lastTs: null });
  assert.deepEqual(parseStatus(undefined, NOW, IDLE), { status: 'unknown', lastLine: '', lastTs: null });
});

test('assistant end_turn → waiting', () => {
  const r = parseStatus([assistant('end_turn', [{ type: 'text', text: 'Done.' }])], NOW, IDLE);
  assert.equal(r.status, 'waiting');
  assert.equal(r.lastLine, 'Done.');
});

test('assistant tool_use within threshold → working', () => {
  const r = parseStatus([assistant('tool_use', [{ type: 'tool_use', name: 'Bash', input: {} }], 5)], NOW, IDLE);
  assert.equal(r.status, 'working');
});

test('assistant tool_use beyond threshold → idle', () => {
  const r = parseStatus([assistant('tool_use', [{ type: 'tool_use', name: 'Bash', input: {} }], 60)], NOW, IDLE);
  assert.equal(r.status, 'idle');
});

test('user event within threshold → working', () => {
  const r = parseStatus([user('please refactor', 3)], NOW, IDLE);
  assert.equal(r.status, 'working');
  assert.equal(r.lastLine, 'please refactor');
});

test('error event → errored (priority over end_turn)', () => {
  const events = [{ type: 'assistant', timestamp: ts(5), message: { role: 'assistant', content: [], stop_reason: 'end_turn' }, isApiErrorMessage: true }];
  assert.equal(parseStatus(events, NOW, IDLE).status, 'errored');
});

test('only mode/permission events (no user/assistant) → unknown', () => {
  const events = [{ type: 'mode', timestamp: ts(5), mode: 'default' }];
  assert.equal(parseStatus(events, NOW, IDLE).status, 'unknown');
});

test('picks last user/assistant when later non-meaningful events exist', () => {
  const events = [
    assistant('end_turn', [{ type: 'text', text: 'finished' }]),
    { type: 'mode', timestamp: ts(1), mode: 'plan' },
  ];
  const r = parseStatus(events, NOW, IDLE);
  assert.equal(r.status, 'waiting');
  assert.equal(r.lastLine, 'finished');
});

test('long preview truncated to <=200 with ellipsis', () => {
  const r = parseStatus([user('x'.repeat(500), 2)], NOW, IDLE);
  assert.ok(r.lastLine.length <= 200, `len=${r.lastLine.length}`);
  assert.ok(r.lastLine.endsWith('…'));
});

test('tool_use content yields tool name preview', () => {
  const r = parseStatus([assistant('tool_use', [{ type: 'tool_use', name: 'Edit', input: {} }], 5)], NOW, IDLE);
  assert.match(r.lastLine, /Edit/);
});

test('lastTs parsed from ISO timestamp', () => {
  const r = parseStatus([user('hi', 10)], NOW, IDLE);
  assert.equal(r.lastTs, NOW - 10 * 1000);
});
