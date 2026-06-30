/**
 * session_switch.cjs — 切换会话的副作用编排(共享前后端,无 DOM 直接依赖)。
 * 把「切到某 session」的固定步骤封装,避免 select.change 与切换 sheet tap 两路行为分叉。
 * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.1。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SessionSwitch = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function switchSession(ctx, deps) {
    const target = ctx && typeof ctx.target === 'string' ? ctx.target.trim() : '';
    const current = ctx && typeof ctx.current === 'string' ? ctx.current : '';
    if (!target || target === current) return false;
    const d = deps && typeof deps === 'object' ? deps : {};
    if (typeof d.setUrl === 'function') d.setUrl(target);
    if (typeof d.store === 'function') d.store(target);
    if (typeof d.updateUi === 'function') d.updateUi();
    if (typeof d.syncProject === 'function') d.syncProject();
    if (typeof d.clearOutput === 'function') d.clearOutput();
    if (typeof d.hideQuickReply === 'function') d.hideQuickReply();
    if (typeof d.connect === 'function') d.connect();
    if (typeof d.note === 'function') d.note(`切换会话: ${target}`);
    return true;
  }
  return { switchSession };
});
