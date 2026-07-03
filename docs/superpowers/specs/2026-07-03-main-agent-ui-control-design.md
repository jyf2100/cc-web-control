# 主控 agent 界面起停 + tmux 镜像 设计

> 日期:2026-07-03
> 状态:已修订(三轮 expert review 后),待 writing-plans
> 关联:[[2026-07-03-event-denoise-ab-design.md]](A+B 去噪,已实现)、操作手册 §13

## 目标

在 hub web 控制台(`console.html`)新增「主控 agent」面板,允许:
1. **起停** cc-main-agent tmux session(启动/停止 claude 进程,无需重启 hub)。
2. **只读镜像** cc-main-agent 的 tmux pane 输出(看主 agent claude 在干什么)。

## 背景

cc-main-agent 是 hub 本机的一个 tmux session(由 `setupMainAgent` 在 hub 启动时 spawn,跑 `claude --mcp-config …`)。目前它的生命周期绑定 hub 进程:start/close 在 `server.cjs` 的 `listen`/`close` 里,无法在运行中通过界面控制,也无法在界面观察其输出(只能 `tmux attach` 或 `tail` 审计)。

## 已批准的 3 个决策

1. **起停语义 = 只管 tmux session**。起/停只 spawn/kill tmux session,**不联动** watcher/dispatcher(它们在 hub 进程常驻)。**不联动的理由(权衡,非省事)**:(a) A+B 去噪已把 poke 噪音限到约 15min 一周期(见「起停语义」量化),噪音可接受;(b) `dispatcher.freeze/unfreeze` 当前不支持 round-trip——源码 trace:`freeze()` 只清 `_current.timer` 不清 `_current`;`unfreeze()` 调 `_pump()` 但因 `_current` truthy 直接 return → 队列永久卡死。联动需先修 dispatcher,超本 spec 范围。故 stop 只管 tmux,watcher/dispatcher 常驻,start 后新 poke 自动恢复。
2. **输入权限 = 只读镜像**。面板**不能** send-keys 到 cc-main-agent。守住 T1「只读参谋」边界(cc-main-agent 持 hub token,误输入有风险)。
3. **UI = 独立面板**。控制台顶部加专门的「主控 agent」面板(状态灯 + 起停按钮 + 内嵌 `<pre>` 镜像区),不混进全局看板。

## 架构

核心技巧:把 cc-main-agent 当作一个特殊 "machine"(id = `main-agent`)喂进现有 `ws_bridge`。前端面板的终端镜像组件复用现有 `init` 帧协议(★ C1:本面板只用 `init` 覆盖语义,不用 `output` 追加),**ws_bridge 协议零改动**。

```
浏览器 console.html
  ├─ 主终端区 #term-screen  ── WS(主)──┐ attach 子机 target
  └─ 主控 agent 面板 <pre>   ── WS(面板)─┤ attach {machine:'main-agent', session:'cc-main-agent'}
                                         │
hub server.cjs  wss.on('connection') ────┘
                  └─ bridge.getClient(mid)
                       ├─ 普通子机 mid → AgentClient(远程 HTTP/WS)
                       └─ 'main-agent' mid → LocalTmuxClient(本机 tmux 适配器)★ 新
                              └─ 引用计数共享池:session → {id, subs:Set<onMsg>, timer, lastCaptured}
                                  首订阅起 interval、末订阅清 interval(同 session 多连接只 1 个 capture)
                                  capture 变化 → 广播 onMsg({type:'init',data})(★ 覆盖语义,非追加)
```

### 后端

#### 1. `hub/local_tmux_client.cjs`(新,~60 行)

适配 `AgentClient` 被 `ws_bridge` 消费的契约(`attach(session,onMsg)` → handle、`sendOneShot(session,msg)`),把「本机 tmux session」翻译成「远程 agent」形状。

