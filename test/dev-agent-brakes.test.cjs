// dev-agent 刹车 / 监控路径的确定性测试（SPEC #27，Phase 3.5）。
//
// 为什么需要这套测试：
//   ① classifyTestExit / isCleanNpmTest / classifyTestResult 是纯函数，直接断言即可。
//   ② stall 刹车（无进展刹车）无法用真 dev loop E2E 测——dev agent 守则要求「绝不留红」，
//     无法在真 loop 里构造「持续红 + 连续无写类」的真实场景。dev-agent.mjs 已把 for-await
//     循环体抽成 processDevLoop(messages, state)，接收可注入的 async iterable<msg>，
//     测试喂脚本化 msg 序列即可断言 stalled 路径。这是本套件的核心。
//
// 从 .cjs 测 .mjs：用 dynamic import()（top-level Promise，每个 test await 同一个）。
// dev-agent.mjs 有 main guard（import.meta.url === pathToFileURL(argv[1]).href），
// 被 import 时 main 不执行，安全。

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, unlinkSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const modPromise = import("../scripts/dev-agent.mjs");

// ─── msg 序列构造 helpers（模拟 Claude Agent SDK query() 流出的 msg）───
const text = (t) => ({ type: "text", text: t });
const bashUse = (id, command) => ({ type: "tool_use", id, name: "Bash", input: { command } });
const writeUse = (id, name, filePath = "/tmp/x") => ({ type: "tool_use", id, name, input: { file_path: filePath } });
const assistantMsg = (...blocks) => ({ type: "assistant", message: { content: blocks } });
const userResult = (toolUseId, isError, content) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: isError, content }] },
});

/** 把数组包成 async iterable（模拟 SDK 的 query() 流）。 */
async function* fromArray(arr) {
  for (const m of arr) yield m;
}

/** 每个用例独立的临时 jsonl 路径（测 appendRunLine 落盘）。 */
let _seq = 0;
function tmpRunLog() {
  _seq += 1;
  return join(tmpdir(), `dev-agent-test-${process.pid}-${_seq}.jsonl`);
}

// ════════════════════════════════════════════════════════════════════
// 1. classifyTestResult — 文本红/绿识别（fallback 路径，is_error 缺失时用）
// ════════════════════════════════════════════════════════════════════
test("classifyTestResult: node --test 绿汇总 → green", async () => {
  const { classifyTestResult } = await modPromise;
  assert.equal(classifyTestResult("ℹ pass 744"), "green");
  assert.equal(classifyTestResult("ℹ pass 744 tests"), "green");
  assert.equal(classifyTestResult("✓ 10 passing"), "green");
  assert.equal(classifyTestResult("all passed"), "green");
});

test("classifyTestResult: 失败关键词 → red", async () => {
  const { classifyTestResult } = await modPromise;
  assert.equal(classifyTestResult("✗ fail 1"), "red");
  assert.equal(classifyTestResult("tests failed"), "red");
  assert.equal(classifyTestResult("npm ERR! Test failed. See above."), "red");
  assert.equal(classifyTestResult("5 failing"), "red");
});

test("classifyTestResult: 大小写不敏感（FAILED → red）", async () => {
  const { classifyTestResult } = await modPromise;
  assert.equal(classifyTestResult("TEST FAILED"), "red");
  assert.equal(classifyTestResult("NPM Err! something"), "red");
});

test("classifyTestResult: pass 0 / fail 0 不算（避免零值误判）", async () => {
  const { classifyTestResult } = await modPromise;
  // 正则要求 pass|fail 后跟 [1-9]，0 不计数
  assert.equal(classifyTestResult("pass 0"), null);
  assert.equal(classifyTestResult("fail 0"), null);
});

test("classifyTestResult: 无关键词 → null", async () => {
  const { classifyTestResult } = await modPromise;
  assert.equal(classifyTestResult(""), null);
  assert.equal(classifyTestResult(null), null);
  assert.equal(classifyTestResult(undefined), null);
  assert.equal(classifyTestResult("building..."), null);
});

test("classifyTestResult: 红/绿混合时红优先（fail 优先级高于 pass）", async () => {
  const { classifyTestResult } = await modPromise;
  // 真实场景：部分过部分挂
  assert.equal(classifyTestResult("pass 5 but fail 1"), "red");
  assert.equal(classifyTestResult("10 passing, 2 failed"), "red");
});

