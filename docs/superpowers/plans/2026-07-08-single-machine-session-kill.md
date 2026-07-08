# 单机看板 session 删除(kill)+ 当前激活标记 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在单机看板(`/dashboard.html` 单机分支)每张 session 卡片加「删除」入口(卡片就地二次确认),加「当前激活会话」标记(删除禁用),后端 `DELETE` 加 WS 活跃保护(409)防多标签误杀;**全程不动 hub**。

**Architecture:** 前端纯渲染层 `dashboard_render.cjs` 给 `renderSession` 加 `{isCurrent, confirming}` opts(产删除/取消/确认按钮 + class);看板交互层 `dashboard.js` 单机分支加 click 委托三分支 + `deleteSession` + `rerender` + `confirming` Set(作 renderSessionList 第三参,跨 2s 轮询全量重建存活);样式 `dashboard.css`;后端提取 `session_in_use.cjs` 纯函数 + `server.cjs` DELETE 前置 409 检查。

**Tech Stack:** Node.js + Express + ws(`WebSocketServer`),原生 JS(IIFE 无框架),`node:test` 单测 + 源码契约测试,tmux 会话管理。

## Global Constraints

- **不动 hub**:`public/board_render.cjs`、`hub/**`、`/api/global-dashboard`、`dashboard.js` hub 分支(`renderBoard`/`pollHub`/`hubLoop`/`detectMode`/`boardBody` click 委托/`fanoutBar`)。
- 当前 session localStorage key = **`'cc_web_last_session'`**(client.js:46);看板侧 `CURRENT_KEY` 同值。
- `isValidSessionName`:**`/^[A-Za-z0-9._-]{1,64}$/`**(server.cjs:105)——session 名字符集安全,属性选择器可直接拼 `li[data-session="..."]`。
- `POLL_MS = 2000`(dashboard.js:11)——render 每 2s 全量重建 `list.innerHTML`;`confirming` Set 作 renderSessionList 第三参跨轮询存活。
- WS 连接 Map:`clients`(server.cjs:95),key=ws,`clientInfo.sessionName`(server.cjs:625),`ws.readyState === 1` 为 OPEN(ping 判断同款 server.cjs:580)。
- DELETE 语义**不变**:`tmux.killSession(name)` + `deleteBinding(slug, name)`(server.cjs:554-558),保留 jsonl 历史;仅**前置**加 WS 活跃检查。
- `renderSessionList` **向后兼容**:`renderSessionList(sessions)` 仍工作(现有 dashboard.js:61 调用 + dashboard_render.test.cjs 不受影响)。
- 颜色用 `public/tokens.css` 的 CSS 变量(implementer 核对实际变量名,带 `var(--x, fallback)`)。
- 提交:中文 conventional commits(`feat:`/`test:`/`style:`/`refactor:`),**无** Co-Authored-By 尾注(项目归因禁用)。
- 测试:`node --test test/*.test.cjs`;先记录基线 B,新增后应为 **B+N、0 失败**。

---

## File Structure

- **Create** `public/dashboard.css` 内新增段(改现有文件)— 删除按钮/当前标记/确认态/toast 样式
- **Modify** `public/dashboard_render.cjs` — `renderSession(s, index, opts)` + `renderSessionList(sessions, currentName, confirmingSet)`(纯函数,可单测)
- **Modify** `public/dashboard.js` — 单机分支:常量/`confirming`/`lastPayload`、`render()` 读 currentName + 透传、click 委托三分支、`deleteSession`/`rerender`/`removeCard`/`toast`
- **Modify** `public/dashboard.html` — 加 `<div id="toast">`
- **Create** `session_in_use.cjs` — `isSessionInUse(name, clients)` 纯函数(可单测)
- **Modify** `server.cjs` — require `session_in_use.cjs`;DELETE handler 前置 WS 活跃检查 → 409
- **Create** `test/dashboard_delete_render.test.cjs` — renderSession/renderSessionList 纯函数单测
- **Create** `test/dashboard_delete_contract.test.cjs` — dashboard.js 源码契约
- **Create** `test/dashboard_delete_style.test.cjs` — dashboard.css class 契约
- **Create** `test/session_in_use.test.cjs` — isSessionInUse 纯函数单测
- **Create** `test/session_in_use_contract.test.cjs` — server.cjs DELETE 接入契约

