#!/bin/bash
# Claude Code 包装脚本:清除嵌套检测环境变量后透传参数。
# cc-web-control 注入的参数(由 buildClaudeLaunchCommand 拼成):
#   --session-id <uuid>  新建会话(透传给 claude,jsonl 文件名恰好 = uuid)
#   --resume <uuid>      续接会话(透传给 claude,追加进同一 jsonl)
#   --effort <level>     Opus 5 effort 档位(wrapper 消费:导出 CC_WEB_CLAUDE_EFFORT,
#                        映射 claude effort 配置;具体支持以 claude 版本为准)。
#                        **不透传给 claude**,避免 claude 拒绝未知参数。
#   (空)                 裸 claude,自生成 uuid(降级兜底,看板走 mtime)
unset CLAUDECODE
unset CLAUDE_CODE
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --effort)
      if [[ $# -ge 2 ]]; then export CC_WEB_CLAUDE_EFFORT="$2"; shift 2; else shift; fi
      ;;
    *)
      ARGS+=("$1"); shift
      ;;
  esac
done
exec claude "${ARGS[@]}"
