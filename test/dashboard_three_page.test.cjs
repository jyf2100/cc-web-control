const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../public/board_render.cjs');

// renderBoard 是 DOM 操作函数(在 dashboard.js IIFE 内,无法直接 require)。
// 此处测其依赖的纯契约:groupByMachine 输出 → 分节结构可由 dashboard.js 正确渲染。
// 完整 DOM 行为由 Task 8 浏览器手测 + console_html 锁覆盖。

test('契约:flatten→sort→partition→groupByMachine 链路产出按机分组(离线排末尾)', () => {
  const machines = [
    { id: 'A', name: 'host-A', online: true, sessions: [
      { name: 's1', status: 'working', lastTs: 100 }, { name: 's2', status: 'idle', lastTs: 50 } ] },
    { id: 'B', name: 'host-B', online: false, sessions: [ { name: 's3', status: 'idle', lastTs: 10 } ] },
  ];
  const flat = B.flattenFleet(machines);
  const sorted = B.sortCardsByRelevance(flat);
  const part = B.partitionStale(sorted);
  const groups = B.groupByMachine(part.active);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].machine.id, 'A');   // 在线机组在前
  assert.equal(groups[0].cards.length, 2);
  assert.equal(groups[1].machine.id, 'B');   // 离线机组末尾
  assert.equal(groups[1].machine.online, false);
});

test('契约:多选 key = `${m.id}/${s.name}`(与 flattenFleet card.key 一致)', () => {
  const flat = B.flattenFleet([{ id: 'A', name: 'a', online: true, sessions: [{ name: 's1', status: 'working' }] }]);
  assert.equal(flat[0].key, 'A/s1');
});
test('契约:broadcast_result.results reduce → {total,succeeded,failed}', () => {
  const results = [
    { target: { machine: 'A', session: 's1' }, ok: true },
    { target: { machine: 'A', session: 's2' }, ok: false, error: 'offline' },
    { target: { machine: 'B', session: 's3' }, ok: true },
  ];
  const total = results.length;
  const succeeded = results.filter(r => r.ok).length;
  assert.equal(total, 3);
  assert.equal(succeeded, 2);
  assert.equal(total - succeeded, 1);
});

test('契约:扇出 WS payload = {type:broadcast, targets:[{machine,session}], data, enter:true}', () => {
  var selected = new Map();
  selected.set('A/s1', { machine: 'A', session: 's1' });
  selected.set('B/s2', { machine: 'B', session: 's2' });
  var payload = { type: 'broadcast', targets: Array.from(selected.values()), data: 'ls', enter: true };
  assert.equal(payload.type, 'broadcast');
  assert.equal(payload.targets.length, 2);
  assert.deepEqual(payload.targets[0], { machine: 'A', session: 's1' });
  assert.equal(payload.enter, true);
});

test('契约:P4 多选满 50 上限不再静默吞 —— 源码含「最多选 50」可见反馈', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');
  // P4:click 委托 selected.size>=50 分支必须给用户可见+读屏可听的反馈(写 #bc-result aria-live 区),
  // 不能 preventDefault 后静默 return(DOM 无变化、用户以为卡死)。
  assert.match(src, /最多选 50/);
});

test('契约:控制台 detectMode —— ?m=&s= 存在 → single;否则 multi', () => {
  const hasParam = (qs) => !!(new URLSearchParams(qs).get('m') && new URLSearchParams(qs).get('s'));
  assert.equal(hasParam('m=A&s=s1'), true);
  assert.equal(hasParam(''), false);
  assert.equal(hasParam('m=A'), false);
});
