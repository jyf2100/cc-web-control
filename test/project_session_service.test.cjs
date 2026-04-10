const test = require('node:test');
const assert = require('node:assert/strict');

const { createProjectSession } = require('../project_session_service.cjs');

test('createProjectSession validates claude availability before creating the session', async () => {
    const calls = [];

    await assert.rejects(
        () => createProjectSession({
            sessionName: 'claude-demo',
            cwd: '/tmp/demo',
            normalizeProjectCwd(cwd) {
                calls.push(`normalize:${cwd}`);
                return '/real/demo';
            },
            isCommandAvailable: async (cmd) => {
                calls.push(`check:${cmd}`);
                return false;
            },
            createSession: async () => {
                calls.push('create');
            },
            startClaudeInSession: async () => {
                calls.push('start');
            },
            killSession: async () => {
                calls.push('kill');
            },
        }),
        (error) => {
            assert.equal(error.statusCode, 503);
            assert.match(error.message, /claude is not available/i);
            return true;
        }
    );

    assert.deepEqual(calls, [
        'normalize:/tmp/demo',
        'check:claude',
    ]);
});

test('createProjectSession cleans up a newly created session when Claude launch fails', async () => {
    const calls = [];

    await assert.rejects(
        () => createProjectSession({
            sessionName: 'claude-demo',
            cwd: '/tmp/demo',
            normalizeProjectCwd() {
                calls.push('normalize');
                return '/real/demo';
            },
            isCommandAvailable: async () => {
                calls.push('check:claude');
                return true;
            },
            createSession: async () => {
                calls.push('create');
            },
            startClaudeInSession: async (sessionName, cwd) => {
                calls.push(`start:${sessionName}:${cwd}`);
                throw new Error('launch failed');
            },
            killSession: async (sessionName) => {
                calls.push(`kill:${sessionName}`);
            },
        }),
        /launch failed/
    );

    assert.deepEqual(calls, [
        'normalize',
        'check:claude',
        'create',
        'start:claude-demo:/real/demo',
        'kill:claude-demo',
    ]);
});