```js
// 构造(★ L7:砍掉 now 注入——polling 靠字符串 diff,用不上)
new LocalTmuxClient({ localTmux, sessionName, audit, pollMs = 1000 })

// 契约(对齐 ws_bridge 期望的 getClient 返回形状)
attach(session, onMsg)
  // 对齐 ws_bridge.cjs 行 31-34 / 16 / 62-63:每条浏览器 WS 独立调 attach,断开或切 target 时调 handle.detach()
  // session !== sessionName → onMsg({type:'error', data:'unknown session'}) 返回 dummy handle(L4:空 send + 空 detach,免依赖 ws_bridge try/catch 兜底)
  // ★ H1 引用计数共享池(照搬 AgentClient._pool):session → { id, subs:Set<onMsg>, timer, lastCaptured };★ R3-M1:`id` 单调递增(`id: ++this._seq`),供回调身份比对
  //   - ★ R2-H1 attach 入口守卫:if (entry && entry.timer === null) pool.delete(session) —— 已死 entry(timer=null,曾被 kill 分支清空)复活时强制删除,使后续 capture 再抛错走正常 error 路径(防「死屏重放陈旧 lastCaptured」)
  //   - 首次订阅该 session:localTmux.capture(sessionName, scrollback=2000) → resolve 后对**当前 subs 全员**广播 onMsg({type:'init', data: captured})(★ R2-L3:不只回调首订阅者;首 capture 未 resolve 时新订阅加入也收 init)+ 起 setInterval(pollMs),`if (timer.unref) timer.unref();`(★ R2-M1 对齐 dispatcher 行 149,防 hub close 被 timer 撑住不退)
  //   - 后续同 session 订阅:把 onMsg 加入 subs,立即用 lastCaptured 回放一次 {type:'init', data: lastCaptured}
  //   - 轮询:captured !== lastCaptured(字符串 diff)→ 对 subs 全员广播 onMsg({type:'init', data: captured}) + 更新 lastCaptured(★ C1:覆盖语义)。★ R2-L1 注记:setInterval 不等上次 capture settle,慢 tmux 下可能 capture 重叠;implementer 可选 setTimeout 链或 inFlight 防重入(可选优化,非目标)
  //   - subs 上限(如 10),超 → 拒绝订阅,返回 dummy handle
  //   - session 被 kill(capture 抛错)→ 对 subs 全员发一次 onMsg({type:'error', data:'session ended'}) 并**完整回收四件套** clearInterval(timer) + subs.clear() + `entry.timer = null`(tombstone) + pool.delete(session)(★ R2-H1:无条件全清,区别于正常 detach 的「subs 为空才删 entry」——防死 entry 留池致下次 attach 走「后续订阅」分支用陈旧 lastCaptured 回放永不更新;★ R3-L1:tombstone `entry.timer = null` 与 pool.delete 并存——belt-and-suspenders,使 R2-H1 守卫 `entry.timer === null` 非死代码:若因任何原因 entry 未被 delete,守卫仍能拦截死 entry 复活)
//   - ★ R3-M1 回调身份比对(entryId):「detach 删旧 entry → 新 attach 同 session key 建新 entry(新 id)→ 旧 capture 回调 fire」竞态下,闭包持旧 entry 引用会误操作新 entry。修法:所有异步回调(首次 capture resolve、轮询 diff、kill 分支)**创建时捕获 `entryId`**,fire 时 `const e = this._pool.get(session); if (!e || e.id !== entryId) return;`(陈旧回调 early-return,不操作可能已被替换的 entry)。kill 分支的 `pool.delete(session)` 同理先比对身份——kill 闭包捕获 entryId,fire 时 `e.id !== entryId` 直接 return,避免旧 kill 误删新 entry
  // 返回 handle = {
  //   send({type,data,enter}) { audit.log({scope:'local_tmux', event:'input_ignored', runId:null, detail:{via:'ws'}}); return false; }, // 只读,不调 poke/sendKey
  //   detach() { subs.delete(onMsg); if (subs.size === 0) { clearInterval(timer); pool.delete(session); } }, // ★ ws_bridge 在 ws.close / 切 target 时调;末订阅清 interval
  // }

sendOneShot(session, msg)
  // 只读:no-op。对齐 ws_bridge.handleBroadcast(行 84-85)期望返回 {ok,error}
  // ★ L1 审计取证(对称):audit.log({scope:'local_tmux', event:'input_ignored', runId:null, detail:{via:'broadcast'}})
  //   注:正常 broadcast 路径到不了 main-agent(不在 registry),纯防御。
  // → 返回 { ok:false, error:'read-only' }

close()
  // ★ R2-M1:hub close() 时调用(对齐 AgentClient.close() agent_client.cjs:212)。遍历 pool 每 entry:clearInterval(timer) + subs.clear() + pool.delete(session)。不清则 Node 进程被 setInterval 撑住不退(对照 dispatcher 行 149 显式 unref)
  // → 无返回值
```

**只读保证**:`send`/`sendOneShot` 永不调用 `localTmux.poke`/`sendKey`。面板无输入框是前端第二道保险。

**★ C1 output 倍增 bug 修复**:**始终发 `{type:'init', data: captured}`(覆盖语义),不再发 `output` 帧**。原因:前端 `console.js` 对 `output` 是追加(`+=`),若发全量会内容倍增;`init` 是覆盖赋值,符合本面板「整屏重绘」语义。(原 spec 「output 覆盖全量,与主终端区协议一致」措辞为事实错误,已删。)

