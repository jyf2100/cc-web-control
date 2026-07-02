'use strict';
// UI 预览:起 2 个 stub 机器 + 1 个离线机 + hub,供 Playwright 验证多机控制台。
// 用法:node scripts/preview_hub_console.cjs  → 打印 HUB_URL / TOKEN,常驻;Ctrl-C 退出。
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { StubMachine } = require(path.join(__dirname, '..', 'test', 'stub_machine.cjs'));
const { startHub } = require(path.join(__dirname, '..', 'hub', 'server.cjs'));

(async () => {
  const s1 = await new StubMachine({
    token: 't1',
    dashboardPayload: { tmuxOk: true, sessions: [
      { name: 'api', cwd: '/srv/api', status: 'working', lastLine: '$ npm run build', lastTs: 1, attached: false },
      { name: 'web', cwd: '/srv/web', status: 'idle', lastLine: '$ ', lastTs: 2, attached: false },
    ] },
  }).start();
  const s2 = await new StubMachine({
    token: 't2',
    dashboardPayload: { tmuxOk: true, sessions: [
      { name: 'db', cwd: '/srv/db', status: 'errored', lastLine: 'Error: connection refused', lastTs: 3, attached: false },
    ] },
  }).start();
  const machines = [
    { id: 'mac1', name: 'MBP', url: s1.url, token: 't1' },
    { id: 'srv1', name: '开发服', url: s2.url, token: 't2' },
    { id: 'dead1', name: '已挂机', url: 'http://127.0.0.1:1', token: 'x' }, // 端口 1 连不上 → 离线
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-preview-'));
  const file = path.join(dir, 'machines.json');
  fs.writeFileSync(file, JSON.stringify({ machines }), { mode: 0o600 });
  const hub = await startHub({ machinesFile: file, hubToken: 'hubtok', host: '127.0.0.1', port: 0, intervalMs: 1000 });
  // 首行用固定前缀,方便脚本解析端口
  process.stdout.write(`HUB_READY http://127.0.0.1:${hub.port}\n`);
  process.stdout.write(`HUB_URL=http://127.0.0.1:${hub.port}\nTOKEN=hubtok\n`);
  const shutdown = async () => { try { await hub.stop(); await s1.stop(); await s2.stop(); } catch {} process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((e) => { console.error(e); process.exit(1); });
