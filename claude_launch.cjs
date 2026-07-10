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
function buildClaudeLaunchCommand({ wrapperPath, sessionId, resumeId } = {}) {
  if (typeof wrapperPath !== 'string' || !wrapperPath.trim()) {
    throw new Error('wrapperPath must be a non-empty string');
  }
  if (sessionId && resumeId) {
    throw new Error('sessionId and resumeId are mutually exclusive');
  }
  const escapedWrapper = shellEscapeForDoubleQuotes(wrapperPath);
  let flag = '';
  if (sessionId) {
    flag = ` --session-id "${shellEscapeForDoubleQuotes(sessionId)}"`;
  } else if (resumeId) {
    flag = ` --resume "${shellEscapeForDoubleQuotes(resumeId)}"`;
  }
  return `bash "${escapedWrapper}"${flag}`;
}

module.exports = {
  buildClaudeLaunchCommand,
  shellEscapeForDoubleQuotes,
};

