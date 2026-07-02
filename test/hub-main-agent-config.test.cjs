'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { genMcpConfig, genSystemPrompt, writeMainAgentFiles } = require('../hub/main_agent_config.cjs');

test('genMcpConfig: 不含 token(无 env 字段),command=node,args 含路径', () => {
  const cfg = genMcpConfig({ mcpServerPath: '/abs/bin/cc-web-control-mcp.cjs' });
  const srv = cfg.mcpServers['cc-web-control'];
  assert.equal(srv.command, process.execPath);
  assert.deepEqual(srv.args, ['/abs/bin/cc-web-control-mcp.cjs']);
  assert.equal(srv.env, undefined, 'token 走 env,不内联 mcp-config');
});

test('genSystemPrompt: 含关键边界词', () => {
  const p = genSystemPrompt();
  assert.match(p, /不可信数据/);
  assert.match(p, /ack_event/);
  assert.match(p, /dequeue_event/);
});

test('writeMainAgentFiles: 写两个 0600 文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ma-cfg-'));
  const { mcpPath, promptPath } = await writeMainAgentFiles({ dir, mcpServerPath: '/x.cjs' });
  const mstat = await fs.stat(mcpPath);
  const pstat = await fs.stat(promptPath);
  assert.equal(mstat.mode & 0o777, 0o600);
  assert.equal(pstat.mode & 0o777, 0o600);
  const cfg = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
  assert.ok(cfg.mcpServers['cc-web-control']);
});
