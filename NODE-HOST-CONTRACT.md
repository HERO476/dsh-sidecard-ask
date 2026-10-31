# NODE-HOST-CONTRACT — 非 Node 宿主必须实现的契约面

> **这份文档是什么**：`dsh-sidecard-ask` 2.1.7 在真实运行中**实际依赖**的宿主能力清单，按层拆开，逐条给出调用点、语义、缺失后果与验收方法。
>
> **不是什么**：不是 DSH 官方规范，也不是"全部插件"的契约。它由**本插件源码的真实调用点反推**得出，凡是"宿主侧参照实现"的内容都标注了出处（rc.5 解包源码），凡是**推断**而非实测的都显式标注。想用 Go 之类非 Node 运行时写一个宿主，这份就是最小的对表依据。
>
> 标注约定：`[实测]` = 本机 rc.5 上跑过/抓过；`[源码]` = 读插件源码得到；`[对照]` = 读宿主 rc.5 源码得到；`[推断]` = 未实测的推理，不可当契约用。

---

## §0 结论先行

1. **这个插件不是"可选 Node"**：它 import 了 `node:fs` / `node:os` / `node:path` / `node:net` / `node:tls`，用了全局 `Buffer` 与 `process.env`，并且把 Node 的 `(req, res)` 双流对象**直接当成契约**（`req.on('data'|'end'|'error')`、`res.write` 分块刷出 SSE）。**换宿主 = 换运行时语义，不是换 HTTP 框架。**
2. **硬依赖只有两条链路**：①`webServer` 注册路由 + 这套 req/res 语义；②前端 `window.__ModuleLoader__` + React + 具名槽位。其余（`subagents` / `tools` / `connection` / `sidebarRightTabs` / `sidebarRight` / `betterSidebar`）**全是软依赖**：拿不到就降级，插件照跑。
3. **最容易被忽略的一条**：`Buffer` 与 `Buffer.byteLength` 被用于响应体长度与请求体拼接（`index.js:1478`、`index.js:1409`）。任何宿主必须提供 UTF-8 字节语义的等价物，否则 `content-length` 一算错就会挂住连接。

---

## §1 契约分层总表

| 层 | 名称 | 插件是否要 | 缺失后果 |
|---|---|---|---|
| L1 | JS 运行时 + Node 内建模块 | **硬** | 模块加载即失败，整个插件不启动 |
| L2 | HTTP 服务与 `(req,res)` 语义 | **硬** | 8 个 API 全部 404/挂死，后端功能全灭 |
| L3 | 插件上下文（生命周期/服务定位） | **硬** | 无 `inject` 就无法注册路由 |
| L4 | 鉴权仲裁 `connection.requestRejection` | 软 | 降级为"仅 loopback/Origin 围栏"（会 warn） |
| L5 | 子代理 `subagents` | 软 | 生成类功能不可用，`/state` 报 `NO_START_CAPABILITIES` |
| L6 | 工具注册表 `tools` | 软 | 只读工具白名单失效，子代理继承全量工具 |
| L7 | 文件系统（配置持久化） | 软 | 配置不落盘，每次重启回默认 |
| L8 | 出站 `net`/`tls`（SMTP 反馈） | 软 | 反馈只落本地日志 |
| L9 | 前端模块加载器 `/plugins` + `__ModuleLoader__` | 软（无则纯 API） | 浏览器里没有任何界面 |
| L10 | 具名槽位 `slots` | 软 | 界面无处挂载（前端空跑） |
| L11 | 右侧栏/第三方栏服务 | 软 | 右栏承载面不可用，退回浮层 |

**一句话取舍**：想先跑通"能生成"的最小宿主，只做 **L1+L2+L3+L5**；想跑通"有界面"，还得加 **L9+L10**。

---

## §2 R1 · 模块与会话身份

`[源码]`

- 插件是 **ESM**（`package.json` `"type": "module"`），入口 `index.js` 导出四个具名符号：`name`、`inject`、`PLUGIN_VERSION`，以及默认的宿主注入函数（`export function inject` 同名常量与运行时函数在 DSH 里由 loader 解析）。
- 硬依赖声明：**只有** `webServer`

  ```js
  export const inject = ['webServer']   // index.js:45
  ```

  宿主必须能表达"我需要 webServer 服务"并在其可用后再调用插件入口；其余服务通过 `ctx.get()` 探测。
