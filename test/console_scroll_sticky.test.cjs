/**
 * 回归:控制台对话区 sticky 滚动(用户上滚查看历史时不被自动滚动拉回)。
 * 行为依据:用户报告 ".chat-container 不能滚动看前面的内容,只会自己滚动"
 *   —— 根因是 scrollToBottom 无条件拉回底部;修复为仅在用户贴底时跟随。
 * 锁定:贴底阈值常量、isPinnedToBottom 判断、scroll 监听同步、
 *   main.js 在 render 前判断 wasAtBottom、virtual_scroll 容差与 client.js 一致。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const clientJs = fs.readFileSync(path.join(PUBLIC, 'client.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(PUBLIC, 'modules', 'main.js'), 'utf8');
const virtualScrollJs = fs.readFileSync(path.join(PUBLIC, 'modules', 'virtual_scroll.js'), 'utf8');

test('sticky:client.js 定义贴底阈值常量', () => {
    assert.match(clientJs, /const\s+PINNED_THRESHOLD_PX\s*=\s*48/);
});

test('sticky:client.js 定义 isPinnedToBottom 判断函数', () => {
    assert.match(clientJs, /function\s+isPinnedToBottom\s*\(/);
});

test('sticky:scrollToBottom 仅在贴底时跟随(尊重用户手动上滚)', () => {
    const m = clientJs.match(/function\s+scrollToBottom\s*\(\)\s*\{([\s\S]*?)^\s{4}\}/m);
    assert.ok(m, 'scrollToBottom 函数存在');
    assert.match(m[1], /isPinnedToBottom/, 'scrollToBottom 必须先判断 isPinnedToBottom 再赋值 scrollTop');
});

test('sticky:.terminal-content scroll 监听实时同步位置给虚拟滚动路径', () => {
    assert.match(clientJs, /terminalContent\.addEventListener\(['"]scroll['"]/, '需监听 scroll');
    assert.match(clientJs, /updateScrollTop\(terminalContent\.scrollTop\)/, 'scroll 回调需同步 scrollTop');
});

test('sticky:main.js 在 render 之前判断 wasAtBottom(render 会改变 scrollHeight)', () => {
    const idxWasBottom = mainJs.indexOf('wasBottom = virtualScroll.wasAtBottom');
    const idxRender = mainJs.indexOf('virtualScroll.render(terminalModel');
    assert.ok(idxWasBottom > -1 && idxRender > -1, 'wasBottom 判断与 render 均存在');
    assert.ok(idxWasBottom < idxRender, 'wasAtBottom 必须在 render 之前判断');
});

test('sticky:virtual_scroll 贴底容差与 client.js 一致(48px)', () => {
    assert.match(virtualScrollJs, /SCROLL_THRESHOLD_PX\s*=\s*48/);
});

test('sticky:贴底判断语义正确(距底 48px 内为 true,上滚超出为 false)', () => {
    // 复刻 client.js isPinnedToBottom 逻辑,验证语义
    const PINNED_THRESHOLD_PX = 48;
    const isPinnedToBottom = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - PINNED_THRESHOLD_PX;
    // 模拟实测尺寸(scrollHeight=103149, clientHeight=495, max scrollTop=102654)
    const pinned = isPinnedToBottom({ scrollTop: 102654, clientHeight: 495, scrollHeight: 103149 });
    const scrolledUp = isPinnedToBottom({ scrollTop: 51574, clientHeight: 495, scrollHeight: 103149 });
    assert.strictEqual(pinned, true, '贴底(距底 ≤48px)应判定为 true');
    assert.strictEqual(scrolledUp, false, '上滚查看历史(距底 >48px)应判定为 false');
});
