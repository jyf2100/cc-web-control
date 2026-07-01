# 控制台滚动修复 + 看板闪动 + 抽屉瘦身 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复控制台对话区滚不动的 flex 链 bug;看板 agent 状态切换时对应卡片闪动;切换抽屉移除与会话看板重复的会话列表段。

**Architecture:** 纯前端改动,无后端/无 WebSocket。需求1 是 CSS flex 链补全;需求2 用前端纯函数 `diffChangedStatus` 对比两次轮询的 status,渲染后给变化项加 flash class + CSS keyframes;需求3 删除 `createSwitchSheet` 的会话段(保留 `buildSessionItems` 纯函数)。

**Tech Stack:** Express + vanilla JS(`.cjs`)、`node --test` + `node:assert`、无 jsdom(CSS/HTML/源码用字符串正则断言,见 `test/ios_header.test.cjs` 范式;纯函数 `require` 直测)。

**Spec:** `docs/superpowers/specs/2026-07-01-ui-feedback-enhancements-design.md`

---

## Task 1: 控制台对话区滚动修复(补 flex 链)

**Files:**
- Modify: `public/style.css`(`.chat-container` ~148、`.messages` ~154、`.terminal-content` ~209)
- Test: Create `test/console_scroll_layout.test.cjs`

- [ ] **Step 1: 写失败测试**

Create `test/console_scroll_layout.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const readCss = () => fs.readFileSync('public/style.css', 'utf8');

// 截取选择器规则块(从选择器首次出现到其第一个 }),用于断言声明
function ruleBlock(css, selector) {
  const idx = css.indexOf(selector);
  if (idx < 0) return '';
  const end = css.indexOf('}', idx);
  return end < 0 ? '' : css.slice(idx, end + 1);
}

test('滚动修复:.chat-container 是 flex 列容器(子项 flex:1 才生效)', () => {
  const b = ruleBlock(readCss(), '.chat-container');
  assert.match(b, /display\s*:\s*flex/);
  assert.match(b, /flex-direction\s*:\s*column/);
  assert.match(b, /overflow-y\s*:\s*auto/);
});

test('滚动修复:.messages 是 flex 列容器 + min-height:0(传递受限高度)', () => {
  const b = ruleBlock(readCss(), '.messages');
  assert.match(b, /display\s*:\s*flex/);
  assert.match(b, /flex-direction\s*:\s*column/);
  assert.match(b, /min-height\s*:\s*0/);
});

test('滚动修复:.terminal-content 占满 + 可收缩(配合 overflow:auto 触发滚动)', () => {
  const b = ruleBlock(readCss(), '.terminal-content');
  assert.match(b, /flex\s*:\s*1/);
  assert.match(b, /min-height\s*:\s*0/);
  assert.match(b, /overflow\s*:\s*auto/);
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `node --test test/console_scroll_layout.test.cjs`
Expected: 3 个 FAIL(当前 `.chat-container` / `.messages` 无 `display:flex`,`.terminal-content` 无 `flex:1; min-height:0`)。

- [ ] **Step 3: 改 style.css 三处**

`.chat-container`(148)改为:
```css
.chat-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    background-color: var(--bg);
}
```

`.messages`(154)改为:
```css
.messages {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 20px;
}
```

`.terminal-content`(209)在已有声明前加 `flex: 1; min-height: 0;`:
```css
.terminal-content {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 12px 14px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
}
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `node --test test/console_scroll_layout.test.cjs`
Expected: 3 PASS。

- [ ] **Step 5: 浏览器手动验证**

`npm start` → 控制台选一会话产生多屏输出:输出区能上下滚、输入框常驻底部不跟随滚、新输出自动到底。

- [ ] **Step 6: Commit**

```bash
git add test/console_scroll_layout.test.cjs public/style.css
git commit -m "fix(console): 对话区滚动修复——补 flex 链(chat-container/messages/terminal-content)"
```

---

## Task 2: `diffChangedStatus` 纯函数(看板闪动核心)

