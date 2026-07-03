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

  return { statusMeta, escapeHtml };
});
