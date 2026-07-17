'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSecretStore,
  KeychainError,
  keychainRef,
  parseKeychainRef,
  isPlaintextKey,
  pickBackend,
  winCredReadPs,
} = require('../secret_store.cjs');

// mock exec:记录调用,按预设返回 stdout / 抛错。
function mockExec(routes) {
  const calls = [];
  const fn = (file, args /*, opts */) => {
    calls.push({ file, args });
    const key = file;
    const r = routes.shift();
    if (!r) throw new Error(`unexpected exec ${file} ${JSON.stringify(args)}`);
    if (r.throw) {
      const e = new Error(r.throw.message || 'fail');
      if (r.throw.code) e.code = r.throw.code;
      if (r.throw.stderr) e.stderr = r.throw.stderr;
      if (r.throw.path) e.path = r.throw.path;
      throw e;
    }
    return Promise.resolve({ stdout: r.stdout || '', stderr: r.stderr || '' });
  };
  fn.calls = calls;
  return fn;
}

const SVC = 'cc-web-control';
const ACCT = 'anthropic-api-key';

// —— keychain:// 引用 ——
test('keychainRef / parseKeychainRef 往返', () => {
  assert.equal(keychainRef(SVC, ACCT), 'keychain://cc-web-control/anthropic-api-key');
  assert.deepEqual(parseKeychainRef('keychain://cc-web-control/anthropic-api-key'), { service: SVC, account: ACCT });
  assert.equal(parseKeychainRef('sk-ant-xxx'), null);
  assert.equal(parseKeychainRef('keychain://svc'), null); // 缺 account
  assert.equal(parseKeychainRef(null), null);
});

test('isPlaintextKey:明文 true、引用/空 false', () => {
  assert.equal(isPlaintextKey('sk-ant-test-123'), true);
  assert.equal(isPlaintextKey(keychainRef(SVC, ACCT)), false);
  assert.equal(isPlaintextKey(''), false);
  assert.equal(isPlaintextKey(undefined), false);
});

test('pickBackend:detect by platform', () => {
  assert.equal(pickBackend('darwin').name, 'keychain');
  assert.equal(pickBackend('win32').name, 'credman');
  assert.equal(pickBackend('linux').name, 'libsecret');
  assert.equal(pickBackend('freebsd').name, 'libsecret'); // unix 回退
});

// —— darwin ——
test('darwin set 命令(security add-generic-password,service/account/key 齐全)', async () => {
  const exec = mockExec([{ stdout: '' }]);
  const s = createSecretStore({ platform: 'darwin', exec });
  await s.set(ACCT, 'sk-ant-abc');
  assert.equal(exec.calls[0].file, 'security');
  assert.deepEqual(exec.calls[0].args, [
    'add-generic-password', '-s', SVC, '-a', ACCT, '-w', 'sk-ant-abc', '-U',
  ]);
});

test('darwin get 命令 + 输出去尾换行', async () => {
  const exec = mockExec([{ stdout: 'sk-ant-abc\n' }]);
  const s = createSecretStore({ platform: 'darwin', exec });
  const v = await s.get(ACCT);
  assert.equal(v, 'sk-ant-abc');
  assert.deepEqual(exec.calls[0].args, ['find-generic-password', '-s', SVC, '-a', ACCT, '-w']);
});

// —— linux ——
test('linux set:secret-tool store,key 经 stdin(不进 argv)', async () => {
  const exec = mockExec([{ stdout: '' }]);
  const s = createSecretStore({ platform: 'linux', exec });
  await s.set(ACCT, 'sk-ant-xyz');
  assert.equal(exec.calls[0].file, 'secret-tool');
  assert.deepEqual(exec.calls[0].args, ['store', `--service=${SVC}`, `--account=${ACCT}`, SVC]);
  // key 不在 argv(防进程列表泄露);进 stdin
  assert.ok(!exec.calls[0].args.includes('sk-ant-xyz'));
});

test('linux get:secret-tool lookup service/account', async () => {
  const exec = mockExec([{ stdout: 'sk-ant-xyz' }]);
  const s = createSecretStore({ platform: 'linux', exec });
  assert.equal(await s.get(ACCT), 'sk-ant-xyz');
  assert.deepEqual(exec.calls[0].args, ['lookup', 'service', SVC, 'account', ACCT]);
});

