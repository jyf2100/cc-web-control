'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalTmuxClient } = require('../hub/local_tmux_client.cjs');

// stub localTmux:capture 可推序列;audit 记录
function stubLocalTmux() {
  const seq = [];
  let i = 0;
  return {
    seq,
    setCaptures(arr) { seq.push(...arr); },
    capture: async () => { const v = seq.length ? seq[i++ % seq.length] : 'FRAME'; return v; },
    hasOwnedSession: async () => true,
  };
}
function memAudit() { const entries = []; return { entries, log: async (e) => { entries.push(e); return e; } }; }

test('构造缺参 → throw', () => {
  assert.throws(() => new LocalTmuxClient({}), /required/);
});

test('attach 首帧发 init(覆盖语义),用首 capture 的内容', async () => {
  const lt = stubLocalTmux(); lt.setCaptures(['HELLO']);
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 'cc-main-agent', audit: memAudit(), pollMs: 1000 });
  const got = [];
  c.attach('cc-main-agent', (m) => got.push(m));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(got.some((m) => m.type === 'init' && m.data === 'HELLO'));
  c.close();
});

test('session 不匹配 → onMsg error + 返回 dummy handle(非 null,空 send/detach)', async () => {
  const lt = stubLocalTmux();
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 'cc-main-agent', audit: memAudit() });
  const got = [];
  const h = c.attach('other', (m) => got.push(m));
  assert.ok(h && typeof h.send === 'function' && typeof h.detach === 'function', 'dummy handle');
  assert.equal(h.send({}), false);
  assert.ok(got.some((m) => m.type === 'error'));
  c.close();
});

test('H1 共享池:同 session 两次 attach 只起 1 个 capture 轮询;末订阅 detach 清 interval', async () => {
  let captureCalls = 0;
  const lt = { capture: async () => { captureCalls++; return 'F'; }, hasOwnedSession: async () => true };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 5 });
  const h1 = c.attach('s', () => {});
  const h2 = c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 20)); // 让 interval 跑几轮
  const callsAfterAttach = captureCalls;
  assert.ok(callsAfterAttach >= 1, '至少一次 capture');
  h1.detach();
  h2.detach();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(captureCalls, callsAfterAttach, 'detach 后 interval 清零,不再 capture');
  c.close();
});

test('close() 清池:之后 capture 不再触发(interval 已清)', async () => {
  let captureCalls = 0;
  const lt = { capture: async () => { captureCalls++; return 'F'; }, hasOwnedSession: async () => true };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 5 });
  c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 10));
  c.close();
  const before = captureCalls;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(captureCalls, before, 'close 后无 capture');
});
