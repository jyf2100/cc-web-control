'use strict';

// Task 6:hub GET /jump 端点测试。
// 复用 hub-server.test.cjs 的启动模式:machinesFile + startHub。
// /jump 调下游机器 fetch 在单测里会失败(无真 7684)→ 走 502 中性文案断言。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startHub } = require('../hub/server.cjs');

const HUB_TOKEN = 'hubtok';

function req(port, method, reqPath, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject).end();
  });
}

// 写临时 machines 清单(0600);machinesFile 是 startHub 的真实入参
function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-jump-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// 注入一台 m1 → 127.0.0.1:7684(无真机 → fetch 必失败 → 502)
async function withHub(fn) {
  const { file, cleanup } = tmpMachinesFile([
    { id: 'm1', name: 'mac-pro', url: 'http://127.0.0.1:7684', token: 'mtoken' },
  ]);
  const hub = await startHub({
    machinesFile: file,
    hubToken: HUB_TOKEN,
    host: '127.0.0.1',
    port: 0,
    intervalMs: 100,
  });
  try {
    await fn(hub.port);
  } finally {
    await hub.stop();
    cleanup();
  }
}

test('GET /jump 不在 requireAuth 白名单:未授权 → 302 重定向 /login?next=', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=m1&s=ses-1');
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /\/login/);
  });
});

test('GET /jump 拒绝缺 m 或 s → 400', async () => {
  await withHub(async (port) => {
    const h = { Cookie: 'cc_web_hub_auth=hubtok' };
    assert.equal((await req(port, 'GET', '/jump?m=m1', { headers: h })).status, 400);
    assert.equal((await req(port, 'GET', '/jump?s=ses-1', { headers: h })).status, 400);
  });
});

test('GET /jump 拒绝未知 machine → 400', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=ghost&s=ses-1', { headers: { Cookie: 'cc_web_hub_auth=hubtok' } });
    assert.equal(r.status, 400);
  });
});

test('GET /jump 拒绝非法 session 名(含空格)→ 400', async () => {
  await withHub(async (port) => {
    // 浏览器侧空格会被 encode;此处模拟 wire 上抵达 server 的 %20。
    // express query 解析后 s = 'bad session'(空格还原),应触发 SESSION_RE 不通过。
    const r = await req(port, 'GET', '/jump?m=m1&s=bad%20session', { headers: { Cookie: 'cc_web_hub_auth=hubtok' } });
    assert.equal(r.status, 400);
  });
});

test('GET /jump 上游不可达 → 502 + 中性文案(无 ECONNREFUSED/堆栈泄露)', async () => {
  await withHub(async (port) => {
    const r = await req(port, 'GET', '/jump?m=m1&s=ses-1', { headers: { Cookie: 'cc_web_hub_auth=hubtok' } });
    assert.equal(r.status, 502);
    assert.ok(!/ECONNREFUSED|ENOTFOUND|fetch failed|error|stack/i.test(r.body),
      `502 body 须中性,实际:${r.body}`);
  });
});