// —— windows ——
test('windows set:cmdkey /generic target/user/pass', async () => {
  const exec = mockExec([{ stdout: '' }]);
  const s = createSecretStore({ platform: 'win32', exec });
  await s.set(ACCT, 'sk-ant-win');
  assert.equal(exec.calls[0].file, 'cmdkey');
  assert.deepEqual(exec.calls[0].args, [
    '/generic:cc-web-control/anthropic-api-key', '/user:cc-web-control', '/pass:sk-ant-win',
  ]);
});

test('windows get:powershell CredRead,ps 含 target', async () => {
  const exec = mockExec([{ stdout: 'sk-ant-win\r\n' }]);
  const s = createSecretStore({ platform: 'win32', exec });
  assert.equal(await s.get(ACCT), 'sk-ant-win');
  assert.equal(exec.calls[0].file, 'powershell');
  assert.equal(exec.calls[0].args[0], '-NoProfile');
  assert.equal(exec.calls[0].args[2], '-Command');
  const ps = exec.calls[0].args[3];
  assert.ok(ps.includes('CredRead'), 'ps 含 CredRead');
  assert.ok(ps.includes('"cc-web-control/anthropic-api-key"'), 'ps 含 target');
});

test('winCredReadPs:未命中走空串 + exit 分支(CredRead 返回 false)', () => {
  const ps = winCredReadPs('cc-web-control/anthropic-api-key');
  assert.ok(/if\(-not\[CCred\]::CredRead/.test(ps));
  assert.ok(ps.includes("Write-Output ''"));
});

// —— 失败语义(A5)——
test('get:工具缺失(ENOENT)→ KEYCHAIN_UNAVAILABLE', async () => {
  const exec = mockExec([{ throw: { code: 'ENOENT', path: 'security', message: 'not found' } }]);
  const s = createSecretStore({ platform: 'darwin', exec });
  await assert.rejects(() => s.get(ACCT), (e) => {
    assert.equal(e.code, 'KEYCHAIN_UNAVAILABLE');
    assert.ok(/security/.test(e.reason));
    return true;
  });
});

test('get:macOS 未命中(stderr could not be found)→ SECRET_NOT_FOUND', async () => {
  const exec = mockExec([{ throw: { code: 1, stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found.' } }]);
  const s = createSecretStore({ platform: 'darwin', exec });
  await assert.rejects(() => s.get(ACCT), (e) => e.code === 'SECRET_NOT_FOUND');
});

test('set:失败一律 KEYCHAIN_UNAVAILABLE(绝不回退明文)', async () => {
  const exec = mockExec([{ throw: { code: 'other', stderr: 'user interaction not allowed (keychain locked)' } }]);
  const s = createSecretStore({ platform: 'darwin', exec });
  await assert.rejects(() => s.set(ACCT, 'sk-ant'), (e) => {
    assert.equal(e.code, 'KEYCHAIN_UNAVAILABLE');
    assert.ok(/keychain locked/.test(e.reason));
    return true;
  });
});

test('KeychainError.toJSON → 结构化 {code,reason}', () => {
  const e = new KeychainError('KEYCHAIN_UNAVAILABLE', 'locked');
  assert.deepEqual(e.toJSON(), { code: 'KEYCHAIN_UNAVAILABLE', reason: 'locked' });
});

// —— available() ——
test('available:ENOENT → false;非 ENOENT(哨兵未命中)→ true', async () => {
  const s1 = createSecretStore({ platform: 'darwin', exec: mockExec([{ throw: { code: 'ENOENT' } }]) });
  assert.equal(await s1.available(), false);
  const s2 = createSecretStore({ platform: 'darwin', exec: mockExec([{ throw: { code: 1, stderr: 'could not be found' } }]) });
  assert.equal(await s2.available(), true);
  const s3 = createSecretStore({ platform: 'darwin', exec: mockExec([{ stdout: 'x' }]) });
  assert.equal(await s3.available(), true);
});

test('available:linux 哨兵用 lookup 命令(证明工具探测路径正确)', async () => {
  const exec = mockExec([{ throw: { code: 1 } }]);
  const s = createSecretStore({ platform: 'linux', exec });
  await s.available();
  assert.equal(exec.calls[0].file, 'secret-tool');
  assert.deepEqual(exec.calls[0].args, ['lookup', 'service', SVC, 'account', '__ccwc_probe__']);
});
