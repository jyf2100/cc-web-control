'use strict';

// hub 聚合各单机的子进程 spawn 审计(cc-subprocess.jsonl)→ 统一「Audit」面板。
// 镜像 dashboard_aggregator.cjs 的结构:纯函数 mergeAudit + 轮询器 AuditAggregator。
// 每 intervalMs 并发拉各机 /api/audit/cc-subprocess?limit=N,合并、按 ts 倒序、截断。
// 端到端延迟 ≤ 一个轮询周期(默认 2s,验收 C10)。cmd 已在单机侧脱敏, hub 不再处理 key。

const DEFAULT_LIMIT = 100;

// 纯函数:合并各机抓取结果。每个结果: { machine:{id,name}, online, entries? }
function mergeAudit(results, opts = {}) {
  const limit = opts.limit != null ? opts.limit : DEFAULT_LIMIT;
  const rows = [];
  for (const r of (results || [])) {
    if (!r || !r.online || !Array.isArray(r.entries)) continue;
    for (const e of r.entries) {
      if (!e || typeof e !== 'object') continue;
      rows.push({ ...e, machine: r.machine.id, machine_name: r.machine.name });
    }
  }
  // ts 倒序(顶行最新);ts 缺失/相等保持稳定
  rows.sort((a, b) => {
    const ta = a.ts || '';
    const tb = b.ts || '';
    if (ta < tb) return 1;
    if (ta > tb) return -1;
    return 0;
  });
  return { entries: limit > 0 ? rows.slice(0, limit) : rows };
}

// 轮询器:fetchOne(secret, limit) -> { ok, entries?, error? }
class AuditAggregator {
  constructor({ registry, fetchOne, intervalMs = 2000, limit = DEFAULT_LIMIT }) {
    this._registry = registry;
    this._fetchOne = fetchOne;
    this._intervalMs = intervalMs;
    this._limit = limit;
    this._timer = null;
    this._latest = { entries: [] };
  }
  start() {
    if (this._timer) return;
    this._safeTick();
    this._timer = setInterval(() => this._safeTick(), this._intervalMs);
  }
  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  _safeTick() {
    this._tick().catch(() => {});
  }
  async _tick() {
    const visible = this._registry.all();
    const results = await Promise.all(visible.map(async (m) => {
      const secret = this._registry.getSecret(m.id);
      try {
        const r = await this._fetchOne(secret, this._limit);
        const online = !!r && r.ok;
        return {
          machine: { id: m.id, name: m.name },
          online,
          entries: online ? r.entries : null,
        };
      } catch {
        return { machine: { id: m.id, name: m.name }, online: false };
      }
    }));
    this._latest = mergeAudit(results, { limit: this._limit });
  }
  getLatest() {
    return this._latest;
  }
}

module.exports = { mergeAudit, AuditAggregator, DEFAULT_LIMIT };
