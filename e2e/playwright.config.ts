// Playwright config for acceptance suite: e2e-login-version-footer (project: cc-web-control)
// Injected alongside e2e_*.spec.ts (overrides any repo-level playwright config).
// Service lifecycle is owned entirely by webServer below (dev server on port 4182,
// matching the mechanically assigned port; profile e2e_dev_cmd `node server.cjs`
// rewritten with PORT=4182 so the server actually listens on 4182).
// Zero external network; single browser (chromium); tests never start/stop servers.
//
// 环境对接修正(非测试改写,spec 原样保留):本仓 server.cjs 不读通用 PORT,
// 而经 config_loader.cjs 读专用 env——端口 CC_WEB_PORT(默认 7684),鉴权
// CC_WEB_AUTH_TOKEN(未设 = 鉴权关闭,/ 不会重定向 /login,ac1 不成立)。故
// webServer command 按本仓 env 契约重写,使 server 实际监听 4182 且开启鉴权:
//   CC_WEB_PORT=4182            → 监听 4182(config.port)
//   CC_WEB_AUTH_TOKEN=<e2e 专用> → 开启未登录跳转护栏(ac1 前置)
//   CC_WEB_WEB_ONLY=1           → 不创建/附加 tmux 会话(e2e 只测 HTTP 面)
//   CC_WEB_NO_OPEN=1            → 不尝试 xdg-open 唤起浏览器
//   CC_WEB_HUB_URL=             → 显式清空,确保零反向注册外连
// cwd 对接:webServer cwd 显式指仓根(server.cjs 所在;默认是 config 所在目录 e2e/)。
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /e2e_.*\.spec\.ts/,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4182',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'CC_WEB_PORT=4182 CC_WEB_AUTH_TOKEN=e2e-acceptance-token CC_WEB_WEB_ONLY=1 CC_WEB_NO_OPEN=1 CC_WEB_HUB_URL= node server.cjs',
    cwd: '..',
    // 注:本仓锁定的 @playwright/test 1.64 中 port 与 url 互斥(同时给出即报错);
    // 保留 port(TCP 就绪探测),baseURL 已由上方 use.baseURL 指定同一端口。
    port: 4182,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
