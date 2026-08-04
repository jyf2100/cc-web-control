'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectExecutablePath,
  createPuppeteerRenderer,
  RenderEngineUnavailable,
  RenderTimeout,
  candidatesFor,
} = require('../screenshot_render.cjs');
const { PNG_MAGIC } = require('../screenshot.cjs');

function fakePng() {
  return Buffer.concat([PNG_MAGIC, Buffer.from('rendered-bytes')]);
}

// 假 puppeteer：记录调用 + 可配置失败。
function fakePuppeteerModule(opts = {}) {
  const calls = {
    launch: 0,
    launchOpts: null,
    lastCookie: null,
    lastViewport: null,
    lastGoto: null,
    lastWait: null,
    lastScreenshot: null,
    closedBrowser: false,
    closedContexts: 0,
    closedPages: 0,
  };
  const png = opts.png || fakePng();
  const browser = {
    async createIncognitoBrowserContext() {
      const ctx = {
        async newPage() {
          const page = {
            async setCookie(c) { calls.lastCookie = c; },
            async setViewport(v) { calls.lastViewport = v; },
            async goto(u, o) {
              calls.lastGoto = { u, o };
              if (opts.gotoThrows) {
                const e = new Error(opts.gotoThrows === true ? 'Navigation timeout exceeded' : opts.gotoThrows);
                throw e;
              }
            },
            async waitForSelector(s, o) { calls.lastWait = { s, o }; },
            async screenshot(o) { calls.lastScreenshot = o; return png; },
            async close() { calls.closedPages++; },
          };
          return page;
        },
        async close() { calls.closedContexts++; },
      };
      return ctx;
    },
    async close() { calls.closedBrowser = true; },
  };
  const puppeteer = {
    async launch(o) {
      calls.launch++;
      calls.launchOpts = o;
      if (opts.launchThrows) throw new Error(opts.launchThrows === true ? 'launch failed' : opts.launchThrows);
      return browser;
    },
  };
  return { puppeteer, calls };
}

function baseRendererOpts(requireRet, extra = {}) {
  return {
    executablePath: '/fake/chrome',
    requireImpl: () => requireRet,
    settleMs: 0,
    selectorTimeoutMs: 5,
    navTimeoutMs: 20,
    launchTimeoutMs: 50,
    ...extra,
  };
}

// ============ detectExecutablePath ============

test('detectExecutablePath: env PUPPETEER_EXECUTABLE_PATH 优先', () => {
  const fsMock = { existsSync: () => false };
  const r = detectExecutablePath({
    env: { PUPPETEER_EXECUTABLE_PATH: '/custom/chrome' },
    fsImpl: fsMock,
    platform: 'linux',
  });
  assert.equal(r, '/custom/chrome');
});

test('detectExecutablePath: 无 env 时回落到候选路径中首个存在的', () => {
  const fsMock = { existsSync: (p) => p === '/usr/bin/chromium' };
  const r = detectExecutablePath({ env: {}, fsImpl: fsMock, platform: 'linux' });
  assert.equal(r, '/usr/bin/chromium');
});

test('detectExecutablePath: 都不存在 → 空串', () => {
  const fsMock = { existsSync: () => false };
  assert.equal(detectExecutablePath({ env: {}, fsImpl: fsMock, platform: 'linux' }), '');
});

test('detectExecutablePath: 平台候选集分离(linux/darwin/win32)', () => {
  assert.ok(candidatesFor('linux').includes('/usr/bin/chromium'));
  assert.ok(candidatesFor('darwin').some((p) => p.includes('Chromium.app')));
  assert.ok(candidatesFor('win32').some((p) => p.includes('chrome.exe')));
});

// ============ createPuppeteerRenderer: 成功路径 ============

test('render: 返回 PNG buffer + 精确视口(AC5)', async () => {
  const { puppeteer, calls } = fakePuppeteerModule();
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  const out = await r.render({
    url: 'http://127.0.0.1:7684/dashboard.html',
    width: 1024, height: 768,
    waitSelector: '#board-body, body',
    token: 'TOK', cookieName: 'cc_web_auth',
  });
  assert.equal(out.width, 1024);
  assert.equal(out.height, 768);
  assert.ok(Buffer.isBuffer(out.png));
  assert.equal(out.png.subarray(0, 8).compare(PNG_MAGIC), 0);
});

