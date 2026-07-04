const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/console_render.cjs');

// 卡片渲染相关(escapeHtml/statusMeta/buildCardHTML/sortCardsByRelevance/
// summarizeFleet)已随 board_render.cjs 迁出,本文件只测 main-agent 相关:
// parseCallout / nextBackoff(relativeTime 由 parseCallout 间接覆盖)。

test('parseCallout: 空屏 → 隐藏', () => {
  assert.equal(R.parseCallout('', {}).show, false);
  assert.equal(R.parseCallout(null, {}).show, false);
});
test('parseCallout: 纯进度行(无关键词)→ 隐藏', () => {
  const r = R.parseCallout('building modules…\n80% done', {});
  assert.equal(r.show, false);
});
test('parseCallout: 含 error → 点亮 + 截断省略', () => {
  const longErr = 'x'.repeat(200);
  // 空行分隔:Error 自成"最后非空块",块首即 Error 行(spec §9 块首算法)
  const r = R.parseCallout(`npm install\n\nError: ${longErr}`, { now: 1000 });
  assert.equal(r.show, true);
  assert.match(r.text, /Error:/);
  assert.ok(r.text.length <= 121); // 120 + 省略号
});
test('parseCallout: 多行错误栈 → 取块首(非栈尾噪音)', () => {
  const r = R.parseCallout('npm install\n\nError: ENOTEMPTY\n    at line 42\n    at line 17', { now: 1000 });
  assert.equal(r.show, true);
  assert.equal(r.text, 'Error: ENOTEMPTY');
});
test('parseCallout: ANSI 残留被 strip', () => {
  const r = R.parseCallout('\x1b[31mError: boom\x1b[0m', { now: 1000 });
  assert.equal(r.show, true);
  assert.doesNotMatch(r.text, /\x1b/);
  assert.match(r.text, /Error: boom$/);
});
test('parseCallout: 文本变化时重置 ts', () => {
  const now = 5000;
  const r1 = R.parseCallout('Error: a', { lastText: '', lastChangeTs: 0, now });
  assert.equal(r1.ts, now);
  const r2 = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 1000, now });
  assert.equal(r2.ts, 1000); // 不变
});
test('parseCallout: 稳定<10s 显示 实时输出中', () => {
  const r = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 5000, now: 8000 });
  assert.equal(r.timeLabel, '实时输出中…');
});
test('parseCallout: 稳定>10s 显示相对时间', () => {
  const r = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 1000, now: 15000 });
  assert.match(r.timeLabel, /s 前/);
});
test('parseCallout: traceback/exception/panic/EACCES/errno 均触发', () => {
  for (const t of ['Traceback (most recent)', 'Exception in thread', 'panic: x', 'EACCES: permission', 'errno -2']) {
    assert.equal(R.parseCallout(t, { now: 1 }).show, true, `应触发: ${t}`);
  }
});

test('nextBackoff: 退避表 3→6→12→30 秒', () => {
  assert.equal(R.nextBackoff(0), 3000);
  assert.equal(R.nextBackoff(1), 6000);
  assert.equal(R.nextBackoff(2), 12000);
  assert.equal(R.nextBackoff(3), 30000);
});
test('nextBackoff: 超出表上限封顶 30s', () => {
  assert.equal(R.nextBackoff(4), 30000);
  assert.equal(R.nextBackoff(99), 30000);
});
test('nextBackoff: 负参兜底首档', () => {
  assert.equal(R.nextBackoff(-1), 3000);
});

// ---- 业务边界补充(branch 覆盖) ----

test('parseCallout: text===lastText 但 lastChangeTs=0 → ts 走 now 兜底', () => {
  const now = 5000;
  const r = R.parseCallout('Error: a', { lastText: 'Error: a', lastChangeTs: 0, now });
  assert.equal(r.ts, now);            // 0 || now → now
  assert.equal(r.timeLabel, '实时输出中…'); // stableMs=0,未超 10s
});

test('relativeTime: 秒/分/时/天/周/月档 + 无 ts 空串', () => {
  const now = 1000000;
  assert.equal(R.relativeTime(now - 30000, now), '30s 前');
  assert.equal(R.relativeTime(now - 7200000, now), '2h 前');
  assert.equal(R.relativeTime(now - 3 * 86400000, now), '3d 前');
  assert.equal(R.relativeTime(now - 14 * 86400000, now), '2w 前');
  assert.equal(R.relativeTime(now - 60 * 86400000, now), '2个月前');
  assert.equal(R.relativeTime(0, now), '');
});