---

### Task 1: dashboard_render.cjs 渲染层 —— 删除按钮 + isCurrent/confirming opts

**Files:**
- Modify: `public/dashboard_render.cjs`(`renderSession` 约 :60-80,`renderSessionList` 约 :81-84)
- Test: `test/dashboard_delete_render.test.cjs`

**Interfaces:**
- Produces: `renderSession(s, index, opts)` 其中 `opts = { isCurrent?: boolean, confirming?: boolean }`(均可选,向后兼容旧 `renderSession(s, index)` 调用);`renderSessionList(sessions, currentName?, confirmingSet?)`(`currentName` string 可空,`confirmingSet` `Set` 可空)。

- [ ] **Step 1: 记录测试基线**

Run: `node --test test/*.test.cjs 2>&1 | tail -5`
Expected: 全绿;记下 pass 总数 = **B**(后续新增后应为 B + 本任务新增数)。

- [ ] **Step 2: 写失败测试 `test/dashboard_delete_render.test.cjs`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/dashboard_render.cjs');

test('renderSession: 默认含删除按钮 data-act=del', () => {
  const html = R.renderSession({ name: 'claude-foo', status: 'idle', cwd: '/x/foo', lastLine: 'hi' }, 0);
  assert.match(html, /class="[^"]*session__del[^"]*"/);
  assert.match(html, /data-act="del"/);
});

test('renderSession: isCurrent → 删除按钮 disabled + session--current + 当前会话提示', () => {
  const html = R.renderSession({ name: 'claude-foo', status: 'idle' }, 0, { isCurrent: true });
  assert.match(html, /session--current/);
  assert.match(html, /<button[^>]*session__del[^>]*disabled/);
  assert.match(html, /当前会话/);
});

test('renderSession: confirming → session--confirming + 取消/确认按钮,不含 del', () => {
  const html = R.renderSession({ name: 'claude-foo', status: 'idle' }, 0, { confirming: true });
  assert.match(html, /session--confirming/);
  assert.match(html, /data-act="cancel"/);
  assert.match(html, /data-act="confirm"/);
  assert.doesNotMatch(html, /data-act="del"/);
});

test('renderSessionList: 透传 currentName + confirmingSet', () => {
  const sessions = [
    { name: 'a', status: 'idle' },
    { name: 'b', status: 'idle' },
    { name: 'c', status: 'idle' },
  ];
  const html = R.renderSessionList(sessions, 'b', new Set(['c']));
  const bLi = html.match(/<li[^>]*data-session="b"[\s\S]*?<\/li>/)[0];
  const cLi = html.match(/<li[^>]*data-session="c"[\s\S]*?<\/li>/)[0];
  const aLi = html.match(/<li[^>]*data-session="a"[\s\S]*?<\/li>/)[0];
  assert.match(bLi, /session--current/);
  assert.match(cLi, /session--confirming/);
  assert.doesNotMatch(aLi, /session--current/);
  assert.doesNotMatch(aLi, /session--confirming/);
});

test('renderSessionList: 向后兼容(仅 sessions)不抛错', () => {
  const html = R.renderSessionList([{ name: 'a', status: 'idle' }]);
  assert.match(html, /data-session="a"/);
});
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `node --test test/dashboard_delete_render.test.cjs`
Expected: FAIL(`renderSession` 输出不含 `session__del`/`data-act`)。

- [ ] **Step 4: 改 `renderSession` 与 `renderSessionList`**

把 `public/dashboard_render.cjs` 的 `renderSession`(约 :60)整体替换为:

