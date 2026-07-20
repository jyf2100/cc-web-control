'use strict';

// OS keychain 适配层 —— Anthropic API key 的唯一落盘点。
//
// 背景:被托管对象(Claude Code)存在不可审计的高权限 client 端行为,托管者自身须先把
// secret 管好:不能一边警惕被托管 agent 越权、一边自己把 ANTHROPIC_API_KEY 写在明文 config 里。
// 因此 key 不落盘明文,存 OS 原生 credential store,启动时从 keychain 解析、经 tmux -e 注入
// 子进程 env(不落宿主 shell 历史;与 CC_WEB_OWNED 同一注入通道,本机 trusted 可接受)。
//
// 三后端:
//   darwin  → macOS Keychain(`security`)
//   linux   → Secret Service via libsecret(`secret-tool`)
//   win32   → Windows Credential Manager(store:`cmdkey`;read:PowerShell CredRead,因 cmdkey 无法回读密码)
//
// 范式照搬全仓「纯函数 + 依赖注入」:命令构造/解析为纯函数,exec 注入便于测试不碰真实 keychain。
// 失败语义(验收 A5):keychain 不可用/拒写时绝**不**回退到明文,而是抛结构化 KeychainError。

const { execFile } = require('child_process');
const { promisify } = require('util');

const DEFAULT_SERVICE = 'cc-web-control';
const EXEC_TIMEOUT_MS = 10_000; // 防 keychain 弹窗 / 锁屏挂死

// 结构化错误:序列化即验收要求的 {"code":...,"reason":...}
class KeychainError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'KeychainError';
    this.code = code;
    this.reason = reason;
  }
  toJSON() {
    return { code: this.code, reason: this.reason };
  }
}

const defaultExec = promisify(execFile);

// —— keychain:// 引用格式(写在 config 里替代明文)——
// 形如 keychain://cc-web-control/anthropic-api-key
function keychainRef(service, account) {
  return `keychain://${service}/${account}`;
}

function parseKeychainRef(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/^keychain:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { service: m[1], account: m[2] };
}

function isPlaintextKey(value) {
  // 既非空、又非 keychain:// 引用 → 视为明文(待迁移或待注入)
  return typeof value === 'string' && value.length > 0 && !parseKeychainRef(value);
}

// 防御性脱敏:把字符串里的 Anthropic key 字面值(sk-ant-...)替换为 sk-ant-****。
// 用于审计 cmd 等对外字段 —— 正常流程 key 不进 cmd(经 tmux -e 注入),此处仅防用户把 key 拼进命令的极端情况。
function maskSecret(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-****');
}

// —— 后端:命令构造 + 输出解析(纯函数,便于单测断言)——

const darwinBackend = {
  name: 'keychain',
  setCmd: (service, account, value) => ({
    file: 'security',
    args: ['add-generic-password', '-s', service, '-a', account, '-w', value, '-U'],
  }),
  getCmd: (service, account) => ({
    file: 'security',
    args: ['find-generic-password', '-s', service, '-a', account, '-w'],
  }),
  // get 失败时: stderr 含 "could not be found" → key 未存(非 keychain 故障)
  notFound: (stderr) => /could not be found|not found/i.test(stderr || ''),
};

const linuxBackend = {
  name: 'libsecret',
  setCmd: (service, account, value) => ({
    file: 'secret-tool',
    args: ['store', `--service=${service}`, `--account=${account}`, service],
    input: value + '\n',
  }),
  getCmd: (service, account) => ({
    file: 'secret-tool',
    args: ['lookup', 'service', service, 'account', account],
  }),
  notFound: (stderr) => true, // secret-tool lookup 未命中 → 非零退出、stderr 通常为空,统归 not found
};

function windowsTarget(service, account) {
  return `${service}/${account}`;
}

// Windows read:cmdkey 无法回读密码,用 PowerShell P/Invoke CredRead(CRED_TYPE_GENERIC=1,
// 与 cmdkey /generic 写入同一 store)。用模板字面量承载:PS 变量均为 $x(无 ${ 序列)、
// 无反引号,故不会触发 JS 模板插值;${target} 是唯一的 JS 插值点(注入目标名)。
function winCredReadPs(target) {
  return `$ErrorActionPreference='Stop'
$src=@'
using System;using System.Runtime.InteropServices;
public class CCred{
  [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string t,int ty,int f,out IntPtr p);
  [DllImport("advapi32.dll")]public static extern void CredFree(IntPtr p);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  public struct CRED{public int Flags;public int Type;public IntPtr TargetName;
    public IntPtr Comment;public long LastWritten;public int BlobSize;public IntPtr Blob;
    public int Persist;public int AttrCount;public IntPtr Attrs;public IntPtr TargetAlias;public IntPtr UserName;}
}
'@
Add-Type $src
$p=[IntPtr]::Zero
if(-not[CCred]::CredRead("${target}",1,0,[ref]$p)){Write-Output '';exit}
$o=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[CCred+CRED])
$r=if($o.BlobSize -gt 0){[Runtime.InteropServices.Marshal]::PtrToStringUni($o.Blob,$o.BlobSize/2)}else{''}
[CCred]::CredFree($p)
Write-Output $r`;
}

