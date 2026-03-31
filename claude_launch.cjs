function shellEscapeForDoubleQuotes(value) {
  return String(value)
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
};

