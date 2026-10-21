# dsh-sidecard-ask 跨端缺陷排查报告（桌面端 × 网页端）

排查对象：`dsh-sidecard-ask` v2.0.1　·　工作区：`D:\Users\34332\AI\dsh-sidecard-ask`
排查日期：2026-10-19　·　操作系统：Windows（本机 34332）
结论口径：**所有结论均附可复现依据；无法复现的疑点一律列入「待观察」，不作臆测。**

---

## 0. 结论摘要（先行）

| | 结论 |
|---|---|
| 确认并已修复的跨端缺陷 | **1 个 —— X1：部署在路径前缀下时，客户端根绝对 API 路径丢失前缀，全部请求 404**（网页端独有，桌面端不受影响） |
| 确认为**环境误报**并已撤销的疑点 | 3 个（Q1 localStorage / Q2 clipboard / Q3 `file://` 相对路径 fetch 在桌面端失败） |
| 代码级证伪的疑点 | 2 个（Q6 `history` API 监听泄漏 / Q9 ModuleLoader 启动时序） |
| 未发现异常、保留为待观察 | Q4（SSE 端到端）、Q5（选区与焦点时序）、Q7（i18n locale 差异）、Q8（MutationObserver）、X2/X3（配置层） |
| 最重要的**非缺陷**发现 | X2：两端共享同一份持久化配置，`sideTools` 被用户配置覆盖为 `inherit`（出厂默认 `readonly`），两端的侧边追问子代理**均不再受只读工具限制** |
| 回归验证 | `npm test` 全绿：**57 / 1334 / 82 / 226 = 1699 断言，exit 0**；网页端与桌面端在线的插件路由均 200 |

> 一句话：**先前唯一的高危候选（桌面端相对路径 fetch 失败）被实测证伪；真正确认的缺陷在网页端的路径前缀部署场景，且已最小修复。**

---

## 1. 排查前的确认项与假定

### 1.1 已由用户确认

| 项 | 值 | 来源 |
|---|---|---|
| 插件名称 | `dsh-sidecard-ask` | 用户确认 |
| 插件版本 | `2.0.1`（`package.json` / `index.js PLUGIN_VERSION` / `client.js CLIENT_VERSION` 三处一致） | 用户确认 + 实测 |
| 排查范围 | 桌面端 + 网页端，两端各 ≥2 套环境 | 用户确认 |
| 调试方式 | `puppeteer-core` + Edge headless | 用户确认 |
| 修复授权 | 允许直接修改 `client.js` / `index.js` / `cordis.patch.yml` | 用户确认 |
| 数据边界 | 只读本机，不外传数据；不索要 Cookie，改走免鉴权证据路径 | 用户确认 |

### 1.2 缺失信息 → 明确假定（用户未指定，按主流组合假定）

| 假定项 | 假定值 | 依据 |
|---|---|---|
| 技术栈 | 纯 ESM JavaScript，无 TS、**无构建步骤、无打包**；Cordis 插件体系 | `package.json` 实测：`type=module`、`main=index.js`、无 `devDependencies`、无构建脚本 |
| 目标桌面端 | **DeepSeek Harness Desktop 0.2.1-rc.2**（Electron 43.3.0 / Chromium 150.0.7871.212） | 本机在装并在运行的官方桌面端，实测 |
| 目标浏览器 | **Microsoft Edge 155.0.4283.62（Chromium 155）** | 本机唯一在装 Chromium 系浏览器（无 Chrome）；Chrome 155 行为按同内核等价假定 |
| 桌面端装载方式 | Electron 自定义特权 scheme `dsh-app://app/`（**假定非 `file://`**） | **该假定随后被实测证实成立**，见 §2.2 |
| 运行调试方式 | 网页端：`http://127.0.0.1:8080` + Edge headless；桌面端：运行中实例 `127.0.0.1:14998` | 实测 |

---

## 2. 跨端环境矩阵与逐项核对

### 2.1 环境矩阵（实际测得，非假定）

