/**
 * 看板渲染纯逻辑(无 DOM 依赖,供 node --test 单测)。
 * 浏览器经 window.CCDashboard 挂载(dashboard.js 使用);测试经 require。
 * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.2 / §6 状态系统。
 */
(function (root, factory) {
    const api = factory();
    if (typeof window !== 'undefined') { window.CCDashboard = api; }
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    var STATUS_WEIGHT = { waiting: 0, errored: 0, working: 1, idle: 2, unknown: 3 };
    var STATUS_LABEL = { waiting: '等待', errored: '错误', working: '工作中', idle: '空闲', unknown: '未知' };
    var FALLBACK_WEIGHT = 3;
    var FALLBACK_STATUS_KEY = 'unknown';

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function relativeTime(lastTs, nowTs) {
        if (!lastTs || typeof lastTs !== 'number') return '';
        var now = typeof nowTs === 'number' ? nowTs : Date.now();
        var ageS = Math.max(0, Math.round((now - lastTs) / 1000));
        if (ageS < 60) return ageS + 's 前';
        if (ageS < 3600) return Math.round(ageS / 60) + 'm 前';
        if (ageS < 86400) return Math.round(ageS / 3600) + 'h 前';
        return Math.round(ageS / 86400) + 'd 前';
    }
    function shortPath(p) {
        var parts = String(p).split('/');
        return parts[parts.length - 1] || p;
    }
    function sortSessions(sessions) {
        return sessions.slice().sort(function (a, b) {
            var wa = STATUS_WEIGHT[a.status] != null ? STATUS_WEIGHT[a.status] : FALLBACK_WEIGHT;
            var wb = STATUS_WEIGHT[b.status] != null ? STATUS_WEIGHT[b.status] : FALLBACK_WEIGHT;
            if (wa !== wb) return wa - wb;
            return (b.lastTs || 0) - (a.lastTs || 0);
        });
    }
    function countWaiting(sessions) {
        return sessions.filter(function (s) { return s.status === 'waiting' || s.status === 'errored'; }).length;
    }
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
    function renderSession(s, index) {
        var statusKey = STATUS_LABEL[s.status] ? s.status : FALLBACK_STATUS_KEY;
        var status = STATUS_LABEL[statusKey];
        var sid = 's:' + String(index + 1).padStart(2, '0');
        var metaParts = [];
        if (s.cwd) metaParts.push('~/' + escapeHtml(shortPath(s.cwd)));
        if (s.lastLine) { metaParts.push(escapeHtml(s.lastLine)); }
        else { var t = relativeTime(s.lastTs); if (t) metaParts.push(t); }
        var meta = metaParts.join(' · ');
        var waitingCls = statusKey === 'waiting' ? ' waiting' : '';
        return '<li class="session' + waitingCls + '" data-session="' + escapeHtml(s.name)
            + '" tabindex="0" role="button" aria-label="' + escapeHtml(s.name) + ' · ' + escapeHtml(status) + '">'
            + '<span class="s-dot s-dot--' + escapeHtml(statusKey) + '" aria-hidden="true"></span>'
            + '<div class="s-main">'
            + '<span class="s-name">' + escapeHtml(s.name) + '</span>'
            + '<span class="s-meta">' + meta + '</span>'
            + '</div>'
            + '<span class="s-status">' + escapeHtml(status) + '</span>'
            + '<span class="s-id">' + sid + '</span>'
            + '</li>';
    }
    function renderSessionList(sessions) {
        var sorted = sortSessions(sessions);
        return sorted.map(function (s, i) { return renderSession(s, i); }).join('');
    }
    function renderState(eyebrow, lede) {
        return '<p class="eyebrow">[' + escapeHtml(eyebrow) + ']</p>'
            + '<p class="lede">' + escapeHtml(lede) + '</p>';
    }
    return {
        STATUS_WEIGHT: STATUS_WEIGHT, STATUS_LABEL: STATUS_LABEL,
        escapeHtml: escapeHtml, relativeTime: relativeTime, shortPath: shortPath,
        sortSessions: sortSessions, countWaiting: countWaiting,
        diffChangedStatus: diffChangedStatus,
        renderSession: renderSession, renderSessionList: renderSessionList, renderState: renderState
    };
});
