'use strict';
(function () {
  // 认证:同源 cookie(httpOnly,JS 读不到)由浏览器自动携带;?token= 仅测试/直链 fallback
  const queryToken = new URLSearchParams(location.search).get('token') || '';
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`
    + (queryToken ? `?token=${encodeURIComponent(queryToken)}` : '');
  let ws = null;
  let currentTarget = null;       // {machine,session}
  const selected = new Set();     // "machine/session"

  const H = window.HubUI;         // 纯函数(helper):危险指令检测/确认阈值/回执分流/在线统计
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
  const hubStatus = document.getElementById('hub-status');

  // ===== hub 连接/聚合状态:点亮顶部 #hub-status(告别死元素)=====
  function setStatus(state, text) {
    hubStatus.className = 'hub-status is-' + state;
    hubStatus.textContent = text;
  }

  function ensureWs() {
    if (ws && ws.readyState <= 1) return ws;
    setStatus('connecting', '正在连接 hub…');
    ws = new WebSocket(wsUrl);
    // onopen 后首轮 poll 聚合会把文案覆盖为带在线/离线计数
    ws.onopen = () => setStatus('connected', '已连接');
    ws.onclose = () => {
      setStatus('disconnected', '已断开,2s 后重连…');
      // 广播若在途中,复位按钮避免永久卡死「扇出中…」(WS 掉线时 broadcast_result 不会到达)
      bcSend.disabled = false;
      refreshBroadcast();
      setTimeout(() => ensureWs(), 2000); // 自动重连:hub 回来后看板恢复
    };
    ws.onerror = () => setStatus('error', '连接错误');
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
        renderBcResult(H.summarizeBroadcast(msg.results));
        bcSend.disabled = false;
        refreshBroadcast();
      }
    };
    return ws;
  }

  // 不累积 open listener:已连接立即发,否则 once 等 open
  function sendWhenOpen(msg) {
    const payload = JSON.stringify(msg);
    const safeSend = () => { try { ws.send(payload); } catch {} }; // 兜底 readyState 检查与 send 间的窄竞态
    if (ws && ws.readyState === 1) safeSend();
    else if (ws) ws.addEventListener('open', safeSend, { once: true });
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
    const machines = (payload && payload.machines) || [];
    // 空态:没有机器接入,给明确指引而非一张空表
    if (!machines.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'board-empty';
      td.textContent = '还没有机器接入 hub。请在各机器运行 cc-web-control 并在 hub 清单登记。';
      tr.appendChild(td);
      boardBody.appendChild(tr);
      setStatus('connected', '已连接 · 0 台机器');
      return;
    }
    for (const m of machines) {
      if (!m.online) {
        // 离线机:mergeDashboards 已清空其 sessions,这里补一行让其可见(一眼看到哪台挂了)+ 整行变灰
        const tr = document.createElement('tr');
        tr.className = 'row offline';
        const sel = document.createElement('td'); sel.className = 'sel';
        const name = document.createElement('td'); name.className = 'name'; name.textContent = m.name || m.id;
        const st = document.createElement('td'); st.className = 'st';
        const dot = document.createElement('span'); dot.className = 's-dot s-dot--unknown';
        const stTxt = document.createElement('span'); stTxt.className = 's-status'; stTxt.textContent = '离线';
        st.append(dot, stTxt);
        const last = document.createElement('td'); last.className = 'last'; last.textContent = m.lastError || '离线';
        tr.append(sel, name, st, last);
        boardBody.appendChild(tr);
        continue;
      }
      for (const s of m.sessions) {
        const key = `${m.id}/${s.name}`;
        const tr = document.createElement('tr');
        tr.className = 'row';
        if (!m.online) tr.classList.add('offline'); // 离线行整体变灰(不仅靠小字)
        if (currentTarget && currentTarget.machine === m.id && currentTarget.session === s.name) tr.classList.add('active');
        // 行级键盘可达:tabindex + aria-label(不用 role=button —— 行内嵌交互式 checkbox,
        // ARIA 禁止 button 含交互式后代;Enter/Space 由下方 keydown 分流 e.target===cb 处理)
        tr.setAttribute('tabindex', '0');
        tr.setAttribute('aria-label', `切换到 ${m.name || m.id} 的会话 ${s.name}`);

        const sel = document.createElement('td'); sel.className = 'sel';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(key);
        cb.setAttribute('aria-label', H.selectAriaLabel(m.name || m.id, s.name));
        cb.addEventListener('change', () => { cb.checked ? selected.add(key) : selected.delete(key); refreshBroadcast(); });
        cb.addEventListener('click', (e) => e.stopPropagation()); // 点 checkbox 不触发行切换
        const lbl = document.createElement('label');
        lbl.className = 'sel-wrap';                                  // 44pt 触区,手机单手可达
        lbl.addEventListener('click', (e) => e.stopPropagation());
        lbl.appendChild(cb);
        sel.appendChild(lbl);

        const name = document.createElement('td');
        name.className = 'name';
        name.textContent = `${m.name || m.id} / ${s.name}`;

        // 状态双编码:色点 + 文字(WCAG:不仅靠颜色;复用 tokens.css 的 .s-dot/.s-status)
        const st = document.createElement('td');
        st.className = 'st';
        const statusVal = s.status || 'unknown';
        const dot = document.createElement('span');
        dot.className = 's-dot s-dot--' + statusVal;
        const stTxt = document.createElement('span');
        stTxt.className = 's-status';
        stTxt.textContent = statusVal;
        st.append(dot, stTxt);

        const last = document.createElement('td');
        last.className = 'last';
        last.textContent = s.lastLine || (m.online ? '' : '(离线)');

        tr.append(sel, name, st, last);
        tr.addEventListener('click', () => attachTarget({ machine: m.id, session: s.name }));
        tr.addEventListener('keydown', (e) => {
          if (e.target === cb) return; // checkbox 自处理 space(勾选),不切换终端
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            attachTarget({ machine: m.id, session: s.name });
          }
        });
        boardBody.appendChild(tr);
      }
    }
    // 顶部状态:在线/离线计数
    const stat = H.onlineStats(machines);
    setStatus('connected', `已连接 · ${stat.online} 在线 / ${stat.offline} 离线`);
  }

  function refreshBroadcast() {
    bcBar.hidden = selected.size < 2;
    bcCount.textContent = `已选 ${selected.size} 个会话`;
    bcSend.textContent = selected.size >= 2 ? `广播到 ${selected.size} 个会话` : '扇出';
  }

  // 逐机回执:成功/失败分流,失败项可点击(或 Enter)跳转过去看终端
  function renderBcResult(sum) {
    bcResult.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'bcr-head ' + (sum.failed.length ? 'has-fail' : 'all-ok');
    head.textContent = `成功 ${sum.ok}/${sum.total}`;
    bcResult.appendChild(head);
    if (sum.failed.length) {
      const list = document.createElement('ul');
      list.className = 'bcr-list';
      for (const f of sum.failed) {
        const li = document.createElement('li');
        li.className = 'bcr-fail';
        li.setAttribute('tabindex', '0');
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', `跳转到失败的 ${f.key}`);
        const txt = document.createElement('span');
        txt.textContent = `${f.key} — ${f.error}`;
        li.appendChild(txt);
        const idx = f.key.indexOf('/');
        const jump = () => {
          if (idx < 0) return;
          attachTarget({ machine: f.key.slice(0, idx), session: f.key.slice(idx + 1) });
        };
        li.addEventListener('click', jump);
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
        list.appendChild(li);
      }
      bcResult.appendChild(list);
    }
  }

  bcSend.addEventListener('click', () => {
    // 用第一个 '/' 拆分(machine id 经 registry 校验不含 '/';session 名可含 '/')
    const targets = Array.from(selected).map((k) => {
      const idx = k.indexOf('/');
      return { machine: k.slice(0, idx), session: k.slice(idx + 1) };
    });
    const text = bcInput.value;
    if (!targets.length || !text) return;
    // 扇出前安全确认:目标 ≥3 台(大面积误操作)或指令危险 → 二次确认
    if (H.needsConfirm(targets.length, text)) {
      const danger = H.isDangerousCommand(text);
      const msg = danger
        ? `⚠ 检测到危险指令,确认要广播到 ${targets.length} 个会话?\n\n指令:${text}`
        : `确认广播到 ${targets.length} 个会话?\n\n指令:${text}`;
      if (!window.confirm(msg)) return;
    }
    renderBcResult({ total: 0, ok: 0, failed: [], okKeys: [] }); // 清旧回执
    bcSend.disabled = true;
    bcSend.textContent = '扇出中…';
    ensureWs();
    sendWhenOpen({ type: 'broadcast', targets, data: text, enter: true });
    bcInput.value = '';
  });

  async function poll() {
    try {
      const res = await fetch('/api/global-dashboard');
      if (res.status === 401) {
        location.href = '/login?next=' + encodeURIComponent('/console.html');
        return;
      }
      if (res.ok) {
        renderBoard(await res.json());
      } else {
        setStatus('error', `hub 异常(${res.status})`);
      }
    } catch {
      setStatus('error', 'hub 不可达,重试中…'); // 不再静默吞错误
    }
  }
  setInterval(poll, 2000);
  poll();
  ensureWs();
})();
