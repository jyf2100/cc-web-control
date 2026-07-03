/**
 * Console render pure functions (shared between browser and tests).
 * 对齐范本:dashboard_render.cjs / terminal_cleaner.cjs(UMD)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ConsoleRender = factory();
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

  function statusMeta(status) {
    return STATUS_META[status] || DEFAULT_META;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    return `${Math.floor(diff / 3600000)}h 前`;
  }

  function buildCardHTML(machine, session, opts) {
    const m = machine || {};
    const s = session || {};
    const o = opts || {};
    const meta = statusMeta(s.status);
    const key = `${m.id}/${s.name}`;
    const classes = ['card'];
    if (o.active) classes.push('active');
    if (o.selected) classes.push('card--selected');
    const name = escapeHtml(m.name || m.id);
    const sess = escapeHtml(s.name);
    const last = escapeHtml(s.lastLine || (m.online === false ? '(离线)' : ''));
    const time = escapeHtml(relativeTime(o.lastTs, o.now));
    const label = escapeHtml(`${m.name || m.id} / ${s.name},${meta.label},${last ? last.slice(0, 40) : '无输出'}`);
    return `<li class="card-row" data-key="${escapeHtml(key)}">` +
      `<button type="button" class="${classes.join(' ')}" data-machine="${escapeHtml(m.id)}" data-session="${escapeHtml(s.name)}" aria-label="${label}">` +
      `<span class="card__select" role="checkbox" aria-checked="${o.selected ? 'true' : 'false'}" tabindex="-1" aria-hidden="true">☐</span>` +
      `<span class="s-dot ${meta.dot}" aria-hidden="true"></span>` +
      `<span class="s-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="card__name">${name}</span>` +
      `<span class="card__session">${sess}</span>` +
      `<span class="card__last">${last}</span>` +
      `<span class="card__time">${time}</span>` +
      `</button></li>`;
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
    const added = [];
    const removed = [];
    for (const k of next) if (!prev.has(k)) added.push(k);
    for (const k of prev) if (!next.has(k)) removed.push(k);
    return { added, removed };
  }

  return { statusMeta, escapeHtml, relativeTime, buildCardHTML, sortCardsErroredFirst, summarizeFleet, diffCards };
});
