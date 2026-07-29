'use strict';
// board_render.cjs 结构化状态机前端单测:归一 / flattenFleet.state / data-state / 状态过滤控件。
// 对应 PRD 验收 #4(看板按状态过滤)+ #5(结构化字段透传到卡片)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../public/board_render.cjs');

test('normalizeState:推断 status / 规范 state → 4 枚举;未知 → idle(AC1)', () => {
  assert.equal(B.normalizeState('working'), 'running');
  assert.equal(B.normalizeState('waiting'), 'awaiting-input');
  assert.equal(B.normalizeState('errored'), 'error');
  assert.equal(B.normalizeState('idle'), 'idle');
  assert.equal(B.normalizeState('unknown'), 'idle');
  // 已是规范状态 → 直通
  assert.equal(B.normalizeState('awaiting-input'), 'awaiting-input');
  // 垃圾/缺失 → idle
  assert.equal(B.normalizeState('bogus'), 'idle');
  assert.equal(B.normalizeState(undefined), 'idle');
  assert.equal(B.normalizeState(''), 'idle');
});

test('stateMeta:规范状态 → dot(复用 s-dot 令牌)+ 中文 label', () => {
  assert.equal(B.stateMeta('running').dot, 's-dot--working');
  assert.equal(B.stateMeta('awaiting-input').dot, 's-dot--waiting');
  assert.equal(B.stateMeta('error').dot, 's-dot--errored');
  assert.equal(B.stateMeta('idle').dot, 's-dot--idle');
  assert.equal(B.stateMeta('awaiting-input').cn, '等待输入');
});

test('collectStates:出现的状态去重 + 按 SESSION_STATES 序;离线机不计入', () => {
  const states = B.collectStates([
    { id: 'a', online: true, sessions: [
      { name: 's1', state: 'running' },
      { name: 's2', status: 'waiting' }, // 缺 state → 由 status 归一 awaiting-input
    ] },
    { id: 'b', online: true, sessions: [{ name: 's3', state: 'error' }] },
    { id: 'off', online: false, sessions: [{ name: 's4', state: 'idle' }] }, // 离线不计入
  ]);
  assert.deepEqual(states, ['running', 'awaiting-input', 'error']);
});

test('renderStatusFilter:≥2 种状态 → chip 行 + 「全部」 + 每状态内嵌 s-dot', () => {
  const machines = [
    { id: 'a', online: true, sessions: [{ name: 's1', state: 'running' }, { name: 's2', state: 'idle' }] },
  ];
  const html = B.renderStatusFilter(machines, null);
  assert.match(html, /<button[^>]*class="cli-filter__chip[^"]*cli-filter__chip--active"[^>]*data-status-filter=""/); // 全部 active
  assert.match(html, />全部</);
  assert.match(html, /data-status-filter="running"/);
  assert.match(html, /data-status-filter="idle"/);
  assert.match(html, /s-dot--working/); // running → working 色
  assert.match(html, /运行中/);          // 中文 label
});

test('renderStatusFilter:单状态 / 空 → 空串(无可区分性,省 UI)', () => {
  assert.equal(B.renderStatusFilter([{ id: 'a', online: true, sessions: [{ name: 's', state: 'idle' }] }], null), '');
  assert.equal(B.renderStatusFilter([], null), '');
});

test('renderStatusFilter:active 态落在选中状态 chip(非全部),aria-pressed 正确', () => {
  const machines = [
    { id: 'a', online: true, sessions: [{ name: 's1', state: 'running' }, { name: 's2', state: 'error' }] },
  ];
  const html = B.renderStatusFilter(machines, 'error');
  const allChip = html.match(/<button[^>]*data-status-filter=""[^>]*aria-pressed="([^"]*)"/);
  const errChip = html.match(/<button[^>]*data-status-filter="error"[^>]*aria-pressed="([^"]*)"/);
  assert.equal(allChip[1], 'false');
  assert.equal(errChip[1], 'true');
  assert.match(errChip[0], /cli-filter__chip--active/);
});

test('flattenFleet:卡片带 state(在线归一,离线 → 空)', () => {
  const cards = B.flattenFleet([
    { id: 'm1', online: true, sessions: [
      { name: 's1', status: 'working', state: 'running' },
      { name: 's2', status: 'waiting' }, // 缺 state → awaiting-input
    ] },
    { id: 'm2', online: false, sessions: [{ name: 's3', state: 'idle' }] },
  ]);
  assert.equal(cards[0].state, 'running');
  assert.equal(cards[0].session.state, 'running');
  assert.equal(cards[1].state, 'awaiting-input');
  assert.equal(cards[2].state, ''); // 离线机不参与状态过滤
});

test('buildCardRow:<li> 带 data-state(供状态过滤选择)', () => {
  const html = B.buildCardRow({ id: 'm1', name: 'a' }, { name: 's', status: 'waiting', state: 'awaiting-input' }, { mode: 'hub' });
  assert.match(html, /<li class="card-row"[^>]*data-state="awaiting-input"/);
  // 缺 state → 由 status 归一(waiting → awaiting-input)
  const html2 = B.buildCardRow({ id: 'm1', name: 'a' }, { name: 's', status: 'working' }, { mode: 'hub' });
  assert.match(html2, /data-state="running"/);
});
