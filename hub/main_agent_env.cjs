// hub/main_agent_env.cjs
'use strict';

/**
 * 从环境变量解析主控 agent 配置(T1 只读参谋)。
 * enabled 是安全开关:决定是否 spawn 一个继承 hub token 的 claude 会话。
 * 默认关闭 —— 必须显式 CC_WEB_HUB_MAIN_AGENT_ENABLED=1 才装配。
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{enabled: boolean, session?: string, claudePath?: string, dataDir?: string, auditFile?: string, settleMs: number, maxSettleMs: number, backoffBase: number, staleBump: number}}
 */
// 数值字段:有限且 >0 才采用,否则回退默认(mainAgent 容错优先,不阻断启动)
function numOr(env, key, def) {
  const raw = env[key];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function resolveMainAgentConfig(env) {
  const cfg = { enabled: env.CC_WEB_HUB_MAIN_AGENT_ENABLED === '1' };
  if (env.CC_WEB_HUB_MAIN_AGENT_SESSION) cfg.session = env.CC_WEB_HUB_MAIN_AGENT_SESSION;
  if (env.CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH) cfg.claudePath = env.CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH;
  if (env.CC_WEB_HUB_MAIN_AGENT_DATA_DIR) cfg.dataDir = env.CC_WEB_HUB_MAIN_AGENT_DATA_DIR;
  if (env.CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE) cfg.auditFile = env.CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE;
  cfg.settleMs = numOr(env, 'CC_WEB_HUB_MAIN_AGENT_SETTLE_MS', 60_000);
  cfg.maxSettleMs = numOr(env, 'CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS', 900_000);
  cfg.backoffBase = numOr(env, 'CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE', 2);
  cfg.staleBump = numOr(env, 'CC_WEB_HUB_MAIN_AGENT_STALE_BUMP', 1);
  return cfg;
}

// config.mainAgent(已类型校验的 object)→ 虚拟 env → 与 realEnv 合并(realEnv 优先)→ resolveMainAgentConfig。
// spec §5.2 B2:config 文件值 < 真实 env(真实 env 是逃生口)。数值 ≤0/非法由 resolveMainAgentConfig numOr clamp。
function resolveMainAgentFromConfig(configMainAgent, realEnv) {
  const ma = configMainAgent || {};
  const maEnv = {};
  if (ma.enabled === true) maEnv.CC_WEB_HUB_MAIN_AGENT_ENABLED = '1';
  if (ma.session) maEnv.CC_WEB_HUB_MAIN_AGENT_SESSION = ma.session;
  if (ma.claudePath) maEnv.CC_WEB_HUB_MAIN_AGENT_CLAUDE_PATH = ma.claudePath;
  if (ma.dataDir) maEnv.CC_WEB_HUB_MAIN_AGENT_DATA_DIR = ma.dataDir;
  if (ma.auditFile) maEnv.CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE = ma.auditFile;
  if (typeof ma.settleMs === 'number') maEnv.CC_WEB_HUB_MAIN_AGENT_SETTLE_MS = String(ma.settleMs);
  if (typeof ma.maxSettleMs === 'number') maEnv.CC_WEB_HUB_MAIN_AGENT_MAX_SETTLE_MS = String(ma.maxSettleMs);
  if (typeof ma.backoffBase === 'number') maEnv.CC_WEB_HUB_MAIN_AGENT_BACKOFF_BASE = String(ma.backoffBase);
  if (typeof ma.staleBump === 'number') maEnv.CC_WEB_HUB_MAIN_AGENT_STALE_BUMP = String(ma.staleBump);
  return resolveMainAgentConfig({ ...maEnv, ...realEnv });
}

module.exports = { resolveMainAgentConfig, resolveMainAgentFromConfig };
