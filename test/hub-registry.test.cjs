const test = require('node:test');
const assert = require('node:assert/strict');
const { MachineRegistry } = require('../hub/registry.cjs');

const MACHINES = [
  { id: 'mc1', name: 'A', url: 'http://1:7684', token: 't1' },
  { id: 'mc2', name: 'B', url: 'http://2:7684', token: 't2' },
];

test('构造持有清单,初始 online=false', () => {
  const r = new MachineRegistry(MACHINES);
  assert.equal(r.all().length, 2);
  assert.equal(r.getById('mc1').online, false);
});

test('getById 未知名返回 undefined', () => {
  const r = new MachineRegistry(MACHINES);
  assert.equal(r.getById('nope'), undefined);
});

test('setOnline 更新状态且不可变原始清单', () => {
  const r = new MachineRegistry(MACHINES);
  r.setOnline('mc1', true);
  assert.equal(r.getById('mc1').online, true);
  assert.equal(MACHINES[0].online, undefined); // 未污染入参
});

test('snapshot 含 online 字段', () => {
  const r = new MachineRegistry(MACHINES);
  r.setOnline('mc1', true);
  const snap = r.snapshot();
  assert.equal(snap.length, 2);
  const mc1 = snap.find((m) => m.id === 'mc1');
  assert.equal(mc1.online, true);
  assert.equal(mc1.token, undefined); // snapshot 不外泄 token
});
