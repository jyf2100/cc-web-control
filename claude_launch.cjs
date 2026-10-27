function shellEscapeForDoubleQuotes(value) {
  return String(value)
    // 纵深防御:换行无法在双引号内可靠转义为字面量,直接删除。
    // 调用方(tmux send-keys 双引号路径)经 normalizeProjectCwd 已在源头拒绝换行,
    // 这里再删一次防止任何遗漏的注入路径。合法项目路径不含换行。
    .replace(/[\r\n]+/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

// 事前钉死 jsonl 文件名(评审团 2/3 号方案,替代已废弃的「启动后轮询捕获」):
//   sessionId → claude --session-id <uuid>(新建,jsonl 文件名恰好 = uuid,已实证)
//   resumeId  → claude --resume <uuid>(续接,追加进同一 jsonl)
//   都无      → 裸 claude(自生成 uuid,不绑定,降级兜底)
//   两者都传  → throw(语义互斥,防误用)
// id 经 shellEscapeForDoubleQuotes:合法 UUID 不含元字符,但 id 拼进 tmux send-keys
// 双引号,纵深防御必须转义(与 wrapperPath 同策略)。
//
// effort(Opus 5 effort 档位,会话级配置):拼为独立 token `--effort <level>` 追加到 wrapper 调用。
// wrapper 消费 --effort(导出 CC_WEB_CLAUDE_EFFORT env,**不透传 claude** 以免 claude 拒未知参数)。
// effort 作为「缓存匹配标识」须在启动时一次性锁定(切换会清空全部上下文缓存,见 effort.cjs)。
// 安全校验:effort 仅接受简单小写字母 token(`^[a-z]+$`),调用方应先 normalizeEffort 取枚举值,
// 此处再做格式兜底防注入(它作为裸 token 拼进 tmux send-keys 命令,必须无元字符)。
function buildClaudeLaunchCommand({ wrapperPath, sessionId, resumeId, effort } = {}) {
  if (typeof wrapperPath !== 'string' || !wrapperPath.trim()) {
    throw new Error('wrapperPath must be a non-empty string');
  }
  if (sessionId && resumeId) {
    throw new Error('sessionId and resumeId are mutually exclusive');
  }
  const escapedWrapper = shellEscapeForDoubleQuotes(wrapperPath);
  let flag = '';
  if (sessionId) {
    flag += ` --session-id "${shellEscapeForDoubleQuotes(sessionId)}"`;
  } else if (resumeId) {
    flag += ` --resume "${shellEscapeForDoubleQuotes(resumeId)}"`;
  }
  if (effort !== undefined && effort !== null && effort !== '') {
    if (typeof effort !== 'string' || !/^[a-z]+$/.test(effort)) {
      throw new Error('effort must be a simple lowercase token (low/medium/high/max)');
    }
    // 裸 token:已限定 ^[a-z]+$,无元字符,无需引号;直接拼接。
    flag += ` --effort ${effort}`;
  }
  return `bash "${escapedWrapper}"${flag}`;
}

// 引擎分发:engine 缺省/'claude' → 既有 claude 路径(输出逐字节一致,回归保障);
// 'codex' → 经 codex-wrapper.sh(与 claude-wrapper.sh 对应的启动路径)裸启动 codex。
// codex 首版不支持 jsonl 事前绑定(--session-id/--resume 是 claude 专属 flag),
// 也不认 --effort——sessionId/resumeId/effort 一律忽略,透传会被 codex 拒(unknown flag)。
function buildEngineLaunchCommand({ engine = 'claude', wrapperPath, sessionId, resumeId, effort } = {}) {
  if (engine === 'codex') {
    if (typeof wrapperPath !== 'string' || !wrapperPath.trim()) {
      throw new Error('wrapperPath must be a non-empty string');
    }
    return `bash "${shellEscapeForDoubleQuotes(wrapperPath)}"`;
  }
  return buildClaudeLaunchCommand({ wrapperPath, sessionId, resumeId, effort });
}

// tmux 会话内启动引擎的完整命令(cd + 引擎启动合并单条,消除慢盘 / direnv hook 下
// cd 未生效就发引擎命令的时序竞态——从 server.cjs 抽出为纯函数,便于对"产出的 tmux
// 命令"做逐字节单测)。cwd 经 shellEscapeForDoubleQuotes 转义(换行已在源头拒绝,纵深防御)。
function buildSessionStartCommand({ engine = 'claude', cwd, wrapperPath, sessionId, resumeId, effort } = {}) {
  if (typeof cwd !== 'string' || !cwd.trim()) {
    throw new Error('cwd must be a non-empty string');
  }
  const escapedCwd = shellEscapeForDoubleQuotes(cwd);
  const launch = buildEngineLaunchCommand({ engine, wrapperPath, sessionId, resumeId, effort });
  return `cd "${escapedCwd}" && ${launch}`;
}

module.exports = {
  buildClaudeLaunchCommand,
  buildEngineLaunchCommand,
  buildSessionStartCommand,
  shellEscapeForDoubleQuotes,
};

