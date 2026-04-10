const test = require('node:test');
const assert = require('node:assert/strict');

test('getBootstrapSession leaves cold start unresolved until config is loaded', async () => {
    const { getBootstrapSession } = await import('../public/modules/session_state.js');

    assert.equal(getBootstrapSession({ urlSession: null, storedSession: null }), null);
    assert.equal(getBootstrapSession({ urlSession: '', storedSession: 'claude-stored' }), 'claude-stored');
});

test('resolveSessionTarget prefers the server default when no URL or stored session is present', async () => {
    const { resolveSessionTarget } = await import('../public/modules/session_state.js');

    const resolution = resolveSessionTarget({
        urlSession: null,
        storedSession: null,
        defaultSession: 'claude-team-default',
        currentSession: null,
        sessions: [
            { name: 'claude-team-default', attached: false },
            { name: 'claude-other', attached: true },
        ],
    });

    assert.deepEqual(resolution, {
        sessionName: 'claude-team-default',
        source: 'default',
        pinned: false,
        missing: false,
        unavailableSession: null,
        unavailableSource: null,
    });
});

test('resolveSessionTarget reports recovery when stored session disappeared', async () => {
    const { buildRecoveryMessage, resolveSessionTarget } = await import('../public/modules/session_state.js');

    const resolution = resolveSessionTarget({
        urlSession: null,
        storedSession: 'claude-missing',
        defaultSession: 'claude-default',
        currentSession: null,
        sessions: [
            { name: 'claude-default', attached: false },
            { name: 'claude-attached', attached: true },
        ],
    });

    assert.equal(resolution.sessionName, 'claude-default');
    assert.equal(resolution.source, 'default');
    assert.equal(resolution.unavailableSession, 'claude-missing');
    assert.equal(resolution.unavailableSource, 'stored');
    assert.equal(buildRecoveryMessage(resolution), '上次会话 claude-missing 不存在，已恢复到 claude-default');
});

test('resolveSessionTarget keeps URL-pinned sessions even when they are currently missing', async () => {
    const { buildPinnedMissingMessage, resolveSessionTarget } = await import('../public/modules/session_state.js');

    const resolution = resolveSessionTarget({
        urlSession: 'claude-pinned',
        storedSession: 'claude-stored',
        defaultSession: 'claude-default',
        currentSession: 'claude-stored',
        sessions: [
            { name: 'claude-default', attached: false },
        ],
    });

    assert.equal(resolution.sessionName, 'claude-pinned');
    assert.equal(resolution.source, 'url');
    assert.equal(resolution.pinned, true);
    assert.equal(resolution.missing, true);
    assert.equal(buildPinnedMissingMessage(resolution.sessionName), 'URL 指定的会话 claude-pinned 不存在，请在顶部 Session 下拉框中切换到其他会话。');
});
