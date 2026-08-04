'use strict';

/**
 * 截图渲染引擎：用 headless Chromium 把本地控制台/看板页面渲染成 PNG。
 *
 * 设计要点：
 *  - puppeteer-core 经 *惰性 require*（仅真正 render 时），缺失则抛 RenderEngineUnavailable
 *    （被 screenshot.cjs 映射为 503，满足 AC7「渲染引擎未就绪」显式上报）。
 *  - 不自动下载 Chromium：复用系统已装的 chrome/chromium（env PUPPETEER_EXECUTABLE_PATH 或常见路径）。
 *    无显示器/CI 全场景可用（headless + --no-sandbox）→ AC2。
 *  - browser 进程为单例懒启动（首次 render 时拉起，复用），冷启动一次后单张截图 P95 ≤ 3s（AC8）。
 *  - fs / require / env 均可注入，单测不碰真实进程/网络。
 *  - 错误类带 renderErrorKind 鸭子属性，供 screenshot.cjs 分类（单向依赖，渲染器不反向 import 纯逻辑）。
 */

const DEFAULT_NAV_TIMEOUT_MS = 8000; // page.goto 等待 networkidle2 的上限
const DEFAULT_SELECTOR_TIMEOUT_MS = 4000; // waitSelector 等待上限（超时不致命，截当前态）
const DEFAULT_SETTLE_MS = 350; // 内容渲染后的稳定等待（WebSocket/dashboard 落屏）
const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

// 常见 Chromium/Chrome 安装路径（按出现概率排序）。
const LINUX_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
];
const DARWIN_CANDIDATES = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const WIN32_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Chromium\\Application\\chrome.exe',
];

function candidatesFor(platform) {
  if (platform === 'darwin') return DARWIN_CANDIDATES;
  if (platform === 'win32') return WIN32_CANDIDATES;
  return LINUX_CANDIDATES;
}

/**
 * 探测可用浏览器可执行路径。纯函数（fs/platform/env 注入）。
 */