**M7 审计轴对齐**:审计 scope 沿用子系统轴(现有 `dispatcher`/`event`/`mcp`),故用 `scope:'local_tmux'`(非 target 轴 `'main-agent'`,避免混轴)。schema 对齐 `server.cjs:271` 现有形状 `{scope, runId, event, detail}`,`detail.via` 区分 WS 直连(`ws`)还是广播(`broadcast`)。

**L2 redact**:capture 文本进入 `init` 帧前,用正则替换 `CC_WEB_HUB_TOKEN=…`、`Authorization: Bearer …` 等敏感串为 `<redacted>`(claude 可能回显 env,防泄露到前端)。

**L7**:构造不再注入 `now`(polling 靠字符串 diff,用不上)。

#### 2. `hub/ws_bridge.cjs` 的 `getClient`(在 `server.cjs` 装配处)

`server.cjs` 的 `new WsBridge({ getClient: (mid) => … })`(约行 293-302)增加分支:

```js
getClient: (mid) => {
  if (mid === 'main-agent') return mainAgentHandles?.localClient ?? null; // ★ M5:钉死到 mainAgentHandles.localClient
  const ac = clients.get(mid);
  if (!ac) return null;
  return { attach: (s, onMsg) => ac.attachSession(s, onMsg), sendOneShot: (s, msg) => ac.sendOneShot(s, msg) };
}
```

`LocalTmuxClient` 单例在 `setupMainAgent` 里构造(`new LocalTmuxClient({ localTmux, sessionName, audit })`),**统一钉死到 `mainAgentHandles.localClient`**(getClient 读 `mainAgentHandles?.localClient ?? null`)。**★ M5:删掉模块级裸变量 `mainAgentLocalClient`**(消除裸变量与 handles 字段并存的歧义)。

#### 3. 三个 HTTP 端点(均在 `app.use(requireAuth)` 之后、ws handler 之前)

**★ M2 门控(运行期)**:端点判断 `if (!mainAgentHandles) → 503 {error:'main agent not ready'}`(对齐 `server.cjs:211` 现有 dispatcher 端点模式;因 `setupMainAgent` async fire-after-listen + `.catch` 吞错可能导致 handles=null)。**不再用配置期 `ma.enabled` 作为端点门控**(配置期 → 运行期语义不对齐)。

**★ M1 速率限制**:复用 `createRateLimiter`,默认 `6/min`(起停操作低频,够用)。**★ R2-L2:删原 single-flight**(与 M3 串行锁冗余——串行锁下第二次进入时第一次已 settle,不存在 in-flight Promise 可复用;若误走 single-flight 跳过串行,两次都返 `{started:true}` 违 idempotent)。并发由 M3 串行锁 + `hasOwnedSession` 幂等返回保证,不需 single-flight。

