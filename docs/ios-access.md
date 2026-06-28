# iPhone 远程访问指南

本文档聚焦 iPhone / iOS Safari 访问 cc-web-control 的专属步骤与注意事项。
通用隧道部署(启动服务、获取公网 URL、token 生成)见
[部署使用文档](./部署使用文档.md) 的「受控外网模式」一节,此处不重复。

## 前置条件

- 服务端已通过 `./scripts/restart_tunnel.sh` 启动,拿到一个 `https://xxx.trycloudflare.com` URL 和一个 TOKEN
- iPhone 与服务端都能访问公网(隧道走 Cloudflare 边缘)

## 1. 首次访问

1. iPhone 上打开 **Safari**(必须 Safari,「添加到主屏幕」依赖它),访问拿到的 `https://...trycloudflare.com` URL
2. 自动跳转到登录页,输入 TOKEN,提交
3. 登录成功后 cookie 写入,跳转控制台

> TOKEN 由 `restart_tunnel.sh` 每次重启随机生成(`openssl rand -hex 16`),
> 存在 `/tmp/cc-web-control-env.sh`。重启服务后旧 TOKEN 失效,iPhone 需重新登录。

## 2. 添加到主屏幕(PWA 体验)

登录后建议「添加到主屏幕」,获得独立 app 体验(无浏览器地址栏,全屏):

1. Safari 底部分享按钮 →「添加到主屏幕」
2. 主屏出现 Roc-CC 图标,点开即进入 standalone 模式

`manifest.json` 已声明 `display: standalone`,主屏入口会隐藏 Safari 的地址栏与标签栏,
终端区域更大。配合 `viewport-fit=cover` 与 safe-area,刘海与底部横条不遮挡内容。

## 3. 隧道 URL 会变(Quick Tunnel 痛点)

`restart_tunnel.sh` 默认用 **Cloudflare Quick Tunnel**(`cloudflared tunnel --url`),
分配的是临时域名 `xxx.trycloudflare.com`,**每次重启脚本 URL 都变**。
后果:主屏图标书签到的是旧 URL,重启后图标失效,要重新「添加到主屏幕」。

### 推荐:命名隧道固定域名

长期从 iPhone 访问,改用命名隧道绑定固定域名,URL 永久不变:

1. 一次性创建隧道(在已登录 cloudflared 的机器上):
   ```
   cloudflared tunnel create cc-web-control
   ```
2. 在 Cloudflare Dashboard 把一个你拥有的域名(如 `cc.yourdomain.com`)CNAME 到
   `<tunnel-id>.cfargotunnel.com`
3. 写配置文件 `cc-web-control-tunnel.yml`:
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /root/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: cc.yourdomain.com
       service: http://127.0.0.1:7684
     - service: http_status:404
   ```
4. 用 `cloudflared tunnel run cc-web-control` 替代 Quick Tunnel 的 `cloudflared tunnel --url`

脚本目前写死 Quick Tunnel。改用命名隧道时,改造 `restart_tunnel.sh` 的 `tunnel_inner`
那一行即可,其余 server/tmux 逻辑不变。

固定域名后,iPhone 主屏图标永久有效,无需重做书签。

## 4. 登录速率限制

`POST /login` 有滑动窗口速率限制:**同一 IP 15 分钟内最多 5 次尝试**(可经
`CC_WEB_LOGIN_MAX` / `CC_WEB_LOGIN_WINDOW_MS` 环境变量调整)。超限返回 `429`,
响应带 `Retry-After` 头提示剩余等待秒数。

正常使用 1 到 2 次即登录成功,不会触发。TOKEN 输错多次会被临时锁定,等窗口滑过即可。

## 5. iOS Safari 已知行为与限制

- **后台不轮询**:看板页(`dashboard.html`)切到后台时暂停 2s 轮询,省电、避免请求堆积;
  切回前台立即刷新一次再恢复
- **标题提示**:有会话处于「等待」或「错误」状态时,页面标题变为 `(N) CC 看板`,
  方便从主屏图标一眼看出需要关注
- **100dvh**:三页用 `100dvh` 适配 iOS 动态工具栏,避免地址栏收起时的跳动
- **safe-area**:`viewport-fit=cover` + `env(safe-area-inset-*)`,刘海与底部横条留白
- **快捷回复**:终端尾部出现 `y/n`、`yes/no`、`continue?` 等待时,输入框上方浮现
  Yes / No / Continue 一键回复(扫描尾部 500 字,切会话自动清除)
- **止损快捷键**:窄屏(移动端 / 平板竖屏)终端头部显示 Esc / Ctrl+C 按钮,
  一键发送中断;桌面端隐藏,物理键盘直接按
- **粘贴提示**:粘贴含换行的内容时弹 toast,提示将按行逐条发送(每个换行触发一次回车)
- **主屏图标**:`apple-touch-icon.png`(180×180 不透明) + manifest 192/512,
  深褐底琥珀 `❯` + 光标条,替代旧 logo 的透明背景

## 故障排查

- 主屏图标打不开 → URL 已变(Quick Tunnel 重启),重新拿 URL,或改用命名隧道
- 登录提示 429 → 速率限制触发,等几分钟窗口滑过,或确认 TOKEN 正确
- 看板不刷新 → 后台暂停了,切回前台即恢复;控制台(`index.html`)走 WebSocket,需保持页面在前台
- 连不上 → 查 `/tmp/cc-web-control-tunnel.log`,确认有 `Registered tunnel connection`
