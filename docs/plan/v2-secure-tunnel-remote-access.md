# v2 Plan: Secure Tunnel Remote Access (Auth + Cloudflare Tunnel)

PRD Trace:

- PRD-0002
  - REQ-0002-001
  - REQ-0002-002
  - REQ-0002-003
  - REQ-0002-004

## Goal

让服务在“通过隧道暴露到外网”的场景下具备最小但可靠的安全边界：必须登录（token）才能访问页面/WS/API，并避免明显的跨站滥用。

## Acceptance（硬口径）

1. 设置 `CC_WEB_AUTH_TOKEN=...` 后：
   - `curl -i http://127.0.0.1:7684/` 返回 302 到 `/login`
2. 登录后（Cookie 生效）：
   - `curl -i --cookie "cc_web_auth=..." http://127.0.0.1:7684/api/sessions` 返回 200 JSON（或同等成功）
3. WebSocket 在未授权时会被拒绝（连接关闭），授权后可正常收到 `init/output`。
4. `npm test` 全绿。

## Steps (TDD)

### Step 1 — Red: add unit tests for auth helpers

Files:

- Create `auth.js`
- Create `test/auth.test.js`

Run:

```bash
npm test
```

Expected:

- 新增测试先红（未实现）。

### Step 2 — Green: implement Express auth + login page

Files:

- Modify `server.js`:
  - `CC_WEB_AUTH_TOKEN` 支持
  - `/login` GET/POST
  - middleware 保护 static/API
  - WS 握手校验 cookie + origin
- Add `public/login.html`

Run:

```bash
npm test
```

Expected:

- 全绿。

### Step 3 — E2E: local verification

启动服务：

```bash
CC_WEB_AUTH_TOKEN="test-token" CC_WEB_PROJECT_ROOTS="/Volumes/work/workspace" node server.js --no-open --no-attach
```

验证重定向：

```bash
curl -i http://127.0.0.1:7684/ | head
```

验证登录（表单）：

```bash
curl -i -X POST -d "token=test-token" http://127.0.0.1:7684/login | head
```

（或用浏览器打开 `/login` 输入 token）

### Step 4 — E2E: tunnel verification (manual)

安装 `cloudflared`（如未安装）：

```bash
brew install cloudflared
```

启动隧道（保持服务仅在本机监听）：

```bash
cloudflared tunnel --url http://127.0.0.1:7684
```

用手机打开输出的 `https://*.trycloudflare.com`：

- 输入 token 登录
- 进入主页面并能看到 tmux 输出与 WS 更新

## Ship

- `git add -A`
- `git commit -m "feat: auth-gated remote access for tunnel"`
- `git push`

