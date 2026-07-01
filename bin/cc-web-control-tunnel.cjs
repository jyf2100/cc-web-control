#!/usr/bin/env node
'use strict';

// cc-web-control-tunnel: 启动 Cloudflare Quick Tunnel(脚本会打印 URL + 新 TOKEN)。
// 让全局安装用户直接 `cc-web-control-tunnel` 跑,
// 免拼 `$(npm root -g)/cc-web-control/scripts/restart_tunnel.sh` 长路径。
const { spawn } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');

// 解析隧道脚本绝对路径:基于本文件位置,对外通用(不写死本机路径)。
function resolveTunnelScript(binDir = __dirname) {
  return path.join(binDir, '..', 'scripts', 'restart_tunnel.sh');
}

// spawn bash 跑隧道脚本;stdio inherit 透传 URL/TOKEN 输出与终端交互。
// spawnFn 可注入以便测试。
function startTunnel({ spawnFn = spawn, script = resolveTunnelScript(), env = process.env } = {}) {
  return spawnFn('bash', [script], { stdio: 'inherit', env });
}

function main(opts) {
  const script = (opts && opts.script) || resolveTunnelScript();
  if (!fs.existsSync(script)) {
    console.error(`cc-web-control-tunnel: 找不到隧道脚本: ${script}`);
    process.exit(1);
    return;
  }
  const child = startTunnel({ ...opts, script });
  child.on('exit', (code, signal) => {
    if (signal) {
      try { process.kill(process.pid, signal); } catch { process.exit(1); }
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) main();

module.exports = { resolveTunnelScript, startTunnel, main };