**★ M3 串行锁**:`serializeMainAgentOp(fn)` —— promise-chain 串行锁,`start`/`stop` 经它串行;`close()` 时 `await mainAgentOpChain` 再 kill(防 close 中途 start 留孤儿 session)。

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/api/main-agent/start` | CSRF + 限流 + 串行锁。`!mainAgentHandles` → 503。`hasOwnedSession(name)`(M4)→ 200 `{running:true, started:false}`(幂等;★ R2-L2:并发由 M3 串行锁 + hasOwnedSession 保证,无 single-flight)。否则 `localTmux.create(name, cmd, {cwd, env: {...env, CC_WEB_OWNED:'1'}})`(★ M4 注入所有权标记)→ 200 `{running:true, started:true}`。**★ M6:create 抛错 → catch 里 `try { if (await hasOwnedSession(name)) await localTmux.kill(name); } catch (e) { audit.log({ scope:'local_tmux', runId:null, event:'cleanup_probe_failed', detail:{ name, error: e.message } }); }` 再 500**(★ R3-H1:空 catch 改审计取证——hasOwnedSession 因非 session-not-found 的失败(tmux 二进制临时不可用、权限问题等)抛错 → 原空 catch 吞错 → 误判「不 owned」→ 半 broken owned 漏清 → 留孤儿 claude 持 hub token;现写审计 `cleanup_probe_failed`,500 照返,不向客户端泄露 error message)(★ R2-H2:catch 加所有权判定——半 broken owned[已 `new-session -e CC_WEB_OWNED=1` 后续步骤失败]→ hasOwnedSession=true → 清理;foreign 已存在 → hasOwnedSession=false → 不动,避免与 M4「stop foreign 不杀」撕裂)。 |
| POST | `/api/main-agent/stop` | 同 CSRF + 限流 + 串行锁。`!mainAgentHandles` → 503。`hasOwnedSession(name)` → `localTmux.kill(name)` → 200 `{running:false, stopped:true}`。**★ M4 foreign 同名 session**(`hasSession` true 但非 owned)→ 200 `{stopped:false, reason:'foreign session'}`(不误杀外部 session)。否则 200 `{running:false, stopped:false}`(幂等)。**不**动 watcher/dispatcher。 |
| GET | `/api/main-agent/status` | `!mainAgentHandles` → 200 `{running:false, enabled:false}`(handles 未就绪,非 error)。就绪 → 200 `{running: await hasOwnedSession(name), enabled: ma.enabled}`。 |

**实现要点**:`start` 需要的 `mcpPath/trustPath/cwd/hubToken/hubUrl` 目前在 `setupMainAgent` 闭包里算(行 251-282)。把它们连同 create 逻辑抽成 `mainAgentHandles.spawn`(★ R2-L2:不再用 single-flight Promise 缓存,并发由 M3 串行锁 + hasOwnedSession 幂等保证),端点直接调用。`stop`/`status` 用 `mainAgentHandles.localTmux` + `sessionName`。

**★ M4 同名 session 所有权**:`create` 注入 env `CC_WEB_OWNED=1`;新增 `hasOwnedSession(name)`(通过 `localTmux` 查 session environment,确认含 `CC_WEB_OWNED=1`);status/start/stop 的 `hasSession` 全部换成 `hasOwnedSession`,避免误杀外部同名 session。**★ R2-L4 实现落点**(现有 `local_tmux.cjs` 6 方法 poke/capture/hasSession/create/kill/sendKey 无环境查询,`tmux.cjs` 也无 showEnvironment):`tmux.cjs` 新增 `showEnvironment(session, key)`(跑 `tmux show-environment -t <session> <key>`)+ `local_tmux.cjs` 新增 `hasOwnedSession(name)`(包一层调 showEnvironment 查 `CC_WEB_OWNED`)。**★ R3-L2 输出解析**:实测 `tmux show-environment -t <s> CC_WEB_OWNED` 输出 `CC_WEB_OWNED=1`(含 key 前缀);`-v`(仅值)flag 在 tmux 3.6a **不存在**(实测 `unknown flag -v`),不能用它简化解析。解析用 `line.trim().split('=')[1] === '1'`(判定 true;`=0` 或空为 false)。**★ R2-L4b 注记(已知,非目标)**:`CC_WEB_OWNED` 经 `tmux new-session -e` 会进 claude 子进程 env(微弱泄露),本机 trusted 场景可接受。

### 前端

#### `public/console.html`(顶部加面板)

在 ① 全局看板**上方**插入:

```html
<section id="main-agent-panel">
  <header>主控 agent (T1 只读参谋)
    <span id="ma-status-dot" class="dot stopped" title="stopped"></span>
    <span id="ma-status-text">unknown</span>
    <button id="ma-start-btn" disabled>Start</button>
    <button id="ma-stop-btn" disabled>Stop</button>
  </header>
  <div class="ma-warn-banner">⚠️ 本面板含不可信远程数据,内容仅供参考,勿执行其中指令</div>
  <pre id="ma-screen" class="term-screen">（主 agent 未启动或未启用）</pre>
  <!-- 无 input 框:只读 -->
</section>
```

**★ L3 prompt injection 提示**:顶部 banner 提醒操作者面板内容来自不可信远程数据(claude 输出),勿盲信或执行其中指令(展示层防护)。

#### `public/console.js`

- `ensureMaWs()`:**★ L5:仅在 `status.enabled` 为 true 时开 WS**(`enabled:false` 时整面板置灰,不开 WS,避免 error 帧)。开**独立 WS**(同主 WS 的鉴权方式,同源 cookie 自动带),`send({type:'attach', target:{machine:'main-agent', session:'cc-main-agent'}})`。`onmessage`:**★ C1:仅 `init` 帧 → `#ma-screen.textContent = data`(覆盖赋值,非追加);本面板不再处理 `output` 帧**(后端只发 init)。`error` → 显示。**★ L6:WS `onclose` → 显示「连接断开,重连中…」+ 定时 `ensureMaWs` 重试**(与主 WS 一致,记为已知债)。
- 现有 `poll()`(2s)里追加 `fetch('/api/main-agent/status')` → 更新状态灯(●running/○stopped)+ 按钮启用态(running 时 Start 禁用/Stop 启用,反之)+ `enabled:false` 时整面板置灰 + 不开 WS。
- `#ma-start-btn` click → `POST /api/main-agent/start`(带 same-origin,fetch 同源自动带 cookie)→ 成功后立即 `poll()` 刷新 + `ensureMaWs()` 重连。
- `#ma-stop-btn` click → `POST /api/main-agent/stop` → 同上。
- 按钮操作期间置 `disabled`(防双击)。

