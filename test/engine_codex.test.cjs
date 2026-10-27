'use strict';

// engine=codex(OpenAI Codex CLI)支持:config 解析 / 启动命令 / 依赖检查三面的单元测试。
// 对应 PRD 验收:
//   1. 缺省零变化(不配置 engine → claude 路径逐字节不变)
//   2. engine 生效(codex 解析;缺失/非法 → claude + warn)
//   3. codex 启动路径(启动模块产出的 tmux 命令含 codex 不含 claude,含假 tmux 捕获)
//   4. 依赖缺失(PATH 无 codex → 安装提示含 @openai/codex + exit code 1)
// 纯函数 + 注入(fsImpl / existsFn / 假 tmux bin),不碰真实进程/网络(仓内测试风格)。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { loadConfig, SINGLE_SCHEMA } = require('../config_loader.cjs');
const {
  buildClaudeLaunchCommand,
  buildEngineLaunchCommand,
  buildSessionStartCommand,
} = require('../claude_launch.cjs');
const { depsForEngine, findMissing, formatMissing, main } = require('../bin/cc-web-control.cjs');

// 与 config_loader.test.cjs 同款 fsImpl:重定向到内存内容,不读用户家目录。
function fakeFs(fileContent, mode = 0o600) {
  return {
    existsSync: () => true,
    readFileSync: () => fileContent,
    statSync: () => ({ mode }),
  };
}

// ---- 验收 2:engine 生效 ----

test('config {"engine":"codex"} → 解析出 engine === "codex"', () => {
  const { config, warnings } = loadConfig({
    schema: SINGLE_SCHEMA,
    defaultFilePath: '/fake/config.json',
    argv: [],
    env: {},
    fsImpl: fakeFs(JSON.stringify({ engine: 'codex' })),
  });
  assert.equal(config.engine, 'codex');
  assert.deepEqual(warnings, []);
});

test('engine 缺失 → "claude" 且无 engine 相关 warning(现有用户零感知)', () => {
  const { config, warnings } = loadConfig({
    schema: SINGLE_SCHEMA,
    defaultFilePath: '/fake/config.json',
    argv: [],
    env: {},
    fsImpl: fakeFs(JSON.stringify({ port: 8000 })),
  });
  assert.equal(config.engine, 'claude');
  assert.ok(!warnings.some((w) => /engine/.test(w)), `缺省不应 warn,实际 ${JSON.stringify(warnings)}`);
});

test('engine 非法("gpt") → 降级 "claude" + warning(engine 值回显;server 启动打到 stderr)', () => {
  const { config, warnings } = loadConfig({
    schema: SINGLE_SCHEMA,
    defaultFilePath: '/fake/config.json',
    argv: [],
    env: {},
    fsImpl: fakeFs(JSON.stringify({ engine: 'gpt' })),
  });
  assert.equal(config.engine, 'claude');
  // warning 必须指名 engine 字段与非法值(可定位拼写错误);server.cjs 启动时对每条
  // warning console.error('[config] 警告: …')(见下方 wiring 断言)→ stderr 可见。
  assert.ok(
    warnings.some((w) => /"engine"/.test(w) && /gpt/.test(w) && /claude/.test(w)),
    `应 warn engine 非法并提示回退 claude,实际 ${JSON.stringify(warnings)}`
  );
});

test('env CC_WEB_ENGINE=codex 覆盖 file 值(env > file > default 同一优先级链)', () => {
  const { config } = loadConfig({
    schema: SINGLE_SCHEMA,
    defaultFilePath: '/fake/config.json',
    argv: [],
    env: { CC_WEB_ENGINE: 'codex' },
    fsImpl: fakeFs(JSON.stringify({ engine: 'claude' })),
  });
  assert.equal(config.engine, 'codex');
});