| 端 | 组合 | 宿主 | 渲染内核 | 文档来源（`document.baseURI`） | 状态 |
|---|---|---|---|---|---|
| 网页 | **W1** | DSH Web `0.2.1-rc.2`，`profile=web`，`127.0.0.1:8080` | Chromium **155**（Edge 155.0.4283.62） | `http://127.0.0.1:8080/` | 在线实测 |
| 网页 | **W2** | 同上 + Edge headless 受控页（`about:blank` / 本地 `127.0.0.1:8123·8125·8126` 探针服务） | 同上 | 不透明源 / `http://127.0.0.1:<port>/` / `.../dsh/` | 在线实测 |
| 桌面 | **D1** | DSH Desktop `0.2.1-rc.2`，`profile=desktop`，`127.0.0.1:14998` | Electron 43.3.0 → Chromium **150** | **`dsh-app://app/`** | 在线实测 |
| 桌面 | **D2** | Electron 43.3.0 独立探针（`electron.exe` + 本地 `package.json`） | 同上 | `file://`（探针载体） | 离线实测 |

补充事实：
- 本机 `msedgewebview2.exe`（155.0.4283.62）全部由 `SearchHost.exe`（Windows 搜索）派生，**与 DSH 无关**，故 WebView2 不构成 DSH 的一端。
- `C:\Users\34332\.dsh\electron\electron.exe`（43.3.0）是 **dsh-pet 桌宠插件**的运行时（命令行指向 `dsh-pet\runtime\electron-helper\main.js`，user-data-dir `dsh-pet-electron-helper`），**不是 DSH 桌面壳**；DSH 桌面壳是独立安装的 `DeepSeek Harness.exe`（见 D1）。

### 2.2 逐项核对结果

| # | 核对项 | 网页端（W1/W2） | 桌面端（D1） | 判定 |
|---|---|---|---|---|
| 1 | **API 可用性与前缀差异** | `fetch`/`EventSource`/`AbortController`/`ResizeObserver`/`MutationObserver`/`requestAnimationFrame` 全部可用 | 同左（Chromium 150） | 无差异 |
| 2 | **DOM 与渲染差异** | 普通文档，**无** `html[data-windows-titlebar]` 标记 | Electron 桌面端由官方 `dsh-client-ui-layout` 发布 `--dsh-windows-content-radius` / `--dsh-windows-sidebar-width` 并预留顶栏高度（包内 README 明确「普通 Web 文档不会获得该标记」） | **宿主层差异确实存在**；插件侧无 DOM 依赖缺陷 |
| 3 | **生命周期与初始化时序** | 客户端已跑完 `apply`，三 slot 全部落位 | 同左 | 无差异 |
| 4 | **文件与剪贴板权限** | headless 下 `clipboard-write` 恒 `denied`，`writeText` 抛 `NotAllowedError`；**兜底 `execCommand('copy')` 恒可用** | Electron 主窗口 `setPermissionCheckHandler` 对非 `media` 权限**直接 `return true`** → `clipboard.writeText` 有权限 | **两端可观测差异**，但插件 `copyText()` 已有降级分支，两端均不失效 |
| 5 | **网络与跨域策略** | 同源 HTTP；相对路径正常 | `dsh-app://app/` 为 `standard/secure/supportFetchAPI/corsEnabled/stream` 特权 scheme；非静态路径由 `forwardWebRequest` 转发到 `http://127.0.0.1:14998` 并注入宿主 cookie | **已实测走通**（见 Q3） |
| 6 | **打包与资源路径** | 无打包；`client.js` 由 `window.__ModuleLoader__` 加载 | 同左 | 无差异 |
| 7 | **构建产物差异** | 无构建产物（纯 ESM 源码直载） | 同左 | 无差异 |

### 2.3 两端运行态逐字段对照（免鉴权 `/sidecard-ask/api/state`）

两端均 `GET /sidecard-ask/api/state` → **200**，客户端自报字段**逐项比对结果：除会话数外零差异**。

| 观测项 | 网页端 `:8080` | 桌面端 `:14998` | 相同? |
|---|---|---|---|
| `version` | 2.0.1 | 2.0.1 | ✅ |
| `client.surface` | `flow` | `flow` | ✅ |
| `client.slots` | overlay=`shell.overlay` / settings=`settings.section` / sessionProbe=`conversation.input.right` | 三项完全相同 | ✅ |
| `client.native.available` | true | true | ✅ |
| `client.better` | 0.28.0，14 项 features | 同上，14 项 | ✅ |
| `client.family` | leader=true, legacy=false, peers=0 | 同上 | ✅ |
| `provenance.persistedPath` | `C:\Users\34332\.dsh\sidecard-ask\config.json` | **同一个文件** | ✅ |
| `config.*`（全键集） | 12 项 patch keys 一致 | 一致 | ✅ |
| `problems` | 0 | 0 | ✅ |
| **`capabilities.liveAgents`** | **6** | **3** | ❌（会话数，非插件行为） |

