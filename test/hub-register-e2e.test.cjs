'use strict';
// 端到端:单机 RegisterClient → hub WS → registry → aggregator 回连 stub → /api/machines 可见。
// 整条反向注册链路的唯一全链路验证(Task 3/4/5/7 的集成验收)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startHub } = require('../hub/server.cjs');
const { StubMachine } = require('./stub_machine.cjs');
const { RegisterClient } = require('../register_client.cjs');

// 轮询等待:每 intervalMs 检查一次 fn() 直至返回真值或超时。
// 比固定 setTimeout 更抗 CI 慢机抖动(注册+首轮探测的真实耗时不确定)。
async function waitFor(fn, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true;
    } catch {
      /* 条件未就绪(如 fetch 抖动),继续轮询 */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor 超时 (${timeoutMs}ms)`);
}

// 查 hub 的 /api/machines(Bearer header 鉴权)→ 返回指定 id 的机器快照。
// 注意:hub 没有 /api/dashboard 路由(那是单机端点);且 HTTP requireAuth 只读
// Authorization header + cookie,不读 query token(query token 仅 WS handler 读)。
async function fetchMachine(hubPort, id) {
  const data = await fetch(`http://127.0.0.1:${hubPort}/api/machines`, {
    headers: { Authorization: 'Bearer ht' },
  }).then((r) => r.json());
  return data.machines.find((x) => x.id === id);
}

// startHub 的端口复用包装:指定的 port 偶发 EADDRINUSE(TIME_WAIT 未完全释放)时短重试。
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
      throw e; // 非端口占用错误直接抛
    }
  }
  throw lastErr;
}

test('e2e: 单机 RegisterClient 连 hub → 看板可见该机 + 回连 stub 成功', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const hub = await startHubRetry({
    machinesFile: path.join(noneDir, 'none.json'),
    hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });

  // stub 充当「单机的 HTTP+WS 服务」(被 hub aggregator 回连)
  const stub = await new StubMachine({
    token: 'at',
    dashboardPayload: { tmuxOk: true, sessions: [{ name: 's1', cwd: '/x', status: 'idle', lastLine: '', lastTs: 0, attached: false }] },
  }).start();

  // RegisterClient 充当「单机主动注册到 hub」。
  // 链路:rc WS Bearer 用 registerToken='ht'(hub 校验)→ register 帧 token 字段用 authToken='at'
  // → hub 存 machine.token='at' → aggregator 用它回连 stub /api/dashboard(stub 用 token='at' 校验)。
  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${hub.port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'e2e-box', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
  });
  rc.start();

  // 等注册帧落库 + aggregator 首轮回连探测成功(setOnline true)。轮询比固定 sleep 稳。
  try {
    await waitFor(async () => {
      const m = await fetchMachine(hub.port, 'e2e-box');
      return !!m && m.online === true;
    }, { timeoutMs: 3000 });

    const m = await fetchMachine(hub.port, 'e2e-box');
    assert.ok(m, '注册机器在看板');
    assert.equal(m.online, true, '看板可达(aggregator 回连 stub /api/dashboard 成功)');
  } finally {
    rc.close();
    await stub.stop();
    await hub.stop();
  }
});

test('e2e: hub 重启后单机自愈重注册', async () => {
  const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e2-'));
  const machinesFile = path.join(noneDir, 'none.json');

  // ★ 端口复用(关键):两次 startHub 必须用同一端口。若都 port:0 会拿到两个不同随机端口,
  // 而 rc.hubUrl 在第一次创建时绑定的是第一个 hub 的端口;hub.stop 后新 hub 在新端口,
  // rc 重连还是连旧端口(已关)→ ECONNREFUSED → 永远连不上 → 测试必失败。
  // 解法:第一次 port:0 拿到端口后记下,第二次用同一端口(Node SO_REUSEADDR 通常能立即重用)。
  let hub = await startHubRetry({
    machinesFile, hubToken: 'ht', host: '127.0.0.1', port: 0, intervalMs: 80,
  });
  const port = hub.port;

  const stub = await new StubMachine({
    token: 'at', dashboardPayload: { tmuxOk: true, sessions: [] },
  }).start();

  const rc = new RegisterClient({
    hubUrl: `http://127.0.0.1:${port}`, registerToken: 'ht', authToken: 'at',
    machineId: 'e2e-box2', machineName: '', publicUrl: stub.url, bindHost: '127.0.0.1', port: stub.port,
    reconnectBaseMs: 50, // 测试用短退避,加快自愈重连
  });
  rc.start();

  // 先等首次注册 + 回连成功
  await waitFor(async () => {
    const m = await fetchMachine(port, 'e2e-box2');
    return !!m && m.online === true;
  }, { timeoutMs: 3000 });

  await hub.stop(); // 模拟 hub 重启(rc 的 WS 被关 → 触发 network 重连退避)

  // 复用同一端口重启 hub(startHubRetry 处理偶发 EADDRINUSE)
  hub = await startHubRetry({
    machinesFile, hubToken: 'ht', host: '127.0.0.1', port, intervalMs: 80,
  });

  // 等自愈重连:rc 按 reconnectBaseMs=50 退避重连 → 新 hub 接受注册 → aggregator 回连 → online=true。
  // 给略长超时(退避带 ±20% jitter + 一次 80ms 聚合轮询)。
  try {
    await waitFor(async () => {
      const m = await fetchMachine(port, 'e2e-box2');
      return !!m && m.online === true;
    }, { timeoutMs: 5000 });

    const m = await fetchMachine(port, 'e2e-box2');
    assert.ok(m, 'hub 重启后单机自愈重注册');
    assert.equal(m.online, true, '看板可达(回连 stub 成功)');
  } finally {
    // 注意:hub 已被重新赋值为重启后的实例,finally 关闭的是最终的 hub(旧 hub 已在测试中途 stop)
    rc.close();
    await stub.stop();
    await hub.stop();
  }
});
