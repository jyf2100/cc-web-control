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
    working: { dot: 's-dot--working', icon: '▶', label: 'working' },
    idle:    { dot: 's-dot--idle',    icon: '⏸', label: 'idle' },
    errored: { dot: 's-dot--errored', icon: '✕', label: 'errored' },
    waiting: { dot: 's-dot--waiting', icon: '⏳', label: 'waiting' },
    offline: { dot: 's-dot--offline', icon: '⌽', label: 'offline' },
  };
  const DEFAULT_META = { dot: 's-dot--unknown', icon: '?', label: 'unknown' };

  function statusMeta(status) { return STATUS_META[status] || DEFAULT_META; }

  // 注:仅转义 & < > "(双引号属性安全)。单引号未转义 —— buildCardHTML 所有属性均用双引号,
  // 故安全;若未来引入单引号属性,需补 .replace(/'/g, '&#39;')。
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  // Plan A(2026-07-07 spec §6.2):a 只含展示 spans(s-dot/s-icon/card__name/card__session/card__last/card__time),
  // 不再嵌 .card__select(改由 buildCardRow 在 a 之前放同级 <button>),不再带 data-machine/session/key
  // (上移到 <li>,供 dashboard.js 事件委托读取);data-status 留在 a(供 CSS 按状态上色)。
  // aria-label 用 机器名/会话名/statusLabel/「在新标签打开控制台」,不含 lastLine(避免 2s 轮询刷新干扰读屏)。
  function buildCardInner(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const classes = ['card'];
    if (o.active) classes.push('active');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    // :7685 多机 hub:永远机器名主标题 + 会话名副行(singleMachine 分支已废弃 —— 它是
    // 07-04 spec 错把 :7685 当单机的产物,见 docs/superpowers/specs/2026-07-04-7685-hub-gap-audit.md §1)。
    const primaryName = name;
    const secondary = sess;
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(TC.cleanSummary ? TC.cleanSummary(lastRaw, 60) : lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    // href:query 值先 encodeURIComponent(< → %3C,& → %26 防参数边界混淆),
    // 再整体 escapeHtml 放入属性(& 分隔符 → &amp;,防 " breakout)。
    // 浏览器解析:HTML 解码(&amp;→&)→ URL 解码(%3C→<),最终 m/s 参数值还原。
    const midRaw = m.id == null ? '' : m.id;
    const sessRaw = s.name == null ? '' : s.name;
    const href = `/jump?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
    // aria-label 不含 lastLine(2s 轮询刷新会打断读屏);显式告知「在新标签打开控制台」。
    const label = `${m.name || m.id} / ${s.name}, ${meta.label}, 在新标签打开控制台`;
    const st = escapeHtml(String(s.status || 'unknown'));
    return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-status="${st}" aria-label="${escapeHtml(label)}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${primaryName}</span>` +
      `<span class="card__session">${secondary}</span>` +
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
    const grpLabel = escapeHtml(`${m.name || m.id} / ${s.name}`);
    const togLabel = escapeHtml(`选择 ${m.name || m.id} / ${s.name}`);
    return `<li class="card-row" data-machine="${escapeHtml(midRaw)}" data-session="${escapeHtml(sessRaw)}" data-status="${st}" data-key="${escapeHtml(key)}" role="group" aria-label="${grpLabel}">` +
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
        out.push({
          machine: m,
          session: { name: s.name, status, lastLine: s.lastLine || '', cwd: s.cwd || '' },
          status,
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


  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, buildCardRow, buildCardInner, flattenFleet, sortCardsByRelevance, summarizeFleet, isStale, partitionStale, groupByMachine };
});
