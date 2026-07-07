'use strict';

// Task 3 (7684 POST /api/auth/ticket mint 端点) 测试。
//
// 选择「子进程拉起真 server.cjs」而非 in-process require:server.cjs 顶层即
// 执行启动副作用(migrateStaleBindings + startWebServer/initAndAttachSession),
// 没有 startServer 类的可注入导出;子进程方式零生产改动 + 真实端到端 TDD。
// 端口由本测试自选空闲端口,经 CC_WEB_PORT env 注入;NO_OPEN/WEB_ONLY 抑制副作用。

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const TOKEN = 'test-ticket-token';
const SERVER_PATH = path.join(__dirname, '..', 'server.cjs');

// 临时监听 :0 拿一个系统分配的空闲端口,然后立刻关闭,把端口号交给 server.cjs。
// (server.cjs 打印的是 CFG.port 配置值,故不能传 0 —— 必须自选并回读。)
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, HOST, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function req(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: HOST, port, method, path: p, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function withServer(fn, { token = TOKEN } = {}) {
  const port = await pickFreePort();
  const env = {
    ...process.env,
    CC_WEB_HOST: HOST,
    CC_WEB_PORT: String(port),
    CC_WEB_NO_OPEN: '1',
    CC_WEB_WEB_ONLY: '1',
  };
  // 显式注入(含空串):config_loader 仅在 env[spec.env] !== undefined 时覆盖,
  // 否则 ~/.cc-web-control/config.json 的 authToken 会落回到子进程。传 null 才是「不注入」。
  if (token !== null) env.CC_WEB_AUTH_TOKEN = token;
  const child = spawn(process.execPath, [SERVER_PATH], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrBuf = '';
  child.stderr.on('data', (c) => { stderrBuf += c; });
  // 轮询 /healthz 最多 ~5s,green 即就绪
  const deadline = Date.now() + 5000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await req(port, 'GET', '/healthz');
      if (r.status === 200) { up = true; break; }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) {
    child.kill('SIGKILL');
    throw new Error(`server.cjs did not come up on :${port}. stderr:\n${stderrBuf}`);
  }
  try {
    await fn(port);
  } finally {
    child.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 100));
    if (!child.killed) child.kill('SIGKILL');
  }
}

test('POST /api/auth/ticket requires Bearer', async () => {
  await withServer(async (port) => {
    const noAuth = await req(port, 'POST', '/api/auth/ticket');
    assert.equal(noAuth.status, 401);
  });
});

test('POST /api/auth/ticket rejects wrong token', async () => {
  await withServer(async (port) => {
    const wrong = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: 'Bearer wrong' },
    });
    assert.equal(wrong.status, 401);
  });
});

test('POST /api/auth/ticket mints a ticket with valid Bearer', async () => {
  await withServer(async (port) => {
    const ok = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(ok.status, 200);
    const parsed = JSON.parse(ok.body);
    assert.ok(parsed.ticket && parsed.ticket.length >= 40, `ticket missing/too short: ${ok.body}`);
  });
});

// ---------- Task 4: GET /login 消费 ticket + next preservation ----------

test('GET /login consumes ticket, sets cookie, redirects', async () => {
  await withServer(async (port) => {
    // mint 与 consume 必须在同一 subprocess:tickets 是模块级 Map,跨进程不可见。
    const minted = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = JSON.parse(minted.body);
    const consumed = await req(port, 'GET', `/login?ticket=${encodeURIComponent(ticket)}&next=/?session=s1`);
    assert.equal(consumed.status, 302);
    assert.equal(consumed.headers.location, '/?session=s1');
    const setCookie = consumed.headers['set-cookie'] || [];
    assert.ok(
      setCookie.some((c) => /^cc_web_auth=/.test(c)),
      `expected cc_web_auth cookie, got: ${JSON.stringify(setCookie)}`
    );
  });
});

test('GET /login rejects already-consumed ticket (one-time)', async () => {
  await withServer(async (port) => {
    const minted = await req(port, 'POST', '/api/auth/ticket', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { ticket } = JSON.parse(minted.body);
    await req(port, 'GET', `/login?ticket=${encodeURIComponent(ticket)}`);
    // 同一 ticket 二次消费:必须失败回登录页,且不得再设 cc_web_auth cookie。
    const second = await req(port, 'GET', `/login?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(second.status, 302);
    const setCookie = second.headers['set-cookie'] || [];
    assert.ok(
      !setCookie.some((c) => /^cc_web_auth=[^;]+;/.test(c) && !/Max-Age=0/.test(c)),
      `unexpected cc_web_auth on second consume: ${JSON.stringify(setCookie)}`
    );
  });
});

test('GET /login without AUTH_TOKEN preserves next (bug fix)', async () => {
  // auth disabled:不注入 CC_WEB_AUTH_TOKEN 启动 subprocess。
  // 旧代码 res.redirect('/') 丢 next → 期望改为保留 nextPath。
  await withServer(async (port) => {
    const r = await req(port, 'GET', '/login?next=/?session=s2');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/?session=s2');
  }, { token: '' });
});
