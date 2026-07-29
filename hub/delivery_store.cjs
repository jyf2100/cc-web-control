'use strict';

// 广播 / 介入投递结果存储:hub 侧内存环形缓冲,供看板聚合区查询最近 N 条投递记录。
// 每条记录含 kind(broadcast|intervene)、投递文本、逐目标回执、汇总、时间戳。
// 不落盘(与 registry 同策略:进程重启靠调用方重发);maxEntries 防无限增长。

class DeliveryStore {
  constructor({ maxEntries = 100, nowFn = Date.now } = {}) {
    this._entries = [];
    this._max = maxEntries;
    this._now = nowFn;
    this._seq = 0;
  }

  // 记录一次投递。data 为原始指令文本;results/summary 来自 broadcastCommand/interveneCommand。
  // 返回写入的 entry(含 id/ts,供调用方引用)。
  record({ kind, data, results, summary }) {
    const entry = {
      id: `${this._now()}-${++this._seq}`,
      kind,           // 'broadcast' | 'intervene'
      data: typeof data === 'string' ? data : '',
      ts: this._now(),
      results: Array.isArray(results) ? results.map((r) => ({ ...r })) : [],
      summary: summary || null,
    };
    this._entries.push(entry);
    if (this._entries.length > this._max) {
      this._entries = this._entries.slice(-this._max);
    }
    return entry;
  }

  // 返回最近 limit 条记录(默认 50,上限 200),按时间正序(旧→新)。
  recent(limit = 50) {
    const n = Math.min(Math.max(limit, 1), 200);
    return this._entries.slice(-n);
  }

  clear() {
    this._entries = [];
    this._seq = 0;
  }

  size() {
    return this._entries.length;
  }
}

module.exports = { DeliveryStore };
