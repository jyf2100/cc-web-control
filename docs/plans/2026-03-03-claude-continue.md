# Plan: Support `claude -c/--continue` when starting a new tmux session

Date: 2026-03-03

## Context / Problem

“记忆断层”有两类来源：

1) Web 端连错 tmux session（已通过 v3 session consistency 修复）。
2) tmux session 被重建时，Claude Code CLI 默认开启**新对话**，导致看起来“丢记忆”。

在 Claude Code CLI 中，`-c/--continue` 表示“在当前目录继续最近一次对话”。

## Success Criteria (Acceptance)

- 当 `CC_WEB_CLAUDE_CONTINUE=1` 且服务端需要创建新 tmux session 并启动 `claude` 时，启动命令会包含 `-c`。
- 默认不设置该变量时，行为保持不变（启动新对话）。
- 单元测试覆盖命令构造逻辑。

## Files

- Add: `claude_launch.js`
- Add: `test/claude_launch.test.js`
- Modify: `server.js`
- Modify: `README.md`

## Steps (TDD)

1) Red: `test/claude_launch.test.js` 断言 `continue=true` 时命令包含 `-c`
2) Green: 实现 `claude_launch.js`
3) Green: `server.js` 用该模块生成启动命令，并从 env 读取 `CC_WEB_CLAUDE_CONTINUE`
4) Run: `npm test` 全绿

