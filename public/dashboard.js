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

    function renderFleetSummary(machines, singleMachine, partition) {
        var s = BR.summarizeFleet(machines);
        // NEW-H2:showBoardError 把 fleetSummary.hidden=true;恢复时(任意 renderBoard 路径均经此)
        // 必须复位 hidden=false,否则摘要区在错误恢复后永久隐藏。
        fleetSummary.hidden = false;
        if (singleMachine && partition) {
            // 单机:会话维度(活跃/陈旧/异常),机器数无信息量故略
            fleetSummary.innerHTML =
                '<span>' + partition.active.length + ' 活跃</span>' +
                '<span>' + partition.stale.length + ' 陈旧</span>' +
                '<span><span class="s-icon" aria-hidden="true">✕</span> ' + s.errored + ' 异常</span>';
        } else {
            // 多机:机器维度(现状)
            fleetSummary.innerHTML =
                '<span><span class="s-icon" aria-hidden="true">▶</span> ' + s.working + '</span>' +
                '<span><span class="s-icon" aria-hidden="true">⏸</span> ' + s.idle + '</span>' +
                '<span><span class="s-icon" aria-hidden="true">✕</span> ' + s.errored + '</span>' +
                '<span>在线 ' + s.online + '/' + s.total + '</span>';
        }
        var t = singleMachine ? 'CC 看板 · 单机' : '(' + s.online + ') CC 看板 · 多机';
        document.title = t;
        var titleEl2 = document.getElementById('title'); if (titleEl2) titleEl2.textContent = t;
    }
    function buildCardLi(card, singleMachine) {
        var li = document.createElement('li');
        li.className = 'card-row'; li.dataset.key = card.key;
        // Fix 2:BR.buildCardInner 直接返回 <a href="/console.html?m=&s=">…</a>(click-to-navigate)
        li.innerHTML = BR.buildCardInner(card.machine, card.session, {
            lastTs: card.lastTs, now: Date.now(), singleMachine: singleMachine
        });
        return li;
    }
    function renderBoard(payload) {
        var machines = payload.machines || [];
        var flat = BR.flattenFleet(machines);
        // 单机判定:不同 machine.id ≤ 1 → 单机模式(弱化机器维度,强化会话/项目维度)
        var machineIds = {};
        for (var mi = 0; mi < machines.length; mi++) machineIds[machines[mi].id] = true;
        // 0 机器不标单机(避免标题「单机」与正文「NO MACHINES」矛盾);单机 = 有机器且不同 id ≤ 1
        var singleMachine = machines.length > 0 && Object.keys(machineIds).length <= 1;
        var sorted = BR.sortCardsByRelevance(flat);
        var partition = BR.partitionStale(sorted);
        if (machines.length === 0) {
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
            renderFleetSummary(machines, false, partition);   // 0 机器走多机空态,不标单机
            return;
        }
        if (!sorted.length) {
            // 有机器但无会话:区分于「无机器」,引导启动会话而非查 hub 注册
            boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO SESSIONS</span> 暂无运行中的会话,在控制台启动一个。</li>';
            renderFleetSummary(machines, singleMachine, partition);
            return;
        }
        // 展开状态保持:轮询全量重建前记录陈旧折叠区 open 状态,重建后继承(免每次轮询重折叠打扰)
        var prevStaleOpen = false;
        var prevDetails = boardBody.querySelector('li.board-stale-group > details');
        if (prevDetails) prevStaleOpen = !!prevDetails.open;
        // 全量重建:单机规模无 keyed-diff 性能压力,每次轮询无条件清空 boardBody.innerHTML。
        boardBody.innerHTML = '';
        for (var ai = 0; ai < partition.active.length; ai++) {
            var liA = buildCardLi(partition.active[ai], singleMachine);
            boardBody.appendChild(liA);
        }
        if (partition.stale.length) {
            var groupLi = document.createElement('li');
            groupLi.className = 'board-stale-group';
            var details = document.createElement('details'); // 默认 closed(无 open 属性)
            if (prevStaleOpen) details.open = true; // 继承上次展开状态
            var sum = document.createElement('summary');
            sum.textContent = partition.stale.length + ' 个陈旧会话(>24h)';
            details.appendChild(sum);
            var grid = document.createElement('ul');
            grid.className = 'board-grid board-stale-grid';
            for (var si = 0; si < partition.stale.length; si++) {
                var liS = buildCardLi(partition.stale[si], singleMachine);
                grid.appendChild(liS);
            }
            details.appendChild(grid);
            groupLi.appendChild(details);
            boardBody.appendChild(groupLi);
        }
        renderFleetSummary(machines, singleMachine, partition);
    }
    // Fix 6:hub 降级(5xx/格式异常)时把错误消息显式呈现到看板区,替代静默回退单机
    function showBoardError(msg) {
        document.getElementById('sessionList').hidden = true;
        boardBody.hidden = false;
        fleetSummary.hidden = true;
        boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">ERROR</span> ' + msg + '</li>';
        // ERROR <li> 由 renderBoard 下次轮询的无条件 innerHTML='' 清除,无需额外状态重置。
    }
    // 卡片 click-to-navigate 由 <a href="/console.html?m=&s="> 原生处理(无需 JS 拦截);中键/书签均可用
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
