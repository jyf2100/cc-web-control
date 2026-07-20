'use strict';

// Agent 任务生命周期状态机(纯函数,无 fs/副作用)。
//
// 参考 WorkBuddy Lite 的 6 状态范式,为 cc-web-control hub 聚合看板提供统一的 Agent
// 任务状态语义。与单机既有的 dashboard 状态(waiting/working/idle/errored/unknown,由
// jsonl 末尾事件推断)是两层不同的概念:本模块是「显式任务生命周期」,由上报/命令驱动;
// 后者是「会话活跃度推断」。两者并存,互不替代。
//
// 6 状态(STATES):
//   queued             已入队,等待规划/运行
//   planning           规划中
//   running            运行中
//   pending_approval   待审批(工具调用 / 关键决策)
//   completed          已完成(终态)
//   failed             已失败(可经 retry 回 queued)
//
// 9 迁移事件(TRANSITIONS),每项 { from, to }:
//   from: null  → 仅作为「新建」迁移(无前置状态,如 enqueue 创建一个全新 agent)
//   from: [...] → 合法前置状态集合;当前状态不在其中 → 非法迁移(AC8 拒绝)
//
// 设计要点:
//   - 纯函数,易测;所有副作用(写事件日志、改状态)在 agent_state_store.cjs 内。
//   - immutability:applyTransition 不改入参,返回 { ok, to } 或 { ok:false, code, error }。

const STATES = Object.freeze([
  'queued',
  'planning',
  'running',
  'pending_approval',
  'completed',
  'failed',
]);

// from: null 表示「无前置状态」(仅 enqueue 这种创建型迁移用)。
// completed 为终态:无任何事件的 from 包含它 → 终态不可迁出(除新建一个同名 agent 外)。
// failed 仅可经 retry 回 queued(fail 终态的「自愈」出口)。
const TRANSITIONS = Object.freeze({
  enqueue:          { from: null,                                                to: 'queued' },
  start_plan:       { from: ['queued'],                                          to: 'planning' },
  plan_done:        { from: ['planning'],                                        to: 'running' },
  request_approval: { from: ['running'],                                         to: 'pending_approval' },
  approve:          { from: ['pending_approval'],                                to: 'running' },
  deny:             { from: ['pending_approval'],                                to: 'failed' },
  complete:         { from: ['running', 'planning'],                             to: 'completed' },
  fail:             { from: ['queued', 'planning', 'running', 'pending_approval'], to: 'failed' },
  retry:            { from: ['failed'],                                          to: 'queued' },
});

function isValidState(s) {
  return typeof s === 'string' && STATES.indexOf(s) >= 0;
}

function isValidEvent(e) {
  return typeof e === 'string' && Object.prototype.hasOwnProperty.call(TRANSITIONS, e);
}

// 当前状态是否可经 event 迁移。fromState == null 表示「尚不存在」(用于 enqueue)。
function canTransition(fromState, event) {
  const t = TRANSITIONS[event];
  if (!t) return false;
  if (t.from === null) return fromState == null;
  return Array.isArray(t.from) && t.from.indexOf(fromState) >= 0;
}

// 返回 { ok:true, to } 或 { ok:false, code, error }(不改入参)。
// code ∈ 'invalid event' | 'illegal transition'(调用方可据此决定 HTTP 状态码)。
function applyTransition(fromState, event) {
  const t = TRANSITIONS[event];
  if (!t) {
    return { ok: false, code: 'invalid event', error: `invalid event "${event}"` };
  }
  if (!canTransition(fromState, event)) {
    const fromLabel = fromState == null ? '<none>' : fromState;
    return { ok: false, code: 'illegal transition', error: `illegal transition: ${event} from ${fromLabel}` };
  }
  return { ok: true, to: t.to };
}

module.exports = {
  STATES,
  TRANSITIONS,
  isValidState,
  isValidEvent,
  canTransition,
  applyTransition,
};
