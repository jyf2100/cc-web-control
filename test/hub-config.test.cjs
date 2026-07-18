const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadMachines, validateMachine, normalizeCliTool, CLI_TOOLS } = require('../hub/config.cjs');

function writeTmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cfg-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

test('validateMachine 合法', () => {
  assert.deepEqual(validateMachine({ id: 'mc1', name: 'Mac', url: 'http://1.2.3.4:7684', token: 't' }), {
    id: 'mc1', name: 'Mac', url: 'http://1.2.3.4:7684', token: 't', cli_tool: 'unknown',
  });
});

test('validateMachine 透传合法 cli_tool(grok-build)', () => {
  assert.equal(validateMachine({ id: 'm1', name: 'x', url: 'http://h', token: 't', cli_tool: 'grok-build' }).cli_tool, 'grok-build');
});

test('validateMachine cli_tool 缺省/空/非枚举 → unknown(不抛错,旧 agent 兼容)', () => {
  const base = { id: 'm1', name: 'x', url: 'http://h', token: 't' };
  assert.equal(validateMachine(base).cli_tool, 'unknown');
  assert.equal(validateMachine({ ...base, cli_tool: '' }).cli_tool, 'unknown');
  assert.equal(validateMachine({ ...base, cli_tool: null }).cli_tool, 'unknown');
  assert.equal(validateMachine({ ...base, cli_tool: 'foo' }).cli_tool, 'unknown');
  assert.equal(validateMachine({ ...base, cli_tool: 42 }).cli_tool, 'unknown');
});

test('normalizeCliTool 已知枚举原样 / 非法回退 unknown', () => {
  for (const t of CLI_TOOLS) assert.equal(normalizeCliTool(t), t);
  assert.equal(normalizeCliTool('foo'), 'unknown');
  assert.equal(normalizeCliTool(''), 'unknown');
  assert.equal(normalizeCliTool(undefined), 'unknown');
  assert.equal(normalizeCliTool(null), 'unknown');
});

test('CLI_TOOLS 含 5 个枚举(claude-code/grok-build/codex/cursor/unknown)', () => {
  assert.deepEqual(CLI_TOOLS, ['claude-code', 'grok-build', 'codex', 'cursor', 'unknown']);
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

test('validateMachine accepts http/https (SSRF)', () => {
  assert.doesNotThrow(() => validateMachine({ id: 'm1', name: 'm1', url: 'http://127.0.0.1:7684', token: 't' }));
  assert.doesNotThrow(() => validateMachine({ id: 'm2', name: 'm2', url: 'https://host.example', token: 't' }));
});

test('validateMachine rejects non-http protocols (SSRF)', () => {
  assert.throws(() => validateMachine({ id: 'f1', name: 'x', url: 'file:///etc/passwd', token: 't' }), /url/i);
  assert.throws(() => validateMachine({ id: 'f2', name: 'x', url: 'gopher://x', token: 't' }), /url/i);
  assert.throws(() => validateMachine({ id: 'f3', name: 'x', url: 'javascript:alert(1)', token: 't' }), /url/i);
});

test('validateMachine rejects malformed url (SSRF)', () => {
  assert.throws(() => validateMachine({ id: 'f4', name: 'x', url: 'not a url', token: 't' }), /url/i);
});

test('validateMachine rejects cloud metadata IP (SSRF)', () => {
  assert.throws(() => validateMachine({ id: 'f5', name: 'x', url: 'http://169.254.169.254/latest/meta-data', token: 't' }), /url/i);
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
