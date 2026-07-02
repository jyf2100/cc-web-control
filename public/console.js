'use strict';
(function () {
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
  const bcBar = document.getElementById('broadcast-bar');
  const bcCount = document.getElementById('bc-count');
  const bcInput = document.getElementById('bc-input');
  const bcSend = document.getElementById('bc-send');
  const bcResult = document.getElementById('bc-result');

  function ensureWs() {
    if (ws && ws.readyState <= 1) return ws;
    ws = new WebSocket(wsUrl);
    // 修正 Bug 2:init 覆盖、output 追加(增量不丢历史)
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        termScreen.textContent += '\n[协议错误] 非 JSON 帧';
        return;
      }
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
    return ws;
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
    if (!currentTarget || !termInput.value) return;
    sendWhenOpen({ type: 'input', target: currentTarget, data: termInput.value, enter: true });
    termInput.value = '';
  });

  function renderBoard(payload) {
    boardBody.innerHTML = '';
    for (const m of payload.machines) {
      for (const s of m.sessions) {
        const key = `${m.id}/${s.name}`;
        const tr = document.createElement('tr');
        tr.className = 'row';
        if (currentTarget && currentTarget.machine === m.id && currentTarget.session === s.name) tr.classList.add('active');
        const sel = document.createElement('td'); sel.className = 'sel';
        const cb = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = selected.has(key);
        cb.addEventListener('change', () => { cb.checked ? selected.add(key) : selected.delete(key); refreshBroadcast(); });
        cb.addEventListener('click', (e) => e.stopPropagation());
        sel.appendChild(cb);
        const name = document.createElement('td'); name.textContent = `${m.name || m.id} / ${s.name}`;
        const st = document.createElement('td'); st.className = 'st-' + (s.status || 'unknown'); st.textContent = s.status || 'unknown';
        const last = document.createElement('td'); last.textContent = s.lastLine || (m.online ? '' : '(离线)');
        tr.append(sel, name, st, last);
        tr.addEventListener('click', () => attachTarget({ machine: m.id, session: s.name }));
        boardBody.appendChild(tr);
      }
    }
  }

  function refreshBroadcast() {
    bcBar.hidden = selected.size < 2;
    bcCount.textContent = `已选 ${selected.size} 个会话`;
  }

  bcSend.addEventListener('click', () => {
    const targets = Array.from(selected).map((k) => { const [machine, session] = k.split('/'); return { machine, session }; });
    if (!targets.length || !bcInput.value) return;
    bcResult.textContent = '扇出中…';
    ensureWs();
    sendWhenOpen({ type: 'broadcast', targets, data: bcInput.value, enter: true });
    bcInput.value = '';
  });

  async function poll() {
    try {
      const res = await fetch('/api/global-dashboard');
      if (res.ok) renderBoard(await res.json());
    } catch {}
  }
  setInterval(poll, 2000);
  poll();
  ensureWs();
})();
