/**
 * Board render pure functions(看板卡片网格,浏览器 + 测试双跑)。
 * 从 console_render.cjs 抽出;看板 click-to-navigate + .card__select 多选 checkbox 语义(JS toggle ☐/☑)。
 * 对齐范本:dashboard_render.cjs / console_render.cjs(UMD)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./terminal_cleaner.cjs'));
  } else {
    root.BoardRender = factory(root.TerminalCleaner || { cleanSummary: function (s) { return s; } });
  }
})(typeof window !== 'undefined' ? window : globalThis, function (TC) {
  'use strict';

  const STATUS_META = {
    working: { dot: 's-dot--working', icon: '▶', label: 'working', cn: '运行中' },
    idle:    { dot: 's-dot--idle',    icon: '⏸', label: 'idle',    cn: '空闲' },
    errored: { dot: 's-dot--errored', icon: '✕', label: 'errored', cn: '出错' },
    waiting: { dot: 's-dot--waiting', icon: '⏳', label: 'waiting', cn: '等待中' },
    offline: { dot: 's-dot--offline', icon: '⌽', label: 'offline', cn: '离线' },
  };
  const DEFAULT_META = { dot: 's-dot--unknown', icon: '?', label: 'unknown', cn: '未知' };

  function statusMeta(status) { return STATUS_META[status] || DEFAULT_META; }

  // CLI 工具徽标元数据(hub 多 CLI 聚合分类用)。cls = 枚举值(同时作 CSS 后缀 + data-cli-tool);
  // label = 完整名(filter chip / title 用);short = 卡片徽标短码(紧凑)。
  // 与 hub/config.cjs 的 CLI_TOOLS 同源(浏览器侧独立持有,不 require 后端)。
  var CLI_TOOL_META = {
    'claude-code': { cls: 'claude-code', label: 'Claude Code', short: 'CC' },
    'grok-build':  { cls: 'grok-build',  label: 'Grok Build',  short: 'Grok' },
    'codex':       { cls: 'codex',       label: 'Codex',       short: 'Codex' },
    'cursor':      { cls: 'cursor',      label: 'Cursor',      short: 'Cursor' },
    'unknown':     { cls: 'unknown',     label: 'Unknown',     short: '?' },
  };
  var CLI_TOOL_ORDER = ['claude-code', 'grok-build', 'codex', 'cursor', 'unknown'];
  function cliToolMeta(tool) {
    var meta = CLI_TOOL_META[tool];
    return meta || CLI_TOOL_META['unknown'];
  }

  // —— 结构化会话状态机(PRD:hub 暴露 Claude Code 会话结构化状态机)——
  // 规范 4 态(与后端 session_status.cjs 同源,浏览器侧独立持有,不 require 后端):
  //   idle / running / awaiting-input / error。
  // 把单机上报的推断 status(working/waiting/...)或已暴露的规范 state 归一为 4 枚举之一。
  // stateMeta:dot 复用既有 s-dot--<raw> 色令牌(running→working 色、awaiting-input→waiting 色…),
  // 避免新增 CSS;label/cn 供过滤 chip 与 sr-only 用。
  var SESSION_STATES = ['idle', 'running', 'awaiting-input', 'error'];
  var STATUS_TO_STATE = {
    working: 'running', waiting: 'awaiting-input', errored: 'error', idle: 'idle', unknown: 'idle',
  };
  var STATE_META = {
    'running':        { dot: 's-dot--working', label: 'running',        cn: '运行中' },
    'awaiting-input': { dot: 's-dot--waiting', label: 'awaiting-input', cn: '等待输入' },
    'error':          { dot: 's-dot--errored', label: 'error',          cn: '出错' },
    'idle':           { dot: 's-dot--idle',    label: 'idle',           cn: '空闲' },
  };
  function normalizeState(v) {
    if (v && STATUS_TO_STATE[v]) return STATUS_TO_STATE[v];
    if (SESSION_STATES.indexOf(v) >= 0) return v;
    return 'idle'; // AC1:未知/缺失 → idle(绝不 null/undefined)
  }
  function stateMeta(state) {
    var s = normalizeState(state);
    return STATE_META[s] || STATE_META['idle'];
  }

  // 收集 machines 中出现的规范状态(去重,按 SESSION_STATES 序;仅实际出现的)。
  // 离线机会话在 flattenFleet 已被标 'offline',此处不计入 4 态(离线机不可调度,过滤无意义)。
  function collectStates(machines) {
    var present = new Set();
    for (var i = 0; i < (machines || []).length; i++) {
      var m = machines[i];
      if (!m || m.online === false) continue;
      var sessions = (m && m.sessions) || [];
      for (var j = 0; j < sessions.length; j++) {
        var s = sessions[j] || {};
        // 优先取上游 state;缺失由 status 归一(防御老节点)
        present.add(normalizeState(s.state != null ? s.state : s.status));
      }
    }
    return SESSION_STATES.filter(function (k) { return present.has(k); });
  }

  // 「按状态过滤」控件 HTML:≥2 种状态才渲染(单状态无可区分性,省 UI)。
  // active:null/'' = 全部;否则为某规范状态。每 chip 复用 cli-filter__chip 样式(通用 chip),
  // 内嵌 s-dot(色令牌驱动)+ 中文 label;data-status-filter="" (全部) 或 = 规范状态。
  function renderStatusFilter(machines, active) {
    var states = collectStates(machines);
    if (states.length <= 1) return '';
    var allOn = active == null || active === '';
    var parts = [];
    parts.push('<button type="button" class="cli-filter__chip' + (allOn ? ' cli-filter__chip--active' : '') + '" data-status-filter="" aria-pressed="' + allOn + '"><span class="cli-filter__name">全部</span></button>');
    for (var i = 0; i < states.length; i++) {
      var st = states[i];
      var meta = STATE_META[st];
      var on = active === st;
      parts.push('<button type="button" class="cli-filter__chip' + (on ? ' cli-filter__chip--active' : '') + '" data-status-filter="' + escapeHtml(st) + '" aria-pressed="' + on + '"><span class="s-dot ' + meta.dot + '" aria-hidden="true"></span><span class="cli-filter__name">' + escapeHtml(meta.cn) + '</span></button>');
    }
    return parts.join('');
  }

  // 工具徽标 HTML:<span class="cli-badge cli-badge--<cls>" data-cli-tool="<cls>" title="<label>">short</span>
  // 文本 + 背景色(背景色由 dashboard.css 的 .cli-badge--<cls> → var(--cli-<cls>) 令牌驱动,非魔法色值)。
  function buildCliBadge(tool) {
    var meta = cliToolMeta(tool);
    return '<span class="cli-badge cli-badge--' + meta.cls + '" data-cli-tool="' + escapeHtml(meta.cls) + '" title="' + escapeHtml(meta.label) + '">' + escapeHtml(meta.short) + '</span>';
  }

  // 收集 machines 中出现的工具(规范枚举,unknown 兜底),按 CLI_TOOL_ORDER 排序(unknown 居末)。
  // 供 renderCliFilter 决定渲染哪些 chip。仅返回实际出现的工具(空集→[])。
  function collectCliTools(machines) {
    var present = new Set();
    for (var i = 0; i < (machines || []).length; i++) {
      var m = machines[i];
      if (!m) continue;
      var mTool = cliToolMeta(m.cli_tool).cls;
      var sessions = (m && m.sessions) || [];
      if (!sessions.length) {
        // 无会话的机器仍按其自身 cli_tool 计入(机维度也参与过滤)
        present.add(mTool);
        continue;
      }
      for (var j = 0; j < sessions.length; j++) {
        var s = sessions[j] || {};
        present.add(cliToolMeta(s.cli_tool || m.cli_tool).cls);
      }
    }
    return CLI_TOOL_ORDER.filter(function (k) { return present.has(k); });
  }

  // 「按工具过滤」控件 HTML:≥2 种工具才渲染(单工具无可区分性,省 UI)。
  // active: null/'' = 全部;否则为某枚举值。每 chip data-cli-filter="" (全部) 或 = 枚举。
  // 工具 chip 内嵌 buildCliBadge(色由令牌驱动)+ 完整 label;全部 chip 用 accent 高亮态。
  function renderCliFilter(machines, active) {
    var tools = collectCliTools(machines);
    if (tools.length <= 1) return '';
    var allOn = active == null || active === '';
    var parts = [];
    parts.push('<button type="button" class="cli-filter__chip' + (allOn ? ' cli-filter__chip--active' : '') + '" data-cli-filter="" aria-pressed="' + allOn + '"><span class="cli-filter__name">全部</span></button>');
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      var meta = CLI_TOOL_META[t];
      var on = active === t;
      parts.push('<button type="button" class="cli-filter__chip' + (on ? ' cli-filter__chip--active' : '') + '" data-cli-filter="' + escapeHtml(t) + '" aria-pressed="' + on + '">' + buildCliBadge(t) + '<span class="cli-filter__name">' + escapeHtml(meta.label) + '</span></button>');
    }
    return parts.join('');
  }

  // 注:仅转义 & < > "(双引号属性安全)。单引号未转义 —— buildCardHTML 所有属性均用双引号,
  // 故安全;若未来引入单引号属性,需补 .replace(/'/g, '&#39;')。
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 卡片 target 窗口名(浏览器 browsing-context 名):同 machine+session → 同名 → 点同卡复用已开标签页,
  // 不同卡各自独立标签页(不再每次新开)。cc- 前缀避 _blank/_self/_parent/_top 等保留名;sanitize 只留
  // [A-Za-z0-9._-](空格/引号/尖括号等 → -),HTML target 属性 + 窗口名双重安全(防属性 breakout)。
  function windowNameFor(midRaw, sessRaw) {
    const sanitize = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
    return 'cc-' + sanitize(midRaw) + '-' + sanitize(sessRaw);
  }

  // 注:relativeTime 与 console_render.cjs 的同名函数重复(UMD 模块独立性 —— board_render 不依赖
  // console_render,各自独立加载)。改一处需同步另一处,避免行为漂移。
  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h 前`;        // <24h
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d 前`;      // <7d
    if (diff < 2592000000) return `${Math.floor(diff / 604800000)}w 前`;    // <30d
    return `${Math.floor(diff / 2592000000)}个月前`;                        // ≥30d
  }

  // 看板卡片内层:click-to-navigate 的 <a>(跳 hub /jump?m=&s=,新标签打开目标单机控制台)。
  // opts.mode:'hub'(摘要为中心 IA,对齐 demo /tmp/dashboard-redesign-demo.html — card__head 包裹层,
  //   会话名主锚,无 s-icon,摘要 div 2 行 line-clamp,sr-only 状态冗余,离线补 card__off + aria-disabled
  //   + "Nh 前在线" + 占位摘要)
  //   |'single'(默认,旧行为 — 机器名主锚 + 会话名副行 + s-icon,向后兼容)。board_render 仅 hub 调用,
  //   single 防御性保留。data-status 留 a(供 CSS 按状态上色)。
  // aria-label 用 机器名/会话名/statusLabel/「在新标签打开控制台」,不含 lastLine(避免 2s 轮询刷新干扰读屏)。
  function buildCardInner(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const mode = o.mode === 'hub' ? 'hub' : 'single';
    const meta = statusMeta(s.status);
    const classes = ['card'];
    if (mode === 'hub') classes.push('card--hub');
    if (o.active) classes.push('active');
    // href:query 值先 encodeURIComponent(< → %3C,& → %26 防参数边界混淆),
    // 再整体 escapeHtml 放入属性(& 分隔符 → &amp;,防 " breakout)。
    // 浏览器解析:HTML 解码(&amp;→&)→ URL 解码(%3C→<),最终 m/s 参数值还原。
    const midRaw = m.id == null ? '' : m.id;
    const sessRaw = s.name == null ? '' : s.name;
    const href = `/jump?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
    // target 用 session 唯一窗口名(非 _blank):点同卡复用已开标签页,不同卡各自独立标签页。
    const targetName = windowNameFor(midRaw, sessRaw);
    // aria-label 不含 lastLine(2s 轮询刷新会打断读屏);显式告知「在新标签打开控制台」。
    const label = `${m.name || m.id} / ${s.name}, ${meta.label}, 在新标签打开控制台`;
    const st = escapeHtml(String(s.status || 'unknown'));

    if (mode === 'hub') {
      const name = escapeHtml(s.name || m.name || m.id);
      const offline = m.online === false;
      let lastText;
      if (offline) {
        const prev = s.lastLine
          ? '上次摘要:' + (TC.cleanSummary ? TC.cleanSummary(s.lastLine, 60) : s.lastLine)
          : '';
        lastText = '主机离线,暂无实时状态。' + prev;
      } else {
        const raw = s.lastLine || '';
        lastText = TC.cleanSummary ? TC.cleanSummary(raw, 60) : raw;
      }
      const last = escapeHtml(lastText);
      // 离线时间:有 lastTs → relativeTime + "在线"(如 "2h 前在线");无 lastTs → "长期离线"
      const timeRaw = offline
        ? (o.lastTs ? relativeTime(o.lastTs, o.now) + '在线' : '长期离线')
        : relativeTime(o.lastTs, o.now);
      const time = escapeHtml(timeRaw);
      const offTag = offline ? '<span class="card__off">离线</span>' : '';
      const ariaDis = offline ? ' aria-disabled="true"' : '';
      return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" target="${escapeHtml(targetName)}" rel="noopener noreferrer" data-status="${st}" aria-label="${escapeHtml(label)}"${ariaDis}>` +
        `<div class="card__head">` +
        `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
        `<span class="card__name">${name}</span>` +
        `${buildCliBadge(s.cli_tool || m.cli_tool)}` +
        `<span class="sr-only">${meta.cn}</span>` +
        `${offTag}` +
        `<span class="card__time">${time}</span>` +
        `</div>` +
        `<div class="card__last">${last || '—'}</div>` +
        `</a>`;
    }

    // single(默认,旧行为):机器名主标题 + 会话名副行 + s-icon + 单行 span.card__last。
    // :7685 多机 hub:永远机器名主标题 + 会话名副行(singleMachine 分支已废弃 —— 它是
    // 07-04 spec 错把 :7685 当单机的产物,见 docs/superpowers/specs/2026-07-04-7685-hub-gap-audit.md §1)。
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(TC.cleanSummary ? TC.cleanSummary(lastRaw, 60) : lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" target="${escapeHtml(targetName)}" rel="noopener noreferrer" data-status="${st}" aria-label="${escapeHtml(label)}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last || '—'}</span>` +
      `<span class="card__time">${time}</span>` +
      `</a>`;
  }

  // 看板卡片行(Plan A):<li class="card-row"> 同级 <button class="card__select"> + <a class="card">。
  // button 在 a 之前(DOM 顺序),用原生 button + aria-pressed 替代旧版嵌套 checkbox(ARIA 合规:
  // interactive role=checkbox 不能嵌在 <a> 里)。data-machine/session/key/status + role=group + aria-label
  // 全部上移到 <li>,供 dashboard.js 事件委托读取(Task 8);button 的 aria-pressed 初始 false,JS toggle。
  function buildCardRow(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const midRaw = String(m.id != null ? m.id : '');
    const sessRaw = String(s.name != null ? s.name : '');
    const key = `${midRaw}/${sessRaw}`;
    const st = escapeHtml(String(s.status || 'unknown'));
    const stateCls = escapeHtml(normalizeState(s.state != null ? s.state : s.status)); // 规范状态(供过滤)
    const cliCls = escapeHtml(cliToolMeta(s.cli_tool || m.cli_tool).cls);
    const grpLabel = escapeHtml(`${m.name || m.id} / ${s.name}`);
    const togLabel = escapeHtml(`选择 ${m.name || m.id} / ${s.name}`);
    return `<li class="card-row" data-machine="${escapeHtml(midRaw)}" data-session="${escapeHtml(sessRaw)}" data-status="${st}" data-state="${stateCls}" data-key="${escapeHtml(key)}" data-cli-tool="${cliCls}" role="group" aria-label="${grpLabel}">` +
      `<button class="card__select" type="button" data-toggle="select" aria-pressed="false" aria-label="${togLabel}">☐</button>` +
      buildCardInner(machine, session, opts) +
      `</li>`;
  }

  // 看板卡片:thin wrapper → buildCardRow(保留旧调用方兼容,dashboard.js Task 8 改调 buildCardRow)。
  function buildCardHTML(machine, session, opts) {
    return buildCardRow(machine, session, opts);
  }

  // hub fleet → 卡片数组:把 status 提升到顶层(供 sortCardsByRelevance 读取),
  // 离线机 → 'offline'。null/undefined → []。纯函数。
  function flattenFleet(machines) {
    const out = [];
    for (const m of machines || []) {
      const online = m && m.online !== false;
      for (const s of (m && m.sessions) || []) {
        const status = online ? (s.status || 'unknown') : 'offline';
        // 规范状态:在线会话由上游 state(优先)/status 归一;离线机 → 不参与状态过滤(留空)
        const state = online ? normalizeState(s.state != null ? s.state : s.status) : '';
        out.push({
          machine: m,
          session: { name: s.name, status, state, lastLine: s.lastLine || '', cwd: s.cwd || '' },
          status,
          state,
          key: `${m.id}/${s.name}`,
          name: m.name || m.id,
          lastTs: s.lastTs || 0,
        });
      }
    }
    return out;
  }

  const STALE_MS = 24 * 60 * 60 * 1000; // 24h
  function isStale(card, now) {
    if (!card) return false;
    // waiting/unknown 且 >24h 视为陈旧(§1 痛点:633h unknown 与 waiting 同为死会话,一并折叠)
    if (card.status !== 'waiting' && card.status !== 'unknown') return false;
    if (!card.lastTs) return false;
    const n = now || Date.now();
    return (n - card.lastTs) > STALE_MS;
  }
  function partitionStale(cards, now) {
    const active = [], stale = [];
    for (const c of (cards || [])) {
      if (isStale(c, now)) stale.push(c); else active.push(c);
    }
    return { active: active, stale: stale };
  }

  const STATUS_RANK = { errored: 0, working: 1, waiting: 2, idle: 3, unknown: 4, offline: 5 };
  function rankOf(card, now) {
    if (!card) return 4;
    const base = STATUS_RANK[card.status];
    if (base == null) return 4;
    if (isStale(card, now)) return 4.5; // 陈旧 waiting 降到 unknown 之后
    return base;
  }
  function sortCardsByRelevance(cards, now) {
    return [...(cards || [])].sort((a, b) => {
      const ra = rankOf(a, now), rb = rankOf(b, now);
      if (ra !== rb) return ra - rb;
      const ta = (a && a.lastTs) || 0, tb = (b && b.lastTs) || 0;
      return tb - ta; // 同级:新→旧(lastTs 降序)
    });
  }

  function summarizeFleet(machines) {
    const c = { working: 0, idle: 0, errored: 0, waiting: 0, unknown: 0, offline: 0, online: 0, total: 0 };
    for (const m of machines || []) {
      c.total++;
      if (m && m.online !== false) c.online++;
      for (const s of (m && m.sessions) || []) {
        const st = (s && s.status) || 'unknown';
        if (c[st] != null) c[st]++;
      }
    }
    return c;
  }

  // 按机分节:cards(已 sortCardsByRelevance 排序)→ 按 machine.id 分组;离线机组排末尾。
  // 组内顺序保留(排序已定);返回 [{machine, cards:[]}]。纯函数。
  function groupByMachine(cards) {
    const order = [];
    const map = new Map();
    for (const c of (cards || [])) {
      const mid = c && c.machine && c.machine.id;
      if (mid == null) continue;
      if (!map.has(mid)) { map.set(mid, { machine: c.machine, cards: [] }); order.push(mid); }
      map.get(mid).cards.push(c);
    }
    const online = [], offline = [];
    for (const mid of order) {
      const g = map.get(mid);
      (g.machine && g.machine.online === false ? offline : online).push(g);
    }
    return online.concat(offline);
  }

  // 单机维度状态计数:cards(每项 .status)→ 五通道 + total。点和 = total(供顶栏自洽校验)。
  function summarizeMachine(cards) {
    const c = { working: 0, waiting: 0, errored: 0, idle: 0, offline: 0, unknown: 0, total: 0 };
    for (const card of cards || []) {
      c.total++;
      const st = (card && card.status) || 'unknown';
      if (c[st] != null) c[st]++;
    }
    return c;
  }

  // 色谱圆点 + 数字计数 HTML(组标题 + 顶栏共用,对齐 demo title 中文语义)。
  // 无 emoji、无 ×。顺序 working/waiting/errored/idle/offline。非零才渲染;全 0 → ''。
  const COUNT_ORDER = [
    { key: 'working', cn: '工作中' },
    { key: 'waiting', cn: '等待用户' },
    { key: 'errored', cn: '出错' },
    { key: 'idle', cn: '空闲' },
    { key: 'offline', cn: '离线' },
  ];
  function renderStatusCounts(counts) {
    const c = counts || {};
    const parts = [];
    for (const item of COUNT_ORDER) {
      const n = c[item.key] || 0;
      if (n > 0) {
        parts.push('<span class="status-count" title="' + item.cn + '">' +
          '<span class="s-dot s-dot--' + item.key + '" aria-hidden="true"></span>' + n + '</span>');
      }
    }
    return parts.join('');
  }

  return { statusMeta, escapeHtml, relativeTime, windowNameFor, buildCardHTML, buildCardRow, buildCardInner, flattenFleet, sortCardsByRelevance, summarizeFleet, summarizeMachine, renderStatusCounts, isStale, partitionStale, groupByMachine, cliToolMeta, buildCliBadge, collectCliTools, renderCliFilter, CLI_TOOL_META, CLI_TOOL_ORDER, normalizeState, stateMeta, collectStates, renderStatusFilter, SESSION_STATES };
});
