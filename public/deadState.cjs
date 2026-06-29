/**
 * 死状态提示决策(共享前后端,无 DOM)。
 * 切到曾跑过 claude(claudeSessionId 非空)的已存在 session 时,提示 claude 可能已退出。
 * 仅提示,不自动重启。设计依据:2026-06-28-project-path-agent-launch-design.md「边界」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeadState = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEAD_HINT =
    '该会话的 Claude 可能已退出,可在终端输入 claude -c 续接,或删除会话后重建。';

  function detectDeadState(entry) {
    const safe = entry && typeof entry === 'object' ? entry : {};
    if (!safe.claudeSessionId) {
      return { shouldHint: false, hint: '' };
    }
    return { shouldHint: true, hint: DEAD_HINT };
  }

  return { detectDeadState, DEAD_HINT };
});
