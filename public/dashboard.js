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

    function goToSession(name) {
        if (!name) return;
        window.location.href = '/?session=' + encodeURIComponent(name);
    }
    function rowFromEvent(e) {
        return e.target.closest ? e.target.closest('.session') : null; // §7.2:210 .session-row → .session
    }
    list.addEventListener('click', function (e) {
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
    async function poll() {
        try {
            var res = await fetch('/api/dashboard', { headers: { 'Accept': 'application/json' } });
            if (res.status === 401) { window.location.href = '/login?next=/dashboard.html'; return false; }
            // 404:多机 hub 不提供单机 /api/dashboard(其 / → /console.html)。不误报 tmux,引导至多机控制台。
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
        if (document.hidden) { polling = false; }
        else if (!polling) { polling = true; loop(); }
    });

    // ---- 双模式探测:hub(global-dashboard 200)→ 卡片网格;否则单机 session-list ----
    var BR = window.BoardRender;
    var boardBody = document.getElementById('board-body');
    var fleetSummary = document.getElementById('fleet-summary');
    var boardStale = document.getElementById('board-stale');
    var prevKeys = new Set();
    var pollFailCount = 0;
    var lastPollOkTs = 0;

    function flattenCards(payload) {
        var cards = [];
        for (var i = 0; i < (payload.machines || []).length; i++) {
            var m = payload.machines[i];
            var online = m.online !== false;
            for (var j = 0; j < (m.sessions || []).length; j++) {
                var s = m.sessions[j];
                cards.push({
                    machine: m,
                    session: { name: s.name, status: online ? (s.status || 'unknown') : 'offline', lastLine: s.lastLine || '' },
                    key: m.id + '/' + s.name, name: m.name || m.id, lastTs: s.lastTs || 0
                });
            }
        }
        return cards;
    }
    function renderFleetSummary(machines) {
        var s = BR.summarizeFleet(machines);
        fleetSummary.innerHTML =
            '<span><span class="s-icon" aria-hidden="true">▶</span> ' + s.working + '</span>' +
            '<span><span class="s-icon" aria-hidden="true">⏸</span> ' + s.idle + '</span>' +
            '<span><span class="s-icon" aria-hidden="true">✕</span> ' + s.errored + '</span>' +
            '<span>在线 ' + s.online + '/' + s.total + '</span>';
        var t = '(' + s.online + ') CC 看板 · 多机';
        document.title = t;
        var titleEl2 = document.getElementById('title'); if (titleEl2) titleEl2.textContent = t;
    }
    function renderBoard(payload) {
        var sorted = BR.sortCardsErroredFirst(flattenCards(payload));
        if (!sorted.length) {
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
            prevKeys = new Set(); renderFleetSummary(payload.machines || []); return;
        }
        var nextKeys = sorted.map(function (c) { return c.key; });
        var diff = BR.diffCards(prevKeys, nextKeys);
        var cssEsc = function (s) { return String(s).replace(/["\\]/g, '\\$&'); };
        for (var k = 0; k < diff.removed.length; k++) {
            var n = boardBody.querySelector('[data-key="' + cssEsc(diff.removed[k]) + '"]'); if (n) n.remove();
        }
        for (var c = 0; c < sorted.length; c++) {
            var card = sorted[c];
            if (!boardBody.querySelector('[data-key="' + cssEsc(card.key) + '"]')) {
                var li = document.createElement('li');
                li.className = 'card-row'; li.dataset.key = card.key;
                // buildCardHTML 返回 <li class="card-row" data-key="..."><a ...>...</a></li>;
                // keyed-diff 已自带 <li data-key>,此处仅需内层 <a>(click-to-navigate 跳 /console.html?m=&s=)。
                li.innerHTML = BR.buildCardHTML(card.machine, card.session, { lastTs: card.lastTs, now: Date.now() })
                    .match(/<a[\s\S]*<\/a>/)[0];
                boardBody.appendChild(li);
            }
        }
        for (var r = 0; r < sorted.length; r++) { // 重排到 errored-first 顺序
            var e = boardBody.querySelector('[data-key="' + cssEsc(sorted[r].key) + '"]'); if (e) boardBody.appendChild(e);
        }
        prevKeys = new Set(nextKeys);
        renderFleetSummary(payload.machines || []);
    }
    // 卡片 click-to-navigate 由 <a href="/console.html?m=&s="> 原生处理(无需 JS 拦截);中键/书签均可用
    async function pollHub() {
        var ok = false;
        try {
            var res = await fetch('/api/global-dashboard');
            if (res.ok) { renderBoard(await res.json()); ok = true; }
        } catch (e) {}
        pollFailCount = ok ? 0 : pollFailCount + 1;
        if (ok) lastPollOkTs = Date.now();
        if (pollFailCount > 2 && lastPollOkTs && (Math.floor((Date.now() - lastPollOkTs) / 1000)) > 10) {
            var ago = Math.floor((Date.now() - lastPollOkTs) / 1000);
            boardStale.hidden = false; boardStale.textContent = '数据 ' + ago + 's 前';
        } else {
            boardStale.hidden = true;
        }
    }
    var hubPolling = false;
    async function hubLoop() {
        if (!hubPolling) return;
        await pollHub();
        if (hubPolling) setTimeout(hubLoop, 2000);
    }

    async function detectMode() {
        try {
            var probe = await fetch('/api/global-dashboard');
            if (probe.ok) {
                boardBody.hidden = false;
                fleetSummary.hidden = false;
                document.getElementById('sessionList').hidden = true;
                hubPolling = true; hubLoop();
                return;
            }
        } catch (e) {}
        // 404/网络 → 单机模式:跑现有 loop()
        loop();
    }

    detectMode();
})();