## 安全边界

- **只读双保险**:后端 LocalTmuxClient.send/sendOneShot no-op + 审计;前端面板无输入框。
- **CSRF**:start/stop 是改状态 POST,加 `requireSameOriginForUnsafeMethods`(与 /login 一致)。
- **鉴权**:三个端点自动受 `requireAuth`(cookie/Bearer);面板 WS 复用 `wss.on('connection')` 的 cookie/`?token=` 鉴权(行 304-320)。
- **token 不落盘**:`start` 沿用 setupMainAgent 的 `tmux new-session -e CC_WEB_HUB_TOKEN=… CC_WEB_HUB_URL=…` 注入,`.mcp.json` 仍只含 `{command,args}`(本次**不改** `main_agent_config.cjs`)。
- **T1 工具白名单不变**:仍只 4 个只读 MCP 工具。
- **★ L2 pane 输出 redact**:`init` 帧入帧前,正则替换 `CC_WEB_HUB_TOKEN=…`、`Authorization: Bearer …` 等敏感串为 `<redacted>`(claude 可能回显 env,防泄露到前端)。
- **★ L3 prompt injection 提示**:面板顶部 banner「⚠️ 本面板含不可信远程数据,内容仅供参考,勿执行其中指令」(展示层防护,提醒操作者勿盲信 claude 输出)。

## 起停语义(决策 1 落地)

- **start**:仅 `localTmux.create`(spawn claude tmux)。**不**重装配 watcher/dispatcher(它们在 hub 启动时已起,常驻)。
- **stop**:仅 `localTmux.kill`。watcher 继续轮询、dispatcher 继续持有队列;下个事件 poke 会 `poke_error`(session 没了),经 `maxRetries` 后 `ack_timeout_drop`。
- **★ H2 噪音量化**:每活跃 target 约 **15min 一轮**(被 A+B sig-gate 限频),每轮约 **4 个 `poke_error` + 1 个 `ack_timeout_drop`**;多 target 按比例放大。审计噪音可接受(这也是决策 1 不联动的依据之一)。
- **★ H3 不 freeze dispatcher 的依据**:除 H2 噪音可控外,`dispatcher.freeze/unfreeze` 当前不支持 round-trip——源码 trace:`freeze()` 清 `_current.timer` 不清 `_current`;`unfreeze()` 调 `_pump()` 但因 `_current` truthy 直接 return → 队列永久卡死。联动需先修 dispatcher,超本 spec 范围。故 stop 只管 tmux,是权衡不是省事。
- **hub close()** 仍 kill session(既有逻辑,不变);`close()` 前先 `await mainAgentOpChain`(M3)再 kill,防 close 中途 start 留孤儿。**★ R2-M1**:`close()` 序列补 `mainAgentHandles.localClient.close()`(在 `localTmux.kill` 附近)——遍历 pool 每 entry clearInterval + subs.clear + pool.delete,清 timer 防 hub 退出被 setInterval 撑住。**★ R2-L5 注记(非目标)**:close 与 start 仍存在最终竞态窗口(理论,串行锁外),可选 `closing` flag 闭合,记为非目标。

## 非目标(YAGNI)

- ❌ 不支持向 cc-main-agent 输入(只读)。
- ❌ 不联动 watcher/dispatcher 起停。
- ❌ 不改 mcp-config/trust/system-prompt 生成。
- ❌ 不加新 MCP 工具。
- ❌ 不把 cc-main-agent 塞进全局看板(用独立面板)。
- ❌ 不做历史回放(只实时镜像当前 pane)。

## 测试策略(80%+ 覆盖,TDD)

