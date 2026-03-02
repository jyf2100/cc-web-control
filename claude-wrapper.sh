#!/bin/bash
# Claude Code 包装脚本
# 清除 CLAUDECODE 环境变量以避免嵌套会话检测

unset CLAUDECODE
unset CLAUDE_CODE

# 启动 Claude Code
exec claude "$@"
