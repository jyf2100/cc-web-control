'use strict';

/**
 * 截图端点纯逻辑层（render→look→fix 闭环的"产图"半边）。
 *
 * 设计要点（与全仓「纯函数 + 依赖注入」测试风格一致）：
 *  - 本模块不引入任何有副作用的依赖（无 puppeteer / 无 fs / 无网络）。
 *  - 真正的渲染由调用方经 `render` 注入：HTTP 路由层注入 puppeteer 渲染器，
 *    单测注入返回固定 PNG 字节的桩。这样测试可在无浏览器/无显示器环境跑绿。
 *  - 渲染器抛错时携带 `renderErrorKind` 鸭子类型属性，本模块据此映射 HTTP 状态码，
 *    不反向 import 渲染器（保持单向依赖、零副作用）。
 *
 * 行为契约见 PRD 验收标准 1–8：
 *  - PNG 直出 / JSON 元数据两种响应模式（AC1、AC4）
 *  - panel 选择（dialog / hub）+ 别名（AC3）
 *  - 视口宽高可配置 + 边界校验（AC5）
 *  - 失败显式上报（AC7）：非法参数 / 未知 panel / 渲染失败一律非 2xx + {error,detail}
 */

// 默认视口（AC5：未指定时使用默认值，需在 JSON 响应/文档可查 → 既出现在响应 width/height，也写在 README）。
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
// 视口边界：防极端值拖垮渲染或爆内存。下限保留可读尺寸，上限 4K 封顶。
const MIN_VIEWPORT = { width: 240, height: 160 };
const MAX_VIEWPORT = { width: 3840, height: 2160 };

const DEFAULT_FORMAT = 'png';
const VALID_FORMATS = new Set(['png', 'json']);

// panel 别名：调用方可能传 dashboard/board（→ hub）或 chat/console（→ dialog）。
// 真正支持的 panel 集合由各 server 注入的 `panels` 决定（单机 vs hub 不同）。
const PANEL_ALIAS = {
  dashboard: 'hub',
  board: 'hub',
  console: 'dialog',
  chat: 'dialog',
};

// 内置 panel 模板：path = 相对 baseUrl 的页面；waitSelector = 标识"内容已渲染"的 CSS 选择器（逗号=或）。
// 单机 server 注入 { dialog, hub }；hub server 只注入 { hub }（hub 无对话框面板）。
const BUILTIN_PANELS = {
  dialog: { id: 'dialog', path: '/', waitSelector: 'body' },
  hub: { id: 'hub', path: '/dashboard.html', waitSelector: '#board-body, #sessionList, body' },
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isErrorResult(r) {
  return r && r.ok === false;
}

function firstValue(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseDim(raw, def, name, errors) {
  const v = firstValue(raw);
  if (v === undefined || v === null || v === '') return def;
  // 仅接受纯整数字符串/数字（PRD AC5: ?width=<int>）。拒绝 "1280.5"/"1280px"/"abc"。
  const s = String(v).trim();
  if (!/^[1-9][0-9]*$/.test(s)) {
    errors.push({ field: name, msg: `${name} must be a positive integer, got ${JSON.stringify(v)}` });
    return def;
  }
  const n = parseInt(s, 10);
  if (n < MIN_VIEWPORT[name]) {
    errors.push({ field: name, msg: `${name}=${n} below minimum ${MIN_VIEWPORT[name]}` });
    return def;
  }
  if (n > MAX_VIEWPORT[name]) {
    errors.push({ field: name, msg: `${name}=${n} above maximum ${MAX_VIEWPORT[name]}` });
    return def;
  }
  return n;
}

/**
 * 解析 + 校验截图请求参数。
 * @param {object} query - express req.query（或合并后的键值表）
 * @param {object} opts
 * @param {object} [opts.panels] - 该 server 支持的 panel 注册表
 * @param {object} [opts.defaultViewport]
 * @param {string} [opts.accept] - Accept 头（用于 format 协商）
 * @returns {{ok:true,panel,width,height,format} | {ok:false,status,error,detail}}
 */
function parseScreenshotParams(query = {}, opts = {}) {
  const panels = opts.panels || BUILTIN_PANELS;
  const def = opts.defaultViewport || DEFAULT_VIEWPORT;
  const errors = [];

  // —— panel ——
  const panelKeys = Object.keys(panels);
  const panelRaw = String(firstValue(query.panel) || '').trim();
  let panel = null;
  if (!panelRaw) {
    // 未指定 → 取注册表第一个（约定 server 按优先级排序）。
    panel = panels[panelKeys[0]];
    if (!panel) {
      errors.push({ field: 'panel', msg: 'no panel configured on this server' });
    }
  } else {
    const id = PANEL_ALIAS[panelRaw] || panelRaw;
    panel = panels[id];
    if (!panel) {
      errors.push({
        field: 'panel',
        msg: `unknown panel ${JSON.stringify(panelRaw)}; supported: ${panelKeys.join(', ')}`,
      });
    }
  }

  // —— 视口 ——
  const width = parseDim(query.width, def.width, 'width', errors);
  const height = parseDim(query.height, def.height, 'height', errors);

  // —— format —— 显式 query 优先；其次 Accept 头；再否则默认 png。
  let format = DEFAULT_FORMAT;
  const fmtRaw = String(firstValue(query.format) || '').trim().toLowerCase();
  if (fmtRaw) {
    if (VALID_FORMATS.has(fmtRaw)) {
      format = fmtRaw;
    } else {
      errors.push({ field: 'format', msg: `unknown format ${JSON.stringify(query.format)}; supported: png, json` });
    }
  } else if (opts.accept && /application\/json/i.test(opts.accept) && !/image\/png/i.test(opts.accept)) {
    format = 'json';
  }

  if (errors.length) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_request',
      detail: errors.map((e) => `${e.field}: ${e.msg}`).join('; '),
    };
  }

  return { ok: true, panel, width, height, format };
}

