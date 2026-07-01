/**
 * 回归:隧道脚本透传 CC_WEB_CAPTURE_HISTORY 给 server。
 * 用户指令:"把 CC_WEB_CAPTURE_HISTORY 透传进隧道脚本"
 *
 * 锁定:restart_tunnel.sh 读取 CC_WEB_CAPTURE_HISTORY(默认空=原行为),
 *   并在 ENV_FILE 里 export,使隧道模式下的 server 也能开启 scrollback 回看。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'restart_tunnel.sh'), 'utf8');

test('restart_tunnel.sh: 读取 CC_WEB_CAPTURE_HISTORY(默认空=原行为)', () => {
  // 形如 CAPTURE_HISTORY="${CC_WEB_CAPTURE_HISTORY:-}"
  assert.match(script, /\$\{CC_WEB_CAPTURE_HISTORY:-\}/);
});

test('restart_tunnel.sh: ENV_FILE 透传 CC_WEB_CAPTURE_HISTORY 给 server', () => {
  assert.match(script, /export CC_WEB_CAPTURE_HISTORY=/);
});

// ── 对外发布:npm 包纳入隧道脚本 + 去本机依赖 ──
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('restart_tunnel.sh: PROJECT_ROOTS 默认值不写死本机路径(对外发布)', () => {
  const m = script.match(/PROJECT_ROOTS="\$\{CC_WEB_PROJECT_ROOTS:-([^}]*)\}"/);
  assert.ok(m, 'PROJECT_ROOTS 变量读取存在');
  assert.equal(m[1], '', '默认值应为空(由用户显式设,不依赖本机环境)');
});

test('package.json: files 含 scripts/restart_tunnel.sh(隧道脚本纳入 npm 包)', () => {
  assert.ok(
    pkg.files.includes('scripts/restart_tunnel.sh'),
    `files 应精确含 scripts/restart_tunnel.sh,实际: ${JSON.stringify(pkg.files)}`,
  );
});

test('package.json: files 不含 scripts/ 整目录(避免打包 .py 开发工具)', () => {
  assert.ok(
    !pkg.files.includes('scripts/'),
    '不应把 scripts/ 整目录打包(含 render_md_to_html.py / repo_snapshot.py 开发工具)',
  );
});

test('restart_tunnel.sh: server 用绝对路径启动,不把 cwd 改到包根(对外 claude 在用户当前目录)', () => {
  // 对外发布后 ROOT_DIR = npm 包安装目录;若 cd "$ROOT_DIR" 再跑 server,
  // claude 会启动在包目录而非用户项目。应保留用户 cwd、用绝对路径跑 server。
  // (脚本里引号是 bash 转义的 \",正则放宽引号锚定)
  assert.doesNotMatch(script, /cd\s+\\?"\$ROOT_DIR/);
  assert.match(script, /\$ROOT_DIR\/server\.cjs/);
});
