'use strict';

// hub 侧 Agent 生命周期状态聚合 store(内存)。
//
// 数据流:
//   各单机 /api/dashboard 的 payload.agents(每条 {agent_id,state,messageCount})
//     → DashboardAggregator 每 intervalMs(默认 2s)拉取
//     → ingestReport(machineId, agents) 逐条 register + 检测状态变化记事件(AC2/3/4)
//   命令(retry/approve/...) → transition(agent_id, event) 严格按状态机校验(AC7/AC8)
//
// 关键不变量:
//   - state 非法 → log 含「invalid state」字样 + 拒绝入库(AC1)。
//   - 命令迁移非法 → 拒绝 + 保留原状态(AC8)。
//   - 单机多 agent:键为 agent_id(全局唯一),同机多 agent 各自独立,不合并(AC4)。
//   - 事件日志每条含 {timestamp(ms 精度), agent_id, machine, from, to, trigger}(AC3/AC7)。
//
// 依赖注入:nowFn(默认 Date.now,测试注入确定性时钟)、log(默认 console)。
// immutability:对外 get/all/groupByState/getEventLog 均返回浅拷贝;内部迁移以新对象替换 Map 条目。

const {
  STATES,
  isValidState,
  applyTransition,
} = require('./agent_lifecycle.cjs');

const LOG_PREFIX = '[agent-state-store]';

class AgentStateStore {
  constructor({ nowFn = Date.now, log = console } = {}) {
    this._now = nowFn;
    this._log = log;
    this._agents = new Map(); // agent_id -> { agent_id, machine, state, messageCount, lastTransitionTs, updatedAt }
    this._events = [];        // [{ timestamp, agent_id, machine, from, to, trigger }]
  }

  // 注册/上报单个 agent。state 非法 → 拒绝(AC1)。已存在则更新(保留 machine/lastTransitionTs)。
  register({ agent_id, machine, state, messageCount } = {}) {
    if (!agent_id || typeof agent_id !== 'string') {
      return { ok: false, code: 'invalid agent_id', error: 'agent_id required' };
    }
    if (!isValidState(state)) {
      // AC1:输出含「invalid state」字样的错误日志,拒绝加载该 agent。
      this._log.error?.(`${LOG_PREFIX} invalid state "${state}" for agent "${agent_id}" — 拒绝加载`);
      return { ok: false, code: 'invalid state', error: `invalid state "${state}"` };
    }
    const prev = this._agents.get(agent_id);
    const ts = this._now();
    const rec = {
      agent_id,
      machine: machine || (prev ? prev.machine : null),
      state,
      messageCount: typeof messageCount === 'number'
        ? messageCount
        : (prev ? prev.messageCount : 0),
      lastTransitionTs: prev ? prev.lastTransitionTs : ts,
      updatedAt: ts,
    };
    this._agents.set(agent_id, rec);
    return { ok: true, agent: { ...rec } };
  }

  // 单机批量上报:agents = [{ agent_id, state, messageCount }]。
  // 逐条 register;若与上次上报的 state 不同 → 记 'report' 迁移事件(AC3:迁移可观测)。
  // 返回每条 register 结果数组(供调用方统计成功/失败)。
  ingestReport(machineId, agents) {
    const out = [];
    const list = Array.isArray(agents) ? agents : [];
    for (const a of list) {
      if (!a || typeof a !== 'object') continue;
      const prev = this._agents.get(a.agent_id);
      const r = this.register({
        agent_id: a.agent_id,
        machine: machineId,
        state: a.state,
        messageCount: a.messageCount,
      });
      if (!r.ok) { out.push(r); continue; }
      if (prev && prev.state !== a.state) {
        this._recordEvent({
          agent_id: a.agent_id,
          machine: machineId,
          from: prev.state,
          to: a.state,
          trigger: 'report',
        });
      }
      out.push(r);
    }
    return out;
  }

  // 命令式迁移(AC7 retry / AC8 reject)。非法 → 拒绝且保留原状态。
  // trigger 用于事件日志(默认取 event 名)。
  transition(agent_id, event, trigger) {
    const rec = this._agents.get(agent_id);
    if (!rec) {
      return { ok: false, code: 'unknown agent', error: `unknown agent "${agent_id}"` };
    }
    const r = applyTransition(rec.state, event);
    if (!r.ok) {
      // AC8:拒绝迁移,保留原状态,记录错误。
      this._log.error?.(`${LOG_PREFIX} ${r.error} (agent ${agent_id}) — 保留原状态 ${rec.state}`);
      return r;
    }
    const from = rec.state;
    const ts = this._now();
    // immutability:以新对象替换,不原地突变旧 rec。
    this._agents.set(agent_id, {
      ...rec,
      state: r.to,
      lastTransitionTs: ts,
      updatedAt: ts,
    });
    this._recordEvent({
      agent_id,
      machine: rec.machine,
      from,
      to: r.to,
      trigger: trigger || event,
    });
    return { ok: true, from, to: r.to };
  }

  _recordEvent({ agent_id, machine, from, to, trigger }) {
    this._events.push({
      timestamp: this._now(), // ms 精度(AC3)
      agent_id,
      machine: machine || null,
      from,
      to,
      trigger,
    });
  }

  get(agent_id) {
    const r = this._agents.get(agent_id);
    return r ? { ...r } : undefined;
  }

  all() {
    return Array.from(this._agents.values()).map((r) => ({ ...r }));
  }

  // 按状态分组(AC2/AC4):groups 恒含全部 6 状态键(未出现的为 0);byState 为每状态下的 agent 列表。
  groupByState() {
    const groups = {};
    const byState = {};
    for (const s of STATES) { groups[s] = 0; byState[s] = []; }
    for (const r of this._agents.values()) {
      if (isValidState(r.state)) {
        groups[r.state] += 1;
        byState[r.state].push({ ...r });
      }
    }
    return { groups, byState, total: this._agents.size };
  }

  getEventLog() {
    return this._events.map((e) => ({ ...e }));
  }

  // 派生:取某 agent 的历史会话条数(由单机上报 messageCount;此处仅聚合读出)。
  // AC5:hub 看板显示该 agent 的对话条数。
  getMessageCount(agent_id) {
    const r = this._agents.get(agent_id);
    return r ? (r.messageCount || 0) : 0;
  }
}

module.exports = { AgentStateStore, LOG_PREFIX };