**Files:**
- Modify: `public/dashboard_render.cjs`(新增函数 + 导出)
- Test: Modify `test/dashboard_render.test.cjs`(追加用例)

- [ ] **Step 1: 写失败测试**

在 `test/dashboard_render.test.cjs` 末尾追加:

```js
test('diffChangedStatus status 不变返回空集', () => {
  const r = R.diffChangedStatus([{name:'a',status:'idle'}], [{name:'a',status:'idle'}]);
  assert.equal(r.size, 0);
});
test('diffChangedStatus status 变化收集 name', () => {
  const r = R.diffChangedStatus([{name:'a',status:'idle'}], [{name:'a',status:'working'}]);
  assert.equal(r.size, 1); assert.ok(r.has('a'));
});
test('diffChangedStatus 多会话只收变化者', () => {
  const prev = [{name:'a',status:'idle'},{name:'b',status:'working'}];
  const next = [{name:'a',status:'working'},{name:'b',status:'working'}];
  const r = R.diffChangedStatus(prev, next);
  assert.equal(r.size, 1); assert.ok(r.has('a')); assert.ok(!r.has('b'));
});
test('diffChangedStatus 新会话(旧无)不计入变化', () => {
  const r = R.diffChangedStatus([], [{name:'new',status:'idle'}]);
  assert.equal(r.size, 0);
});
test('diffChangedStatus 消失会话不计入变化', () => {
  const r = R.diffChangedStatus([{name:'gone',status:'idle'}], []);
  assert.equal(r.size, 0);
});
test('diffChangedStatus 空兜底(null/undefined)', () => {
  assert.equal(R.diffChangedStatus(null, null).size, 0);
  assert.equal(R.diffChangedStatus(undefined, undefined).size, 0);
});
test('diffChangedStatus 缺 name 字段跳过', () => {
  const r = R.diffChangedStatus([{status:'idle'}], [{status:'working'}]);
  assert.equal(r.size, 0);
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `node --test test/dashboard_render.test.cjs`
Expected: FAIL(`R.diffChangedStatus is not a function`)。

- [ ] **Step 3: 实现函数**

在 `public/dashboard_render.cjs` 的 `countWaiting` 函数之后插入:

```js
  function diffChangedStatus(prev, next) {
    var prevMap = new Map();
    (prev || []).forEach(function (s) {
      if (s && typeof s.name === 'string') prevMap.set(s.name, s.status);
    });
    var changed = new Set();
    (next || []).forEach(function (s) {
      if (!s || typeof s.name !== 'string') return;
      if (prevMap.has(s.name) && prevMap.get(s.name) !== s.status) {
        changed.add(s.name);
      }
    });
    return changed;
  }
```

在 `return { ... }` 的导出对象里加一行(紧跟 `countWaiting: countWaiting,`):

```js
        diffChangedStatus: diffChangedStatus,
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `node --test test/dashboard_render.test.cjs`
Expected: 全部 PASS(含原有用例)。

- [ ] **Step 5: Commit**

```bash
git add public/dashboard_render.cjs test/dashboard_render.test.cjs
git commit -m "feat(dashboard): diffChangedStatus 纯函数——对比两次 sessions 出 status 变化集"
```

---

## Task 3: 看板闪动绑定 + keyframes

**Files:**
- Modify: `public/dashboard.js`(`render` 加 diff + flash;模块级加 `prevSessions`)
- Modify: `public/dashboard.css`(末尾加 `@keyframes session-flash` + `.session--flash`)
- Test: Create `test/dashboard_flash.test.cjs`

- [ ] **Step 1: 写失败测试**

