'use strict';
// 端到端:两台 stub 单机(带 /api/trajectories)注册进真 hub →
// GET /api/global-trajectories 聚合正确(验收 5/7:聚合条数、machine 归属、过滤)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StubMachine } = require('./stub_machine.cjs');
const { startHub } = require('../hub/server.cjs');

// 给 stub 加 /api/trajectories(镜像真机 server.cjs 响应形状;含 token 校验)
function withTrajectories(stub, payload) {
  stub.app.get('/api/trajectories', (req, res) => {
    if (stub.token && req.headers.authorization !== `Bearer ${stub.token}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.json(payload);
  });
}

function tmpMachinesFile(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-traj-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines: list }), { mode: 0o600 });
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function withHub(stubs, token, fn) {
  const machines = stubs.map((s, i) => ({ id: `mc${i + 1}`, name: `M${i + 1}`, url: s.url, token: s.token }));
  const { file, cleanup } = tmpMachinesFile(machines);
  const hub = await startHub({ machinesFile: file, hubToken: token, host: '127.0.0.1', port: 0, intervalMs: 100 });
  try {
    await fn(hub);
  } finally {
    await hub.stop();
    cleanup();
  }
}

const DAY_START = Date.parse('2026-08-19T00:00:00Z');
const DAY_END = Date.parse('2026-08-20T00:00:00Z');
const traj = (sessionId, mtime, extra = {}) => ({
  sessionId, path: `/d/${sessionId}.jsonl`, size: 10, mtime,
  messages: 2, firstUserSummary: 'q', oversize: false, ...extra,
});

test('两机上报 → /api/global-trajectories 聚合:2 机器维度、total=和、machine 归属正确(验收 5)', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  withTrajectories(s1, {
    root: '/home/u/.claude/projects', scannedAt: 1,
    trajectories: [traj('a1', DAY_START), traj('a2', DAY_START + 1)],
    skipped: 1,
  });
  const s2 = await new StubMachine({ token: 't2' }).start();
  withTrajectories(s2, { root: '/home/v/.claude/projects', scannedAt: 1, trajectories: [traj('b1', DAY_END + 5)], skipped: 0 });
  try {
    await withHub([s1, s2], 'hubtok', async (hub) => {
      await new Promise((r) => setTimeout(r, 250)); // 等首轮聚合
      const res = await fetch(`http://127.0.0.1:${hub.port}/api/global-trajectories`, {
        headers: { Cookie: 'cc_web_hub_auth=hubtok' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.machines.length, 2);
      assert.equal(body.total, 3, 'total = 两机之和');
      const mc1 = body.machines.find((m) => m.id === 'mc1');
      const mc2 = body.machines.find((m) => m.id === 'mc2');
      assert.equal(mc1.count, 2);
      assert.equal(mc1.skipped, 1);
      assert.ok(mc1.trajectories.every((t) => t.machine === 'mc1'), 'machine 归属');
      assert.equal(mc2.trajectories[0].machine, 'mc2');
    });
  } finally {
    await s1.stop();
    await s2.stop();
  }
});

test('?machine= 过滤仅显示该机;?date= UTC 日边界(验收 7)', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  withTrajectories(s1, { trajectories: [traj('a1', DAY_START), traj('a2', DAY_END)], skipped: 0 });
  const s2 = await new StubMachine({ token: 't2' }).start();
  withTrajectories(s2, { trajectories: [traj('b1', DAY_START + 1)], skipped: 0 });
  try {
    await withHub([s1, s2], 'hubtok', async (hub) => {
      await new Promise((r) => setTimeout(r, 250));
      const get = async (q) => (await fetch(`http://127.0.0.1:${hub.port}/api/global-trajectories${q}`, {
        headers: { Cookie: 'cc_web_hub_auth=hubtok' },
      })).json();

      const byMachine = await get('?machine=mc2');
      assert.equal(byMachine.machines.length, 1);
      assert.equal(byMachine.machines[0].id, 'mc2');
      assert.equal(byMachine.total, 1);

      const byDate = await get('?date=2026-08-19');
      assert.equal(byDate.total, 2, 'mc1 的 a1(日起点,含)+ mc2 的 b1');
      const nextDay = await get('?date=2026-08-20');
      assert.equal(nextDay.total, 1, 'a2 恰在次日 00:00:00Z → 归属次日');
      assert.equal(nextDay.machines.find((m) => m.id === 'mc1').trajectories[0].sessionId, 'a2');

      const combo = await get('?machine=mc1&date=2026-08-19');
      assert.equal(combo.total, 1);
      assert.deepEqual(combo.filters, { machine: 'mc1', date: '2026-08-19' });
    });
  } finally {
    await s1.stop();
    await s2.stop();
  }
});

test('非法 date → 400;未授权 → 401', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start();
  withTrajectories(s1, { trajectories: [], skipped: 0 });
  try {
    await withHub([s1], 'hubtok', async (hub) => {
      const bad = await fetch(`http://127.0.0.1:${hub.port}/api/global-trajectories?date=not-a-date`, {
        headers: { Cookie: 'cc_web_hub_auth=hubtok' },
      });
      assert.equal(bad.status, 400);
      const noAuth = await fetch(`http://127.0.0.1:${hub.port}/api/global-trajectories`);
      assert.equal(noAuth.status, 401);
    });
  } finally {
    await s1.stop();
  }
});

test('单机不提供 /api/trajectories(旧版本)→ 该机空清单,聚合整体可用', async () => {
  const s1 = await new StubMachine({ token: 't1' }).start(); // 无轨迹端点 → 404
  const s2 = await new StubMachine({ token: 't2' }).start();
  withTrajectories(s2, { trajectories: [traj('b1', 5)], skipped: 0 });
  try {
    await withHub([s1, s2], 'hubtok', async (hub) => {
      await new Promise((r) => setTimeout(r, 250));
      const body = await (await fetch(`http://127.0.0.1:${hub.port}/api/global-trajectories`, {
        headers: { Cookie: 'cc_web_hub_auth=hubtok' },
      })).json();
      assert.equal(body.total, 1);
      const mc1 = body.machines.find((m) => m.id === 'mc1');
      assert.equal(mc1.count, 0, '旧版单机贡献空清单');
    });
  } finally {
    await s1.stop();
    await s2.stop();
  }
});
