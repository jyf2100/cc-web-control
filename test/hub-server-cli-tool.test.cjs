'use strict';
// HTTP 集成:hub GET /api/sessions(列表/group_by/过滤/非法 400)+ /api/sessions/:machine
// + global-dashboard 透传 cli_tool。对应 PRD 验收 #1 / #3 / #4 / #7(HTTP 层)。
// 用 StubMachine 作被控机 + machines 文件带 cli_tool(aggregator 合并时打到 session)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cli-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function waitFor(fn, { timeoutMs = 3000, intervalMs = 30 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* 轮询抖动 */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`);
}

const AUTH = { headers: { Cookie: 'cc_web_hub_auth=hubtok' } };

// 起 hub + N 个 stub(stub 可指定 cli_tool 与会话列表)。每 stub → machines 文件一项(带 cli_tool)。
async function withCliHub(specs, fn) {
  const stubs = [];
  for (const spec of specs) {
    const stub = await new StubMachine({
      token: spec.token,
      dashboardPayload: { tmuxOk: true, sessions: spec.sessions || [] },
    }).start();
    stubs.push(stub);
  }
  const machines = specs.map((s, i) => ({
    id: s.id || `mc${i + 1}`, name: s.name || `M${i + 1}`, url: stubs[i].url, token: stubs[i].token, cli_tool: s.cli_tool,
  }));
  const { file, cleanup } = tmpMachinesFile(machines);
  const hub = await startHub({ machinesFile: file, hubToken: 'hubtok', host: '127.0.0.1', port: 0, intervalMs: 80 });
  try {
    await fn(hub, stubs);
  } finally {
    await hub.stop();
    for (const s of stubs) await s.stop();
    cleanup();
  }
}

test('GET /api/sessions 默认 → 全部会话(每条带 cli_tool/machine/machineName)', async () => {
  await withCliHub([
    { id: 'mc1', name: 'A', token: 't1', cli_tool: 'claude-code', sessions: [{ name: 's1', status: 'working', lastTs: 0 }] },
    { id: 'mc2', name: 'B', token: 't2', cli_tool: 'grok-build', sessions: [{ name: 'g1', status: 'idle', lastTs: 0 }] },
  ], async (hub) => {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${hub.port}/api/sessions`, AUTH)).ok);
    const body = await fetch(`http://127.0.0.1:${hub.port}/api/sessions`, AUTH).then((r) => r.json());
    assert.equal(body.sessions.length, 2);
    const g = body.sessions.find((s) => s.name === 'g1');
    assert.equal(g.cli_tool, 'grok-build');
    assert.equal(g.machine, 'mc2');
    assert.equal(g.machineName, 'B');
  });
});

test('GET /api/sessions?group_by=cli_tool → 每枚举计数(混合多工具校验)', async () => {
  // 验收 #3:4 种工具 + unknown,各注册 ≥1 session 后校验
  await withCliHub([
    { id: 'c1', token: 't1', cli_tool: 'claude-code', sessions: [{ name: 'a', status: 'idle' }, { name: 'b', status: 'idle' }, { name: 'c', status: 'idle' }] },
    { id: 'g1', token: 't2', cli_tool: 'grok-build', sessions: [{ name: 'g', status: 'idle' }] },
    { id: 'x1', token: 't3', cli_tool: 'codex', sessions: [{ name: 'x', status: 'idle' }] },
    { id: 'u1', token: 't4', cli_tool: 'cursor', sessions: [{ name: 'u', status: 'idle' }] },
  ], async (hub) => {
    const url = `http://127.0.0.1:${hub.port}/api/sessions?group_by=cli_tool`;
    await waitFor(async () => {
      const b = await fetch(url, AUTH).then((r) => r.json());
      return b && b.total >= 6;
    });
    const body = await fetch(url, AUTH).then((r) => r.json());
    assert.deepEqual(body.groups, { 'claude-code': 3, 'grok-build': 1, 'codex': 1, 'cursor': 1, 'unknown': 0 });
    assert.equal(body.total, 6);
  });
});

