// hub/local_tmux.cjs
'use strict';

/**
 * 包根 tmux.cjs 的适配层。默认注入真实 tmux 模块;测试传 stub。
 * @param {{tmux?:object}} opts
 */
function createLocalTmux({ tmux } = {}) {
  const t = tmux || require('../tmux.cjs');
  return {
    /** 单行 poke:msg 必须单行(换行被 tmux 拆碎,见 spike 02)。带 Enter 提交。 */
    async poke(session, msg) {
      if (typeof msg !== 'string') throw new Error('poke: msg must be string');
      if (msg.includes('\n')) throw new Error('poke: requires single-line message');
      await t.sendKeys(session, msg); // 根 sendKeys 默认补 Enter
    },
    async capture(session, scrollback = 0) { return t.capturePane(session, scrollback); },
    async hasSession(session) { return t.checkSession(session); },
    async create(session, command, opts) { return t.createSession(session, command, opts); },
    async kill(session) { return t.killSession(session); },
    async sendKey(session, key) { return t.sendKey(session, key); },
  };
}

module.exports = { createLocalTmux };
