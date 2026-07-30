/**
 * effort.cjs — Opus 5 effort 档位控制面决策(共享前后端,无 DOM)。
 *
 * 事实依据(来源:2026-07-27 深度解读 L51-60):Opus 5 的 effort 档位(low/medium/high/max)
 * 是**缓存匹配标识**——会话中切换档位会**清空全部上下文缓存**,哪怕 high→low 单轮单价下降,
 * 缓存失效带来的重复上下文加载可能让总成本反而上浮。最佳策略是「锁定单一档位全程不调」。
 *
 * 本模块是 cc-web-control 控制面的纯决策层:档位枚举、文档化默认值、归一化、切换警告文案、
 * 切换决策(是否需要确认 / 是否无变化)、以及下发给 Claude Code 的命令构造。
 * 所有函数纯且无副作用,沿用 deadState.cjs 的 UMD 共享 + node --test 风格。
 *
 * 风险(C4):effort benchmark 数据来自量子位转述 Twitter,未直接核验;缓存清空为 Anthropic
 * 官方文档方向。**具体档位名 / 切换命令以 Claude Code 实际支持为准**——档位枚举与 slash 命令
 * 均为文档化常量,便于随 claude 版本调整(单点修改)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Effort = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Opus 5 effort 档位(PRD「① effort 档位:medium 才是性能顶峰」)。
  // 顺序按低→高,供 UI 下拉框稳定渲染。
  var EFFORT_LEVELS = ['low', 'medium', 'high', 'max'];

  // 文档化默认档位:medium(性能顶峰,且避免 high/max 的「乱加戏/重构」倾向)。
  // AC6:未显式选择时使用此默认,且须在 UI 上可见标注。
  var DEFAULT_EFFORT = 'medium';

  var EFFORT_SET = {};
  for (var i = 0; i < EFFORT_LEVELS.length; i++) EFFORT_SET[EFFORT_LEVELS[i]] = true;

  function isValidEffort(v) {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EFFORT_SET, v);
  }

  /**
   * 归一化 effort:合法原样返回;非法/缺失 → fallback(默认 DEFAULT_EFFORT)。
   * fallback 本身非法时再退到 DEFAULT_EFFORT,绝不抛(控制面降级原则)。
   * @param {*} v
   * @param {string} [fallback] 自定义兜底(如来自配置的 defaultEffort)
   * @returns {string} 合法档位
   */
  function normalizeEffort(v, fallback) {
    if (isValidEffort(v)) return v;
    if (isValidEffort(fallback)) return fallback;
    return DEFAULT_EFFORT;
  }

  /**
   * 构造 UI 下拉框选项:每项标注是否为文档化默认(AC6 可见标注)。
   * @param {string} [currentEffort] 当前生效档位(用于标记 isCurrent)
   * @returns {Array<{value:string,label:string,isDefault:boolean,isCurrent:boolean}>}
   */
  function buildEffortOptions(currentEffort) {
    var cur = normalizeEffort(currentEffort);
    var out = [];
    for (var i = 0; i < EFFORT_LEVELS.length; i++) {
      var lvl = EFFORT_LEVELS[i];
      out.push({
        value: lvl,
        label: lvl,
        isDefault: lvl === DEFAULT_EFFORT,
        isCurrent: lvl === cur,
      });
    }
    return out;
  }

  /**
   * 切换警告文案(AC2):必须包含「清空」+「上下文缓存」字样。
   * @param {string} from 当前档位(归一化)
   * @param {string} to 目标档位(归一化)
   * @returns {string}
   */
  function buildEffortChangeWarning(from, to) {
    var f = normalizeEffort(from);
    var t = normalizeEffort(to);
    return '切换 effort 档位(' + f + ' → ' + t + ')将清空该会话全部上下文缓存,'
      + '已加载的上下文需重新计费加载,总成本可能不降反升。确定要切换吗?';
  }

  /**
   * 构造下发给 Claude Code 会话的 effort 切换命令(AC3 dispatch)。
   * 走终端镜像的 slash 命令通道(与用户手敲 / 命令同路径)。
   * 注意:具体命令以 Claude Code 实际支持为准(风险 C4),此处为文档化常量,单点可调。
   * @param {string} effort 目标档位(归一化)
   * @returns {string} 形如 "/effort medium"
   */
  function buildEffortSlashCommand(effort) {
    return '/effort ' + normalizeEffort(effort);
  }

  /**
   * 会话进行中切换 effort 的决策(AC2/AC3/AC4 核心)。
   *   - requested === current → { action:'noop', reason:'unchanged' }(AC4:全程不调 → 无 dispatch)
   *   - requested !== current → { action:'confirm', ... }(AC2:需用户确认才下发)
   * 调用方据此决定:noop 不发任何请求;confirm 先弹警告,用户确认后才下发 dispatch 命令(AC3)。
   * @param {string} currentEffort 当前生效档位
   * @param {string} requestedEffort 用户请求的目标档位
   * @returns {{action:string, reason?:string, from?:string, to?:string, warning?:string, dispatch?:string, effort?:string}}
   */
  function planEffortChange(currentEffort, requestedEffort) {
    var cur = normalizeEffort(currentEffort);
    var req = normalizeEffort(requestedEffort);
    if (req === cur) {
      return { action: 'noop', reason: 'unchanged', effort: cur };
    }
    return {
      action: 'confirm',
      from: cur,
      to: req,
      warning: buildEffortChangeWarning(cur, req),
      // dispatch 仅在用户确认后由调用方下发(AC3)。此处预构造,便于断言「确认 → 下发 to」。
      dispatch: buildEffortSlashCommand(req),
    };
  }

  return {
    EFFORT_LEVELS: EFFORT_LEVELS,
    DEFAULT_EFFORT: DEFAULT_EFFORT,
    isValidEffort: isValidEffort,
    normalizeEffort: normalizeEffort,
    buildEffortOptions: buildEffortOptions,
    buildEffortChangeWarning: buildEffortChangeWarning,
    buildEffortSlashCommand: buildEffortSlashCommand,
    planEffortChange: planEffortChange,
  };
});
