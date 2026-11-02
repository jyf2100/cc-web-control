import { defineConfig } from '@playwright/test';

// 确定性纪律：dev server 起停全归 webServer 管（reuseExistingServer），测试内零手工起停、零外网依赖。
// command 把 e2e_dev_cmd（node server.cjs）的端口改写为编排器机械分配的 4188（CC_WEB_PORT env）。
// 注：本仓 server 读专用变量 CC_WEB_PORT（见 config_loader.cjs 端口字段），不读通用 PORT。
export default defineConfig({
  testDir: '.',
  testMatch: /e2e_.*\.spec\.ts/,
  retries: 1,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4188',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'CC_WEB_PORT=4188 node server.cjs',
    url: 'http://127.0.0.1:4188',
    port: 4188,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