const windowsBackend = {
  name: 'credman',
  setCmd: (service, account, value) => ({
    file: 'cmdkey',
    args: ['/generic:' + windowsTarget(service, account), '/user:' + service, '/pass:' + value],
  }),
  getCmd: (service, account) => ({
    file: 'powershell',
    args: ['-NoProfile', '-NonInteractive', '-Command', winCredReadPs(windowsTarget(service, account))],
  }),
  notFound: () => false, // CredRead 未命中已转成空串 stdout + exit 0,由 get() 空值判定
};

function pickBackend(platform) {
  if (platform === 'darwin') return darwinBackend;
  if (platform === 'win32') return windowsBackend;
  return linuxBackend; // linux/其它 unix
}

const PROBE_ACCOUNT = '__ccwc_probe__';

// 工厂:platform/exec 注入;exec = (file, args, opts) => Promise<{stdout, stderr}>
function createSecretStore({
  platform = process.platform,
  exec = defaultExec,
  service = DEFAULT_SERVICE,
} = {}) {
  const backend = pickBackend(platform);

  async function run(cmd) {
    const opts = { timeout: EXEC_TIMEOUT_MS, maxBuffer: 256 * 1024 };
    if (cmd.input != null) opts.input = cmd.input;
    const r = await exec(cmd.file, cmd.args, opts);
    return { stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  // keychain 是否可用:跑一次「读哨兵 account」;ENOENT → 工具缺失;其它(含未命中)→ 工具在。
  async function available() {
    const cmd = backend.getCmd(service, PROBE_ACCOUNT);
    try {
      await run(cmd);
      return true;
    } catch (e) {
      if (errCode(e) === 'ENOENT') return false;
      return true; // 工具存在(只是哨兵未命中 / 锁屏等),视为可用
    }
  }

  async function set(account, value) {
    if (typeof account !== 'string' || !account) throw new KeychainError('KEYCHAIN_UNAVAILABLE', 'account required');
    if (typeof value !== 'string' || !value) throw new KeychainError('KEYCHAIN_UNAVAILABLE', 'value required');
    const cmd = backend.setCmd(service, account, value);
    try {
      await run(cmd);
      return true;
    } catch (e) {
      // set 失败一律视作 keychain 不可用(验收 A5:绝不回退明文)
      throw new KeychainError('KEYCHAIN_UNAVAILABLE', setReason(e));
    }
  }

  async function get(account) {
    if (typeof account !== 'string' || !account) throw new KeychainError('KEYCHAIN_UNAVAILABLE', 'account required');
    const cmd = backend.getCmd(service, account);
    let stdout;
    try {
      stdout = (await run(cmd)).stdout;
    } catch (e) {
      const code = errCode(e);
      if (code === 'ENOENT') throw new KeychainError('KEYCHAIN_UNAVAILABLE', `tool not found: ${e.path || cmd.file}`);
      if (backend.notFound(e.stderr)) throw new KeychainError('SECRET_NOT_FOUND', `no secret for account "${account}"`);
      throw new KeychainError('KEYCHAIN_ERROR', e.stderr || e.message || 'read failed');
    }
    const val = stdout.replace(/\r?\n$/, '');
    if (!val) throw new KeychainError('SECRET_NOT_FOUND', `empty secret for account "${account}"`);
    return val;
  }

  return { available, set, get, backend: backend.name, service };
}

function errCode(e) {
  return (e && e.code) || undefined;
}

/**
 * 启动时把 config 里的 anthropic_api_key 值解析成可注入子进程 env 的真实 key。
 *   空/未配置 → null(claude 走自己的登录,host 不注入)
 *   keychain:// 引用 → 从 keychain 读(失败抛 KeychainError)
 *   明文(迁移本会话前的旧值 / env 提供)→ 直接返回(仅在内存,不落盘)
 * @param {string} configValue CFG.anthropic_api_key
 * @param {{get:(account:string)=>Promise<string>}} store
 */
async function resolveApiKey(configValue, store) {
  if (!configValue) return null;
  const ref = parseKeychainRef(configValue);
  if (ref) return store.get(ref.account);
  return configValue; // 明文(内存态)
}

function setReason(e) {
  if (errCode(e) === 'ENOENT') return `tool not found: ${e.path || (e.message || '')}`;
  return (e && (e.stderr || e.message)) || 'write failed';
}

module.exports = {
  createSecretStore,
  KeychainError,
  keychainRef,
  parseKeychainRef,
  isPlaintextKey,
  maskSecret,
  resolveApiKey,
  pickBackend,
  // 后端命令构造/解析导出,供单测与外部直接调用
  darwinBackend,
  linuxBackend,
  windowsBackend,
  winCredReadPs,
  windowsTarget,
  DEFAULT_SERVICE,
};
