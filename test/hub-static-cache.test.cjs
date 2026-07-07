'use strict';
// 验证 hub 对 public/ 下前端 html/js/cjs 静态资源设 Cache-Control: no-store,
// 防浏览器缓存旧版前端(曾导致"重启 main-agent 收不到信息":用户浏览器持有旧 console.js)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startHub } = require('../hub/server.cjs');

function tmpMachines() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-static-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: [] }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function withHub(fn) {
  const { file, cleanup } = tmpMachines();
  const hub = await startHub({ machinesFile: file, hubToken: 'tok', host: '127.0.0.1', port: 0, intervalMs: 100 });
  try {
    await fn(hub);
  } finally {
    await hub.stop();
    cleanup();
  }
}

test('前端 .js/.html/.cjs 静态资源带 Cache-Control: no-store', async () => {
  await withHub(async (hub) => {
    const base = `http://127.0.0.1:${hub.port}`;
    const h = { Cookie: 'cc_web_hub_auth=tok' };
    for (const p of ['/dashboard.js', '/dashboard.html', '/dashboard_render.cjs']) {
      const res = await fetch(base + p, { headers: h });
      assert.equal(res.status, 200, `${p} status`);
      assert.equal(res.headers.get('cache-control'), 'no-store', `${p} cache-control`);
    }
  });
});

test('静态图片保留默认缓存(不强制 no-store)', async () => {
  await withHub(async (hub) => {
    const res = await fetch(`http://127.0.0.1:${hub.port}/logo.png`, { headers: { Cookie: 'cc_web_hub_auth=tok' } });
    assert.equal(res.status, 200);
    assert.notEqual(res.headers.get('cache-control'), 'no-store');
  });
});
