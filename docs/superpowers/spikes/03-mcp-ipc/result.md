# Spike 03 — MCP stdio → HTTP IPC 闭环

**日期:** 2026-07-02
**分支:** `feat/main-agent-t1`
**结论:** **GO** ✅

验证主控 agent 的工具调用通道:`claude`(主 agent)→ spawn MCP stdio server(`stdio.cjs`)→ server 经 HTTP 回调 hub `/api/mcp/list_sessions` → 返回数据。

---

## SDK 定论(对 Task 10 至关重要)

- **版本:** `@modelcontextprotocol/sdk@1.29.0`
- **package.json `type`:** `module` —— **但** `exports` map 同时给 ESM 与 CJS 两种构建:
  ```json
  "./*": {
    "types": "./dist/esm/*.d.ts",
    "import": "./dist/esm/*",
    "require": "./dist/cjs/*"
  }
  ```
  所以在 `.cjs` 里直接 `require()` 就能用,**不会** 触发 `ERR_REQUIRE_ESM`。Task 10 正式实现可继续用 CJS(`.cjs`)与现有项目一致,无需切 `.mjs`/dynamic `import()`。

- **正确的 CJS 导入路径:**
  ```js
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  ```
  注意:**必须带子路径**(`.../server/index.js` 等)。裸名 `'@modelcontextprotocol/sdk'` 只 re-export 顶层 index,不含 `Server`/`StdioServerTransport`。

- **Server 构造:**
  ```js
  const server = new Server(
    { name: 'cc-web-control', version: 'x.y.z' },
    { capabilities: { tools: {} } },   // 声明有 tools 能力
  );
  ```

- **handler 注册方式(重要):** SDK 用 **zod schema** 作 key,不是 method 字符串:
  ```js
  server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => ({
    tools: [{ name: 'list_sessions', description: '...', inputSchema: { type: 'object', properties: {} } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const toolName = req.params.name;        // 工具名
    const args = req.params.arguments;       // 参数
    // ...业务逻辑...
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    // 出错时:return { isError: true, content: [{ type: 'text', text: '...' }] };
  });
  ```
  handler 接 `(parsedReq, extra)`,返回值是 `tools/list` 或 `tools/call` 的 result。

- **transport 连接(易错点):** **`server.connect(transport)`,不是 `transport.connect(server)`**(后者会报 `connect is not a function`)。SDK 错误信息也确认:`connect() calls start() automatically`。
  ```js
  server.connect(new StdioServerTransport()).then(() => console.error('ready'));
  ```

- **low-level `Server` vs high-level `McpServer`:** 本 spike 用的是 low-level `Server`(SDK 注释里标 `@deprecated Use McpServer instead`)。但 `Server` 仍是公开 API、稳定、足够用(且更接近 spec §5 描述的 stdio + 手工 handler 模型)。Task 10 也可选 `McpServer`(更高层,有 `server.tool(name, schema, handler)` 简化 API)——届时看哪个更贴合 hub_mcp_server 的实现。

---

## claude `--mcp-config`:两种形式都接受

`claude --help`:
```
--mcp-config <configs...>   Load MCP servers from JSON files or strings (space-separated)
```

**两种都验证通过:**
1. **内联 JSON 字符串:**
   ```bash
   claude -p '...' --strict-mcp-config \
     --mcp-config '{"mcpServers":{"cc":{"command":"node","args":["..."]}}}'
   ```
2. **文件路径:**
   ```bash
   echo '{"mcpServers":{...}}' > /tmp/spike-mcp.json
   claude -p '...' --strict-mcp-config --mcp-config /tmp/spike-mcp.json
   ```

- `--strict-mcp-config` 让 claude 只用这里给的 server,忽略全局/项目其它 MCP 配置(spike 干净关键)。
- **headless 模式权限:** MCP 工具默认要授权,`-p` 模式无法交互授权。需加 `--allowed-tools "mcp__<server>__<tool>"` 预授权(命名规则 `mcp__<serverName>__<toolName>`)。**不要** 用 `--permission-mode bypassPermissions` —— 被安全 classifier 拦。

---

## 证据(claude 输出关键片段)

### 端到端正向(Inline JSON)
```
$ claude -p '调用 list_sessions 工具,告诉我返回的 machines 和 sessions' \
    --strict-mcp-config \
    --mcp-config '{"mcpServers":{"cc":{"command":"node","args":["docs/superpowers/spikes/03-mcp-ipc/stdio.cjs"]}}}' \
    --allowed-tools "mcp__cc__list_sessions"

`list_sessions` 返回内容如下:
## machines(1 台)
| id | online |
|----|--------|
| `mc1` | `true`(在线) |
## sessions(1 个,隶属于 mc1)
| machine | name | status |
|---------|------|--------|
| `mc1` | `s1` | `idle`(空闲) |
总结:hub 上注册了 1 台机器(mc1,在线),该机器上有 1 个会话(s1,当前空闲)。
```
→ claude 通过 stdio MCP server 经 HTTP 拿到了 shim 数据(`mc1` / `s1`)。

### 反向(负向)验证
kill 掉 hub shim 后再跑同样命令,claude 报错:
```
调用失败,符合预期。
错误信息:
MCP error -32603: fetch failed
-32603 是 JSON-RPC 的内部错误码,fetch failed 表明 mcp__cc__list_sessions
这个 MCP server 发请求时连接失败 —— 最可能是 hub 服务没有运行
```
→ 证明 HTTP 回调是 load-bearing 的,server 确实在调 hub。

### SDK handler 注册自测
手工 JSON-RPC(给 stdio server 发 `initialize` → `notifications/initialized` → `tools/list`)返回:
```json
{"result":{"tools":[{"name":"list_sessions","description":"List cc-web-control sessions from the hub.","inputSchema":{"type":"object","properties":{}}}]},"jsonrpc":"2.0","id":2}
```

---

## 过程中遇到的坑(spike 价值)

1. **`transport.connect(server)` 报错** → 正确是 `server.connect(transport)`。
2. **冒烟测试时 `tools/list` 返回 "Method not found"** → 原因是测试脚本在同 tick 内连发 `initialized` 通知和请求,SDK 还没处理通知。加 200ms 延迟后正常。**claude 这种正规 MCP client 不会有此问题。**
3. **headless 模式权限** → 用 `--allowed-tools mcp__<server>__<tool>`;`--permission-mode bypassPermissions` 被安全 classifier 拦。

---

## Go / No-Go

### **GO** ✅

Task 10(正式 hub_mcp_server)按此方案实现:
- 独立 stdio 子进程(`bin/cc-web-control-mcp.cjs`)
- 用 `@modelcontextprotocol/sdk`(CJS require 即可,无需 ESM 改造)
- low-level `Server` + `setRequestHandler(Schema, handler)`
- handler 内 `fetch` hub `/api/mcp/*`,带 `Authorization: Bearer <hub_token>`
- spec §5「hub_mcp_server = 独立 stdio 子进程 + HTTP IPC」可行性 **已验证**

无需手写 JSON-RPC;SDK 在 node v25 / CommonJS 项目里工作良好。

---

## 文件

- `docs/superpowers/spikes/03-mcp-ipc/hub-shim.cjs` — 模拟 hub 的最小 express server
- `docs/superpowers/spikes/03-mcp-ipc/stdio.cjs` — 最小 MCP stdio server(一个 list_sessions 工具)
- `docs/superpowers/spikes/03-mcp-ipc/result.md` — 本文
