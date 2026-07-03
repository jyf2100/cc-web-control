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
  c.close();
});

test('R2-H1 kill 回收:capture 抛错 → subs 收 error + 四件套清池(新 attach 重建,不重放陈旧帧)', async () => {
  const lt = {
    capture: async () => { throw new Error('session not found'); },
    hasOwnedSession: async () => false,
  };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 5 });
  const got = [];
  c.attach('s', (m) => got.push(m));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(got.some((m) => m.type === 'error' && /session ended|not found/i.test(m.data)), '收 error 帧');
  assert.equal(c._pool.size, 0, 'pool entry 已完整回收');
  c.close();
});

test('R3-M1 entryId 身份比对:capture in-flight 期间 detach + 重 attach → 旧回调不误伤新 entry', async () => {
  const controls = [];
  const lt = {
    capture: () => new Promise((res, rej) => { controls.push({ res, rej }); }),
    hasOwnedSession: async () => true,
  };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), pollMs: 1000 });
  const h1 = c.attach('s', () => {});   // controls[0] = {res1,rej1} for entry id=1
  h1.detach();                          // entry1 删除;但其 capture promise 仍悬着
  c.attach('s', () => {});              // controls[1] for entry id=2(新 entry)
  const newId = c._pool.get('s').id;
  controls[0].rej(new Error('old killed')); // 旧 capture(id=1)reject → 其 .catch 以 entryId=1 运行
  await new Promise((r) => setTimeout(r, 10));
  const after = c._pool.get('s');
  assert.ok(after && after.id === newId, '新 entry 未被旧回调误删');
  assert.ok(after.subs.size >= 1, '新订阅仍在');
  c.close();
});

test('M7/L1 send 审计 scope=local_tmux via=ws;sendOneShot via=broadcast', async () => {
  const lt = stubLocalTmux();
  const audit = memAudit();
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit });
  const h = c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.send({ type: 'input', data: 'x' }), false);
  assert.equal(h.send({}), false);
  await c.sendOneShot({}, {});
  assert.ok(audit.entries.some((e) => e.scope === 'local_tmux' && e.event === 'input_ignored' && e.detail.via === 'ws'));
  assert.ok(audit.entries.some((e) => e.scope === 'local_tmux' && e.event === 'input_ignored' && e.detail.via === 'broadcast'));
  c.close();
});

test('L2 redact:capture 含 CC_WEB_HUB_TOKEN → init data 已 <redacted>', async () => {
  const lt = { capture: async () => 'env CC_WEB_HUB_TOKEN=sk-secret123 done', hasOwnedSession: async () => true };
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit() });
  const got = [];
  c.attach('s', (m) => got.push(m));
  await new Promise((r) => setTimeout(r, 10));
  const init = got.find((m) => m.type === 'init');
  assert.ok(init.data.includes('<redacted>'));
  assert.ok(!init.data.includes('sk-secret123'));
  c.close();
});

test('subs 上限:第 11 个 attach 被拒(返回 dummy,不加入)', async () => {
  const lt = stubLocalTmux();
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), maxSubs: 10 });
  for (let i = 0; i < 10; i++) c.attach('s', () => {});
  const before = c._pool.get('s').subs.size;
  const over = c.attach('s', () => {});
  assert.equal(c._pool.get('s').subs.size, before, '第 11 个未加入');
  assert.equal(over.send({}), false); // dummy
  c.close();
});

test('subs 上限(回放分支):首 capture resolve 后第 11 个 attach 走回放分支被拒', async () => {
  const lt = stubLocalTmux(); lt.setCaptures(['FRAME']);
  const c = new LocalTmuxClient({ localTmux: lt, sessionName: 's', audit: memAudit(), maxSubs: 10 });
  for (let i = 0; i < 10; i++) c.attach('s', () => {});
  await new Promise((r) => setTimeout(r, 10)); // 让首 capture resolve → lastCaptured != null
  const entry = c._pool.get('s');
  assert.ok(entry && entry.lastCaptured != null, '已进入回放分支前提(lastCaptured 已填)');
  const before = entry.subs.size;
  const over = c.attach('s', () => {});
  assert.equal(c._pool.get('s').subs.size, before, '回放分支第 11 个未加入');
  assert.equal(over.send({}), false); // dummy
  c.close();
});
