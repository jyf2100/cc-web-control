'use strict';

// 单机侧 Claude Code 会话轨迹(.jsonl)扫描:发现本机会话文件并提取元数据。
// 轻量 Evolve 的数据底座(轨迹→LESSONS.md Diff→人审核写回)第一步:只聚合元数据,不搬文件本体。
// 纯函数 + fsImpl 注入(与 dashboard_tail.cjs 同范式),测试不碰真实 ~/.claude。
//
// 目录布局(与 claude 实际写盘一致):<root>/<project-slug>/<sessionId>.jsonl
//   sessionId = 文件名去 .jsonl 后缀;--session-id/--resume 事前绑定见 server.cjs。
// 解析规则:
//   - 逐行 JSON;统计 type==='user'|'assistant' 的行数为「消息条数」(对齐 PRD 验收 1)
//   - 「首条用户消息摘要」= 首个含非空文本的 user 行,截断 200 字符(user 行可能是
//     tool_result 无文本,跳过继续找,避免摘要恒为空)
//   - 任一非空行非法 JSON → 整个文件视为损坏:不入清单,计入 skipped(验收 1)
//   - 单文件 > oversizeBytes(默认 50MB,可配置)→ 不逐行解析,仍入清单但
//     oversize:true、messages:null(验收 4 护栏)
//   - 根目录不存在/不可读 → 空清单 + warning(验收 3,不 crash)

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const DEFAULT_TRAJECTORY_ROOT = path.join(os.homedir(), '.claude', 'projects');
const DEFAULT_OVERSIZE_BYTES = 50 * 1024 * 1024; // 50MB
const SUMMARY_MAX_CHARS = 200;
// root/<slug>/<sid>.jsonl 两层;留一层余量防未来 claude 目录层级变化
const MAX_WALK_DEPTH = 3;

// 从一条 user 消息对象提取纯文本摘要。content 兼容 string 与 blocks 数组
// (text block 取 .text,tool_result 等其它 block 忽略)。无可读文本 → null。
function extractUserText(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const content = entry.message && entry.message.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    text = parts.join(' ');
  }
  const collapsed = String(text).replace(/\s+/g, ' ').trim();
  return collapsed || null;
}

function truncateSummary(text) {
  const s = String(text == null ? '' : text);
  if (s.length <= SUMMARY_MAX_CHARS) return s;
  return s.slice(0, SUMMARY_MAX_CHARS);
}

// 解析单个 jsonl 文本。返回 { messages, firstUserSummary } 或 null(含非法 JSON 行 → 损坏)。
function parseTrajectoryText(text) {
  let messages = 0;
  let firstUserSummary = null;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // 尾部空行不是损坏
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object') continue; // 合法 JSON 但非对象(如数字行):不算消息也不算损坏
    if (obj.type === 'user' || obj.type === 'assistant') messages += 1;
    if (firstUserSummary === null && obj.type === 'user') {
      const t = extractUserText(obj);
      if (t != null) firstUserSummary = truncateSummary(t);
    }
  }
  return { messages, firstUserSummary };
}

// 递归收集 root 下(深度 ≤ MAX_WALK_DEPTH)所有 .jsonl 文件绝对路径。
// 单个目录读失败 → 该目录贡献为空(扫描整体不因权限问题崩溃)。
function collectJsonlFiles(rootDir, fsImpl, depth) {
  if (depth > MAX_WALK_DEPTH) return [];
  let entries;
  try {
    entries = fsImpl.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of entries || []) {
    const full = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectJsonlFiles(full, fsImpl, depth + 1));
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

// 扫描入口。返回(不 throw):
//   { root, trajectories: [...], skipped, scannedAt, warning? }
// 每条 trajectory: { sessionId, path, size, mtime, messages, firstUserSummary, oversize }
//   按 mtime 降序;oversize 条目 messages/firstUserSummary 为 null。
function scanTrajectories({
  rootDir,
  fsImpl = fs,
  oversizeBytes = DEFAULT_OVERSIZE_BYTES,
  log = null,
} = {}) {
  const root = rootDir || DEFAULT_TRAJECTORY_ROOT;
  const scannedAt = Date.now();
  const base = { root, scannedAt };

  let rootExists = false;
  try {
    const st = fsImpl.statSync(root);
    rootExists = st.isDirectory();
  } catch {
    rootExists = false;
  }
  if (!rootExists) {
    // 验收 3:配置指向不存在路径 → 空清单 + 一条 warning 日志,不 crash
    const warning = `轨迹根目录不存在或不可读: ${root}`;
    (log || console).warn?.(`[trajectory] ${warning}`);
    return { ...base, trajectories: [], skipped: 0, warning };
  }

  const files = collectJsonlFiles(root, fsImpl, 1);
  const trajectories = [];
  let skipped = 0;
  for (const filePath of files) {
    let st;
    try {
      st = fsImpl.statSync(filePath);
    } catch {
      skipped += 1; // 竞态消失的文件按损坏计
      continue;
    }
    const sessionId = path.basename(filePath).replace(/\.jsonl$/, '');
    const entry = {
      sessionId,
      path: filePath,
      size: typeof st.size === 'number' ? st.size : 0,
      mtime: typeof st.mtimeMs === 'number' ? st.mtimeMs : (st.mtime && st.mtime.getTime ? st.mtime.getTime() : 0),
      messages: null,
      firstUserSummary: null,
      oversize: false,
    };
    if (entry.size > oversizeBytes) {
      // 验收 4:超限不逐行解析,仍入清单,标记 oversize
      entry.oversize = true;
      trajectories.push(entry);
      continue;
    }
    let text;
    try {
      text = fsImpl.readFileSync(filePath, 'utf8');
    } catch {
      skipped += 1;
      continue;
    }
    const parsed = parseTrajectoryText(text);
    if (!parsed) {
      skipped += 1; // 非法 JSON 行 → 整文件跳过
      continue;
    }
    entry.messages = parsed.messages;
    entry.firstUserSummary = parsed.firstUserSummary;
    trajectories.push(entry);
  }
  trajectories.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return { ...base, trajectories, skipped };
}

module.exports = {
  scanTrajectories,
  parseTrajectoryText,
  extractUserText,
  DEFAULT_TRAJECTORY_ROOT,
  DEFAULT_OVERSIZE_BYTES,
  SUMMARY_MAX_CHARS,
};
