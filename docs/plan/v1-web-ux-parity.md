# v1 Plan: Web UX Parity (/ + Tab completion)

PRD Trace:

- PRD-0001
  - REQ-0001-001
  - REQ-0001-002
  - REQ-0001-003

## Goal

让 Web 端的 `/` 命令面板与 `Tab` 补全在“操作习惯”上尽可能与 Claude Code 一致，避免“按 Tab 没有结果返回”。

## Acceptance

1. Web 输入框输入 `/m`（不按回车），命令面板候选项会即时过滤并在 Web 镜像中可见。
2. Web 输入框输入 `/m`，按 `Tab`：tmux 侧先同步当前行内容，再触发补全；Web 输出可见补全/面板内容（如 `Esc to close`）。
3. 输入框为空时，`↑/↓/Esc/Enter` 能操作面板。
4. 输出清洗不会隐藏 prompt 行（`❯ ...`）。

## Steps (TDD)

### Step 1 — Red: unit tests for action building

Files:

- Create `public/tmux_actions.js`（可在 Node 测试中 require）
- Create `test/tmux_actions.test.js`

Tests:

- `buildTabCompleteBatch("/m")` 生成的动作序列必须包含：
  - `C-u`（清空行）
  - `input("/m", enter=false)`（同步行）
  - `key(Tab)`（触发补全）

Run:

```bash
npm test
```

Expected:

- 新增测试先红（未实现）。

### Step 2 — Green: implement batch + backend queue

Files:

- Modify `server.js`：
  - 支持 WS 消息 `type: "batch"`，保证动作顺序执行
  - 为每个 WS 连接引入 `commandQueue`，避免并发 tmux 操作乱序
  - 允许 key: `C-u`（以及后续可能的 `C-c`）
- Modify `public/client.js`：
  - `Tab`：发送 batch（清行 + 同步 input + Tab）
  - `Enter`：发送 batch（清行 + 提交 input）

Run:

```bash
npm test
```

Expected:

- 全绿。

### Step 3 — E2E (manual)

1. 启动服务（建议关闭 auto-open/attach）：

```bash
CC_WEB_PROJECT_ROOTS="/Volumes/work/workspace" node server.js --no-open --no-attach
```

2. 浏览器打开 `http://127.0.0.1:7684`，强制刷新（`Cmd+Shift+R`）。
3. 在输入框输入 `/m`，按 `Tab`：
   - 期望：出现命令面板/候选项（或出现提示 `Esc to close`）。
4. 输入框清空，按 `↓`、`↑`、`Enter`、`Esc`：
   - 期望：面板可移动/确认/退出。

## Risks

- 由于本项目不是完整终端模拟，输入框里的文本默认不会实时回显到 tmux；这里只在 `Tab/Enter` 等关键动作前同步一遍。

## Differences vs Claude Code (known gaps)

- Web 输入框不是“真正的终端输入行”：除 `/...`（会 debounce 同步）以及 `Tab/Enter` 触发的同步外，普通文本不会实时出现在 tmux prompt 行。
- 输出是 `tmux capture-pane` 的快照：不支持完整光标/颜色/鼠标等终端能力。

## Evidence (manual)

- 通过 WebSocket 向 `claude-web-session` 发送 batch：`C-u` + `/m`（enter=false），`tmux capture-pane -p` 可见候选项列表（包含 `/model` 等）。
