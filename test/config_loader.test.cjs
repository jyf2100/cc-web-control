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
test('权限 warning 的 mode 显示为八进制(防 chmod 420 误用 — chmod 按八进制解析)', () => {
  const { warnings } = loadConfig({
    schema: T, defaultFilePath: '/fake/config.json', argv: [], env: {},
    fsImpl: fakeFs(JSON.stringify({ authToken: 'secret' }), 0o644),
  });
  // 须出现八进制 644(0o644 或 mode 644),不可出现十进制 420
  assert.ok(
    warnings.some(w => /0o644|mode 644/.test(w)),
    `应显示八进制 mode 644,实际 ${JSON.stringify(warnings)}`
  );
  assert.ok(
    !warnings.some(w => /mode 420/.test(w)),
    `不应显示十进制 420(chmod 420 = r---w---- 误用),实际 ${JSON.stringify(warnings)}`
  );
});

// ---- Task 4:SINGLE_SCHEMA(7684 全 15 字段)+ object passthrough ----
const { SINGLE_SCHEMA } = require('../config_loader.cjs');

test('SINGLE_SCHEMA:15 字段全齐,env/default/type 对齐 spec §5.1', () => {
  const fields = Object.keys(SINGLE_SCHEMA);
  assert.equal(fields.length, 15, `应有 15 字段,实际 ${fields.length}: ${fields.join(',')}`);
  assert.equal(SINGLE_SCHEMA.port.env, 'CC_WEB_PORT');
  assert.equal(SINGLE_SCHEMA.port.default, 7684);
  assert.equal(SINGLE_SCHEMA.port.type, 'port');
  assert.equal(SINGLE_SCHEMA.authToken.env, 'CC_WEB_AUTH_TOKEN');
  assert.equal(SINGLE_SCHEMA.authToken.default, '');
  assert.equal(SINGLE_SCHEMA.projectRoots.type, 'array');
  assert.deepEqual(SINGLE_SCHEMA.projectRoots.default, []);
  assert.equal(SINGLE_SCHEMA.dashboardIntervalMs.env, 'CC_WEB_DASHBOARD_INTERVAL_MS');
  assert.equal(SINGLE_SCHEMA.dashboardIntervalMs.default, 2000);
  assert.equal(SINGLE_SCHEMA.wsPingInterval.env, 'CC_WEB_WS_PING_INTERVAL');
  assert.equal(SINGLE_SCHEMA.wsPingInterval.default, 30000);
  assert.equal(SINGLE_SCHEMA.captureHistory.type, 'string');
});

test('SINGLE_SCHEMA 全字段从文件加载(端到端)', () => {
  const f = writeTmp(JSON.stringify({
    port: 8000, host: '0.0.0.0', session: 'sess-1', authToken: 'tok',
    projectRoots: ['/p1', '/p2'], captureHistory: '100', pollInterval: 200,
    claudeContinue: true, noOpen: true, noAttach: true, webOnly: true,
    loginMax: 10, loginWindowMs: 60000, dashboardIntervalMs: 5000, wsPingInterval: 40000,
  }));
  try {
    const { config } = loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: f, argv: [], env: {} });
    assert.equal(config.port, 8000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.session, 'sess-1');
    assert.equal(config.authToken, 'tok');
    assert.deepEqual(config.projectRoots, ['/p1', '/p2']);
    assert.equal(config.captureHistory, '100');
    assert.equal(config.pollInterval, 200);
    assert.equal(config.claudeContinue, true);
    assert.equal(config.noOpen, true);
    assert.equal(config.noAttach, true);
    assert.equal(config.webOnly, true);
    assert.equal(config.loginMax, 10);
    assert.equal(config.loginWindowMs, 60000);
    assert.equal(config.dashboardIntervalMs, 5000);
    assert.equal(config.wsPingInterval, 40000);
  } finally { rm(path.dirname(f)); }
});

test('bool:env "0"/"2" → false(仅 "1" 为 true);file false → false', () => {
  assert.equal(loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: '/x', argv: [], env: { CC_WEB_CLAUDE_CONTINUE: '0' } }).config.claudeContinue, false);
  assert.equal(loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: '/x', argv: [], env: { CC_WEB_CLAUDE_CONTINUE: '2' } }).config.claudeContinue, false);
  const f = writeTmp(JSON.stringify({ claudeContinue: false }));
  try {
    assert.equal(loadConfig({ schema: SINGLE_SCHEMA, defaultFilePath: f, argv: [], env: {} }).config.claudeContinue, false);
  } finally { rm(path.dirname(f)); }
});

// 增补(计划缺口):object 分支是 Task 4 新增的生产代码,须有直接失败测试(TDD 完整性)
test('object passthrough:原样返回对象 + 子字段类型校验 + 非对象 throw(为 Task 5 mainAgent 预置)', () => {
  const SC = { ma: { type: 'object', default: {}, fields: { enabled: 'bool', settleMs: 'number', session: 'string' } } };
  // 合法对象 → 原样返回
  const f1 = writeTmp(JSON.stringify({ ma: { enabled: true, settleMs: 100, session: 's1' } }));
  try {
    const { config } = loadConfig({ schema: SC, defaultFilePath: f1, argv: [], env: {} });
    assert.deepEqual(config.ma, { enabled: true, settleMs: 100, session: 's1' });
  } finally { rm(path.dirname(f1)); }
  // 坏子字段:settleMs 非数字 → throw(字段名含 ma.settleMs)
  const f2 = writeTmp(JSON.stringify({ ma: { settleMs: 'abc' } }));
  try {
    assert.throws(() => loadConfig({ schema: SC, defaultFilePath: f2, argv: [], env: {} }), /ma\.settleMs/);
  } finally { rm(path.dirname(f2)); }
  // 非对象(数组)→ throw
  const f3 = writeTmp(JSON.stringify({ ma: [1, 2] }));
  try {
    assert.throws(() => loadConfig({ schema: SC, defaultFilePath: f3, argv: [], env: {} }), /ma.*须为对象/);
  } finally { rm(path.dirname(f3)); }
  // default {} 通过(无子字段要校验)
  const { config } = loadConfig({ schema: SC, defaultFilePath: '/no-such-file', argv: [], env: {} });
  assert.deepEqual(config.ma, {});
});

test('object 默认值返回新引用(防 schema default 被突变污染 — Task 4 质量审查 Important)', () => {
  const SC = { ma: { type: 'object', default: {}, fields: { enabled: 'bool' } } };
  const r1 = loadConfig({ schema: SC, defaultFilePath: '/no-such-file', argv: [], env: {} });
  // 第一次加载拿到默认 {},注入一个键
  r1.config.ma.injected = 'BOOM';
  // 第二次加载:若返回 schema default 同一引用,会被 BOOM 污染
  const r2 = loadConfig({ schema: SC, defaultFilePath: '/no-such-file', argv: [], env: {} });
  assert.equal(r2.config.ma.injected, undefined, '第二次加载不应看到第一次的突变(object 默认值须返回新引用)');
  assert.deepEqual(r2.config.ma, {}, '第二次加载的默认 object 应干净');
});
