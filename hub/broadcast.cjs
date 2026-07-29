'use strict';

// 跨设备广播 + 细粒度介入:纯函数 + 依赖注入风格。
// broadcastCommand:向多个 (machine, session) 目标并行投递一条 input 指令,
//   每个目标返回结构化投递回执(status = delivered|failed|offline|unknown)。
// interveneCommand:对单个在线节点注入一条单行文本(禁止换行,防 tmux 注入)。
//
// 离线节点不静默跳过:从 getLatest() 看板快照读取 online 标志,
//   online === false → status:'offline',即使注册了也不尝试连接。
//
// 通道本地优先:依赖 getClient() 返回的 sendOneShot,底层是 cc-web-control
//   现有 WS 直连(AgentClient → 单机 server.cjs 的 ?session= WS),不经第三方公网云。

const BROADCAST_MAX_TARGETS = 50;
const DEFAULT_SEND_TIMEOUT_MS = 5000;

// ── 目标解析 ──

// 从 targets 数组中过滤 + 去重(同 machine+session)。
// 无效条目(machine/session 非字符串,但 null session 允许——离线机的占位)被丢弃。
function dedupTargets(targets) {
  const seen = new Set();
  const result = [];
  for (const t of targets) {
    if (!t || typeof t.machine !== 'string') continue;
    // session 允许 null(离线机占位);非 null 时须为字符串
    if (t.session != null && typeof t.session !== 'string') continue;
    const key = `${t.machine}/${t.session == null ? '' : t.session}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ machine: t.machine, session: t.session == null ? null : t.session });
  }
  return result;
}

// 解析广播目标:
//   - 显式 targets 优先(调用方精确指定 machine+session 对)
//   - 否则自动解析:从 registrySnapshot 取所有注册机(含离线),
//     在线机从 latestDashboard 取其 sessions;离线机以 session:null 占位(不静默跳过)
//   - machines 数组可限定范围(只解析指定 machine id)
//
// 返回:[{machine, session}] — 已去重,离线机 session 为 null。
function resolveBroadcastTargets({ targets, machines, latestDashboard, registrySnapshot }) {
  if (Array.isArray(targets) && targets.length > 0) {
    return dedupTargets(targets);
  }
  const dashMachines = (latestDashboard && Array.isArray(latestDashboard.machines)) ? latestDashboard.machines : [];
  // 优先用 registrySnapshot(含离线机 + online 标志);回退到 dashboard(聚合后也有 online)
  const regMachines = Array.isArray(registrySnapshot) && registrySnapshot.length > 0 ? registrySnapshot : dashMachines;
  const machineFilter = Array.isArray(machines) ? new Set(machines) : null;

  const result = [];
  for (const m of regMachines) {
    if (!m || typeof m.id !== 'string') continue;
    if (machineFilter && !machineFilter.has(m.id)) continue;
    const online = m.online !== false;
    if (!online) {
      // 离线机:以 null session 占位,broadcastCommand 会标 status:'offline'
      result.push({ machine: m.id, session: null });
      continue;
    }
    // 在线机:从 dashboard 找其 sessions
    const dashMachine = dashMachines.find((dm) => dm && dm.id === m.id);
    const sessions = (dashMachine && Array.isArray(dashMachine.sessions)) ? dashMachine.sessions : [];
    for (const s of sessions) {
      if (s && typeof s.name === 'string') {
        result.push({ machine: m.id, session: s.name });
      }
    }
  }
  return dedupTargets(result);
}

// ── 核心广播 ──

// 从看板快照构建 machine id → online(布尔)映射。
function buildOnlineMap(latest) {
  const map = new Map();
  if (latest && Array.isArray(latest.machines)) {
    for (const m of latest.machines) {
      if (m && typeof m.id === 'string') map.set(m.id, m.online !== false);
    }
  }
  return map;
}

// 向 targets 并行投递 { type:'input', data, enter }。
// getClient: (machineId) => { sendOneShot(session, msg) => Promise<{ok,error?}> } | null
// getLatest: () => dashboard 快照(用于判断 online);可选,不传则不做离线预判
//
// 返回:{ results: [{machine, session, status, ok, error?}], summary }
//   status: 'delivered' | 'failed' | 'offline' | 'unknown'
async function broadcastCommand({ targets, data, enter = true, getClient, getLatest }) {
  const onlineMap = typeof getLatest === 'function' ? buildOnlineMap(getLatest()) : null;

  const results = await Promise.all(targets.map(async (t) => {
    // 离线预判:看板明确标 false → 直接 offline,不尝试连接
    if (onlineMap && onlineMap.get(t.machine) === false) {
      return { machine: t.machine, session: t.session, status: 'offline', ok: false, error: 'node offline' };
    }
    // 无 session(离线机占位)
    if (!t.session) {
      return { machine: t.machine, session: null, status: 'offline', ok: false, error: 'node offline' };
    }
    const client = getClient ? getClient(t.machine) : null;
    if (!client) {
      return { machine: t.machine, session: t.session, status: 'unknown', ok: false, error: `unknown machine: ${t.machine}` };
    }
    try {
      const r = await client.sendOneShot(t.session, { type: 'input', data, enter });
      if (r && r.ok) {
        return { machine: t.machine, session: t.session, status: 'delivered', ok: true };
      }
      const errMsg = (r && r.error) ? String(r.error) : 'delivery failed';
      return { machine: t.machine, session: t.session, status: 'failed', ok: false, error: errMsg };
    } catch (e) {
      return { machine: t.machine, session: t.session, status: 'failed', ok: false, error: String(e.message || e) };
    }
  }));

  return { results, summary: summarizeResults(results) };
}

// ── 细粒度介入(单节点单行注入)──

// 对单个 (machine, session) 注入一条单行文本。
// 拒绝换行(防 tmux send-keys 命令分隔注入,与 server.cjs normalizeProjectCwd 同策略)。
// 返回:{ ok, result: {machine, session, status, ok, error?}, summary }
async function interveneCommand({ machine, session, data, enter = true, getClient, getLatest }) {
  if (typeof machine !== 'string' || !machine) {
    return { ok: false, code: 'bad_request', error: 'machine required' };
  }
  if (typeof session !== 'string' || !session) {
    return { ok: false, code: 'bad_request', error: 'session required' };
  }
  if (typeof data !== 'string' || !data.trim()) {
    return { ok: false, code: 'bad_request', error: 'data must be a non-empty string' };
  }
  if (/[\r\n]/.test(data)) {
    return { ok: false, code: 'bad_request', error: 'intervention must be single-line (no line breaks)' };
  }
  const r = await broadcastCommand({
    targets: [{ machine, session }],
    data, enter, getClient, getLatest,
  });
  const result = r.results[0];
  return { ok: result.ok, result, summary: r.summary };
}

// ── 汇总 ──

function summarizeResults(results) {
  const summary = { total: results.length, delivered: 0, failed: 0, offline: 0, unknown: 0 };
  for (const r of results) {
    switch (r.status) {
      case 'delivered': summary.delivered++; break;
      case 'offline': summary.offline++; break;
      case 'unknown': summary.unknown++; break;
      default: summary.failed++;
    }
  }
  return summary;
}

module.exports = {
  broadcastCommand,
  interveneCommand,
  resolveBroadcastTargets,
  dedupTargets,
  buildOnlineMap,
  summarizeResults,
  BROADCAST_MAX_TARGETS,
  DEFAULT_SEND_TIMEOUT_MS,
};
