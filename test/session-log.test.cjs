'use strict';
// 单元:session_log.cjs —— AC5(落盘 + 重启恢复)、AC6(损坏行可校验,不影响其它)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SessionLog, validateRecord, VALID_ROLES } = require('../session_log.cjs');

// 内存 fake fs(依赖注入):避免真实磁盘 IO,精确控制内容。
function memFs(initial = '') {
  const files = new Map();
  if (initial !== null) files.set('__p__', initial);
  return {
    _files: files,
    readFileSync(p) {
      if (!files.has(p)) {
        const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
      }
      return files.get(p);
    },
    appendFileSync(p, data) { files.set(p, (files.get(p) || '') + data); },
    _set(p, v) { files.set(p, v); },
  };
}

test('VALID_ROLES = user|assistant', () => {
  assert.deepEqual([...VALID_ROLES], ['user', 'assistant']);
});

test('validateRecord: 合法记录返回 null,缺字段/类型错返回描述', () => {
  assert.equal(validateRecord({ agent_id: 'a', role: 'user', ts: 1, content: 'x' }), null);
  assert.match(validateRecord(null), /not an object/);
  assert.match(validateRecord({ role: 'user', ts: 1 }), /missing agent_id/);
  assert.match(validateRecord({ agent_id: 'a', role: 'sys', ts: 1 }), /invalid role/);
  assert.match(validateRecord({ agent_id: 'a', role: 'user', ts: 'x' }), /ts must be/);
});

// AC5:≥1 user + ≥1 assistant → 落盘 ≥2 条;重启(重读)→ 条数 ≥2。
test('AC5: 1 user + 1 assistant 落盘 → count 2;重读(模拟重启)→ 仍 2', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-'));
  const file = path.join(tmp, 'a1.jsonl');
  // 单机运行期:追加 2 条
  const running = new SessionLog({ filePath: file });
  running.append({ agent_id: 'a1', role: 'user', content: 'hello', ts: 1 });
  running.append({ agent_id: 'a1', role: 'assistant', content: 'hi there', ts: 2 });
  assert.equal(running.count(), 2);
  // 重启:新实例从同一文件读回(不删除落盘)
  const restarted = new SessionLog({ filePath: file });
  assert.equal(restarted.count(), 2);
  const { records } = restarted.readAll();
  assert.equal(records[0].role, 'user');
  assert.equal(records[1].role, 'assistant');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('AC5 联动: messageCount = count() 可上报 hub(hub 看板显示对话条数 ≥2)', () => {
  const mfs = memFs('');
  const sl = new SessionLog({ filePath: '/a.jsonl', fsImpl: mfs });
  sl.append({ agent_id: 'a1', role: 'user', content: 'q', ts: 1 });
  sl.append({ agent_id: 'a1', role: 'assistant', content: 'a', ts: 2 });
  sl.append({ agent_id: 'a1', role: 'user', content: 'q2', ts: 3 });
  // 单机重启后:count() 即可上报的 messageCount
  const restarted = new SessionLog({ filePath: '/a.jsonl', fsImpl: mfs });
  assert.ok(restarted.count() >= 2);
});

// AC6:文件损坏行 → 明确错误(含行号 + 可恢复的 agent_id),不影响其它行/其它 agent。
test('AC6: 损坏 JSON 行 → errors 含行号,合法行仍读出', () => {
  const mfs = memFs('');
  mfs._set('/a.jsonl', [
    JSON.stringify({ agent_id: 'a1', role: 'user', ts: 1, content: 'ok1' }),
    '{ this is not valid json }}}',
    JSON.stringify({ agent_id: 'a1', role: 'assistant', ts: 2, content: 'ok2' }),
  ].join('\n') + '\n');
  const sl = new SessionLog({ filePath: '/a.jsonl', fsImpl: mfs });
  const { records, errors } = sl.readAll();
  // 合法 2 行照常读出
  assert.equal(records.length, 2);
  assert.equal(records[0].content, 'ok1');
  assert.equal(records[1].content, 'ok2');
  // 损坏行进 errors,含行号(第 2 行)
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
  assert.match(errors[0].error, /JSON parse failed/);
});

// AC6:可解析但 schema 不符 → errors 含 agent_id(尽力恢复)+ 行号。
test('AC6: schema 不符(非法 role)→ errors 含 agent_id + 行号', () => {
  const mfs = memFs('');
  mfs._set('/a.jsonl', [
    JSON.stringify({ agent_id: 'a1', role: 'user', ts: 1, content: 'ok' }),
    JSON.stringify({ agent_id: 'a1', role: 'system', ts: 2, content: 'bad role' }), // 非法 role
    JSON.stringify({ agent_id: 'a2', role: 'user', ts: 3, content: 'other agent ok' }),
  ].join('\n') + '\n');
  const sl = new SessionLog({ filePath: '/a.jsonl', fsImpl: mfs });
  const { records, errors } = sl.readAll();
  assert.equal(records.length, 2); // 合法 2 行(a1 user + a2 user)
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
  assert.equal(errors[0].agent_id, 'a1'); // 可恢复出 agent_id(AC6:含 agent_id)
  assert.match(errors[0].error, /invalid role/);
});

// AC6:某 agent 的损坏行不影响其它 agent 加载(按 agent_id 过滤)。
test('AC6: 单 agent 损坏不影响其它 agent 加载', () => {
  const mfs = memFs('');
  mfs._set('/shared.jsonl', [
    JSON.stringify({ agent_id: 'aX', role: 'user', ts: 1, content: 'x' }),
    'CORRUPT_LINE_FOR_aX',
    JSON.stringify({ agent_id: 'aY', role: 'assistant', ts: 2, content: 'y1' }),
    JSON.stringify({ agent_id: 'aY', role: 'user', ts: 3, content: 'y2' }),
  ].join('\n') + '\n');
  const sl = new SessionLog({ filePath: '/shared.jsonl', fsImpl: mfs });
  // aY 不受 aX 的损坏行影响,照常读出 2 条
  assert.equal(sl.countAgent('aY'), 2);
  // aX 仅 1 条合法(损坏行被跳过)
  assert.equal(sl.countAgent('aX'), 1);
  const { errors } = sl.readAll();
  assert.equal(errors.length, 1);
});

// 文件不存在 → 空会话(非异常),新建 agent 首次落盘前的常态。
test('文件不存在 → readAll 返回空(ENOENT 非异常)', () => {
  const sl = new SessionLog({ filePath: '/none.jsonl', fsImpl: memFs(null) });
  const { records, errors } = sl.readAll();
  assert.deepEqual(records, []);
  assert.deepEqual(errors, []);
  assert.equal(sl.count(), 0);
});

// append 拒绝非法 role / 缺 agent_id(防脏数据落盘)。
test('append 拒绝非法 role / 缺 agent_id', () => {
  const sl = new SessionLog({ filePath: '/a.jsonl', fsImpl: memFs('') });
  assert.throws(() => sl.append({ agent_id: 'a1', role: 'system', content: 'x' }), /invalid role/);
  assert.throws(() => sl.append({ role: 'user', content: 'x' }), /agent_id required/);
});

// ts 缺省 → Date.now()(数值类型)。
test('append 缺省 ts → 数值时间戳', () => {
  const sl = new SessionLog({ filePath: '/a.jsonl', fsImpl: memFs('') });
  const rec = sl.append({ agent_id: 'a1', role: 'user', content: 'x' });
  assert.equal(typeof rec.ts, 'number');
  assert.ok(rec.ts > 0);
});
