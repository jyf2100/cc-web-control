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
    return Array.from(this._byId.values()).map(({ token, conn, ...rest }) => rest);
  }

  getById(id) {
    const m = this._byId.get(id);
    if (!m) return undefined;
    const { token, conn, ...rest } = m;
    return rest;
  }

  // 运行时注册:单机反向 WS 连上时调用。conn 为注册连接句柄(仅用于下线感知,不外泄)。
  add(machine, conn = null) {
    this._byId.set(machine.id, { ...machine, online: false, lastError: null, conn });
  }

  // 运行时下线:注册连接断开时调用。
  remove(id) {
    this._byId.delete(id);
  }

  setOnline(id, online, lastError = null) {
    const m = this._byId.get(id);
    if (!m) return;
    this._byId.set(id, { ...m, online: !!online, lastError: online ? null : lastError });
  }

  // 对外快照:all() 已剥离 token,此处仅作语义别名
  snapshot() {
    return this.all();
  }

  getSecret(id) {
    const m = this._byId.get(id);
    return m ? { id: m.id, name: m.name, url: m.url, token: m.token } : undefined;
  }
}

module.exports = { MachineRegistry };
