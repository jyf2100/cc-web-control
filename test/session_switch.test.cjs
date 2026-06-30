const { test } = require('node:test');
const assert = require('node:assert');
const { switchSession } = require('../public/session_switch.cjs');

test('switchSession 扇出副作用并返回 true', () => {
  const calls = [];
  const deps = {
    setUrl: s => calls.push(['setUrl', s]),
    store: s => calls.push(['store', s]),
    updateUi: () => calls.push(['updateUi']),
    syncProject: () => calls.push(['syncProject']),
    clearOutput: () => calls.push(['clearOutput']),
    hideQuickReply: () => calls.push(['hideQuickReply']),
    connect: () => calls.push(['connect']),
    note: m => calls.push(['note', m]),
  };
  const r = switchSession({ target: 'b', current: 'a' }, deps);
  assert.equal(r, true);
  assert.deepEqual(calls.map(c => c[0]), ['setUrl','store','updateUi','syncProject','clearOutput','hideQuickReply','connect','note']);
});

test('target===current 返回 false 且不调任何 fn', () => {
  let threw = false;
  const deps = { setUrl:()=>{threw=true;}, store:()=>{threw=true;}, updateUi:()=>{threw=true;}, syncProject:()=>{threw=true;}, clearOutput:()=>{threw=true;}, hideQuickReply:()=>{threw=true;}, connect:()=>{threw=true;}, note:()=>{threw=true;} };
  const r = switchSession({ target: 'a', current: 'a' }, deps);
  assert.equal(r, false);
  assert.equal(threw, false);
});

test('空 target / 非法 ctx 安全降级返回 false', () => {
  assert.equal(switchSession({ target: '', current: 'a' }, {}), false);
  assert.equal(switchSession(null, {}), false);
});

test('deps 缺失 fn 不抛', () => {
  assert.doesNotThrow(() => switchSession({ target: 'b', current: 'a' }, {}));
  assert.doesNotThrow(() => switchSession({ target: 'b', current: 'a' }, { setUrl: 'notfn' }));
});