test('server.cjs 启动时把 config warnings 打到 stderr(wiring:console.error 逐条输出)', () => {
  // 验收 2 的 "stderr 有 warn":config_loader 保持纯函数(warnings 数组返回),
  // server 启动时逐条 console.error——源级契约断言防退化。
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  assert.match(src, /\[config\] 警告/, 'server 应有 [config] 警告 输出前缀');
  assert.match(src, /for \(const w of cfgWarnings\)/, '应遍历输出全部 cfgWarnings');
});

test('SINGLE_SCHEMA.engine:enum 类型 + values [claude, codex] + env CC_WEB_ENGINE + default claude', () => {
  assert.equal(SINGLE_SCHEMA.engine.type, 'enum');
  assert.equal(SINGLE_SCHEMA.engine.env, 'CC_WEB_ENGINE');
  assert.equal(SINGLE_SCHEMA.engine.default, 'claude');
  assert.deepEqual(SINGLE_SCHEMA.engine.values, ['claude', 'codex']);
});

// ---- 验收 3:codex 启动路径(启动模块产出的 tmux 命令)----

test('buildEngineLaunchCommand engine=codex → bash "<wrapper>",不含 --session-id/--resume/--effort', () => {
  const cmd = buildEngineLaunchCommand({
    engine: 'codex',
    wrapperPath: '/opt/x/codex-wrapper.sh',
    sessionId: '11111111-2222-3333-4444-555555555555',
    resumeId: '22222222-3333-4444-5555-666666666666',
    effort: 'medium',
  });
  assert.equal(cmd, 'bash "/opt/x/codex-wrapper.sh"');
  assert.ok(!cmd.includes('--session-id'), 'codex 不认 --session-id(claude 专属),不应透传');
  assert.ok(!cmd.includes('--resume'), 'codex 不认 --resume(claude 专属),不应透传');
  assert.ok(!cmd.includes('--effort'), 'codex 不认 --effort,不应透传');
});

test('buildSessionStartCommand engine=codex → cd "<cwd>" && bash "<…codex-wrapper.sh>",含 codex 不含 claude', () => {
  const cmd = buildSessionStartCommand({ engine: 'codex', cwd: '/home/u/proj', wrapperPath: '/opt/x/codex-wrapper.sh' });
  assert.equal(cmd, 'cd "/home/u/proj" && bash "/opt/x/codex-wrapper.sh"');
  assert.match(cmd, /codex-wrapper\.sh/, 'tmux 命令须含 codex');
  assert.ok(!cmd.includes('claude'), `codex 路径不应含 claude,实际: ${cmd}`);
});

test('buildEngineLaunchCommand engine=codex wrapperPath 空/缺省 → throw(与 claude 路径同防御)', () => {
  assert.throws(() => buildEngineLaunchCommand({ engine: 'codex', wrapperPath: '' }));
  assert.throws(() => buildEngineLaunchCommand({ engine: 'codex' }));
});

test('codex-wrapper.sh 存在且 exec codex(与 claude-wrapper.sh 对应的启动路径)', () => {
  const p = path.join(__dirname, '..', 'codex-wrapper.sh');
  assert.ok(fs.existsSync(p), 'codex-wrapper.sh 应存在');
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /exec codex/, '应以 exec codex 收尾(透传参数)');
});

