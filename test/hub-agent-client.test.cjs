const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentClient } = require('../hub/agent_client.cjs');
const { StubMachine } = require('./stub_machine.cjs');

const WAIT = 120; // WS 握手/消息往返等待 ms(时序敏感,可调)

test('fetchDashboard 带透传 token,返回 payload', async () => {
  const stub = await new StubMachine({ token: 'secret', dashboardPayload: { tmuxOk: true, sessions: [{ name: 's1', cwd: '/a', status: 'idle', lastLine: '', lastTs: 0, attached: false }] } }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 'secret' });
    const r = await ac.fetchDashboard();
    assert.equal(r.ok, true);
    assert.equal(r.payload.sessions[0].name, 's1');
  } finally { await stub.stop(); }
});

test('fetchDashboard token 错 → ok:false 401', async () => {
  const stub = await new StubMachine({ token: 'right' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 'wrong' });
    const r = await ac.fetchDashboard();
    assert.equal(r.ok, false);
    assert.match(r.error, /401/);
  } finally { await stub.stop(); }
});

test('fetchDashboard 连接失败 → ok:false', async () => {
  const ac = new AgentClient({ id: 'mc1', url: 'http://127.0.0.1:1', token: 't' });
  const r = await ac.fetchDashboard();
  assert.equal(r.ok, false);
});

test('attachSession 懒建 WS,收到 init 后回调,引用计数共享', async () => {
  const stub = await new StubMachine({ token: 't' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 't' });
    const inboxA = [];
    const refA = ac.attachSession('s1', (msg) => inboxA.push(msg));
    await refA.once('open'); // 等连接建立 + init
    assert.ok(inboxA.some((m) => m.type === 'init'));
    // 同 session 第二个订阅者复用同一条连接
    const inboxB = [];
    // 注:保存 refB 并在末尾 detach,确保 WS 引用计数归零、连接关闭;
    // 否则 Node 的 server.close() 会因存在打开的 WS 连接而无法完成 callback,
    // 导致 stub.stop() 悬挂(spec 作者注里提到的"为避免悬挂"的严谨写法)。
    const refB = ac.attachSession('s1', (msg) => inboxB.push(msg));
    assert.equal(ac._poolSize('s1'), 1); // 仍是同一条 WS
    // 发 input 经透传到 stub
    refA.send({ type: 'input', data: 'hello', enter: true });
    await new Promise((r) => setTimeout(r, WAIT));
    assert.ok(stub.received.some((m) => m.type === 'input' && m.data === 'hello'));
    // detach 归零 → WS 关闭(引用计数:两个订阅者都 detach 才归零)
    refA.detach();
    refB.detach();
    assert.equal(ac._poolSize('s1'), 0); // 引用归零,池已清空
    await new Promise((r) => setTimeout(r, WAIT));
  } finally { await stub.stop(); }
});

test('sendOneShot 临时连接发完即关(用于 broadcast)', async () => {
  const stub = await new StubMachine({ token: 't' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 't' });
    await ac.sendOneShot('sX', { type: 'input', data: 'boom', enter: true });
    await new Promise((r) => setTimeout(r, WAIT));
    assert.ok(stub.received.some((m) => m.type === 'input' && m.data === 'boom' && m.session === 'sX'));
    assert.equal(ac._poolSize('sX'), 0); // 不留连接
  } finally { await stub.stop(); }
});

test('close() 关闭所有池连接 + 清 retry timer', async () => {
  const stub = await new StubMachine({ token: 't' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 't' });
    const refA = ac.attachSession('s1', () => {});
    const refB = ac.attachSession('s2', () => {});
    await refA.once('open');
    await refB.once('open');
    assert.equal(ac._poolSize('s1'), 1);
    assert.equal(ac._poolSize('s2'), 1);
    ac.close();
    assert.equal(ac._poolSize('s1'), 0);
    assert.equal(ac._poolSize('s2'), 0);
  } finally { await stub.stop(); }
});

test('断线后仍有订阅者 → 调度重连(引用未归零不清理)', async () => {
  const stub = await new StubMachine({ token: 't' }).start();
  try {
    const ac = new AgentClient({ id: 'mc1', url: stub.url, token: 't' });
    const ref = ac.attachSession('s1', () => {});
    await ref.once('open');
    // 模拟断线:直接关底层 ws(不 detach,保留订阅者)
    const entry = ac._pool.get('s1');
    entry.ws.close();
    await new Promise((r) => setTimeout(r, WAIT));
    // 仍有订阅者 → entry 未清理,且已调度重连 timer
    assert.equal(ac._poolSize('s1'), 1);
    assert.equal(ac._hasReconnectTimer('s1'), true);
    ref.detach(); // 归零 → 清 retry + 关 ws + 删 entry
    ac.close();
  } finally { await stub.stop(); }
});