function detectExecutablePath(opts = {}) {
  const env = opts.env || {};
  const fsImpl = opts.fsImpl || require('node:fs');
  const platform = opts.platform || (opts.process && opts.process.platform) || process.platform;

  const fromEnv = typeof env.PUPPETEER_EXECUTABLE_PATH === 'string' ? env.PUPPETEER_EXECUTABLE_PATH.trim() : '';
  if (fromEnv) return fromEnv;

  for (const c of candidatesFor(platform)) {
    try {
      if (fsImpl.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function mark(err, kind) {
  err.renderErrorKind = kind;
  return err;
}

class RenderEngineUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'RenderEngineUnavailable';
    this.renderErrorKind = 'engine_unavailable';
  }
}

class RenderTimeout extends Error {
  constructor(message) {
    super(message);
    this.name = 'RenderTimeout';
    this.renderErrorKind = 'timeout';
  }
}

/**
 * 创建 puppeteer-core 渲染器。
 * @param {object} opts
 * @param {string} [opts.executablePath] - 覆盖自动探测
 * @param {function} [opts.requireImpl] - 惰性 require（默认 node require；测试可注入桩）
 * @param {object} [opts.fsImpl]
 * @param {object} [opts.env]
 * @param {string} [opts.platform]
 * @param {number} [opts.launchTimeoutMs]
 * @param {number} [opts.navTimeoutMs]
 * @param {number} [opts.selectorTimeoutMs]
 * @param {number} [opts.settleMs]
 * @param {function} [opts.nowFn] - 仅供调试/可观测，默认 Date.now
 */
function createPuppeteerRenderer(opts = {}) {
  const requireImpl = opts.requireImpl || ((m) => require(m));
  const fsImpl = opts.fsImpl || require('node:fs');
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const executablePath = opts.executablePath !== undefined ? opts.executablePath : detectExecutablePath({ env, fsImpl, platform });
  const launchTimeoutMs = opts.launchTimeoutMs || DEFAULT_LAUNCH_TIMEOUT_MS;
  const navTimeoutMs = opts.navTimeoutMs || DEFAULT_NAV_TIMEOUT_MS;
  const selectorTimeoutMs = opts.selectorTimeoutMs || DEFAULT_SELECTOR_TIMEOUT_MS;
  const settleMs = opts.settleMs != null ? opts.settleMs : DEFAULT_SETTLE_MS;

  let browserPromise = null;

  async function getBrowser() {
    if (browserPromise) return browserPromise;
    browserPromise = (async () => {
      if (!executablePath) {
        throw new RenderEngineUnavailable(
          'no chromium/chrome executable found; set PUPPETEER_EXECUTABLE_PATH or install chromium'
        );
      }
      let puppeteer;
      try {
        puppeteer = requireImpl('puppeteer-core');
      } catch {
        throw new RenderEngineUnavailable(
          'puppeteer-core is not installed; run `npm install` (it is an optional dependency) or `npm install puppeteer-core`'
        );
      }
      try {
        return await puppeteer.launch({
          executablePath,
          headless: true,
          timeout: launchTimeoutMs,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--font-render-hinting=none',
          ],
        });
      } catch (err) {
        throw new RenderEngineUnavailable(`failed to launch browser (${executablePath}): ${(err && err.message) || err}`);
      }
    })().catch((err) => {
      // 失败清空缓存，下次请求重试。
      browserPromise = null;
      throw err;
    });
    return browserPromise;
  }

  async function render({ url, width, height, waitSelector, token, cookieName }) {
    const browser = await getBrowser();
    let context;
    let page;
    try {
      context = await browser.createIncognitoBrowserContext();
      page = await context.newPage();
    } catch (err) {
      // 浏览器进程可能已死：清缓存，让下次重启。
      browserPromise = null;
      try { await browser.close(); } catch { /* ignore */ }
      throw new RenderEngineUnavailable(`browser unavailable: ${(err && err.message) || err}`);
    }

    try {
      // 鉴权 cookie：auth 开启时页面/WS 都要它。cookie 域取 URL 的 hostname。
      if (token) {
        let origin;
        try { origin = new URL(url); } catch { origin = null; }
        if (origin) {
          await page.setCookie({
            name: cookieName || 'cc_web_auth',
            value: token,
            domain: origin.hostname,
            path: '/',
          }).catch(() => {});
        }
      }

      await page.setViewport({ width, height, deviceScaleFactor: 1 });

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: navTimeoutMs });
      } catch (err) {
        if (err && /timeout/i.test(err.message || '')) {
          throw new RenderTimeout(`navigation timed out: ${url}`);
        }
        throw err;
      }

      // 等"内容已渲染"的选择器；超时不致命（可能是空态），仅吞掉、截当前画面。
      if (waitSelector) {
        try {
          await page.waitForSelector(waitSelector, { timeout: selectorTimeoutMs, visible: true });
        } catch {
          /* 空态或慢渲染：继续截图 */
        }
      }

      if (settleMs > 0) {
        await new Promise((r) => setTimeout(r, settleMs));
      }

      // clip 锁死视口尺寸 → 返回像素宽高与请求精确一致（AC5 ≤1px）。
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
      });
      return { png, width, height };
    } finally {
      try { await page.close(); } catch { /* ignore */ }
      try { if (context) await context.close(); } catch { /* ignore */ }
    }
  }

  async function close() {
    const p = browserPromise;
    browserPromise = null;
    if (!p) return;
    try {
      const browser = await p.catch(() => null);
      if (browser) await browser.close();
    } catch { /* ignore */ }
  }

  return {
    render,
    close,
    // 暴露探测结果供诊断（不暴露 browser 实例）。
    get executablePath() { return executablePath; },
  };
}

module.exports = {
  detectExecutablePath,
  createPuppeteerRenderer,
  RenderEngineUnavailable,
  RenderTimeout,
  candidatesFor,
  DEFAULT_NAV_TIMEOUT_MS,
  DEFAULT_SELECTOR_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
};
