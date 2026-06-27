/**
 * 多会话看板:JSONL 事件 → 状态判定(纯函数)
 *
 * 状态判定规则(spike 5 准则钉死,见 docs/designs/multi-session-dashboard.md):
 *   waiting  最后 assistant 事件 stop_reason == 'end_turn'
 *   working  最后事件在 idle 阈值内(tool_use 自主循环 / 用户刚发)
 *   idle     最后事件 ts 距 now > idle 阈值
 *   errored  最后事件含 error / isApiErrorMessage
 *   unknown  无 user/assistant 事件 / 空
 *
 * 纯函数,无 fs,无副作用。tail 读出的末尾 N 事件传入即可。
 */

const PREVIEW_MAX = 200;

function parseTimestampMs(event) {
  if (!event || typeof event.timestamp !== 'string') return null;
  const ms = Date.parse(event.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

function extractPreview(event) {
  if (!event || !event.message) return '';
  const content = event.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && b.type === 'text' && typeof b.text === 'string') return b.text;
    }
    for (const b of content) {
      if (b && b.type === 'tool_use' && typeof b.name === 'string') return `[tool: ${b.name}]`;
    }
    for (const b of content) {
      if (b && b.type === 'tool_result') return '[tool result]';
    }
  }
  return '';
}

function truncatePreview(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= PREVIEW_MAX) return s;
  return s.slice(0, PREVIEW_MAX - 1) + '…';
}

function isErrorEvent(event) {
  if (!event) return false;
  if (event.error) return true;
  if (event.isApiErrorMessage === true) return true;
  return false;
}

function parseStatus(events, nowMs, idleThresholdS) {
  if (!Array.isArray(events) || events.length === 0) {
    return { status: 'unknown', lastLine: '', lastTs: null };
  }
  let last = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && (e.type === 'user' || e.type === 'assistant')) {
      last = e;
      break;
    }
  }
  if (!last) return { status: 'unknown', lastLine: '', lastTs: null };

  const lastTs = parseTimestampMs(last);
  const lastLine = truncatePreview(extractPreview(last));

  if (isErrorEvent(last)) return { status: 'errored', lastLine, lastTs };
  if (last.type === 'assistant' && last.message && last.message.stop_reason === 'end_turn') {
    return { status: 'waiting', lastLine, lastTs };
  }
  if (lastTs !== null && nowMs != null && typeof idleThresholdS === 'number') {
    const ageS = (nowMs - lastTs) / 1000;
    if (ageS > idleThresholdS) return { status: 'idle', lastLine, lastTs };
  }
  return { status: 'working', lastLine, lastTs };
}

module.exports = { parseStatus, extractPreview, truncatePreview, parseTimestampMs };
