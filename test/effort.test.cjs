'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Effort = require('../public/effort.cjs');

const {
  EFFORT_LEVELS,
  DEFAULT_EFFORT,
  isValidEffort,
  normalizeEffort,
  buildEffortOptions,
  buildEffortChangeWarning,
  buildEffortSlashCommand,
  planEffortChange,
} = Effort;

// ---- 档位枚举 + 默认(AC6)----

test('EFFORT_LEVELS 含 low/medium/high/max', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'max']);
});

test('DEFAULT_EFFORT = medium(文档化默认,性能顶峰)', () => {
  assert.equal(DEFAULT_EFFORT, 'medium');
});

test('isValidEffort:枚举内 true,其余 false', () => {
  for (const lv of EFFORT_LEVELS) assert.ok(isValidEffort(lv), `${lv} 应合法`);
  assert.ok(!isValidEffort('turbo'));
  assert.ok(!isValidEffort(''));
  assert.ok(!isValidEffort(null));
  assert.ok(!isValidEffort(undefined));
  assert.ok(!isValidEffort(123));
  assert.ok(!isValidEffort('MEDIUM')); // 大小写敏感
});

// ---- 归一化(AC6 默认回退)----

test('normalizeEffort:合法原样返回', () => {
  assert.equal(normalizeEffort('high'), 'high');
});

test('normalizeEffort:非法/缺失 → DEFAULT_EFFORT', () => {
  assert.equal(normalizeEffort(undefined), DEFAULT_EFFORT);
  assert.equal(normalizeEffort(''), DEFAULT_EFFORT);
  assert.equal(normalizeEffort(null), DEFAULT_EFFORT);
  assert.equal(normalizeEffort('turbo'), DEFAULT_EFFORT);
});

test('normalizeEffort:自定义 fallback 合法则用之', () => {
  assert.equal(normalizeEffort(undefined, 'low'), 'low');
});

test('normalizeEffort:fallback 非法 → 退到 DEFAULT_EFFORT(绝不抛)', () => {
  assert.equal(normalizeEffort(undefined, 'turbo'), DEFAULT_EFFORT);
  assert.equal(normalizeEffort('turbo', 'nope'), DEFAULT_EFFORT);
});

// ---- UI 选项(AC6 默认可见标注)----

test('buildEffortOptions:每档一项,默认档 isDefault=true', () => {
  const opts = buildEffortOptions();
  assert.equal(opts.length, EFFORT_LEVELS.length);
  const def = opts.find((o) => o.isDefault);
  assert.ok(def, '应有且仅有一项 isDefault');
  assert.equal(def.value, DEFAULT_EFFORT);
  // 顺序保持枚举顺序(低→高)
  assert.deepEqual(opts.map((o) => o.value), EFFORT_LEVELS);
});

test('buildEffortOptions:currentEffort 标记 isCurrent', () => {
  const opts = buildEffortOptions('high');
  const cur = opts.find((o) => o.isCurrent);
  assert.equal(cur.value, 'high');
  // 非法 currentEffort 归一化为默认,isCurrent 落在默认档
  const opts2 = buildEffortOptions('bogus');
  assert.equal(opts2.find((o) => o.isCurrent).value, DEFAULT_EFFORT);
});

// ---- 切换警告(AC2:含「清空」「上下文缓存」)----

test('buildEffortChangeWarning:含「清空」与「上下文缓存」字样', () => {
  const w = buildEffortChangeWarning('high', 'low');
  assert.ok(/清空/.test(w), `应含「清空」,实际:${w}`);
  assert.ok(/上下文缓存/.test(w), `应含「上下文缓存」,实际:${w}`);
  assert.ok(/high/.test(w) && /low/.test(w), '应含 from/to 档位');
});

test('buildEffortChangeWarning:非法入参归一化(不抛)', () => {
  const w = buildEffortChangeWarning(undefined, undefined);
  assert.ok(/上下文缓存/.test(w));
});

// ---- slash 命令(AC3 dispatch)----

test('buildEffortSlashCommand:形如 /effort <level>', () => {
  assert.equal(buildEffortSlashCommand('low'), '/effort low');
  assert.equal(buildEffortSlashCommand('max'), '/effort max');
});

test('buildEffortSlashCommand:effort 经归一化(非法 → 默认)', () => {
  assert.equal(buildEffortSlashCommand('bogus'), '/effort ' + DEFAULT_EFFORT);
});

// ---- 切换决策 planEffortChange(AC2/AC3/AC4 核心)----

test('planEffortChange:档位不变 → noop(AC4:全程不调 → 无 dispatch)', () => {
  const r = planEffortChange('medium', 'medium');
  assert.equal(r.action, 'noop');
  assert.equal(r.reason, 'unchanged');
  assert.equal(r.effort, 'medium');
  assert.ok(!('dispatch' in r), 'noop 不应预构造 dispatch');
});

test('planEffortChange:档位变化 → confirm(AC2:需确认才下发)', () => {
  const r = planEffortChange('medium', 'high');
  assert.equal(r.action, 'confirm');
  assert.equal(r.from, 'medium');
  assert.equal(r.to, 'high');
  assert.ok(/上下文缓存/.test(r.warning), 'confirm 须带缓存清空警告');
  assert.equal(r.dispatch, '/effort high', 'AC3:确认后下发 to 档命令');
});

test('planEffortChange:from/to 经归一化(非法入参不抛)', () => {
  const r = planEffortChange('bogus', 'high');
  assert.equal(r.from, DEFAULT_EFFORT);
  assert.equal(r.to, 'high');
  assert.equal(r.action, 'confirm');
});

test('planEffortChange:两档归一化后相同 → noop', () => {
  // 两个非法值都归一化为 medium → 等价 → noop
  const r = planEffortChange('bogus', 'nope');
  assert.equal(r.action, 'noop');
});