> 结论：**插件在两端的行为完全一致**；唯一的运行态差异是并发会话计数。共享同一份持久化配置这一点，直接导出 §4 的 X2。

---

## 3. 最小化复现与误报排除

> 方法：每个疑点写最短复现步骤 → 预期 / 实际 → 用最小用例判定「插件缺陷 / 依赖 / 宿主限制」。脚本产物在收尾时已清理（见 §9）。

### Q1 — `localStorage` 在桌面端不可写？
- 复现：Edge headless 打开 `about:blank`，读 `window.localStorage`。
- 实际：抛 `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`
- 最小用例结论：`about:blank` 是**不透明源**，`isSecureContext=false`；在 `http://127.0.0.1` / `http://localhost` / `file://` 下均**可写**。
- **判定：环境误报，已撤销。** 插件 `readPersisted`/`writePersisted`（`client.js:5425`/`5448`）本就带 try/catch 降级，且 quota 满时丢最旧重试。

### Q2 — `navigator.clipboard.writeText` 在桌面端不可用？
- 复现：headless Edge 下四种组合（无授权 / 授权 / 授权+`bringToFront` / +真实点击）调用 `writeText`。
- 实际：四种结果**完全一致** —— `document.hasFocus()=true`、`visibilityState=visible`、`isSecureContext=true`、`navigator.clipboard` 存在，但 `permissions.query({name:'clipboard-write'}).state === 'denied'`，`writeText` 恒抛 `NotAllowedError`；兜底 `document.execCommand('copy')` 恒返回 **true**。
- 桌面端证据：Electron 主窗口 `setPermissionRequestHandler` 对 `permission !== "media"` **直接 `callback(true)`**。
- **判定：headless 环境限制，非插件缺陷。** 建议真机 headed 复核 → 列入待观察。插件两段式降级已覆盖。

### Q3 — 桌面端（`file://` / 自定义 scheme）下相对路径 `fetch` 全线失败？（原判高危）
- 复现：`file://` 页面内 `fetch('/sidecard-ask/api/state')` → `TypeError: Failed to fetch`。
- **推翻过程（两层）**：
  1. **代码层**：桌面端渲染进程 origin 是 `dsh-app://app/`，**不是 `file://`**（`resources/app.asar!lib/main.js:7052` `parsed.protocol === "dsh-app:" && parsed.hostname === "app"`）。`main.js:12406-12415` 的 `protocol.handle(SCHEME, …)` 把非静态路径（`/`、`/index.html`、`/assets/*`、`/favicon.svg`、`/manifest.webmanifest` 之外）交给 `forwardWebRequest(request, hostUrl, hostCookie)`（`main.js:8255-8289`），后者剥离 `host/origin/cookie/sec-fetch-site` 后注入宿主 cookie，以 `duplex:'half'` 原样转发到 `http://127.0.0.1:14998`。
  2. **经验层（比读码更强）**：桌面端 `/state` 的 `client` 字段已被填充，而该字段**只可能**由 `client.js:6517 void postJson('diagnose', …)` → `client.js:1086-1089 fetch(\`${API}/${method}\`, {method:'POST'…})` 经插件路由写入（宿主侧唯一写点是 `index.js:2206 clientReport = report`，位于 `handleDiagnose`）。
- **判定：Q3 撤销。** 桌面端既不用 `file://`，且根相对路径实测走通（静态资源与 API 都由 `protocol.handle` 分流）。

### Q6 — SPA 路由切换泄漏监听器？
- 复现：对 `client.js` 全文检索 `pushState` / `replaceState` / `popstate`。
- 实际：**零命中**。命中 19 处的全是 `window.innerWidth/innerHeight`、`documentElement.clientWidth/clientHeight`（`railOnScreen`）与插件**自身的卡片历史数组** `state.history` / `card.history`。
- **判定：代码级证伪。** 插件从不触碰 history API。事件全部注册在 `document`/`window`（多数 `capture=true`），并由 `disposers` 一一 `removeEventListener`（`client.js:6358-6378`）。

