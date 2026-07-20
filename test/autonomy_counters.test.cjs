const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyGitCommand, extractBashCommand, scanGitActivity, AutonomyTracker,
} = require('../autonomy_counters.cjs');

// —— classifyGitCommand(纯) ——

test('classifyGitCommand: git commit → commit', () => {
  assert.equal(classifyGitCommand('git commit -m "x"'), 'commit');
});
test('classifyGitCommand: git commit --amend 仍算 commit', () => {
  assert.equal(classifyGitCommand('git commit --amend --no-edit'), 'commit');
});
test('classifyGitCommand: reset --hard → rollback', () => {
  assert.equal(classifyGitCommand('git reset --hard HEAD~1'), 'rollback');
});
test('classifyGitCommand: git revert → rollback', () => {
  assert.equal(classifyGitCommand('git revert HEAD'), 'rollback');
});
test('classifyGitCommand: git rebase → rollback', () => {
  assert.equal(classifyGitCommand('git rebase origin/main'), 'rollback');
});
test('classifyGitCommand: git checkout 切分支不计入(语义模糊)', () => {
  assert.equal(classifyGitCommand('git checkout main'), null);
});
test('classifyGitCommand: 词边界 —— "digit" 等不含 git', () => {
  assert.equal(classifyGitCommand('echo digitter commit'), null);
});
test('classifyGitCommand: 非字符串 / 空 → null', () => {
  assert.equal(classifyGitCommand(undefined), null);
  assert.equal(classifyGitCommand(''), null);
  assert.equal(classifyGitCommand('ls -la'), null);
});
test('classifyGitCommand: 前导空白 / 多空格仍识别', () => {
  assert.equal(classifyGitCommand('  git   commit '), 'commit');
});

// —— extractBashCommand(纯) ——

function bashEvent(cmd, ts, extra) {
  return Object.assign({
    type: 'assistant', timestamp: ts,
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] },
  }, extra || {});
}

test('extractBashCommand: assistant Bash tool_use input.command', () => {
  assert.equal(extractBashCommand(bashEvent('git commit -m x', '2026-07-20T00:00:00Z')), 'git commit -m x');
});
test('extractBashCommand: 兼容 input.input 键名', () => {
  const e = { type: 'assistant', timestamp: 't', message: { content: [{ type: 'tool_use', name: 'Bash', input: { input: 'git revert HEAD' } }] } };
  assert.equal(extractBashCommand(e), 'git revert HEAD');
});
test('extractBashCommand: 非 Bash tool_use → null', () => {
  const e = { type: 'assistant', timestamp: 't', message: { content: [{ type: 'tool_use', name: 'Edit', input: { command: 'git commit' } }] } };
  assert.equal(extractBashCommand(e), null);
});
test('extractBashCommand: user 事件 / 无 message → null', () => {
  assert.equal(extractBashCommand({ type: 'user', timestamp: 't' }), null);
  assert.equal(extractBashCommand(null), null);
});

// —— scanGitActivity(纯,含 sinceTs 去重) ——

test('scanGitActivity: 统计 commit + rollback', () => {
  const events = [
    bashEvent('git commit -m a', '2026-07-20T00:00:01Z'),
    bashEvent('git reset --hard HEAD~1', '2026-07-20T00:00:02Z'),
    bashEvent('git commit -m b', '2026-07-20T00:00:03Z'),
    bashEvent('ls', '2026-07-20T00:00:04Z'),
  ];
  const r = scanGitActivity(events, null);
  assert.equal(r.commits, 2);
  assert.equal(r.rollbacks, 1);
  assert.equal(r.maxTs, Date.parse('2026-07-20T00:00:04Z'));
});

test('scanGitActivity: sinceTs 去重 —— 仅计 ts > sinceTs', () => {
  const t1 = Date.parse('2026-07-20T00:00:01Z');
  const t2 = Date.parse('2026-07-20T00:00:02Z');
  const events = [
    bashEvent('git commit -m a', '2026-07-20T00:00:01Z'),
    bashEvent('git commit -m b', '2026-07-20T00:00:02Z'),
  ];
  const r = scanGitActivity(events, t1); // 跳过 t1,只计 t2
  assert.equal(r.commits, 1);
  assert.equal(r.maxTs, t2);
});

