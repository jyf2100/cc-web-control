/**
 * 判断某 session 名是否有活跃 WS 连接。
 * 用途:server.cjs DELETE /api/sessions/:name 前置检查——控制台正连着(WS 活跃)则拒绝删除(409),
 * 防多标签/多设备 localStorage 不一致导致误杀当前会话(自杀)。
 *
 * 纯函数:`clients`(server.cjs 的 Map,key=ws,val 含 sessionName)由调用方传入,便于单测。
 * 活跃判定:ws.readyState === 1(OPEN),同 server.cjs ping 逻辑(:580)。
 */
function isSessionInUse(name, clients) {
  if (typeof name !== 'string' || !name) return false;
  if (!clients || typeof clients[Symbol.iterator] !== 'function') return false;
  for (const entry of clients) {
    const ws = entry && entry[0];
    const info = entry && entry[1];
    if (info && info.sessionName === name && ws && ws.readyState === 1) return true;
  }
  return false;
}
module.exports = { isSessionInUse };