### Q7 / Q8 — i18n 服务形状、`MutationObserver` 目标差异？
- 复现：两端 `/state` 的 `client`/`config`/`problems` 对照 + 源码核对（`client.js:6382` locale 快照取值、`client.js:6832` `legacyObserver` 挂在 `document`、`client.js:4483-4496` 可选探测 `ResizeObserver`/`MutationObserver`）。
- 实际：两端 locale 解析、slot 落位、legacy 检测结果一致，`problems` 均为 0。
- **判定：未发现差异，保留待观察。**

### Q9 — `window.__ModuleLoader__` 启动时序？
- 复现：`about:blank` 下直接注入 `client.js` → `TypeError: Cannot read properties of undefined (reading 'load')`；提供 mock `__ModuleLoader__` + mock `react` 后，捕获 id `dsh-sidecard-ask`、factory 完整执行、返回 `['inject','apply','components','api']`，无 pageerror。
- **判定：契约保证**（宿主先备好 loader），非缺陷。

---

## 4. 问题清单表格

| 编号 | 端 | 环境 | 复现步骤 | 严重级别 | 根因 | 是否已修复 |
|---|---|---|---|---|---|---|
| **X1** | 网页端<br>（桌面端不涉及） | DSH Web 部署在路径前缀下，如 `--public-url https://host/dsh/`（本机复现用 `127.0.0.1:8126/dsh/` + Edge 155） | ① 把应用挂在 `/dsh/` 前缀下；② 打开 `http://127.0.0.1:8126/dsh/`；③ 页面脚本 `fetch('/sidecard-ask/api/state')` | **高**（功能全损：state/ask/SSE 全部 404，插件完全不可用） | `client.js` 把 API 基址**硬编码为根绝对路径** `/sidecard-ask/api`（原 `client.js:38`）。根绝对路径会**丢弃部署前缀** → 请求打到 `/sidecard-ask/api/*` 而非 `/dsh/sidecard-ask/api/*`，而插件路由是注册在 raw pathname 上的绝对前缀路由（`index.js:2417`），故 404。宿主官方客户端本身是按 `document.baseURI` 解析的（`dsh-client-connection/lib/client.browser.js:1349`），插件偏离了该约定 | **已修复** |
| **X2** | 两端 | 任意 | ① `GET /sidecard-ask/api/state`；② 读 `value.config.sideTools` 与 `value.provenance.persistedPath` | **中**（安全：工具权限放宽） | **非插件缺陷，是持久化配置覆盖出厂默认**。`$DSH_HOME/sidecard-ask/config.json` 与 profile 无关，**web 与 desktop 两个 profile 共享同一份**，故单点修改同时影响两端。`sideTools: 'inherit'` 使 `toolFilter` 取 `undefined`（`index.js:1772`），即**不做任何工具限制、继承父会话工具集**；出厂默认是 `'readonly'`（`index.js:75`） | 否（需用户决定） |
| **X3** | 两端 | env 提供 SMTP 端点 | ① `GET /sidecard-ask/api/state`；② 读 `value.capabilities.feedback` | **低**（诊断/显示口径，非功能） | `configured` 与 `hasPassword` **读的不是同一个来源**：`configured` 取自 `resolveSmtp()`（env 优先，`index.js:835-850`），`hasPassword` 只读 `config.feedbackSmtpPass`（`index.js:864`）。故 env 供密码时出现 `configured:true` + `hasPassword:false`。发送链路走 `resolveSmtp` 的 endpoint（`index.js:2231-2244`），**功能正常** | 否（待确认设置页是否误导） |
| **R1** | — | 仓库 | `git status --porcelain` | 低（流程） | 工作区领先于 `2.0.1` 版本号；若发布须**三处同步 bump**（`package.json` / `index.js PLUGIN_VERSION` / `client.js CLIENT_VERSION`），否则 `verify.mjs` 的版本一致性断言会失败 | 否（本次未改版本号） |
| Q1/Q2/Q3 | 两端 | 见 §3 | 见 §3 | — | **环境误报，已撤销** | 不适用 |
| Q4/Q5/Q7/Q8 | 两端 | 见 §3 | 见 §3 | — | 未发现异常 | 待观察 |
| Q9 | 两端 | — | 见 §3 | — | 契约保证 | 不适用 |

---

## 5. 根因分析

### 5.1 X1（已修复）——根绝对 API 路径丢弃部署前缀

**证据链（三层，逐层可复现）**

