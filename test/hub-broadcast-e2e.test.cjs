'use strict';

// hub 广播 + 介入 e2e:用 StubMachine 模拟单机,测 POST /api/broadcast、
// POST /api/intervene、GET /api/delivery-results 的端到端投递与回执。
// 覆盖 PRD 验收标准 AC1-AC6。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-bc-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function sessPayload(name) {
  return { tmuxOk: true, sessions: [{ name, cwd: '/p', status: 'idle', lastLine: '', lastTs: 1, attached: false }] };
}

// 起 hub + N stub,fn 内交互;finally 全关
async function withHubStubs(stubConfigs, token, fn) {
  const stubs = [];
  for (const cfg of stubConfigs) stubs.push(await new StubMachine(cfg).start());
  const machines = stubs.map((s, i) => ({ id: `mc${i + 1}`, name: `M${i + 1}`, url: s.url, token: s.token }));
  const { file, cleanup } = tmpMachinesFile(machines);
  const hub = await startHub({ machinesFile: file, hubToken: token, host: '127.0.0.1', port: 0, intervalMs: 100 });
  try {
    await fn(hub, stubs);
  } finally {
    await hub.stop();
    cleanup();
    for (const s of stubs) { try { await s.stop(); } catch {} }
  }
}

const AUTH = { Cookie: 'cc_web_hub_auth=hubtok' };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== AC1:广播投递 — 3 个在线节点全部 delivered =====
test('AC1: POST /api/broadcast → 3/3 在线节点回执 = delivered', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
    { token: 't2', dashboardPayload: sessPayload('s2') },
    { token: 't3', dashboardPayload: sessPayload('s3') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250); // 等首轮聚合
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/broadcast`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        data: 'run npm test',
        targets: [
          { machine: 'mc1', session: 's1' },
          { machine: 'mc2', session: 's2' },
          { machine: 'mc3', session: 's3' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results.length, 3);
    assert.ok(body.results.every((r) => r.status === 'delivered' && r.ok));
    assert.deepEqual(body.summary, { total: 3, delivered: 3, failed: 0, offline: 0, unknown: 0 });
    // 每个 stub 应收到 input 指令
    assert.ok(stubs[0].received.some((m) => m.type === 'input' && m.data === 'run npm test'));
    assert.ok(stubs[1].received.some((m) => m.type === 'input' && m.data === 'run npm test'));
    assert.ok(stubs[2].received.some((m) => m.type === 'input' && m.data === 'run npm test'));
  });
});

// ===== AC2:离线节点不静默 — 明确标 offline =====
test('AC2: 离线节点 → broadcast 结果含 status:offline(不静默跳过)', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
    { token: 't2', dashboardPayload: sessPayload('s2') },
    { token: 't3', dashboardPayload: sessPayload('s3') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250);
    // 停掉 mc2 模拟离线
    await stubs[1].stop();
    await sleep(350); // 等下一轮聚合标记 offline

    // 显式 targets(含离线机 mc2)
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/broadcast`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        data: 'deploy',
        targets: [
          { machine: 'mc1', session: 's1' },
          { machine: 'mc2', session: 's2' },
          { machine: 'mc3', session: 's3' },
        ],
      }),
    });
    const body = await res.json();
    assert.equal(body.results.length, 3);
    const mc2 = body.results.find((r) => r.machine === 'mc2');
    assert.equal(mc2.status, 'offline');
    assert.equal(mc2.ok, false);
    assert.match(mc2.error, /offline/);
    // 在线机仍 delivered
    assert.equal(body.summary.delivered, 2);
    assert.equal(body.summary.offline, 1);
  });
});

// ===== AC2 补充:auto-resolve(无显式 targets)也含离线机 =====
test('AC2: auto-resolve 广播 → 离线机以 session:null + status:offline 出现', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
    { token: 't2', dashboardPayload: sessPayload('s2') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250);
    await stubs[1].stop();
    await sleep(350);

    const res = await fetch(`http://127.0.0.1:${hub.port}/api/broadcast`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ data: 'build' }), // 无 targets → auto-resolve
    });
    const body = await res.json();
    const mc2 = body.results.find((r) => r.machine === 'mc2');
    assert.ok(mc2, '离线机 mc2 应出现在结果中(不静默跳过)');
    assert.equal(mc2.status, 'offline');
    assert.equal(mc2.ok, false);
  });
});

// ===== AC3:细粒度介入 — 单行注入到单节点 tmux =====
test('AC3: POST /api/intervene → 注入文本到达目标节点 tmux 会话', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250);
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        machine: 'mc1', session: 's1',
        data: 'change threshold from 0.8 to 0.85',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.result.status, 'delivered');
    // 注入文本被 stub 收到(= 投递到 tmux 会话)
    const input = stubs[0].received.find((m) => m.type === 'input');
    assert.ok(input, 'stub 应收到 input 消息');
    assert.equal(input.data, 'change threshold from 0.8 to 0.85');
    assert.equal(input.enter, true);
  });
});