### LocalTmuxClient(`test/hub-local-tmux-client.test.cjs`,新)
- `attach` 首帧发 `init`(用 stub localTmux 返回固定 capture)。
- **★ C1 覆盖语义**:连续两次 `attach`(同 session、相同 capture)→ 第二次仅回放 `init`,接收端文本长度不变(覆盖不追加)。capture 变化 → 发 `init`(覆盖);不变 → 不发。
- **★ H1 共享池**:同 session 两次 `attach` 只起 1 个 interval(stub localTmux 计 capture 调用次数 = 1);两次 `detach` 后 interval 清零、pool 删除该 session;session 被 kill(capture 抛错)→ subs 全员收一次 `{type:'error', data:'session ended'}` 并清 interval。**★ R2-H1**:kill 后 pool entry 完整回收(subs.clear + delete,非仅清 interval);新 attach 命中已死 entry(timer=null)→ 强制 delete + 重建 → 不重放陈旧 lastCaptured、能收到 `{type:'error'}`。**★ R3-M1**:capture in-flight 期间 detach + 重新 attach 同 session(新 entry 新 id)→ 旧 capture 回调 fire 时 `e.id !== entryId` early-return,不误伤新 entry;断言新 entry 的 timer/subs 未被旧回调清理、新订阅者仍正常收 init。
- `session !== sessionName` → `onMsg({type:'error'})` + 返回 **★ L4 dummy handle**(空 send + 空 detach,非 null)。
- `handle.send()` → no-op,审计写 `input_ignored`(**★ M7** scope=`local_tmux`,detail.via=`ws`),返回 false。
- `sendOneShot()` → no-op,**★ L1**:审计写 `input_ignored`(detail.via=`broadcast`)。
- **★ L2 redact**:capture 含 `CC_WEB_HUB_TOKEN=xxx` → init 帧 data 已替换为 `<redacted>`。
- **★ R2-L4 hasOwnedSession 单测**(local_tmux.cjs 层,owned/foreign/无 session 三态):stub `tmux show-environment` 返 `CC_WEB_OWNED=1` → true;返空/无此键 → false;session 不存在(show-environment 抛错)→ false。**★ R3-L2**:补两条 key 前缀边界:stub 返 `CC_WEB_OWNED=0` → false(防「split 后非 '1' 的 truthy 误判」);返 `CC_WEB_OWNED=1` → true(确认含 key 前缀解析正确,未误用不存在的 `-v` flag)。
- `detach()` → 末订阅清 interval(后续 capture 变化不再触发)。
- 用 fake timer 控制 interval(**★ L7**:不再注入 `now`)。

### 端点(`test/hub-server-main-agent.test.cjs`,新)
- **★ M2 门控**:`mainAgentHandles` 未装配(null)→ status 200 `{running:false,enabled:false}`;start/stop → 503(对齐 dispatcher 端点 `server.cjs:211` 模式)。
- `GET status`:`enabled:false` → `{running:false,enabled:false}`;`enabled:true` + hasOwnedSession → `{running:true,enabled:true}`。
- `POST start`:`!mainAgentHandles` → 503;无 owned session → 调 create + `{started:true}`;已有 owned → `{started:false}`(不重复 create)。
- **★ R2-L2(原 M1 single-flight 已删)**:并发由 M3 串行锁保证(两次 start 串行执行);第二次进入时 hasOwnedSession=true → 返 `{started:false}` 幂等,不重复调 create。
- **★ M6 半 broken 清理**:stub create 抛错后,断言 kill 被调用一次(catch 分支清理)+ 返回 500。**★ R2-H2**:foreign 同名 session(hasOwnedSession=false)时 create 抛错 → catch **不**调 kill(不误杀 foreign)。**★ R3-H1**:hasOwnedSession 抛错(非 not-found,stub showEnvironment 抛 `permission denied`)→ 审计写 `cleanup_probe_failed`(断言 audit.log 被调,event/detail.name/detail.error 字段齐)+ 返回 500(响应体不泄露 error.message 给客户端)。
- `POST stop`:有 owned session → kill + `{stopped:true}`;无 → `{stopped:false}`(不重复 kill)。
- **★ M4 所有权**:foreign 同名 session(`hasSession` true 但非 owned)→ `{stopped:false, reason:'foreign session'}` 不 kill。
- start/stop 缺 same-origin → 403(CSRF)。
- **★ M1 限流**:连续 7 次 start(默认 6/min)→ 第 7 次 429。
- 用 stub localTmux(hasOwnedSession/create/kill)+ 起 express app(supertest 风格,复用现有 hub 测试模式)。

### ws_bridge 集成(可选,若现有 dispatcher 测试已覆盖 getClient 形状则轻测)
- `getClient('main-agent')` 返回 LocalTmuxClient(**★ M5**:读 `mainAgentHandles.localClient`);`getClient('unknown')` 返回 null。

### 前端
- 现有模式:hub 前端无单元测试(纯 DOM)。手动验收 + smoke 脚本补充(见下)。

## 手动验收(扩展 smoke)

`docs/main-agent-smoke.md` 增补一节:启动后打开 `http://127.0.0.1:7685`,在控制台顶部「主控 agent」面板:
- 状态灯显示 running,Stop 可点;点 Stop → 灯变 stopped,Start 可点。
- 点 Start → claude 重新 spawn,灯回 running。
- `#ma-screen` 实时显示 claude 的 poke/诊断输出(被 poke 时能看到 `[event] id=run-…` 行)。

## 文件清单