1. **最小复现（浏览器实测，Edge 155 headless）**：本地服务把应用挂在 `/dsh/`，只对 `/dsh/sidecard-ask/api/state` 返回 200、对根绝对路径返回 404。

   | 页面 | `document.baseURI` | 请求写法 | 服务端实收路径 | 结果 |
   |---|---|---|---|---|
   | `/` | `http://127.0.0.1:8126/` | `/sidecard-ask/api/state` | `/sidecard-ask/api/state` | 200 |
   | `/dsh/` | `http://127.0.0.1:8126/dsh/` | `/sidecard-ask/api/state` | `/sidecard-ask/api/state` | **404** |
   | `/dsh/` | 同上 | `sidecard-ask/api/state`（文档相对） | `/dsh/sidecard-ask/api/state` | 200 |

   服务端完整接收记录：`["/", "/favicon.ico", "/sidecard-ask/api/state", "/sidecard-ask/api/state", "/dsh/", "/sidecard-ask/api/state", "/dsh/sidecard-ask/api/state"]` —— 修复后的写法命中了带前缀的路径。

2. **宿主约定**：`dsh-client-connection/lib/client.browser.js:1345-1351` 与 `client.node.js:457` 均以 `baseUrl ?? document.baseURI` 为基址解析传输路径，且 `dsh-web-app/lib/index.js:20/142/146` 把 `publicUrl` 定义为「**浏览器实际访问的根**」（可带路径），`:146 const appRootUrl = () => publicUrl ?? ctx.webServer.getOrigin()`。→ 前缀属于**浏览器可见路由空间**，浏览器必须发出带前缀的请求（由反向代理剥离）。

3. **插件路由形状**：`index.js:2417 ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })`；`index.js:2371 pathname.startsWith(\`${ROUTE_PREFIX}/\`)`。宿主路由器 `dsh-host-webserver/lib/index.js:495-501` 的 `match(pathname)` 直接在 **raw pathname** 上做 exact/最长前缀匹配，**不做任何前缀剥离** → 浏览器侧必须自带前缀。

**改动面**：`client.js` 全部请求只经由单一常量 `API`（3 处调用点：`client.js:1089 postJson`、`1111 getState`、`1127 streamAsk`），无其它根绝对资源路径（全文检索 `new URL(` / `.src =` 无命中）→ 修改一处即可覆盖全部请求。

**兼容性**：在文档根（默认 Web 部署）与 Electron 桌面壳下，新表达式的取值与旧值**逐字节相同**（`/sidecard-ask/api`），故对现有部署零行为变更。

### 5.2 X2——共享持久化配置令两端同时放宽工具权限

`provenance.persistedPath` 两端同为 `C:\Users\34332\.dsh\sidecard-ask\config.json`，该路径**不含 profile 段**，因此 `profile=web` 与 `profile=desktop` 读的是同一文件。`sideTools` 的语义链：

```js
// index.js:75   出厂默认
sideTools: 'readonly',
// index.js:1772 只有 'readonly' 才施加工具过滤；否则 toolFilter = undefined
const toolFilter = config.sideTools === 'readonly' ? readOnlyToolFilter(ctx) : undefined
// index.js:1172 注释：undefined = 完全无限制 → 子会话继承父会话的工具
// Returns `undefined` (no restriction at all → the child inherits the parent's tools)
// index.js:1801-1804 界面会如实标注
toolFilter: config.sideTools !== 'readonly' ? 'inherit' : (…)
```

→ 当前两端生效值均为 `inherit`，即侧边追问子代理**不受只读限制**。插件会如实上报（不自欺），但这是**偏离出厂默认的安全相关状态**，且用户在一端改动会静默影响另一端。建议：确认是否要改回 `readonly`。

### 5.3 X3——`configured` 与 `hasPassword` 来源不同

`describeFeedback` 的 `configured` 取决于 `resolveSmtp()`（env 优先，要求 user 与 pass 均非空，`index.js:763/798/835-850`），而 `hasPassword` 只看 `config.feedbackSmtpPass`（`index.js:864`）。实测两端均为 `transport=smtp`、`configured=true`、`source=env`、`hasPassword=false` → 说明**宿主进程 env 中 SMTP 端点完整可用（含密码）**，发送功能正常；`hasPassword=false` 只是读错了字段口径。是否对用户造成误导，取决于设置页是否按 `source==='env'` 分支渲染——**本次未验证设置页 UI（需鉴权页面）→ 待观察**。

