#!/usr/bin/env node
/**
 * dev 预览入口(npm run dev)
 *
 * 与 npm start(完整体验:tmux + claude)区分,本入口面向 UI 预览容器(如 Kimi Work):
 * 1. 端口/主机桥接:预览容器通过 CLI `--port/--host`(或 PORT/HOST env)指派端口,
 *    这里转译为 server.cjs 认识的 CC_WEB_PORT / CC_WEB_HOST(env 优先级高于 config 文件)。
 * 2. 安全默认值(均可被同名 env 显式覆盖):
 *    - CC_WEB_WEB_ONLY=1  只起 Web 服务,不创建/附加 tmux 会话、不拉起 claude(零副作用)
 *    - CC_WEB_NO_OPEN=1   不自动打开浏览器
 *    - CC_WEB_NO_ATTACH=1 非交互终端不 attach
 * 其余参数(如 --config)原样透传给 server.cjs。
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

function argValue(argv, names) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    for (const n of names) {
      if (a === n && i + 1 < argv.length) return argv[i + 1];
      if (a.startsWith(n + '=')) return a.slice(n.length + 1);
    }
  }
  return undefined;
}

const argv = process.argv.slice(2);
const port = argValue(argv, ['--port', '-p']) || process.env.PORT;
const host = argValue(argv, ['--host', '-H']) || process.env.HOST;

const env = { ...process.env };
if (port && /^\d{1,5}$/.test(String(port))) env.CC_WEB_PORT = String(port);
if (host) env.CC_WEB_HOST = String(host);
if (env.CC_WEB_WEB_ONLY === undefined) env.CC_WEB_WEB_ONLY = '1';
if (env.CC_WEB_NO_OPEN === undefined) env.CC_WEB_NO_OPEN = '1';
if (env.CC_WEB_NO_ATTACH === undefined) env.CC_WEB_NO_ATTACH = '1';

const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.cjs'), ...argv], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code == null ? 0 : code);
  }
});
child.on('error', (err) => {
  console.error('[dev] 启动 server.cjs 失败:', err.message);
  process.exit(1);
});
