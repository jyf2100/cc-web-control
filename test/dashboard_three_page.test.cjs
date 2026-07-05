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