// ════════════════════════════════════════════════════════════════════
// 2. classifyTestExit — is_error 优先 + 文本 fallback
//    SPEC #27 关键：大输出被 SDK 截断后尾部汇总不可见，必须靠 is_error 不靠文本。
// ════════════════════════════════════════════════════════════════════
test("classifyTestExit: is_error=true → red（不管文本，避截断误判）", async () => {
  const { classifyTestExit } = await modPromise;
  assert.equal(classifyTestExit({ is_error: true }, "随便截断的文本"), "red");
  assert.equal(classifyTestExit({ is_error: true }, ""), "red");
  assert.equal(classifyTestExit({ is_error: true }, "pass 744"), "red"); // 文本说绿但 exit≠0，红优先
});

test("classifyTestExit: is_error=false → green（不靠文本）", async () => {
  const { classifyTestExit } = await modPromise;
  assert.equal(classifyTestExit({ is_error: false }, "截断了看不到汇总"), "green");
  assert.equal(classifyTestExit({ is_error: false }, ""), "green");
});

test("classifyTestExit: is_error 缺失 → fallback 到文本解析", async () => {
  const { classifyTestExit } = await modPromise;
  assert.equal(classifyTestExit({}, "pass 10"), "green");
  assert.equal(classifyTestExit({}, "fail 1"), "red");
  assert.equal(classifyTestExit({}, "???"), null);
  assert.equal(classifyTestExit({ is_error: null }, "passed"), "green"); // null 不是 true/false → fallback
  assert.equal(classifyTestExit({ is_error: undefined }, "failing"), "red");
});

// ════════════════════════════════════════════════════════════════════
// 3. isCleanNpmTest — 捕获端过滤（只跟"干净" npm test，避 hook 拒绝的变体）
// ════════════════════════════════════════════════════════════════════
test("isCleanNpmTest: 裸 npm test / npm run test → true", async () => {
  const { isCleanNpmTest } = await modPromise;
  assert.equal(isCleanNpmTest("npm test"), true);
  assert.equal(isCleanNpmTest("npm run test"), true);
  assert.equal(isCleanNpmTest("  npm test  "), true); // 容错 trim
  assert.equal(isCleanNpmTest("npm test --grep foo"), true); // 允许尾部参数
});

test("isCleanNpmTest: 带管道/重定向/链式 → false（scope-bash hook 会拒）", async () => {
  const { isCleanNpmTest } = await modPromise;
  assert.equal(isCleanNpmTest("npm test 2>&1"), false);
  assert.equal(isCleanNpmTest("npm test | tee log"), false);
  assert.equal(isCleanNpmTest("npm test > out.txt"), false);
  assert.equal(isCleanNpmTest("npm test; echo done"), false);
  assert.equal(isCleanNpmTest("npm test && echo ok"), false);
});

test("isCleanNpmTest: 非 npm test 命令 → false", async () => {
  const { isCleanNpmTest } = await modPromise;
  assert.equal(isCleanNpmTest("yarn test"), false);
  assert.equal(isCleanNpmTest("node --test test/"), false);
  assert.equal(isCleanNpmTest("npm tests"), false);  // test\b 边界，tests 不匹配
  assert.equal(isCleanNpmTest("npm run"), false);
  assert.equal(isCleanNpmTest(""), false);
  assert.equal(isCleanNpmTest(null), false);
});

// ════════════════════════════════════════════════════════════════════
// 4. trunc — 落盘防大 input
// ════════════════════════════════════════════════════════════════════
test("trunc: 短串原样、长串截断加尾标", async () => {
  const { trunc } = await modPromise;
  assert.equal(trunc("hello", 10), "hello");
  assert.equal(trunc("hello world", 5), "hello…[trunc]");
  assert.equal(trunc("ab", 1), "a…[trunc]");
});

test("trunc: null/数字/未定义容错", async () => {
  const { trunc } = await modPromise;
  assert.equal(trunc(null, 5), "");
  assert.equal(trunc(undefined, 5), "");
  assert.equal(trunc(123, 10), "123");
});

// ════════════════════════════════════════════════════════════════════
// 5. parseArgs — CLI 解析
// ════════════════════════════════════════════════════════════════════
test("parseArgs: 默认值", async () => {
  const { parseArgs } = await modPromise;
  const a = parseArgs([]);
  assert.equal(a.prd, null);
  assert.equal(a.source, null);
  assert.equal(a.base, "main");
  assert.equal(a.dryRun, false);
  assert.equal(a.branchPrefix, "pa-dev");
  assert.equal(a.help, false);
});

