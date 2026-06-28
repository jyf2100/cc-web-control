'use strict';

/**
 * 登录速率限制:滑动窗口内存实现。
 *
 * 防爆破:同一 IP 在 windowMs 内最多 max 次尝试。重启清空
 * (短期记忆足够,无需持久化)。
 *
 * @param {object} opts
 * @param {number} opts.max        窗口内最大允许次数
 * @param {number} opts.windowMs   窗口长度(ms)
 * @param {() => number} [opts.now] 时钟函数(测试注入),默认 Date.now
 */
function createRateLimiter({ max, windowMs, now }) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const hits = new Map(); // key -> number[] 命中时间戳

  return {
    check(key) {
      const t = clock();
      const arr = hits.get(key) || [];
      const fresh = arr.filter((ts) => t - ts < windowMs);
      if (fresh.length >= max) {
        const oldest = fresh[0];
        return { limited: true, retryAfterMs: windowMs - (t - oldest) };
      }
      fresh.push(t);
      hits.set(key, fresh);
      return { limited: false, retryAfterMs: 0 };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { createRateLimiter };