- 版本门在 `package.json`：`engines: { node: ">=20", dsh: ">=0.1.2-rc.1 <0.3.0" }`。宿主侧语义 `[对照]`：`semver.satisfies(runtimeVersion, range, { includePrerelease: true })` —— **预发布版本必须参与比较**（rc.3/rc.5 都是预发布）。自己实现门禁时若丢掉 `includePrerelease`，rc 版会被判为不满足。
- `PLUGIN_VERSION` 必须能被前端读到：客户端校验它等于自身 `CLIENT_VERSION`（`test/verify.mjs` 也在仓库侧校验三处一致）。

**替代要求**：Go 宿主若用嵌入式 JS 引擎，至少要提供 ESM `import` + 具名导出语义；CommonJS 转换会打断 `node:` 前缀解析与顶层 `export const`。

---

## §3 R2 · 插件上下文子集（这是全部）

`[实测]` 对插件源码里 `ctx.*` 的成员访问做全量统计，**只有 7 个成员**：

| 成员 | 次数 | 语义要求 |
|---|---|---|
| `ctx.logger` | 20 | 至少 `info` / `warn` 两个方法，可带多参 |
| `ctx.get(name)` | 11 | 按名取服务，**未注册返回 `undefined`**（不能抛） |
| `ctx.effect(fn)` | 4 | 调用 `fn`，其返回值为 disposer，插件卸载/重载时回调；`fn` 抛错按单个效果失败处理 |
| `ctx.on(event, handler)` | 2 | 事件订阅，返回 disposer |
| `ctx.webServer` | 2 | 见 §4 |
| `ctx.subagents` | 2 | 见 §8 |
| `ctx.tools` | 1 | 见 §9 |

前端另有 `ctx.inject` / `ctx.slots`（见 §12）：

| 成员 | 语义要求 |
|---|---|
| `ctx.inject(['a','b'], cb)` | 所列服务**全部**就绪后调用 `cb(injectedCtx)`；返回 disposer |
| `ctx.inject('name', cb)` | 单服务版本 |
| `ctx.slots.inject(name, cb)` | 槽位存在后注册，返回 disposer |
| `ctx.slots.register(options, component)` | 向槽位注册，返回 disposer |

`[推断]` **disposer 必须幂等且不能抛**：插件在卸载路径上会连续调用多个 disposer，其中一个抛错会掩盖后续释放（代码里到处是 `try { dispose() } catch {}`，说明开发者认为它可能抛）。

---

## §4 R3 · HTTP 路由与 `(req,res)` 语义

### 4.1 注册形状

`[源码]` `index.js:2873` 起（prefix 分支在 `index.js:2876`）：

```js
ctx.webServer.register({ kind: 'prefix', path: '/sidecard-ask/api', handler })
// 若宿主拒绝 prefix，则退化为逐方法精确路由：
ctx.webServer.register({ kind: 'exact', path: '/sidecard-ask/api/ping', handler })
```

- `kind: 'prefix'` 是首选；`register` **抛错**即触发退化路径，所以宿主若不支持 prefix，必须**同步抛错**，不能静默注册成功。
- `register` 必须返回 disposer（插件用 `ctx.effect` 包裹）。
- handler 签名 `(req, res)`，由宿主在**每个请求**上调用；同一 handler 要能并发处理多个请求（插件自身用 `await` 读体，不阻塞其它连接）。

### 4.2 插件真正触碰的 req/res 成员（全量）

`[实测]` 静态统计 + 人工核对，**就是这些，多一个都不需要**：

