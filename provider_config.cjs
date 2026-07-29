'use strict';

// 模型供应商可切换配置(provider-agnostic config)。
//
// 背景:纳德拉警告 —— 模型 + Harness + 上下文 + 长期记忆全绑定单家供应商 = 把命门交出去。
// 本模块把「模型供应商相关参数」从代码常量外置为配置项,使切换 / 并存多家供应商成为
// 「改配置」而非「改代码」,且源码中无任何单一供应商的硬编码 endpoint / 模型 id 绑定。
// 这是 hub 作为聚合控制面的中立性基础:不同节点可各自指向不同供应商,hub 只聚合不预设。
//
// 三个供应商配置字段(定义于 SINGLE_SCHEMA,见 config_loader.cjs):
//   - providerEndpoint  → API endpoint(env: ANTHROPIC_BASE_URL,claude CLI 读此 env 定位供应商)
//   - providerModel     → 模型标识  (env: ANTHROPIC_MODEL,claude CLI 读此 env 选模型)
//   - anthropic_api_key → 鉴权引用  (env: ANTHROPIC_API_KEY;keychain:// 引用或明文,见 secret_store.cjs)
//
// endpoint / model 的值均取自配置参数(非字面量),经 providerEnv() 转成子进程 env,
// 由 server.cjs 的 claudeSessionEnv() 合并后经 `tmux new-session -e` 注入 claude 子进程。
// auth(anthropic_api_key)由 resolveApiKey 独立解析,与本模块的 endpoint/model 校验解耦
// (鉴权可独立存在:如默认模式下用 claude 自带登录 + 用户 API key;或自定义 endpoint 自带鉴权)。

// claude CLI 读取这两个 env 名作为供应商 endpoint / 模型标识(标准 Anthropic env 约定)。
// 它们是 env *键名* 透传(值始终来自配置),非「硬编码供应商值」。
const ENV_BASE_URL = 'ANTHROPIC_BASE_URL';
const ENV_MODEL = 'ANTHROPIC_MODEL';

function truthy(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 校验供应商配置一致性(fail-fast,PRD 验收 #5)。
 * endpoint 与 model 必须「同时给或同时不给」:
 *   - 两者皆空 → 默认模式:claude 走自带 endpoint/模型(不注入,不回退任何硬编码默认值)
 *   - 两者皆给 → 自定义供应商模式:注入 ANTHROPIC_BASE_URL + ANTHROPIC_MODEL
 *   - 只给其一 → 显式报错(绝不静默回退到某个硬编码供应商默认值)
 * auth(anthropic_api_key)独立、可选,不参与本校验。
 * @param {{endpoint?:string, model?:string}} cfg
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function validateProviderConfig({ endpoint, model } = {}) {
  const hasEp = truthy(endpoint);
  const hasMd = truthy(model);
  if (hasEp || hasMd) {
    const missing = [];
    if (!hasEp) missing.push(`providerEndpoint (${ENV_BASE_URL})`);
    if (!hasMd) missing.push(`providerModel (${ENV_MODEL})`);
    if (missing.length) {
      return {
        ok: false,
        error:
          '供应商配置不完整:缺少 ' + missing.join(' 与 ') +
          '。endpoint 与 model 必须同时配置(不可为空),且不会回退到任何硬编码供应商默认值。',
      };
    }
  }
  return { ok: true };
}

/**
 * 由供应商配置生成注入子进程的 env(PRD 验收 #2/#4:值取自配置参数,非字面量)。
 *   空 → 不注入(claude 走自带默认)。
 *   endpoint → ANTHROPIC_BASE_URL;model → ANTHROPIC_MODEL。
 * 返回的 env 仅含配置中非空的项;调用方负责合并 ANTHROPIC_API_KEY 后整体注入。
 * @param {{endpoint?:string, model?:string}} cfg
 * @returns {Record<string,string>}
 */
function providerEnv({ endpoint, model } = {}) {
  const env = {};
  if (truthy(endpoint)) env[ENV_BASE_URL] = endpoint.trim();
  if (truthy(model)) env[ENV_MODEL] = model.trim();
  return env;
}

module.exports = {
  validateProviderConfig,
  providerEnv,
  ENV_BASE_URL,
  ENV_MODEL,
};
