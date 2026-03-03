# PRD-0002: 安全的隧道外网访问（手机可访问）

## Vision

让 `cc-web-control` 能通过“隧道方式”安全地暴露到外网，用户可用手机在 4G/5G 或异地网络访问，同时把风险控制在可接受范围内：

- 默认仍只监听 `127.0.0.1`（不直接暴露到局域网/公网）。
- 通过隧道暴露时，必须有鉴权（避免“拿到 URL 就能操作 tmux”）。
- WebSocket 与 HTTP API 都要受同一鉴权保护。

## Non-goals（本 PRD 不做）

- 不做“完全公网端口映射（路由器转发）”一键方案。
- 不做用户体系/账号管理（仅提供单 token 鉴权）。
- 不引入大型依赖或完整反向代理栈（nginx/caddy 作为可选，但不内置）。

## Background / Problem

当前服务默认监听 `127.0.0.1:7684`，只能本机访问。要让手机在外网访问，通常会使用 Cloudflare Tunnel / ngrok / SSH reverse tunnel 等。

但该服务本质上可以“远程控制 tmux/Claude Code”，**一旦暴露到外网且无鉴权**，风险极高。

## Requirements

### REQ-0002-001: 可配置鉴权开关（环境变量）

- 增加 `CC_WEB_AUTH_TOKEN`（可选）：
  - 未设置时：行为与现在一致（兼容本地使用）。
  - 设置后：除登录页与健康检查外，所有 HTTP 静态资源、API、WebSocket 连接都必须鉴权通过。

验收：

- 未携带 token 时访问 `/` 会被重定向到 `/login`。
- token 正确登录后，可正常加载页面、建立 WS、发送输入并看到输出。

### REQ-0002-002: 登录与会话保持（Cookie）

- 提供 `/login` 页面（GET）与登录提交（POST）：
  - 用户输入 token，服务端校验后设置 HttpOnly Cookie。
  - 后续浏览器访问与 WebSocket 握手均通过 Cookie 自动携带鉴权。

验收：

- 手机浏览器打开隧道 URL，输入 token 后能进入主页面且 WS 正常。
- Cookie 具备 `HttpOnly` 与 `SameSite`，在 HTTPS（隧道）场景下尽可能设置 `Secure`。

### REQ-0002-003: 防 CSRF/跨站连接的最小保护（Origin 校验）

- 当启用鉴权时：
  - WebSocket 握手若带 `Origin`，必须与当前 Host/协议匹配，否则拒绝。
  - 对写操作（例如登录 POST）做同样校验（最小化跨站请求风险）。

验收：

- 非同源页面发起的 WS/POST 被拒绝（至少默认浏览器场景下）。

### REQ-0002-004: 隧道使用说明（Docs）

- 文档给出一个“安全的隧道方案”（推荐 Cloudflare Tunnel Quick Tunnel 或等价方案）：
  - 服务保持监听 `127.0.0.1`
  - 启用 `CC_WEB_AUTH_TOKEN`
  - 用隧道暴露并用手机访问

验收：

- 文档里的命令按步骤执行可得到一个外网可访问的 HTTPS URL，且需要 token 才能操作。

## Risks / Notes

- 该服务会镜像 tmux 输出，可能包含敏感信息；外网访问前需自行评估风险。
- “单 token”是最小方案：若链接泄露且 token 也泄露，仍可能被滥用；建议定期更换 token。

