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
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { argv, cwd, exit, stdout, stderr } from "node:process";

const REPO_ROOT = cwd();

function parseArgs(args) {
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
    `现在：读 PRD → 规划 → 改代码 → npm test → 到"可提交且 test 绿"即停。`,
    `停下前用一段话总结：改了什么 / test 结果 / 遗留风险。`,
  ].join("\n");

  // 3. SDK dev loop（对齐 Agent-Loop 方案 prd_runner.py / SPEC §决策#23：acceptEdits + settingSources + allowedTools）
  let resultMsg = null;
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
        allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "TodoWrite", "Bash"],
        maxTurns: 150,
        stderr: (data) => process.stderr.write(`[claude] ${data}`),
      },
    });
    for await (const msg of q) {
      if (msg.type === "assistant") {
        const blocks = msg.message?.content ?? [];
        for (const b of blocks) {
          if (b.type === "text") stderr.write(`[dev] ${b.text}\n`);
        }
      } else if (msg.type === "result") {
        resultMsg = msg;
      }
    }
  } catch (e) {
    stderr.write(`✗ SDK dev loop 异常: ${e.message}\n`);
    return 11;
  }

  if (resultMsg?.is_error) {
    stderr.write(`✗ dev loop 返回错误: ${resultMsg.result}\n`);
    return 11;
  }

  const cost = resultMsg?.total_cost_usd ?? null;
  const turns = resultMsg?.num_turns ?? null;

  // 4. dry-run：到此为止
  if (args.dryRun) {
    stdout.write(JSON.stringify({ ok: true, dry_run: true, branch, base, cost, turns, result: resultMsg?.result ?? null }) + "\n");
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

main()
  .then((code) => exit(code ?? 0))
  .catch((e) => {
    stderr.write(`✗ 未捕获异常: ${e.stack || e.message}\n`);
    exit(99);
  });
