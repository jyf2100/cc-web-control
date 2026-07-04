'use strict';
(function () {
  // 移动端软键盘适配(P1 §4.2 A6):visualViewport 变化时同步 --vh,
  // 配合 CSS height: var(--vh, 100dvh) 避免终端/输入被键盘遮(100dvh 仅近似)。
  if (window.visualViewport) {
    const updateVh = () => {
      document.documentElement.style.setProperty('--vh', window.visualViewport.height + 'px');
    };
    window.visualViewport.addEventListener('resize', updateVh);
    window.visualViewport.addEventListener('scroll', updateVh);
    updateVh();
  }

  // 认证:同源 cookie(httpOnly,JS 读不到)由浏览器自动携带;?token= 仅测试/直链 fallback
  const queryToken = new URLSearchParams(location.search).get('token') || '';
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`
    + (queryToken ? `?token=${encodeURIComponent(queryToken)}` : '');
  let ws = null;
  let currentTarget = null;       // {machine,session}
  const selected = new Set();     // "machine/session"

  const boardBody = document.getElementById('board-body');
  const termTarget = document.getElementById('term-target');
  const termScreen = document.getElementById('term-screen');
  const termInput = document.getElementById('term-input');
  const termForm = document.getElementById('term-input-form');
  const termSection = document.querySelector('.console-term');
  const termCollapseBtn = document.getElementById('term-collapse-btn');
  const bcCount = document.getElementById('bc-count');
  const bcResult = document.getElementById('bc-result');
  const fleetSummary = document.getElementById('fleet-summary');
  const heroCallout = document.getElementById('hero-callout');
  const heroL1 = document.getElementById('hero-l1');
  const maToggleBtn = document.getElementById('ma-toggle-btn');
  let lastPayload = null;
  let lastBoardMachines = [];
  const maPanel = document.getElementById('main-agent-panel');
  const maDot = document.getElementById('ma-status-dot');
  const maText = document.getElementById('ma-status-text');
  const maScreen = document.getElementById('ma-screen');
  const maStartBtn = document.getElementById('ma-start-btn');
  const maStopBtn = document.getElementById('ma-stop-btn');
  let maWs = null;
  let maStatus = { running: false, enabled: false };
  let maReconnectTimer = null;
  let maDisconnectedLogged = false; // M1:仅断开状态转换时记一次,防重连失败循环刷屏

  let termReconnectTimer = null;
  let termBackoff = 0;
  let reconnectedOnce = false;

  function setTermState(state) {
    termTarget.setAttribute('data-state', state);
    if (state === 'disconnected') {
      termTarget.textContent = (currentTarget ? `${currentTarget.machine} / ${currentTarget.session} · ` : '') + '● 断线,重连中…';
      termInput.disabled = true;
    } else if (state === 'live') {
      termInput.disabled = false;
      if (currentTarget) termTarget.textContent = `${currentTarget.machine} / ${currentTarget.session}`;
    }
  }

  function ensureWs() {
    if (ws && ws.readyState <= 1) return ws;
    ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { termScreen.textContent += '\n[协议错误] 非 JSON 帧'; return; }
      const isCurrent = currentTarget && msg.target &&
        msg.target.machine === currentTarget.machine && msg.target.session === currentTarget.session;
      if (msg.type === 'init' && isCurrent) {
        termScreen.textContent = msg.data || '';
        termScreen.scrollTop = termScreen.scrollHeight;
      } else if (msg.type === 'output' && isCurrent) {
        termScreen.textContent += msg.data || '';
        termScreen.scrollTop = termScreen.scrollHeight;
      } else if (msg.type === 'error' && isCurrent) {
        termScreen.textContent += `\n[错误] ${msg.data}`;
      } else if (msg.type === 'broadcast_result') {
        const arr = Array.isArray(msg.results) ? msg.results : [];
        const okN = arr.filter((r) => r.ok).length;
        bcResult.textContent = `成功 ${okN}/${arr.length}`;
      }
    };
    ws.onopen = () => {
      termBackoff = 0;
      if (termReconnectTimer) { clearTimeout(termReconnectTimer); termReconnectTimer = null; }
      if (currentTarget) {
        setTermState('live');
        sendWhenOpen({ type: 'attach', target: currentTarget });
        if (reconnectedOnce) termScreen.textContent += '\n[已重连]';
      }
      reconnectedOnce = true;
    };
    ws.onclose = () => { scheduleTermReconnect(); };
    ws.onerror = () => { scheduleTermReconnect(); };
    return ws;
  }

  function scheduleTermReconnect() {
    if (termReconnectTimer) return;          // 防 onclose+onerror 双触发(避免 backoff 双步推进 + timer 泄漏)
    if (currentTarget) setTermState('disconnected');
    const delay = ConsoleRender.nextBackoff(termBackoff++);
    termReconnectTimer = setTimeout(() => {
      termReconnectTimer = null;
      if (!ws || ws.readyState > 1) ensureWs();
    }, delay);
  }

  // 修正 Bug 1:不累积 open listener。已连接立即发,否则 once 等 open
  function sendWhenOpen(msg) {
    const payload = JSON.stringify(msg);
    if (ws && ws.readyState === 1) ws.send(payload);
    else if (ws) ws.addEventListener('open', () => ws.send(payload), { once: true });
  }

  function attachTarget(t) {
    currentTarget = t;
    termTarget.textContent = t ? `${t.machine} / ${t.session}` : '未选择会话';
    termScreen.textContent = '';
    if (!t) return;
    ensureWs();
    sendWhenOpen({ type: 'attach', target: t });
  }

  termForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!termInput.value) return;
    ensureWs();
    if (selected.size >= 2) {
      const targets = Array.from(selected).map((k) => { const [machine, session] = k.split('/'); return { machine, session }; });
      bcResult.textContent = '扇出中…';
      sendWhenOpen({ type: 'broadcast', targets, data: termInput.value, enter: true });
    } else if (currentTarget) {
      sendWhenOpen({ type: 'input', target: currentTarget, data: termInput.value, enter: true });
    } else {
      return;
    }
    termInput.value = '';
  });

  let prevKeys = new Set();

  function flattenCards(payload) {
    const cards = [];
    for (const m of payload.machines || []) {
      const online = m.online !== false;
      for (const s of m.sessions || []) {
        const status = online ? (s.status || 'unknown') : 'offline';
        cards.push({ machine: m, session: { ...s, status }, key: `${m.id}/${s.name}`, name: m.name || m.id, lastTs: s.lastTs || 0 });
      }
    }
    return cards;
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  // 已存在卡片的 diff 更新:只改变化的属性/文本,避免单卡 innerHTML 整体重建
  // 丢键盘焦点/中断点击(P0 a11y)。字段派生对齐 ConsoleRender.buildCardHTML。
  function updateCardNode(li, c) {
    const active = !!(currentTarget && currentTarget.machine === c.machine.id && currentTarget.session === c.session.name);
    const isSel = selected.has(c.key);
    const status = c.session.status || 'unknown';
    const meta = ConsoleRender.statusMeta(status);
    const name = c.machine.name || c.machine.id;
    const lastRaw = c.session.lastLine || (c.machine.online === false ? '(离线)' : '');
    const lastDisp = lastRaw || '—';
    const time = ConsoleRender.relativeTime(c.lastTs, Date.now());
    const label = `${isSel ? '已选,' : ''}${name} / ${c.session.name},${meta.label},${lastRaw ? lastRaw.slice(0, 40) : '无输出'}`;

    const btn = li.querySelector('.card');
    if (!btn) return; // 兜底:异常空 li,等下次 poll 重建
    if (btn.getAttribute('data-status') !== status) btn.setAttribute('data-status', status);
    if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
    // class 重算整串比对(active/card--selected 与 data-status 组合由 CSS 接管左色条)
    const cls = 'card' + (active ? ' active' : '') + (isSel ? ' card--selected' : '');
    if (btn.className !== cls) btn.className = cls;
    const check = isSel ? '☑' : '☐';
    const selEl = li.querySelector('.card__select');
    if (selEl && selEl.textContent !== check) selEl.textContent = check;
    const dotEl = li.querySelector('.s-dot');
    const dotCls = 's-dot ' + meta.dot;
    if (dotEl && dotEl.className !== dotCls) dotEl.className = dotCls;
    const iconEl = li.querySelector('.s-icon');
    if (iconEl && iconEl.textContent !== meta.icon) iconEl.textContent = meta.icon;
    const nameEl = li.querySelector('.card__name');
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
    const sessEl = li.querySelector('.card__session');
    if (sessEl && sessEl.textContent !== c.session.name) sessEl.textContent = c.session.name;
    const lastEl = li.querySelector('.card__last');
    if (lastEl && lastEl.textContent !== lastDisp) lastEl.textContent = lastDisp;
    const timeEl = li.querySelector('.card__time');
    if (timeEl && timeEl.textContent !== time) timeEl.textContent = time;
  }

  function renderBoard(payload) {
    lastPayload = payload;
    lastBoardMachines = payload.machines || [];
    const sorted = ConsoleRender.sortCardsErroredFirst(flattenCards(payload));

    if (!sorted.length) {
      boardBody.innerHTML = '<li class="board-empty"><span class="eyebrow">NO MACHINES</span> 尚无机器注册到 hub</li>';
      prevKeys = new Set();
      refreshBroadcast();
      renderFleetSummary(lastBoardMachines);
      return;
    }

    const nextKeys = sorted.map((c) => c.key);
    const diff = ConsoleRender.diffCards(prevKeys, nextKeys);
    for (const key of diff.removed) {
      const node = boardBody.querySelector(`[data-key="${cssEsc(key)}"]`);
      if (node) node.remove();
    }
    for (const c of sorted) {
      const li = boardBody.querySelector(`[data-key="${cssEsc(c.key)}"]`);
      if (!li) {
        // 新增卡片:buildCardHTML 初始化(新节点无焦点可丢)
        const node = document.createElement('li');
        node.className = 'card-row';
        node.dataset.key = c.key;
        node.innerHTML = ConsoleRender.buildCardHTML(c.machine, c.session, {
          active: currentTarget && currentTarget.machine === c.machine.id && currentTarget.session === c.session.name,
          selected: selected.has(c.key),
          lastTs: c.lastTs,
          now: Date.now(),
        }).match(/<button[\s\S]*<\/button>/)[0];
        boardBody.appendChild(node);
      } else {
        // 已存在:diff 更新属性/文本,保留键盘焦点 & 动画
        updateCardNode(li, c);
      }
    }
    // 按 sorted 顺序重排(appendChild 移动已存在节点,不重建 → 保留 scrollTop/focus)
    for (const c of sorted) {
      const li = boardBody.querySelector(`[data-key="${cssEsc(c.key)}"]`);
      if (li) boardBody.appendChild(li);
    }
    prevKeys = new Set(nextKeys);
    refreshBroadcast();
    renderFleetSummary(lastBoardMachines);
  }

  function renderFleetSummary(machines) {
    const s = ConsoleRender.summarizeFleet(machines);
    fleetSummary.innerHTML =
      `<span><span class="s-icon" aria-hidden="true">▶</span> ${s.working}</span>` +
      `<span><span class="s-icon" aria-hidden="true">⏸</span> ${s.idle}</span>` +
      `<span><span class="s-icon" aria-hidden="true">✕</span> ${s.errored}</span>` +
      `<span>在线 ${s.online}/${s.total}</span>`;
  }

  function refreshBroadcast() {
    const broadcasting = selected.size >= 2;
    bcCount.hidden = selected.size < 2;
    bcCount.textContent = broadcasting ? `扇出 ${selected.size}` : '';
    termInput.placeholder = broadcasting ? `给 ${selected.size} 个会话发同一条指令…` : '输入(Enter 发送)…';
  }

  async function poll() {
    let boardOk = false;
    try {
      const res = await fetch('/api/global-dashboard');
      if (res.ok) { const p = await res.json(); renderBoard(p); boardOk = true; }
    } catch {}
    try {
      const r = await fetch('/api/main-agent/status');
      if (r.ok) maStatus = await r.json();
    } catch {}
    pollFailCount = boardOk ? 0 : pollFailCount + 1;
    if (boardOk) lastPollOkTs = Date.now();
    renderMaStatus();
    // stale 提示位置见 renderHeroL1:fleet 数据过期应在 HERO 健康摘要,而非 main-agent 状态栏
  }

  function renderMaStatus() {
    const enabled = !!maStatus.enabled;
    const running = !!maStatus.running;
    maPanel.classList.toggle('disabled', !enabled);
    maDot.className = 'dot ' + (running ? 'running' : 'stopped');
    maDot.title = running ? 'running' : 'stopped';
    maText.textContent = !enabled ? 'disabled' : (running ? 'running' : 'stopped');
    maStartBtn.disabled = !enabled || running;
    maStopBtn.disabled = !enabled || !running;
    if (enabled && running && (!maWs || maWs.readyState > 1)) ensureMaWs();
    // L1:running 转 false(用户 Stop)时主动关 maWs + 重置断开标记,免留陈旧连接/陈旧提示
    if (enabled && !running && maWs) { try { maWs.close(); } catch {} maWs = null; maDisconnectedLogged = false; }
    // L2:!enabled 时关 maWs 并清重连 timer(原仅关 maWs,timer 靠下 tick 自清)
    if (!enabled) {
      if (maWs) { try { maWs.close(); } catch {} maWs = null; }
      if (maReconnectTimer) { clearInterval(maReconnectTimer); maReconnectTimer = null; }
    }
    renderHeroL1();
    renderMaCallout();
  }

  // HERO L1/L2 渲染:calloutState 跨 poll 保持,供 parseCallout 算 stable 相对时间
  let calloutState = { lastText: '', lastChangeTs: 0 };
  let pollFailCount = 0;
  let lastPollOkTs = 0;

  function renderHeroL1() {
    // stale:fleet 数据连续失败(>2 次 ≈ 6s+)&& 最后成功 >10s 前 → HERO L1 覆盖
    // 显示"数据 Ns 前"+ 暖琥珀,提示整个 fleet 数据过期(原误写在 #ma-status-text)
    if (pollFailCount > 2 && lastPollOkTs) {
      const ago = Math.floor((Date.now() - lastPollOkTs) / 1000);
      if (ago > 10) {
        heroL1.innerHTML = `<span class="hero-stale"><span class="s-icon" aria-hidden="true">⏳</span> 数据 ${ago}s 前</span>`;
        heroL1.classList.add('hero-l1--stale');
        return;
      }
    }
    heroL1.classList.remove('hero-l1--stale');
    const s = ConsoleRender.summarizeFleet(lastBoardMachines);
    heroL1.innerHTML =
      `<span><span class="s-icon" aria-hidden="true">▶</span> ${s.working} working</span>` +
      `<span><span class="s-icon" aria-hidden="true">⏸</span> ${s.idle} idle</span>` +
      `<span><span class="s-icon" aria-hidden="true">✕</span> ${s.errored} errored</span>`;
  }

  function renderMaCallout() {
    const r = ConsoleRender.parseCallout(maScreen.textContent, { ...calloutState, now: Date.now() });
    if (!r.show) { heroCallout.hidden = true; return; }
    heroCallout.hidden = false;
    heroCallout.textContent = `⚠ ${r.text} · ${r.timeLabel}`;
    calloutState = { lastText: r.text, lastChangeTs: r.ts };
  }

  function ensureMaWs() {
    if (maWs && maWs.readyState <= 1) return maWs;
    maWs = new WebSocket(wsUrl);
    maWs.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'init' && msg.target && msg.target.machine === 'main-agent') {
        maScreen.textContent = msg.data || '';
        maScreen.scrollTop = maScreen.scrollHeight;
      } else if (msg.type === 'error' && msg.target && msg.target.machine === 'main-agent') {
        maScreen.textContent += `\n[错误] ${msg.data}`;
      }
    };
    maWs.onopen = () => {
      maDisconnectedLogged = false; // M1:重连成功,允许下次断开再记
      maWs.send(JSON.stringify({ type: 'attach', target: { machine: 'main-agent', session: 'cc-main-agent' } }));
    };
    maWs.onclose = () => {
      if (maStatus.enabled && maStatus.running) {
        // M1:仅断开"状态转换"时记一次;重连失败循环里每个新 WS 的 onclose 不再重复追加
        if (!maDisconnectedLogged) {
          maScreen.textContent += '\n[连接断开,重连中…]';
          maDisconnectedLogged = true;
        }
        if (!maReconnectTimer) maReconnectTimer = setInterval(() => {
          if (maStatus.enabled && maStatus.running && (!maWs || maWs.readyState > 1)) ensureMaWs();
          else if (maReconnectTimer) { clearInterval(maReconnectTimer); maReconnectTimer = null; }
        }, 3000);
      }
    };
    return maWs;
  }

  async function maAction(path, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        // M2:HTTP 失败(429 限流/503 未就绪/500)给瞬态提示;不立即 renderMaStatus(会覆盖提示)。
        // 按钮保持 disabled ~2s 直到下次 poll 的 renderMaStatus 按真实状态恢复(兼防双击)。
        const detail = res.status === 429 ? '请求过频,请稍候'
          : res.status === 503 ? 'agent 未就绪'
          : `HTTP ${res.status}`;
        maText.textContent = `操作失败:${detail}`;
        return;
      }
      await poll(); // 成功 → poll 末尾 renderMaStatus 更新按钮 + 状态
    } catch {
      maText.textContent = '网络错误,请重试';
    }
  }
  maStartBtn.addEventListener('click', () => maAction('/api/main-agent/start', maStartBtn));
  maStopBtn.addEventListener('click', () => maAction('/api/main-agent/stop', maStopBtn));
  boardBody.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const machine = card.dataset.machine, session = card.dataset.session;
    const key = `${machine}/${session}`;
    if (e.target.closest('.card__select')) {
      e.stopPropagation();
      selected.has(key) ? selected.delete(key) : selected.add(key);
      refreshBroadcast();
      if (lastPayload) renderBoard(lastPayload);
      return;
    }
    attachTarget({ machine, session });
  });
  boardBody.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const machine = card.dataset.machine, session = card.dataset.session;
      // Shift+Enter/Space:切该卡片 selected(键盘多选 → 广播可达,广播需 selected.size>=2)
      if (e.shiftKey) {
        const key = `${machine}/${session}`;
        selected.has(key) ? selected.delete(key) : selected.add(key);
        refreshBroadcast();
        if (lastPayload) renderBoard(lastPayload);
      } else {
        attachTarget({ machine, session });
      }
    }
  });
  maToggleBtn.addEventListener('click', () => {
    // data-ma-open 浮层显隐(CSS [data-ma-open="true"] 控 main-agent-panel 内 ma-screen 浮层)
    const open = maPanel.getAttribute('data-ma-open') === 'true';
    maPanel.setAttribute('data-ma-open', String(!open));
    maToggleBtn.setAttribute('aria-expanded', String(!open));
    // a11y:抽屉折叠时把 #ma-screen 从可访问树隐藏(展开 → aria-hidden=false;折叠 → true)
    // open 为切前状态:String(open) 恰为切后状态对应的 aria-hidden 值
    maScreen.setAttribute('aria-hidden', String(open));
  });
  termCollapseBtn.addEventListener('click', () => {
    // 终端可折叠(P1 §4.2 A6):收起时仅留 .term-header 单行,腾空间给卡片网格
    const collapsed = termSection.getAttribute('data-collapsed') === 'true';
    termSection.setAttribute('data-collapsed', String(!collapsed));
    termCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
    // 切前 collapsed:true → 切后展开(▾);false → 切后收起(▸)
    termCollapseBtn.textContent = collapsed ? '▾终端' : '▸终端';
  });
  setInterval(renderMaCallout, 30000);
  setInterval(poll, 2000);
  poll();
  ensureWs();
})();
