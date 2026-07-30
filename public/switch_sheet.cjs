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

  // buildEffortSelectModel:effort 档位列表 → <option> 渲染模型。默认档标注「(默认)」(AC6 可见标注)。
  // 与 effort.cjs 解耦:levels/defaultEffort/currentEffort 全部由调用方传入(本模块只管渲染)。
  function buildEffortSelectModel(levels, defaultEffort, currentEffort) {
    const lv = Array.isArray(levels) ? levels.filter((x) => typeof x === 'string') : [];
    const def = (typeof defaultEffort === 'string' && defaultEffort) ? defaultEffort : (lv[0] || '');
    const cur = (typeof currentEffort === 'string' && currentEffort) ? currentEffort : def;
    return lv.map((level) => ({
      value: level,
      label: level === def ? level + ' (默认)' : level,
      isDefault: level === def,
      isCurrent: level === cur,
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
    // P0-2:hub 无 /api/projects 数据源(只被控机 :7684 有)→ hideProjects:true 跳过项目段,只留机器/会话单选;
    // ariaLabel 可注入(hub 抽屉语义「切换被控 agent」,单机客户端默认「启动项目」向后兼容)。
    const hideProjects = !!(opts && opts.hideProjects);
    const ariaLabel = (opts && typeof opts.ariaLabel === 'string' && opts.ariaLabel) ? opts.ariaLabel : '启动项目';
    // effort 档位控制面(AC1 启动选择 / AC2-3 切换警告 / AC5 状态可见)。
    //   effortCfg.levels/defaultEffort/currentEffort:渲染下拉框(默认档标「(默认)」)。
    //   onLaunch 已带 effort;onChangeEffort(requestedEffort) → Promise<boolean>(true=已应用,false=取消)。
    //   仅单机模式渲染(hideProjects:true 的 hub 跳过,effort 切换是单机 PATCH 端点)。
    const effortCfg = (opts && opts.effort && typeof opts.effort === 'object') ? opts.effort : null;
    const onChangeEffort = (opts && typeof opts.onChangeEffort === 'function') ? opts.onChangeEffort : null;
    // 构造 effort <select>:className + 选中 currentEffort。复用于「启动」与「当前会话」两处。
    function buildEffortSelect(className, levels, defaultEffort, currentEffort) {
      const sel = doc.createElement('select');
      sel.className = className;
      const model = buildEffortSelectModel(levels, defaultEffort, currentEffort);
      for (const m of model) {
        const o = doc.createElement('option');
        o.value = m.value; o.textContent = m.label;
        if (m.isCurrent) o.selected = true;
        sel.appendChild(o);
      }
      return sel;
    }

    const backdrop = doc.createElement('div');
    backdrop.className = 'switch-sheet-backdrop'; backdrop.hidden = true; backdrop.setAttribute('aria-hidden', 'true');
    const sheet = doc.createElement('div');
    sheet.className = 'switch-sheet'; sheet.id = 'switchSheet';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', ariaLabel); sheet.hidden = true;
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

    // 第 2 段:项目启动区(hideProjects:true 跳过 —— hub 无 /api/projects 数据源,只留机器/会话单选 attach)
    // 单机模式下,项目区末尾带「启动 effort」选择器(AC1):所选档位随 onLaunch 下发。
    let launchEffortSel = null;
    if (!hideProjects) {
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
        // AC1:点击项目启动时,携带当前选择的 effort 档位作为该会话启动参数。
        btn.addEventListener('click', () => {
          onLaunch(pj.path, launchEffortSel ? launchEffortSel.value : undefined);
        });
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
    // 启动 effort 选择器(AC1/AC6):默认档标「(默认)」,未显式选择即用文档化默认。
    if (effortCfg && Array.isArray(effortCfg.levels) && effortCfg.levels.length) {
      const effRow = doc.createElement('div');
      effRow.className = 'switch-sheet-effort switch-sheet-effort--launch';
      const lbl = doc.createElement('span');
      lbl.className = 'switch-sheet-effort-label';
      lbl.textContent = '启动 effort';
      launchEffortSel = buildEffortSelect('switch-sheet-effort-select',
        effortCfg.levels, effortCfg.defaultEffort, effortCfg.defaultEffort);
      effRow.appendChild(lbl); effRow.appendChild(launchEffortSel);
      projWrap.appendChild(effRow);
    }
    sheet.appendChild(projWrap);
    } // end if (!hideProjects)

    // 第 3 段:当前会话 effort(AC2/AC3/AC5)。单机模式下展示当前生效档位,并提供切换入口;
    // 切换走 onChangeEffort(client.js 内做「清空上下文缓存」二次确认 + PATCH dispatch)。
    if (!hideProjects && effortCfg && Array.isArray(effortCfg.levels) && effortCfg.levels.length) {
      const effWrap = doc.createElement('div');
      effWrap.className = 'switch-sheet-effort switch-sheet-effort--current';
      const title = doc.createElement('p');
      title.className = 'switch-sheet-section-title';
      title.textContent = '当前会话 effort(切换将清空上下文缓存)';
      effWrap.appendChild(title);
      const curEff = (typeof effortCfg.currentEffort === 'string' && effortCfg.currentEffort)
        ? effortCfg.currentEffort : effortCfg.defaultEffort;
      const curSel = buildEffortSelect('switch-sheet-effort-select',
        effortCfg.levels, effortCfg.defaultEffort, curEff);
      curSel.setAttribute('aria-label', '切换当前会话 effort 档位');
      if (onChangeEffort) {
        // 切换决策与回退:createSwitchSheet 只管「取值 + 通知 + 回退」,确认/下发交由 client.js。
        curSel.addEventListener('change', async () => {
          const requested = curSel.value;
          if (requested === curEff) return; // 防御:未变化不触发
          let applied = false;
          try { applied = await onChangeEffort(requested); } catch { applied = false; }
          // 取消/失败 → 回退到当前生效档位(AC2:未确认前实际档位不变)。
          if (!applied) curSel.value = curEff;
        });
      }
      effWrap.appendChild(curSel);
      sheet.appendChild(effWrap);
    }
    doc.body.appendChild(backdrop); doc.body.appendChild(sheet);

    let openState = false, savedOverflow = '', lastFocused = null;
    const focusables = () => Array.from(sheet.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
    // 抽屉打开时把背景卡片 inert(补 aria-modal 跨 AT 缺陷);关闭移除
    const rootSel = (opts && typeof opts.backdropRoot === 'string' && opts.backdropRoot) || '.console-card';
    const backdropRoot = () => doc.querySelector(rootSel);
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

  return { handleTabTrap, shouldCloseOnKey, buildSessionItems, buildProjectItems, buildEffortSelectModel, createSwitchSheet };
});
