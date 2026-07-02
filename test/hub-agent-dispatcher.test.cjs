'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AgentDispatcher } = require('../hub/agent_dispatcher.cjs');

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
function stubTmux() { const pokes = []; return { pokes, poke: async (s, msg) => { pokes.push(msg); } }; }
function memAudit() { const entries = []; return { entries, log: async (e) => { entries.push(e); return e; } }; }
const ev = (session, to) => ({ machine: 'm', session, to, lastLine: 'x' });

test('enqueue → poke 一次,dequeueEvent 返回当前事件', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000 });
  d.enqueue(ev('s1', 'errored'));
  await tick();
  assert.equal(tmux.pokes.length, 1);
  assert.match(tmux.pokes[0], /dequeue_event/);
  const item = await d.dequeueEvent();
  assert.equal(item.event.session, 's1');
  assert.ok(item.runId.startsWith('run-'));
});

test('ack(runId) → 出队下一条(串行)', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000 });
  d.enqueue(ev('s1', 'errored'));
  d.enqueue(ev('s2', 'idle'));
  await tick();
  assert.equal(tmux.pokes.length, 1); // 串行:第二条排队
  const rid = d._current.runId;
  await d.ack(rid, 'advised: ...');
  await tick();
  assert.equal(tmux.pokes.length, 2);
});

test('超时:重 poke 至 maxRetries 后丢弃', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 20, maxRetries: 1 });
  d.enqueue(ev('s1', 'errored'));
  await tick(8);   // 首次 poke (retry 0)
  assert.equal(tmux.pokes.length, 1);
  await tick(30);  // 超时 → retry 1 poke
  assert.equal(tmux.pokes.length, 2);
  await tick(30);  // 再超时 → retry 2 > maxRetries → 丢弃
  assert.equal(tmux.pokes.length, 2);
  assert.equal(d._current, null);
  assert.ok(audit.entries.some((e) => e.event === 'ack_timeout_drop'));
});

test('队列按优先级取(errored 先于 idle)', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000 });
  d.enqueue(ev('occupy', 'errored')); await tick(); // 占住 current
  d.enqueue(ev('idle1', 'idle'));
  d.enqueue(ev('err1', 'errored'));
  await d.ack(d._current.runId, 'ok'); await tick();
  const targets = audit.entries.filter((e) => e.event === 'dequeue').map((e) => e.detail.target);
  assert.equal(targets[1], 'm/err1'); // 解锁后先取 errored
});

test('队列满:合并同 target,不丢;不同 target 丢最旧+告警', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, maxQueue: 2 });
  d.enqueue(ev('a', 'errored')); await tick(); // current=a, queue=[]
  d.enqueue(ev('b', 'idle'));                  // queue=[b]
  d.enqueue(ev('c', 'errored'));               // queue=[b,c] (满)
  d.enqueue(ev('b', 'errored'));               // 同 target b → 替换,无 drop
  let drops = audit.entries.filter((e) => e.event === 'queue_overflow_drop').length;
  assert.equal(drops, 0);
  d.enqueue(ev('d', 'idle'));                  // 满 + 不同 target → 丢最旧
  drops = audit.entries.filter((e) => e.event === 'queue_overflow_drop').length;
  assert.equal(drops, 1);
});

test('freeze 不再 enqueue,unfreeze 恢复', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000 });
  d.freeze();
  assert.equal(d.enqueue(ev('s1', 'errored')), false);
  d.unfreeze();
  assert.equal(d.enqueue(ev('s1', 'errored')), true);
});
