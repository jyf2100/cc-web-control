# Spike 02 — 多行注入失败确认

**判定:no-go(符合预期)** —— 多行文本经 `tmux send-keys -l` 被逐行拆成多次提交,不可靠。

## 实测现象

向 bash 会话发送含 `\n` 的多行载荷:

```
tmux send-keys -t "$SESS" -l "$(printf '[EVENT] mc1/sess1 errored\n尾部输出: error X\n请诊断')"
tmux send-keys -t "$SESS" Enter
```

capture-pane 输出:

```
bash-3.2$ [EVENT] mc1/sess1 errored
尾部输出: error X
请诊断
bash: [EVENT]: command not found
bash-3.2$ 尾部输出: error X
bash: 尾部输出:: command not found
请诊断
bash-3.2$ 请诊断
bash: 请诊断: command not found
bash-3.2$
```

三行文本被 bash 当**三条独立命令**依次执行,各自 `command not found`。

## 结论与含义

- `tmux send-keys -l "<含换行的文本>"` 会把 `\n` 转为 Enter,**多行 = 多次提交**。
- **事件载荷绝不能走 sendInput**:一条 errored 事件含「机器/会话/状态/尾部输出/时间戳」多字段,几乎必然含换行,注入会被拆碎、语义错乱。
- 佐证 spec §4 的 **pull 模型**:dispatcher 仅用 `sendInput` 投递**单行 poke**(唤醒信号:`[event] id=… call dequeue_event`),结构化事件经 MCP 工具 `dequeue_event()→JSON` 拉取(可靠、可测、可审计)。
- 对 dispatcher 实现的硬约束:`poke(session, msg)` 必须强制 `msg` 单行(拒绝 `\n`)——见 plan Task 6 `local_tmux.cjs` 的单行校验。
