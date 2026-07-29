'use strict';

/**
 * Claude Code 会话结构化状态机(纯函数 + 内存 tracker,无 fs/网络副作用)。
 *
 * 设计动机(PRD:hub 暴露 Claude Code 会话结构化状态机):
 *   SearchOS 把 agent 状态做成「可调度基础设施」。借鉴之,把 hub 对每个被控 Claude Code
 *   会话的可见性从「看 tmux 文本」升级为「看结构化状态字段」。本模块定义一组规范的会话
 *   状态枚举,并把单机既有的 jsonl 推断结果(dashboard_parse.cjs 的 waiting/working/idle/
 *   errored/unknown)归一成这组规范枚举,供 hub 聚合看板程序化查询 / 过滤 / 调度前提。
 *
 * 与 agent_lifecycle.cjs(6 状态「显式任务生命周期」,由上报/命令驱动)是两层不同概念:
 *   - 本模块 = 「会话当前在干什么」的活跃度推断(由 jsonl 末尾事件派生),4 状态;
 *   - agent_lifecycle = 「任务进度」的命令式状态机,6 状态。两者并存,互不替代。
 *
 * 4 状态(SESSION_STATES):
 *   idle             空闲(无进行中任务 / 无可读事件)
 *   running          正在生成 / 执行(tool_use 自主循环 / 用户刚发尚未结束)
 *   awaiting-input   等待用户输入(最后 assistant 事件 stop_reason == 'end_turn')
 *   error            出错(最后事件含 error / isApiErrorMessage)
 *
 * 关键不变量(AC1):归一结果恒属这四者之一,绝不返回 null/undefined/unknown。
 *
 * 纯函数 + 依赖注入:nowFn(默认 Date.now,测试注入确定性时钟)。
 * immutability:StateTracker 内部以新对象替换 Map 条目;observe 返回新对象。
 */

// 规范会话状态枚举(frozen)。注意 'awaiting-input' 含连字符,与 PRD 字面一致。
const SESSION_STATES = Object.freeze(['idle', 'running', 'awaiting-input', 'error']);

// dashboard_parse.cjs 推断状态 → 规范会话状态。unknown 归 idle(无活动证据,非异常)。
const STATUS_TO_STATE = Object.freeze({
  working: 'running',
  waiting: 'awaiting-input',
  errored: 'error',
  idle: 'idle',
  unknown: 'idle',
});

function isValidState(s) {
  return typeof s === 'string' && SESSION_STATES.indexOf(s) >= 0;
}

// 把任意推断状态(或规范状态自身)归一为 4 枚举之一。未知/缺失 → idle(满足 AC1:绝不 null)。
function normalizeState(inferred) {
  const mapped = STATUS_TO_STATE[inferred];
  if (mapped) return mapped;
  // 已经是规范状态(防御:上游直接传规范值)→ 直通
  if (isValidState(inferred)) return inferred;
  return 'idle';
}

// per-key {state, changedAt} 跟踪器:状态变化时刷新 changedAt,否则保留(AC5:最近变更时间)。
// key 语义:单机维度为 session 名;hub 维度为 `${machine}/${session}`。
class StateTracker {
  constructor({ nowFn = Date.now } = {}) {
    this._now = nowFn;
    this._map = new Map(); // key -> { state, changedAt }
  }

  // 记录某 key 观察到的推断状态,返回 { state, changedAt }(新对象)。
  // nowMs 可选(默认 nowFn()):供调用方对齐刷新周期时钟(测试注入确定性)。
  observe(key, inferredStatus, nowMs) {
    const state = normalizeState(inferredStatus);
    const now = typeof nowMs === 'number' ? nowMs : this._now();
    const prev = this._map.get(key);
    // 状态变化(或首次观察)→ changedAt = now;否则沿用上次的 changedAt。
    const changedAt = (!prev || prev.state !== state) ? now : prev.changedAt;
    const rec = { state, changedAt };
    this._map.set(key, rec);
    return { state, changedAt };
  }

  get(key) {
    const r = this._map.get(key);
    return r ? { state: r.state, changedAt: r.changedAt } : undefined;
  }

  // 清理不在 keys 集合中的条目(会话消失)。keys 为名字数组。
  retain(keys) {
    const keep = new Set(keys || []);
    for (const k of [...this._map.keys()]) {
      if (!keep.has(k)) this._map.delete(k);
    }
  }

  clear() { this._map.clear(); }
}

// 过滤参数非法时抛出(对齐 sessions_query.cjs 的 InvalidCliToolError 风格)。
class InvalidStatusError extends Error {
  constructor(value) {
    super(`invalid status "${value}"; allowed: ${SESSION_STATES.join(', ')}`);
    this.name = 'InvalidStatusError';
    this.allowed = SESSION_STATES.slice();
    this.code = 'INVALID_STATUS';
  }
}

module.exports = {
  SESSION_STATES,
  STATUS_TO_STATE,
  isValidState,
  normalizeState,
  StateTracker,
  InvalidStatusError,
};