Create `test/dashboard_flash.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('flash:dashboard.js 调用 diffChangedStatus 算变化集', () => {
  const js = fs.readFileSync('public/dashboard.js', 'utf8');
  assert.match(js, /diffChangedStatus/);
});
test('flash:dashboard.js 给变化项加 session--flash class', () => {
  const js = fs.readFileSync('public/dashboard.js', 'utf8');
  assert.match(js, /session--flash/);
  assert.match(js, /classList\.add/);
});
test('flash:dashboard.js 维护 prevSessions 供下次 diff', () => {
  const js = fs.readFileSync('public/dashboard.js', 'utf8');
  assert.match(js, /prevSessions/);
});
test('flash:dashboard.css 定义 session-flash 动画 + session--flash 类', () => {
  const css = fs.readFileSync('public/dashboard.css', 'utf8');
  assert.match(css, /@keyframes\s+session-flash/);
  assert.match(css, /\.session--flash\b/);
  assert.match(css, /animation\s*:\s*session-flash/);
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `node --test test/dashboard_flash.test.cjs`
Expected: 4 个 FAIL(dashboard.js 未含 flash 逻辑、dashboard.css 未含 keyframes)。

- [ ] **Step 3: 改 dashboard.js**

在模块级变量区(紧接 `var titleCountEl = ...` 那行之后)加:

```js
    var prevSessions = [];
```

把 `render` 函数整体替换为(用 `R.diffChangedStatus` 算变化集,渲染后给变化项加 flash class):

```js
    function render(payload) {
        var sessions = (payload && payload.sessions) || [];
        var waiting = R.countWaiting(sessions);
        setTitle(waiting); setMeta(sessions.length);
        if (!payload || payload.tmuxOk === false) {
            showState('error', 'tmux 不可用,请确认 tmux 已安装并在 PATH 中。'); return;
        }
        if (sessions.length === 0) {
            showState('ready', '还没有会话。在主控制台启动一个会话,这里会显示状态。'); return;
        }
        stateMsg.hidden = true;
        var changed = R.diffChangedStatus(prevSessions, sessions);
        list.innerHTML = R.renderSessionList(sessions);
        var items = list.querySelectorAll('.session');
        Array.prototype.forEach.call(items, function (li) {
            if (changed.has(li.getAttribute('data-session'))) li.classList.add('session--flash');
        });
        prevSessions = sessions;
    }