| 对象 | 成员 | 必须满足的语义 |
|---|---|---|
| `req` | `.method` | 大写 HTTP 动词字符串 |
| `req` | `.url` | 至少 `pathname[+query]`；插件用 `new URL(url, 'http://dsh.internal').pathname` 解析 |
| `req` | `.headers` | 小写键的普通对象；取值可能是 `string` 或 `string[]`（代码按 `string` 判型） |
| `req` | `.on(event, cb)` | 必须支持 `'data'`（chunk 须有 `.length` 与可 `Buffer.concat` 的字节序）、`'end'`、`'error'` |
| `req` | `.removeListener` | 可为 `undefined` 的判断已被代码兼容（`typeof === 'function'` 才调） |
| `req` | `.destroy()` | 用于超限时中止读体 |
| `res` | `.writeHead(status, headers)` | 设置状态行与响应头 |
| `res` | `.write(string)` | **必须能被多次调用且每次立即刷给客户端**（SSE 靠它） |
| `res` | `.end([body])` | 结束响应；可无参数 |
| `res` | `.headersSent` | 布尔 |
| `res` | `.writableEnded` | 布尔 |
| `res` | `.destroyed` | 布尔 |
| `res` | `.on('close', cb)` | 只需 `'close``（`index.js:2628` 用它判断浏览器是否离开） |

**关键点**：`res.write` 的**即时刷出**是 SSE 的全部基础。任何把响应体缓存在内存里最后一次性写出的宿主，会让流式卡片"整段答案在结束时一次性出现"，还可能导致心跳失效、被中间层判死。

### 4.3 请求体读取

`[源码]` `index.js:1447` `readJsonBody`：

- 流式累积 chunk，累计超过 **`1 << 20` 字节（1 MiB）** 立即 `req.destroy()` 并抛 `{code:'too-large'}` → 客户端收 400。
- **空体返回 `null`**（不是 `{}`，也不是错误）。
- 非 JSON 抛 `{code:'bad-request'}`。
- 不依赖 `content-type`，不依赖 `content-length`。

### 4.4 响应与错误形状

`[源码]` `writeJson`（`index.js:1413`）设置的三个头是硬要求：

```
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: Buffer.byteLength(body)     // UTF-8 字节数，不是字符串长度
```

成功：`{"ok":true,"value":<任意>}`；失败：`{"ok":false,"error":{"code":"<token>","message":"<中文可读>"}}`（`writeError`，`index.js:1436`）。

`[实测]` 线上真实响应（未登录访问）：

```json
{"ok":false,"error":{"code":"unauthorized","message":"需要先通过 DSH 登录（宿主会话未认证）"}}
```

---

## §5 R4 · API 方法表与鉴权闸门

### 5.1 方法表

`[源码]` `index.js:2728`：

```js
const API_METHODS = ['ping', 'state', 'ask', 'cancel', 'config', 'reset', 'diagnose', 'feedback']
```

| 方法 | 动词 | 过鉴权闸门 | 说明 |
|---|---|---|---|
| `ping` | GET / HEAD | **否**（唯一豁免） | 只回 `{version, at}`，用于探活 |
| `state` | GET / POST | 是 | 返回能力、SMTP 解析、provenance 等全量诊断面 |
| `ask` | POST | 是 | 起一次子代理并开 SSE |
| `cancel` | POST | 是 | 取消某次运行（带归属校验） |
| `config` | POST | 是 | 读写配置 |
| `reset` | POST | 是 | 重置 |
| `diagnose` | POST | 是 | 客户端诊断上报 |
| `feedback` | POST | 是 | SMTP 反馈 |

未在表内的方法名一律 404（**动词错误不改变 404**：方法是先于动词判定的）。

### 5.2 两道闸门，顺序不可换

`[源码]` `routeHandler`（`index.js:2786`）顺序是：**信任围栏 → 方法名校验 → ping → 鉴权 → 业务**。

**闸门 1 · 信任围栏** `isTrustedRequest(req, trustedHosts)`（`index.js:1374`）：

1. 必须有 `host` 头，且能构成合法 authority，否则拒。
2. `trustedHosts` 里带端口 → 比 `host:port` 全等；不带端口 → 只比 hostname。
3. hostname 既非 loopback 又不在 `trustedHosts` → 拒。
   - loopback 判定（`isLoopbackHostname`，`index.js:1360`）：`localhost`、`[::1]`、`127.x.y.z`（四段、每段 1–3 位数字且 ≤255）。**不含 `::ffff:127.0.0.1`、不含 `0.0.0.0`**。
4. `sec-fetch-site: cross-site` → 拒。
5. 有 `origin` → 必须与 `host` 的**完整 authority** 相同（端口不同即不同源）；无 `origin` → 放行。

**闸门 2 · 会话认证** `authRejection(req)`（`index.js:2754`）—— 返回值语义是这份契约里最需要精确复制的一段：

| `connection.requestRejection(req)` 返回 | 插件行为 |
|---|---|
| `401` | 响应 401 `unauthorized` |
| `403` | 响应 403 `forbidden` |
| `undefined` / `null` / `false` / `200` | **放行** |
| 其它任意值（对象/字符串/…） | 按拒处理 → 403，并 warn |
| 抛异常 | **fail-closed** → 401 |
| 服务不存在（`ctx.get('connection')` 为 `undefined`） | **放行**，只记一条 warn（每个进程一次） |

`[设计]` 最后一行是"WEB 端正常形态"：宿主没把 `connection` 暴露给插件时，loopback+Origin 围栏就是全部模型。**做 Go 宿主时若实现了会话却忘了暴露该服务，等于无认证**——这是本契约最容易踩空的一条。

---

## §6 R5 · SSE 契约

`[源码]` `openSse`（`index.js:1503`）：

响应头：

```
content-type: text/event-stream; charset=utf-8
cache-control: no-cache, no-transform
connection: keep-alive
x-accel-buffering: no
```

帧格式（严格）：

```
event: <name>\n
data: <JSON>\n
\n
```

心跳：每 **15 000 ms** 写一次注释帧 `: keep-alive\n\n`，定时器置 `unref()`（不阻止进程退出）。
结束语义：`send()` 在 `closed` 后静默丢弃；`end()` **幂等**且必须清掉心跳定时器；`closed` 为真当且仅当内部已关或 `res.writableEnded === true`。

**宿主侧要求**：`res.write` 必须是"写进 socket 并 flush"，且客户端的半关闭要能被 `res.on('close')` 感知（否则心跳会对着已死连接写一整晚）。

---

## §7 R6 · 子代理（两代 API 并存）

`[源码]` `index.js:1616` `subagentsService()` / `usesActivationApi()` / `startSubagent()`：

- 服务被认为"可启动"的条件：`typeof service.start === 'function' || typeof service.startActivation === 'function'`。
- **旧面（≤0.2.1-alpha.1）**：`service.start(provider, request)` → 返回 `{ id, localAgent?, result: Promise, dispose }`。
- **新面（0.2.1-alpha.2+）**：`service.startActivation(spec)`，`spec = { provider, label, delivery: 'caller', signal, request }`，返回 `{ childId, result, dispose }`。
  - `request` 是同一个 `SubagentStartRequest` 形状，插件会带 `prompt`、`parent`，并按能力追加 `persona` / `toolFilter` / **`agentPreset`**。
  - `delivery: 'caller'` 的语义是"子代理不进父会话的可见对话"——**这是产品语义，不是优化项**；宿主把它实现成默认归档进父会话，卡片就会污染主对话。
- 还需要 `service.list()` 返回 provider 名数组（拿不到就视为空）。
- 能力探测：`service.capabilities?.(provider)` 用于判断 `persona` / `toolFilter` 是否被支持；不支持时插件**如实上报** `toolFilter:'unsupported'` 而不是谎报 `'preset'`（`index.js:2004`）。

**事件契约**：

```js
ctx.on('agent/assistant-stream', payload => …)   // index.js:1587
ctx.on('session/event', (session, event) => …)   // index.js:1597（event.type === 'assistant/chunk'）
```

`[推断]` 插件用这两种事件把子代理的输出帧桥接到 SSE；宿主若不发这两类事件，`ask` 只会返回一个空流（不会 500）。做 Go 宿主时**先实现 `startActivation` + 一条能推 chunk 的事件通道**即可让生成链路活起来。

---

## §8 R7 · 工具白名单

`[源码]` `readOnlyToolFilter(ctx)`（`index.js:1337`）：

- `ctx.get('tools')`；无服务或 `typeof tools.schemas !== 'function'` → 返回 `undefined`（= 不限制，子代理继承全量工具）。
- `tools.schemas()` 抛错 → `undefined`。
- 交集为空 → `undefined`（**不能**返回空数组：`tools.restrict({allow: []})` 会让宿主直接拒绝启动）。
- 返回 `{allow: string[]}`，**每个名字都必须是注册表认识的名字**，否则 `restrict()` 会拒绝整次启动。

---

## §9 R8 · 文件系统与路径

`[源码]` `index.js:1296` 起：

- `configDir()` = `${$DSH_HOME || ~/.dsh}/sidecard-ask`；**`$DSH_HOME` 为空白算未设置**；绝不使用 `process.cwd()`。
- `configFilePath()` = 在 `$DSH_PROFILE` 匹配 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` 时用 `config.<profile>.json`，否则退回共享的 `config.json`（profile 非法值**不得**进入路径）。
- 写入：`mkdirSync(dir,{recursive:true,mode:0700})` → 写 `<path>.tmp`（`mode: 0600`）→ `renameSync` 原子替换 → 失败时删临时文件并返回 `{ok:false,error}`。
- 读取：文件不存在（`ENOENT`）按"未配置"处理；其它错误记 warn 并按未配置处理；损坏 JSON 同。

