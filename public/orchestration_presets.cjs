/**
 * orchestration_presets.cjs — 编排预设(「skill 纪律」)选择与注入。
 *
 * 背景:skill 生态(mattpocock / obra-superpowers / gstack)已把 Claude Code 的
 * 行为单元收敛为「需求澄清 + 工程纪律」。本模块把三剑客沉淀的纪律作为可选预设,
 * 让 Web 控制面为每条任务消息注入对应的纪律前缀,而非实现 skill 本身。
 *
 * 纯函数(listPresets / getPreset / getDefaultId / applyPreset)可 node --test;
 * UMD:浏览器挂 window.OrchestrationPreses... → window.OrchestrationPresets,node 导出。
 *
 * 注入契约(重要):注入文本最终经 tmux `send-keys -l` 单行发送,而 tmux 把字面 \n
 * 当作提前回车提交。故 prefix 必须单行;applyPreset 会把任意 \r\n 折叠成空格做防御,
 * 保证将来新增第 4 档误配多行 prefix 也不破坏提交。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrchestrationPresets = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DEFAULT_ID = 'direct';

  /**
   * 可配置的注入模板:新增档位只需在此数组追加一项。
   * @property {string} id          稳定标识(前端选择器 value / applyPreset 入参)
   * @property {string} label       选择器可见文案
   * @property {string} description 选择器 title/tooltip 说明
   * @property {string} prefix      注入到用户任务前的纪律指令(单行;空串=不注入)
   *
   * prefix 末尾建议自带连接词(如「我的任务:」),使其与后接的用户文本拼接后语义连贯。
   */
  var PRESETS = [
    {
      id: 'direct',
      label: '直接执行',
      description: '不注入额外指令,行为与现状一致',
      prefix: ''
    },
    {
      id: 'clarify',
      label: '需求澄清优先',
      description: '先澄清需求 / 列决策树再动手(mattpocock 路线)',
      prefix: '先别急着写代码。请先澄清需求:列出关键的不确定点与隐含假设,并用决策树给出 2~3 个可行方案及其权衡(成本/风险/复杂度);等我确认方案后,你再开始实现。我的任务:'
    },
    {
      id: 'tdd',
      label: 'TDD 流水线',
      description: '先写测试再实现,red-green-refactor(obra/gstack 路线)',
      prefix: '请用严格的 TDD 流水线:先为预期行为写一条会失败的测试(RED),再写让它通过的最小实现(GREEN),然后重构并确保所有测试始终为绿(REFACTOR);在测试变绿之前,不要交付任何实现。我的任务:'
    }
  ];

  function getDefaultId() {
    return DEFAULT_ID;
  }

  function getPreset(id) {
    var target = String(id == null ? '' : id);
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].id === target) {
        // 返回浅拷贝,避免调用方突变共享的 PRESETS 数据(immutable 风格)
        return Object.assign({}, PRESETS[i]);
      }
    }
    for (var j = 0; j < PRESETS.length; j++) {
      if (PRESETS[j].id === DEFAULT_ID) {
        return Object.assign({}, PRESETS[j]);
      }
    }
    return null;
  }

  /**
   * 渲染视图:只暴露 UI 需要的 id/label/description(不含 prefix 文本),
   * 供前端 <select> 渲染选项。
   * @returns {Array<{id:string,label:string,description:string}>}
   */
  function listPresets() {
    return PRESETS.map(function (p) {
      return { id: p.id, label: p.label, description: p.description };
    });
  }

  /**
   * 把预设的纪律前缀注入到用户原始任务文本前(纯函数)。
   *
   * - 用户文本为空或仅空白 → 不注入(空输入走纯按键路径,不应携带指令)。
   * - 默认档 / 未知档位(prefix 为空)→ 原样返回(行为与现状一致,无残留)。
   * - 折叠 prefix 内的 \r\n 为空格:tmux send-keys -l 把字面换行当作提前回车,
   *   单行化保证提交不被截断。
   *
   * @param {string} text 用户原始任务文本
   * @param {string} [id] 预设档位 id;缺省/未知 → 默认档(不注入)
   * @returns {string} 注入后的最终输入文本
   */
  function applyPreset(text, id) {
    var raw = typeof text === 'string' ? text : String(text == null ? '' : text);
    if (!raw.trim()) return raw;

    var preset = getPreset(id);
    var prefix = preset && typeof preset.prefix === 'string' ? preset.prefix : '';
    var safePrefix = prefix.replace(/[\r\n]+/g, ' ').trim();
    if (!safePrefix) return raw;

    return safePrefix + raw;
  }

  return {
    DEFAULT_ID: DEFAULT_ID,
    PRESETS: PRESETS,
    getDefaultId: getDefaultId,
    getPreset: getPreset,
    listPresets: listPresets,
    applyPreset: applyPreset
  };
});