```js
    function renderSession(s, index, opts) {
        var o = opts || {};
        var statusKey = STATUS_LABEL[s.status] ? s.status : FALLBACK_STATUS_KEY;
        var status = STATUS_LABEL[statusKey];
        var sid = 's:' + String(index + 1).padStart(2, '0');
        var metaParts = [];
        if (s.cwd) metaParts.push('~/' + escapeHtml(shortPath(s.cwd)));
        if (s.lastLine) { metaParts.push(escapeHtml(s.lastLine)); }
        else { var t = relativeTime(s.lastTs); if (t) metaParts.push(t); }
        var meta = metaParts.join(' · ');
        var waitingCls = statusKey === 'waiting' ? ' waiting' : '';
        var cls = 'session' + waitingCls;
        if (o.isCurrent) cls += ' session--current';
        if (o.confirming) cls += ' session--confirming';

        // 操作区:confirming → [取消][删除?];否则 → 删除按钮(isCurrent 时 disabled)
        var actions;
        if (o.confirming) {
            actions = '<span class="s-confirm">'
                + '<button type="button" class="s-cancel" data-act="cancel">取消</button>'
                + '<button type="button" class="s-confirm-del" data-act="confirm">删除?</button>'
                + '</span>';
        } else {
            var dis = o.isCurrent ? ' disabled title="当前会话,先切换再删"' : '';
            actions = '<button type="button" class="session__del" data-act="del" aria-label="删除会话"' + dis + '>🗑</button>';
        }

        return '<li class="' + cls + '" data-session="' + escapeHtml(s.name)
            + '" tabindex="0" role="button" aria-label="' + escapeHtml(s.name) + ' · ' + escapeHtml(status) + '">'
            + '<span class="s-dot s-dot--' + escapeHtml(statusKey) + '" aria-hidden="true"></span>'
            + '<div class="s-main">'
            + '<span class="s-name">' + escapeHtml(s.name) + '</span>'
            + '<span class="s-meta">' + meta + '</span>'
            + '</div>'
            + '<span class="s-status">' + escapeHtml(status) + '</span>'
            + actions
            + '<span class="s-id">' + sid + '</span>'
            + '</li>';
    }
```

把 `renderSessionList`(约 :81)替换为:

