#!/usr/bin/env bash
# docs/main-agent-smoke.sh — 主控 agent(T1 只读参谋)端到端冒烟(半自动)
#
# 副作用:启动 hub、创建 ~/.cc-web-control/main-agent/(.mcp.json + CLAUDE.md,
# 权限 0600)、spawn 一个名为 cc-main-agent 的 tmux 会话并拉起 claude。
#
# 跑前确认:tmux 可用、claude CLI 在 PATH 且已登录、端口(默认 7685)空闲。
# 跑后 Ctrl-C 退出(脚本 trap 自动 kill hub)。
#
# 用法:
#   CC_WEB_HUB_TOKEN=<你的hub token> bash docs/main-agent-smoke.sh
#   # 或直接跑(脚本会用时间戳生成一个临时 token)
#   bash docs/main-agent-smoke.sh
set -euo pipefail

# --- 环境变量装配 ---
# hub 鉴权 token(必需,裸奔会被 server.cjs 拒绝);未传则给一个临时值便于本机冒烟。
export CC_WEB_HUB_TOKEN="${CC_WEB_HUB_TOKEN:-smoke-$(date +%s)}"
# 主控 agent 总开关:必须设 1 才装配(否则 dequeue/ack 端点回 503)。
export CC_WEB_HUB_MAIN_AGENT_ENABLED=1
# 禁止 hub 启动后自动开浏览器(冒烟不需要)。
export CC_WEB_HUB_NO_OPEN=1
PORT="${CC_WEB_HUB_PORT:-7685}"
export CC_WEB_HUB_PORT="$PORT"

# --- 解析入口(经环境变量确认:node hub/server_entry.cjs,不是 bin/cc-web-control-hub.cjs)---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_ENTRY="$SCRIPT_DIR/../hub/server_entry.cjs"

echo "[smoke] 启动 hub(主 agent 已启用),port=$PORT,token=$CC_WEB_HUB_TOKEN"
node "$HUB_ENTRY" &
HUB_PID=$!
cleanup() { kill "$HUB_PID" 2>/dev/null || true; }
trap cleanup EXIT

# 给 hub 启动 + aggregator 首轮聚合 + 主 agent 配置写入 + tmux spawn claude 留点余量。
sleep 3

# --- 默认路径(与 server.cjs setupMainAgent 的默认对齐)---
DATA_DIR="${CC_WEB_HUB_MAIN_AGENT_DATA_DIR:-$HOME/.cc-web-control/main-agent}"
AUDIT="${CC_WEB_HUB_MAIN_AGENT_AUDIT_FILE:-$HOME/.cc-web-control/main-agent-audit.jsonl}"
SESSION="${CC_WEB_HUB_MAIN_AGENT_SESSION:-cc-main-agent}"

echo
echo "===== 1. $SESSION tmux 会话存在?(装配是否 spawn 了 claude)====="
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "PASS: session '$SESSION' exists(主 agent 已 spawn claude)"
else
  echo "FAIL: no session '$SESSION'(检查:claude 是否在 PATH、tmux 是否可用、hub 日志是否报错)"
fi

echo
echo "===== 2. 配置文件已生成(应 0600)? ====="
# 三个文件:.mcp.json(MCP server 声明)+ CLAUDE.md(系统提示)+ mcp-trust.json(无人值守信任)。
# mcp-trust.json 缺失 → claude 卡在 MCP 信任/工具权限确认框、ack 永不到(见 smoke.md 故障排查)。
# shellcheck disable=SC2012
ls -la "$DATA_DIR/.mcp.json" "$DATA_DIR/CLAUDE.md" "$DATA_DIR/mcp-trust.json" 2>/dev/null \
  && echo "(确认上面三行权限均为 -rw------- 即 0600)" \
  || echo "FAIL: 配置文件未生成(检查 $DATA_DIR 是否可写)"

echo
echo "===== 3. .mcp.json 不含 token(安全关键)? ====="
# .mcp.json 只应含 { command, args };token 经 tmux new-session -e 注入 claude 进程环境,
# 由 MCP server 子进程继承,绝不落盘到 .mcp.json。
if grep -q 'CC_WEB_HUB_TOKEN' "$DATA_DIR/.mcp.json" 2>/dev/null; then
  echo "FAIL: token leaked into .mcp.json(安全漏洞!检查 main_agent_config.cjs genMcpConfig)"
else
  echo "PASS: no token in .mcp.json"
fi

echo
echo "===== 4. 审计文件? ====="
if [ -f "$AUDIT" ]; then
  ls -la "$AUDIT"
  echo "(首条审计应在主 agent 首次 enqueue/dequeue 后出现)"
else
  echo "(尚无审计文件 — 正常,等子机状态变化触发首次 enqueue/dequeue)"
fi

echo
echo "===== 5. 手动验收(详见 docs/main-agent-smoke.md)====="
echo "hub PID=$HUB_PID"
echo "另开终端观察主 agent:  tmux attach -t $SESSION"
echo "另开终端看审计流:      tail -f $AUDIT"
echo "触发事件:在某台子机会话里让其进入 errored/idle 并持续 ~6 秒(EventWatcher threshold=3 × intervalMs=2000)"
echo "预期审计序列: enqueue -> dequeue -> poke -> (claude 调 MCP 工具) -> ack"
echo "Ctrl-C 退出并自动清理 hub。"
wait "$HUB_PID"
