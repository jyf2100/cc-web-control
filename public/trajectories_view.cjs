/**
 * Trajectories view pure functions(hub 会话轨迹聚合视图,浏览器 + 测试双跑)。
 * 数据源:GET /api/global-trajectories(hub 聚合各机 Claude projects 下的 .jsonl 轨迹清单)。
 * 过滤在前端做(机器精确匹配 + UTC 日期);本模块只做拍平/过滤/HTML 字符串构建,无 DOM 依赖。
 * 对齐范本:board_render.cjs / dashboard_render.cjs(UMD)。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TrajectoriesView = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // 注:仅转义 & < > "(双引号属性安全),与 board_render.escapeHtml 同款。单引号未转义 ——
  // 本模块所有属性均用双引号;若未来引入单引号属性,需补 .replace(/'/g, '&#39;)。
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 字节数 → 人类可读(B/KB/MB/GB,1 位小数;B 档取整)。非法/负数兜底 0。
  function formatSize(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1024) return Math.floor(n) + ' B';
    var units = ['KB', 'MB', 'GB'];
    var v = n / 1024;
    var i = 0;
    while (i < units.length - 1 && v >= 1024) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + units[i];
  }

  // 按码点截断(不劈代理对);超长补省略号。
  function truncateText(s, max) {
    var str = String(s == null ? '' : s);
    var chars = Array.from(str);
    if (chars.length <= max) return str;
    return chars.slice(0, max).join('') + '…';
  }

  // hub payload → 轨迹平铺数组:离线机(online:false)不产出;每条回填 machine/machineName
  // (后端本就带 machine 字段,缺省时以所属机 id 兜底;machineName 供组头/详情显示)。
  function flattenTrajectories(data) {
    var out = [];
    var machines = (data && data.machines) || [];
    for (var i = 0; i < machines.length; i++) {
      var m = machines[i] || {};
      if (m.online === false) continue;   // 离线机 trajectories 恒为 [],双保险跳过
      var trajs = m.trajectories || [];
      for (var j = 0; j < trajs.length; j++) {
        var t = trajs[j] || {};
        out.push(Object.assign({}, t, {
          machine: t.machine != null ? t.machine : m.id,
          machineName: m.name || m.id,
        }));
      }
    }
    return out;
  }

  // 'YYYY-MM-DD' → {start, end}(UTC 当日 00:00:00.000 起、次日 00:00:00.000 止,左闭右开)。
  // 非法格式(正则不匹配 / 月日越界 / Date.UTC 滚动到别月,如 2024-02-31)→ null。
  function utcDayBounds(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var start = Date.UTC(y, mo - 1, d);
    var dt = new Date(start);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { start: start, end: start + 86400000 };
  }

  // 过滤:machine 精确匹配 t.machine(空/null → 不过滤);date='YYYY-MM-DD' 按 UTC 日过滤
  // mtime,闭区间含当日起点、不含次日起点 —— 与后端 hub/trajectory_aggregator.cjs 的日期语义
  // 一致(两处须同步维护,改一处必须改另一处)。非法 date 格式返回空数组(宁空勿误:用户输入
  // 坏日期时给出明确无结果,而非放宽成全量造成误读);mtime 非法数值同样被排除。
  function filterTrajectories(flat, filters) {
    var f = filters || {};
    var machine = f.machine;
    var date = f.date;
    var hasDate = date != null && date !== '';
    var bounds = null;
    if (hasDate) {
      bounds = utcDayBounds(date);
      if (!bounds) return [];   // 非法日期格式 → 空
    }
    var out = [];
    var items = flat || [];
    for (var i = 0; i < items.length; i++) {
      var t = items[i];
      if (!t) continue;
      if (machine != null && machine !== '' && t.machine !== machine) continue;
      if (bounds) {
        var mt = Number(t.mtime);
        if (!isFinite(mt) || mt < bounds.start || mt >= bounds.end) continue;
      }
      out.push(t);
    }
    return out;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  // 列表「时间」列:与过滤同口径的 UTC 时间(YYYY-MM-DD HH:mm),避免本地时区与过滤语义错位。
  function formatUtcTime(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
      ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  // 单行:<tr class="traj-row" data-traj-index="i" tabindex="0">,index 为传入 flat 数组下标
  // (dashboard.js 行点击据此回查 item)。摘要列:oversize → 未解析（超限）;firstUserSummary
  // 为 null → '—'。行内摘要短截断(120)保持表格整洁,详情里再按 200 全量展示。
  function buildTrajRow(item, index) {
    var t = item || {};
    var mt = Number(t.mtime);
    var timeText = isFinite(mt) && mt > 0 ? formatUtcTime(mt) : '—';
    var msgs = t.oversize ? '未解析（超限）' : (t.messages != null ? String(t.messages) : '—');
    var summaryCell;
    if (t.oversize) {
      summaryCell = '<span class="traj-oversize" title="文件超限,未解析内容">未解析（超限）</span>';
    } else if (t.firstUserSummary == null || t.firstUserSummary === '') {
      summaryCell = '—';
    } else {
      summaryCell = escapeHtml(truncateText(t.firstUserSummary, 120));
    }
    return '<tr class="traj-row" data-traj-index="' + index + '" tabindex="0">' +
      '<td class="traj-cell traj-cell--time" title="UTC 时间">' + escapeHtml(timeText) + '</td>' +
      '<td class="traj-cell traj-cell--session">' + escapeHtml(t.sessionId != null ? t.sessionId : '—') + '</td>' +
      '<td class="traj-cell traj-cell--msgs">' + escapeHtml(msgs) + '</td>' +
      '<td class="traj-cell traj-cell--size">' + escapeHtml(formatSize(t.size)) + '</td>' +
      '<td class="traj-cell traj-cell--summary">' + summaryCell + '</td>' +
      '</tr>';
  }

  // 列表体:按机器分组(组头 `machineName · N 条`,顺序 = flat 首现顺序即后端 machines 顺序)
  // + 表格(时间/会话/消息数/大小/摘要)。空 → NO DATA 占位(无过滤=尚无上报,有过滤=无匹配)。
  function renderTrajectoriesBody(flat, filters) {
    var items = flat || [];
    if (!items.length) {
      var hasFilter = filters && ((filters.machine && filters.machine !== '') || (filters.date && filters.date !== ''));
      var msg = hasFilter ? '无匹配轨迹' : '尚无轨迹上报';
      return '<div class="traj-empty"><span class="eyebrow">NO DATA</span> ' + msg + '</div>';
    }
    var order = [];
    var map = {};
    for (var i = 0; i < items.length; i++) {
      var key = String(items[i].machine);
      if (!map[key]) { map[key] = []; order.push(key); }
      map[key].push(i);
    }
    var parts = [];
    for (var g = 0; g < order.length; g++) {
      var mid = order[g];
      var idxs = map[mid];
      var name = items[idxs[0]].machineName || mid;
      parts.push('<div class="traj-group__head">' + escapeHtml(name) + ' · ' + idxs.length + ' 条</div>');
      parts.push('<table class="traj-table"><thead><tr>' +
        '<th>时间</th><th>会话</th><th>消息数</th><th>大小</th><th>摘要</th>' +
        '</tr></thead><tbody>');
      for (var r = 0; r < idxs.length; r++) {
        parts.push(buildTrajRow(items[idxs[r]], idxs[r]));
      }
      parts.push('</tbody></table>');
    }
    return parts.join('');
  }

  // 详情卡片:machineName / sessionId / 消息条数(oversize → 未解析（超限）)/ 大小 / mtime 本地
  // 时间 / 绝对路径 / 首条用户消息摘要(防御性再截断 200 字符,后端已截但前端不信任)。
  // 全部经 escapeHtml。
  function renderTrajectoryDetail(item) {
    var t = item || {};
    var machineName = t.machineName || t.machine || '—';
    var msgs = t.oversize ? '未解析（超限）' : (t.messages != null ? String(t.messages) : '—');
    var mt = Number(t.mtime);
    var timeText = isFinite(mt) && mt > 0 ? new Date(mt).toLocaleString() : '—';
    var summary;
    if (t.oversize) {
      summary = '<span class="traj-oversize" title="文件超限,未解析内容">未解析（超限）</span>';
    } else if (t.firstUserSummary == null || t.firstUserSummary === '') {
      summary = '—';
    } else {
      summary = escapeHtml(truncateText(t.firstUserSummary, 200));
    }
    return '<div class="traj-detail__card">' +
      '<div class="traj-detail__title">' + escapeHtml(machineName) + ' · ' +
      escapeHtml(t.sessionId != null ? t.sessionId : '—') + '</div>' +
      '<dl class="traj-detail__fields">' +
      '<div class="traj-detail__row"><dt>机器</dt><dd>' + escapeHtml(machineName) + '</dd></div>' +
      '<div class="traj-detail__row"><dt>会话 ID</dt><dd class="traj-detail__mono">' +
      escapeHtml(t.sessionId != null ? t.sessionId : '—') + '</dd></div>' +
      '<div class="traj-detail__row"><dt>消息条数</dt><dd>' + escapeHtml(msgs) + '</dd></div>' +
      '<div class="traj-detail__row"><dt>大小</dt><dd>' + escapeHtml(formatSize(t.size)) + '</dd></div>' +
      '<div class="traj-detail__row"><dt>修改时间</dt><dd>' + escapeHtml(timeText) + '</dd></div>' +
      '<div class="traj-detail__row"><dt>路径</dt><dd class="traj-detail__mono traj-detail__path">' +
      escapeHtml(t.path != null ? t.path : '—') + '</dd></div>' +
      '<div class="traj-detail__row"><dt>首条用户消息</dt><dd class="traj-detail__summary">' + summary + '</dd></div>' +
      '</dl>' +
      '</div>';
  }

  // 导出载荷:纯对象(路径清单,顺序与界面一致 —— 调用方传过滤后的数组)。
  // { generatedAt: ISO, filters: 回显, count, trajectories: [{machine, sessionId, path}] }。
  function buildExportPayload(flat, filters, nowMs) {
    var items = flat || [];
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var t = items[i] || {};
      list.push({
        machine: t.machine != null ? t.machine : '',
        sessionId: t.sessionId != null ? t.sessionId : '',
        path: t.path != null ? t.path : '',
      });
    }
    var f = filters || {};
    var ts = Number(nowMs);
    return {
      generatedAt: new Date(isFinite(ts) && ts > 0 ? ts : Date.now()).toISOString(),
      filters: { machine: f.machine != null ? f.machine : '', date: f.date != null ? f.date : '' },
      count: list.length,
      trajectories: list,
    };
  }

  return {
    escapeHtml: escapeHtml,
    formatSize: formatSize,
    flattenTrajectories: flattenTrajectories,
    filterTrajectories: filterTrajectories,
    renderTrajectoriesBody: renderTrajectoriesBody,
    renderTrajectoryDetail: renderTrajectoryDetail,
    buildExportPayload: buildExportPayload,
  };
});