test('render: 调用参数正确(headless/no-sandbox/cookie/viewport/clip)', async () => {
  const { puppeteer, calls } = fakePuppeteerModule();
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  await r.render({
    url: 'http://127.0.0.1:7684/',
    width: 800, height: 600,
    waitSelector: 'body',
    token: 'SECRET', cookieName: 'cc_web_auth',
  });
  assert.equal(calls.launchOpts.executablePath, '/fake/chrome');
  assert.equal(calls.launchOpts.headless, true);
  assert.ok(calls.launchOpts.args.includes('--no-sandbox'));
  assert.ok(calls.launchOpts.args.includes('--disable-dev-shm-usage'));
  // cookie 注入(auth 开启时页面才可达)
  assert.equal(calls.lastCookie.name, 'cc_web_auth');
  assert.equal(calls.lastCookie.value, 'SECRET');
  assert.equal(calls.lastCookie.domain, '127.0.0.1');
  // viewport 与 screenshot clip 锁死请求尺寸
  assert.deepEqual(calls.lastViewport, { width: 800, height: 600, deviceScaleFactor: 1 });
  assert.deepEqual(calls.lastScreenshot.clip, { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(calls.lastScreenshot.type, 'png');
  assert.equal(calls.lastGoto.u, 'http://127.0.0.1:7684/');
});

test('render: 无 token 时不注入 cookie', async () => {
  const { puppeteer, calls } = fakePuppeteerModule();
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  await r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10, waitSelector: 'body' });
  assert.equal(calls.lastCookie, null);
});

test('render: browser 单例复用(多次 render 只 launch 一次 → AC8)', async () => {
  const { puppeteer, calls } = fakePuppeteerModule();
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  await r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10, waitSelector: 'body' });
  await r.render({ url: 'http://127.0.0.1:7684/', width: 20, height: 20, waitSelector: 'body' });
  assert.equal(calls.launch, 1);
});

test('render: close() 关闭 browser', async () => {
  const { puppeteer, calls } = fakePuppeteerModule();
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  await r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10, waitSelector: 'body' });
  await r.close();
  assert.equal(calls.closedBrowser, true);
  // close 后再次 render 应重新 launch
  await r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10, waitSelector: 'body' });
  assert.equal(calls.launch, 2);
});

// ============ createPuppeteerRenderer: 失败路径(AC7) ============

test('render: 无可执行路径 → RenderEngineUnavailable(engine_unavailable)', async () => {
  const { puppeteer } = fakePuppeteerModule();
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer, { executablePath: '' }));
  await assert.rejects(
    () => r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10 }),
    (err) => err.renderErrorKind === 'engine_unavailable'
  );
});

test('render: puppeteer-core 未装 → RenderEngineUnavailable', async () => {
  const r = createPuppeteerRenderer({
    executablePath: '/fake/chrome',
    requireImpl: () => { throw new Error('Cannot find module puppeteer-core'); },
    settleMs: 0,
  });
  await assert.rejects(
    () => r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10 }),
    (err) => err.renderErrorKind === 'engine_unavailable'
  );
});

test('render: launch 失败 → RenderEngineUnavailable 且清缓存可重试', async () => {
  const { puppeteer, calls } = fakePuppeteerModule({ launchThrows: true });
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  await assert.rejects(
    () => r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10 }),
    (err) => err.renderErrorKind === 'engine_unavailable'
  );
  assert.equal(calls.launch, 1);
});

test('render: 导航超时 → RenderTimeout(timeout)', async () => {
  const { puppeteer } = fakePuppeteerModule({ gotoThrows: 'Navigation timeout exceeded' });
  const r = createPuppeteerRenderer(baseRendererOpts(puppeteer));
  await assert.rejects(
    () => r.render({ url: 'http://127.0.0.1:7684/', width: 10, height: 10, waitSelector: 'body' }),
    (err) => err.renderErrorKind === 'timeout'
  );
});

test('error 类: 带正确的鸭子属性', () => {
  const a = new RenderEngineUnavailable('x');
  assert.equal(a.renderErrorKind, 'engine_unavailable');
  const b = new RenderTimeout('y');
  assert.equal(b.renderErrorKind, 'timeout');
});

test('createPuppeteerRenderer: 暴露探测到的 executablePath', () => {
  const r = createPuppeteerRenderer({ executablePath: '/x/chrome', requireImpl: () => ({}), env: {}, fsImpl: { existsSync: () => false } });
  assert.equal(r.executablePath, '/x/chrome');
});
