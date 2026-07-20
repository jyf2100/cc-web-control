'use strict';

/**
 * hub 侧「受监督自主运行」指标事件存储 + 时间窗口聚合 + 7 天持久化。
 *
 * 事件:{ machine, type: 'commit'|'rollback'|'intervention', ts }
 * 来源:hub/autonomy_aggregator.cjs 从各单机单调计数器算出的增量(每次轮询把正增量落成事件)。
 *
 * 设计:
 *   - 内存数组是聚合真源;JSONL append-only 落盘用于 hub 重启恢复(满足验收 6:7 天、不依赖外部 DB)。
 *   - load():读全部行 → 解析 → 仅保留 ts >= now - RETAIN_MS(7d)。
 *   - record():内存 push + append 一行(失败不阻断:落盘失败仅丢这行的持久化,内存仍准)。
 *   - compact(nowMs):用内存中未过期的内容整表重写文件,防止 append-only 无限增长(周期性 / 关闭时调)。
 *
 * 纯函数 aggregateEvents 与 AutonomyStore 类分开,前者无副作用、可独立测试(对齐本仓风格)。
 * fs 经依赖注入(fsImpl),默认接 node:fs。
 */

const TYPES = ['commit', 'rollback', 'intervention'];
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function isValidEvent(e) {
  return !!(
    e && typeof e.machine === 'string' && e.machine
    && TYPES.includes(e.type)
    && typeof e.ts === 'number' && Number.isFinite(e.ts)
  );
}

/**
 * 时间窗口聚合(纯)。
 *   events    事件数组(全部内存事件,未按窗口预过滤)
 *   windowMs  窗口大小(ms)
 *   nowMs     当前时间戳
 *   machines  机器宇宙:[{id, name?, online}] —— 决定展示哪些机 + stale 标记
 * 返回 { window, generatedAt, machines: [{id, name, online, commit, rollback, intervention, stale, asOfTs}] }
 *   - 每台机始终出现(含 0 计数),便于前端稳定渲染。
 *   - stale = !online;asOfTs = 该机在窗口内最后一次事件 ts(无则 null)。
 *   - 窗口外的事件不计入计数(仅持久化留痕)。
 */
function aggregateEvents(events, windowMs, nowMs, machines) {
  const cutoff = (typeof nowMs === 'number' && typeof windowMs === 'number') ? nowMs - windowMs : -Infinity;
  const byMachine = new Map(); // id → {commit,rollback,intervention,asOfTs}
  if (Array.isArray(events)) {
    for (const e of events) {
      if (!isValidEvent(e)) continue;
      if (e.ts < cutoff) continue;
      let m = byMachine.get(e.machine);
      if (!m) { m = { commit: 0, rollback: 0, intervention: 0, asOfTs: null }; byMachine.set(e.machine, m); }
      m[e.type]++;
      if (m.asOfTs === null || e.ts > m.asOfTs) m.asOfTs = e.ts;
    }
  }
  const out = (Array.isArray(machines) ? machines : []).map((mc) => {
    const id = mc && mc.id != null ? mc.id : mc;
    const m = byMachine.get(id);
    const online = !!(mc && mc.online !== false);
    return {
      id,
      name: (mc && mc.name != null) ? mc.name : id,
      online,
      commit: m ? m.commit : 0,
      rollback: m ? m.rollback : 0,
      intervention: m ? m.intervention : 0,
      stale: !online,
      asOfTs: m ? m.asOfTs : null,
    };
  });
  return { window: windowMs, generatedAt: nowMs, machines: out };
}

// —— 有状态存储(DI fs) ——
class AutonomyStore {
  constructor({ filePath, fsImpl, now } = {}) {
    this._filePath = filePath || null;
    this._fs = fsImpl || null;
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._events = [];
    this._dirty = false; // compact 用:自上次 compact 后是否有新事件
    if (this._filePath && this._fs) this._load();
  }

  _load() {
    const fs = this._fs;
    if (!fs || !this._filePath) return;
    let text;
    try {
      text = fs.readFileSync ? fs.readFileSync(this._filePath, 'utf8') : null;
    } catch { /* 文件不存在 / 不可读 → 空起步 */ return; }
    if (typeof text !== 'string' || !text) return;
    const cutoff = this._now() - RETAIN_MS;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      if (!isValidEvent(e)) continue;
      if (e.ts < cutoff) continue; // 启动即丢弃 7d 外的历史
      this._events.push(e);
    }
  }

  // 供 autonomy_aggregator 注入新事件。批量落盘(一次 append 多行)减少 IO。
  record(event) {
    if (!isValidEvent(event)) return;
    this._events.push(event);
    this._dirty = true;
    this._append(event);
  }

  recordMany(list) {
    if (!Array.isArray(list) || list.length === 0) return;
    const valid = list.filter(isValidEvent);
    if (valid.length === 0) return;
    for (const e of valid) this._events.push(e);
    this._dirty = true;
    this._appendMany(valid);
  }

  _append(event) {
    const fs = this._fs;
    if (!fs || !this._filePath || !fs.appendFileSync) return;
    try { fs.appendFileSync(this._filePath, JSON.stringify(event) + '\n'); }
    catch { /* 落盘失败不阻断:内存仍准,仅丢失这行的持久化 */ }
  }

  _appendMany(events) {
    const fs = this._fs;
    if (!fs || !this._filePath || !fs.appendFileSync) return;
    try { fs.appendFileSync(this._filePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n'); }
    catch { /* 同上 */ }
  }

  events() { return this._events.slice(); }

  // 整表重写为「未过期」事件,防 append-only 无限增长。周期性 / 关闭时调用。
  compact(nowMs) {
    const n = typeof nowMs === 'number' ? nowMs : this._now();
    const cutoff = n - RETAIN_MS;
    const before = this._events.length;
    this._events = this._events.filter((e) => e.ts >= cutoff);
    const fs = this._fs;
    // 仅当「有事件需持久化」或「裁掉了过期事件」时才重写文件;
    // 否则(空存储且无过期)跳过写,避免在无数据时(如测试 / 全新 hub)凭空创建空文件。
    if (fs && this._filePath && fs.writeFileSync && (this._events.length > 0 || before > 0)) {
      try {
        fs.writeFileSync(this._filePath, this._events.map((e) => JSON.stringify(e)).join('\n') + (this._events.length ? '\n' : ''));
      } catch { /* 重写失败不阻断:下次 compact 再试 */ }
    }
    this._dirty = false;
    return before - this._events.length; // 被裁掉的数量(测试/观测用)
  }

  // 聚合便捷方法(等价于纯函数 aggregateEvents(this.events(), ...))
  aggregate(windowMs, nowMs, machines) {
    return aggregateEvents(this._events, windowMs, typeof nowMs === 'number' ? nowMs : this._now(), machines);
  }
}

module.exports = { AutonomyStore, aggregateEvents, TYPES, RETAIN_MS, isValidEvent };