**宿主要求**：`rename` 必须同分区原子；权限位在 Windows 上是 no-op（插件已在注释里声明这一点，不是 bug）。

---

## §10 R9 · 出站 SMTP

`[源码]`：`net.connect`（明文 25 / STARTTLS 587 的裸连接）+ `tls.connect`（隐式 TLS 465，带 `servername` 与 `rejectUnauthorized`）。

`[声明]` 插件自带 SMTP 客户端在 **STARTTLS 协商阶段是明文**的（平台限制，已在 README/CHANGELOG 记为已知限制）。做 Go 宿主时可以直接忽略这一层——反馈功能是纯可选。

---

## §11 R10 · 前端契约

`[源码]` 客户端是**单文件 UMD-ish 模块**，不是 ESM：

```js
window.__ModuleLoader__.load({ id: 'dsh-sidecard-ask', factory(require) { const React = require('react'); … } })   // client.js:27
```

### 11.1 宿主必须提供的浏览器侧能力

| 能力 | 要求 |
|---|---|
| `/plugins/<pkg>/client.js?rev=<12 hex>` | 能被 `<script>` 加载；`[对照]` rev = `sha1(mtime,ctime,size)` 取前 12 位十六进制 |
| `window.__ModuleLoader__` | 提供 `.load({id, factory})`，并在 `factory` 内提供 `require('react')` |
| React | 需可 `createElement`；插件不依赖具体版本特性 |
| 具名槽位 | `slots.inject(name)/(register)`，见下表 |

