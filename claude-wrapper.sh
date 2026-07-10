#!/bin/bash
# Claude Code 包装脚本:清除嵌套检测环境变量后透传参数。
# $@ 由 buildClaudeLaunchCommand 拼成,可能末尾带:
#   --session-id <uuid>  新建会话(jsonl 文件名恰好 = uuid)
#   --resume <uuid>      续接会话(追加进同一 jsonl)
#   (空)                 裸 claude,自生成 uuid(降级兜底,看板走 mtime)
unset CLAUDECODE
unset CLAUDE_CODE
exec claude "$@"
