'use strict';

// 不可变持有:内部存副本,snapshot 不含 token
class MachineRegistry {
  constructor(machines) {
    this._byId = new Map();
    for (const m of machines) {
      this._byId.set(m.id, { ...m, online: false, lastError: null });
    }
  }

  all() {
    return Array.from(this._byId.values()).map(({ token, ...rest }) => rest);
  }

  getById(id) {
    const m = this._byId.get(id);
    if (!m) return undefined;
    const { token, ...rest } = m;
    return rest;
  }

  setOnline(id, online, lastError = null) {
    const m = this._byId.get(id);
    if (!m) return;
    this._byId.set(id, { ...m, online: !!online, lastError: online ? null : lastError });
  }

  // 对外快照,剔除 token
  snapshot() {
    return this.all().map(({ token, ...rest }) => rest);
  }

  getSecret(id) {
    const m = this._byId.get(id);
    return m ? { id: m.id, name: m.name, url: m.url, token: m.token } : undefined;
  }
}

module.exports = { MachineRegistry };
