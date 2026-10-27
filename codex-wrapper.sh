#!/bin/bash
# OpenAI Codex CLI 包装脚本:与 claude-wrapper.sh 对应的启动路径(engine=codex)。
# cc-web-control 经 buildEngineLaunchCommand 拼成 bash "<本脚本>" 在 tmux 会话内启动 codex。
# 首版不注入 --session-id/--resume(jsonl 事前绑定是 claude 专属机制)——参数原样透传。
exec codex "$@"
