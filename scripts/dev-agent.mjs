#!/usr/bin/env node
/**
 * dev-agent.mjs — 项目推进流水线「目标仓自治 dev agent」（ADR-0003）
 *
 * For future Claude：这是 cc-web-control（及同类目标仓）的自有 dev 循环。
 * 控制面（vault）的 pa-dispatch 投递一份 PRD（--prd），本脚本在目标仓内：
 *   建 feature 分支 → 喂 PRD 给 SDK dev loop → 改代码 → 验证闸（npm test）→
 *   commit → push → 开 PR → stdout 吐一行 JSON。
 *
 * 关键设计（别改坏）：
 *  - 刹车双层：GitHub branch protection（ADR-0003/0004，主干永不被直推）+ 本地 allowedTools 有界放行。
 *    遵循 ~/.claude/rules/common/hooks.md「Never use dangerously-skip-permissions; Configure allowedTools instead」
 *    —— 不用 bypassPermissions（= dangerously-skip 的 SDK 形态）；列表内工具自动放行（headless 非交互），表外被拒。
 *  - 模型：刻意 OMIT options.model → 走 roc 的 LiteLLM 代理默认（glm-5.2）。
 *    切勿传裸 Anthropic model id（如 claude-haiku-4-5-...），代理判非法（Phase-0 教训）。
 *  - persona 约束见仓库根 CLAUDE.md（dev loop 默认加载 project 记忆）。
 *
 * 用法（pa-dispatch 自动调，或人手动）：
 *   node scripts/dev-agent.mjs --prd <prd.md> [--source <signal.md>] [--base main] [--dry-run]
 *
 * 退出码：0=成功（开 PR 或 dry-run 完成）| 10=PRD 缺失/读不到 | 11=SDK dev loop 失败 |
 *         13=git/push/PR 失败 | 99=未捕获
 *
 * stdout 只输出最终一行 JSON（供 pa-dispatch 解析）；过程日志全走 stderr。
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { argv, cwd, exit, stdout, stderr } from "node:process";

const REPO_ROOT = cwd();

// ─── 仓内主动刹车 + 监控常量（SPEC §决策#27，2026-07-16 grill 共识）───
export const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]); // 写类工具（Bash 不算：跑 test/git，不直接判为"尝试修代码"）
export const N_STALL = 3;              // verifiedRed 后连续 N 轮无写类 tool_use → stalled
export const INPUT_TRUNC = 500;        // tool_use.input 落盘截断
export const MAX_BUDGET = 10;          // maxBudgetUsd（降级兜底，宽松）
const STATE_RUNS_DIR = join(REPO_ROOT, "state", "runs");

export function parseArgs(args) {
  const out = { prd: null, source: null, base: "main", dryRun: false, branchPrefix: "pa-dev", help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--prd") out.prd = args[++i];
    else if (a === "--source") out.source = args[++i];
    else if (a === "--base") out.base = args[++i];
    else if (a === "--branch-prefix") out.branchPrefix = args[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

const HELP = `dev-agent.mjs — 目标仓自治 dev agent（ADR-0003）
用法: node scripts/dev-agent.mjs --prd <prd.md> [--source <signal.md>] [--base main] [--dry-run]
  --prd            PRD 文件路径（必填，来自控制面 pa-prd）
  --source         触发该任务的信号文件（可选，附给 dev agent 做上下文）
  --base           分支基点（默认 main；branch protection 下永不直推主干）
  --dry-run        只跑到"改完代码 + 本地 test"，不 commit/push/开 PR
退出码: 0 OK | 10 无/读不到 PRD | 11 SDK 失败 | 13 git/PR 失败 | 99 未捕获`;

/** 跑 git（arg 数组，无 shell 注入风险）；非零抛异常，e.stderr 带错误。 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
  } catch (e) {
    const detail = (e.stderr?.toString() ?? e.message ?? "").trim();
    throw new Error(`git ${args.join(" ")} 失败: ${detail}`);
  }
}

/** 跑 gh（同上）。 */
function gh(args) {
  try {
    return execFileSync("gh", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
  } catch (e) {
    const detail = (e.stderr?.toString() ?? e.message ?? "").trim();
    throw new Error(`gh ${args.join(" ")} 失败: ${detail}`);
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function readText(p) {
  try {
    return readFileSync(resolve(p), "utf8");
  } catch {
    return null;
  }
}

/** 截断字符串到 n（落盘防大 input 撑爆日志）。 */
export function trunc(s, n) {
  const x = (s ?? "").toString();
  return x.length > n ? x.slice(0, n) + "…[trunc]" : x;
}

/** git diff --stat 摘要（取末 3 行拼一行，截 200 字符；失败返空串）。 */
function gitDiffStat() {
  try {
    return git(["diff", "--stat"]).split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 200);
  } catch {
    return "";
  }
}

/** 识别 npm test 结果红/绿（配对 Bash npm test 的 tool_result 文本）。有失败优先 red。
 *  覆盖 node --test 格式（ℹ pass N / ℹ fail M）+ npm 层（npm ERR! Test failed）+ jest 风格（passing/failed）。 */
export function classifyTestResult(text) {
  const t = (text ?? "").toLowerCase();
  const hasFail = /failed|failing|npm err|test failed|\bfail\s+[1-9]/.test(t);  // fail 0 不算红
  const hasPass = /passing|passed|\bpass\s+[1-9]/.test(t);                        // pass 0 不算绿
  if (hasFail) return "red";
  if (hasPass) return "green";
  return null;
}

/** 判定一次"干净" Bash `npm test` 的红/绿（SPEC #27 ② 主力刹车的 verifiedRed 信号源）。
 *  优先用 tool_result.is_error（= 退出码：node --test 失败必 exit≠0）—— 不依赖输出文本，
 *  避开大输出被 SDK 截断后文本解析失效的问题（本仓 744 测试，npm test 输出恒大、尾部汇总被截）。
 *  因捕获端已过滤掉带管道/重定向的变体（hook 会拒），此处无需再判 hook 拒绝文案。
 *  is_error 缺失（某些代理回传不含该字段）→ fallback 到文本解析 classifyTestResult。 */
export function classifyTestExit(toolResult, text) {
  if (toolResult?.is_error === true) return "red";    // exit≠0 = 测试失败
  if (toolResult?.is_error === false) return "green"; // exit 0 = 通过（不靠文本，避截断）
  return classifyTestResult(text);                    // is_error 缺失 → 文本 fallback（小输出可靠）
}

/** 判定 Bash command 是否为"干净" npm test（SPEC #27：捕获端过滤）。
 *  只跟踪无管道/重定向/链式的裸 npm test —— 这类不被 scope-bash hook 拒，
 *  tool_result 才是真结果、is_error 才可信；带 |>&; 的变体 hook 会拒，结果无意义。 */
export function isCleanNpmTest(cmd) {
  const c = (cmd ?? "").toString().trim();
  return /^\s*npm\s+(run\s+)?test\b/.test(c) && !/[|>&;]/.test(c);
}

/** 落盘一行 run 记录到 state/runs/<branch>-<stamp>.jsonl（SPEC #27 监控，per-turn）。失败忽略不阻塞 loop。 */
function appendRunLine(runLogPath, obj) {
  try {
    mkdirSync(STATE_RUNS_DIR, { recursive: true });
    appendFileSync(runLogPath, JSON.stringify(obj) + "\n", "utf8");
  } catch (e) {
    stderr.write(`⚠ run 落盘失败（忽略）: ${e.message}\n`);
  }
}

/** 创建 dev loop 状态对象（processDevLoop 的可注入状态；测试用此构造初始态）。 */
export function createLoopState(runLogPath) {
  return {
    runLogPath,
    turn: 0,
    lastTest: null,          // null | "green" | "red"（最近一次 npm test 结果，动态）
    noWriteStreak: 0,        // verifiedRed（lastTest==="red"）后连续无写类轮数
    stalled: false,
    pendingTestIds: new Set(), // 待配对 tool_result 的 Bash `npm test` tool_use_id
  };
}

/** dev loop 循环体（SPEC #27：监控落盘 + ② 无进展刹车 + ③ 配对 tool_result 拿红/绿）。
 *  从 main 抽出以支持喂脚本化 msg 序列做 stall E2E（真 dev loop 无法构造"持续红+无写类"场景，
 *  dev 守则要求绝不留红）。行为与原内联 for-await 等价：
 *  - assistant msg：计数 turn、收集 tool_use、落盘 per-turn jsonl、② 无进展计数 + stall break；
 *  - user msg：配对 tool_result 拿 npm test 红/绿（动态更新 lastTest）；
 *  - result msg：捕获 resultMsg 返回。
 *  state 由调用方持有，函数读写其字段；返回 resultMsg（可能为 null）。 */
export async function processDevLoop(messages, state) {
  let resultMsg = null;
  for await (const msg of messages) {
    if (msg.type === "assistant") {
      state.turn += 1;
      const blocks = msg.message?.content ?? [];
      let hasWrite = false;
      const toolUses = [];
      for (const b of blocks) {
        if (b.type === "text") {
          stderr.write(`[dev] ${b.text}\n`);
        } else if (b.type === "tool_use") {
          const name = b.name ?? "?";
          const input = b.input ?? {};
          const target = input.file_path || input.path || input.notebook_path
            || (typeof input.command === "string" ? input.command.split("\n")[0] : "") || "";
          toolUses.push({ name, target: trunc(target, 120), input: trunc(JSON.stringify(input), INPUT_TRUNC) });
          if (WRITE_TOOLS.has(name)) hasWrite = true;
          if (name === "Bash" && typeof input.command === "string") {
            if (isCleanNpmTest(input.command.trim())) {
              state.pendingTestIds.add(b.id); // 标记，等下个 user msg 配对 tool_result 拿红/绿
            }
          }
        }
      }
      // ② 无进展计数：本轮有写类 → 重置；无写类且当前 test 红 → +1（test 未红不数，避前期误杀）
      if (hasWrite) state.noWriteStreak = 0;
      else if (state.lastTest === "red") state.noWriteStreak += 1;
      appendRunLine(state.runLogPath, {
        turn: state.turn, tool_use: toolUses, diff_stat: gitDiffStat(), test: state.lastTest,
        verified_red: state.lastTest === "red", no_write_streak: state.noWriteStreak,
      });
      if (state.lastTest === "red" && state.noWriteStreak >= N_STALL) {
        state.stalled = true;
        stderr.write(`🧯 stalled：验证红后连续 ${state.noWriteStreak} 轮无写类进展（Edit/Write/MultiEdit），主动刹车\n`);
        break;
      }
    } else if (msg.type === "user") {
      // 配对 tool_result（补 #27 前丢弃的 user msg）→ 拿 npm test 红/绿
      const blocks = msg.message?.content ?? msg.content ?? [];
      if (blocks.length) stderr.write(`[dev] ← user msg（${blocks.length} blocks）\n`);
      for (const b of blocks) {
        if (b.type === "tool_result" && state.pendingTestIds.has(b.tool_use_id)) {
          const txt = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
          const res = classifyTestExit(b, txt);
          if (res) {
            state.lastTest = res;
            stderr.write(`[dev] npm test → ${res}（is_error=${b.is_error}, ${txt.length} chars）\n`);
          } else {
            stderr.write(`[dev] npm test 结果未识别（is_error=${b.is_error}, ${txt.length} chars）\n`);
          }
          state.pendingTestIds.delete(b.tool_use_id);
        }
      }
    } else if (msg.type === "result") {
      resultMsg = msg;
    }
  }
  return resultMsg;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  if (args.help) {
    stdout.write(HELP + "\n");
    return 0;
  }
  if (!args.prd) {
    stderr.write("✗ 缺 --prd（控制面投递的 PRD）\n" + HELP + "\n");
    return 10;
  }

  const prdText = readText(args.prd);
  if (prdText === null) {
    stderr.write(`✗ 读不到 PRD: ${args.prd}\n`);
    return 10;
  }

  const base = args.base;
  const slug = basename(args.prd, ".md").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  const branch = `${args.branchPrefix}/${stamp()}-${slug}`;

  // 1. 建 feature 分支（基于 base；不碰主干）
  try {
    git(["checkout", "-b", branch, base]);
  } catch (e) {
    stderr.write(`✗ 建分支失败: ${e.message}\n`);
    return 13;
  }

  // 2. 组 prompt：PRD + 可选 source + 自治守则（与根 CLAUDE.md 互为兜底）
  const sourceBlock = args.source
    ? `\n\n## 触发信号（来自控制面 pa-radar）\n\`\`\`\n${readText(args.source) ?? "(读不到 source)"}\n\`\`\``
    : "";

  const prompt = [
    `你是本仓（cc-web-control）的自治 dev agent。当前分支 ${branch}（基点 ${base}）。`,
    `主干 ${base} 有 branch protection——你永远只在这个 feature 分支上干活，绝不直推主干。`,
    ``,
    `## 你的任务（PRD）`,
    prdText,
    sourceBlock,
    ``,
    `## 自治守则（详见仓库根 CLAUDE.md）`,
    `1. 只在当前分支、本仓范围内改；不大规模重构无关代码。`,
    `2. 改完必须跑验证闸 \`npm test\`（= node --test test/*.test.cjs）。红=失败，修到绿或回滚，绝不留红。`,
    `3. 遵循既有风格：本仓主体是 .cjs + CommonJS（require）；新独立脚本可用 .mjs。`,
    `4. commit 用 conventional commits，只 commit 与 PRD 相关的改动。`,
    `5. 不要 push、不要开 PR——push/PR 由本脚本在你停下后代办。`,
    `6. 不碰 .github/ branch protection、不 force push、不删分支、不 npm publish、不动 pretext/（vendored 独立子项目）。`,
    ``,
    `## 何时用子代理分工（Agent 工具）`,
    `满足任一才考虑分工，否则单干（子代理有独立 context 成本，别为分工而分工）：`,
    `- PRD 横跨多个独立关注点（新增功能 + 补测试 + 审类型，可拆开）；`,
    `- 估摸单干要 30+ turn 或读改 5+ 文件。`,
    ``,
    `分工纪律：`,
    `- 用 Agent 工具 spawn 子代理，每个单一职责（"写 X 测试"/"实现 Y"/"审查 Z 类型"）；`,
    `- 给子代理明确目标 + 限定它只动该职责范围内文件；`,
    `- 子代理产出回你这里，由你整合 + 跑 npm test 验证整体；`,
    `- commit/push 仍只由你（parent）守，子代理不碰 git。`,
    ``,
    `现在：读 PRD → 规划 → 改代码 → npm test → 到"可提交且 test 绿"即停。`,
    `停下前用一段话总结：改了什么 / test 结果 / 遗留风险。`,
  ].join("\n");

  // 3. SDK dev loop（对齐 Agent-Loop 方案 prd_runner.py / SPEC §决策#23：acceptEdits + settingSources + allowedTools）
  //    监控 + ②无进展刹车 状态（SPEC #27）打包进 state，循环体抽到 processDevLoop 供测试注入 msg 流。
  const runLogPath = join(STATE_RUNS_DIR, `${branch.replace(/\//g, "-")}-${stamp()}.jsonl`);
  const state = createLoopState(runLogPath);
  let resultMsg;
  try {
    const q = query({
      prompt,
      options: {
        cwd: REPO_ROOT,
        // model: 刻意省略 → 走 roc 代理默认（glm-5.2）
        // 权限（对齐 prd_runner.py / SPEC §决策#23 ——Node SDK 与 Python SDK 同源，options 字段语义一一对应，
        //   仅命名 snake_case↔camelCase：permission_mode↔permissionMode、setting_sources↔settingSources）：
        //   permissionMode=acceptEdits → 编辑类自动过（fail-safe，摩擦≈bypass 但不裸放）；
        //   settingSources=["project"] → 加载仓 CLAUDE.md(dev 守则) + .claude/hooks（PreToolUse 限 Bash 前缀）；
        //   allowedTools 定向放行（headless 非交互）；表外被拒。非 bypassPermissions（遵 hooks.md）。
        permissionMode: "acceptEdits",
        settingSources: ["project"],
        allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "TodoWrite", "Bash", "Agent"], // Agent = 子代理分工放行（SPEC §决策#29）
        maxTurns: 150,
        maxBudgetUsd: MAX_BUDGET, // ③ 预算刹车（降级兜底，SPEC #27；LiteLLM cost 准确性待实测）
        stderr: (data) => process.stderr.write(`[claude] ${data}`),
      },
    });
    resultMsg = await processDevLoop(q, state);
  } catch (e) {
    stderr.write(`✗ SDK dev loop 异常: ${e.message}\n`);
    return 11;
  }

  const cost = resultMsg?.total_cost_usd ?? null;
  const turns = resultMsg?.num_turns ?? state.turn;

  // ③ 预算自检（降级兜底，#27）：cost 未回传/为 0 → 预算刹车形同虚设，仅 maxTurns 兜底
  if (cost === null || cost === undefined || cost === 0) {
    stderr.write(`⚠ 预算刹车未生效（total_cost_usd=${cost}，cost 未回传），仅 maxTurns 兜底\n`);
  } else {
    stderr.write(`💰 本次 cost=$${cost}（maxBudgetUsd=${MAX_BUDGET}）\n`);
  }

  // stalled：不 commit/不开 PR，吐 JSON + exit 12（SPEC #27 / grill 决策5；半成品靠 run_log 留痕）
  if (state.stalled) {
    stdout.write(JSON.stringify({ ok: false, stalled: true, branch, base, run_log: runLogPath, cost, turns }) + "\n");
    return 12;
  }

  if (resultMsg?.is_error) {
    stderr.write(`✗ dev loop 返回错误: ${resultMsg.result}\n`);
    return 11;
  }

  // 4. dry-run：到此为止
  if (args.dryRun) {
    stdout.write(JSON.stringify({ ok: true, dry_run: true, branch, base, cost, turns, run_log: runLogPath, result: resultMsg?.result ?? null }) + "\n");
    return 0;
  }

  // 5. commit + push + 开 PR（branch protection 要求走 PR）
  try {
    git(["add", "-A"]);
    const diffStat = git(["diff", "--cached", "--stat"]);
    if (!diffStat) {
      stdout.write(JSON.stringify({ ok: true, no_changes: true, branch, base, cost, turns }) + "\n");
      return 0;
    }
    git(["commit", "-m", `feat(pa-dev): ${basename(args.prd, ".md")}`, "-m", `项目推进流水线 dev-agent.mjs 自治产出（基点 ${base}）。`]);
    git(["push", "-u", "origin", branch]);
    const prUrl = gh(["pr", "create", "--base", base, "--head", branch, "--title", `pa-dev: ${basename(args.prd, ".md")}`, "--body", "自治 dev agent 产出（PRD 见任务投递）。验证闸 npm test 已绿。"]);
    stdout.write(JSON.stringify({ ok: true, branch, base, pr_url: prUrl, cost, turns }) + "\n");
    return 0;
  } catch (e) {
    stderr.write(`✗ git/push/PR 阶段失败: ${e.message}\n`);
    stdout.write(JSON.stringify({ ok: false, error: e.message, branch, base, cost, turns }) + "\n");
    return 13;
  }
}

// main guard：仅当本文件是 node 入口（argv[1] 指向它）时跑 main；
// 被 import 做单测时不跑（import.meta.url ≠ argv[1] 的 file:// URL）。
const __entryUrl = argv[1] ? pathToFileURL(argv[1]).href : "";
if (import.meta.url === __entryUrl) {
  main()
    .then((code) => exit(code ?? 0))
    .catch((e) => {
      stderr.write(`✗ 未捕获异常: ${e.stack || e.message}\n`);
      exit(99);
    });
}
