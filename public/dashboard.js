/**
 * CC 看板:轮询 /api/dashboard 渲染会话状态列表
 */
(function () {
    'use strict';

    var POLL_MS = 2000;
    var list = document.getElementById('sessionList');
    var stateMsg = document.getElementById('stateMessage');
    var titleEl = document.getElementById('title');

    // 状态权重:等待/错误置顶(需注意),其次工作中,再空闲,未知最后
    var STATUS_WEIGHT = { waiting: 0, errored: 0, working: 1, idle: 2, unknown: 3 };
    var STATUS_LABEL = {
        waiting: '等待', errored: '错误', working: '工作中', idle: '空闲', unknown: '未知'
    };
    var STATUS_ICON = {
        waiting: '⏳', errored: '✕', working: '◐', idle: '○', unknown: '?'
    };

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function relativeTime(lastTs) {
        if (!lastTs || typeof lastTs !== 'number') return '';
        var ageS = Math.max(0, Math.round((Date.now() - lastTs) / 1000));
        if (ageS < 60) return ageS + 's 前';
        if (ageS < 3600) return Math.round(ageS / 60) + 'm 前';
        if (ageS < 86400) return Math.round(ageS / 3600) + 'h 前';
        return Math.round(ageS / 86400) + 'd 前';
    }

    function shortPath(p) {
        var parts = String(p).split('/');
        return parts[parts.length - 1] || p;
    }

    function setTitle(waiting) {
        var t = waiting > 0 ? '(' + waiting + ') CC 看板' : 'CC 看板';
        titleEl.textContent = t;
        document.title = t;
    }

    function showState(strong, body) {
        list.innerHTML = '';
        stateMsg.hidden = false;
        stateMsg.innerHTML = '<strong>' + strong + '</strong>' + body;
    }

    function render(payload) {
        var sessions = (payload && payload.sessions) || [];
        var waiting = sessions.filter(function (s) {
            return s.status === 'waiting' || s.status === 'errored';
        }).length;
        setTitle(waiting);

        if (!payload || payload.tmuxOk === false) {
            showState('tmux 不可用', '请确认 tmux 已安装并在 PATH 中。');
            return;
        }
        if (sessions.length === 0) {
            showState('还没有会话', '在主控制台启动一个会话,这里会显示状态。');
            return;
        }
        stateMsg.hidden = true;

        var sorted = sessions.slice().sort(function (a, b) {
            var w = (STATUS_WEIGHT[a.status] != null ? STATUS_WEIGHT[a.status] : 3)
                  - (STATUS_WEIGHT[b.status] != null ? STATUS_WEIGHT[b.status] : 3);
            if (w !== 0) return w;
            return (b.lastTs || 0) - (a.lastTs || 0);
        });

        list.innerHTML = sorted.map(function (s) {
            var status = STATUS_LABEL[s.status] || '未知';
            var icon = STATUS_ICON[s.status] || '?';
            var metaParts = [];
            if (s.cwd) metaParts.push(shortPath(s.cwd));
            var t = relativeTime(s.lastTs);
            if (t) metaParts.push(t);
            var meta = escapeHtml(metaParts.join(' · '));
            var preview = s.lastLine
                ? '<span class="arrow">▸ 最后:</span><span class="text">' + escapeHtml(s.lastLine) + '</span>'
                : '';
            return '<li class="session-row">'
                + '<span class="badge badge--' + escapeHtml(s.status) + '"><span class="badge-dot">' + icon + '</span>' + escapeHtml(status) + '</span>'
                + '<div class="session-main">'
                + '<span class="session-name">' + escapeHtml(s.name) + '</span>'
                + '<span class="session-meta">' + meta + '</span>'
                + '</div>'
                + '<div class="session-preview">' + preview + '</div>'
                + '</li>';
        }).join('');
    }

    async function poll() {
        try {
            var res = await fetch('/api/dashboard', { headers: { 'Accept': 'application/json' } });
            if (res.status === 401) {
                window.location.href = '/login?next=/dashboard.html';
                return false;
            }
            if (!res.ok) {
                render({ tmuxOk: false, sessions: [] });
                return true;
            }
            render(await res.json());
        } catch (e) {
            render({ tmuxOk: false, sessions: [] });
        }
        return true;
    }

    async function loop() {
        var ok = await poll();
        if (ok) setTimeout(loop, POLL_MS);
    }

    loop();
})();
