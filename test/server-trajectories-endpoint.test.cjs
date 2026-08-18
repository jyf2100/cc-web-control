'use strict';
// 单机 GET /api/trajectories 端到端:子进程拉起真 server.cjs(ticket-auth.test.cjs 同款
// 范式:server.cjs 顶层即启动副作用,无可注入导出),经 CC_WEB_TRAJECTORY_ROOT 指向
// 临时 fixture 目录。覆盖:鉴权 401、合法扫描(验收 1 语义)、超限标记(验收 4)、
// 根目录不存在 → 空清单 + warning(验收 3)、TTL 缓存 + ?refresh=1。

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const TOKEN = 'test-traj-token';
const SERVER_PATH = path.join(__dirname, '..', 'server.cjs');

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

function writeJsonl(dir, name, lines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

async function withServer(fn, { trajRoot }) {
  const port = await pickFreePort();
  const env = {
    ...process.env,
    CC_WEB_HOST: HOST,
    CC_WEB_PORT: String(port),
    CC_WEB_NO_OPEN: '1',
    CC_WEB_WEB_ONLY: '1',
    CC_WEB_AUTH_TOKEN: TOKEN,
  };
  // 显式覆盖轨迹根:测试 fixture 目录(不存在/存在均由调用方决定)
  env.CC_WEB_TRAJECTORY_ROOT = trajRoot;
  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrBuf = '';
  child.stderr.on('data', (c) => { stderrBuf += c; });
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

const U = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const A = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('GET /api/trajectories:无 Bearer → 401;有 Bearer → 200 且字段齐全', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-ep-'));
  try {
    writeJsonl(path.join(root, 'proj'), 'sid-1.jsonl', [U('首个问题'), A('回答'), U('追问')]);
    writeJsonl(path.join(root, 'proj'), 'sid-2.jsonl', [U('x'), '{ broken']);
    await withServer(async (port) => {
      const noAuth = await req(port, 'GET', '/api/trajectories');
      assert.equal(noAuth.status, 401);

      const r = await req(port, 'GET', '/api/trajectories', { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(r.status, 200);
      const body = JSON.parse(r.body);
      assert.equal(body.root, root, '回显生效的根路径');
      assert.equal(body.trajectories.length, 1, '损坏文件跳过');
      assert.equal(body.skipped, 1);
      const t = body.trajectories[0];
      assert.equal(t.sessionId, 'sid-1');
      assert.equal(t.path, path.join(root, 'proj', 'sid-1.jsonl'));
      assert.ok(Number.isFinite(t.size) && t.size > 0);
      assert.ok(Number.isFinite(t.mtime) && t.mtime > 0);
      assert.equal(t.messages, 3);
      assert.equal(t.firstUserSummary, '首个问题');
      assert.equal(t.oversize, false);
      assert.ok(Number.isFinite(body.scannedAt));
    }, { trajRoot: root });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('验收4:超阈值文件标记 oversize、messages=null(经 env 调小阈值)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-oversize-'));
  try {
    writeJsonl(path.join(root, 'p'), 'big.jsonl', [U('q'), A('a')]);
    const port = await pickFreePort();
    const env = {
      ...process.env,
      CC_WEB_HOST: HOST, CC_WEB_PORT: String(port),
      CC_WEB_NO_OPEN: '1', CC_WEB_WEB_ONLY: '1', CC_WEB_AUTH_TOKEN: TOKEN,
      CC_WEB_TRAJECTORY_ROOT: root,
      CC_WEB_TRAJECTORY_OVERSIZE_BYTES: '10',
    };
    const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const deadline = Date.now() + 5000;
      let up = false;
      while (Date.now() < deadline) {
        try { if ((await req(port, 'GET', '/healthz')).status === 200) { up = true; break; } } catch { /* not yet */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(up, 'server should be up');
      const r = await req(port, 'GET', '/api/trajectories', { headers: { authorization: `Bearer ${TOKEN}` } });
      const body = JSON.parse(r.body);
      assert.equal(body.trajectories.length, 1);
      const big = body.trajectories[0];
      assert.equal(big.oversize, true);
      assert.equal(big.messages, null);
      assert.equal(big.firstUserSummary, null);
      assert.equal(body.skipped, 0);
    } finally {
      child.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 100));
      if (!child.killed) child.kill('SIGKILL');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('验收3:根目录不存在 → 200 + 空清单 + warning(不 crash)', async () => {
  const bogus = path.join(os.tmpdir(), 'traj-not-exist-xyz');
  await withServer(async (port) => {
    const r = await req(port, 'GET', '/api/trajectories', { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.deepEqual(body.trajectories, []);
    assert.equal(body.skipped, 0);
    assert.ok(body.warning && body.warning.includes('不存在'), `应带 warning,实际 ${r.body}`);
  }, { trajRoot: bogus });
});

test('TTL 缓存:60s 内重复请求不重扫;?refresh=1 强制重扫(新文件可见)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-cache-'));
  try {
    writeJsonl(path.join(root, 'p'), 's0.jsonl', [U('zero')]);
    await withServer(async (port) => {
      const H = { authorization: `Bearer ${TOKEN}` };
      const first = JSON.parse((await req(port, 'GET', '/api/trajectories', { headers: H })).body);
      assert.equal(first.trajectories.length, 1);

      // 缓存窗口内新增文件:默认请求仍是旧结果(scannedAt 不变)
      writeJsonl(path.join(root, 'p'), 's1.jsonl', [U('one')]);
      const cached = JSON.parse((await req(port, 'GET', '/api/trajectories', { headers: H })).body);
      assert.equal(cached.trajectories.length, 1, 'TTL 内复用缓存');
      assert.equal(cached.scannedAt, first.scannedAt);

      // ?refresh=1 强制重扫 → 新文件可见
      const fresh = JSON.parse((await req(port, 'GET', '/api/trajectories?refresh=1', { headers: H })).body);
      assert.equal(fresh.trajectories.length, 2);
      assert.ok(fresh.scannedAt >= first.scannedAt);
    }, { trajRoot: root });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
