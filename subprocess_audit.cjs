'use strict';

// Claude Code 子进程 spawn 级审计 —— 每次 start/stop/restart 落一条结构化 JSONL。
// 背景:被托管对象(Claude Code)有不可审计的高权限 client 端行为,host 侧须为每次
// spawn/stop 子进程动作留可观测痕迹,让用户能在 hub 看板回溯「哪台机、何时、用什么命令
// 启动了 Claude Code、退出码多少」。本 PR 只到 spawn 级别,不到输入/输出内容级别。
//
// 落盘:<state-dir>/audit/cc-subprocess.jsonl。schema 校验严格(验收 B6/B7):
// 非法条目拒绝写入主文件,改落 audit-write-errors.log,绝不污染主 JSONL。
// 范式:纯函数 validateEntry + DI(fsImpl/now),便于测试不碰真实磁盘/时钟。

const fs = require('fs');
const path = require('path');

const ACTIONS = new Set(['start', 'stop', 'restart']);

function isIsoTs(v) {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
}
function isAbsPath(v) {
  return typeof v === 'string' && path.isAbsolute(v) && !/[\r\n]/.test(v);
}
function isIntOrNull(v) {
  return v === null || (Number.isInteger(v) && v >= 0);
}

// 校验单条 entry。返回 { ok:true } 或 { ok:false, error }。
function validateEntry(e) {
  if (!e || typeof e !== 'object') return { ok: false, error: 'entry must be an object' };
  if (!isIsoTs(e.ts)) return { ok: false, error: 'ts must be an ISO8601 string' };
  if (typeof e.host !== 'string' || !e.host) return { ok: false, error: 'host must be a non-empty string' };
  if (typeof e.instance_id !== 'string' || !e.instance_id) return { ok: false, error: 'instance_id must be a non-empty string' };
  if (!ACTIONS.has(e.action)) return { ok: false, error: `action must be one of start|stop|restart, got ${JSON.stringify(e.action)}` };
  if (typeof e.cmd !== 'string') return { ok: false, error: 'cmd must be a string' };
  if (!isAbsPath(e.cwd)) return { ok: false, error: 'cwd must be an absolute path' };
  if (e.exit_code !== null && !(Number.isInteger(e.exit_code) && e.exit_code >= 0 && e.exit_code <= 255)) {
    return { ok: false, error: 'exit_code must be null or an integer 0-255' };
  }
  // start → exit_code/duration_ms 均为 null;stop/restart → 均为非空整数
  if (e.action === 'start') {
    if (e.exit_code !== null) return { ok: false, error: 'exit_code must be null for start' };
    if (e.duration_ms !== null) return { ok: false, error: 'duration_ms must be null for start' };
  } else {
    if (e.exit_code === null) return { ok: false, error: `exit_code required (integer) for ${e.action}` };
    if (!isIntOrNull(e.duration_ms) || e.duration_ms === null) {
      return { ok: false, error: `duration_ms must be a non-negative integer for ${e.action}` };
    }
  }
  return { ok: true };
}

// 默认 now:UTC ISO。可注入固定时间戳便于测试。
const defaultNow = () => new Date().toISOString();

class SubprocessAudit {
  /**
   * @param {{filePath:string, errorLogPath:string, host:string, instanceId:string,
   *          now?:()=>string, fsImpl?:object}} opts
   */
  constructor({ filePath, errorLogPath, host, instanceId, now, fsImpl }) {
    if (!filePath) throw new Error('SubprocessAudit: filePath required');
    if (!errorLogPath) throw new Error('SubprocessAudit: errorLogPath required');
    if (typeof host !== 'string' || !host) throw new Error('SubprocessAudit: host required');
    if (typeof instanceId !== 'string' || !instanceId) throw new Error('SubprocessAudit: instanceId required');
    this.filePath = filePath;
    this.errorLogPath = errorLogPath;
    this.host = host;
    this.instanceId = instanceId;
    this._now = typeof now === 'function' ? now : defaultNow;
    this._fs = fsImpl || fs; // 须提供 promises.{mkdir,appendFile,readFile}
    // 内存态:sessionName → { tsIso, cmd, cwd },用于 stop/restart 算 duration、回填 cmd/cwd
    this._active = new Map();
  }