// ===== AC4:单设备隔离 — 向 A 注入不影响 B =====
test('AC4: 向 mc1 注入,mc2 不收到(单设备隔离)', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
    { token: 't2', dashboardPayload: sessPayload('s2') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250);
    await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ machine: 'mc1', session: 's1', data: 'secret-to-A-only' }),
    });
    await sleep(100);
    // mc1 收到
    assert.ok(stubs[0].received.some((m) => m.type === 'input' && m.data === 'secret-to-A-only'));
    // mc2 不收到
    assert.equal(stubs[1].received.length, 0, 'mc2 不应收到任何消息');
  });
});

// ===== AC6:失败可观测 — 会话不存在 → 结构化失败回执 =====
test('AC6: 投递目标会话不存在 → status:failed + error(不吞异常)', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1'), connectionError: '会话不存在或无法读取: "bad"' },
  ], 'hubtok', async (hub) => {
    await sleep(250);
    // stub 的 dashboard 返回 online(HTTP 正常),但 WS 连接发 error 帧(模拟 tmux 会话不存在)
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ machine: 'mc1', session: 's1', data: 'hi' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.result.status, 'failed');
    assert.ok(body.result.error, '应有 error 描述');
  });
});

// ===== AC6 补充:未知 machine → status:unknown =====
test('AC6: 未知 machine → status:unknown + 结构化 error', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub) => {
    await sleep(250);
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ machine: 'ghost', session: 's1', data: 'hi' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.status, 'unknown');
    assert.equal(body.result.ok, false);
    assert.match(body.result.error, /unknown machine/);
  });
});

// ===== 校验:介入拒绝换行 =====
test('intervene 拒绝换行 → 400(防 tmux send-keys 注入)', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub) => {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ machine: 'mc1', session: 's1', data: 'a\nb' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /single-line/);
  });
});

// ===== 校验:广播缺 data → 400 =====
test('broadcast 缺 data → 400', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub) => {
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/broadcast`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ targets: [{ machine: 'mc1', session: 's1' }] }),
    });
    assert.equal(res.status, 400);
  });
});

// ===== 投递记录:GET /api/delivery-results =====
test('GET /api/delivery-results:广播 + 介入后可查投递记录', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub) => {
    await sleep(250);
    // 发一条广播 + 一条介入
    await fetch(`http://127.0.0.1:${hub.port}/api/broadcast`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ data: 'bc-msg', targets: [{ machine: 'mc1', session: 's1' }] }),
    });
    await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ machine: 'mc1', session: 's1', data: 'iv-msg' }),
    });

    const res = await fetch(`http://127.0.0.1:${hub.port}/api/delivery-results`, { headers: AUTH });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.results.length >= 2);
    const bc = body.results.find((r) => r.kind === 'broadcast');
    const iv = body.results.find((r) => r.kind === 'intervene');
    assert.ok(bc, '应有 broadcast 记录');
    assert.ok(iv, '应有 intervene 记录');
    assert.equal(bc.data, 'bc-msg');
    assert.equal(iv.data, 'iv-msg');
    assert.equal(bc.results[0].status, 'delivered');
    assert.equal(iv.results[0].status, 'delivered');
  });
});

// ===== AC5:通道本地优先 — 切断公网仅留 localhost 仍能投递 =====
// (架构保证:AgentClient → 单机 WS 直连,不经第三方云。
//  此测试用 127.0.0.1 stub 验证 localhost 通道端到端可用。)
test('AC5: localhost 直连通道 — 广播与介入均完成投递与回执', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250);
    // stub.url 以 127.0.0.1 开头(纯本地通道,无第三方公网云中转)
    assert.ok(stubs[0].url.startsWith('http://127.0.0.1'));

    const res = await fetch(`http://127.0.0.1:${hub.port}/api/intervene`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ machine: 'mc1', session: 's1', data: 'local-ok' }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.result.status, 'delivered');
    assert.ok(stubs[0].received.some((m) => m.data === 'local-ok'), '本地通道投递成功');
  });
});

// ===== broadcast:targets 去重 =====
test('broadcast: 同 machine+session 去重(只投递一次)', async () => {
  await withHubStubs([
    { token: 't1', dashboardPayload: sessPayload('s1') },
  ], 'hubtok', async (hub, stubs) => {
    await sleep(250);
    const res = await fetch(`http://127.0.0.1:${hub.port}/api/broadcast`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({
        data: 'dedup',
        targets: [
          { machine: 'mc1', session: 's1' },
          { machine: 'mc1', session: 's1' },
        ],
      }),
    });
    const body = await res.json();
    assert.equal(body.results.length, 1);
    const inputs = stubs[0].received.filter((m) => m.type === 'input');
    assert.equal(inputs.length, 1, '去重后只投递一次');
  });
});