test('GET /api/sessions?cli_tool=grok-build → 仅 grok-build,零串标', async () => {
  await withCliHub([
    { id: 'c1', token: 't1', cli_tool: 'claude-code', sessions: [{ name: 'a', status: 'idle' }] },
    { id: 'g1', token: 't2', cli_tool: 'grok-build', sessions: [{ name: 'g', status: 'idle' }, { name: 'g2', status: 'idle' }] },
    { id: 'x1', token: 't3', cli_tool: 'codex', sessions: [{ name: 'x', status: 'idle' }] },
  ], async (hub) => {
    const url = `http://127.0.0.1:${hub.port}/api/sessions?cli_tool=grok-build`;
    await waitFor(async () => {
      const b = await fetch(url, AUTH).then((r) => r.json());
      return b && b.sessions && b.sessions.length === 2;
    });
    const body = await fetch(url, AUTH).then((r) => r.json());
    assert.equal(body.sessions.length, 2);
    assert.ok(body.sessions.every((s) => s.cli_tool === 'grok-build'), '过滤结果零串标');
  });
});

test('GET /api/sessions?cli_tool=foo(非法)→ 400 + 错误含合法枚举列表', async () => {
  // 验收 #4:非法枚举值 → 400 且错误消息含合法枚举列表
  await withCliHub([
    { id: 'c1', token: 't1', cli_tool: 'claude-code', sessions: [{ name: 'a', status: 'idle' }] },
  ], async (hub) => {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions?cli_tool=foo`, AUTH);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(/claude-code/.test(body.error) && /grok-build/.test(body.error), '错误消息含合法枚举');
    assert.deepEqual(body.allowed, ['claude-code', 'grok-build', 'codex', 'cursor', 'unknown']);
  });
});

test('GET /api/sessions/:machine → 该机 cli_tool 原样返回(持久化可取回)', async () => {
  // 验收 #1:agent 上报 cli_tool 后,经 hub 持久化可原样取回
  await withCliHub([
    { id: 'mc-grok', name: 'GrokBox', token: 't1', cli_tool: 'grok-build', sessions: [{ name: 's1', status: 'working' }] },
  ], async (hub) => {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${hub.port}/api/sessions/mc-grok`, AUTH)).ok);
    const body = await fetch(`http://127.0.0.1:${hub.port}/api/sessions/mc-grok`, AUTH).then((r) => r.json());
    assert.equal(body.cli_tool, 'grok-build');
    assert.equal(body.machine, 'mc-grok');
    assert.equal(body.sessions.length, 1);
  });
});

test('GET /api/sessions/:machine 未知名 → 404', async () => {
  await withCliHub([
    { id: 'mc1', token: 't1', cli_tool: 'claude-code', sessions: [] },
  ], async (hub) => {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/sessions/nope`, AUTH);
    assert.equal(res.status, 404);
  });
});

test('GET /api/global-dashboard:每条 session 带 cli_tool(与该机上报一致,不串标)', async () => {
  // 验收 #7:多机混合(≥2 种 cli_tool)聚合后,每条 session 工具与该机一致
  await withCliHub([
    { id: 'mc1', token: 't1', cli_tool: 'claude-code', sessions: [{ name: 's1', status: 'working', lastLine: 'x' }] },
    { id: 'mc2', token: 't2', cli_tool: 'grok-build', sessions: [{ name: 's2', status: 'idle' }] },
  ], async (hub) => {
    await waitFor(async () => {
      const b = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, AUTH).then((r) => r.json());
      return b && b.machines && b.machines.length === 2 && b.machines.every((m) => (m.sessions || []).length > 0);
    });
    const body = await fetch(`http://127.0.0.1:${hub.port}/api/global-dashboard`, AUTH).then((r) => r.json());
    const mc1 = body.machines.find((m) => m.id === 'mc1');
    const mc2 = body.machines.find((m) => m.id === 'mc2');
    assert.equal(mc1.cli_tool, 'claude-code');
    assert.equal(mc2.cli_tool, 'grok-build');
    assert.equal(mc1.sessions[0].cli_tool, 'claude-code'); // session 带机维度工具,不串标
    assert.equal(mc2.sessions[0].cli_tool, 'grok-build');
  });
});

test('GET /api/machines:静态 machines 文件带 cli_tool → 快照含 cli_tool', async () => {
  await withCliHub([
    { id: 'mc1', token: 't1', cli_tool: 'cursor', sessions: [] },
  ], async (hub) => {
    const body = await fetch(`http://127.0.0.1:${hub.port}/api/machines`, AUTH).then((r) => r.json());
    const mc1 = body.machines.find((m) => m.id === 'mc1');
    assert.equal(mc1.cli_tool, 'cursor');
  });
});
