#!/usr/bin/env bash
# 验证:含换行的文本经 tmux send-keys -l 是否被逐行拆成多次提交(预期:会)
# 这是 spec §4 改 pull 模型的根因,此 spike 留作实证记录
set -euo pipefail
SESS="cc-spike-ml-$$"
tmux new-session -d -s "$SESS" "bash"
sleep 1
# 模拟一条多行事件消息(载荷含换行)
tmux send-keys -t "$SESS" -l "$(printf '[EVENT] mc1/sess1 errored\n尾部输出: error X\n请诊断')"
tmux send-keys -t "$SESS" Enter
sleep 1
echo "===== bash 把它当几条命令执行? ====="
tmux capture-pane -t "$SESS" -p | tail -25
tmux kill-session -t "$SESS"
