'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseScreenshotParams,
  classifyRenderError,
  createScreenshotHandler,
  DEFAULT_VIEWPORT,
  BUILTIN_PANELS,
  PANEL_ALIAS,
  PNG_MAGIC,
} = require('../screenshot.cjs');

// —— 测试用 PNG：8 字节魔数前缀（生产渲染器产真 PNG；单测只验路由/格式逻辑）——
function fakePng(extra = Buffer.from('payload-body')) {
  return Buffer.concat([PNG_MAGIC, extra]);
}

// 极简 express res 桩：记录 status / content-type / body。
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    jsonBody: undefined,
    status(code) { this.statusCode = code; return this; },
    type(t) { this.headers['content-type'] = t; return this; },
    set(k, v) { this.headers[String(k).toLowerCase()] = String(v); return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); return this; },
    json(obj) { this.jsonBody = obj; this.body = obj; this.headers['content-type'] = 'application/json'; return this; },
    send(buf) { this.body = buf; return this; },
  };
}

function makeReq(query = {}, headers = {}) {
  return { query, headers };
}

async function call(handler, query = {}, headers = {}) {
  const req = makeReq(query, headers);
  const res = makeRes();
  await handler(req, res);
  return res;
}

// ============ parseScreenshotParams ============

test('parseScreenshotParams: 默认值(无参)取首个 panel + 默认视口 + png', () => {
  const r = parseScreenshotParams({}, { panels: BUILTIN_PANELS });
  assert.equal(r.ok, true);
  assert.equal(r.panel.id, 'dialog'); // BUILTIN_PANELS 首个
  assert.equal(r.width, DEFAULT_VIEWPORT.width);
  assert.equal(r.height, DEFAULT_VIEWPORT.height);
  assert.equal(r.format, 'png');
});

test('parseScreenshotParams: panel=hub 及别名 dashboard/board', () => {
  for (const v of ['hub', 'dashboard', 'board']) {
    const r = parseScreenshotParams({ panel: v }, { panels: BUILTIN_PANELS });
    assert.equal(r.ok, true, `${v} 应解析成功`);
    assert.equal(r.panel.id, 'hub', `${v} → hub`);
  }
});

test('parseScreenshotParams: panel=dialog 及别名 console/chat', () => {
  for (const v of ['dialog', 'console', 'chat']) {
    const r = parseScreenshotParams({ panel: v }, { panels: BUILTIN_PANELS });
    assert.equal(r.ok, true);
    assert.equal(r.panel.id, 'dialog');
  }
});

test('parseScreenshotParams: 未知 panel → 400', () => {
  const r = parseScreenshotParams({ panel: 'nope' }, { panels: BUILTIN_PANELS });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.error, 'invalid_request');
  assert.match(r.detail, /unknown panel/);
  assert.match(r.detail, /dialog, hub/);
});

test('parseScreenshotParams: 仅 server 注册的 panel 可用(hub server 无 dialog)', () => {
  const hubOnly = { hub: BUILTIN_PANELS.hub };
  const ok = parseScreenshotParams({ panel: 'hub' }, { panels: hubOnly });
  assert.equal(ok.ok, true);
  const bad = parseScreenshotParams({ panel: 'dialog' }, { panels: hubOnly });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.match(bad.detail, /supported: hub/);
});

test('parseScreenshotParams: 视口合法整数', () => {
  const r = parseScreenshotParams({ width: '1024', height: '768' }, { panels: BUILTIN_PANELS });
  assert.equal(r.ok, true);
  assert.equal(r.width, 1024);
  assert.equal(r.height, 768);
});

test('parseScreenshotParams: 视口非法 → 400', () => {
  for (const v of ['1280.5', '1280px', 'abc', '-100', '0']) {
    const r = parseScreenshotParams({ width: v }, { panels: BUILTIN_PANELS });
    assert.equal(r.ok, false, `${v} 应被拒`);
    assert.equal(r.status, 400);
    assert.match(r.detail, /width/);
  }
});

test('parseScreenshotParams: 视口越界 → 400(过小/过大)', () => {
  assert.equal(parseScreenshotParams({ width: '10' }, { panels: BUILTIN_PANELS }).ok, false);
  assert.equal(parseScreenshotParams({ height: '99999' }, { panels: BUILTIN_PANELS }).ok, false);
});

test('parseScreenshotParams: format 显式 query', () => {
  assert.equal(parseScreenshotParams({ format: 'json' }, { panels: BUILTIN_PANELS }).format, 'json');
  assert.equal(parseScreenshotParams({ format: 'PNG' }, { panels: BUILTIN_PANELS }).format, 'png');
  const bad = parseScreenshotParams({ format: 'gif' }, { panels: BUILTIN_PANELS });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /format/);
});

test('parseScreenshotParams: format 经 Accept 头协商', () => {
  const r = parseScreenshotParams({}, { panels: BUILTIN_PANELS, accept: 'application/json' });
  assert.equal(r.format, 'json');
  const r2 = parseScreenshotParams({}, { panels: BUILTIN_PANELS, accept: 'image/png, */*' });
  assert.equal(r2.format, 'png');
});

// ============ classifyRenderError ============

test('classifyRenderError: engine_unavailable → 503', () => {
  const e = Object.assign(new Error('no browser'), { renderErrorKind: 'engine_unavailable' });
  const r = classifyRenderError(e);
  assert.equal(r.status, 503);
  assert.equal(r.error, 'render_engine_unavailable');
});

