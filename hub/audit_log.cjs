'use strict';

const fs = require('fs');

class AuditLog {
  /**
   * @param {{filePath:string, now?:()=>string}} opts
   * now 可注入便于测试;默认 ISO 时间戳。
   */
  constructor({ filePath, now } = {}) {
    if (!filePath) throw new Error('AuditLog: filePath required');
    this.filePath = filePath;
    this._now = typeof now === 'function' ? now : () => new Date().toISOString();
  }

  /** 追加一条审计。runId 贯穿整条事件链。返回写入的条目(不可变快照)。 */
  async log({ scope, runId = null, event, detail = null }) {
    const entry = { ts: this._now(), scope, runId, event, detail };
    const line = JSON.stringify(entry) + '\n';
    // mode:0o600 仅对新建文件生效;既有文件权限不变。审计文件应由部署期 chmod 0600。
    await fs.promises.appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    return entry;
  }
}

module.exports = { AuditLog };
