// public/projectsView.cjs
/**
 * Project 选择区纯渲染决策(共享前后端,无 DOM)。
 * 输入 { projects, hasRoots } → 输出 { showSelect, showButton, emptyHint }。
 * 设计依据:2026-06-28-project-path-agent-launch-design.md「前端入口」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProjectsView = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const HINT_NO_ROOTS =
    '未找到项目。在启动服务处设置 export CC_WEB_PROJECT_ROOTS=/路径A,/路径B 后重启服务。';
  const HINT_EMPTY_DIR =
    '已配置项目根目录,但根目录为空或没有任何子目录项目。请检查根目录下是否有项目文件夹。';

  function projectsView(input) {
    const safe = input && typeof input === 'object' ? input : {};
    const projects = Array.isArray(safe.projects) ? safe.projects : [];
    const hasRoots = safe.hasRoots === true;

    if (projects.length > 0) {
      return { showSelect: true, showButton: true, emptyHint: '' };
    }
    return {
      showSelect: false,
      showButton: false,
      emptyHint: hasRoots ? HINT_EMPTY_DIR : HINT_NO_ROOTS,
    };
  }

  return { projectsView };
});
