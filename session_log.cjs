'use strict';

// 单机会话续聊落盘(JSON Lines)。
//
// 用途:把 agent 的对话(user / assistant 轮次)以 JSONL 追加落盘,进程重启后可读回
//   → 单机据此向 hub 上报 messageCount(hub 看板显示「对话条数」,AC5)。
//
// 格式(每行一条 JSON,换行分隔):
//   { "ts": <number ms>, "agent_id": "<string>", "role": "user"|"assistant", "content": "<string>" }
//
// 校验(AC6):readAll 逐行解析,损坏行(JSON 解析失败 / schema 不符)→ 记入 errors
//   (含 line 行号 + 可恢复的 agent_id + 错误描述 + 原文片段),跳过该行,不影响其它记录
//   与其它 agent 的加载。文件不存在 → 视作空(ENOENT 返回空,非错误)。
//
// 纯依赖注入:fsImpl(默认 node:fs),测试用内存 fake fs,不碰真实磁盘/网络。

const fs = require('node:fs');

const VALID_ROLES = Object.freeze(['user', 'assistant']);

// 单条记录的 schema 校验,返回错误描述字符串或 null(合法)。
function validateRecord(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'record not an object';
  if (typeof obj.agent_id !== 'string' || !obj.agent_id) return 'missing agent_id';
  if (!VALID_ROLES.includes(obj.role)) return `invalid role "${obj.role}"`;
  if (typeof obj.ts !== 'number' || !Number.isFinite(obj.ts)) return 'ts must be a finite number';
  return null;
}

class SessionLog {
  constructor({ filePath, fsImpl = fs } = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('SessionLog: filePath required');
    }
    this._path = filePath;
    this._fs = fsImpl;
  }

  // 追加一条对话记录。agent_id 必填;role ∈ user|assistant;content 缺省 ''。
  // ts 缺省 Date.now()。返回写入的记录对象(含归一化字段)。
  append({ agent_id, role, content, ts } = {}) {
    if (!agent_id || typeof agent_id !== 'string') {
      throw new Error('SessionLog.append: agent_id required');
    }
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`SessionLog.append: invalid role "${role}" (allowed: ${VALID_ROLES.join(', ')})`);
    }
    const record = {
      ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now(),
      agent_id,
      role,
      content: content == null ? '' : String(content),
    };
    this._fs.appendFileSync(this._path, JSON.stringify(record) + '\n');
    return record;
  }

  // 读全部记录。返回 { records:[...], errors:[...] }。
  // 损坏行 → errors(含 line/agent_id/error/raw),跳过;合法行 → records(AC6)。
  // 文件不存在 → { records:[], errors:[] }(空会话,非异常)。
  readAll() {
    let text;
    try {
      text = this._fs.readFileSync(this._path, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return { records: [], errors: [] };
      throw e;
    }
    const records = [];
    const errors = [];
    // 按行切分;末尾 '\n' 会产生一个空串,空串一律跳过(非错误)。
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === '') continue;
      const lineNo = i + 1;
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        errors.push({ line: lineNo, agent_id: null, error: 'JSON parse failed', raw: raw.slice(0, 120) });
        continue;
      }
      const schemaErr = validateRecord(obj);
      if (schemaErr) {
        // schema 不符但可解析 → 尽力提取 agent_id 供定位(AC6:含 agent_id)。
        errors.push({
          line: lineNo,
          agent_id: (obj && typeof obj.agent_id === 'string') ? obj.agent_id : null,
          error: schemaErr,
          raw: raw.slice(0, 120),
        });
        continue;
      }
      records.push(obj);
    }
    return { records, errors };
  }

  // 合法记录条数(AC5:重启后读出 ≥2 即恢复成功)。
  count() {
    return this.readAll().records.length;
  }

  // 指定 agent 的记录(单文件多 agent 场景按 agent_id 过滤)。
  readAgent(agent_id) {
    const { records } = this.readAll();
    return records.filter((r) => r.agent_id === agent_id);
  }

  // 指定 agent 的合法记录条数。
  countAgent(agent_id) {
    return this.readAgent(agent_id).length;
  }
}

module.exports = { SessionLog, VALID_ROLES, validateRecord };
