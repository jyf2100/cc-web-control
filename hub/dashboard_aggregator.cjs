'use strict';

// 纯函数:合并各机抓取结果。每个结果: { machine:{id,name,cli_tool}, online, payload?, error? }
// cli_tool 透传到 machine 记录 + 打到每条 session(供 UI 徽标/过滤、API 分类查询)。
function mergeDashboards(results) {
  const machines = (results || []).map((r) => {
    const cliTool = (r.machine && r.machine.cli_tool) || 'unknown';
    const sessions = (r.online && r.payload && Array.isArray(r.payload.sessions))
      ? r.payload.sessions.map((s) => ({ ...s, machine: r.machine.id, cli_tool: cliTool }))
      : [];
    return {
      id: r.machine.id,
      name: r.machine.name,
      cli_tool: cliTool,
      online: !!r.online,
      sessions,
      lastError: r.online ? null : (r.error || 'offline'),
    };
  });
  return { machines };
}

// 轮询器:依赖注入 registry + fetchOne(secret) -> {ok, payload?, error?}
class DashboardAggregator {
  constructor({ registry, fetchOne, intervalMs = 2000 }) {
    this._registry = registry;
    this._fetchOne = fetchOne;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._latest = { machines: [] };
  }
  start() {
    if (this._timer) return;
    this._safeTick(); // 立即跑一次
    this._timer = setInterval(() => this._safeTick(), this._intervalMs);
  }
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  // 单轮聚合的容错入口:registry 异常等导致 _tick reject 时忽略这一轮(单机失败已在 _tick 内隔离)
  _safeTick() {
    this._tick().catch(() => {});
  }
  async _tick() {
    const visible = this._registry.all(); // [{id,name,url,online,lastError,cli_tool}] 无 token
    const results = await Promise.all(visible.map(async (m) => {
      const secret = this._registry.getSecret(m.id); // {id,name,url,token}
      try {
        const r = await this._fetchOne(secret);
        const online = !!r && r.ok;
        this._registry.setOnline(m.id, online, online ? null : (r && r.error));
        return { machine: { id: m.id, name: m.name, cli_tool: m.cli_tool || 'unknown' }, online, payload: online ? r.payload : null, error: online ? null : (r && r.error) };
      } catch (e) {
        this._registry.setOnline(m.id, false, e.message);
        return { machine: { id: m.id, name: m.name, cli_tool: m.cli_tool || 'unknown' }, online: false, error: e.message };
      }
    }));
    this._latest = mergeDashboards(results);
  }
  getLatest() { return this._latest; }
}

module.exports = { mergeDashboards, DashboardAggregator };