```js
    function renderSessionList(sessions, currentName, confirmingSet) {
        var sorted = sortSessions(sessions);
        return sorted.map(function (s, i) {
            var opts = {
                isCurrent: typeof currentName === 'string' && s.name === currentName,
                confirming: !!(confirmingSet && confirmingSet.has(s.name))
            };
            return renderSession(s, i, opts);
        }).join('');
    }
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `node --test test/dashboard_delete_render.test.cjs`
Expected: PASS(5/5)。

- [ ] **Step 6: 回归 + 提交**

Run: `node --test test/*.test.cjs 2>&1 | tail -5`
Expected: B+5 通过、0 失败(dashboard_render.test.cjs 现有用例仍绿,因 renderSessionList 向后兼容)。

```bash
git add public/dashboard_render.cjs test/dashboard_delete_render.test.cjs
git commit -m "feat(dashboard): renderSession 加删除按钮/当前/确认态 opts(纯函数)"
```

---

### Task 2: dashboard.js 单机分支 —— 删除交互 + 当前标记 + confirming 存活

**Files:**
- Modify: `public/dashboard.js`(常量区约 :12-16、`render` 约 :49-67、click 委托约 :25-28、`poll` 附近加 `deleteSession` 等)
- Modify: `public/dashboard.html`(body 末尾加 toast 容器)
- Test: `test/dashboard_delete_contract.test.cjs`

**Interfaces:**
- Consumes: Task 1 的 `R.renderSessionList(sessions, currentName, confirmingSet)`。
- Produces: 浏览器运行时行为(click 委托 `data-act=del/cancel/confirm`、`deleteSession(name)`→`DELETE /api/sessions/:name`、`rerender()`、`confirming` Set、`CURRENT_KEY='cc_web_last_session'`)。无导出(IIFE)。

- [ ] **Step 1: 写契约测试 `test/dashboard_delete_contract.test.cjs`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.js'), 'utf8');

test('dashboard.js: 当前 session key 与 client.js 同值', () => {
  assert.match(SRC, /CURRENT_KEY\s*=\s*['"]cc_web_last_session['"]/);
});

test('dashboard.js: confirming Set(跨轮询存活)', () => {
  assert.match(SRC, /new Set\(\)/);
  assert.match(SRC, /confirming/);
});

test('dashboard.js: render 透传 currentName + confirming 给 renderSessionList', () => {
  assert.match(SRC, /renderSessionList\([^)]*currentName[^)]*confirming\)/);
});

test('dashboard.js: click 委托三分支 + stopPropagation(不触发导航)', () => {
  assert.match(SRC, /data-act="del"/);
  assert.match(SRC, /data-act="cancel"/);
  assert.match(SRC, /data-act="confirm"/);
  assert.match(SRC, /stopPropagation/);
});

test('dashboard.js: deleteSession 发 DELETE /api/sessions/:name', () => {
  assert.match(SRC, /\/api\/sessions\/['"]\s*\+\s*encodeURIComponent/);
  assert.match(SRC, /method:\s*['"]DELETE['"]/);
});

test('dashboard.js: 409(WS 保护)与 404(已不存在)分支', () => {
  assert.match(SRC, /===\s*409/);
  assert.match(SRC, /===\s*404/);
});

test('dashboard.js: 乐观移除 li[data-session]', () => {
  assert.match(SRC, /li\[data-session=/);
  assert.match(SRC, /removeChild\(|\.remove\(\)/);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/dashboard_delete_contract.test.cjs`
Expected: FAIL(源码尚未含这些构造)。

- [ ] **Step 3: 加常量与状态(在 `var prevSessions = [];` 之后)**

`public/dashboard.js` 找到 `var prevSessions = [];`(约 :16),其下追加:

```js
    var CURRENT_KEY = 'cc_web_last_session';
    var confirming = new Set();       // 确认态 session 名集合:作 renderSessionList 第三参,跨 2s 全量重建存活
    var lastPayload = null;           // 缓存最近 payload,供 rerender() 即时重画(不等下次轮询)
```

- [ ] **Step 4: 改 `render(payload)`(约 :49)—— 缓存 payload + 读 currentName + 透传 confirming**

把 `render` 函数体里的两行:
```js
        list.innerHTML = R.renderSessionList(sessions);
```
替换为:
```js
        lastPayload = payload;
        var currentName = localStorage.getItem(CURRENT_KEY) || '';
        list.innerHTML = R.renderSessionList(sessions, currentName, confirming);
```
(其余 `setTitle`/`setMeta`/`showState`/`diffChangedStatus`/flash 逻辑不变。)

- [ ] **Step 5: 加 `rerender()`、`deleteSession()`、`removeCard()`、`toast()`(放在 `render` 之后、`poll` 之前)**

```js
    function rerender() {
        if (!lastPayload) return;
        var sessions = (lastPayload && lastPayload.sessions) || [];
        var currentName = localStorage.getItem(CURRENT_KEY) || '';
        list.innerHTML = R.renderSessionList(sessions, currentName, confirming);
    }
    function removeCard(name) {
        var li = list.querySelector('li[data-session="' + name + '"]');
        if (li && li.parentNode) li.parentNode.removeChild(li);
    }
    function toast(msg) {
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('toast--show');
        clearTimeout(t._timer);
        t._timer = setTimeout(function () { t.classList.remove('toast--show'); }, 2200);
    }
    async function deleteSession(name) {
        try {
            var res = await fetch('/api/sessions/' + encodeURIComponent(name),
                { method: 'DELETE', headers: { 'Accept': 'application/json' } });
            if (res.status === 409) { toast('该会话正被控制台使用,无法删除'); rerender(); return; }
            if (res.status === 404) { removeCard(name); toast('会话已不存在'); return; }
            if (!res.ok) {
                var body = null; try { body = await res.json(); } catch (e) {}
                toast('删除失败:' + ((body && body.error) || res.status));
                rerender(); return;
            }
            removeCard(name); toast('已删除 ' + name);
        } catch (e) {
            toast('删除失败:网络错误'); rerender();
        }
    }
```

- [ ] **Step 6: 改 click 委托(约 :25)—— 命中 data-act 时拦截,否则落回 goToSession**

把现有:
```js
    list.addEventListener('click', function (e) {
        var row = rowFromEvent(e); if (!row) return;
        goToSession(row.getAttribute('data-session'));
    });
```
替换为:
```js
    list.addEventListener('click', function (e) {
        var actBtn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (actBtn) {
            var row = actBtn.closest('.session');
            if (!row) return;
            var name = row.getAttribute('data-session');
            var act = actBtn.getAttribute('data-act');
            e.stopPropagation(); e.preventDefault();
            if (act === 'del') {
                if (confirming.has(name) || actBtn.disabled) return;
                confirming.add(name); rerender();
            } else if (act === 'cancel') {
                confirming.delete(name); rerender();
            } else if (act === 'confirm') {
                confirming.delete(name); deleteSession(name);
            }
            return;
        }
        var row = rowFromEvent(e); if (!row) return;
        goToSession(row.getAttribute('data-session'));
    });
```

- [ ] **Step 7: `public/dashboard.html` 加 toast 容器**

在 `public/dashboard.html` 的 `</body>` 之前加:
```html
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
```
(implementer 读 dashboard.html 确认 body 结束位置;已有 #toast 则跳过。)

- [ ] **Step 8: 运行契约测试,确认通过**

Run: `node --test test/dashboard_delete_contract.test.cjs`
Expected: PASS(7/7)。

- [ ] **Step 9: 回归 + 提交**

Run: `node --test test/*.test.cjs 2>&1 | tail -5`
Expected: B+5+7 通过、0 失败。

```bash
git add public/dashboard.js public/dashboard.html test/dashboard_delete_contract.test.cjs
git commit -m "feat(dashboard): 单机看板加 session 删除交互+当前标记(就地确认)"
```

---

### Task 3: dashboard.css —— 删除按钮 / 当前标记 / 确认态 / toast 样式

**Files:**
- Modify: `public/dashboard.css`(文件末尾追加新段;implementer 先读 tokens.css 对齐颜色变量名)
- Test: `test/dashboard_delete_style.test.cjs`(class 存在契约)

**Interfaces:**
- Consumes: Task 1/2 产出的 class:`.session__del`、`.session--current`、`.session--confirming`、`.s-cancel`、`.s-confirm-del`、`.toast`/`.toast--show`。

- [ ] **Step 1: 写 class 存在契约测试 `test/dashboard_delete_style.test.cjs`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.css'), 'utf8');

for (const cls of ['.session__del', '.session--current', '.session--confirming', '.s-cancel', '.s-confirm-del', '.toast', '.toast--show']) {
  test('dashboard.css 含选择器 ' + cls, () => {
    assert.ok(CSS.includes(cls), '缺少 ' + cls);
  });
}
test('session__del 有 disabled 态', () => {
  assert.match(CSS, /session__del:disabled/);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/dashboard_delete_style.test.cjs`
Expected: FAIL(class 尚不存在)。

- [ ] **Step 3: 在 `public/dashboard.css` 末尾追加(implementer 先 `cat public/tokens.css` 核对 --errored/--accent 等实际变量名,带 fallback)**

```css
/* ===== session 生命周期管理:删除按钮 / 当前标记 / 确认态 / toast ===== */
.session { position: relative; }
.session__del {
    position: absolute; top: 6px; right: 6px;
    background: transparent; border: 0; cursor: pointer;
    padding: 4px 6px; font-size: 14px; line-height: 1;
    color: inherit; opacity: 0.45; border-radius: 4px;
}
.session__del:hover { opacity: 1; background: var(--errored, #e5484d); color: #fff; }
.session__del:disabled { opacity: 0.22; cursor: not-allowed; }
.session__del:disabled:hover { background: transparent; color: inherit; opacity: 0.22; }

.session--current { border-left: 3px solid var(--accent, #6E56CF); }
.session--current .s-name::after {
    content: ' · 当前'; color: var(--accent, #6E56CF); font-size: 11px; font-weight: 400;
}

.session--confirming { outline: 2px solid var(--errored, #e5484d); outline-offset: -2px; }
.s-confirm { display: inline-flex; gap: 6px; align-items: center; }
.s-cancel, .s-confirm-del {
    border: 0; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;
}
.s-cancel { background: transparent; color: inherit; opacity: 0.7; }
.s-confirm-del { background: var(--errored, #e5484d); color: #fff; }

.toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.82); color: #fff;
    padding: 8px 14px; border-radius: 6px; font-size: 13px;
    opacity: 0; pointer-events: none; transition: opacity .18s; z-index: 50;
}
.toast--show { opacity: 1; }
```

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/dashboard_delete_style.test.cjs`
Expected: PASS(8/8)。

- [ ] **Step 5: 回归 + 提交**

Run: `node --test test/*.test.cjs 2>&1 | tail -5`
Expected: B+5+7+8 通过、0 失败。

```bash
git add public/dashboard.css test/dashboard_delete_style.test.cjs
git commit -m "style(dashboard): 删除按钮/当前标记/确认态/toast 样式"
```

---

### Task 4: 后端 —— isSessionInUse 纯函数 + server.cjs DELETE 前置 WS 活跃保护(409)

**Files:**
- Create: `session_in_use.cjs`
- Create: `test/session_in_use.test.cjs`
- Modify: `server.cjs`(require 约 :21;DELETE handler 约 :547-563)
- Test: `test/session_in_use_contract.test.cjs`

**Interfaces:**
- Produces: `isSessionInUse(name, clients)` → `boolean`(`clients` 为 server.cjs 的 `clients` Map,key=ws,val 含 `sessionName`;`ws.readyState === 1` 视为活跃)。
- Consumes(server.cjs):现有 `clients` Map(:95)、DELETE handler(:547)。

- [ ] **Step 1: 写失败测试 `test/session_in_use.test.cjs`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSessionInUse } = require('../session_in_use.cjs');

const OPEN = 1, CLOSED = 3;
function mkWs(readyState) { return { readyState }; }

test('无连接 → false', () => {
  assert.equal(isSessionInUse('foo', []), false);
  assert.equal(isSessionInUse('foo', new Map()), false);
});

test('sessionName 匹配 + OPEN → true', () => {
  assert.equal(isSessionInUse('foo', new Map([[mkWs(OPEN), { sessionName: 'foo' }]])), true);
});

test('sessionName 匹配但 CLOSED → false', () => {
  assert.equal(isSessionInUse('foo', new Map([[mkWs(CLOSED), { sessionName: 'foo' }]])), false);
});

test('sessionName 不匹配 → false', () => {
  assert.equal(isSessionInUse('foo', new Map([[mkWs(OPEN), { sessionName: 'bar' }]])), false);
});

test('多连接其一匹配 OPEN → true', () => {
  const clients = new Map([
    [mkWs(OPEN), { sessionName: 'bar' }],
    [mkWs(OPEN), { sessionName: 'foo' }],
  ]);
  assert.equal(isSessionInUse('foo', clients), true);
});

test('空 name / 无 clients → false', () => {
  assert.equal(isSessionInUse('', new Map()), false);
  assert.equal(isSessionInUse('foo', null), false);
  assert.equal(isSessionInUse('foo', undefined), false);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/session_in_use.test.cjs`
Expected: FAIL(`Cannot find module '../session_in_use.cjs'`)。

- [ ] **Step 3: 创建 `session_in_use.cjs`**

```js
/**
 * 判断某 session 名是否有活跃 WS 连接。
 * 用途:server.cjs DELETE /api/sessions/:name 前置检查——控制台正连着(WS 活跃)则拒绝删除(409),
 * 防多标签/多设备 localStorage 不一致导致误杀当前会话(自杀)。
 *
 * 纯函数:`clients`(server.cjs 的 Map,key=ws,val 含 sessionName)由调用方传入,便于单测。
 * 活跃判定:ws.readyState === 1(OPEN),同 server.cjs ping 逻辑(:580)。
 */
function isSessionInUse(name, clients) {
  if (typeof name !== 'string' || !name) return false;
  if (!clients || typeof clients[Symbol.iterator] !== 'function') return false;
  for (const entry of clients) {
    const ws = entry && entry[0];
    const info = entry && entry[1];
    if (info && info.sessionName === name && ws && ws.readyState === 1) return true;
  }
  return false;
}
module.exports = { isSessionInUse };
```

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/session_in_use.test.cjs`
Expected: PASS(6/6)。

- [ ] **Step 5: 写 server.cjs 接入契约测试 `test/session_in_use_contract.test.cjs`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs: require session_in_use.cjs', () => {
  assert.match(SERVER, /require\(['"]\.\/session_in_use\.cjs['"]\)/);
});

test('server.cjs: DELETE handler 在 killSession 之前调 isSessionInUse → 409 session_in_use', () => {
  const m = SERVER.match(/app\.delete\('\/api\/sessions\/:name'[\s\S]*?\n  \}\);/);
  assert.ok(m, '未找到 DELETE /api/sessions/:name handler');
  const h = m[0];
  const checkIdx = h.indexOf('isSessionInUse');
  const killIdx = h.indexOf('killSession');
  assert.notEqual(checkIdx, -1, 'DELETE 未调用 isSessionInUse');
  assert.ok(killIdx > checkIdx, 'isSessionInUse 检查须在 killSession 之前');
  assert.match(h, /status\(409\)/);
  assert.match(h, /session_in_use/);
});
```

- [ ] **Step 6: 运行,确认失败**

Run: `node --test test/session_in_use_contract.test.cjs`
Expected: FAIL(server.cjs 尚未 require / 未接入)。

- [ ] **Step 7: `server.cjs` 加 require(在 `require('./session_default.cjs')` 附近,约 :21)**

```js
const { isSessionInUse } = require('./session_in_use.cjs');
```

- [ ] **Step 8: `server.cjs` DELETE handler(约 :547)前置 WS 活跃检查**

把:
```js
  app.delete('/api/sessions/:name', async (req, res) => {
    try {
      if (!requireSameOriginForUnsafeMethods(req, res)) return;
      const name = req.params.name;
      // kill 前取 cwd → slug,清理绑定文件(否则同名会话复用会读到旧 sid,定位错 jsonl)
      const sessions = await listSessions();
```
改为(在 `const name = ...;` 之后、`listSessions()` 之前插入 409 检查):
```js
  app.delete('/api/sessions/:name', async (req, res) => {
    try {
      if (!requireSameOriginForUnsafeMethods(req, res)) return;
      const name = req.params.name;
      // 防自杀:控制台正连着该会话(WS 活跃)则拒绝删除(多标签/多设备兜底)
      if (isSessionInUse(name, clients)) {
        return res.status(409).json({ success: false, error: 'session_in_use' });
      }
      // kill 前取 cwd → slug,清理绑定文件(否则同名会话复用会读到旧 sid,定位错 jsonl)
      const sessions = await listSessions();
```
(其余 `tmux.killSession` + `deleteBinding` 不变。)

- [ ] **Step 9: 运行契约测试,确认通过**

Run: `node --test test/session_in_use_contract.test.cjs`
Expected: PASS(2/2)。

- [ ] **Step 10: 回归 + 提交**

Run: `node --test test/*.test.cjs 2>&1 | tail -5`
Expected: B+5+7+8+6+2 通过、0 失败。

```bash
git add session_in_use.cjs test/session_in_use.test.cjs test/session_in_use_contract.test.cjs server.cjs
git commit -m "feat(server): DELETE /api/sessions 加 WS 活跃保护(409 防自杀)"
```

---

### Task 5: 回归 + 手动冒烟验证

**Files:** 无(验证任务)

- [ ] **Step 1: 全量测试**

Run: `node --test test/*.test.cjs 2>&1 | tail -8`
Expected: 全绿,总数 = B + 28(5+7+8+6+2)、0 失败。

- [ ] **Step 2: 启动单机 + 建多会话**

Run(后台):`node server.cjs`(默认 :7684)
浏览器开 `http://127.0.0.1:7684/dashboard.html`。在控制台项目启动区点两个不同项目,各建一个会话;看板应显示两张卡片。

- [ ] **Step 3: 验证删除(非当前会话)**

控制台连会话 A(`/?session=A`)→ 回看板:A 卡应有「当前」标记 + 删除按钮禁用;点 B 卡删除按钮 → 卡片红框 + `[取消][删除?]` → 点「删除?」→ B 卡消失 + toast「已删除 B」;2s 轮询后 B 不复现。

- [ ] **Step 4: 验证当前会话禁删**

看板点 A(当前)的删除按钮 → 按钮禁用、无确认态弹出(toast 不出现)。

- [ ] **Step 5: 验证后端 WS 保护(多标签)**

开两个浏览器标签:标签 1 控制台连会话 A;标签 2 看板。标签 2 点 A 删除 → 确认 → toast「该会话正被控制台使用,无法删除」(409)、A 卡保留。

- [ ] **Step 6: 验证不动 hub(回归)**

启 hub(`node hub/server_entry.cjs`,:7685)→ 其看板卡片渲染、`/jump` 导航、fanout-bar 多选广播均正常(未受单机改动影响)。

- [ ] **Step 7: 收尾提交(若有冒烟中发现的小修)**

```bash
git status --short
# 若有改动:
git add -A && git commit -m "fix(dashboard): 冒烟验证修订"
```

---

## Self-Review(plan 自审,已执行)

1. **Spec coverage**:
   - 删除入口 + 就地确认 → Task 1(render)+ Task 2(交互)+ Task 3(样式)。✅
   - 当前激活标记(前端禁用)→ Task 1(isCurrent disabled)+ Task 2(读 CURRENT_KEY)+ Task 3(`.session--current`)。✅
   - 后端 WS 活跃保护 409 → Task 4。✅
   - 不动 hub → Global Constraints + 各 Task 均限单机分支;Task 5 Step 6 回归验证。✅
   - 删除语义不变(kill+清绑定保留历史)→ Task 4 仅前置检查、不动 kill/deleteBinding。✅
   - confirming 跨轮询存活 → Task 1(第三参)+ Task 2(confirming Set + lastPayload + rerender)。✅
   - 404 处理 → Task 2 deleteSession。✅
2. **Placeholder scan**:无 TBD/TODO;CSS 变量名让 implementer 读 tokens.css 核对(带 fallback,非占位);dashboard.html toast 位置让 implementer 确认 body 结束(有明确兜底"已有则跳过")。
3. **Type consistency**:`renderSession(s, index, opts={isCurrent,confirming})` / `renderSessionList(sessions, currentName, confirmingSet)` / `isSessionInUse(name, clients)` 在各 Task 与契约测试中签名一致;`data-act="del|cancel|confirm"` 在 render/contract 一致;`CURRENT_KEY='cc_web_last_session'` 与 Global Constraints 一致。
