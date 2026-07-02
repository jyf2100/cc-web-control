# Spike 01 — sendInput 单行 poke 可靠唤醒 claude code TUI

**日期:** 2026-07-02
**分支:** `feat/main-agent-t1`
**环境:**
- claude: `2.1.198` (`/Users/roc/.nvm/versions/node/v25.8.1/bin/claude`,OAuth 订阅登录)
- tmux: `3.6a` (`/opt/homebrew/bin/tmux`)
- node: `v25.8.1`
- 平台: macOS (Darwin 25.3.0)

## 判定: **GO**

单行 `tmux send-keys -l "<msg>"` + `tmux send-keys Enter` 能可靠唤醒常驻 claude code TUI:
- 消息被成功提交到 claude 输入框(Enter 即提交,不卡在 buffer 里)
- claude 正常处理并回复
- detached tmux session 下行为正常,无抢键/丢键/paste 中途现象

## 方法

脚本: [`01-poke-wakeup.sh`](./01-poke-wakeup.sh)

核心步骤:
1. `tmux new-session -d -s "$SESS" "claude"` — 启动常驻交互式 TUI(**裸 `claude`,不是 `claude -p`**)
2. 等 8s 冷启动
3. `tmux send-keys -t "$SESS" -l "请只回复两个字:收到"` — literal 注入文本(中文,含全角标点)
4. `tmux send-keys -t "$SESS" Enter` — 提交
5. 轮询 `capture-pane` 直到响应完成

方式 A(`-l` literal)即通过,无需尝试方式 B(不带 `-l`)。

## 证据(capture-pane 关键片段)

```
╭─── Claude Code v2.1.198 ───── ...
│  ~/workspace/cc-web-control    │
╰────────────────────────────────╯


❯ 请只回复两个字:收到

  Thought for 8s

⏺ 收到

✻ Cogitated for 8s

──────────────────────────────── ...
❯ 继续主控 agent 的实现
──────────────────────────────── ...
  ? for shortcuts · ← for agents
```

解读:
- `❯ 请只回复两个字:收到` — 我们注入的消息,已被 claude 接收为一条用户提交(prompt 行)
- `Thought for 8s` — claude 进入思考
- `⏺ 收到` — claude 的回复(正好两个字,符合指令)
- `Cogitated for 8s` — 完成标记

总耗时 ≈ 8s thinking + 回复。

## 迭代过程

1. **首版脚本**(`01-poke-wakeup.sh`)用粗 grep 检测 pane 中是否出现"收到"。首跑在第 1s 触发检测——但这是**误报**:匹配到的是 claude 回显在 prompt 行的"❯ 请只回复两个字:收到",而非 claude 的回复。当时 pane 显示 claude 仍在 `· Symbioting…` spinner 中处理,回复尚未完成。
2. **二次验证**(`/tmp/spike-clean.sh`,逻辑已合并理解)改为轮询 spinner 消失后捕获完整交互,拿到 claude 回复 `⏺ 收到` 的确凿证据。

**教训(对 hub 实现的提示):** 检测 poke 是否"已被处理"不能只 grep 消息文本(会被 prompt 回显命中),要检测 claude 的**回复产物**或 spinner 生命周期。不过对"唤醒"这一目的本身,prompt 行出现消息已足以证明 poke 被接收。

## 对 T1 闭环的影响

- **可行性前提成立:** T1 设计的「hub 检测事件 → 单行 sendInput poke 唤醒常驻主 agent → 主 agent dequeue_event 拉结构化载荷」路径在传输层可行。
- **poke 语义建议:** poke 文本应是简短触发指令(如 "event",或一句"去 dequeue_event"),载荷本身**不走 sendInput**——这已与 plan 一致(载荷走 MCP 工具拉取)。
- **节奏建议:** 主 agent 从被 poke 到完成一轮 dequeue→diagnose→ack 可能需要数十秒(本 spike 仅回两字就用了 8s)。hub 侧的"poke 节流/去重"策略应基于此量级,不要假设亚秒级响应。
- **无 fallback 需要:** 方式 A 通过,无需改用 Ctrl+J 提交或 `claude -p` headless 模式。

## 复现

```bash
bash docs/superpowers/spikes/01-poke-wakeup.sh
```

(脚本内含 cleanup trap,正常退出会 kill-session。)