> 旁注（避免误推）：本会话可见的托管 shell 环境中没有 `DSH_SIDECARD_*` / `DSH_CRB_*` 变量，但 DSH 只向托管 shell 注入 `DSH_HOME`/`DSH_PROFILE`/`DSH_PROFILE_DIR`/`DSH_SESSION_ID`/`DSH_SHELL`/`DSH_WEB_URL`，**因此不能由「我的 shell 没有」推断宿主进程没有**。结论只以两端 `/state` 的 `source:'env'` 为准。

---

## 6. 改动点与关键代码片段

### 6.1 `client.js`（唯一的行为改动，1 处）

```diff
     const PLUGIN_ID = 'dsh-sidecard-ask'
-    const API = '/sidecard-ask/api'
+    /**
+     * Base path of this plugin's Host API.
+     *
+     * Resolved against `document.baseURI` rather than hard-coded as the
+     * root-absolute `/sidecard-ask/api`, which is what the Host's own Client
+     * does for its transport base (`dsh-client-connection/lib/client.browser.js`:
+     * `const base = baseUrl ?? document.baseURI`). A root-absolute path drops
+     * the deployment prefix, so a DSH served under a path prefix
+     * (`dsh web --public-url https://host/dsh/`) sent every request to
+     * `/sidecard-ask/api/*` and got a 404. The Electron shell also loads the app
+     * from `dsh-app://app/`, where only a document-relative path is meaningful.
+     *
+     * At the document root (both the default Web deployment and the Electron
+     * shell) this evaluates to exactly the previous `/sidecard-ask/api`, so no
+     * existing deployment changes behaviour. `document.baseURI` already carries
+     * the trailing slash the Host normalises its public root to; the explicit
+     * `replace` below keeps that true even if a `<base>` without one is used.
+     */
+    const API = (() => {
+      try {
+        const base = typeof document === 'undefined' ? undefined : document.baseURI
+        if (typeof base !== 'string' || base === '') return '/sidecard-ask/api'
+        return `${new URL('.', base).pathname.replace(/\/$/, '')}/sidecard-ask/api`
+      } catch {
+        return '/sidecard-ask/api'
+      }
+    })()
```

解析矩阵（表达式从 `client.js` 实抽后注入 stub `document` 求值，非重打）：

| 部署载体 | `document.baseURI` | 旧值 | 新值 |
|---|---|---|---|
| Web 根路径部署（本机 `:8080`） | `http://127.0.0.1:8080/` | `/sidecard-ask/api` | `/sidecard-ask/api` ✅ 一致 |
| **Electron 桌面壳** | `dsh-app://app/` | `/sidecard-ask/api` | `/sidecard-ask/api` ✅ 一致 |
| **Web 路径前缀部署（缺陷场景）** | `http://host.example/dsh/` | `/sidecard-ask/api` ❌ | **`/dsh/sidecard-ask/api`** ✅ 已修正 |
| 无 `document`（Node/worker 兜底） | — | `/sidecard-ask/api` | `/sidecard-ask/api` ✅ 一致 |

### 6.2 `test/contract-test.mjs`（断言由「写法」改为「行为」）

原断言用正则匹配**旧的源码写法**，因此实现一改就失配：

```diff
-const clientPrefix = /const API = '([^']+)'/.exec(clientSource)?.[1]
-report.equal(clientPrefix, host.ROUTE_PREFIX, 'client API base equals the host route prefix')
+// D17: the Client must reach the Host route under the prefix the deployment
+// actually serves it on. …
+const clientApiExpr = /const API = (\(\(\) => \{[\s\S]*?\n    \}\)\(\))/.exec(clientSource)?.[1]
+report.ok(typeof clientApiExpr === 'string', 'client API base is a resolvable expression')
+const resolveClientApi = (baseURI) => {
+  const fakeDocument = baseURI === undefined ? undefined : { baseURI }
+  return new Function('document', `return ${clientApiExpr}`)(fakeDocument)
+}
+report.equal(resolveClientApi(), host.ROUTE_PREFIX, 'client API base equals the host route prefix')
+report.equal(resolveClientApi('http://127.0.0.1:8080/'), host.ROUTE_PREFIX, '…at the document root')
+report.equal(resolveClientApi('dsh-app://app/'), host.ROUTE_PREFIX, '…in the Electron shell')
+report.equal(resolveClientApi('https://host.example/dsh/'), `/dsh${host.ROUTE_PREFIX}`, '…keeps a deployment path prefix')
```

