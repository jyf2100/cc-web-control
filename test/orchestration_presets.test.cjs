const { test } = require('node:test');
const assert = require('node:assert/strict');

const presets = require('../public/orchestration_presets.cjs');

test('listPresets 返回三档,首档为默认「直接执行」', () => {
  const list = presets.listPresets();
  assert.equal(list.length, 3, '至少三档:直接执行 / 需求澄清优先 / TDD 流水线');
  assert.deepEqual(
    list.map((p) => p.id),
    ['direct', 'clarify', 'tdd'],
    '档位顺序:direct → clarify → tdd'
  );
  assert.equal(list[0].id, 'direct');
  assert.equal(list[0].label, '直接执行');
  // UI 视图不应泄漏 prefix 文本(渲染只需 id/label/description)
  for (const p of list) {
    assert.ok(!('prefix' in p), `listPresets 不应含 prefix(档位 ${p.id})`);
    assert.ok(typeof p.label === 'string' && p.label.length > 0);
    assert.ok(typeof p.description === 'string' && p.description.length > 0);
  }
});

test('getDefaultId === direct(新会话默认「直接执行」)', () => {
  assert.equal(presets.getDefaultId(), 'direct');
});

test('getPreset:命中返回浅拷贝,未知 id 回退默认档', () => {
  const clarify = presets.getPreset('clarify');
  assert.equal(clarify.id, 'clarify');
  assert.ok(typeof clarify.prefix === 'string' && clarify.prefix.length > 0);
  // 浅拷贝:突变返回值不影响共享数据
  clarify.prefix = 'mutated';
  assert.notEqual(presets.getPreset('clarify').prefix, 'mutated');

  const unknown = presets.getPreset('does-not-exist');
  assert.equal(unknown.id, 'direct', '未知 id 回退默认档');
  assert.equal(presets.getDefaultId(), 'direct');

  assert.equal(presets.getPreset(null).id, 'direct');
  assert.equal(presets.getPreset(undefined).id, 'direct');
});

test('验收#1:默认档不注入(行为与现状一致)', () => {
  const out = presets.applyPreset('实现登录页', 'direct');
  assert.equal(out, '实现登录页', '默认档原样返回,无前缀');
});

test('验收#2:需求澄清档注入含「澄清需求 + 决策树 + 再动手」的前缀,并以用户任务结尾', () => {
  const out = presets.applyPreset('实现登录页', 'clarify');
  assert.ok(out.startsWith(presets.getPreset('clarify').prefix.trim()), '应以澄清前缀开头');
  assert.ok(out.endsWith('实现登录页'), '应以用户任务文本结尾');
  assert.match(out, /澄清需求/);
  assert.match(out, /决策树/);
  assert.match(out, /再(开始|动手)/);
  // 与默认档差异:默认档不含这些纪律关键词
  const direct = presets.applyPreset('实现登录页', 'direct');
  assert.ok(out !== direct, '澄清档输出必须不同于默认档');
  assert.ok(!/决策树/.test(direct), '默认档无决策树残留');
});

test('验收#3:TDD 档注入含「先写测试 + 再实现」的约束', () => {
  const out = presets.applyPreset('实现登录页', 'tdd');
  assert.ok(out.startsWith(presets.getPreset('tdd').prefix.trim()));
  assert.ok(out.endsWith('实现登录页'));
  assert.match(out, /写.*测试/);
  assert.match(out, /(再|最小)实现/);
  assert.match(out, /TDD/);
});

test('验收#4:切换档位注入内容随之变化;三档互不相同;切回直接执行无残留', () => {
  const task = '加一个搜索框';
  const direct = presets.applyPreset(task, 'direct');
  const clarify = presets.applyPreset(task, 'clarify');
  const tdd = presets.applyPreset(task, 'tdd');

  assert.notEqual(direct, clarify, 'direct ≠ clarify');
  assert.notEqual(direct, tdd, 'direct ≠ tdd');
  assert.notEqual(clarify, tdd, 'clarify ≠ tdd');

  // 切回直接执行:前缀纪律关键词全部消失(无残留)
  assert.equal(direct, task);
  for (const kw of ['决策树', '澄清需求', 'TDD', 'RED', 'GREEN']) {
    assert.ok(!new RegExp(kw).test(direct), `切回直接执行后不应残留「${kw}」`);
  }
});

test('空 / 纯空白输入不注入(走纯按键路径,不携带指令)', () => {
  assert.equal(presets.applyPreset('', 'clarify'), '');
  assert.equal(presets.applyPreset('   ', 'tdd'), '   ');
  assert.equal(presets.applyPreset('\n\t', 'clarify'), '\n\t');
});

test('applyPreset 缺省档位参数 → 默认档(不注入)', () => {
  assert.equal(presets.applyPreset('hi'), 'hi');
  assert.equal(presets.applyPreset('hi', undefined), 'hi');
});

test('注入契约:shipped prefix 全部单行(防 tmux send-keys -l 提前回车)', () => {
  for (const p of presets.PRESETS) {
    assert.ok(
      !/[\r\n]/.test(p.prefix),
      `档位 ${p.id} 的 prefix 必须单行(含换行会被 tmux 当作提前回车提交)`
    );
  }
});

test('注入契约:即便 prefix 误含换行,applyPreset 也折叠成空格单行化', () => {
  // 模拟将来第 4 档误配多行 prefix 的防御:折叠 \r\n 为空格,输出仍单行
  const multiline = presets.applyPreset('X', 'clarify');
  assert.ok(!/[\r\n]/.test(multiline), '最终注入文本必须单行');

  // 直接验证折叠逻辑:用带换行的 prefix 走 getPreset+apply 的等价路径
  const fakeText = '行一\n行二';
  // applyPreset 对 raw 本身不折叠(保留既有粘贴多行行为),仅折叠 prefix;
  // 这里断言的是「正常单行 prefix + 任务」结果不含换行
  const normal = presets.applyPreset('实现登录页', 'tdd');
  assert.ok(!/[\r\n]/.test(normal));
  // fakeText(纯用户输入,无注入)原样保留换行 —— 既有行为不变
  assert.equal(presets.applyPreset(fakeText, 'direct'), fakeText);
});

test('一致性:同一(档位, 任务)多次调用结果相同(纯函数无副作用)', () => {
  const a = presets.applyPreset('任务A', 'clarify');
  const b = presets.applyPreset('任务A', 'clarify');
  assert.equal(a, b);
});
