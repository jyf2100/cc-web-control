// test/hub-local-tmux.test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLocalTmux } = require('../hub/local_tmux.cjs');

function stubTmux() {
  const calls = [];
  let envOut = 'CC_WEB_OWNED=1';
  return {
    calls,
    sendKeys: async (s, k, o) => { calls.push({ fn: 'sendKeys', s, k, o }); return true; },
    capturePane: async (s, sb) => { calls.push({ fn: 'capturePane', s, sb }); return 'PANE'; },
    checkSession: async (s) => { calls.push({ fn: 'checkSession', s }); return true; },
    createSession: async (s, c) => { calls.push({ fn: 'createSession', s, c }); return true; },
    killSession: async (s) => { calls.push({ fn: 'killSession', s }); return true; },
    sendKey: async (s, k) => { calls.push({ fn: 'sendKey', s, k }); return true; },
    setEnv(v) { envOut = v; },
    setEnvThrow(e) { envOut = undefined; this._envErr = e; },
    showEnvironment: async (s, k) => {
      calls.push({ fn: 'showEnvironment', s, k });
      if (envOut === undefined) throw this._envErr || new Error('no such session');
      return envOut;
    },
  };
}

test('poke: 单行消息 → sendKeys 单次调用', async () => {
  const st = stubTmux();
  const lt = createLocalTmux({ tmux: st });
  await lt.poke('cc-main-agent', 'new event; call dequeue_event');
  assert.equal(st.calls.length, 1);
  assert.equal(st.calls[0].fn, 'sendKeys');
  assert.equal(st.calls[0].s, 'cc-main-agent');
  assert.equal(st.calls[0].k, 'new event; call dequeue_event');
  assert.equal(st.calls[0].o, undefined); // 默认带 Enter(根 tmux 行为)
});

test('poke: 拒绝多行消息', async () => {
  const lt = createLocalTmux({ tmux: stubTmux() });
  await assert.rejects(() => lt.poke('s', 'a\nb'), /single-line/);
});

test('capture: 透传 scrollback', async () => {
  const st = stubTmux();
  const lt = createLocalTmux({ tmux: st });
  const out = await lt.capture('s', 100);
  assert.equal(out, 'PANE');
  assert.equal(st.calls[0].sb, 100);
});

test('hasOwnedSession: CC_WEB_OWNED=1 → true', async () => {
  const st = stubTmux();
  const lt = createLocalTmux({ tmux: st });
  assert.equal(await lt.hasOwnedSession('cc-main-agent'), true);
  assert.equal(st.calls[0].fn, 'showEnvironment');
  assert.equal(st.calls[0].k, 'CC_WEB_OWNED');
});

test('hasOwnedSession: CC_WEB_OWNED=0 → false(R3-L2 防误判)', async () => {
  const st = stubTmux(); st.setEnv('CC_WEB_OWNED=0');
  const lt = createLocalTmux({ tmux: st });
  assert.equal(await lt.hasOwnedSession('s'), false);
});

test('hasOwnedSession: showEnvironment 抛错(session 不存在/无键)→ false', async () => {
  const st = stubTmux(); st.setEnvThrow(new Error("can't find session: nope"));
  const lt = createLocalTmux({ tmux: st });
  assert.equal(await lt.hasOwnedSession('nope'), false);
});
