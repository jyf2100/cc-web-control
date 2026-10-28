/**
 * Acceptance tests — PRD: 登录页版本号 footer 与未登录跳转护栏 (cc-web-control)
 * criterion: 20261028m16-e2e-login-version-footer:ac1
 * criterion: 20261028m16-e2e-login-version-footer:ac2
 * criterion: 20261028m16-e2e-login-version-footer:ac3
 *
 * Determinism discipline: conditional web-first waits only (toBeVisible /
 * toHaveURL / toHaveTitle auto-retry) — no page.waitForTimeout, no fixed
 * sleeps, no wall-clock assertions, no random data, zero external network
 * (SUT only, via baseURL backed by playwright.config.ts webServer on 4182).
 * Each test runs in a fresh browser context => always unauthenticated.
 */

import { test, expect } from '@playwright/test';

// PRD: footer shows `v<version>` where <version> is package.json's semver.
// (Repo-package.json read-back is not possible under the single-import rule
// `@playwright/test`, so the behavioral face is: visible footer text matching
// the `v<semver>` shape from the AC's `v<version>` example.)
const VERSION_TEXT_RE = /v\d+\.\d+\.\d+/;

test.describe('e2e-login-version-footer', () => {
  // criterion: 20261028m16-e2e-login-version-footer:ac1
  test('ac1: unauthenticated visit to / redirects to /login; login page title contains "Roc-CC Remote Control" and renders token input #token [criterion: 20261028m16-e2e-login-version-footer:ac1]', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveTitle(/Roc-CC Remote Control/);
    await expect(page.locator('#token')).toBeVisible();
  });

  // criterion: 20261028m16-e2e-login-version-footer:ac2
  test('ac2: login page renders a visible bottom footer displaying the version value v<version> [criterion: 20261028m16-e2e-login-version-footer:ac2]', async ({ page }) => {
    await page.goto('/login');
    // Confirm the login page actually rendered before inspecting its footer.
    await expect(page.locator('#token')).toBeVisible();

    const footer = page
      .locator('footer, [class*="footer"], [id*="footer"], [data-testid*="footer"]')
      .filter({ hasText: VERSION_TEXT_RE })
      .first();
    await expect(footer).toBeVisible();
    await expect(footer).toHaveText(VERSION_TEXT_RE);
  });

  // criterion: 20261028m16-e2e-login-version-footer:ac3
  test('ac3: version footer is statically present in the served /login HTML document (viewable in page HTML, no console/network panel needed) [criterion: 20261028m16-e2e-login-version-footer:ac3]', async ({ page }) => {
    const response = await page.goto('/login');
    if (!response) {
      throw new Error('GET /login returned no response');
    }
    expect(response.status()).toBeLessThan(400);
    // Raw HTML as delivered by the server (pre-rendering, pre-DOM-mutation):
    // the version value must already be in the static markup.
    const html = await response.text();
    expect(html).toMatch(VERSION_TEXT_RE);
  });
});
