'use strict';
// trajectory_scan.cjs 单测:验收 1(合法/非法文件、消息计数、字段)、3(根目录不存在)、
// 4(超限护栏)。用真实 fs + tmpdir(扫描本就是纯读盘函数,DI fsImpl 主要供注入 log)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  scanTrajectories,
  parseTrajectoryText,
  extractUserText,
  DEFAULT_OVERSIZE_BYTES,
  SUMMARY_MAX_CHARS,
} = require('../trajectory_scan.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'traj-scan-'));
}

function writeJsonl(dir, name, lines, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', opts);
  return file;
}

const U = (text) => ({ type: 'user', message: { role: 'user', content: text }, timestamp: '2026-08-19T00:00:00.000Z' });
const UB = (blocks) => ({ type: 'user', message: { role: 'user', content: blocks } });
const A = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const OTHER = () => ({ type: 'summary', summary: 'x' }); // 非 user/assistant 行:不计入消息数

test('验收1:3 个合法 .jsonl + 1 个含非法 JSON 行的文件 → 3 条记录 + skipped=1', () => {
  const root = tmpRoot();
  try {
    writeJsonl(path.join(root, 'proj-a'), 'aaa.jsonl', [U('帮我写个排序'), A('好的'), U('改成降序'), A('完成'), OTHER()]);
    writeJsonl(path.join(root, 'proj-a'), 'bbb.jsonl', [U('你好'), A('嗨')]);
    writeJsonl(path.join(root, 'proj-b'), 'ccc.jsonl', [A('先说话的助手')]);
    writeJsonl(path.join(root, 'proj-b'), 'broken.jsonl', [U('ok'), '{ not valid json !!!']);

    const r = scanTrajectories({ rootDir: root });

    assert.equal(r.trajectories.length, 3, `应 3 条,实际 ${r.trajectories.length}`);
    assert.equal(r.skipped, 1);
    assert.ok(!r.trajectories.some((t) => t.sessionId === 'broken'), '损坏文件不入清单');

    const byId = new Map(r.trajectories.map((t) => [t.sessionId, t]));
    const aaa = byId.get('aaa');
    assert.equal(aaa.path, path.join(root, 'proj-a', 'aaa.jsonl'), '绝对路径');
    assert.ok(Number.isFinite(aaa.size) && aaa.size > 0, '大小');
    assert.ok(Number.isFinite(aaa.mtime) && aaa.mtime > 0, 'mtime');
    assert.equal(aaa.messages, 4, 'user/assistant 行数(user2+assistant2,summary 行不计)');
    assert.equal(aaa.firstUserSummary, '帮我写个排序');
    assert.equal(aaa.oversize, false);
    const bbb = byId.get('bbb');
    assert.equal(bbb.messages, 2);
    const ccc = byId.get('ccc');
    assert.equal(ccc.messages, 1, '仅 assistant 也计 1');
    assert.equal(ccc.firstUserSummary, null, '无 user 行 → 摘要 null');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('验收1 补充:首条 user 为 tool_result(无文本)时跳到下一个有文本的 user', () => {
  const root = tmpRoot();
  try {
    writeJsonl(path.join(root, 'p'), 's.jsonl', [
      UB([{ type: 'tool_result', content: 'raw' }]),
      A('中间回复'),
      UB([{ type: 'text', text: '真正的提问' }]),
    ]);
    const r = scanTrajectories({ rootDir: root });
    assert.equal(r.trajectories[0].firstUserSummary, '真正的提问');
    assert.equal(r.trajectories[0].messages, 3, 'user(含 tool_result)+assistant+user 均计入');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('摘要截断:超过 200 字符截为 200;空白折叠', () => {
  const long = 'x'.repeat(500);
  assert.equal(parseTrajectoryText(JSON.stringify(U(long)) + '\n').firstUserSummary.length, SUMMARY_MAX_CHARS);
  assert.equal(extractUserText(UB([{ type: 'text', text: ' a \n b ' }, { type: 'text', text: ' c' }])), 'a b c');
});

test('验收3:根目录不存在 → 空清单 + warning 日志,不 throw', () => {
  const warnings = [];
  const r = scanTrajectories({
    rootDir: path.join(os.tmpdir(), 'traj-not-exist-xyz'),
    log: { warn: (m) => warnings.push(m) },
  });
  assert.deepEqual(r.trajectories, []);
  assert.equal(r.skipped, 0);
  assert.ok(r.warning && r.warning.includes('不存在'), '结果应携带 warning 字段');
  assert.equal(warnings.length, 1, '应打一条 warning 日志');
});

test('验收4:单文件 > oversizeBytes → 不解析,入清单标记 oversize、messages=null', () => {
  const root = tmpRoot();
  try {
    writeJsonl(path.join(root, 'p'), 'big.jsonl', [U('q'), A('a')]);
    const r = scanTrajectories({ rootDir: root, oversizeBytes: 10 }); // 文件必然 >10 字节
    assert.equal(r.trajectories.length, 1);
    const big = r.trajectories[0];
    assert.equal(big.oversize, true);
    assert.equal(big.messages, null, '超限不逐行解析');
    assert.equal(big.firstUserSummary, null);
    assert.ok(Number.isFinite(big.size) && big.size > 10, 'size 仍如实上报');
    assert.equal(r.skipped, 0, '超限 ≠ 损坏,不计 skipped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('排序:mtime 降序;默认超限阈值 = 50MB', () => {
  const root = tmpRoot();
  try {
    const f1 = writeJsonl(path.join(root, 'p'), 'old.jsonl', [U('old')]);
    const f2 = writeJsonl(path.join(root, 'p'), 'new.jsonl', [U('new')]);
    const past = new Date(Date.now() - 86400_000).getTime();
    fs.utimesSync(f1, new Date(past), new Date(past)); // 传 Date(本环境传裸 ms 数值 utimes 会得到错值)
    fs.utimesSync(f2, new Date(), new Date());
    const r = scanTrajectories({ rootDir: root });
    assert.equal(r.trajectories[0].sessionId, 'new');
    assert.equal(r.trajectories[1].sessionId, 'old');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(DEFAULT_OVERSIZE_BYTES, 50 * 1024 * 1024);
});

test('验收2(性能烟测):100 个 .jsonl 扫描 + 元数据提取远低于 10s', () => {
  const root = tmpRoot();
  try {
    for (let i = 0; i < 100; i++) {
      const lines = [];
      for (let j = 0; j < 20; j++) lines.push(U(`msg ${i}-${j} ` + 'y'.repeat(50)), A('ok'));
      writeJsonl(path.join(root, `proj-${i % 5}`), `s${i}.jsonl`, lines);
    }
    const t0 = Date.now();
    const r = scanTrajectories({ rootDir: root });
    const cost = Date.now() - t0;
    assert.equal(r.trajectories.length, 100);
    assert.ok(r.trajectories.every((t) => t.messages === 40));
    assert.ok(cost < 10_000, `100 文件扫描耗时 ${cost}ms 应 < 10s`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('空行/纯空白行不视为损坏(尾部换行常态)', () => {
  const p = parseTrajectoryText(JSON.stringify(U('hi')) + '\n\n   \n');
  assert.equal(p.messages, 1);
});
