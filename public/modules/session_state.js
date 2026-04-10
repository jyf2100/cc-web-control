function normalizeSessionName(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
}

function pushUniqueCandidate(candidates, source, value) {
    const sessionName = normalizeSessionName(value);
    if (!sessionName) return;
    if (candidates.some((candidate) => candidate.value === sessionName)) return;
    candidates.push({ source, value: sessionName });
}

export function getBootstrapSession({ urlSession, storedSession } = {}) {
    return normalizeSessionName(urlSession) || normalizeSessionName(storedSession) || null;
}

export function resolveSessionTarget({
    urlSession,
    storedSession,
    defaultSession,
    currentSession,
    sessions,
} = {}) {
    const sessionList = Array.isArray(sessions) ? sessions : [];
    const sessionNames = [...new Set(
        sessionList
            .map((session) => normalizeSessionName(session?.name))
            .filter(Boolean)
    )];

    const url = normalizeSessionName(urlSession);
    if (url) {
        return {
            sessionName: url,
            source: 'url',
            pinned: true,
            missing: !sessionNames.includes(url),
            unavailableSession: null,
            unavailableSource: null,
        };
    }

    const candidates = [];
    pushUniqueCandidate(candidates, 'current', currentSession);
    pushUniqueCandidate(candidates, 'stored', storedSession);
    pushUniqueCandidate(candidates, 'default', defaultSession);

    let unavailableSession = null;
    let unavailableSource = null;

    for (const candidate of candidates) {
        if (sessionNames.includes(candidate.value)) {
            return {
                sessionName: candidate.value,
                source: candidate.source,
                pinned: false,
                missing: false,
                unavailableSession,
                unavailableSource,
            };
        }
        if (!unavailableSession) {
            unavailableSession = candidate.value;
            unavailableSource = candidate.source;
        }
    }

    const attachedSession = sessionList.find((session) => session && session.attached && normalizeSessionName(session.name));
    const attachedName = normalizeSessionName(attachedSession?.name);
    if (attachedName) {
        return {
            sessionName: attachedName,
            source: 'attached',
            pinned: false,
            missing: false,
            unavailableSession,
            unavailableSource,
        };
    }

    const firstName = sessionNames[0] || null;
    if (firstName) {
        return {
            sessionName: firstName,
            source: 'first',
            pinned: false,
            missing: false,
            unavailableSession,
            unavailableSource,
        };
    }

    const fallbackSession = normalizeSessionName(currentSession)
        || normalizeSessionName(storedSession)
        || normalizeSessionName(defaultSession)
        || null;

    return {
        sessionName: fallbackSession,
        source: 'fallback',
        pinned: false,
        missing: !!fallbackSession,
        unavailableSession,
        unavailableSource,
    };
}

export function buildRecoveryMessage(resolution) {
    if (!resolution || !resolution.unavailableSession || !resolution.sessionName) return null;
    if (resolution.unavailableSession === resolution.sessionName) return null;

    const sourceLabel = {
        current: '当前会话',
        stored: '上次会话',
        default: '默认会话',
    }[resolution.unavailableSource] || '会话';

    return `${sourceLabel} ${resolution.unavailableSession} 不存在，已恢复到 ${resolution.sessionName}`;
}

export function buildPinnedMissingMessage(sessionName) {
    const name = normalizeSessionName(sessionName);
    if (!name) return null;
    return `URL 指定的会话 ${name} 不存在，请在顶部 Session 下拉框中切换到其他会话。`;
}