### 11.2 槽位与回退顺序

`[源码]` `client.js:7360` 起，逐级回退（第一个存在的即用）：

| 用途 | 回退链 |
|---|---|
| 浮层 | `shell.overlay` → `conversation.input.dock` → `conversation.composer.dock` |
| 设置页 | `settings.section` → `settings.plugins.tab` |
| 会话 id 采集 | `conversation.input.right` → `conversation.input.left` → `conversation.composer.dock` → `conversation.input.dock` |
| 右栏卡片体 | `sidebar.right.pane.tab`（+ `.title`），key = `CARD_KIND` |

### 11.3 右栏 DOM 标记（无公开契约，靠实测）

`client.js:449` `RAIL_SELECTORS`：

```
[data-dsa-rail-host]                          // 插件自己的节点，最可靠
[data-sidebar-right-panel][data-sidebar-right-open] [data-dockkit-pane]
[data-sidebar-right-panel][data-sidebar-right-open]
[data-sidebar-right-session][data-sidebar-right-open]
[data-dockkit-pane] / [data-dockkit-column]
[data-slot^="sidebar.right"]
```

**注意**：折叠态面板会滑出视口，插件另有一次"矩形是否在屏内"的判定，所以宿主不能只靠 `data-*-open`。

### 11.4 右栏服务形状

`[源码]` + `[对照]` rc.5：

```js
sidebarRightTabs.register({ id, kind, title: () => string, guide: [{ id, order, title, description }] }) → disposer
sidebarRight.openTab(kind, { params })      // [对照] 记录里 contentId = pageAddress(kind) = `sidebar://<kind>`
sidebarRight.openTabs.getSnapshot() → [{ id, kind, contentId, title, sessionId? }]
sidebarRight.closeIn(sessionId, tabId)
```

`[对照]` 关键事实：**tab 记录只有 `{id, kind, contentId, title}`**，没有 `params`、没有 `meta`；插件的 `cardId` 只能靠适配器里的内存字段 + `contentId` 归属推导。第三方 tab body **拿不到 tab 对象**。

### 11.5 localStorage 键

`client.js:5905`：`dsh-sidecard-ask:cards:v3` / `:v2` / `:v1`（v3 起带 `writtenAt`，用于区分"我们写空过"与"从未写过"）。预算：单字段 65 536 字符、总 2 000 000 字符、最多 10 张卡。宿主若替换存储后端，必须保留 `storage` 事件的跨窗口通知语义。

---

## §12 验收清单（Go 宿主可直接照跑）

前置：宿主已加载插件，`BASE=http://127.0.0.1:<port>/sidecard-ask/api`。