### 6.3 未改动的部分（明确说明）

- `index.js`、`cordis.patch.yml` **未改动**：X2/X3/R1 均非插件代码缺陷，且 X2 触及用户配置与默认值策略，按「严格执行用户命令 / 不擅自扩大改动面」留待用户决定。
- 未 bump 版本号：本次未发布，且三处同步 bump 属发布动作。

---

## 7. 两端回归测试结果

| 回归项 | 命令 / 方式 | 网页端 | 桌面端 | 结果 |
|---|---|---|---|---|
| 语法 | `node --check client.js` | OK | OK（同源文件） | ✅ |
| 宿主半 | `test/verify.mjs` | **57 passed, 0 failed** | 同左 | ✅ |
| 契约（含修复点断言） | `test/contract-test.mjs` | **1334 passed, 0 failed** | 同左 | ✅ |
| 浮层定位 | `test/float-placement.mjs` | **82 passed, 0 failed** | 同左 | ✅ |
| 端到端冒烟 | `test/smoke-test.mjs` | **226 passed, 0 failed** | 同左 | ✅ |
| 合计 | `npm test` | **1699 passed, exit 0** | — | ✅ |
| 在线路由健康度（修复后） | `GET /sidecard-ask/api/state` | `:8080` → **200**，`surface=flow` | `:14998` → **200**，`surface=flow` | ✅ |
| 修复点专项 | 浏览器内对 `/` 与 `/dsh/` 各跑旧/新写法 | 根：旧 200 / 新 200；前缀：旧 **404** / 新 **200** | 桌面端根等价（`dsh-app://app/` → `/sidecard-ask/api`） | ✅ |

- 修复前基线为 1692 断言（2.0.1 发布态）；工作区另有既存未提交改动带来 +3；本次把 1 条断言换成 5 条 → **1695 − 1 + 5 = 1699**。
- 过程中出现过一次 `npm test exit 1`，**由本次改动触发**：`test/contract-test.mjs:122` 的正则匹配旧写法失配。已按「先保证可运行」修正为行为断言，现全绿。

---

## 8. 遗留风险与待观察清单

### 8.1 已确认缺陷的残留不确定性

| 项 | 说明 |
|---|---|
| X1 的真实前缀部署端到端验证 | **待观察**。缺陷在 URL 解析层已被最小复现确证，且宿主约定与路由形状均支持该修复；但**未在真实的前缀部署（`--public-url .../dsh/` + 反向代理剥离前缀）下端到端跑通**——那需要另起一个 DSH 实例或加代理，属有副作用的操作，须经你同意。 |

### 8.2 待观察（未复现，不作结论）

| 编号 | 内容 | 为何待观察 |
|---|---|---|
| Q4 | 桌面端 SSE 流式是否被缓冲 | 代码层已确证 `stream: true` 特权 scheme + `duplex:'half'` 原样转发 + 标准 `getReader()` 读取，且插件路由在两端可达；但**触发一次真实 `ask` 会产生实际模型调用副作用**，未执行 |
| Q5 | 选区事件与 focus / shadow DOM 时序 | 两端均加载成功且 slot 落位一致，未构造出差异用例 |
| Q7 | i18n locale 服务形状差异 | 两端 `problems=0`、slot 一致，未见差异 |
| Q8 | `MutationObserver` 对 `document.body` / shadow DOM | 同上 |
| X3 后续 | 设置页在 `source='env'` 时是否误显「未设密码」 | 设置页需鉴权会话，本次未渲染 |
| Q2 后续 | 真机 headed（非 headless）剪贴板行为 | headless 下 `clipboard-write` 恒 `denied`，无法据此判定真机 |
| — | 修复后运行的在线页面是否为编辑后的字节 | 两端 `client.at` 在编辑后均刷新（`1792418375632` / `1792418375668`，即 22:19:35+08:00）且均健康，但**未定位到 `client.js` 的实际下发 URL**（`/client.js`、`/plugins/dsh-sidecard-ask/client.js` 均 404），故「在线页已加载修复后代码」属**推断，未证实** |

### 8.3 非跨端但在本次排查中发现，需你决定