test("parseArgs: 各 flag 解析", async () => {
  const { parseArgs } = await modPromise;
  const a = parseArgs(["--prd", "foo.md", "--base", "dev", "--source", "sig.md", "--dry-run", "--branch-prefix", "x"]);
  assert.equal(a.prd, "foo.md");
  assert.equal(a.base, "dev");
  assert.equal(a.source, "sig.md");
  assert.equal(a.dryRun, true);
  assert.equal(a.branchPrefix, "x");
});

test("parseArgs: -h / --help", async () => {
  const { parseArgs } = await modPromise;
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--help"]).help, true);
});

// ════════════════════════════════════════════════════════════════════
// 6. processDevLoop — stall 刹车 E2E（核心）
//    用脚本化 msg 序列注入，断言 stalled 路径。无法用真 dev loop 测。
// ════════════════════════════════════════════════════════════════════

test("stall: 红 + 连续 3 轮无写类 → stalled=true 并 break（主力路径）", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "fail 1"),               // → lastTest=red
    assistantMsg(text("读代码找 bug")),              // 无写类 → streak=1
    assistantMsg(bashUse("t2", "grep -r foo .")),    // Bash 读类不算写 → streak=2
    assistantMsg(text("还在想")),                     // 无写类 → streak=3 → stall break
    assistantMsg(text("不该被处理（break 后）")),     // 断言 break 生效：此 msg 不进 turn
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, true, "应 stalled");
  assert.equal(state.lastTest, "red");
  assert.equal(state.noWriteStreak, 3);
  assert.equal(state.turn, 4, "break 前共 4 个 assistant msg 进入 turn 计数；seq 里第 5 个 assistant（索引 5）因 break 不处理");
});

test("stall: 红 + 中间 Write → 重置 streak，不 stall", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "fail"),                  // red
    assistantMsg(text("thinking")),                  // streak=1
    assistantMsg(writeUse("w1", "Write")),            // hasWrite → streak=0
    assistantMsg(text("thinking")),                  // streak=1
    assistantMsg(text("thinking")),                  // streak=2（未达 3）
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, false, "Write 重置后不应 stall");
  assert.equal(state.noWriteStreak, 2);
});

test("stall: 红 + MultiEdit → 同样重置 streak（写类集合覆盖）", async () => {
  const { processDevLoop, createLoopState, WRITE_TOOLS } = await modPromise;
  assert.ok(WRITE_TOOLS.has("MultiEdit"), "前置：MultiEdit 在写类集合");
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "fail"),
    assistantMsg(text(".")),                         // streak=1
    assistantMsg(writeUse("m1", "MultiEdit")),        // → streak=0
    assistantMsg(text(".")),                         // streak=1
    assistantMsg(text(".")),                         // streak=2
    assistantMsg(text(".")),                         // streak=3 → stall
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, true, "MultiEdit 重置后从 0 重新累计到 3 应 stall");
  assert.equal(state.noWriteStreak, 3);
});

test("stall: 未跑过 test（lastTest=null）连续无写类 → 不计数、不 stall（避前期误杀）", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(text("读 PRD")),
    assistantMsg(text("规划")),
    assistantMsg(text("读代码")),
    assistantMsg(text("还在读")),
    assistantMsg(text("继续")),
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, false);
  assert.equal(state.noWriteStreak, 0, "lastTest !== red 时不计数");
  assert.equal(state.lastTest, null);
});

test("stall: test 绿（lastTest=green）连续无写类 → 不计数（绿不是 verifiedRed）", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", false, "pass 744"),             // green
    assistantMsg(text("done")),
    assistantMsg(text("idle")),
    assistantMsg(text("idle2")),
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, false);
  assert.equal(state.noWriteStreak, 0, "green 不触发计数");
  assert.equal(state.lastTest, "green");
});

test("stall: 红 + 仅 2 轮无写类 → 未达 N_STALL=3，不 stall", async () => {
  const { processDevLoop, createLoopState, N_STALL } = await modPromise;
  assert.equal(N_STALL, 3, "前置：阈值=3");
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "fail"),
    assistantMsg(text(".")),                         // streak=1
    assistantMsg(text(".")),                         // streak=2（结束，未到 3）
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, false);
  assert.equal(state.noWriteStreak, 2);
});

