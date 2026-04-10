function createStatusError(statusCode, message, cause) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function normalizeProjectPath(cwd, normalizeProjectCwd) {
  try {
    return normalizeProjectCwd(cwd);
  } catch (error) {
    const message = error?.message || 'Invalid project path';
    const statusCode = message.includes('allowed project roots') ? 403 : 400;
    throw createStatusError(statusCode, message, error);
  }
}

async function createProjectSession(options) {
  const {
    sessionName,
    cwd,
    normalizeProjectCwd,
    isCommandAvailable,
    createSession,
    startClaudeInSession,
    killSession,
  } = options || {};

  const normalizedCwd = cwd ? normalizeProjectPath(cwd, normalizeProjectCwd) : null;

  if (normalizedCwd) {
    const hasClaude = await isCommandAvailable('claude', ['--version']);
    if (!hasClaude) {
      throw createStatusError(503, 'claude is not available on PATH');
    }
  }

  let sessionCreated = false;

  try {
    await createSession(sessionName);
    sessionCreated = true;

    if (normalizedCwd) {
      await startClaudeInSession(sessionName, normalizedCwd);
    }

    return { normalizedCwd };
  } catch (error) {
    if (sessionCreated && normalizedCwd) {
      try {
        await killSession(sessionName);
      } catch {}
    }
    throw error;
  }
}

module.exports = {
  createProjectSession,
};
