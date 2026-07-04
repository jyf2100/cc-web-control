/**
 * Board render pure functions(看板卡片网格,浏览器 + 测试双跑)。
 * 从 console_render.cjs 抽出;看板纯监控 click-to-navigate(无多选 ☐/☑)。
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

  // 看板卡片内层:click-to-navigate 的 <a>(跳 /console.html?m=&s=),无 select 多选语义。
  // buildCardHTML 在外层包 <li class="card-row" data-key>;keyed-diff 场景(dashboard.js)只需内层。
  function buildCardInner(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const classes = ['card'];
    if (o.active) classes.push('active');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const mid = escapeHtml(m.id);
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(TC.cleanSummary ? TC.cleanSummary(lastRaw, 60) : lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    const label = escapeHtml(`${m.name || m.id} / ${s.name},${meta.label},${lastRaw ? lastRaw.slice(0, 40) : '无输出'}`);
    // href:query 值先 encodeURIComponent(< → %3C,& → %26 防参数边界混淆),
    // 再整体 escapeHtml 放入属性(& 分隔符 → &amp;,防 " breakout)。
    // 浏览器解析:HTML 解码(&amp;→&)→ URL 解码(%3C→<),最终 m/s 参数值还原。
    const midRaw = m.id == null ? '' : m.id;
    const sessRaw = s.name == null ? '' : s.name;
    const href = `/console.html?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
    return `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" data-machine="${mid}" data-session="${sess}" data-status="${escapeHtml(s.status || 'unknown')}" aria-label="${label}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last || '—'}</span>` +
      `<span class="card__time">${time}</span>` +
      `</a>`;
  }

  // 看板卡片:<li data-key> + buildCardInner(供需独立 <li> 的场景使用)。
  function buildCardHTML(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const key = `${m.id}/${s.name}`;
    return `<li class="card-row" data-key="${escapeHtml(key)}">` + buildCardInner(machine, session, opts) + `</li>`;
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
          session: { name: s.name, status, lastLine: s.lastLine || '' },
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
    if (!card || card.status !== 'waiting') return false;
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

  function diffCards(prevKeys, nextKeys) {
    const prev = new Set(prevKeys || []);
    const next = new Set(nextKeys || []);
    const added = [], removed = [];
    for (const k of next) if (!prev.has(k)) added.push(k);
    for (const k of prev) if (!next.has(k)) removed.push(k);
    return { added, removed };
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, buildCardInner, flattenFleet, sortCardsByRelevance, summarizeFleet, diffCards, isStale, partitionStale };
});
