'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _sig, classifyOutcome, AgentDispatcher } = require('../hub/agent_dispatcher.cjs');

// --- _sig 规约 ---
test('_sig: 剥 ISO 时间戳/run-id/孤立数字,折叠空白,小写', () => {
  assert.equal(_sig('Error 503 at 2026-07-03T10:22:31Z run-61246'), 'error at');
  assert.equal(_sig('Error 503 at 2026-07-03T10:23:02Z run-61247'), 'error at');
});

test('_sig: 孤立数字(行号/计数)被剥', () => {
  assert.equal(_sig('panic: nil pointer at line 42'), 'panic: nil pointer at line');
  assert.equal(_sig('panic: segfault at line 88'), 'panic: segfault at line');
});

test('_sig: 不同症状产生不同签名(nil pointer ≠ segfault)', () => {
  assert.notEqual(_sig('panic: nil pointer at line 42'), _sig('panic: segfault at line 88'));
});

test('_sig: 短行(length<4)→ null(保守放行不抑制)', () => {
  assert.equal(_sig('ok'), null);
  assert.equal(_sig('hi'), null);
  assert.equal(_sig('err'), null);
});

test('_sig: 空串/非 string → null', () => {
  assert.equal(_sig(''), null);
  assert.equal(_sig(null), null);
  assert.equal(_sig(undefined), null);
  assert.equal(_sig(123), null);
});

test('_sig: unix 时间戳(10-13 位)被剥', () => {
  assert.equal(_sig('failed at 1751543051'), 'failed at');
});

// --- classifyOutcome 规约 ---
test('classifyOutcome: noop 前缀(大小写不敏感)', () => {
  assert.equal(classifyOutcome('NOOP: 同一 503 持续'), 'noop');
  assert.equal(classifyOutcome('noop nothing new'), 'noop');
});

test('classifyOutcome: advised 前缀', () => {
  assert.equal(classifyOutcome('advised: 重启 agent'), 'advised');
});

test('classifyOutcome: 其余/空 → unknown', () => {
  assert.equal(classifyOutcome('建议重启'), 'unknown');
  assert.equal(classifyOutcome(''), 'unknown');
  assert.equal(classifyOutcome(null), 'unknown');
  assert.equal(classifyOutcome(undefined), 'unknown');
});

// --- sig-gate enqueue + _repeat + _realEnqueue + _gcRepeat ---

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
function stubTmux() { const pokes = []; return { pokes, poke: async (s, msg) => { pokes.push(msg); } }; }
function memAudit() { const entries = []; return { entries, log: async (e) => { entries.push(e); return e; } }; }
const ev = (session, lastLine, to = 'errored') => ({ machine: 'm', session, to, lastLine });

test('sig-gate: 首见 sig → poke + 建 repeater', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246'));
  await tick();
  assert.equal(tmux.pokes.length, 1);
  assert.ok(d._repeat.has('m|s1'));
});

test('sig-gate: sig 相同 + 未到 rePokeAfterMs → 不 poke,审计 repeat_suppressed', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:23:02Z run-61247')); await tick(); // 同 sig
  assert.equal(tmux.pokes.length, 1);
  assert.ok(audit.entries.some((e) => e.event === 'repeat_suppressed'));
});

test('sig-gate: sig 相同 + 到 rePokeAfterMs → poke(定期重看)', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 1 }); // 1ms 极易到期
  d.enqueue(ev('s1', 'panic: nil pointer at line 42')); await tick();
  await tick(5);
  d.enqueue(ev('s1', 'panic: nil pointer at line 99')); await tick(); // 同 sig,已到期
  assert.equal(tmux.pokes.length, 2);
});

test('sig-gate: sig 变化 → poke + onProblemChanged 回调 + repeater.sig 更新', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const changed = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000,
    onProblemChanged: (m, s) => { changed.push(`${m}/${s}`); } });
  d.enqueue(ev('s1', 'panic: nil pointer at line 42')); await tick();
  d.enqueue(ev('s1', 'panic: segfault at line 88')); await tick(); // 不同 sig
  assert.equal(tmux.pokes.length, 2);
  assert.deepEqual(changed, ['m/s1']);
  assert.equal(d._repeat.get('m|s1').sig, 'panic: segfault at line');
});

