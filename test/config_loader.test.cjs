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

// ---- Task 2:字段校验(port 范围 / session 正则 / array of strings / number min)----
const V = {
  port:        { type: 'port',    env: 'P', default: 7684 },
  sess:        { type: 'session', env: 'S', default: 'claude-web-session' },
  roots:       { type: 'array',   env: 'R', default: [] },
  intervalMs:  { type: 'number',  env: 'I', default: 100, min: 1 },
};

test('port 非整数 → throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '7684.5' } }), /port.*整数/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: 'abc' } }), /port.*整数/);
});
test('port 越界(0 / 70000)→ throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '0' } }), /port.*1-65535/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '70000' } }), /port.*1-65535/);
});
test('port 合法边界(1 / 65535)→ 通过', () => {
  assert.equal(loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '1' } }).config.port, 1);
  assert.equal(loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { P: '65535' } }).config.port, 65535);
});
test('session 不合正则(含空格/斜杠/超 64)→ throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { S: 'a b' } }), /sess/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { S: 'a/b' } }), /sess/);
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { S: 'x'.repeat(65) } }), /sess/);
});
test('projectRoots:env 逗号分隔 → string[];file 数组每元素 string', () => {
  assert.deepEqual(
    loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { R: '/a, /b ,/c' } }).config.roots,
    ['/a', '/b', '/c']
  );
  const f = writeTmp(JSON.stringify({ roots: ['/x', '/y'] }));
  try {
    assert.deepEqual(loadConfig({ schema: V, defaultFilePath: f, argv: [], env: {} }).config.roots, ['/x', '/y']);
  } finally { rm(path.dirname(f)); }
});
test('projectRoots:file 非数组 → throw;元素非 string → throw', () => {
  const f1 = writeTmp(JSON.stringify({ roots: '/not-array' }));
  try { assert.throws(() => loadConfig({ schema: V, defaultFilePath: f1, argv: [], env: {} }), /roots.*数组/); }
  finally { rm(path.dirname(f1)); }
  const f2 = writeTmp(JSON.stringify({ roots: [123] }));
  try { assert.throws(() => loadConfig({ schema: V, defaultFilePath: f2, argv: [], env: {} }), /roots.*string/); }
  finally { rm(path.dirname(f2)); }
});
test('number 低于 min → throw', () => {
  assert.throws(() => loadConfig({ schema: V, defaultFilePath: '/x', argv: [], env: { I: '0' } }), /intervalMs.*>= 1/);
});
test('projectRoots:file 数组元素 trim 空白 + 丢空串(与 env 归一一致)', () => {
  const f = writeTmp(JSON.stringify({ roots: ['/a ', ' /b', '', '/c'] }));
  try {
    assert.deepEqual(
      loadConfig({ schema: V, defaultFilePath: f, argv: [], env: {} }).config.roots,
      ['/a', '/b', '/c']
    );
  } finally { rm(path.dirname(f)); }
});

// ---- Task 3:未知字段 warning + token 权限告警 ----
const T = {
  port:      { type: 'port',   env: 'P', default: 7684 },
  authToken: { type: 'string', env: 'CC_WEB_AUTH_TOKEN', default: '' },
  hubToken:  { type: 'string', env: 'CC_WEB_HUB_TOKEN', default: '' },
};

test('未知字段 → warning 提示字段名(帮发现拼写错误,如 authoken)', () => {
  const f = writeTmp(JSON.stringify({ port: 8000, authoken: 'typo' }));
  try {
    const { warnings } = loadConfig({ schema: T, defaultFilePath: f, argv: [], env: {} });
    assert.ok(warnings.some(w => /未知字段 "authoken"/.test(w)), `应 warn authoken,实际 ${JSON.stringify(warnings)}`);
  } finally { rm(path.dirname(f)); }
});
test('已知字段全部命中 → 无未知字段 warning', () => {
  const f = writeTmp(JSON.stringify({ port: 8000, authToken: 't' }));
  try {
    const { warnings } = loadConfig({ schema: T, defaultFilePath: f, argv: [], env: {} });
    assert.ok(!warnings.some(w => /未知字段/.test(w)), `不应有未知字段 warning,实际 ${JSON.stringify(warnings)}`);
  } finally { rm(path.dirname(f)); }
});

// 权限告警用 fsImpl 注入,确定性控制 mode(免 chmod/umask 干扰)
function fakeFs(fileContent, mode) {
  return {
    existsSync: () => true,
    readFileSync: () => fileContent,
    statSync: () => ({ mode }),
  };
}
test('含 token 且 group/other 可读(mode 0o644)→ 权限 warning 含 chmod 600,不阻断', () => {
  const { config, warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ authToken: 'secret' }), 0o644),
  });
  assert.equal(config.authToken, 'secret');  // 不阻断
  assert.ok(warnings.some(w => /权限过松.*chmod 600/.test(w)), `应 warn 权限,实际 ${JSON.stringify(warnings)}`);
});
test('含 token 且仅 owner 可读(mode 0o600)→ 无权限 warning', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ hubToken: 'secret' }), 0o600),
  });
  assert.ok(!warnings.some(w => /权限过松/.test(w)), `0o600 不应 warn,实际 ${JSON.stringify(warnings)}`);
});
test('warnings 不含 token 值(安全:不回显 secret)', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ authToken: 'super-secret-value' }), 0o644),
  });
  const all = JSON.stringify(warnings);
  assert.ok(!all.includes('super-secret-value'), `warnings 不应含 token 值,实际 ${all}`);
});
test('不含 token 字段值 → 即使权限松也不 warn(无敏感数据)', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ port: 8000 }), 0o644),
  });
  assert.ok(!warnings.some(w => /权限过松/.test(w)), `无 token 不应 warn,实际 ${JSON.stringify(warnings)}`);
});