test("stall: 动态修绿回退 — 红→绿后停止累计（SPEC #27 verifiedRed 动态口径）", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "fail"),                  // red
    assistantMsg(text("修 bug")),                    // streak=1
    assistantMsg(bashUse("t2", "npm test")),         // Bash 跑 test，streak=2（还没绿）
    userResult("t2", false, "pass 744"),             // → green（动态修绿）
    assistantMsg(text("ok")),                        // lastTest=green，不计数，streak 保持 2
    assistantMsg(text("idle")),
    assistantMsg(text("idle")),
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.stalled, false, "修绿后不再累计，不 stall");
  assert.equal(state.lastTest, "green");
  assert.equal(state.noWriteStreak, 2, "修绿后 streak 冻结不再增长");
});

test("stall: is_error 主导 — 真 exit≠0 即使输出被截断只剩 '...' 也判红", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  // 模拟本仓 744 测试场景：npm test 输出巨大被 SDK 截断，尾部汇总看不到
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "...（中间几千行 test 输出，尾部 pass/fail 汇总被 SDK 截断看不到）"),
    assistantMsg(text(".")),
    assistantMsg(text(".")),
    assistantMsg(text(".")),                         // streak=3 → stall
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.lastTest, "red", "is_error=true 主导，不靠被截断的文本");
  assert.equal(state.stalled, true);
});

test("stall: 带管道的 npm test 不被跟踪（isCleanNpmTest 过滤）→ tool_result 不更新 lastTest", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const state = createLoopState(tmpRunLog());
  const seq = [
    assistantMsg(bashUse("t1", "npm test | tee log")), // 不干净，不跟踪
    userResult("t1", true, "fail"),                   // tool_use_id 不在 pendingTestIds → 不更新 lastTest
    assistantMsg(text(".")),
    assistantMsg(text(".")),
    assistantMsg(text(".")),
  ];
  await processDevLoop(fromArray(seq), state);
  assert.equal(state.lastTest, null, "带管道变体 tool_result 被忽略，lastTest 保持 null");
  assert.equal(state.stalled, false, "未红不计数");
  assert.equal(state.noWriteStreak, 0);
});

// ════════════════════════════════════════════════════════════════════
// 7. 监控落盘 — per-turn jsonl（SPEC #27 监控）
// ════════════════════════════════════════════════════════════════════
test("监控: per-turn jsonl 落盘可解析（turn/tool_use/test/no_write_streak 字段齐）", async () => {
  const { processDevLoop, createLoopState } = await modPromise;
  const logPath = tmpRunLog();
  const state = createLoopState(logPath);
  const seq = [
    assistantMsg(bashUse("t1", "npm test")),
    userResult("t1", true, "fail 1"),
    assistantMsg(text("thinking")),
  ];
  await processDevLoop(fromArray(seq), state);

  assert.ok(existsSync(logPath), "jsonl 应已落盘");
  const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "每个 assistant msg = 一行（user msg 不落盘）");

  const r1 = JSON.parse(lines[0]);
  assert.equal(r1.turn, 1);
  assert.equal(r1.tool_use.length, 1);
  assert.equal(r1.tool_use[0].name, "Bash");
  assert.equal(r1.test, null, "首 assistant msg 时 lastTest 还是 null");
  assert.equal(r1.verified_red, false);

  const r2 = JSON.parse(lines[1]);
  assert.equal(r2.turn, 2);
  assert.equal(r2.test, "red", "user msg 把 lastTest 更新为 red 后，本 assistant 落盘时 test=red");
  assert.equal(r2.verified_red, true);
  assert.equal(r2.no_write_streak, 1);

  unlinkSync(logPath);
});

test("createLoopState: 初始态字段齐全", async () => {
  const { createLoopState } = await modPromise;
  const s = createLoopState("/tmp/foo.jsonl");
  assert.equal(s.runLogPath, "/tmp/foo.jsonl");
  assert.equal(s.turn, 0);
  assert.equal(s.lastTest, null);
  assert.equal(s.noWriteStreak, 0);
  assert.equal(s.stalled, false);
  assert.ok(s.pendingTestIds instanceof Set);
  assert.equal(s.pendingTestIds.size, 0);
});