// 假 tmux:把 args 落盘;has-session exit 0(会话"存在")让 sendKeys 走完整链路。
// 经 PATH 注入(本测试文件为独立进程,node --test 每文件一进程,不污染其它测试)。
test('集成(注入假 tmux):sendKeys 收到的命令行含 codex-wrapper.sh 不含 claude', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-tmux-'));
  const log = path.join(dir, 'calls.log');
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    'exit 0',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'tmux'), script, { mode: 0o755 });
  const origPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${origPath}`;
  try {
    const tmux = require('../tmux.cjs');
    const cmd = buildSessionStartCommand({
      engine: 'codex',
      cwd: '/home/u/proj',
      wrapperPath: '/opt/x/codex-wrapper.sh',
    });
    await tmux.sendKeys('sess-a', cmd);
    const logged = fs.readFileSync(log, 'utf8');
    assert.match(logged, /send-keys -t sess-a -l/, '应经 tmux send-keys 下发命令');
    assert.match(logged, /codex-wrapper\.sh/, '命令行须含 codex');
    assert.ok(!logged.includes('claude'), `假 tmux 捕获的命令行不应含 claude,实际: ${logged}`);
  } finally {
    process.env.PATH = origPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 验收 1:缺省零变化(回归保障)----

test('buildSessionStartCommand 缺省 engine → 与既有 claude 组装格式逐字节一致', () => {
  // 改造前 server.cjs 内联组装:`cd "${escapedCwd}" && ${buildClaudeLaunchCommand(...)}`
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const legacy = `cd "/home/u/proj" && ${buildClaudeLaunchCommand({ wrapperPath: '/opt/x/claude-wrapper.sh', sessionId, effort: 'medium' })}`;
  const cmd = buildSessionStartCommand({
    cwd: '/home/u/proj',
    wrapperPath: '/opt/x/claude-wrapper.sh',
    sessionId,
    effort: 'medium',
  });
  assert.equal(cmd, legacy);
  assert.equal(
    cmd,
    'cd "/home/u/proj" && bash "/opt/x/claude-wrapper.sh" --session-id "11111111-2222-3333-4444-555555555555" --effort medium'
  );
});

test('buildEngineLaunchCommand 缺省/claude engine → 与 buildClaudeLaunchCommand 输出一致', () => {
  const args = { wrapperPath: '/tmp/w.sh', sessionId: 'a-b', effort: 'low' };
  assert.equal(buildEngineLaunchCommand(args), buildClaudeLaunchCommand(args));
  assert.equal(buildEngineLaunchCommand({ ...args, engine: 'claude' }), buildClaudeLaunchCommand(args));
});

// ---- 验收 4:依赖检查对称(PATH 无 codex → 安装提示 + exit 1)----

test('depsForEngine("codex") → [tmux, codex],hint 含 npm install -g @openai/codex', () => {
  const deps = depsForEngine('codex');
  assert.deepEqual(deps.map((d) => d.name), ['tmux', 'codex']);
  assert.match(deps[1].hint, /npm install -g @openai\/codex/);
  // 缺省引擎仍查 claude(向后兼容:findMissing(fn) 第二参缺省 'claude')
  assert.deepEqual(findMissing(() => false).map((d) => d.name), ['tmux', 'claude']);
  assert.deepEqual(findMissing(() => false, 'codex').map((d) => d.name), ['tmux', 'codex']);
});

test('engine=codex 且 PATH 无 codex → formatMissing 输出含 @openai/codex 安装提示', () => {
  const out = formatMissing(findMissing((name) => name === 'tmux', 'codex'));
  assert.ok(out.includes('✗ codex'));
  assert.ok(out.includes('npm install -g @openai/codex'), `提示须含安装命令,实际: ${out}`);
});

test('engine=codex 且 PATH 无 codex → main 以 exit code 1 退出且不启动 server', () => {
  const origExit = process.exit;
  const origErr = console.error;
  let exitCode = null;
  let errOut = '';
  process.exit = (code) => { exitCode = code; };
  console.error = (s) => { errOut += String(s); };
  try {
    // opts.engine 注入,绕开真实 config 读取;existsFn:tmux 在、codex 不在。
    main((name) => name === 'tmux', ['node', 'cc-web-control'], { engine: 'codex' });
    assert.equal(exitCode, 1);
    assert.match(errOut, /@openai\/codex/, `stderr 应含安装提示,实际: ${errOut}`);
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
});

test('engine=codex 且 codex 已装(仅 claude 缺)→ 依赖门放行(不再错查 claude)', () => {
  // main 放行后会 startServer(require server.cjs,有真实副作用)——此处只断言依赖门
  // 判定层:findMissing 为空 = 放行。
  const missing = findMissing((name) => name !== 'claude', 'codex');
  assert.deepEqual(missing, []);
});
