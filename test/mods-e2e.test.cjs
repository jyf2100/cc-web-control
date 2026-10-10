'use strict';
// mods 巡检端到端:两台单机 RegisterClient(mods 一空一非空,CC ≥ 2.1.287)→ hub WS 注册/心跳
// → registry → aggregator → GET /api/global-dashboard 机器行含 mods 风险判定(验收 2);
// 单机删除夹具(provider 返回归 0)→ 下一心跳周期内 hub 侧计数更新、风险消失(验收 4)。
// 版本号来自注入的 getModsStatus provider(测试夹具,不依赖本机真实安装)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startHub } = require('../hub/server.cjs');
const { StubMachine } = require('./stub_machine.cjs');
const { RegisterClient } = require('../register_client.cjs');

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch { /* 未就绪,继续轮询 */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`);
}

async function startHubRetry(opts, retries = 6) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await startHub(opts);
    } catch (e) {
      lastErr = e;
      if (String(e.code || e.message || '').includes('EADDRINUSE')) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function fetchGlobalDashboard(hubPort) {
  const data = await fetch(`http://127.0.0.1:${hubPort}/api/global-dashboard`, {
    headers: { Authorization: 'Bearer ht' },
  }).then((r) => r.json());
  return data;
}

test('e2e: 两机 mods 上报聚合 —— 非空机标风险 / 空机正常;夹具删除后心跳刷新(验收 2+4)', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-e2e-'));
  const hub = await startHubRetry({
    machinesFile: path.join(noneDir, 'none.json'),
    hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });

  // 机器 A:伪造 mods 夹具非空(2 条)+ CC 2.1.300(≥ 2.1.287)
  const stubA = await new StubMachine({
    token: 'ta', dashboardPayload: { tmuxOk: true, sessions: [] },
  }).start();
  let modsCountA = 2; // 可变夹具:中途「删除」(归 0)
  const rcA = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'ta',
    machineId: 'box-risky', machineName: 'RiskyBox', publicUrl: stubA.url,
    bindHost: '127.0.0.1', port: stubA.port,
    getModsStatus: () => ({ cc_version: '2.1.300', mods_count: modsCountA, source: 'fixture:installed_plugins.json:2' }),
    pingIntervalMs: 80, // 短心跳:状态变化 ≤ 一个心跳周期内传播
  });

  // 机器 B:mods 为空(同版本 CC)
  const stubB = await new StubMachine({
    token: 'tb', dashboardPayload: { tmuxOk: true, sessions: [] },
  }).start();
  const rcB = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'tb',
    machineId: 'box-clean', machineName: 'CleanBox', publicUrl: stubB.url,
    bindHost: '127.0.0.1', port: stubB.port,
    getModsStatus: () => ({ cc_version: '2.1.300', mods_count: 0, source: 'fixture:absent' }),
    pingIntervalMs: 80,
  });

  rcA.start();
  rcB.start();

  try {
    // 验收 2:聚合看板两行机器条目,非空机 risk=true,空机不标
    await waitFor(async () => {
      const data = await fetchGlobalDashboard(hub.port);
      const a = data.machines.find((m) => m.id === 'box-risky');
      const b = data.machines.find((m) => m.id === 'box-clean');
      return !!a && !!b && a.mods && b.mods && a.mods.risk === true && b.mods.mods_count === 0;
    }, { timeoutMs: 5000 });
    const data = await fetchGlobalDashboard(hub.port);
    assert.equal(data.machines.length, 2, '两行机器条目');
    const a = data.machines.find((m) => m.id === 'box-risky');
    const b = data.machines.find((m) => m.id === 'box-clean');
    assert.equal(a.mods.state, 'risk');
    assert.equal(a.mods.mods_count, 2);
    assert.equal(b.mods.state, 'ok', '空 mods 机器不显示风险');
    assert.equal(b.mods.risk, false);

    // 验收 4:删除夹具(countA → 0)→ 下一心跳周期内 hub 侧更新、风险消失
    modsCountA = 0;
    await waitFor(async () => {
      const data2 = await fetchGlobalDashboard(hub.port);
      const a2 = data2.machines.find((m) => m.id === 'box-risky');
      return !!a2 && a2.mods.mods_count === 0 && a2.mods.risk === false;
    }, { timeoutMs: 5000 });
    const data3 = await fetchGlobalDashboard(hub.port);
    const a3 = data3.machines.find((m) => m.id === 'box-risky');
    assert.equal(a3.mods.state, 'ok', '风险标记随计数归零消失');
  } finally {
    rcA.close();
    rcB.close();
    await stubA.stop();
    await stubB.stop();
    await hub.stop();
  }
});

test('e2e: 巡检异常(error 帧)→ global-dashboard 该机 state=error(验收 5)', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-e2e-err-'));
  const hub = await startHubRetry({
    machinesFile: path.join(noneDir, 'none.json'),
    hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });
  const stub = await new StubMachine({
    token: 'tx', dashboardPayload: { tmuxOk: true, sessions: [] },
  }).start();
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'tx',
    machineId: 'box-err', machineName: 'ErrBox', publicUrl: stub.url,
    bindHost: '127.0.0.1', port: stub.port,
    getModsStatus: () => ({ cc_version: 'unknown', mods_count: 0, source: '', error: 'EACCES: ~/.claude/plugins' }),
    pingIntervalMs: 80,
  });
  rc.start();
  try {
    await waitFor(async () => {
      const data = await fetchGlobalDashboard(hub.port);
      const m = data.machines.find((x) => x.id === 'box-err');
      return !!m && m.mods && m.mods.state === 'error';
    }, { timeoutMs: 5000 });
    const data = await fetchGlobalDashboard(hub.port);
    const m = data.machines.find((x) => x.id === 'box-err');
    assert.equal(m.mods.mods_count, 0);
    assert.match(m.mods.error, /EACCES/);
    assert.equal(m.mods.risk, false);
  } finally {
    rc.close();
    await stub.stop();
    await hub.stop();
  }
});