```

- [ ] **Step 4: 改 dashboard.css**

在 `public/dashboard.css` 末尾追加:

```css
/* === 状态变化闪动(spec 需求2)=== */
@keyframes session-flash {
  0%   { box-shadow: 0 0 0 0 var(--accent-dim); }
  50%  { box-shadow: 0 0 0 4px var(--accent-dim); background: var(--accent-bg); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.session--flash { animation: session-flash 1s ease-out 1; }
```

- [ ] **Step 5: 跑测试,确认通过**

Run: `node --test test/dashboard_flash.test.cjs`
Expected: 4 PASS。

- [ ] **Step 6: 浏览器手动验证**

开两个 claude 会话产生不同 status → 看板页:让某会话 idle→working(如在终端输入触发),对应卡片应闪一下(~1s),其余不动。

- [ ] **Step 7: Commit**

```bash
git add public/dashboard.js public/dashboard.css test/dashboard_flash.test.cjs
git commit -m "feat(dashboard): 看板 status 变化闪动——前端 diff + session-flash 动画"
```

---

## Task 4: 切换抽屉移除会话列表段

**Files:**
- Modify: `public/switch_sheet.cjs`(`createSwitchSheet` 删会话段 95-113、`aria-label` 改"启动项目")
- Test: Modify `test/switch_sheet.test.cjs`(追加源码断言;`buildSessionItems` 用例保留)

- [ ] **Step 1: 写失败测试**

在 `test/switch_sheet.test.cjs` 末尾追加(顶部已 `require('node:fs')`,沿用):

```js
test('createSwitchSheet aria-label 为「启动项目」(原「切换会话」)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.match(src, /'启动项目'/);
  assert.doesNotMatch(src, /'切换会话'/);
});
test('createSwitchSheet 不再渲染会话段(会话标题与 sessTitle 变量删除)', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.ok(!/textContent\s*=\s*'会话'/.test(src), '会话段标题应删除');
  assert.ok(!/sessTitle/.test(src), 'sessTitle 变量应删除');
});
test('createSwitchSheet 仍渲染项目段', () => {
  const src = fs.readFileSync('public/switch_sheet.cjs', 'utf8');
  assert.match(src, /'项目'/);
  assert.match(src, /switch-sheet-projects/);
});
test('buildSessionItems 纯函数保留(向后兼容)', () => {
  assert.deepEqual(
    buildSessionItems([{name:'a',attached:false}], 'a'),
    [{name:'a',label:'a',attached:false,isCurrent:true}]
  );
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `node --test test/switch_sheet.test.cjs`
Expected: 前 3 个 FAIL(当前 aria-label 仍是"切换会话"、含 sessTitle 与 `textContent = '会话'`);第 4 个 PASS(`buildSessionItems` 当前已存在)。

- [ ] **Step 3: 改 switch_sheet.cjs**

3a. `aria-label`(80 行附近):
```js
    sheet.setAttribute('aria-label', '切换会话'); sheet.hidden = true;
```
改为:
```js
    sheet.setAttribute('aria-label', '启动项目'); sheet.hidden = true;
```

3b. 删除整个第 2 段(95-113 行,从注释 `// 第 2 段:会话列表...` 到 `sheet.appendChild(list);`):

```js
    // 第 2 段:会话列表(标题 + 复用 buildSessionItems,当前项高亮+disabled)
    const sessTitle = doc.createElement('p');
    sessTitle.className = 'switch-sheet-section-title';
    sessTitle.textContent = '会话';
    sheet.appendChild(sessTitle);
    const list = doc.createElement('ul');
    list.className = 'switch-sheet-list'; list.setAttribute('role', 'list');
    items.forEach((it) => {
      const li = doc.createElement('li');
      li.className = 'switch-sheet-item' + (it.isCurrent ? ' switch-sheet-item--current' : '');
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'switch-sheet-btn';
      btn.setAttribute('aria-current', it.isCurrent ? 'true' : 'false');
      btn.textContent = it.label;
      if (it.isCurrent) btn.disabled = true;
      btn.addEventListener('click', () => { onPick(it.name); });
      li.appendChild(btn); list.appendChild(li);
    });
    sheet.appendChild(list);
```

删除后,`meta` 段(第 1 段)之后直接接项目段(第 3 段)。`items` / `onPick` 参数保留在函数签名(向后兼容,不再用于渲染)。

- [ ] **Step 4: 跑测试,确认通过**

Run: `node --test test/switch_sheet.test.cjs`
Expected: 全部 PASS。

- [ ] **Step 5: 浏览器手动验证**

控制台点「切换」tab:抽屉只剩 meta 行 + 项目列表两段,无会话段;焦点陷阱在剩余 focusable 间正常循环。

- [ ] **Step 6: Commit**

```bash
git add public/switch_sheet.cjs test/switch_sheet.test.cjs
git commit -m "refactor(switch_sheet): 移除切换抽屉会话段(与看板去重),aria-label 改启动项目"
```

---

## 完成后

- [ ] 跑全量测试:`node --test test/*.test.cjs` → 全 PASS
- [ ] 用 `superpowers:finishing-a-development-branch` 收尾(验测试 → push → PR)

## Self-Review

**1. Spec 覆盖**:需求1 → Task 1 ✓;需求2 → Task 2(纯函数)+ Task 3(绑定+动画)✓;需求3 → Task 4 ✓。全覆盖。

**2. Placeholder 扫描**:无 TBD/TODO,每个 step 含完整代码与确切命令 ✓。

**3. 类型一致性**:`diffChangedStatus(prev, next)` 在 Task 2 定义、Task 3 以 `R.diffChangedStatus(prevSessions, sessions)` 调用,签名一致;`session--flash` class 名在 Task 3 的 JS/CSS/测试三处一致;`prevSessions` 变量名一致 ✓。
