/**
 * Terminal output cleaner (shared between browser and tests).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TerminalCleaner = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function cleanOutput(output) {
    if (typeof output !== 'string') return '';

    let clean = output;
    // CSI 序列，例如 \x1b[31m
    clean = clean.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    // OSC 序列，例如 \x1b]0;title\x07
    clean = clean.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    // 规范换行
    clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const lines = clean.split('\n');

    // 过滤纯分隔线和单独提示符行，减少无效噪声
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^[-─━═]{20,}$/.test(trimmed)) return false;
      if (/^❯\s*$/.test(trimmed)) return false;
      return true;
    });

    return filteredLines.join('\n');
  }

  return { cleanOutput };
});
