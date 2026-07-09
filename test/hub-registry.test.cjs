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

test('all() 与 getById() 不泄露 token', () => {
  const r = new MachineRegistry(MACHINES);
  assert.equal(r.all()[0].token, undefined);
  assert.equal(r.getById('mc1').token, undefined);
  // getSecret 仍能取到 token
  assert.equal(r.getSecret('mc1').token, 't1');
});

test('MachineRegistry 动态 add/remove + conn 不外泄', () => {
  const r = new MachineRegistry([]); // 空
  const fakeConn = { alive: true };
  r.add({ id: 'dyn1', name: 'D1', url: 'http://h:1', token: 'secret' }, fakeConn);

  assert.equal(r.all().length, 1);
  const snap = r.all()[0];
  assert.equal(snap.id, 'dyn1');
  assert.equal(snap.token, undefined, 'all() 不含 token');
  assert.equal(snap.conn, undefined, 'all() 不含 conn');
  assert.equal(snap.online, false, 'add 后 online 初值 false（交 aggregator）');

  assert.deepEqual(r.getSecret('dyn1'), { id: 'dyn1', name: 'D1', url: 'http://h:1', token: 'secret' }, 'getSecret 含 token、不含 conn');

  // 重复 id 覆盖
  r.add({ id: 'dyn1', name: 'D1-new', url: 'http://h:2', token: 'secret2' }, { alive: true });
  assert.equal(r.all().length, 1);
  assert.equal(r.getById('dyn1').name, 'D1-new');

  r.remove('dyn1');
  assert.equal(r.all().length, 0);
  assert.equal(r.getSecret('dyn1'), undefined);
});
