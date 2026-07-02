// hub/main_agent_env.cjs
'use strict';

/**
 * 从环境变量解析主控 agent 配置(T1 只读参谋)。
 * enabled 是安全开关:决定是否 spawn 一个继承 hub token 的 claude 会话。
 * 默认关闭 —— 必须显式 CC_WEB_HUB_MAIN_AGENT_ENABLED=1 才装配。
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{enabled: boolean, session?: string, claudePath?: string, dataDir?: string, auditFile?: string}}
 */
function resolveMainAgentConfig(env) {
  const cfg = { enabled: env.CC_WEB_HUB_MAIN_AGENT_ENABLED === '1' };
  if (env.CC_WEB_HUB_MAIN_AGENT_SESSION) cfg.session = env.CC_WEB_HUB_MAIN_AGENT_SESSION;
  if (env.CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH) cfg.claudePath = env.CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH;
  if (env.CC_WEB_HUB_MAIN_AGENT_DATA_DIR) cfg.dataDir = env.CC_WEB_HUB_MAIN_AGENT_DATA_DIR;
  if (env.CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE) cfg.auditFile = env.CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE;
  return cfg;
}

module.exports = { resolveMainAgentConfig };
