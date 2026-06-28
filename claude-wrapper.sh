#!/bin/bash
# Claude Code 包装脚本
# 1) 清除 CLAUDECODE 环境变量避免嵌套会话检测
# 2) 若 CC_WEB_CLAUDE_SESSION_ID 已设置(startClaudeInSession forceNew 注入),
#    用 --session-id 指定:claude 生成的 jsonl 文件名 = 该 UUID,
#    node 端已 writeBinding 写好同名绑定,看板精确定位。
#    替代旧版后台监听新 jsonl 文件名的捕获(真实环境后台子 shell 不可靠)。
#    未设置(服务启动 DEFAULT_SESSION 续接最近会话)→ 直接 exec claude,沿用 $@ 里的 -c。
unset CLAUDECODE
unset CLAUDE_CODE

if [ -n "$CC_WEB_CLAUDE_SESSION_ID" ]; then
  exec claude --session-id "$CC_WEB_CLAUDE_SESSION_ID" "$@"
else
  exec claude "$@"
fi
