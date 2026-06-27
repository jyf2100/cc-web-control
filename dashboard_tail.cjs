/**
 * 多会话看板:JSONL 文件尾部读取(M1 tail-read,绝不整文件读)
 *
 * 设计权衡:每次从文件末尾读 TAIL_BYTES(64KB),split 行,JSON.parse 完整行。
 * 不维护增量 offset —— 比 M5/M6 的 offset 增量更简单 robust:
 *   - truncate / rotate / replace(inode 变、size 回退)下次自然读到新末尾,无需特殊守卫
 *   - 64KB 末尾读 2s 一次,成本可控
 *   - status 判定只需末尾几条事件,64KB 够(~15-60 事件)
 * stat 快照(inode+size+mtime)供 cache 层"文件没变则跳过重读"优化。
 */

const fs = require('fs');

const TAIL_BYTES = 64 * 1024;

function readTailEvents(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = fs.fstatSync(fd);
    if (size <= 0) return [];
    const readStart = Math.max(0, size - TAIL_BYTES);
    const len = size - readStart;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, readStart);
    let lines = buf.toString('utf8').split('\n');
    if (readStart > 0) lines = lines.slice(1); // 首行可能不完整(截断),丢弃
    const events = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        events.push(JSON.parse(t));
      } catch {
        // 坏行跳过,绝不抛
      }
    }
    return events;
  } catch {
    return [];
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
}

function statSnapshot(filePath) {
  try {
    const s = fs.statSync(filePath);
    return { exists: true, inode: s.ino, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return { exists: false, inode: null, size: 0, mtimeMs: 0 };
  }
}

module.exports = { readTailEvents, statSnapshot, TAIL_BYTES };
