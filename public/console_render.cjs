/**
 * Console render pure functions (shared between browser and tests).
 * 对齐范本:dashboard_render.cjs / terminal_cleaner.cjs(UMD)。
 * 卡片渲染相关(buildCardHTML/sortCardsByRelevance/summarizeFleet/
 * statusMeta/escapeHtml/STATUS_META 等)已抽到 board_render.cjs(看板用)。
 * 本模块只留 main-agent 相关:relativeTime / parseCallout / nextBackoff。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./terminal_cleaner.cjs'));
  } else {
    root.ConsoleRender = factory(root.TerminalCleaner || { cleanOutput: (s) => s });
  }
})(typeof window !== 'undefined' ? window : globalThis, function (TC) {
  'use strict';

  // 注:relativeTime 与 board_render.cjs 的同名函数重复(UMD 模块独立性,各自独立加载)。
  // 改一处需同步另一处,避免行为漂移。
  function relativeTime(ts, now) {
    if (!ts) return '';
    const n = now || Date.now();
    const diff = Math.max(0, n - ts);
    if (diff < 5000) return 'now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m 前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h 前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d 前`;
    if (diff < 2592000000) return `${Math.floor(diff / 604800000)}w 前`;
    return `${Math.floor(diff / 2592000000)}个月前`;
  }

  const stripAnsi = (s) => (TC && TC.cleanOutput ? TC.cleanOutput(s) : String(s || ''));
  const ERROR_RE = /\b(error|fail(?:ed)?|traceback|exception|EACCES|errno|panic|✕)\b/i;

  function parseCallout(rawScreen, state) {
    const st = state || {};
    const clean = stripAnsi(rawScreen || '');
    // §9 块首算法:取"最后一个连续非空块的首行"(非末行),过滤多行错误栈的栈尾噪音
    const rawLines = clean.split('\n').map((l) => l.trim());
    let end = rawLines.length;
    while (end > 0 && !rawLines[end - 1]) end--;        // 跳过末尾空行
    if (end === 0) return { show: false };
    let start = end;
    while (start > 0 && rawLines[start - 1]) start--;   // 块内向前到块首
    const blockFirst = rawLines[start];
    const text = blockFirst.slice(0, 120);
    if (!ERROR_RE.test(text)) return { show: false };
    const now = st.now || Date.now();
    const ts = (text === st.lastText) ? (st.lastChangeTs || now) : now;
    const stableMs = ts ? now - ts : 0;
    const display = blockFirst.length > 120 ? text + '…' : text;
    const timeLabel = stableMs > 10000 ? relativeTime(ts, now) : '实时输出中…';
    return { show: true, text: display, ts, timeLabel };
  }

  const BACKOFF_TABLE = [3000, 6000, 12000, 30000];
  function nextBackoff(attempt) {
    const i = attempt < 0 ? 0 : attempt;
    return BACKOFF_TABLE[Math.min(i, BACKOFF_TABLE.length - 1)];
  }

  return { relativeTime, parseCallout, nextBackoff };
});
