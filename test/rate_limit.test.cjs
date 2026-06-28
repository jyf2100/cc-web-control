const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../rate_limit.cjs');

// 可控时钟:测试推进时间,避免依赖真实 setTimeout
function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('check allows up to max attempts within window', () => {
  const c = makeClock();
  const lim = createRateLimiter({ max: 3, windowMs: 1000, now: c.now });
  assert.deepEqual(lim.check('ip'), { limited: false, retryAfterMs: 0 });
  assert.deepEqual(lim.check('ip'), { limited: false, retryAfterMs: 0 });
  assert.deepEqual(lim.check('ip'), { limited: false, retryAfterMs: 0 });
});

test('check blocks when max exceeded within window', () => {
  const c = makeClock();
  const lim = createRateLimiter({ max: 2, windowMs: 1000, now: c.now });
  lim.check('ip'); // 1
  lim.check('ip'); // 2
  const r = lim.check('ip'); // 3 -> 限流
  assert.equal(r.limited, true);
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 1000);
});

test('window slides: old attempts expire, new ones allowed', () => {
  const c = makeClock();
  const lim = createRateLimiter({ max: 2, windowMs: 1000, now: c.now });
  lim.check('ip');
  lim.check('ip');
  c.advance(1001); // 窗口过期
  assert.deepEqual(lim.check('ip'), { limited: false, retryAfterMs: 0 });
});

test('different keys counted independently', () => {
  const c = makeClock();
  const lim = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
  assert.equal(lim.check('a').limited, false);
  assert.equal(lim.check('b').limited, false); // b 独立计数
  assert.equal(lim.check('a').limited, true);  // a 第 2 次超限
});

test('reset clears counters for a key', () => {
  const c = makeClock();
  const lim = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
  lim.check('a');
  assert.equal(lim.check('a').limited, true);
  lim.reset('a');
  assert.equal(lim.check('a').limited, false);
});
