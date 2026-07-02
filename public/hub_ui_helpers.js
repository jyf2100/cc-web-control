'use strict';

/**
 * 多机控制台 UI 纯函数(无 DOM 依赖)。
 * 浏览器:挂 window.HubUI;Node:module.exports(供 node --test 单测)。
 * 设计:可测逻辑与 DOM 渲染分层——本文件只做数据判断/转换,绝不碰 document。
 * 不可变:所有函数都不修改入参,返回新结构。
 */
(function () {
  // 危险指令模式(大小写不敏感)。命中任一 → 扇出前强制二次确认。
  // 覆盖:硬重置、强推、关机重启、格式化、底层写盘、fork bomb、删库删表、find -delete、管道到 shell。
  // rm 递归强删与 chmod 递归全开因姿势多变(合并/分离/长短标志),用下方专用函数判定。
  // 注:这是 UX 安全网(误操作二次确认),不是硬安全边界——确认后仍会真实执行。
  const DANGER_PATTERNS = [
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+push\s+(-f|--force)\b/i,
    /\b(reboot|shutdown|halt|poweroff)\b/i,
    /\bmkfs(\.\w+)?\b/i,
    /\bdd\s+if=/i,
    /:\s*\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, // fork bomb :(){ :|:& };
    /\bdrop\s+(table|database|schema)\b/i,
    /\btruncate\s+table\b/i,
    /\bfind\s+.*-delete\b/i,
    /(\||&&)\s*(sh|bash)\b/i, // 管道/链式执行到 shell(curl … | sh)
    /\bmv\s+\S+\s+\/dev\/null\b/i,
    />\s*\/dev\/(sd|nvme|disk|mmcblk)/i,
  ];

  // rm 递归强删:命令段内同时出现 r/R/--recursive(递归)与 f/--force(强删),
  // 无论合并(-rf/-fr/-rvf)、分离(-r -f / -f -r)还是长短标志混用。仅递归或仅强删不命中。
  function isRmDestructive(s) {
    const m = s.match(/\brm\b([^&|;\n]*)/i);
    if (!m) return false;
    const seg = m[1];
    const hasRecursive = /(^|\s)-\S*r/i.test(seg);
    const hasForce = /(^|\s)-\S*f/i.test(seg);
    return hasRecursive && hasForce;
  }

  // chmod 递归全开:含 -R 递归,且模式为 777 系列(含 setuid/setgid 前缀如 6777/7777)
  // 或符号模式 a+rw[x]/a+rwx 全开。非递归单文件 chmod 不命中。
  function isChmodDestructive(s) {
    const m = s.match(/\bchmod\b([^&|;\n]*)/i);
    if (!m) return false;
    const seg = m[1];
    if (!/(^|\s)-\S*r/i.test(seg)) return false; // 必须 -R 递归
    return /\b[0-7]?777\b/.test(seg) || /\ba\+[rwx]{2,}/i.test(seg);
  }

  /** 是否含危险指令。纯函数,不修改入参。 */
  function isDangerousCommand(text) {
    const s = typeof text === 'string' ? text : '';
    return DANGER_PATTERNS.some((re) => re.test(s)) || isRmDestructive(s) || isChmodDestructive(s);
  }

  /**
   * 是否需要扇出前二次确认。
   * 规则:目标 ≥3 台(大面积误操作)或指令危险,满足其一即确认。
   * @param {number} targetCount 选中目标数
   * @param {string} text 待广播指令
   * @returns {boolean}
   */
  function needsConfirm(targetCount, text) {
    const n = Number(targetCount) || 0;
    return n >= 3 || isDangerousCommand(text);
  }

  /** 多选 checkbox 的 aria-label(屏幕阅读器可达)。 */
  function selectAriaLabel(machineName, sessionName) {
    const m = typeof machineName === 'string' && machineName ? machineName : '机器';
    const s = typeof sessionName === 'string' && sessionName ? sessionName : '会话';
    return `选择 ${m} 的会话 ${s}`;
  }

  /**
   * 汇总广播回执为可渲染结构。
   * @param {Array<{machine:string,session:string,ok:boolean,error?:string}>} results
   * @returns {{total:number, ok:number, failed:Array<{key:string,error:string}>, okKeys:string[]}}
   */
  function summarizeBroadcast(results) {
    const arr = Array.isArray(results) ? results : [];
    const okKeys = [];
    const failed = [];
    for (const r of arr) {
      if (!r) continue;
      // ws_bridge 协议:元素为 {target:{machine,session}, ok, error};同时兼容扁平 {machine,session}
      const t = r.target || r;
      const key = `${t.machine}/${t.session}`;
      if (r.ok) {
        okKeys.push(key);
      } else {
        failed.push({ key, error: typeof r.error === 'string' && r.error ? r.error : '失败' });
      }
    }
    return { total: arr.length, ok: okKeys.length, failed, okKeys };
  }

  /**
   * 在线/离线机器统计。
   * @param {Array<{online?:boolean}>} machines
   * @returns {{online:number, offline:number, total:number}}
   */
  function onlineStats(machines) {
    const arr = Array.isArray(machines) ? machines : [];
    let online = 0;
    for (const m of arr) if (m && m.online) online += 1;
    return { online, offline: arr.length - online, total: arr.length };
  }

  const api = {
    DANGER_PATTERNS,
    isDangerousCommand,
    needsConfirm,
    selectAriaLabel,
    summarizeBroadcast,
    onlineStats,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.HubUI = api;
})();
