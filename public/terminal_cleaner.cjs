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

  function cleanSummary(raw, maxLen) {
    if (raw == null) return '';
    const max = (typeof maxLen === 'number' && maxLen > 0) ? maxLen : 60;
    let s = cleanOutput(String(raw));
    // 去 markdown 行内/行首标记(保留文字内容)
    s = s
      .replace(/^#{1,6}\s+/gm, '')          // ## / ### 标题前缀
      .replace(/^\s{0,3}[-*+]\s+/gm, '')    // - * + 列表符
      .replace(/^\s{0,3}>\s?/gm, '')        // > 引用
      .replace(/\*\*(.+?)\*\*/g, '$1')      // **粗体**
      .replace(/__(.+?)__/g, '$1')          // __粗体__
      .replace(/`([^`]+)`/g, '$1');         // `行内码`
    // 折叠连续空白(含换行)为单空格
    s = s.replace(/\s+/g, ' ').trim();
    // 截断 + 省略号
    if (s.length > max) s = s.slice(0, max).trimEnd() + '…';
    return s;
  }

  return { cleanOutput, cleanSummary };
});
