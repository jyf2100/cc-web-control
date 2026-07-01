#!/bin/bash
# Claude Code 包装脚本:清除嵌套检测环境变量后透传参数(含可能的 -c 续接)。
# 新流程(续接优先)不再注入 CC_WEB_CLAUDE_SESSION_ID,直接 exec claude,
# $@ 由 buildClaudeLaunchCommand 拼成,续接时末尾带 -c。
unset CLAUDECODE
unset CLAUDE_CODE
exec claude "$@"
