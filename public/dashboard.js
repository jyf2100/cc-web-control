/**
 * CC 看板:轮询 /api/dashboard 渲染会话状态列表。
 * 渲染逻辑真源:dashboard_render.cjs(浏览器经 window.CCDashboard 挂载,测试经 require)。
 * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.2。
 */
(function () {
    'use strict';

    var R = window.CCDashboard;
    if (!R) { console.error('dashboard_render.cjs 未加载,看板无法渲染'); return; }
    var POLL_MS = 2000;
    var list = document.getElementById('sessionList');
    var stateMsg = document.getElementById('stateMessage');
    var titleEl = document.getElementById('title');
    var titleCountEl = document.getElementById('titleCount'); // 可选 header meta 锚点
    var prevSessions = [];
    var CURRENT_KEY = 'cc_web_last_session';
    var confirming = new Set();       // 确认态 session 名集合:作 renderSessionList 第三参,跨 2s 全量重建存活
    var lastPayload = null;           // 缓存最近 payload,供 rerender() 即时重画(不等下次轮询)

    function goToSession(name) {
        if (!name) return;
        // 独立标签页:同 session 复用已开标签(聚焦+重载最新),不同 session 各开一个 —— 与 7685 hub
        // 卡片 <a target="cc-<m>-<s>"> 同一套复用语义。窗口名 cc-local-<session>:cc- 前缀避 _blank 等
        // 保留名;session 名经 server 白名单 ^[A-Za-z0-9._-]{1,64}$,这里再 sanitize(纵深防御,与
        // board_render.windowNameFor 同正则)。不依赖 BR:board_render 未加载时单机回退仍可用。
        var safe = String(name).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
        var url = '/?session=' + encodeURIComponent(name);
        var win = window.open(url, 'cc-local-' + safe);
        if (win) { win.focus(); } else { window.location.href = url; } // 被弹窗拦截 → 回退当前页跳
    }
    function rowFromEvent(e) {
        return e.target.closest ? e.target.closest('.session') : null; // §7.2:210 .session-row → .session
    }
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
    list.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var row = rowFromEvent(e); if (!row) return;
        e.preventDefault(); goToSession(row.getAttribute('data-session'));
    });

    function setTitle(waiting) {
        var t = waiting > 0 ? '(' + waiting + ') CC 看板' : 'CC 看板';
        if (titleEl) titleEl.textContent = t;
        document.title = t;
    }
    function setMeta(count) {
        if (titleCountEl) titleCountEl.textContent = count + ' sessions'; // §7.2:209 不重复 waiting 计数
    }
    function showState(eyebrow, lede) {
        if (!stateMsg) return;
        list.innerHTML = '';
        stateMsg.hidden = false;
        stateMsg.innerHTML = R.renderState(eyebrow, lede);
    }
    function render(payload) {
        var sessions = (payload && payload.sessions) || [];
        var waiting = R.countWaiting(sessions);
        setTitle(waiting); setMeta(sessions.length);
        if (!payload || payload.tmuxOk === false) {
            showState('error', 'tmux 不可用,请确认 tmux 已安装并在 PATH 中。'); return;
        }
        if (sessions.length === 0) {
            showState('ready', '在本机启动 cc-web-control 会话后,这里会显示状态。'); return;
        }
        stateMsg.hidden = true;
        var changed = R.diffChangedStatus(prevSessions, sessions);
        lastPayload = payload;
        var currentName = localStorage.getItem(CURRENT_KEY) || '';
        list.innerHTML = R.renderSessionList(sessions, currentName, confirming);
        var items = list.querySelectorAll('.session');
        Array.prototype.forEach.call(items, function (li) {
            if (changed.has(li.getAttribute('data-session'))) li.classList.add('session--flash');
        });
        prevSessions = sessions;
    }
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
    async function poll() {
        try {
            var res = await fetch('/api/dashboard', { headers: { 'Accept': 'application/json' } });
            if (res.status === 401) { window.location.href = '/login?next=/dashboard.html'; return false; }
            // 404:多机 hub 不提供单机 /api/dashboard(仅 /api/global-dashboard)。不误报 tmux,引导至多机控制台。
            if (res.status === 404) { showState('error', '此处为单机看板,多机模式下请使用多机控制台。'); return true; }
            // 其余非 2xx:服务端异常(非 tmux 问题),按 HTTP 状态如实提示。
            if (!res.ok) { showState('error', '看板服务异常 (HTTP ' + res.status + '),重试中…'); return true; }
            render(await res.json());
        } catch (e) { showState('error', '连接失败,重试中…'); }
        return true;
    }
    var polling = true;
    async function loop() {
        if (!polling) return;
        var ok = await poll();
        if (ok && polling) setTimeout(loop, POLL_MS);
    }
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            polling = false;
            hubPolling = false;                                  // Fix 7:隐藏时停 hub 轮询
        } else {
            // NEW-M1:hub 模式下不该重启单机 loop()——/api/dashboard 在 hub 部署返回 404,
            // poll() 会 showState('error','此处为单机看板…') 撞入 stateMessage(<main> 内 sessionList
            // 的兄弟节点,非子节点),错误消息会叠在 hub 看板上。仅在非 hub 模式恢复单机轮询。
            if (!polling && !hubModeActive) { polling = true; loop(); }
            // Fix 7:hub 模式下,可见且未在轮询 → 恢复 hubLoop(此前 hubPolling 为死标志)
            if (hubModeActive && !hubPolling) { hubPolling = true; hubLoop(); }
        }
    });

    // ---- 双模式探测:hub(global-dashboard 200)→ 卡片网格;否则单机 session-list ----
    var BR = window.BoardRender;
    // Fix 3:board_render.cjs 缺失 → hub 模式不可用,显式回退单机(不裸跑 BR.* 报错)
    if (!BR) { console.error('board_render.cjs 未加载,hub 模式不可用,回退单机'); loop(); return; }

    var HUB_POLL_MS = POLL_MS;            // Fix 10:hub 轮询频率复用单机 POLL_MS(均为 2000ms)
    var STALE_FAIL_THRESHOLD = 2;         // Fix 10:pollFailCount > 2 即视为连续失败
    var STALE_SECS = 10;                  // Fix 10:lastPollOkTs 距今 > 10s → 弹 stale badge

    var boardBody = document.getElementById('board-body');
    var fleetSummary = document.getElementById('fleet-summary');
    var boardStale = document.getElementById('board-stale');
    var pollFailCount = 0;
    var lastPollOkTs = 0;
    var hubModeActive = false;            // Fix 7:visibilitychange 据 hubModeActive 决定是否重启 hubLoop
    var hubPolling = false;

    function renderFleetSummary(machines) {
        var msum = BR.summarizeFleet(machines);            // 机器维度 online/total
        var cards = BR.flattenFleet(machines);             // 离线机 session.status → 'offline'
        var c = BR.summarizeMachine(cards);                // 五通道会话计数(点和 = total)
        fleetSummary.hidden = false;                        // 错误恢复复位(原逻辑保留)
        var offlineMachines = msum.total - msum.online;
        var machineText = msum.online + ' 机在线'
            + (offlineMachines > 0 ? ' · ' + offlineMachines + ' 机离线' : '')
            + ' · ' + c.total + ' 会话';
        // demo L114–L121:机器文案在前,色谱圆点在后
        fleetSummary.innerHTML =
            '<span class="fleet-machine-text">' + machineText + '</span>' +
            '<span class="fleet-counts">' + BR.renderStatusCounts(c) + '</span>';
        var t = '(' + msum.online + ') CC 看板 · 多机';
        document.title = t;
        var titleEl2 = document.getElementById('title'); if (titleEl2) titleEl2.textContent = t;
    }
    function buildCardLi(card) {
        // Task 7:BR.buildCardRow 返回完整 <li class="card-row">…</li>(含 data-key/data-machine/data-session/
        // data-status + 同级 button.card__select[aria-pressed] + a.card[href=/jump?m=&s= target=_blank])。
        // 整段 innerHTML 解析为节点返回,不再手设 li.className / dataset.key(buildCardRow 已注入)。
        var wrap = document.createElement('ul');
        wrap.innerHTML = BR.buildCardRow(card.machine, card.session, {
            mode: 'hub', lastTs: card.lastTs, now: Date.now()
        });
        return wrap.firstElementChild;
    }
    // 三页面:卡片多选(扇出目标)。key = `${m.id}/${s.name}`(card.key)。Map 跨 2s 重建保持。
    var selected = new Map();   // key → {machine,session}
    function keyOf(machineId, sessionName) { return machineId + '/' + sessionName; }
    // Q3:sessionStorage 持久化选中态(跳转单机控制台返回后恢复)。存完整 {machine,session} 对象数组,免 split('/') 截断。
    var SELECTED_KEY = 'ccBoardSelected';
    function persistSelected() {
        try { sessionStorage.setItem(SELECTED_KEY, JSON.stringify(Array.from(selected.values()))); } catch (e) { /* sessionStorage 不可用时静默 */ }
    }
    function loadSelected() {
        try {
            var raw = sessionStorage.getItem(SELECTED_KEY);
            if (!raw) return;
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return;
            selected = new Map();   // reassign 闭包变量(后续 click 委托/reapplySelected 读到新 Map)
            for (var i = 0; i < arr.length; i++) {
                var t = arr[i];
                if (t && t.machine != null && t.session != null) selected.set(keyOf(t.machine, t.session), { machine: t.machine, session: t.session });
            }
        } catch (e) { /* 损坏 JSON 静默丢弃 */ }
    }
    function updateFanoutBar() {
        if (!fanoutBar) return;   // 防御:非看板页(console)无 #fanout-bar 时 null,避免报错
        var n = selected.size;
        selCount.textContent = n;
        fanoutBar.hidden = n === 0;
        fanoutBcCount.hidden = n < 2;
        fanoutBcCount.textContent = n >= 2 ? ('扇出 ' + n) : '';
        fanoutInput.placeholder = n >= 2 ? ('输入(Enter 扇出给 ' + n + ' 个被控)…')
            : n === 1 ? '输入(Enter 发送给该被控)…' : '输入…';
        persistSelected();   // Q3:所有 toggle/clear 路径都经 updateFanoutBar,集中持久化(reapplySelected 调时写回相同值,幂等无害)
    }
    loadSelected();   // 初始化:首次 renderBoard 前填充 Map(reapplySelected 自动重标 DOM)
    // Task 4:重建后重标选中卡片。renderBoard 末尾无条件调用。
    function reapplySelected() {
        // 全量重建后 selected(Map)存活,重标 DOM 的 card--selected + aria-pressed。
        // Task 7:button 与 a 同级,都在 .card-row 内 → 从 li 取 data-key,向下找 .card / .card__select。
        var rows = boardBody.querySelectorAll('.card-row');
        Array.prototype.forEach.call(rows, function (row) {
            var key = row.getAttribute('data-key');
            if (selected.has(key)) {
                var card = row.querySelector('.card');
                var tog = row.querySelector('.card__select');
                if (card) card.classList.add('card--selected');
                if (tog) { tog.setAttribute('aria-pressed', 'true'); tog.textContent = '☑'; }
            }
        });
        updateFanoutBar();
    }
    // click 委托:命中 button[data-toggle="select"] → toggle 选中(preventDefault 阻止 <a> 跳转);
    // 其余区域放行 → <a href="/jump?m=&s=" target="_blank"> 原生新标签开控制台(无需 JS)。
    boardBody.addEventListener('click', function (e) {
        var tog = e.target.closest('[data-toggle="select"]');
        if (!tog) return;   // 命中 <a> 或其内部 span → 放行,浏览器原生开新标签跳 /jump?m=&s=
        e.preventDefault();
        var row = tog.closest('.card-row');
        if (!row) return;
        var key = row.getAttribute('data-key');
        var card = row.querySelector('.card');
        if (selected.has(key)) {
            selected.delete(key);
            if (card) card.classList.remove('card--selected');
            tog.setAttribute('aria-pressed', 'false'); tog.textContent = '☐';
        } else {
            if (selected.size >= 50) {
                // P4:选满 50 上限不再静默吞 —— preventDefault 已拦 <a> 跳转,此处必须给可见 + 读屏可听反馈,
                // 否则 DOM 无变化、用户以为界面卡死。#bc-result 为 aria-live 区(dashboard.html),写文案自动播报;
                // 颜色用 --errored 提示异常;下次成功 toggle / 扇出 / WS 推送会覆盖,自然清除。
                if (fanoutBcResult) { fanoutBcResult.textContent = '最多选 50 个'; fanoutBcResult.style.color = 'var(--errored)'; }
                return;
            }
            selected.set(key, { machine: row.getAttribute('data-machine'), session: row.getAttribute('data-session') });
            if (card) card.classList.add('card--selected');
            tog.setAttribute('aria-pressed', 'true'); tog.textContent = '☑';
        }
        updateFanoutBar();   // Q3:集中持久化(内部调 persistSelected),click 委托无需再显式 persist
    });
    // Task 7:键盘可达性由 <button type="button"> 原生处理(Enter/Space 自动派发 click),
    // 不再需要 JS keydown 委托模拟(WCAG 2.1.1 合规由原生 button 语义保证)。
    // ---- 三页面:扇出 bar(broadcast + broadcast_result reduce)----
    var fanoutBar = document.getElementById('fanout-bar');
    var selCount = document.getElementById('sel-count');
    var fanoutInput = document.getElementById('fanout-input');
    var fanoutBcCount = document.getElementById('bc-count');
    var fanoutBcResult = document.getElementById('bc-result');
    var hubWs = null;
    function hubWsUrl() {
        var proto = location.protocol === 'https:' ? 'wss' : 'ws';
        var tok = new URLSearchParams(location.search).get('token');   // 复用 console.js 同款 ?token= 拼接(直链/测试 fallback,cookie 不够用时兜底)
        return proto + '://' + location.host + '/' + (tok ? '?token=' + encodeURIComponent(tok) : '');
    }
    function ensureHubWs() {
        if (hubWs && hubWs.readyState <= 1) return hubWs;
        hubWs = new WebSocket(hubWsUrl());
        hubWs.onmessage = function (ev) {
            var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.type === 'broadcast_result') {
                var arr = Array.isArray(msg.results) ? msg.results : [];
                var okN = arr.filter(function (r) { return r.ok; }).length;
                fanoutBcResult.textContent = '成功 ' + okN + '/' + arr.length;
                fanoutBcResult.style.color = okN === arr.length ? 'var(--working)' : 'var(--errored)';
            }
        };
        hubWs.onclose = function () { fanoutBcResult.textContent = '连接断开,重试…'; fanoutBcResult.style.color = 'var(--errored)'; };
        hubWs.onerror = function () { fanoutBcResult.textContent = '连接失败,检查 token/网络'; fanoutBcResult.style.color = 'var(--errored)'; };
        return hubWs;
    }
    function sendHub(msg) {
        var payload = JSON.stringify(msg);
        if (hubWs && hubWs.readyState === 1) hubWs.send(payload);
        else if (hubWs) hubWs.addEventListener('open', function () { hubWs.send(payload); }, { once: true });
    }
    if (fanoutBar) {
        ensureHubWs();
        fanoutBar.addEventListener('submit', function (e) {
            e.preventDefault();
            var v = fanoutInput.value;
            if (!v || selected.size === 0) { return; }
            ensureHubWs();
            var targets = Array.from(selected.values());
            fanoutBcResult.textContent = '扇出中…';
            fanoutBcResult.style.color = 'var(--waiting)';
            sendHub({ type: 'broadcast', targets: targets, data: v, enter: true });
            fanoutInput.value = '';
        });
        document.getElementById('sel-clear').addEventListener('click', function () {
            selected.clear();
            // Task 7:button 与 a 同级,都在 .card-row 内 → 遍历 li,向下找 .card / .card__select 复位。
            Array.prototype.forEach.call(boardBody.querySelectorAll('.card-row'), function (row) {
                var card = row.querySelector('.card');
                var tog = row.querySelector('.card__select');
                if (card) card.classList.remove('card--selected');
                if (tog) { tog.setAttribute('aria-pressed', 'false'); tog.textContent = '☐'; }
            });
            updateFanoutBar();
        });
    }
    function renderBoard(payload) {
        var machines = payload.machines || [];
        var flat = BR.flattenFleet(machines);
        // :7685 多机 hub:永远机器维度,不做 singleMachine 降级
        // (07-04 spec 错判 :7685 为单机,见 docs/superpowers/specs/2026-07-04-7685-hub-gap-audit.md §1)。
        var sorted = BR.sortCardsByRelevance(flat);
        var partition = BR.partitionStale(sorted);
        if (machines.length === 0) {
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
            renderFleetSummary(machines);
            return;
        }
        if (!sorted.length) {
            // 有机器但无会话:区分于「无机器」,引导启动会话而非查 hub 注册
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO SESSIONS</span> 暂无运行中的会话。请在某台被控机上启动 cc-web-control 进程。</li>';
            renderFleetSummary(machines);
            return;
        }
        // 全量重建:每次轮询无条件清空 boardBody.innerHTML。
        boardBody.innerHTML = '';
        // 按机分节:每机 <li class="machine-group"><div.machine-group__title>…</div><ul.board-grid>…
        // spec §3 / demo L130–L140:组标题不折叠(去 details/summary/caret),机器名现为唯一锚点。
        var groups = BR.groupByMachine(partition.active);
        for (var gi = 0; gi < groups.length; gi++) {
            var g = groups[gi];
            var online = g.machine.online !== false;
            var groupLi = document.createElement('li');
            groupLi.className = 'machine-group' + (online ? '' : ' machine-group--offline');
            var title = document.createElement('div');
            title.className = 'machine-group__title';
            var counts = BR.summarizeMachine(g.cards);
            title.innerHTML =
                '<span class="machine-group__name">' + (g.machine.name || g.machine.id) + '</span>' +
                '<span class="machine-group__status machine-group__status--' + (online ? 'online' : 'offline') + '">' +
                (online ? '· 在线' : '· 离线') + '</span>' +
                '<span class="machine-group__counts">' + BR.renderStatusCounts(counts) + '</span>' +
                '<span class="machine-group__total">' + g.cards.length + ' 会话</span>';
            var grid = document.createElement('ul');
            grid.className = 'board-grid';
            for (var ci = 0; ci < g.cards.length; ci++) {
                grid.appendChild(buildCardLi(g.cards[ci]));
            }
            groupLi.appendChild(title);
            groupLi.appendChild(grid);
            boardBody.appendChild(groupLi);
        }
        if (partition.stale.length) {
            var groupLi2 = document.createElement('li');
            groupLi2.className = 'board-stale-group';
            var details2 = document.createElement('details');
            details2.dataset.mid = '__stale__';
            details2.open = false;   // 陈旧区默认折叠(spec §5:折叠到底部)
            var sum2 = document.createElement('summary');
            sum2.textContent = partition.stale.length + ' 个陈旧会话(>24h)';
            var grid2 = document.createElement('ul');
            grid2.className = 'board-grid board-stale-grid';
            for (var si = 0; si < partition.stale.length; si++) grid2.appendChild(buildCardLi(partition.stale[si]));
            details2.appendChild(sum2); details2.appendChild(grid2);
            groupLi2.appendChild(details2);
            boardBody.appendChild(groupLi2);
        }
        reapplySelected();           // Task 4:重建后重标选中卡片
        renderFleetSummary(machines);
    }
    // Fix 6:hub 降级(5xx/格式异常)时把错误消息显式呈现到看板区,替代静默回退单机
    function showBoardError(msg) {
        document.getElementById('sessionList').hidden = true;
        boardBody.hidden = false;
        fleetSummary.hidden = true;
        boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">ERROR</span> ' + msg + '</li>';
        // ERROR <li> 由 renderBoard 下次轮询的无条件 innerHTML='' 清除,无需额外状态重置。
    }
    // 卡片 click-to-navigate 由 <a href="/jump?m=&s=" target="_blank"> 原生处理(无需 JS 拦截);中键/书签/Cmd+点击 均可用
    async function pollHub() {
        var ok = false;
        try {
            var res = await fetch('/api/global-dashboard');
            // Fix 5:401 → 登录页(带回跳),避免后续轮询在未授权态空转
            if (res.status === 401) { window.location.href = '/login?next=/dashboard.html'; return; }
            if (res.ok) {
                // Fix 8:非 JSON 200 → 数据格式异常,不静默重试(content-type 校验先于 .json())
                var ct = res.headers.get('content-type') || '';
                if (ct.indexOf('application/json') === -1) {
                    showBoardError('数据格式异常');
                } else {
                    var data;
                    try { data = await res.json(); }
                    catch (e) { showBoardError('数据格式异常'); console.warn('pollHub JSON 解析失败', e); }
                    if (data) { renderBoard(data); ok = true; }
                }
            }
        } catch (e) { console.warn('pollHub 失败', e); } // Fix 8:不再静默吞错
        pollFailCount = ok ? 0 : pollFailCount + 1;
        if (ok) lastPollOkTs = Date.now();
        // Fix 10:STALE_FAIL_THRESHOLD / STALE_SECS 命名常量(原魔法数 2 / 10)
        if (pollFailCount > STALE_FAIL_THRESHOLD && lastPollOkTs && (Math.floor((Date.now() - lastPollOkTs) / 1000)) > STALE_SECS) {
            var ago = Math.floor((Date.now() - lastPollOkTs) / 1000);
            boardStale.hidden = false; boardStale.textContent = '数据 ' + ago + 's 前';
        } else {
            boardStale.hidden = true;
        }
    }
    async function hubLoop() {
        if (!hubPolling) return;
        await pollHub();
        if (hubPolling) setTimeout(hubLoop, HUB_POLL_MS); // Fix 10:HUB_POLL_MS 命名常量
    }

    async function detectMode() {
        var probe;
        try {
            probe = await fetch('/api/global-dashboard');
        } catch (e) { console.warn('detectMode 探测失败', e); loop(); return; } // Fix 8:不再静默吞错
        // Fix 6:404 = 真单机(hub 不提供 global-dashboard)→ loop();5xx = hub 降级 → 显式错误
        if (probe.status === 404) { loop(); return; }
        // NEW-M2:/api/global-dashboard 需鉴权,401 → 登录页(带回跳),避免 probe 落入 !probe.ok
        // 分支误显「看板服务暂不可用」(原 commit msg 声称处理 401 但 detectMode 实际缺此分支)
        if (probe.status === 401) { window.location.href = '/login?next=/dashboard.html'; return; }
        if (!probe.ok) { showBoardError('看板服务暂不可用'); return; }
        // Fix 4:probe 结果直接首渲染 + 初始化 lastPollOkTs(免空白板 + 免冗余请求 + 后续失败 stale badge 可触发)
        var data;
        try { data = await probe.json(); }
        catch (e) { console.warn('detectMode JSON 解析失败', e); showBoardError('数据格式异常'); return; }
        lastPollOkTs = Date.now();
        boardBody.hidden = false;
        fleetSummary.hidden = false;
        document.getElementById('sessionList').hidden = true;
        hubModeActive = true;                              // Fix 7:标记 hub 模式,visibility 恢复时重启 hubLoop
        hubPolling = true;
        renderBoard(data);
        hubLoop();
    }

    detectMode();
})();
