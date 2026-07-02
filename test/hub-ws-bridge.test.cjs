const test = require('node:test');
const assert = require('node:assert/strict');
const { WsBridge } = require('../hub/ws_bridge.cjs');

function fakeBrowserWs() {
  const sent = [];
  const listeners = {};
  return {
    sent,
    readyState: 1,
    send: (s) => sent.push(JSON.parse(s)),
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: (ev, arg) => (listeners[ev] || []).forEach((fn) => fn(arg)),
    close: () => {},
  };
}

function fakeAgentFactory(handlers) {
  return { attach: handlers.attach, sendOneShot: handlers.sendOneShot, getById: handlers.getById };
}

test('attach → 订阅 agent,agent 消息转发给浏览器带 target', () => {
  let pushed;
  const bridge = new WsBridge({
    getClient: (mid) => fakeAgentFactory({
      getById: () => ({ id: mid }),
      attach: (session, onMsg) => { pushed = onMsg; return { detach() {}, send() { return true; }, once: () => Promise.resolve() }; },
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  pushed({ type: 'init', data: 'screen' });
  assert.deepEqual(ws.sent[0], { type: 'init', target: { machine: 'mc1', session: 's1' }, data: 'screen' });
});

test('input → 经当前 attach 的 handle 发送;未 attach 则 error', () => {
  let sentViaHandle = null;
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: (session, onMsg) => ({ detach() {}, send: (m) => { sentViaHandle = m; return true; }, once: () => Promise.resolve() }),
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  ws.emit('message', JSON.stringify({ type: 'input', target: { machine: 'mc1', session: 's1' }, data: 'hi', enter: true }));
  assert.deepEqual(sentViaHandle, { type: 'input', data: 'hi', enter: true });
  // 确认正常路径未误发 error(send 返回 true,不应触发 'session not connected')
  assert.equal(ws.sent.find((m) => m.type === 'error'), undefined);
});

test('broadcast 去重 + 扇出 + 上限 50 + 返回 broadcast_result', async () => {
  const shots = [];
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: () => ({ detach() {}, send: () => true, once: () => Promise.resolve() }),
      sendOneShot: async (session, msg) => { shots.push({ session, msg }); return { ok: true }; },
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  const targets = [
    { machine: 'mc1', session: 'a' },
    { machine: 'mc1', session: 'a' },
    { machine: 'mc1', session: 'b' },
  ];
  await bridge.handleBroadcast(ws, { targets, data: 'go', enter: true });
  assert.equal(shots.length, 2);
  const result = ws.sent.find((m) => m.type === 'broadcast_result');
  assert.equal(result.results.length, 2);
  assert.equal(result.results.every((r) => r.ok), true);

  const tooMany = Array.from({ length: 51 }, (_, i) => ({ machine: 'mc1', session: `s${i}` }));
  const ws2 = fakeBrowserWs();
  bridge.handleConnection(ws2);
  await bridge.handleBroadcast(ws2, { targets: tooMany, data: 'x', enter: true });
  const err = ws2.sent.find((m) => m.type === 'error');
  assert.match(err.data, /50/);
});

test('detach 清理订阅', () => {
  let detached = false;
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: () => ({ detach: () => { detached = true; }, send: () => true, once: () => Promise.resolve() }),
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  ws.emit('message', JSON.stringify({ type: 'detach' }));
  assert.equal(detached, true);
});

test('ws close 触发清理,后续 input 得 target not attached', () => {
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: () => ({ detach() {}, send: () => true, once: () => Promise.resolve() }),
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 's1' } }));
  ws.emit('close');
  ws.emit('message', JSON.stringify({ type: 'input', target: { machine: 'mc1', session: 's1' }, data: 'x', enter: true }));
  const err = ws.sent.find((m) => m.type === 'error');
  assert.match(err.data, /not attached/);
});

test('attach 切换:旧 handle detach + current 指向新 target', () => {
  let detachedOld = false;
  const bridge = new WsBridge({
    getClient: () => fakeAgentFactory({
      getById: () => ({ id: 'mc1' }),
      attach: (session) => ({
        detach: () => { if (session === 'old') detachedOld = true; },
        send: () => true,
        once: () => Promise.resolve(),
      }),
      sendOneShot: async () => ({ ok: true }),
    }),
  });
  const ws = fakeBrowserWs();
  bridge.handleConnection(ws);
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 'old' } }));
  ws.emit('message', JSON.stringify({ type: 'attach', target: { machine: 'mc1', session: 'new' } }));
  assert.equal(detachedOld, true);
  ws.emit('message', JSON.stringify({ type: 'input', target: { machine: 'mc1', session: 'old' }, data: 'x', enter: true }));
  const err = ws.sent.find((m) => m.type === 'error');
  assert.match(err.data, /not attached/);
});
