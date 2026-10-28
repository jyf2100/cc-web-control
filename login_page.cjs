/**
 * 登录页服务端渲染:版本号注入(单一真理源 = package.json 的 version 字段)
 *
 * login.html 内以 {{APP_VERSION}} 占位(brand-ver / 底部版本 footer);GET /login
 * 不再 sendFile 原始模板,而是经 renderLoginPage 把占位替换为 `v<version>` 后
 * res.send——版本号 footer 因此静态存在于 /login 响应 HTML(e2e 验收 ac3:
 * 不依赖前端 JS / console / network 面板即可见)。
 * 单机(server.cjs)与 hub(hub/server.cjs)复用同一模板与同一注入逻辑。
 */

const fs = require('fs');
const path = require('path');

const VERSION_PLACEHOLDER = '{{APP_VERSION}}';

// 纯函数:模板 + version → 渲染后的 HTML(version 以 `v` 前缀呈现,如 v3.1.4)。
// 模板不含占位时原样返回(幂等);占位出现 N 处则全部替换。
function renderLoginPage({ template, version }) {
  const v = `v${String(version)}`;
  return String(template).split(VERSION_PLACEHOLDER).join(v);
}

// 读模板 + package.json → 渲染结果(fsImpl 可注入,测试不碰真实磁盘)。
// rootDir 默认本模块所在目录(= 仓根);hub 侧传 path.join(__dirname, '..')。
function readLoginPageSync(fsImpl = fs, rootDir = __dirname) {
  const template = fsImpl.readFileSync(path.join(rootDir, 'public', 'login.html'), 'utf8');
  const pkg = JSON.parse(fsImpl.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return renderLoginPage({ template, version: pkg.version });
}

module.exports = { VERSION_PLACEHOLDER, renderLoginPage, readLoginPageSync };
