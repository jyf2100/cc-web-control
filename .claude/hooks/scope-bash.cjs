#!/usr/bin/env node
// PreToolUse hook (SPEC §决策#23)：把 dev-loop agent 的 Bash 限定到安全前缀白名单。
// 随 worktree 检出生效（.claude/ 已在 .gitignore 放行进 git）。
// 协议：stdin 收 JSON {tool_name, tool_input}；exit 0=放行，exit 2=deny（stderr 反馈给 agent，非致命）。
"use strict";

const ALLOW = [
  /^npm (test|ci|install|i|it|run|run-script|ls|view|why)\b/,
  /^npx\b/,
  /^node\b/,
  /^git (status|diff|log|show|branch|ls-files|blame|rev-parse|describe)\b/,
  /^(ls|ll|cat|head|tail|less|more|pwd|grep|egrep|fgrep|rg|wc|sort|uniq|cut|tr|file|stat|which|basename|dirname|echo|printf|du|df)\b/,
  /^(mkdir|touch|cp|mv)\b/,
  // rm 仅限 scripts/ 下 dev 临时测试文件（cjs/js/mjs/ts/tmp/log/out），禁 -r/-rf 递归，防 rm -rf 式破坏
  /^rm\s+(-[fw]+\s+)?(scripts\/[\w./-]+\.(cjs|js|mjs|ts|tmp|log|out)(\s+|$))+/,
];

// 禁止写文件重定向 / 命令替换 / 后台等绕过手段；允许 fd 重定向（2>&1, >&2）做只读观察
const FORBIDDEN = />(?!&)|<|`|\$\(/;

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let event = {};
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // 非 JSON，放行（不阻塞正常流程）
  }
  if (event.tool_name !== "Bash") process.exit(0);
  const cmd = String((event.tool_input && event.tool_input.command) || "").trim();
  if (!cmd) process.exit(0);
  if (FORBIDDEN.test(cmd)) {
    process.stderr.write(`[scope-bash] 拒绝(含重定向/命令替换): ${cmd.slice(0, 100)}\n`);
    process.exit(2);
  }
  // 按 shell 控制符拆段，每段首词都必须命中白名单（防 npm test && rm -rf 式拼接）
  // & 后非数字才拆（后台/&&）；&数字（如 2>&1 的 fd 重定向）不拆，避免误伤只读观察
  const parts = cmd.split(/[;|]|&(?!\d)/).map((s) => s.trim()).filter(Boolean);
  const pass = parts.length > 0 && parts.every((p) => ALLOW.some((re) => re.test(p)));
  if (pass) process.exit(0);
  process.stderr.write(
    `[scope-bash] 拒绝: ${cmd.slice(0, 100)}\n` +
      `  允许: npm(test/ci/install/run) / npx / node / git(只读) / 常规读命令 / mkdir,touch,cp,mv / rm(仅 scripts/ 临时文件) / 2>&1 fd 重定向(只读观察)\n`
  );
  process.exit(2);
});
