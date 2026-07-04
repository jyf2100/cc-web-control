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
    loop();
})();
