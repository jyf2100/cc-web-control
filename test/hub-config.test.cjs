const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadMachines, validateMachine } = require('../hub/config.cjs');

function writeTmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cfg-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

test('validateMachine 合法', () => {
  assert.deepEqual(validateMachine({ id: 'mc1', name: 'Mac', url: 'http://1.2.3.4:7684', token: 't' }), {
    id: 'mc1', name: 'Mac', url: 'http://1.2.3.4:7684', token: 't',
  });
});

test('validateMachine id 含 / → 抛错', () => {
  assert.throws(() => validateMachine({ id: 'a/b', name: 'x', url: 'http://h', token: 't' }), /id/);
});

test('validateMachine id 不合正则 → 抛错', () => {
  assert.throws(() => validateMachine({ id: 'a b', name: 'x', url: 'http://h', token: 't' }), /id/);
});

test('validateMachine 缺 url/token → 抛错', () => {
  assert.throws(() => validateMachine({ id: 'mc1', name: 'x', token: 't' }), /url/);
  assert.throws(() => validateMachine({ id: 'mc1', name: 'x', url: 'http://h' }), /token/);
});

test('loadMachines 合法清单', () => {
  const f = writeTmp(JSON.stringify({ machines: [
    { id: 'mc1', name: 'A', url: 'http://1:7684', token: 't1' },
    { id: 'mc2', name: 'B', url: 'http://2:7684', token: 't2' },
  ] }));
  try {
    const m = loadMachines(f);
    assert.equal(m.length, 2);
    assert.equal(m[0].id, 'mc1');
  } finally { rm(path.dirname(f)); }
});

test('loadMachines id 重复 → fail-fast', () => {
  const f = writeTmp(JSON.stringify({ machines: [
    { id: 'mc1', name: 'A', url: 'http://1:7684', token: 't1' },
    { id: 'mc1', name: 'B', url: 'http://2:7684', token: 't2' },
  ] }));
  try {
    assert.throws(() => loadMachines(f), /duplicate/i);
  } finally { rm(path.dirname(f)); }
});

test('loadMachines 文件不存在 → fail-fast', () => {
  assert.throws(() => loadMachines('/no/such/file.json'), /not found|ENOENT/i);
});

test('loadMachines JSON 损坏 → fail-fast', () => {
  const f = writeTmp('{ not json');
  try { assert.throws(() => loadMachines(f), /JSON/i); }
  finally { rm(path.dirname(f)); }
});
