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

function buildClaudeLaunchCommand({ wrapperPath, continueConversation }) {
  if (typeof wrapperPath !== 'string' || !wrapperPath.trim()) {
    throw new Error('wrapperPath must be a non-empty string');
  }
  const escaped = shellEscapeForDoubleQuotes(wrapperPath);
  const args = continueConversation ? ' -c' : '';
  return `bash "${escaped}"${args}`;
}

module.exports = {
  buildClaudeLaunchCommand,
  shellEscapeForDoubleQuotes,
};