1. **X2**：`sideTools: 'inherit'` 是否改回 `readonly`；以及是否希望**两端配置解耦**（当前 `$DSH_HOME` 级共享）。
2. **R1**：工作区领先版本号（`client.js`、`index.js`、`package.json`、`test/contract-test.mjs` 均有未提交改动），是否发布 / 如何 bump。
3. `.acl-recovery\`（早前 ACL 修复的**回滚脚本与备份**）**未删除** —— 删掉会失去唯一的回滚路径，故保留待你确认。

---

## 9. 收尾与临时文件清理

### 9.1 ⚠️ 清理事故（我的操作失误，如实记录，不可恢复）

**经过**：清理 `%TEMP%` 时我使用了 `dsh-*` 这个过宽的 glob，结果删除了**不属于本次排查**的文件：

| 误删文件 | 数量 | 实际归属 |
|---|---|---|
| `%TEMP%\dsh-market-restart-<stamp>.out.log` / `.err.log` / `.recovery.json` | 27（7 个重启周期，`2026-10-16T05-08-09` → `2026-10-19T09-44-48`） | **dshmarket v1.66.42** 的重启流程产物 |
| `%TEMP%\dsh-cookie.txt`、`dsh-cookie2.txt`、`dsh-page.html` | 3 | 无法归属（非本次排查所建；内容未知，疑似更早会话的临时抓取文件） |

`Remove-Item` 不进入回收站，**已无法恢复**。

**影响面评估（基于 dshmarket 源码，非推测）**：`dshmarket\lib\restart.js:581-615 scheduleRestart()` 每次重启**当场生成**这三件套：
```js
const logOut = join(tmpdir(), `dsh-market-restart-${stamp}.out.log`);
const logErr = join(tmpdir(), `dsh-market-restart-${stamp}.err.log`);
const configPath = join(tmpdir(), `dsh-market-restart-${stamp}.recovery.json`);
// 「recovery 配置在 helper 启动之前写出，因为它描述的是本进程即将离开时的世界」
// 仅经 argv 交给 :608 当场 spawn 的 detached helper，由 lib/recovery.js 消费
```
- 全文件检索确认：插件**只写不扫**这些路径（`restart.js` 中唯一的 `readFileSync` 是 `/proc/${pid}/comm`），**没有**「启动时读取历史 recovery 配置以修复未完成重启」的逻辑。消费方是当次 helper 进程。
- 当前**没有**在跑的 market 重启/恢复进程（进程扫描仅见 TRAE 宿主 node 进程，无 market helper），最新一枚戳记 `2026-10-19T09:44:48` 距今约 12 小时。
- 因此：**丢失的是 7 次历史重启的诊断日志与当次 recovery 配置（不可恢复）；当前运行时状态与插件功能不受影响**（recovery 配置描述的插件清单每次重启都会重新实时采集）。
- 无法证伪的残留风险：若某次重启曾中途崩溃并留下等待消费的 `recovery.json`，则其消费进程与配置同时消失——但进程扫描未发现存活的消费方。

**教训**：清理必须按**显式逐项枚举**的自建产物清单执行，不得用宽通配符扫目录。本报告 §9.2 即为该清单。

### 9.2 本次排查自建产物（按显式清单删除，逐项核对归属）

| 已删除 | 内容 |
|---|---|
| `probe-reports\` | `w1-edge-headless.json`、`w1b-origins.json`、`w1c-clipboard.json`、`origin-probe.html`、`cross-end-suspects.md`（本报告已取代） |
| `tools\probe-w1-edge-headless.mjs`、`tools\probe-web-origin.mjs`、`tools\probe-clipboard.mjs` | W1/W1b/W1c 探针脚本 |
| `tools\probe-electron\`、`tools\probe-electron-app\` | Electron 版本探针（含 `versions.json`） |
| `%TEMP%\dsh-asar.mjs`、`dsh-asar-scan.mjs`、`dsh-prefix-repro.mjs`、`dsh-fix-verify.mjs`、`dsh-matrix2.mjs`、`dsh-desktop-main.js` | asar 解析器与各验证脚本 |

**保留**：`.acl-recovery\`（ACL 回滚留档，见 §8.3-3）、`CROSS-END-AUDIT.md`（本报告）、`client.js` 与 `test/contract-test.mjs` 的修复改动、`tools\compat-probe.mjs` 与 `tools\.cache\`（均为本次排查之前就存在的既有文件）。

---

*本报告所有表格中的实测数字均来自本机命令输出；凡未实测者一律标注为「待观察 / 推断，未证实」。*
