'use strict';

// hub 聚合各单机的会话轨迹(.jsonl 元数据)→「会话轨迹」视图(轻量 Evolve 数据底座)。
// 镜像 audit_aggregator.cjs 的结构:纯函数 mergeTrajectories/queryTrajectories + 轮询器
// TrajectoryAggregator。每 intervalMs 并发拉各机 /api/trajectories,只聚合元数据,
// 不搬运文件本体(单机离线/旧版本无此端点 → 该机贡献空清单,不影响整体)。
//
// 日期过滤语义(UTC 日界,YAML 'YYYY-MM-DD'):
//   mtime ∈ [dayStart, dayStart+24h) —— 含当日起点、不含次日起点(边界归属明确,验收 7)。
//   ⚠️ 前端 public/trajectories_view.cjs 的 filterTrajectories 是同语义的浏览器侧副本,
//   两处须同步维护(仓内既有先例:board_render.cjs 与 config.cjs 的 CLI_TOOLS 双持有)。

const DEFAULT_INTERVAL_MS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class InvalidTrajectoryDateError extends Error {
  constructor(value) {
    super(`invalid date "${value}"; expected YYYY-MM-DD`);
    this.name = 'InvalidTrajectoryDateError';
    this.code = 'INVALID_TRAJECTORY_DATE';
  }
}

// 校验并解析日期过滤串 → 当日 UTC 起点 ms。空串/undefined → null(不过滤)。非法 → throw。
function parseDateFilter(date) {
  if (date == null || date === '') return null;
  if (!DATE_RE.test(date)) throw new InvalidTrajectoryDateError(date);
  const start = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(start)) throw new InvalidTrajectoryDateError(date);
  return start;
}

function mtimeInUtcDay(mtime, dayStart) {
  return typeof mtime === 'number' && mtime >= dayStart && mtime < dayStart + DAY_MS;
}

// 纯函数:合并各机抓取结果。每个结果: { machine:{id,name}, online, payload? }
// payload 即单机 /api/trajectories 响应 { trajectories, skipped }。每条轨迹打 machine 标签。
function mergeTrajectories(results) {
  const machines = [];
  let total = 0;
  for (const r of (results || [])) {
    if (!r || !r.machine) continue;
    const list = (r.online && r.payload && Array.isArray(r.payload.trajectories))
      ? r.payload.trajectories.filter((t) => t && typeof t === 'object')
      : [];
    const tagged = list.map((t) => ({ ...t, machine: r.machine.id }));
    total += tagged.length;
    machines.push({
      id: r.machine.id,
      name: r.machine.name,
      online: !!r.online,
      count: tagged.length,
      skipped: (r.online && r.payload && typeof r.payload.skipped === 'number') ? r.payload.skipped : 0,
      trajectories: tagged,
    });
  }
  return { machines, total };
}

// 过滤后的单条判定(供 queryTrajectories 与前端副本对齐语义参考):
//   machine 精确匹配;date('YYYY-MM-DD')按 UTC 日闭开区间。
function matchesFilters(t, machine, dayStart) {
  if (machine && t.machine !== machine) return false;
  if (dayStart != null && !mtimeInUtcDay(t.mtime, dayStart)) return false;
  return true;
}

// 统一查询入口:
//   queryTrajectories(merged, { machine, date }) → { total, filters, machines }
//   - machine 非空 → 仅保留该机的组(验收 7:按机器过滤仅显示该机轨迹)
//   - date 非法格式 → throw InvalidTrajectoryDateError(HTTP 层转 400)
//   - filters 回显实际生效值(空 → null)
function queryTrajectories(merged, { machine, date } = {}) {
  const dayStart = parseDateFilter(date);
  const machines = [];
  let total = 0;
  for (const m of (merged && merged.machines) || []) {
    if (!m) continue;
    if (machine && m.id !== machine) continue;
    const kept = (m.trajectories || []).filter((t) => matchesFilters(t, machine, dayStart));
    total += kept.length;
    machines.push({ ...m, count: kept.length, trajectories: kept });
  }
  return {
    total,
    filters: { machine: machine || null, date: date || null },
    machines,
  };
}

// 轮询器:fetchOne(secret) -> { ok, payload?, error? }
class TrajectoryAggregator {
  constructor({ registry, fetchOne, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    this._registry = registry;
    this._fetchOne = fetchOne;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._latest = { machines: [], total: 0 };
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
        const r = await this._fetchOne(secret);
        const online = !!r && r.ok;
        return {
          machine: { id: m.id, name: m.name },
          online,
          payload: online ? r.payload : null,
        };
      } catch {
        return { machine: { id: m.id, name: m.name }, online: false, payload: null };
      }
    }));
    this._latest = mergeTrajectories(results);
  }
  getLatest() { return this._latest; }
}

module.exports = {
  mergeTrajectories,
  queryTrajectories,
  matchesFilters,
  parseDateFilter,
  mtimeInUtcDay,
  TrajectoryAggregator,
  InvalidTrajectoryDateError,
  DEFAULT_INTERVAL_MS,
};
