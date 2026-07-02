#!/usr/bin/env bash
# Spike: 验证 tmux send-keys 单行 poke 能否可靠唤醒 claude code TUI
#
# 判据:claude 输入框收到消息并开始处理(capture-pane 出现对消息的响应)。
#
# 背景:T1 主 agent 闭环用「单行 sendInput poke」唤醒常驻 claude code TUI
# (@ tmux),让它去 dequeue_event。本 spike 验证这一前置可行性。
#
# 迭代记录见 01-poke-wakeup-result.md。
set -euo pipefail

SESS="cc-spike-poke-$$"
LOG_DIR="$(mktemp -d)"
PANE_LOG="$LOG_DIR/pane.log"

cleanup() {
  tmux kill-session -t "$SESS" 2>/dev/null || true
}
trap cleanup EXIT

echo "[spike] 启动 detached tmux session: $SESS"
# 启动常驻交互式 claude TUI。
# 注意:plan 原稿写的是 `claude --print 'ping'`,那是 headless 单次模式,不是常驻 TUI。
# 这里要验证的是常驻 TUI 被 poke 唤醒,所以用裸 `claude`。
tmux new-session -d -s "$SESS" "claude"

echo "[spike] 等待 claude TUI 冷启动..."
sleep 8

echo "[spike] poke 方式 A: send-keys -l (literal,不解析 key name)"
tmux send-keys -t "$SESS" -l "请只回复两个字:收到"
tmux send-keys -t "$SESS" Enter

echo "[spike] 轮询 capture-pane 直到出现响应或超时(最多 30s)"
OK=0
for i in $(seq 1 30); do
  sleep 1
  PANE="$(tmux capture-pane -t "$SESS" -p -S -80 || true)"
  printf '%s\n' "$PANE" > "$PANE_LOG"
  # 粗判据:pane 里出现"收到"两字(claude 的回复),且不只是在输入框那一行
  if printf '%s' "$PANE" | grep -E "收到" >/dev/null 2>&1; then
    # 排除:只有我们刚发送的那条 prompt(会带"请只回复两个字:收到")
    # claude 的回复应该是单独的"收到"或以"收到"开头
    if printf '%s' "$PANE" | grep -E "^.*收到($|[^两])" >/dev/null 2>&1; then
      OK=1
      echo "[spike] 第 ${i}s 检测到响应"
      break
    fi
  fi
done

echo
echo "===== 方式 A (-l): pane 捕获(最后 50 行) ====="
tmux capture-pane -t "$SESS" -p -S -80 | tail -50
echo

if [ "$OK" = "1" ]; then
  echo "[spike] 方式 A 判定: GO"
else
  echo "[spike] 方式 A 未检测到响应,尝试方式 B 对比..."
  # 直接再发一次,这次不带 -l(让 tmux 当 key sequence 解析)
  tmux send-keys -t "$SESS" "测试二:请回复 OK" Enter
  sleep 15
  echo "===== 方式 B (无 -l): pane 捕获(最后 30 行) ====="
  tmux capture-pane -t "$SESS" -p -S -80 | tail -30
fi

echo
echo "[spike] 完整 pane 日志已存: $PANE_LOG"
echo "[spike] 退出"
