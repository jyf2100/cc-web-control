# PRD-0003: Session 一致性（避免“记忆断层”）

## Vision

当用户用 Web/手机端操作 Claude Code 时，**永远明确连接到哪个 tmux session**，并在刷新、掉线重连、登录跳转（/login）后仍保持同一 session，从而避免“选错 session → 记忆断层”。

## Background / Problem

目前 session 选择存在几个易错点：

- 访问需要登录时会被重定向到 `/login`，登录后回到 `/`，URL 里的 `?session=...` 会丢失，导致回到默认 session。
- Web 端没有“最后一次选择的 session”的持久化；同一个手机/浏览器刷新后可能落到默认/列表第一项，和你刚才交互的 session 不一致。
- Web 端默认 session 名称写死为 `claude-web-session`，当服务端通过 `CC_WEB_SESSION` 配置不同默认值时，前后端默认不一致。

## Requirements

### REQ-0003-001: 登录跳转保持原 URL（含 session 参数）

- 当启用 `CC_WEB_AUTH_TOKEN` 且用户未登录：
  - 访问任意页面（例如 `/?session=claude-xxx`）应重定向到 `/login?next=<originalUrl>`
  - 登录成功后重定向回 `next`（安全校验后）

验收：

- `GET /?session=claude-xxx` -> 302 到 `/login?next=%2F%3Fsession%3Dclaude-xxx`
- 登录成功后 Location 回到 `/?session=claude-xxx`

### REQ-0003-002: 客户端记住“最后选择的 session”

- 若 URL 未显式指定 `session`：
  - 使用 `localStorage` 记住并恢复上次选择的 session
  - 若该 session 已不存在，再回退到服务端默认 / 已 attached 的 session / 列表第一项

验收：

- 在 Web 端切换 session 后刷新页面，仍连接到同一个 session。

### REQ-0003-003: 服务端下发默认 session（前后端一致）

- 提供 `GET /api/config`，返回 `defaultSession`（等于服务端的 `CC_WEB_SESSION` 或默认值）
- Web 端使用该值作为默认回退，而不是写死字符串

验收：

- 设置 `CC_WEB_SESSION=foo` 后，Web 端默认连接到 `foo`（当 URL 和 localStorage 都无指定时）。

## Non-goals

- 不做“多用户/多 token 各自记住 session”（仅在单浏览器维度记忆）。
- 不实现完整的会话/记忆迁移；只是避免“选错 session”。