  // 内部:校验 + 追加主文件。非法 → 落 errorLog,返回 false。
  async _append(entry) {
    const v = validateEntry(entry);
    if (!v.ok) {
      await this._writeError({ entry, error: v.error });
      return false;
    }
    await this._appendLine(this.filePath, entry);
    return true;
  }

  async _appendLine(file, obj) {
    const line = JSON.stringify(obj) + '\n';
    await this._fs.promises.mkdir(path.dirname(file), { recursive: true });
    await this._fs.promises.appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
  }

  async _writeError({ entry, error }) {
    const rec = { ts: this._now(), error, rejected: entry };
    try {
      await this._appendLine(this.errorLogPath, rec);
    } catch {
      /* errorLog 写失败不阻断主流程(尽力留痕) */
    }
  }

  /** start:记录 claude 启动。cmd/cwd 来自实际 spawn;记 start 时间用于后续 stop 配对。 */
  async recordStart({ sessionName, cmd, cwd }) {
    const ts = this._now();
    this._active.set(sessionName, { ts, cmd, cwd });
    return this._append({
      ts, host: this.host, instance_id: this.instanceId, action: 'start',
      cmd, cwd, exit_code: null, duration_ms: null,
    });
  }

  /** stop:与同名 session 的 start 配对,算 duration_ms;exitCode 来自调用方(tmux)。 */
  async recordStop({ sessionName, exitCode }) {
    const ts = this._now();
    const a = this._active.get(sessionName);
    const cmd = a ? a.cmd : '';
    const cwd = a ? a.cwd : '';
    let duration_ms = null;
    if (a) {
      const d = Date.parse(ts) - Date.parse(a.ts);
      if (Number.isFinite(d) && d >= 0) duration_ms = d;
    }
    this._active.delete(sessionName);
    return this._append({
      ts, host: this.host, instance_id: this.instanceId, action: 'stop',
      cmd, cwd, exit_code: exitCode, duration_ms,
    });
  }

  /** restart:stop+start 复合语义,记一条;duration 取当前 active(若有)。 */
  async recordRestart({ sessionName, exitCode }) {
    const ts = this._now();
    const a = this._active.get(sessionName);
    const cmd = a ? a.cmd : '';
    const cwd = a ? a.cwd : '';
    let duration_ms = null;
    if (a) {
      const d = Date.parse(ts) - Date.parse(a.ts);
      if (Number.isFinite(d) && d >= 0) duration_ms = d;
    }
    // restart 后视为新一轮活跃(重置 start 时间)
    this._active.set(sessionName, { ts, cmd, cwd });
    return this._append({
      ts, host: this.host, instance_id: this.instanceId, action: 'restart',
      cmd, cwd, exit_code: exitCode, duration_ms,
    });
  }

  /** 直接写一条原始 entry(schema 校验生效);供测试与高级调用方使用。 */
  async recordRaw(entry) {
    return this._append(entry);
  }

  /** 读最近 limit 条(尾部),按文件顺序(旧→新)。失败 → []。 */
  async readRecent(limit = 50) {
    let text;
    try {
      text = await this._fs.promises.readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }
    const lines = text.split('\n').filter((l) => l.trim());
    const n = Math.max(0, Number(limit) || 0);
    const tail = n > 0 ? lines.slice(-n) : lines;
    const out = [];
    for (const l of tail) {
      try { out.push(JSON.parse(l)); } catch { /* 跳过畸形行,不抛 */ }
    }
    return out;
  }
}

module.exports = { SubprocessAudit, validateEntry, ACTIONS };
