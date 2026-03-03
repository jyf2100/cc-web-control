# v3 Plan: Session Consistency (URL next + localStorage + server config)

PRD Trace:

- PRD-0003
  - REQ-0003-001
  - REQ-0003-002
  - REQ-0003-003

## Goal

修复 Web 端 session 与实际连接 session 不一致导致的“记忆断层”，并让登录重定向/刷新/重连保持 session。

## Acceptance（硬口径）

1. 未登录时访问 `/?session=claude-xxx` 会跳到 `/login?next=...`，登录成功后回到 `/?session=claude-xxx`。
2. 当 URL 不带 `session`：
   - Web 端会从 `localStorage` 恢复上次选择的 session（存在时）。
3. `GET /api/config` 返回 `defaultSession`，Web 端默认值与服务端一致。
4. `npm test` 全绿。

## Steps (TDD)

### Step 1 — Red: add unit tests for next-path normalization

Files:

- Modify `auth.js`: add `normalizeNextPath(next)`
- Modify `test/auth.test.js`: add failing tests

Run:

```bash
npm test
```

Expected:

- 新增测试先红（未实现）。

### Step 2 — Green: implement next redirect + config endpoint

Files:

- Modify `server.js`
  - `/api/config`
  - requireAuth redirect with `next`
  - `/login` POST redirects to safe `next`
- Modify `public/login.html`
  - hidden `next` input filled from query string

Run:

```bash
npm test
```

Expected:

- 全绿。

### Step 3 — Green: client session persistence

Files:

- Modify `public/client.js`
  - read `defaultSession` from `/api/config`
  - store & restore `cc_web_last_session` via localStorage
  - only auto-switch when URL doesn’t explicitly set `session`

Manual:

- 切换 session -> 刷新 -> 仍在同一 session

## Ship

- `git add -A`
- `git commit -m "fix: keep session consistent across login and reload"`
- `git push`

