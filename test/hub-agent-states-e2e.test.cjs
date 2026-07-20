'use strict';
// 端到端:单机 /api/dashboard payload.agents → hub 聚合 ingest → GET /api/agents 分组
//   + POST /api/agents/:id/transition(retry / 非法拒绝)。验证 wiring(AC2/3/4/7/8 集成链路)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startHub } = require('../hub/server.cjs');
const { StubMachine } = require('./stub_machine.cjs');
const { RegisterClient } = require('../register_client.cjs');

async function waitFor(fn, { timeoutMs = 4000, intervalMs = 30 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* 未就绪,继续 */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`);
}

async function startHubRetry(opts, retries = 6) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await startHub(opts); } catch (e) {
      lastErr = e;
      if (String(e.code || e.message || '').includes('EADDRINUSE')) {
        await new Promise((r) => setTimeout(r, 100)); continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function getAgents(hubPort) {
  const r = await fetch(`http://127.0.0.1:${hubPort}/api/agents`, { headers: { Authorization: 'Bearer ht' } });
  return r.json();
}

async function postTransition(hubPort, agentId, body) {
  return fetch(`http://127.0.0.1:${hubPort}/api/agents/${encodeURIComponent(agentId)}/transition`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ht',
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${hubPort}`, // same-origin(CSRF 校验)
    },
    body: JSON.stringify(body),
  });
}

// AC2/AC4 集成:1 机上报 3 agent(含多 agent /机)→ hub /api/agents 按 agent_id 聚合分组。
test('e2e AC2/AC4: 单机 payload.agents → hub 聚合 /api/agents 分组(多 agent / 机)', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-e2e-'));
  const hub = await startHubRetry({
    machinesFile: path.join(noneDir, 'none.json'),
    hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });

  const stub = await new StubMachine({
    token: 'at',
    dashboardPayload: {
      tmuxOk: true,
      sessions: [],
      agents: [
        { agent_id: 'm1-a', state: 'queued', messageCount: 2 },
        { agent_id: 'm1-b', state: 'running', messageCount: 5 },
        { agent_id: 'm1-c', state: 'failed', messageCount: 1 },
      ],
    },
  }).start();

  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'box1', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
  });
  rc.start();

  try {
    // 等聚合轮询拉到 stub dashboard 并 ingest ≤ ~2s(intervalMs=80 + 注册 + 回连)
    await waitFor(async () => {
      const d = await getAgents(hub.port);
      return d && d.total === 3;
    }, { timeoutMs: 4000 });

    const d = await getAgents(hub.port);
    assert.equal(d.total, 3);
    assert.equal(d.groups.queued, 1);
    assert.equal(d.groups.running, 1);
    assert.equal(d.groups.failed, 1);
    // 多 agent / 机 按 agent_id 区分,不合并
    const ids = d.agents.map((a) => a.agent_id).sort();
    assert.deepEqual(ids, ['m1-a', 'm1-b', 'm1-c']);
    // machine 标签一致(同机)
    assert.ok(d.agents.every((a) => a.machine === 'box1'));
    // messageCount 透传(AC5 联动)
    assert.equal(d.agents.find((a) => a.agent_id === 'm1-b').messageCount, 5);
  } finally {
    rc.close();
    await stub.stop();
    await hub.stop();
  }
});

// AC3/AC7 集成:POST retry → failed 迁回 queued ≤ ~1s(网络往返)+ 事件日志。
test('e2e AC7: POST /transition retry → failed→queued + 事件日志', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-e2e2-'));
  const hub = await startHubRetry({
    machinesFile: path.join(noneDir, 'none.json'),
    hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });

  const stub = await new StubMachine({
    token: 'at',
    dashboardPayload: {
      tmuxOk: true, sessions: [],
      agents: [{ agent_id: 'job-9', state: 'failed', messageCount: 0 }],
    },
  }).start();

  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'box2', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
  });
  rc.start();

  try {
    await waitFor(async () => (await getAgents(hub.port)).total === 1, { timeoutMs: 4000 });

    const t0 = Date.now();
    const res = await postTransition(hub.port, 'job-9', { event: 'retry' });
    const dt = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.ok(dt < 1000, `retry HTTP 往返 ${dt}ms 应 < 1s`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.agent.state, 'queued');
    assert.equal(body.event.trigger, 'retry');
    assert.equal(body.event.from, 'failed');
    assert.equal(body.event.to, 'queued');
    assert.equal(body.event.agent_id, 'job-9');

    // 聚合视图同步更新
    const d = await getAgents(hub.port);
    assert.equal(d.groups.queued, 1);
    assert.equal(d.groups.failed, 0);
    // 事件日志可见该次迁移
    assert.ok(d.events.some((e) => e.trigger === 'retry' && e.agent_id === 'job-9'));
  } finally {
    rc.close();
    await stub.stop();
    await hub.stop();
  }
});

// AC8 集成:completed --start_plan--> 409 拒绝,状态不变。
test('e2e AC8: POST 非法迁移 → 409 + 状态保留', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-e2e3-'));
  const hub = await startHubRetry({
    machinesFile: path.join(noneDir, 'none.json'),
    hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });

  const stub = await new StubMachine({
    token: 'at',
    dashboardPayload: {
      tmuxOk: true, sessions: [],
      agents: [{ agent_id: 'done-1', state: 'completed', messageCount: 3 }],
    },
  }).start();

  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'box3', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
  });
  rc.start();

  try {
    await waitFor(async () => (await getAgents(hub.port)).total === 1, { timeoutMs: 4000 });

    const res = await postTransition(hub.port, 'done-1', { event: 'start_plan' });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'illegal transition');
    // 状态保留 completed
    const d = await getAgents(hub.port);
    assert.equal(d.groups.completed, 1);
    assert.equal(d.agents.find((a) => a.agent_id === 'done-1').state, 'completed');

    // 未知 agent → 404
    const res2 = await postTransition(hub.port, 'ghost', { event: 'retry' });
    assert.equal(res2.status, 404);
    // 缺 event → 400
    const res3 = await postTransition(hub.port, 'done-1', {});
    assert.equal(res3.status, 400);
  } finally {
    rc.close();
    await stub.stop();
    await hub.stop();
  }
});
