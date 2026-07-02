'use strict';
// Spike stdio MCP server: 暴露一个工具 list_sessions,经 HTTP 回调 hub。
// 验证 claude(主 agent) → spawn MCP stdio server → HTTP → hub 的 IPC 闭环。
//
// SDK 关键定论(见 result.md):
//   - @modelcontextprotocol/sdk v1.29.0 同时发布 ESM 与 CJS 两种构建,exports[./*] 给两者。
//   - 在 .cjs 里用 require() 即可,不会触发 ERR_REQUIRE_ESM。
//   - 入口:
//       Server              = require('@modelcontextprotocol/sdk/server/index.js').Server
//       StdioServerTransport = require('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport
//       *RequestSchema      = require('@modelcontextprotocol/sdk/types.js').*RequestSchema
//   - 注册 handler:server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => ({...}))
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const HUB_URL = process.env.CC_WEB_HUB_URL || 'http://127.0.0.1:7799';
const TOKEN = process.env.CC_WEB_HUB_TOKEN || 'spktok';

const server = new Server(
  { name: 'cc-spike', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

// tools/list:声明可用工具。
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_sessions',
      description: 'List cc-web-control sessions from the hub.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

// tools/call:经 HTTP 回调 hub 拿数据,包成 MCP text content 返回。
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const toolName = req?.params?.name;
  if (toolName !== 'list_sessions') {
    return {
      isError: true,
      content: [{ type: 'text', text: `unknown tool: ${toolName}` }],
    };
  }

  const r = await fetch(`${HUB_URL}/api/mcp/list_sessions`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: `hub HTTP ${r.status}` }],
    };
  }
  const data = await r.json();
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
});

server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[spike stdio] ready; hub=${HUB_URL}`))
  .catch((err) => {
    console.error('[spike stdio] connect failed:', err);
    process.exit(1);
  });
