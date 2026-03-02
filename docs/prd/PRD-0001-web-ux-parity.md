# PRD-0001: Web 操作习惯与 Claude Code 一致（Terminal UX Parity）

## Vision

让 `cc-control` 的 Web 页面在**操作习惯**上尽可能接近 Claude Code（终端内体验）：

- 用户在 Web 输入框按下的关键按键（`Tab` 补全、`/` 命令面板、`↑/↓` 选择、`Esc` 退出、`Enter` 确认）在行为上与 Claude Code 一致。
- Web 端看到的输出应尽量“忠实镜像终端”，不因前端清洗逻辑而丢失交互态信息。

## Non-goals（本 PRD 明确不做）

- 100% 终端仿真（完整光标、颜色、Alternate screen、鼠标选择等）——当前架构基于 tmux `capture-pane` 快照，不引入 xterm.js。
- 对 Claude Code 内部交互做定制/patch。

## Background / Problem

当前 Web 端输入是“文本发送 + 可选 Enter”，且 `Tab` 等按键只发送按键本身，不会把 Web 输入框中的内容同步到 tmux 的 prompt 行。

结果：

- 用户在 Web 输入框输入 `/m` 后按 `Tab`，tmux 侧并不知道当前行是 `/m`，所以补全/命令面板看起来“没有结果返回”。
- 用户希望 Web 的操作习惯与 Claude Code 完全一致（至少在 `/` 面板与补全方面）。

## Requirements

### REQ-0001-001: Tab 补全行为一致

- 当用户在 Web 输入框按下 `Tab` 时：
  - 后端 tmux prompt 行应先与 Web 输入框内容同步（不提交）
  - 然后发送 `Tab` 触发补全

验收：

- 在 Web 输入框输入 `/` 或 `/m`，按 `Tab`，tmux 侧能看到面板/候选项（Web 镜像中可见 `Esc to close` 或候选列表）。

### REQ-0001-001A: Slash 输入实时触发面板过滤

- 当 Web 输入框内容以 `/` 开头时（例如 `/m`），Web 端应在**不回车提交**的前提下把当前输入同步到 tmux prompt 行，使 Claude Code 的命令面板能像本地终端一样即时过滤候选项。

验收：

- 在 Web 输入框逐字输入 `/m`（不按回车），能看到候选项列表发生变化（过滤为 `m` 相关项）。

### REQ-0001-002: Slash 面板交互按键一致

当输入框为空时：

- `↑/↓` 发送给 tmux 用于在面板候选项移动
- `Enter` 发送给 tmux 用于确认
- `Esc` 发送给 tmux 用于关闭

验收：

- Web 端可用这些按键完成在命令面板里移动/确认/退出。

### REQ-0001-003: 输出不丢交互态信息

- Web 端输出清洗不得隐藏 prompt 行（如 `❯ /`），否则用户无法判断当前交互态。

验收：

- Web 端出现 `❯ /` 等交互态行时可见。

## Risks / Notes

- 基于 `capture-pane` 的镜像无法做到“输入框里的每个按键都实时回显到终端”，只能在关键时刻（例如 `Tab`）做行同步。
- 多个 WS 消息可能乱序或并发执行，需要后端对输入动作进行顺序化处理（batch + queue）。