| 文件 | 动作 | 职责 |
|---|---|---|
| `hub/local_tmux_client.cjs` | 新建 | LocalTmuxClient 适配器(含 close() 遍历清池) |
| `hub/local_tmux.cjs` | 改 | ★ R2-L4 新增 `hasOwnedSession(name)`(包 showEnvironment 查 CC_WEB_OWNED) |
| `tmux.cjs` | 改 | ★ R2-L4 新增 `showEnvironment(session, key)`(跑 `tmux show-environment`) |
| `hub/server.cjs` | 改 | 3 端点 + getClient 分支 + setupMainAgent 抽 spawn 句柄 + close 序列补 localClient.close() |
| `public/console.html` | 改 | 顶部主控 agent 面板 |
| `public/console.js` | 改 | 面板 WS + status 轮询 + 起停按钮 |
| `test/hub-local-tmux-client.test.cjs` | 新建 | LocalTmuxClient 单元测试 |
| `test/hub-server-main-agent.test.cjs` | 新建 | 端点测试 |
| `docs/main-agent-smoke.md` | 改 | 面板手动验收 |
| `docs/操作手册.md` | 改(轻) | §13 补一句「界面可起停」 |

## 修订记录(专家 review)

本次基于专家 review 修订,核心架构(适配器方案、独立面板、双保险只读、token 不落盘)**不变**,仅 fold 进以下发现:

| 编号 | 严重度 | 改动 | 落点章节 |
|---|---|---|---|
| C1 | 🔴 CRITICAL | output 帧内容倍增 bug:始终发 `init`(覆盖语义),不再发 `output`;删「output 覆盖全量」措辞 | 「LocalTmuxClient」「console.js」「测试策略」 |
| H1 | 🟠 HIGH | 每 attach 独立 setInterval → tmux fork DoS:改引用计数共享池(照搬 AgentClient._pool),首订阅起 interval、末订阅清 | 「LocalTmuxClient」「架构图」「测试策略」 |
| H2 | 🟠 HIGH | stop 期间 poke_error 量化:~15min/轮、~4 poke_error + 1 ack_timeout_drop | 「起停语义」 |
| H3 | 🟠 HIGH | freeze/unfreeze 不支持 round-trip(源码 trace),回填决策 1 不联动的理由(权衡非省事) | 「已批准的 3 个决策」「起停语义」 |
| M1 | 🟡 MEDIUM | 起停端点加速率限制(6/min)(★ R2-L2:原 single-flight 已删,并发由 M3 串行锁保证) | 「三个 HTTP 端点」「测试策略」 |
| M2 | 🟡 MEDIUM | 端点门控改运行期 `if (!mainAgentHandles) → 503` | 「三个 HTTP 端点」「测试策略」 |
| M3 | 🟡 MEDIUM | start/stop 用 promise-chain 串行锁,close() await 链 | 「三个 HTTP 端点」「起停语义」 |
| M4 | 🟡 MEDIUM | 同名 session 所有权:注入 `CC_WEB_OWNED=1` + `hasOwnedSession`,stop 不误杀 foreign | 「三个 HTTP 端点」「测试策略」 |
| M5 | 🟡 MEDIUM | getClient 装配钉死 `mainAgentHandles.localClient`,删裸变量 | 「ws_bridge 的 getClient」「测试策略」 |
| M6 | 🟡 MEDIUM | start 半 broken session 清理:create catch 里 kill 再 500 | 「三个 HTTP 端点」「测试策略」 |
| M7 | 🟡 MEDIUM | 审计 scope 改子系统轴 `local_tmux`,schema 对齐 `{scope,runId,event,detail}` | 「LocalTmuxClient」 |
| L1 | 🟢 LOW | sendOneShot 也审计(detail.via='broadcast',纯防御) | 「LocalTmuxClient」「测试策略」 |
| L2 | 🟢 LOW | pane 输出 redact 敏感串为 `<redacted>` | 「LocalTmuxClient」「安全边界」「测试策略」 |
| L3 | 🟢 LOW | 面板顶部 prompt injection 提示 banner | 「console.html」「安全边界」 |
| L4 | 🟢 LOW | attach 返回 dummy handle(空 send + 空 detach)非 null | 「LocalTmuxClient」「测试策略」 |
| L5 | 🟢 LOW | `enabled:false` 时前端不开 WS(置灰) | 「console.js」 |
| L6 | 🟢 LOW | 面板 WS 断线重连提示(已知债) | 「console.js」 |
| L7 | 🟢 LOW | 砍掉 LocalTmuxClient 构造的 `now` 注入(polling 靠字符串 diff) | 「LocalTmuxClient」「测试策略」 |

### 第二轮(补丁轮,架构 reviewer)

第一轮主笔落地后 reviewer 复发现 2 HIGH + 1 MEDIUM 必修 + 2 LOW 建议 + 4 注记。编号加 `R2-` 前缀以区别第一轮。