/**
 * 把渲染器抛出的错误映射成 HTTP 响应（AC7）。
 * 渲染器用 err.renderErrorKind 做鸭子类型标注，避免本模块反向依赖渲染器实现。
 */
function classifyRenderError(err) {
  const kind = err && err.renderErrorKind;
  const detail = (err && err.message) || String(err);
  if (kind === 'engine_unavailable') {
    return { status: 503, error: 'render_engine_unavailable', detail };
  }
  if (kind === 'timeout') {
    return { status: 504, error: 'render_timeout', detail };
  }
  return { status: 500, error: 'render_failed', detail };
}

function toPngBuffer(result) {
  if (Buffer.isBuffer(result)) return result;
  if (result && Buffer.isBuffer(result.png)) return result.png;
  if (result && typeof result.png === 'string') return Buffer.from(result.png, 'base64');
  throw Object.assign(new Error('render returned no png buffer'), { renderErrorKind: 'engine_unavailable' });
}

/**
 * 创建 express 风格的截图路由 handler。
 *
 * @param {object} options
 * @param {object} [options.panals] - 同 parseScreenshotParams
 * @param {object} [options.defaultViewport]
 * @param {string} [options.baseUrl] - 渲染目标 origin+前缀，如 http://127.0.0.1:7684
 * @param {string} [options.token] - 鉴权 token，渲染时注入 cookie（auth 开启时页面才可达）
 * @param {string} [options.cookieName=cc_web_auth]
 * @param {function} options.render - async ({ panel, url, width, height, waitSelector, token, cookieName }) => Buffer | {png,width,height}
 * @param {function} [options.nowFn=Date.now]
 * @param {boolean} [options.validatePng=true] - 校验返回字节确为 PNG（防伪 200 / 空 body，AC7/AC1）
 */
function createScreenshotHandler(options = {}) {
  const panels = options.panels || BUILTIN_PANELS;
  const defaultViewport = options.defaultViewport || DEFAULT_VIEWPORT;
  const baseUrl = options.baseUrl || '';
  const token = options.token || '';
  const cookieName = options.cookieName || 'cc_web_auth';
  const render = options.render;
  const nowFn = options.nowFn || Date.now;
  const validatePng = options.validatePng !== false;

  if (typeof render !== 'function') {
    throw new TypeError('createScreenshotHandler: options.render (async function) is required');
  }

  return async function screenshotHandler(req, res) {
    const query = (req && req.query) || {};
    const accept = req && req.headers && req.headers.accept;
    const parsed = parseScreenshotParams(query, { panels, defaultViewport, accept });
    if (!parsed.ok) {
      res.status(parsed.status).type('application/json').json({ error: parsed.error, detail: parsed.detail });
      return;
    }
    const { panel, width, height, format } = parsed;
    const url = baseUrl + panel.path;

    let png;
    let outW = width;
    let outH = height;
    try {
      const result = await render({
        panel: panel.id,
        url,
        width,
        height,
        waitSelector: panel.waitSelector,
        token,
        cookieName,
      });
      png = toPngBuffer(result);
      // 渲染器返回的实际像素尺寸(== 请求值,由 clip 锁死);优先上报实际值(AC4/AC5)。
      if (result && !Buffer.isBuffer(result)) {
        if (typeof result.width === 'number') outW = result.width;
        if (typeof result.height === 'number') outH = result.height;
      }
    } catch (err) {
      const { status, error, detail } = classifyRenderError(err);
      res.status(status).type('application/json').json({ error, detail });
      return;
    }

    // 防"伪 200 / 空 PNG"（AC1 要可被 PNG 解码器识别；AC7 不许静默吞）。
    if (!png || png.length < PNG_MAGIC.length || png.subarray(0, PNG_MAGIC.length).compare(PNG_MAGIC) !== 0) {
      if (validatePng) {
        res.status(502).type('application/json').json({
          error: 'invalid_png',
          detail: `render output is not a valid PNG (${png ? png.length : 0} bytes)`,
        });
        return;
      }
    }

    if (format === 'json') {
      res
        .status(200)
        .type('application/json')
        .json({
          panel: panel.id,
          width: outW,
          height: outH,
          captured_at: new Date(nowFn()).toISOString(),
          png: png.toString('base64'),
        });
      return;
    }

    res.status(200).type('image/png').send(png);
  };
}

module.exports = {
  DEFAULT_VIEWPORT,
  MIN_VIEWPORT,
  MAX_VIEWPORT,
  BUILTIN_PANELS,
  PANEL_ALIAS,
  PNG_MAGIC,
  parseScreenshotParams,
  classifyRenderError,
  createScreenshotHandler,
};
