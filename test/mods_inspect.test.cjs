'use strict';
// mods_inspect 单测(验收 1:巡检返回结构化对象;验收 5:读失败 → mods_count 0 + error,不静默吞错)。
// 夹具用真实 tmp 目录 + 注入 fake fs 两条路:前者贴生产行为,后者精确模拟 EACCES 等读失败。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MODS_RISK_MIN_CC_VERSION,
  parseCcVersion,
  ccVersionAtLeast,
  resolveClaudeConfigDir,
  inspectModsEnv,
  detectClaudeVersion,
  evaluateModsStatus,
  sanitizeModsStatus,
} = require('../mods_inspect.cjs');

// —— 版本解析 / 比较 ——
test('parseCcVersion: "2.1.287 (Claude Code)" → "2.1.287";非版本串 → null', () => {
  assert.equal(parseCcVersion('2.1.287 (Claude Code)'), '2.1.287');
  assert.equal(parseCcVersion('  1.2.3\n'), '1.2.3');
  assert.equal(parseCcVersion('not-a-version'), null);
  assert.equal(parseCcVersion(42), null);
});

test('ccVersionAtLeast: 2.1.287 为 mods 风险下限', () => {
  assert.equal(MODS_RISK_MIN_CC_VERSION, '2.1.287');
  assert.equal(ccVersionAtLeast('2.1.287'), true, '等于下限 → true');
  assert.equal(ccVersionAtLeast('2.1.288'), true, '高于下限 → true');
  assert.equal(ccVersionAtLeast('2.2.0'), true);
  assert.equal(ccVersionAtLeast('3.0.0'), true);
  assert.equal(ccVersionAtLeast('2.1.286'), false, '低于下限 → false');
  assert.equal(ccVersionAtLeast('2.1.99'), false);
  assert.equal(ccVersionAtLeast('unknown'), false, '版本未知 → false(不误报)');
  assert.equal(ccVersionAtLeast('2.1.287 (Claude Code)'), true, '带后缀的原始输出也可比较');
});

// —— 配置目录解析 ——
test('resolveClaudeConfigDir: CLAUDE_CONFIG_DIR 优先,默认 <home>/.claude', () => {
  assert.equal(resolveClaudeConfigDir({ env: {}, homeDir: '/tmp/h' }), path.join('/tmp/h', '.claude'));
  assert.equal(resolveClaudeConfigDir({ env: { CLAUDE_CONFIG_DIR: '/custom/cc' }, homeDir: '/tmp/h' }), '/custom/cc');
});

// —— inspectModsEnv:真实 tmp 夹具(验收 1)——
function mkTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mods-inspect-'));
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

test('无任何 mods/plugins 的环境 → mods_count===0 且不抛错、无 error', () => {
  const home = mkTempHome();
  const r = inspectModsEnv({ env: {}, homeDir: home, ccVersion: '2.1.287' });
  assert.equal(r.mods_count, 0);
  assert.equal(r.error, undefined, 'ENOENT 视为正常缺席,不是错误');
  assert.equal(r.cc_version, '2.1.287');
  assert.ok(typeof r.source === 'string' && r.source.length > 0, 'source 必须是采集来源描述');
  assert.match(r.source, /installed_plugins\.json:absent/);
});

test('夹具:installed_plugins.json(2 个插件)+ mods 目录(1 条)→ mods_count>=1', () => {
  const home = mkTempHome();
  const cfg = path.join(home, '.claude');
  writeJson(path.join(cfg, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'superpowers@marketplace': [{ scope: 'user', installPath: '/x', version: '1.0.0' }],
      'ecc@ecc': [{ scope: 'user', installPath: '/y', version: '2.0.0' }],
    },
  });
  fs.mkdirSync(path.join(cfg, 'mods', 'mod-a'), { recursive: true });
  const r = inspectModsEnv({ env: {}, homeDir: home });
  assert.ok(r.mods_count >= 1, '夹具 mods 非空必须被计数');
  assert.equal(r.mods_count, 3, '2 个已装插件 + 1 个 mods 目录条目');
  assert.match(r.source, /installed_plugins\.json:2/);
  assert.match(r.source, /mods-dir:1/);
});

