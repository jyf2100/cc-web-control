/**
 * Board render pure functions(看板卡片网格,浏览器 + 测试双跑)。
 * 从 console_render.cjs 抽出;看板纯监控 click-to-navigate(无多选 ☐/☑)。
 * 对齐范本:dashboard_render.cjs / console_render.cjs(UMD)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoardRender = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
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
    return `${Math.floor(diff / 3600000)}h 前`;
  }

  // 看板卡片:click-to-navigate 的 <a>(跳 /console.html?m=&s=),无 select 多选语义。
  function buildCardHTML(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const key = `${m.id}/${s.name}`;
    const classes = ['card'];
    if (o.active) classes.push('active');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const mid = escapeHtml(m.id);
    const lastRaw = s.lastLine || (m.online === false ? '(离线)' : '');
    const last = escapeHtml(lastRaw);
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    const label = escapeHtml(`${m.name || m.id} / ${s.name},${meta.label},${lastRaw ? lastRaw.slice(0, 40) : '无输出'}`);
    // href:query 值先 encodeURIComponent(< → %3C,& → %26 防参数边界混淆),
    // 再整体 escapeHtml 放入属性(& 分隔符 → &amp;,防 " breakout)。
    // 浏览器解析:HTML 解码(&amp;→&)→ URL 解码(%3C→<),最终 m/s 参数值还原。
    const midRaw = m.id == null ? '' : m.id;
    const sessRaw = s.name == null ? '' : s.name;
    const href = `/console.html?m=${encodeURIComponent(midRaw)}&s=${encodeURIComponent(sessRaw)}`;
    return `<li class="card-row" data-key="${escapeHtml(key)}">` +
      `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" data-machine="${mid}" data-session="${sess}" data-status="${escapeHtml(s.status || 'unknown')}" aria-label="${label}">` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last || '—'}</span>` +
      `<span class="card__time">${time}</span>` +
      `</a></li>`;
  }

  const STATUS_RANK = { errored: 0, working: 1, waiting: 2, idle: 3, unknown: 4, offline: 5 };
  function sortCardsErroredFirst(cards) {
    return [...(cards || [])].sort((a, b) => {
      const ra = STATUS_RANK[a && a.status] == null ? 4 : STATUS_RANK[a.status];
      const rb = STATUS_RANK[b && b.status] == null ? 4 : STATUS_RANK[b.status];
      if (ra !== rb) return ra - rb;
      return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
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

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards };
});
