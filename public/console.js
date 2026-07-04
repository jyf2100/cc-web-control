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

  const termTarget = document.getElementById('term-target');
  const termScreen = document.getElementById('term-screen');
  const termInput = document.getElementById('term-input');
  const termForm = document.getElementById('term-input-form');
  const termSection = document.querySelector('.console-term');
  const termCollapseBtn = document.getElementById('term-collapse-btn');
  const termFullscreenBtn = document.getElementById('term-fullscreen-btn');
  const bcCount = document.getElementById('bc-count');
  const bcResult = document.getElementById('bc-result');
  const fleetSummary = document.getElementById('fleet-summary');
  const heroCallout = document.getElementById('hero-callout');
  const maToggleBtn = document.getElementById('ma-toggle-btn');
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
      renderTopbarAlert();
    } else if (state === 'live') {
      termInput.disabled = false;
      if (currentTarget) termTarget.textContent = `${currentTarget.machine} / ${currentTarget.session}`;
      renderTopbarAlert();
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
    renderTopbarAlert();
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

  function refreshBroadcast() {
    const broadcasting = selected.size >= 2;
    bcCount.hidden = selected.size < 2;
    bcCount.textContent = broadcasting ? `扇出 ${selected.size}` : '';
    termInput.placeholder = broadcasting ? `给 ${selected.size} 个会话发同一条指令…` : '输入(Enter 发送)…';
  }

  // 控制台只 poll main-agent 状态;看板数据(global dashboard)归 dashboard.html,此处不再拉取
  async function poll() {
    try {
      const r = await fetch('/api/main-agent/status');
      if (r.ok) maStatus = await r.json();
    } catch {}
    renderMaStatus();
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
    renderMaCallout();
  }

  // HERO L2 渲染:calloutState 跨 poll 保持,供 parseCallout 算 stable 相对时间
  let calloutState = { lastText: '', lastChangeTs: 0 };

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
    // 终端可折叠(P1 §4.2 A6):收起时仅留 .term-header 单行,腾空间给主控区
    const collapsed = termSection.getAttribute('data-collapsed') === 'true';
    termSection.setAttribute('data-collapsed', String(!collapsed));
    termCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
    // 切前 collapsed:true → 切后展开(▾);false → 切后收起(▸)
    termCollapseBtn.textContent = collapsed ? '▾终端' : '▸终端';
  });
  // 终端全屏:切 data-fullscreen,.console-term position:fixed 覆盖视口(隐藏 topbar/hero),
  // 再点按钮或按 Esc 退出。aria-pressed 反映切换态,aria-label/文案同步给读屏。
  const setFullscreen = (fs) => {
    termSection.setAttribute('data-fullscreen', String(fs));
    termFullscreenBtn.setAttribute('aria-pressed', String(fs));
    termFullscreenBtn.textContent = fs ? '✕退出全屏' : '⛶全屏';
    termFullscreenBtn.setAttribute('aria-label', fs ? '退出终端全屏' : '终端全屏');
  };
  termFullscreenBtn.addEventListener('click', () => {
    setFullscreen(termSection.getAttribute('data-fullscreen') !== 'true');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && termSection.getAttribute('data-fullscreen') === 'true') setFullscreen(false);
  });

  // ---- 切换抽屉(createSwitchSheet,数据 /api/machines 按需,多选 → 广播)----
  const switchTab = document.getElementById('switchTab');
  let switchSheet = null;
  let multiSelectMode = false;

  async function openSwitchSheet() {
    if (!window.SwitchSheet || !switchTab) return;
    let machines = [];
    try { const r = await fetch('/api/machines'); if (r.ok) machines = (await r.json()).machines || []; } catch {}
    // 扁平化 machine/session
    const items = [];
    for (const m of machines) {
      const online = m.online !== false;
      for (const s of (m.sessions || [])) {
        items.push({
          machine: m.id, session: s.name,
          label: `${m.name || m.id} / ${s.name}${online ? '' : ' · 离线'}`,
          key: `${m.id}/${s.name}`,
        });
      }
    }
    if (!switchSheet) {
      switchSheet = window.SwitchSheet.createSwitchSheet({
        trigger: switchTab,
        backdropRoot: '.console-app',
        // 不用 onPick:交互全在 renderMachineItems 内(支持多选不关闭);createSwitchSheet 默认 onPick 为 noop
      });
    }
    renderMachineItems(items);
    switchSheet.open();
    switchTab.setAttribute('aria-expanded', 'true');
  }

  // 渲染机器项到 sheet(单选 attach+关 / 多选 toggle selected);每次 toggle 重建列表刷新选中态
  function renderMachineItems(items) {
    const sheetEl = document.getElementById('switchSheet'); // createSwitchSheet 注入的根元素(id 见 switch_sheet.cjs)
    if (!sheetEl) return;
    const old = sheetEl.querySelector('.switch-sheet-machines'); if (old) old.remove();
    const oldToggle = sheetEl.querySelector('.switch-sheet-multitoggle'); if (oldToggle) oldToggle.remove();
    const wrap = document.createElement('div'); wrap.className = 'switch-sheet-machines';
    const title = document.createElement('p'); title.className = 'switch-sheet-section-title';
    title.textContent = multiSelectMode ? `机器(已选 ${selected.size} · 扇出)` : '机器';
    wrap.appendChild(title);
    const list = document.createElement('ul'); list.className = 'switch-sheet-list'; list.setAttribute('role', 'list');
    if (!items.length) {
      const empty = document.createElement('p'); empty.className = 'switch-sheet-projects-empty';
      empty.textContent = '暂无机器'; wrap.appendChild(empty);
    } else {
      items.forEach((it) => {
        const isSel = selected.has(it.key);
        const li = document.createElement('li'); li.className = 'switch-sheet-item';
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'switch-sheet-btn';
        btn.setAttribute('aria-pressed', String(isSel));
        btn.textContent = (multiSelectMode ? (isSel ? '☑ ' : '☐ ') : '') + it.label;
        btn.addEventListener('click', () => {
          if (multiSelectMode) {
            selected.has(it.key) ? selected.delete(it.key) : selected.add(it.key);
            refreshBroadcast();
            renderMachineItems(items); // 重建刷新选中态(避免陈旧闭包)
            return;
          }
          attachTarget({ machine: it.machine, session: it.session });
          if (switchSheet) switchSheet.close();
        });
        li.appendChild(btn); list.appendChild(li);
      });
    }
    wrap.appendChild(list); sheetEl.appendChild(wrap);
    // 多选模式开关
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'switch-sheet-btn switch-sheet-multitoggle';
    toggle.textContent = multiSelectMode ? '✓ 多选模式(广播)' : '切多选模式';
    toggle.addEventListener('click', () => { multiSelectMode = !multiSelectMode; renderMachineItems(items); });
    sheetEl.appendChild(toggle);
  }

  if (switchTab) switchTab.addEventListener('click', openSwitchSheet);

  // ---- URL ?m=&s= 读取 + 失败兜底 ----
  const params = new URLSearchParams(location.search);
  const urlM = params.get('m'), urlS = params.get('s');
  function tryAttachFromUrl() {
    if (!urlM || !urlS) return;
    fetch('/api/machines').then((r) => r.ok ? r.json() : { machines: [] }).then((d) => {
      const found = (d.machines || []).some((m) => m.id === urlM && (m.sessions || []).some((s) => s.name === urlS));
      if (found) attachTarget({ machine: urlM, session: urlS });
      else {
        termScreen.textContent = `机器 ${urlM} 未注册或会话 ${urlS} 不存在。点底部「切换」选择机器。`;
        setTermState('disconnected');
      }
    }).catch(() => { /* 网络失败:静默,WS 后续重试 */ });
  }

  // ---- 跨页 openSwitchSheet flag(看板「切换」tab 写入)----
  if (sessionStorage.getItem('openSwitchSheet') === '1') {
    sessionStorage.removeItem('openSwitchSheet');
    setTimeout(openSwitchSheet, 300); // 等 createSwitchSheet 可用
  }

  // ---- topbar 当前机告警(替代旧 fleet 摘要;复用 #fleet-summary 挂点)----
  function renderTopbarAlert() {
    if (!fleetSummary) return;
    if (!currentTarget) { fleetSummary.innerHTML = '<span>未选机器</span>'; return; }
    fleetSummary.innerHTML = `<span>${currentTarget.machine} / ${currentTarget.session}</span>`;
  }

  setInterval(renderMaCallout, 30000);
  setInterval(poll, 2000);
  poll();
  ensureWs();
  tryAttachFromUrl();
  renderTopbarAlert();
})();
