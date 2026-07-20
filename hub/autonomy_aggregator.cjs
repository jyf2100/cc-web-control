'use strict';

/**
 * hub 侧 autonomy 增量检测:从各单机上报的单调计数器算出「新增事件」,落进 AutonomyStore。
 *
 * 数据流:
 *   每 2s,DashboardAggregator 拉各机 /api/dashboard → onResult(results) 回调
 *     → summarizeResults(results) 把每机每会话 autonomy 计数聚合成 {machineId: {commit,rollback,intervention}}
 *     → AutonomyAggregator.ingest(sums, nowMs) 用 computeDeltas 对比上次,正增量落成事件存入 store。
 *
 * 单机计数器单调递增(单机重启会归零 → 视作 reset,见 computeDeltas)。事件 ts 用「本次轮询时刻」
 * (2s 量级精度,满足验收 5s 内计入的要求)。
 *
 * 纯函数 computeDeltas / summarizeResults 无副作用、可独立测试;AutonomyAggregator 类持有状态。
 */

const TYPES = ['commit', 'rollback', 'intervention'];

/**
 * 把单机 /api/dashboard payload 的每会话 autonomy 求和成单机级计数。
 * payload.sessions[].autonomy = {commit, rollback, interventions?}
 *   注:单机字段名 interventions(复数,与计数语义一致);这里统一映射成 intervention。
 * 返回 {commit, rollback, intervention} 或 null(payload 无 autonomy 数据 → 该机本轮跳过)。
 */
function summarizeMachineAutonomy(payload) {
  if (!payload || !Array.isArray(payload.sessions)) return null;
  let hasAny = false;
  const sum = { commit: 0, rollback: 0, intervention: 0 };
  for (const s of payload.sessions) {
    const a = s && s.autonomy;
    if (!a) continue;
    hasAny = true;
    if (typeof a.commit === 'number') sum.commit += a.commit;
    if (typeof a.rollback === 'number') sum.rollback += a.rollback;
    // 兼容 intervention / interventions 两种键名
    const iv = (typeof a.intervention === 'number') ? a.intervention
      : (typeof a.interventions === 'number' ? a.interventions : 0);
    sum.intervention += iv;
  }
  return hasAny ? sum : null;
}

/**
 * 从 DashboardAggregator 的 results(原始,含 payload)汇总成 {machineId: counts}。
 * 仅取 online 且 payload 有 autonomy 数据的机器。results 项:{machine:{id,name}, online, payload?, error?}
 */
function summarizeResults(results) {
  const out = {};
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    if (!r || !r.machine || !r.machine.id) continue;
    if (!r.online) continue; // 离线机无新数据 → 不纳入本轮增量(保留 store 中既有事件 + stale)
    const sum = summarizeMachineAutonomy(r.payload);
    if (sum) out[r.machine.id] = sum;
  }
  return out;
}

/**
 * 纯:对比上次单机计数(prev)与本次(curr),算出新增事件 + 下次 prev。
 *   prev, curr: {machineId: {commit, rollback, intervention}}
 * 返回 { events: [{machine, type, ts}], nextPrev }
 *   - 正增量(delta>0):每个增量落成 delta 条事件(type 按字段)。
 *   - 负增量 / reset(curr<prev,单机重启归零):该字段不产事件,prev 重置为 curr(rebase)。
 *   - curr 中新出现的机器:全量作为增量(prev 视作 0)。
 *   - curr 中消失的机器:nextPrev 保留其旧值(下次它回来若更高再算增量;若更低视作 reset)。
 */
function computeDeltas(prev, curr, nowMs) {
  const events = [];
  const nextPrev = {};
  const prevMap = prev || {};
  // 保留 curr 中没有的旧机器计数(避免丢机器时把 prev 清掉,导致它回来重数)
  for (const id of Object.keys(prevMap)) nextPrev[id] = { ...prevMap[id] };

  for (const id of Object.keys(curr || {})) {
    const c = curr[id];
    const p = prevMap[id] || { commit: 0, rollback: 0, intervention: 0 };
    const merged = { ...p };
    for (const type of TYPES) {
      const cv = typeof c[type] === 'number' ? c[type] : 0;
      const pv = typeof p[type] === 'number' ? p[type] : 0;
      const delta = cv - pv;
      if (delta > 0) {
        for (let i = 0; i < delta; i++) events.push({ machine: id, type, ts: nowMs });
        merged[type] = cv;
      } else {
        // delta<=0:reset 或无变化。rebase 到 curr(若 curr 更低)防下次误判。
        merged[type] = Math.max(pv, cv);
        if (cv < pv) merged[type] = cv; // 真正的 reset:跟随 curr
      }
    }
    nextPrev[id] = merged;
  }
  return { events, nextPrev };
}

// —— 有状态聚合器:接 AutonomyStore,每次轮询 ingest ——
class AutonomyAggregator {
  constructor({ store, now } = {}) {
    if (!store) throw new Error('AutonomyAggregator requires a store');
    this._store = store;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._prev = {};
  }

  // sums: {machineId: {commit,rollback,intervention}}(来自 summarizeResults)
  ingest(sums, nowMs) {
    const n = typeof nowMs === 'number' ? nowMs : this._now();
    const { events, nextPrev } = computeDeltas(this._prev, sums || {}, n);
    if (events.length) this._store.recordMany(events);
    this._prev = nextPrev;
    return events; // 供测试/观测(返回本轮产生的事件)
  }

  // 供测试:读取内部 prev 快照
  _prevSnapshot() { return this._prev; }
}

module.exports = { AutonomyAggregator, computeDeltas, summarizeMachineAutonomy, summarizeResults, TYPES };