test('sig-gate: sig=null(短行/空)→ 放行不抑制', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'x')); await tick();
  d.enqueue(ev('s1', 'x')); await tick(); // 短行 → null → 放行
  assert.equal(tmux.pokes.length, 2);
  assert.equal(d._repeat.size, 0); // null 不建 repeater
});

test('_gcRepeat: 超 resolveMs 的 repeater 被清', () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, resolveMs: 1 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246'));
  return (async () => {
    await tick(5);
    d.enqueue(ev('s2', 'another error here')); // 触发 _gcRepeat,s1 已超 resolveMs=1
    assert.equal(d._repeat.has('m|s1'), false);
    assert.equal(d._repeat.has('m|s2'), true);
  })();
});

// --- ack 回填 lastOutcome + onStaleAck 正向反馈 ---

test('ack: NOOP outcome → 触发 onStaleAck + 回填 lastOutcome', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const stale = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000,
    onStaleAck: (m, s) => { stale.push(`${m}/${s}`); } });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  const rid = d._current.runId;
  await d.ack(rid, 'NOOP: 同一 503,已建议过');
  assert.deepEqual(stale, ['m/s1']);
  assert.equal(d._repeat.get('m|s1').lastOutcome, 'NOOP: 同一 503,已建议过');
});

test('ack: advised outcome → 不触发 onStaleAck + 回填 lastOutcome', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const stale = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000,
    onStaleAck: () => { stale.push('x'); } });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  const rid = d._current.runId;
  await d.ack(rid, 'advised: 重启 agent');
  assert.equal(stale.length, 0);
  assert.equal(d._repeat.get('m|s1').lastOutcome, 'advised: 重启 agent');
});

test('ack: 未知 runId → ack_stale,不回填不反馈', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const stale = [];
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000,
    onStaleAck: () => { stale.push('x'); } });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  await d.ack('run-bogus', 'NOOP: x');
  assert.equal(stale.length, 0);
  assert.ok(audit.entries.some((e) => e.event === 'ack_stale'));
});

// --- _realEnqueue 同 target 短路(re-poke)回归护栏 ---

test('same-target 短路: _current 同 target + sig 变化 → 刷新 event + 同 runId + 重置 ack 定时器', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'panic: nil pointer at line 42')); await tick();
  const firstRunId = d._current.runId;
  const firstTimer = d._current.timer;
  // 同 target、新症状(sig 变化 → 通过 gate → _realEnqueue 命中短路)
  d.enqueue(ev('s1', 'panic: segfault at line 88')); await tick();
  assert.equal(tmux.pokes.length, 2, 're-poke 发生');
  assert.equal(d._current.runId, firstRunId, 'runId 不变(不产生孤立 ack)');
  assert.notEqual(d._current.timer, firstTimer, 'ack 定时器已重置');
  assert.equal(d._current.event.lastLine, 'panic: segfault at line 88', 'event 刷新为最新症状');
});

test('same-target 短路不被误触发: 同 target + 同 sig 未到期 → repeat_suppressed 拦截,不 re-poke', async () => {
  const tmux = stubTmux(); const audit = memAudit();
  const d = new AgentDispatcher({ tmux, audit, session: 's', ackTimeoutMs: 60_000, rePokeAfterMs: 900_000 });
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:22:31Z run-61246')); await tick();
  // 同 target、同 sig、未到期 → enqueue 层 repeat_suppressed,_realEnqueue 根本不调用
  d.enqueue(ev('s1', 'Error 503 at 2026-07-03T10:23:02Z run-61247')); await tick();
  assert.equal(tmux.pokes.length, 1, '短路未触发(被 sig-gate 拦截)');
  assert.ok(audit.entries.some((e) => e.event === 'repeat_suppressed'));
});