test('夹具:.claude.json 顶层 mods 字段(array/object)计入', () => {
  const home = mkTempHome();
  writeJson(path.join(home, '.claude.json'), { mods: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] });
  const r = inspectModsEnv({ env: {}, homeDir: home });
  assert.equal(r.mods_count, 3);
  assert.match(r.source, /state-json#mods:3/);

  const home2 = mkTempHome();
  writeJson(path.join(home2, '.claude.json'), { mods: { a: 1 } });
  assert.equal(inspectModsEnv({ env: {}, homeDir: home2 }).mods_count, 1, 'object 形状按 key 数计');
});

test('CLAUDE_CONFIG_DIR 覆盖时状态文件读 <configDir>.json', () => {
  const home = mkTempHome();
  const cfgDir = path.join(home, 'custom-claude');
  writeJson(`${cfgDir}.json`, { mods: [{ id: 'x' }] });
  const r = inspectModsEnv({ env: { CLAUDE_CONFIG_DIR: cfgDir }, homeDir: home });
  assert.match(r.source, /state-json#mods:1/);
});

// —— inspectModsEnv:降级(验收 5:读失败 → mods_count 0 + error,绝不静默)——
test('.claude.json 存在但 JSON 损坏 → error 字段 + mods_count 0', () => {
  const home = mkTempHome();
  fs.writeFileSync(path.join(home, '.claude.json'), '{ not valid json !!');
  const r = inspectModsEnv({ env: {}, homeDir: home });
  assert.equal(r.mods_count, 0, '读失败降级 0(计数不可信)');
  assert.ok(r.error, '必须带 error 说明失败原因');
  assert.match(r.error, /claude\.json|JSON 解析失败/);
});

test('fake fs:installed_plugins.json 抛 EACCES → error 字段 + mods_count 0(即使其它来源有货)', () => {
  const fakeFs = {
    readFileSync: (p, enc) => {
      if (String(p).endsWith('installed_plugins.json')) {
        const e = new Error('EACCES: permission denied');
        e.code = 'EACCES';
        throw e;
      }
      if (String(p).endsWith('.claude.json') || String(p).endsWith('.json')) {
        const e = new Error('no such file');
        e.code = 'ENOENT';
        throw e;
      }
      throw new Error('unexpected read: ' + p);
    },
    readdirSync: () => { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; },
  };
  const r = inspectModsEnv({ fsImpl: fakeFs, env: {}, homeDir: '/tmp/whatever' });
  assert.equal(r.mods_count, 0);
  assert.ok(r.error);
  assert.match(r.error, /EACCES/);
});

test('fake fs:mods 目录读取抛 EACCES → error 字段', () => {
  const fakeFs = {
    readFileSync: () => { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; },
    readdirSync: (p) => {
      if (String(p).endsWith(path.join('.claude', 'mods'))) {
        const e = new Error('EACCES: permission denied');
        e.code = 'EACCES';
        throw e;
      }
      const e = new Error('no such file'); e.code = 'ENOENT'; throw e;
    },
  };
  const r = inspectModsEnv({ fsImpl: fakeFs, env: {}, homeDir: '/tmp/whatever' });
  assert.equal(r.mods_count, 0);
  assert.match(r.error, /mods/);
});

// —— detectClaudeVersion(exec 注入)——
test('detectClaudeVersion: 解析 "2.1.300 (Claude Code)" → 2.1.300;失败/乱码 → unknown', async () => {
  const ok = (out) => (bin, args, opts, cb) => cb(null, out);
  assert.equal(await detectClaudeVersion({ execFile: ok('2.1.300 (Claude Code)\n') }), '2.1.300');
  assert.equal(await detectClaudeVersion({ execFile: (b, a, o, cb) => cb(new Error('ENOENT')) }), 'unknown');
  assert.equal(await detectClaudeVersion({ execFile: ok('garbage') }), 'unknown');
  assert.equal(await detectClaudeVersion({ execFile: () => { throw new Error('boom'); } }), 'unknown', '同步抛错也 resolve unknown');
});

// —— evaluateModsStatus(状态机:risk / ok / unknown / error)——
test('evaluateModsStatus: 非空 mods + CC ≥ 2.1.287 → risk', () => {
  const r = evaluateModsStatus({ cc_version: '2.1.287', mods_count: 1, source: 'x' });
  assert.equal(r.risk, true);
  assert.equal(r.state, 'risk');
  assert.ok(r.risk_reason);
});

test('evaluateModsStatus: 非空 mods + CC 低于 2.1.287 → ok(无 mods 能力)', () => {
  const r = evaluateModsStatus({ cc_version: '2.1.220', mods_count: 33, source: 'x' });
  assert.equal(r.risk, false);
  assert.equal(r.state, 'ok');
});

test('evaluateModsStatus: mods 为空 → ok;版本未知且有 mods → unknown', () => {
  assert.equal(evaluateModsStatus({ cc_version: '2.1.300', mods_count: 0, source: '' }).state, 'ok');
  const u = evaluateModsStatus({ cc_version: 'unknown', mods_count: 2, source: '' });
  assert.equal(u.state, 'unknown');
  assert.equal(u.risk, false, '版本未知不判 risk(不误报)');
});

test('evaluateModsStatus: error 优先于一切(state=error,即使 mods 非空)', () => {
  const r = evaluateModsStatus({ cc_version: '2.1.300', mods_count: 5, source: 'x', error: 'boom' });
  assert.equal(r.state, 'error');
  assert.equal(r.risk, false);
  assert.equal(r.error, 'boom');
});

test('evaluateModsStatus: 幂等(对已评估对象重复调用结果一致)+ 非对象 → null', () => {
  const once = evaluateModsStatus({ cc_version: '2.1.287', mods_count: 1, source: 's' });
  const twice = evaluateModsStatus(once);
  assert.deepEqual(twice, once);
  assert.equal(evaluateModsStatus(null), null);
  assert.equal(evaluateModsStatus('x'), null);
});

// —— sanitizeModsStatus(hub 侧不可信输入清洗)——
test('sanitizeModsStatus: 合法输入清洗后已含 hub 侧判定的 risk/state', () => {
  const s = sanitizeModsStatus({ cc_version: '2.1.287 (Claude Code)', mods_count: 2, source: 'a + b' });
  assert.equal(s.mods_count, 2);
  assert.equal(s.cc_version, '2.1.287 (Claude Code)');
  assert.equal(s.state, 'risk');
  assert.equal(s.risk, true);
});

test('sanitizeModsStatus: 垃圾输入 → null(不覆盖已有状态)', () => {
  assert.equal(sanitizeModsStatus(null), null);
  assert.equal(sanitizeModsStatus('x'), null);
  assert.equal(sanitizeModsStatus([]), null);
  assert.equal(sanitizeModsStatus({ cc_version: '2.1.287', mods_count: -1 }), null, '负数计数非法');
  assert.equal(sanitizeModsStatus({ cc_version: '2.1.287', mods_count: '3' }), null, '字符串计数非法');
  assert.equal(sanitizeModsStatus({ cc_version: '2.1.287' }), null, '缺 mods_count 非法');
});

test('sanitizeModsStatus: 字符串长度钳制(防超长载荷打爆 payload)', () => {
  const s = sanitizeModsStatus({ cc_version: 'x'.repeat(500), mods_count: 0, source: 'y'.repeat(2000) });
  assert.equal(s.cc_version.length, 64);
  assert.equal(s.source.length, 512);
});

test('sanitizeModsStatus: 单机自评的 risk/state 字段被丢弃重算(不信任客户端)', () => {
  const s = sanitizeModsStatus({ cc_version: '2.1.100', mods_count: 3, source: '', risk: true, state: 'risk' });
  assert.equal(s.risk, false, 'hub 依版本重算:2.1.100 < 2.1.287 → 不 risk');
  assert.equal(s.state, 'ok');
});
