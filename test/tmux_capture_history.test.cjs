/**
 * 回归:控制台可回看 tmux scrollback 历史(不只当前一屏)。
 * 用户反馈:"我只能看当前屏幕的信息,虽然有滚动条其实也没啥用"
 *   —— 根因:server 端 capture-pane 默认只抓当前可见屏(-S 默认 visible top),
 *   不含 scrollback;改为通过 -S -<N> 抓取历史行数,N 由启动环境变量控制。
 * 用户指令:"tmux capture-pane -t <session> -p -S -2000 加到启动环境变量吧"
 *
 * 锁定:buildCaptureArgs 构造的 tmux 命令参数(scrollback=0→不带 -S 原行为;
 *   N>0→追加 ['-S','-N'])、parseCaptureHistory 环境变量解析(未设/空/非法/负数→0 原行为,
 *   正整数 N→抓当前屏+往上N行)、server.cjs 已接入 CC_WEB_CAPTURE_HISTORY。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tmux = require('../tmux.cjs');

test('buildCaptureArgs: scrollback=0 不带 -S(原行为,只抓当前屏)', () => {
  assert.deepEqual(
    tmux.buildCaptureArgs('my-session', 0),
    ['capture-pane', '-t', 'my-session', '-p'],
  );
});

test('buildCaptureArgs: scrollback=2000 追加 -S -2000', () => {
  assert.deepEqual(
    tmux.buildCaptureArgs('my-session', 2000),
    ['capture-pane', '-t', 'my-session', '-p', '-S', '-2000'],
  );
});

test('buildCaptureArgs: scrollback=500 追加 -S -500', () => {
  assert.deepEqual(
    tmux.buildCaptureArgs('s', 500),
    ['capture-pane', '-t', 's', '-p', '-S', '-500'],
  );
});

test('buildCaptureArgs: 默认 scrollback=0(省略参数)', () => {
  assert.deepEqual(
    tmux.buildCaptureArgs('s'),
    ['capture-pane', '-t', 's', '-p'],
  );
});

test('parseCaptureHistory: 未设/空字符串 → 0(默认原行为,只抓当前屏)', () => {
  assert.equal(tmux.parseCaptureHistory(undefined), 0);
  assert.equal(tmux.parseCaptureHistory(''), 0);
});

test('parseCaptureHistory: "0" → 0(显式只抓当前屏)', () => {
  assert.equal(tmux.parseCaptureHistory('0'), 0);
});

test('parseCaptureHistory: "500" → 500(当前屏 + 往上 500 行 scrollback)', () => {
  assert.equal(tmux.parseCaptureHistory('500'), 500);
});

test('parseCaptureHistory: 非法/负数 → 0(回退原行为)', () => {
  assert.equal(tmux.parseCaptureHistory('abc'), 0);
  assert.equal(tmux.parseCaptureHistory('-5'), 0);
});

// ── server.cjs 接入校验(源码正则,与 console_scroll_sticky.test.cjs 同风格)──
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');

test('server.cjs: 用 parseCaptureHistory 解析 CC_WEB_CAPTURE_HISTORY', () => {
  assert.match(serverJs, /parseCaptureHistory\s*\(\s*process\.env\.CC_WEB_CAPTURE_HISTORY\s*\)/);
});

test('server.cjs: capturePane 调用传入 CAPTURE_HISTORY(scrollback)', () => {
  assert.match(serverJs, /tmux\.capturePane\s*\(\s*sessionName\s*,\s*CAPTURE_HISTORY\s*\)/);
});
