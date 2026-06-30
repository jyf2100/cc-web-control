/**
 * switch_sheet.cjs — 切换 sheet 状态机 + DOM 构建。
 * 设计依据:2026-06-29-ios-editorial-redesign-design.md §7.1「切换 sheet 契约」。
 * 纯函数(handleTabTrap/shouldCloseOnKey/buildSessionItems/buildProjectItems)可 node --test;
 * createSwitchSheet 操作 document(仅浏览器调用)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SwitchSheet = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function handleTabTrap(e, focusables, activeIdx) {
    if (!e || e.key !== 'Tab' || !Array.isArray(focusables) || focusables.length === 0) {
      return { trap: false, focusIndex: -1 };
    }
    const last = focusables.length - 1;
    if (activeIdx < 0) return { trap: false, focusIndex: -1 };
    if (e.shiftKey) { if (activeIdx === 0) return { trap: true, focusIndex: last }; }
    else { if (activeIdx === last) return { trap: true, focusIndex: 0 }; }
    return { trap: false, focusIndex: -1 };
  }

  function shouldCloseOnKey(e) {
    if (!e) return false;
    if (e.key === 'Escape') return true;
    if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      try {
        const sel = (e.view && e.view.document) ? e.view.document.getSelection() : null;
        if (sel && String(sel).length > 0) return false;
      } catch { /* ignore */ }
      return true;
    }
    return false;
  }

  function buildSessionItems(sessions, current) {
    const list = Array.isArray(sessions) ? sessions : [];
    const cur = typeof current === 'string' ? current : '';
    const items = list
      .filter((s) => s && typeof s.name === 'string')
      .map((s) => ({ name: s.name, label: s.attached ? `${s.name} · attached` : s.name, attached: !!s.attached, isCurrent: s.name === cur }));
    items.sort((a, b) => (b.attached ? 1 : 0) - (a.attached ? 1 : 0));
    return items;
  }

  // buildProjectItems:项目列表 → 渲染项(label 带 root 后缀;去尾斜杠归一化后与 cwd 比对得 isCurrent)。
  // 与 client.js syncProjectSelect 的 normPath 语义一致,保证当前项目高亮与桌面下拉同步。
  function buildProjectItems(projects, currentCwd) {
    const list = Array.isArray(projects) ? projects : [];
    const normPath = (v) => String(v).replace(/[/\\]+$/, '');
    const cur = normPath(typeof currentCwd === 'string' ? currentCwd : '');
    return list
      .filter((p) => p && typeof p.path === 'string' && typeof p.name === 'string')
      .map((p) => ({
        path: p.path,
        label: p.root ? `${p.name} (${p.root})` : p.name,
        isCurrent: normPath(p.path) === cur,
      }));
  }

  function createSwitchSheet(opts) {
    const doc = (typeof document !== 'undefined') ? document : null;
    if (!doc) return null;
    const trigger = opts && opts.trigger;
    const onPick = (opts && typeof opts.onPick === 'function') ? opts.onPick : () => {};
    const items = (opts && Array.isArray(opts.items)) ? opts.items : [];
    const onLaunch = (opts && typeof opts.onLaunch === 'function') ? opts.onLaunch : () => {};
    const projects = (opts && Array.isArray(opts.projects)) ? opts.projects : [];
    const meta = (opts && opts.meta && typeof opts.meta === 'object') ? opts.meta : null;

    const backdrop = doc.createElement('div');
    backdrop.className = 'switch-sheet-backdrop'; backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true');
    const sheet = doc.createElement('div');
    sheet.className = 'switch-sheet'; sheet.id = 'switchSheet';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '切换会话'); sheet.hidden = true;
    sheet.setAttribute('tabindex', '-1');
    const handle = doc.createElement('div');
    handle.className = 'switch-sheet-handle'; handle.setAttribute('aria-hidden', 'true'); sheet.appendChild(handle);

    // 第 1 段:顶部 meta 行(project · s:NNn,mono 11px fg-2)
    if (meta) {
      const metaRow = doc.createElement('p');
      metaRow.className = 'switch-sheet-meta';
      const proj = (typeof meta.project === 'string' && meta.project) ? meta.project : '—';
      const sess = (typeof meta.session === 'string' && meta.session) ? meta.session : '—';
      metaRow.textContent = `${proj} · s:${sess}`;
      sheet.appendChild(metaRow);
    }

    // 第 2 段:会话列表(标题 + 复用 buildSessionItems,当前项高亮+disabled)
    const sessTitle = doc.createElement('p');
    sessTitle.className = 'switch-sheet-section-title';
    sessTitle.textContent = '会话';
    sheet.appendChild(sessTitle);
    const list = doc.createElement('ul');
    list.className = 'switch-sheet-list'; list.setAttribute('role', 'list');
    items.forEach((it) => {
      const li = doc.createElement('li');
      li.className = 'switch-sheet-item' + (it.isCurrent ? ' switch-sheet-item--current' : '');
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'switch-sheet-btn';
      btn.setAttribute('aria-current', it.isCurrent ? 'true' : 'false');
      btn.textContent = it.label;
      if (it.isCurrent) btn.disabled = true;
      btn.addEventListener('click', () => { onPick(it.name); });
      li.appendChild(btn); list.appendChild(li);
    });
    sheet.appendChild(list);

    // 第 3 段:项目启动区(复用 buildProjectItems + onLaunch);无项目时空状态
    const projWrap = doc.createElement('div');
    projWrap.className = 'switch-sheet-projects';
    const projTitle = doc.createElement('p');
    projTitle.className = 'switch-sheet-section-title';
    projTitle.textContent = '项目';
    projWrap.appendChild(projTitle);
    if (projects.length) {
      const projList = doc.createElement('ul');
      projList.className = 'switch-sheet-list';
      projList.setAttribute('role', 'list');
      projects.forEach((pj) => {
        const li = doc.createElement('li');
        li.className = 'switch-sheet-item' + (pj.isCurrent ? ' switch-sheet-item--current' : '');
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'switch-sheet-btn switch-sheet-btn--launch';
        btn.setAttribute('aria-current', pj.isCurrent ? 'true' : 'false');
        btn.textContent = pj.label;
        if (pj.isCurrent) btn.disabled = true;
        btn.addEventListener('click', () => { onLaunch(pj.path); });
        li.appendChild(btn);
        projList.appendChild(li);
      });
      projWrap.appendChild(projList);
    } else {
      const empty = doc.createElement('p');
      empty.className = 'switch-sheet-projects-empty';
      empty.textContent = '暂无可启动项目';
      projWrap.appendChild(empty);
    }
    sheet.appendChild(projWrap);
    doc.body.appendChild(backdrop); doc.body.appendChild(sheet);

    let openState = false, savedOverflow = '', lastFocused = null;
    const focusables = () => Array.from(sheet.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
    // 抽屉打开时把背景卡片 inert(补 aria-modal 跨 AT 缺陷);关闭移除
    const backdropRoot = () => doc.querySelector('.console-card');
    const onKeydown = (e) => {
      if (!openState) return;
      if (shouldCloseOnKey(e)) { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const fs = focusables(); const idx = fs.indexOf(doc.activeElement);
        const r = handleTabTrap(e, fs, idx);
        if (r.trap) { e.preventDefault(); fs[r.focusIndex].focus({ preventScroll: true }); }
      }
    };
    function open() {
      if (openState) return; openState = true;
      lastFocused = doc.activeElement; savedOverflow = doc.body.style.overflow;
      doc.body.style.overflow = 'hidden';
      const root = backdropRoot(); if (root) root.setAttribute('inert', '');
      backdrop.hidden = false; sheet.hidden = false; sheet.setAttribute('aria-hidden', 'false');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      doc.addEventListener('keydown', onKeydown, true);
      const fs = focusables(); if (fs.length) fs[0].focus({ preventScroll: true }); else sheet.focus();
    }
    function close() {
      if (!openState) return; openState = false;
      doc.body.style.overflow = savedOverflow;
      const root = backdropRoot(); if (root) root.removeAttribute('inert');
      backdrop.hidden = true; sheet.hidden = true; sheet.setAttribute('aria-hidden', 'true');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      doc.removeEventListener('keydown', onKeydown, true);
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
    }
    function isOpen() { return openState; }
    function destroy() { doc.removeEventListener('keydown', onKeydown, true); backdrop.remove(); sheet.remove(); }
    backdrop.addEventListener('click', close);
    return { open, close, isOpen, destroy };
  }

  return { handleTabTrap, shouldCloseOnKey, buildSessionItems, buildProjectItems, createSwitchSheet };
});
