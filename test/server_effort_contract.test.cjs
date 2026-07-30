'use strict';

// server.cjs effort 控制面接线条约测试。
// server.cjs 启动即 listen(require 即启动),无法直接单测路由;沿用既有
// startClaudeInSession_contract / session_in_use_contract 的「源码 grep 契约」风格,
// 断言 effort 相关接线条款落地(AC1 启动下发 / AC2-3 切换 dispatch / AC5 状态可见 / AC6 默认)。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

// require 契约
test('server.cjs: require effort.cjs(档位决策,共享 UMD 在 public/)', () => {
  assert.ok(/require\(['"]\.\/public\/effort\.cjs['"]\)/.test(SERVER), '未 require ./public/effort.cjs');
});

test('server.cjs: require session_effort.cjs(会话级档位持久化)', () => {
  assert.ok(/require\(['"]\.\/session_effort\.cjs['"]\)/.test(SERVER), '未 require ./session_effort.cjs');
});

// AC6 默认档位
test('server.cjs: 定义 RESOLVED_DEFAULT_EFFORT(文档化默认档位,AC6)', () => {
  assert.ok(/RESOLVED_DEFAULT_EFFORT\s*=/.test(SERVER), '未定义 RESOLVED_DEFAULT_EFFORT');
  assert.ok(/normalizeEffort\(\s*CFG\.defaultEffort/.test(SERVER), '默认档位未走 normalizeEffort 校验');
});

// AC1 启动下发
test('startClaudeInSession: 接收 opts.effort 并传给 buildClaudeLaunchCommand(AC1)', () => {
  assert.ok(/opts\.effort/.test(SERVER), 'startClaudeInSession 未读 opts.effort');
  assert.ok(/buildClaudeLaunchCommand\(\s*\{[^}]*effort:/.test(SERVER), 'buildClaudeLaunchCommand 未传 effort');
});

// AC1 路由:POST /api/sessions 接收 effort
test('POST /api/sessions: 从 body 解构 effort 并 normalizeEffort(AC1/AC6)', () => {
  assert.ok(/const\s+\{\s*name,\s*cwd,\s*effort\s*\}\s*=\s*req\.body/.test(SERVER)
    || /\bname,\s*cwd,\s*effort\b/.test(SERVER), 'POST /api/sessions 未从 body 解构 effort');
  assert.ok(/normalizeEffort\(\s*effort\s*,\s*RESOLVED_DEFAULT_EFFORT\s*\)/.test(SERVER),
    '未对 effort 做 normalizeEffort(effort, RESOLVED_DEFAULT_EFFORT)');
});

test('POST /api/sessions: 创建后 setEffort 落盘(AC5)', () => {
  assert.ok(/setEffort\(\s*name,\s*chosenEffort\s*\)/.test(SERVER), '未调用 setEffort(name, chosenEffort)');
});

// AC5 状态可见:listSessions 回填 effort
test('listSessions: 返回 effort 字段(AC5 状态可见)', () => {
  assert.ok(/getEffort\(/.test(SERVER), 'listSessions 未调用 getEffort');
  // 返回对象含 effort 键
  assert.ok(/effort\s*,/.test(SERVER) || /effort\s*[=:]/.test(SERVER), 'listSessions 返回对象未含 effort');
});

// 会话删除:清理 effort 记录
test('DELETE /api/sessions/:name: 清理 deleteEffort(与绑定同生命周期)', () => {
  assert.ok(/deleteEffort\(\s*name\s*\)/.test(SERVER), 'DELETE 未调用 deleteEffort(name)');
});

// AC2/AC3 切换 dispatch 路由
test('PATCH /api/sessions/:name/effort 路由存在(AC2/AC3 切换 dispatch)', () => {
  assert.ok(/app\.patch\(['"]\/api\/sessions\/:name\/effort['"]/.test(SERVER),
    '未注册 PATCH /api/sessions/:name/effort');
});

test('PATCH effort: 校验 isValidEffort(拒非法档位 → 400)', () => {
  assert.ok(/isValidEffort\(\s*effort\s*\)/.test(SERVER), 'PATCH 未校验 isValidEffort(effort)');
});

test('PATCH effort: 走 requireSameOriginForUnsafeMethods(CSRF 防护,与其他 unsafe 路由一致)', () => {
  // 取 PATCH 路由体片段断言含 same-origin 校验
  const idx = SERVER.indexOf("app.patch('/api/sessions/:name/effort'");
  assert.ok(idx >= 0, '找不到 PATCH 路由');
  const seg = SERVER.slice(idx, idx + 800);
  assert.ok(/requireSameOriginForUnsafeMethods/.test(seg), 'PATCH 路由未做 same-origin CSRF 校验');
});

test('PATCH effort: 经 buildEffortSlashCommand + tmux.sendKeys 下发(AC3 dispatch)', () => {
  const idx = SERVER.indexOf("app.patch('/api/sessions/:name/effort'");
  const seg = SERVER.slice(idx, idx + 1600);
  assert.ok(/buildEffortSlashCommand\(\s*effort\s*\)/.test(seg), 'PATCH 未构造 slash 命令');
  assert.ok(/tmux\.sendKeys\(/.test(seg), 'PATCH 未经 tmux.sendKeys 下发');
  assert.ok(/setEffort\(/.test(seg), 'PATCH 下发后未 setEffort 更新记录');
});
