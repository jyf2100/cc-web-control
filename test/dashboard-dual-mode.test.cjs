/**
 * Task 4:dashboard.html 双模式探测分发测试。
 * 校验:hub 模式(board-body/fleet-summary/board-stale 挂点 + board_render 加载 +
 * click-to-navigate + title 带 fleet 数)与单机 fallback(/api/global-dashboard 404 → loop())。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

test('dashboard.html 双模式:加载 board_render(hub)+ dashboard_render(单机)', () => {
  assert.match(html, /board_render\.cjs/);
  assert.match(html, /dashboard_render\.cjs/);
});
test('dashboard.html hub 模式卡片网格挂点 + fleet 摘要 + board-stale', () => {
  assert.match(html, /id="board-body"/);
  assert.match(html, /id="fleet-summary"/);
  assert.match(html, /board-stale/);
});
test('dashboard.html 底部 tab 含切换(aria-haspopup)', () => {
  assert.match(html, /aria-haspopup="dialog"/);
});
test('dashboard.js 探测 global-dashboard 分发 hub/单机', () => {
  assert.match(js, /\/api\/global-dashboard/);
  assert.match(js, /404|status\s*===\s*404/);  // 404 → 单机 fallback
});
test('dashboard.js hub 卡片跳控制台(click-to-navigate)', () => {
  assert.match(js, /\/console\.html\?m=/);
});
test('dashboard.js hub title 带 fleet 数', () => {
  assert.match(js, /多机|fleet|online/);
});

// ---- Re-review regression locks(NEW-H1/H2/M1/M2):字符串级断言,锁定具体修复点 ----
// 说明:真正的行为级 DOM 测试需 JSDOM/Playwright(Task 7);此处仅锁源码结构,确保回退即被抓到。

// NEW-H1:renderBoard 卡片循环须有 else 分支刷新已存在卡片内容(否则同 key 状态变更后,
// 重排移到 errored 位但内容仍显旧 status dot/lastLine)。
test('NEW-H1: renderBoard 已存在卡片走 else 更新路径(cardByKey.get(...).innerHTML = BR.buildCardInner)', () => {
  // 修复前卡片循环只有 if(创建新卡片)无 else —— 同 key 状态变更后重排位置正确但内容陈旧。
  // 此表达式为 else 分支专属:if 分支重建用 li.innerHTML = BR.buildCardInner(变量名 li),
  // 重排循环用 boardBody.appendChild(existing) —— 均不命中。修复前全文件不存在此表达式。
  assert.match(js, /cardByKey\.get\(card\.key\)\.innerHTML\s*=\s*BR\.buildCardInner/);
});

// NEW-H2:showBoardError 须重置 cardByKey Map(否则恢复时命中分离节点 + ERROR <li> 残留),
// 且恢复路径(renderFleetSummary)须复位 fleetSummary.hidden = false。
test('NEW-H2: showBoardError 内重置 cardByKey = new Map()(ERROR 标记后紧跟重置)', () => {
  // 精准锚定 showBoardError 函数体:ERROR</span> 后 400 字符窗口内出现 cardByKey = new Map()。
  // 修复前 ERROR 后直接闭合函数 → 无重置 → 恢复时 cardByKey 命中分离节点。
  // (注:renderBoard 空数组路径也重置 cardByKey,但那里无 ERROR 标记,不误命中。)
  assert.match(js, /ERROR<\/span>[\s\S]{0,400}cardByKey\s*=\s*new Map\(\)/);
});
test('NEW-H2: 恢复路径 renderFleetSummary 复位 fleetSummary.hidden = false', () => {
  // 精准锚定 renderFleetSummary 函数体:声明后 400 字符窗口内出现 hidden = false。
  // 修复前 renderFleetSummary 仅设 innerHTML 不复位 hidden → 错误恢复后摘要区永久隐藏。
  // (注:detectMode 也设 hidden=false,但在 renderFleetSummary 声明 400 字符外,不误命中。)
  assert.match(js, /function renderFleetSummary[\s\S]{0,400}fleetSummary\.hidden\s*=\s*false/);
});

// NEW-M1:visibilitychange show-handler 须以 !hubModeActive 守卫单机 loop() 重启
// (否则 hub 部署切 tab 回来后,/api/dashboard 404 → showState 错误消息叠在 hub 看板上)。
test('NEW-M1: visibility 恢复 loop() 守卫 !hubModeActive', () => {
  assert.match(js, /!polling && !hubModeActive/);
});

// NEW-M2:detectMode 须处理 probe.status === 401 → 登录页(global-dashboard 需鉴权,
// 原 commit msg 声称处理但实际缺此分支,401 会落入 !probe.ok 误显「看板服务暂不可用」)。
test('NEW-M2: detectMode 含 probe.status === 401 重定向分支', () => {
  // 用 probe(非 res)限定 detectMode 上下文;pollHub 用 res.status,不会误命中。
  assert.match(js, /probe\.status\s*===\s*401/);
});