| # | 动作 | 期望 |
|---|---|---|
| V1 | `curl -s $BASE/ping` | `{"ok":true,"value":{"version":"2.1.7","at":<ms>}}`，**无 Cookie 也应 200** |
| V2 | 未登录 `curl -s -X POST $BASE/config -d '{}'` | 401 + `error.code === "unauthorized"`（若你的宿主无会话体系，此条应 200——**这一条决定你是否真的有认证**） |
| V3 | `curl -s $BASE/nope` | 404 + `error.code === "not-found"`；`POST /ping` → 405 |
| V4 | 伪造 `Host: evil.com` 请求 | 403 `forbidden` |
| V5 | 带 `Origin: http://127.0.0.1:<other-port>` | 403（端口不同即不同源） |
| V6 | `POST $BASE/ask`（`range` 流） | 先收到响应头 `text/event-stream`，**首帧 < 1s 到达**，15s 内有 `: keep-alive`；客户端断开后宿主无残留定时器 |
| V7 | `POST $BASE/ask` 发 1.5 MiB body | 400 `too-large`，连接不挂死 |
| V8 | 浏览器打开右栏 | 插件 tab 出现在 guide 列表；打开后 `[data-dsa-rail-host]` 内出现卡片体；关 tab 后同 kind 的 tab 记录消失（`openTabs.getSnapshot()` 里不再有 `contentId === 'sidebar://<kind>'`） |

`[建议]` 把仓库里的 `test/harness.mjs`（假宿主）当作契约夹具的**参照实现**：它把本文档 §3–§8 的每一层都实现了一遍，一个 Go 宿主若能通过同样的断言序列，基本就对齐了。

---

## §13 反模式清单（踩了就中招）

1. **把 `res.write` 做成"攒着最后一起发"** → SSE 变成一次性快照，卡片空白到结束。
2. **`register` 不支持 `prefix` 却静默成功** → 所有方法名解析不到，全 404。
3. **`ctx.get()` 对未注册服务抛错** → 插件在探测阶段直接崩，而它预期的是 `undefined`。
4. **暴露了会话体系却没给 `connection` 服务** → 插件按"无认证"放行，等于敞开。
5. **`openTab` 的 `contentId` 不按 `sidebar://<kind>`** → 插件无法判断某 tab 是否属于自己，会去关别人的 tab（2.1.6 已修过一次这类 bug）。
6. **`tools.restrict({allow: []})` 返回成功但实际不做限制** → 只读承诺失效，用户以为安全实则全量工具。
7. **`$DSH_HOME` 为空串时当成有效路径** → 配置写到 cwd，出现"两份配置"。
8. **`engines.dsh` 比较漏 `includePrerelease`** → rc 版本被误判不满足，插件根本不加载。
9. **`Buffer.byteLength` 换成 `string.length`** → 中文响应体 `content-length` 偏小，连接被截断。
10. **`requestRejection` 返回对象表示拒绝** → 插件按契约只认 `401/403` 数字，其它一律 403；若你的"放行"用对象表示，会被当成拒绝。

---

## §14 最小可行宿主（如果真要写 Go 宿主）

`[推断]` 以下不是已验证方案，只是这份契约推出来的结论：

- **最省力的路**：Go 进程内嵌 `libnode`（CGO）跑本插件的 JS，Go 只负责 HTTP/文件/界面。这样 L1–L8 全部由 Node 承担，你要写的只是 L2 的 `(req,res)` 适配与 L9–L11。
- **纯 Go 的路**：必须自带 JS 引擎并支持 ESM（goja 不支持 ESM，需要先打包成 CJS 并注入 `node:` 垫片），且要自己实现 `Buffer`、`(req,res)` 双流、SSE flush。工作量≈重写宿主，插件本体 **0 行复用**。
- **无论哪条路**：先用 §12 的 V1–V8 当门禁，再谈界面。

---

*本文档由 `dsh-sidecard-ask` 2.1.7 源码反推，宿主侧参照实现为 DSH 0.2.1-rc.5（桌面端 AppImage 内 `app.asar` 解包的 `@deepseek-ai/dsh-*` 包）。凡标注 `[推断]` 的段落未经实测，不得当作契约引用。*