test('scanGitActivity: 无 ts 的事件不计数也不影响 maxTs', () => {
  const events = [
    bashEvent('git commit -m a', '2026-07-20T00:00:01Z'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit' } }] } }, // 无 timestamp
  ];
  const r = scanGitActivity(events, null);
  assert.equal(r.commits, 1);
  assert.equal(r.maxTs, Date.parse('2026-07-20T00:00:01Z'));
});

test('scanGitActivity: 空输入 → 零', () => {
  assert.deepEqual(scanGitActivity([], null), { commits: 0, rollbacks: 0, maxTs: null });
  assert.deepEqual(scanGitActivity(undefined, null), { commits: 0, rollbacks: 0, maxTs: null });
});

// —— AutonomyTracker(DI,内存行为) ——

function makeTracker({ tail = {}, dir = '/d', jsonl = 'a.jsonl' } = {}) {
  // tail: { 'a.jsonl': [events] }
  return new AutonomyTracker({
    readTail: (p) => (tail[p] ? tail[p] : []),
    resolveDir: (cwd) => (cwd ? dir : null),
    pickJsonl: (d) => (Object.keys(tail).length ? jsonl : null),
  });
}

test('AutonomyTracker.recordIntervention 累加 interventions', () => {
  const t = makeTracker();
  t.recordIntervention('s1');
  t.recordIntervention('s1');
  t.recordIntervention('s2');
  const snap = t.snapshot(['s1', 's2', 's3']);
  assert.equal(snap.s1.interventions, 2);
  assert.equal(snap.s2.interventions, 1);
  assert.equal(snap.s3.interventions, 0); // 缺失补零
  assert.equal(snap.s1.commits, 0);
});

test('AutonomyTracker.scanSession 累加 commit/rollback,lastTs 去重防重数', () => {
  const jsonl = 'a.jsonl';
  const t = makeTracker({
    tail: { [jsonl]: [
      bashEvent('git commit -m a', '2026-07-20T00:00:01Z'),
      bashEvent('git reset --hard HEAD~1', '2026-07-20T00:00:02Z'),
    ] },
    jsonl,
  });
  t.scanSession({ name: 's1', cwd: '/p' });
  let snap = t.snapshot(['s1']);
  assert.equal(snap.s1.commits, 1);
  assert.equal(snap.s1.rollbacks, 1);
  // 同样事件再扫一次:lastTs 已推进到 00:00:02,无新增 → 计数不变(去重)
  t.scanSession({ name: 's1', cwd: '/p' });
  snap = t.snapshot(['s1']);
  assert.equal(snap.s1.commits, 1);
  assert.equal(snap.s1.rollbacks, 1);
});

test('AutonomyTracker.scanSession 新事件增量计数(tail 重叠场景)', () => {
  const jsonl = 'a.jsonl';
  let events = [
    bashEvent('git commit -m a', '2026-07-20T00:00:01Z'),
  ];
  // tail 提供一个占位键使 pickJsonl 返回 jsonl;实际读取由 _readTail 闭包动态返回(模拟追加)
  const t = makeTracker({ tail: { [jsonl]: [] }, jsonl });
  t._readTail = () => events;
  t.scanSession({ name: 's1', cwd: '/p' });
  assert.equal(t.snapshot(['s1']).s1.commits, 1);
  events = [
    bashEvent('git commit -m a', '2026-07-20T00:00:01Z'), // 旧(重叠)
    bashEvent('git commit -m b', '2026-07-20T00:00:02Z'), // 新
  ];
  t.scanSession({ name: 's1', cwd: '/p' });
  assert.equal(t.snapshot(['s1']).s1.commits, 2); // 只 +1
});

test('AutonomyTracker.scanSession 无 cwd / 无 dir / 无 jsonl → 静默不抛不计数', () => {
  const t = new AutonomyTracker({
    readTail: () => { throw new Error('should not read'); },
    resolveDir: () => null,
    pickJsonl: () => null,
  });
  t.scanSession({ name: 's1' }); // 无 cwd
  t.scanSession({ name: 's1', cwd: '/p' }); // resolveDir → null
  assert.equal(t.snapshot(['s1']).s1.commits, 0);
});

test('AutonomyTracker.scanSession 读取异常 → 静默,既有计数不归零', () => {
  const jsonl = 'a.jsonl';
  const t = makeTracker({
    tail: { [jsonl]: [bashEvent('git commit -m a', '2026-07-20T00:00:01Z')] }, jsonl,
  });
  t.scanSession({ name: 's1', cwd: '/p' });
  assert.equal(t.snapshot(['s1']).s1.commits, 1);
  // 让 readTail 抛错:计数必须保持,不抛
  t._readTail = () => { throw new Error('io'); };
  t.scanSession({ name: 's1', cwd: '/p' });
  assert.equal(t.snapshot(['s1']).s1.commits, 1);
});

test('AutonomyTracker.tick 批量 + retain 清理', () => {
  const jsonl = 'a.jsonl';
  const t = makeTracker({
    tail: { [jsonl]: [bashEvent('git commit -m a', '2026-07-20T00:00:01Z')] }, jsonl,
  });
  t.tick([{ name: 's1', cwd: '/p' }, { name: 's2', cwd: '/p' }]);
  assert.equal(t.snapshot(['s1', 's2']).s2.commits, 1);
  t.retain(['s1']); // s2 被清理
  assert.equal(t.snapshot(['s2']).s2.commits, 0);
  assert.equal(t.snapshot(['s1']).s1.commits, 1);
});

test('AutonomyTracker.snapshot 只返回请求的会话(不外泄其它)', () => {
  const t = makeTracker();
  t.recordIntervention('hidden');
  const snap = t.snapshot(['s1']);
  assert.deepEqual(Object.keys(snap), ['s1']);
  assert.equal(snap.s1.interventions, 0);
});
