const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig, parseConfigFlag } = require('../config_loader.cjs');

// 仅 number/string/bool 的小 schema,用于 Task 1 核心行为(全 schema 见 Task 4/5)
const MINI = {
  port:   { type: 'number', env: 'CC_WEB_PORT', default: 7684, min: 1, max: 65535 },
  host:   { type: 'string', env: 'CC_WEB_HOST', default: '127.0.0.1', nonEmpty: true },
  debug:  { type: 'bool',   env: 'CC_WEB_DEBUG', default: false },
};

function writeTmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-load-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

test('parseConfigFlag: --config <path> 与 --config=<path>', () => {
  assert.equal(parseConfigFlag(['node', 'x', '--config', '/a/b.json']), '/a/b.json');
  assert.equal(parseConfigFlag(['node', 'x', '--config=/a/b.json']), '/a/b.json');
  assert.equal(parseConfigFlag(['node', 'x']), undefined);
});

test('文件不存在 → 全默认,无 throw,无 warnings', () => {
  const { config, warnings, filePath } = loadConfig({
    schema: MINI, defaultFilePath: '/no/such/config.json',
    argv: [], env: {},
  });
  assert.deepEqual(config, { port: 7684, host: '127.0.0.1', debug: false });
  assert.deepEqual(warnings, []);
  assert.equal(filePath, '/no/such/config.json');
});

test('文件存在 → 各字段正确读取(file)', () => {
  const f = writeTmp(JSON.stringify({ port: 9000, host: '0.0.0.0', debug: true }));
  try {
    const { config } = loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} });
    assert.equal(config.port, 9000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.debug, true);
  } finally { rm(path.dirname(f)); }
});

test('env 显式设置 → 覆盖文件值(env > file > default)', () => {
  const f = writeTmp(JSON.stringify({ port: 9000, host: 'from-file', debug: false }));
  try {
    const { config } = loadConfig({
      schema: MINI, defaultFilePath: f, argv: [],
      env: { CC_WEB_PORT: '8000', CC_WEB_HOST: 'from-env', CC_WEB_DEBUG: '1' },
    });
    assert.equal(config.port, 8000);
    assert.equal(config.host, 'from-env');
    assert.equal(config.debug, true);
  } finally { rm(path.dirname(f)); }
});

test('env 显式空串仍算"已设置"(不回退 file)', () => {
  const f = writeTmp(JSON.stringify({ host: 'from-file' }));
  try {
    assert.throws(() => loadConfig({
      schema: MINI, defaultFilePath: f, argv: [], env: { CC_WEB_HOST: '' },
    }), /host.*不可为空/);
  } finally { rm(path.dirname(f)); }
});

test('--config flag 覆盖 defaultFilePath', () => {
  const f = writeTmp(JSON.stringify({ port: 7000 }));
  try {
    const { config, filePath } = loadConfig({
      schema: MINI, defaultFilePath: '/default/path.json',
      argv: ['node', 'x', '--config', f], env: {},
    });
    assert.equal(filePath, f);
    assert.equal(config.port, 7000);
  } finally { rm(path.dirname(f)); }
});

test('坏 JSON → throw 含文件路径', () => {
  const f = writeTmp('{ not json');
  try {
    assert.throws(
      () => loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }),
      new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  } finally { rm(path.dirname(f)); }
});

test('JSON 非对象(数组)→ throw', () => {
  const f = writeTmp('[1,2,3]');
  try {
    assert.throws(
      () => loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }),
      /须为 JSON 对象/
    );
  } finally { rm(path.dirname(f)); }
});

test('bool:file 非布尔值(字符串 "true"/数字 1)→ throw(fail-fast 防引号 footgun)', () => {
  const f = writeTmp(JSON.stringify({ debug: 'true' }));
  try {
    assert.throws(() => loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }), /bool.*true\/false/);
  } finally { rm(path.dirname(f)); }
  const f2 = writeTmp(JSON.stringify({ debug: 1 }));
  try {
    assert.throws(() => loadConfig({ schema: MINI, defaultFilePath: f2, argv: [], env: {} }), /bool.*true\/false/);
  } finally { rm(path.dirname(f2)); }
});

test('bool:file 合法 true/false 仍正确(env 不受影响)', () => {
  const f = writeTmp(JSON.stringify({ debug: false }));
  try {
    assert.equal(loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }).config.debug, false);
  } finally { rm(path.dirname(f)); }
});

test('parseConfigFlag: --config 缺路径 / --config= 空 → throw(防静默用错文件)', () => {
  assert.throws(() => parseConfigFlag(['node', 'x', '--config']), /--config.*路径/);
  assert.throws(() => parseConfigFlag(['node', 'x', '--config=']), /--config/);
});

test('JSON null → throw 含 "null"', () => {
  const f = writeTmp('null');
  try {
    assert.throws(
      () => loadConfig({ schema: MINI, defaultFilePath: f, argv: [], env: {} }),
      /须为 JSON 对象\(实际 null\)/
    );
  } finally { rm(path.dirname(f)); }
});
