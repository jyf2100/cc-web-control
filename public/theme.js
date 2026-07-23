/**
 * cc-web-control 主题切换(dark/light 双主题,深色默认)。
 * 读取/写入 localStorage 'cc-theme';anti-FOUC 由各 HTML <head> 内联脚本完成,
 * 本文件负责:切换、持久化、同步 <meta name="theme-color">、刷新 toggle 按钮图标。
 * 无依赖,三个页面共用(index / dashboard / login)。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cc-theme';
  var THEME_COLORS = { dark: '#121110', light: '#f2f1ed' };
  var ICONS = { dark: '☀', light: '☾' }; // 显示「点击后切换到」的图标

  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function syncThemeColor(theme) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', THEME_COLORS[theme]);
    }
  }

  function syncToggles(theme) {
    var btns = document.querySelectorAll('#themeToggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = ICONS[theme];
      btns[i].setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btns[i].setAttribute('title', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    }
  }

  function applyTheme(theme, persist) {
    var t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, t); } catch (e) { /* 私密模式等:静默 */ }
    }
    syncThemeColor(t);
    syncToggles(t);
  }

  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
  }

  // 事件委托:按钮由 HTML 静态提供(#themeToggle),委托兼容任意页面结构
  document.addEventListener('click', function (e) {
    var btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('#themeToggle') : null;
    if (btn) toggleTheme();
  });

  // 暴露给控制台调试/未来设置面板
  window.CCTheme = { apply: applyTheme, toggle: toggleTheme, current: currentTheme };

  // 初始化:同步 meta theme-color 与按钮图标到当前(anti-FOUC 已定的)主题
  function init() { applyTheme(currentTheme(), false); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
