'use strict';
// Spike shim: 模拟 cc-web-control hub 的 /api/mcp/list_sessions 端点。
// 仅用于验证 MCP stdio server → HTTP → hub 的 IPC 闭环,不是正式 hub。
const express = require('express');

const app = express();
app.use(express.json());

const TOKEN = process.env.CC_WEB_HUB_TOKEN || 'spktok';
const PORT = Number(process.env.PORT) || 7799;

app.get('/api/mcp/list_sessions', (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // 与 spec §5 的 list_sessions 响应结构保持一致(最小子集)。
  res.json({
    machines: [
      {
        id: 'mc1',
        online: true,
        sessions: [
          { machine: 'mc1', name: 's1', status: 'idle' },
        ],
      },
    ],
  });
});

app.listen(PORT, () => {
  console.error(`[spike hub-shim] listening on http://127.0.0.1:${PORT}`);
});