| 编号 | 严重度 | 改动 | 落点章节 |
|---|---|---|---|
| R2-H1 | 🟠 HIGH | pool kill 分支回收不完整(死屏重放):kill 分支补完整回收三件套(clearInterval + subs.clear + pool.delete,无条件全清)+ attach 入口守卫(`entry.timer === null` 强制 delete) | 「LocalTmuxClient」「测试策略」 |
| R2-H2 | 🟠 HIGH | M6 catch 无条件 kill 撕裂 M4「不杀 foreign」:catch 加所有权判定 `if (await hasOwnedSession(name)) await kill(name)`,foreign 不动 | 「三个 HTTP 端点」「测试策略」 |
| R2-M1 | 🟡 MEDIUM | LocalTmuxClient 缺 close() hub 关不退:加 close() 遍历清池 + setInterval 创建处 unref() + hub close() 序列补 localClient.close() | 「LocalTmuxClient」「起停语义」「文件清单」 |
| R2-L2 | 🟢 LOW | M1 single-flight 与 M3 串行锁冗余:删 single-flight,仅留速率限制(6/min),并发由 M3 + hasOwnedSession 幂等保证 | 「三个 HTTP 端点」「测试策略」 |
| R2-L4 | 🟢 LOW | hasOwnedSession 实现落点 + 文件清单遗漏:tmux.cjs:showEnvironment + local_tmux.cjs:hasOwnedSession,文件清单补两行 | 「三个 HTTP 端点」「文件清单」「测试策略」 |
| R2-L1 | 🟢 注记 | setInterval 不等上次 capture settle(慢 tmux 重叠)→ 可选 setTimeout 链/inFlight 防重入,非目标 | 「LocalTmuxClient」 |
| R2-L3 | 🟢 注记 | 首次 capture resolve 后对当前 subs 全员广播 init(不只首订阅者) | 「LocalTmuxClient」 |
| R2-L4b | 🟢 注记 | CC_WEB_OWNED 经 tmux -e 进 claude 子进程 env(微弱泄露),本机 trusted 可接受,非目标 | 「三个 HTTP 端点」 |
| R2-L5 | 🟢 注记 | close 与 start 最终竞态窗口(理论)→ 可选 closing flag 闭合,非目标 | 「起停语义」 |

### 第三轮(silent-failure 收尾)

第二轮后 silent-failure-hunter 实测 tmux 3.6a 确认所有权方案成立(R2-L4 可行),但发现 1 HIGH + 1 MEDIUM + 2 LOW 需补。编号加 `R3-` 前缀。

| 编号 | 严重度 | 改动 | 落点章节 |
|---|---|---|---|
| R3-H1 | 🟠 HIGH | M6 空 catch 吞 hasOwnedSession 错误(非 not-found,如 tmux 二进制临时不可用/权限问题)→ 误判「不 owned」→ 半 broken owned 漏清 → 孤儿 claude 持 hub token。空 catch 改审计取证:写 `cleanup_probe_failed`(`{scope:'local_tmux', runId:null, detail:{name, error}}`),500 照返,不向客户端泄露 error | 「三个 HTTP 端点」「测试策略」 |
| R3-M1 | 🟡 MEDIUM | capture/kill 回调未钉死「fire 时重查 pool + entryId 身份比对」,detach + 重 attach 同 session 竞态下旧回调误伤新 entry。pool entry 加单调递增 `id`(`++this._seq`);所有 capture 回调与 kill 分支创建时捕获 `entryId`,fire 时 `if (!e || e.id !== entryId) return;` early-return | 「LocalTmuxClient」「测试策略」 |
| R3-L1 | 🟢 LOW | R2-H1 守卫 `entry.timer === null` 原是死代码(三件套未置 null + pool.delete 后 entry 不可达 → 守卫永不触发)。kill 分支补 `entry.timer = null` tombstone,与 pool.delete 并存(belt-and-suspenders),使守卫非死代码 | 「LocalTmuxClient」 |
| R3-L2 | 🟢 LOW | hasOwnedSession 的 `KEY=VALUE` 解析未指定(实测 `show-environment` 输出含 key 前缀,`-v` flag 在 tmux 3.6a 不存在)。解析用 `line.trim().split('=')[1] === '1'`;三态单测补 `CC_WEB_OWNED=0`(false)与 `CC_WEB_OWNED=1`(true)边界 | 「三个 HTTP 端点」「测试策略」 |

**状态**:已修订(专家 review 后 + 第二轮补丁 + 第三轮 silent-failure 收尾),待 writing-plans。核心架构与正面确认的设计(双保险只读、CSRF、token 不落盘、独立面板、4 只读 MCP 工具)均保留。