test('classifyRenderError: timeout → 504', () => {
  const e = Object.assign(new Error('slow'), { renderErrorKind: 'timeout' });
  assert.equal(classifyRenderError(e).status, 504);
  assert.equal(classifyRenderError(e).error, 'render_timeout');
});

test('classifyRenderError: 其它 → 500', () => {
  const r = classifyRenderError(new Error('boom'));
  assert.equal(r.status, 500);
  assert.equal(r.error, 'render_failed');
  assert.equal(r.detail, 'boom');
});

// ============ createScreenshotHandler ============

function handlerWith(render, opts = {}) {
  return createScreenshotHandler({
    panels: BUILTIN_PANELS,
    baseUrl: 'http://127.0.0.1:7684',
    token: 'TOK',
    render,
    nowFn: () => Date.parse('2026-08-05T03:22:00.000Z'),
    ...opts,
  });
}

test('handler: PNG 直出(AC1)', async () => {
  const png = fakePng();
  let ctx;
  const h = handlerWith(async (c) => { ctx = c; return { png, width: c.width, height: c.height }; });
  const res = await call(h, { panel: 'hub', width: '1024', height: '768' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.body, png);
  // render 收到正确的 url/token/视口/waitSelector
  assert.equal(ctx.url, 'http://127.0.0.1:7684/dashboard.html');
  assert.equal(ctx.panel, 'hub');
  assert.equal(ctx.token, 'TOK');
  assert.equal(ctx.width, 1024);
  assert.equal(ctx.height, 768);
  assert.equal(ctx.waitSelector, BUILTIN_PANELS.hub.waitSelector);
});

test('handler: render 直接返回 Buffer 也接受', async () => {
  const png = fakePng();
  const h = handlerWith(async () => png);
  const res = await call(h, { panel: 'dialog' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, png);
});

test('handler: JSON 元数据模式(AC4)', async () => {
  const png = fakePng(Buffer.from('abc'));
  const h = handlerWith(async () => ({ png, width: 800, height: 600 }));
  const res = await call(h, { panel: 'hub', format: 'json' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  const b = res.jsonBody;
  assert.equal(b.panel, 'hub');
  assert.equal(b.width, 800);
  assert.equal(b.height, 600);
  assert.equal(b.captured_at, '2026-08-05T03:22:00.000Z');
  // base64 解码后逐字节等于 PNG buffer(AC4: 同一次渲染内一致)
  assert.deepEqual(Buffer.from(b.png, 'base64'), png);
});

test('handler: 非法参数 → 400 JSON {error,detail}(AC7)', async () => {
  const h = handlerWith(async () => fakePng());
  const res = await call(h, { panel: 'nope' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.jsonBody.error, 'invalid_request');
  assert.ok(res.jsonBody.detail);
});

test('handler: 视口非法 → 400(AC7)', async () => {
  const h = handlerWith(async () => fakePng());
  const res = await call(h, { width: 'abc' });
  assert.equal(res.statusCode, 400);
});

test('handler: render 引擎未就绪 → 503(AC7)', async () => {
  const h = handlerWith(async () => {
    throw Object.assign(new Error('no chromium'), { renderErrorKind: 'engine_unavailable' });
  });
  const res = await call(h, { panel: 'hub' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.jsonBody.error, 'render_engine_unavailable');
});

test('handler: render 超时 → 504(AC7)', async () => {
  const h = handlerWith(async () => {
    throw Object.assign(new Error('timed out'), { renderErrorKind: 'timeout' });
  });
  const res = await call(h, { panel: 'hub' });
  assert.equal(res.statusCode, 504);
  assert.equal(res.jsonBody.error, 'render_timeout');
});

test('handler: render 未知错误 → 500(AC7: 不静默吞)', async () => {
  const h = handlerWith(async () => { throw new Error('boom'); });
  const res = await call(h, { panel: 'hub' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.jsonBody.error, 'render_failed');
  assert.equal(res.jsonBody.detail, 'boom');
});

test('handler: render 返回非 PNG → 502 invalid_png(AC1/AC7: 不伪 200)', async () => {
  const h = handlerWith(async () => Buffer.from('not-a-png'));
  const res = await call(h, { panel: 'hub' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.jsonBody.error, 'invalid_png');
});

test('handler: 缺 render 抛 TypeError', () => {
  assert.throws(() => createScreenshotHandler({ panels: BUILTIN_PANELS }), /render/);
});

test('handler: 未指定 panel 用默认(首个)且视口默认(AC5)', async () => {
  const png = fakePng();
  const h = handlerWith(async (c) => ({ png, width: c.width, height: c.height }));
  const res = await call(h, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, png);
  // 默认视口体现在 PNG 视口上;JSON 模式可查默认值
  const h2 = handlerWith(async (c) => ({ png, width: c.width, height: c.height }));
  const res2 = await call(h2, { format: 'json' });
  assert.equal(res2.jsonBody.width, DEFAULT_VIEWPORT.width);
  assert.equal(res2.jsonBody.height, DEFAULT_VIEWPORT.height);
});

test('handler: 视口精确透传 → 截图像素与请求一致(AC5 ≤1px)', async () => {
  const png = fakePng();
  let got;
  const h = handlerWith(async (c) => { got = c; return { png, width: c.width, height: c.height }; });
  await call(h, { width: '1366', height: '900', format: 'json' });
  assert.equal(got.width, 1366);
  assert.equal(got.height, 900);
});
