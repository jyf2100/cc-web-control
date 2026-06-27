const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readTailEvents, statSnapshot } = require('../dashboard_tail.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tail-'));
}
function writeLines(dir, name, lines) {
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
}
function rm(d) {
  fs.rmSync(d, { recursive: true, force: true });
}

test('reads events from tail', () => {
  const d = tmpDir();
  try {
    writeLines(d, 'a.jsonl', [
      JSON.stringify({ type: 'user', timestamp: '2026-06-27T06:00:00.000Z', message: { role: 'user', content: 'first' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-27T06:00:01.000Z', message: { role: 'assistant', content: [], stop_reason: 'end_turn' } }),
    ]);
    const ev = readTailEvents(path.join(d, 'a.jsonl'));
    assert.equal(ev.length, 2);
    assert.equal(ev[1].message.stop_reason, 'end_turn');
  } finally { rm(d); }
});

test('skips bad lines, keeps good ones', () => {
  const d = tmpDir();
  try {
    writeLines(d, 'a.jsonl', [
      JSON.stringify({ type: 'user', timestamp: '2026-06-27T06:00:00.000Z', message: { role: 'user', content: 'ok' } }),
      'this is not json {{{',
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-27T06:00:02.000Z', message: { role: 'assistant', content: [], stop_reason: 'end_turn' } }),
    ]);
    const ev = readTailEvents(path.join(d, 'a.jsonl'));
    assert.equal(ev.length, 2);
  } finally { rm(d); }
});

test('returns [] for missing file', () => {
  assert.deepEqual(readTailEvents('/no/such/file.jsonl'), []);
});

test('truncates to TAIL_BYTES, keeps tail marker, drops partial first line', () => {
  const d = tmpDir();
  try {
    const big = 'x'.repeat(70 * 1024); // > 64KB
    const goodLine = JSON.stringify({ type: 'user', timestamp: '2026-06-27T06:00:00.000Z', message: { role: 'user', content: 'tail-marker' } });
    fs.writeFileSync(path.join(d, 'a.jsonl'), big + '\n' + big + '\n' + goodLine + '\n');
    const ev = readTailEvents(path.join(d, 'a.jsonl'));
    const found = ev.find((e) => e && e.message && e.message.content === 'tail-marker');
    assert.ok(found, 'tail marker event must survive tail read');
  } finally { rm(d); }
});

test('statSnapshot reports exists + size for present/absent', () => {
  const d = tmpDir();
  try {
    const f = path.join(d, 'a.jsonl');
    writeLines(d, 'a.jsonl', ['{}']);
    const s = statSnapshot(f);
    assert.equal(s.exists, true);
    assert.ok(s.size > 0);
    assert.equal(statSnapshot('/no/such/file').exists, false);
  } finally { rm(d); }
});
