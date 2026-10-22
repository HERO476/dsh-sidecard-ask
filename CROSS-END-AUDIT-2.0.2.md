# dsh-sidecard-ask 跨端适配与流畅性核查（2.0.2）

核查日期：2026-10-22 08:40–09:00（GMT+8）　·　对象：`dsh-sidecard-ask` **2.0.2**（`package.json` / `index.js PLUGIN_VERSION` / `client.js CLIENT_VERSION` 三处一致）
口径：**实测数字与静态取证分开标注**。凡未取得运行时证据的一律写「未验证」，不据推测下结论。

---

## 0. 结论摘要

| 维度 | 网页端（DSH Web 0.2.1-rc.2） | 桌面端（DSH Desktop 0.2.0-rc.2 / Electron 43.3.0） |
|---|---|---|
| 宿主半是否加载 | **是**（插件路由返回自有 JSON 401，可与其他 404 区分） | **是**（同一判据，逐字节相同） |
| 客户端半落位 | 未验证（需登录态） | 未验证（同左） |
| 主要适配风险 | 部署前缀（已修，仅剩「无尾斜杠」边界） | 宿主版本比网页端**低一档**（0.2.0 vs 0.2.1） |
| 启动成本（插件自身） | 宿主半 6.7–9.9 ms + 客户端解析求值 5.7–11.5 ms | 宿主半 9.6–9.9 ms + 客户端 0.9–5.2 ms |
| 流式渲染成本 | 每帧 0.2–0.3 ms（8k 答案）/ 1.4–2.0 ms（64k 答案） | 0.2–0.3 ms / 1.2–1.8 ms |
| 回归 | `verify 57 + contract 1377 + float 82 + smoke 262 = 1778`，0 failed | 同源代码，同结果 |

**一句话**：两端都能跑、插件自身的 CPU 开销都在「可忽略」量级；真正的差异不在插件代码，而在**宿主形态**（自定义 scheme/权限/版本落差）与**观测手段**（2.0.2 的鉴权门让免登录取证失效，README 的 curl 自测配方已过期）。

---

## 1. 取证条件（先说限制）

| 项 | 事实 |
|---|---|
| 登录态 | **两端都拿不到**。网页端 `/` 返回宿主登录门 `401 text/plain`（68 B）；桌面端同。2.0.2 起插件 API 也走同一道门 → 无法读取 `/state` 的 `client` / `config` / `capabilities` |
| 因此能做的 | ① 路由层判别（插件在线与否）；② 两端运行时**自身**的进程/端口/版本事实；③ 用插件自带的 `api.pure` 测试缝在真实内核里量纯函数成本；④ asar 静态取证（外壳行为）；⑤ 全量回归 |
| 因此不能做的 | 槽位落位、SSE 端到端、真实观感、桌面窗口内的点击行为 —— 全部标注「未验证」 |
| 桌面端是否在运行 | 核查开始时**未运行**；08:40:47 由本次核查启动（`DeepSeek Harness.exe`），宿主起在 **19387**（不是历史记录里的 14998），插件路由在线；约 10 分钟后进程集消失，`Application` 日志**无**对应崩溃记录（同时段两条 `0x80000003` 属我自己的 Electron 基准进程），退出原因未取证 |

> 与 2.0.2 CHANGELOG 的一处出入：CHANGELOG 写「桌面端在本机冷启动即崩（6 秒内退出）」。**今天未能复现**——本次冷启动成功并对外服务。该结论需要按安装包/启动方式重新取证，不能继续当成既定事实。

---

## 2. 环境矩阵（实测）

| | 网页端 | 桌面端 |
|---|---|---|
| 宿主版本 | `dsh 0.2.1-rc.2`（TRAE 内置：`.../vm/tools/node/node_modules/@deepseek-ai/dsh`） | `@deepseek-ai/dsh-desktop 0.2.0-rc.2`，包内 `dsh` 亦为 `0.2.0-rc.2`（asar `dsh/package.json`） |
| 宿主运行时 | Node **22.23.2** | Node **24.18.1**（Electron-as-Node，`resources/runtime/versions.json`） |
| 渲染内核 | 取决于访问者浏览器；本机对照内核 **Chromium 155**（Edge headless） | **Chromium 150.0.7871.212**（Electron **43.3.0**，`~/.dsh/electron/version` = 43.3.0） |
| 文档源 | `http://127.0.0.1:8080/` | `dsh-app://app/`（主进程 `applicationFrame()`：`protocol === "dsh-app:" && hostname === "app"`） |
| 监听端口 | 8080（pid 8576，510 MB / 455 s CPU，07:13 启动） | **19387**（宿主进程 406 MB；主进程 152 MB；渲染 194 MB；GPU 126 MB；网络 58 MB ≈ 936 MB 合计） |
| 插件路由 | `GET /sidecard-ask/api/state` → **401 `application/json` 110 B** | 同左，逐字节相同 |

**路由归属判别（关键证据）**：`/sidecard-ask/api/state` 的 401 是**插件自己写的 JSON**（`{"ok":false,"error":{"code":"unauthorized","message":"需要先通过 DSH 登录（宿主会话未认证）"}}`），而宿主自身 `/api/state` 的 401 是 **12 B 纯文本 `unauthorized`**、未知前缀 `/zzz-not-a-plugin/api/state` 是 **404 空体**。三者在两端表现完全一致 ⇒ **两端插件宿主半都在线，且 2.0.2 的鉴权门在两端都生效**。

---

## 3. 兼容性逐项核对

### 3.1 共性（两端一致）

| 项 | 事实 | 判定 |
|---|---|---|
| 客户端形态 | `window.__ModuleLoader__.load()` + `require('react')`，纯 ESM 无构建 | 仓库同一份源码（2.0.2）；两端实际下发副本是否逐字节一致未能比对（无登录态） |
| 依赖的槽位 | `shell.overlay` / `settings.section` / `conversation.input.right`，各自带阶梯回退 + 1500 ms 探测 | 有降级，未见差异 |
| 宿主服务 | `connection`（鉴权）、`locale`（可选）、`sessions`（主对话承载）、`inputActions`（写回） | 全部 `ctx.get()` 软取，缺失即降级 |
| 线协议 | `fetch` + `body.getReader()` 手写 SSE（**不用 EventSource**） | 关键：自定义 scheme 下 EventSource 不可靠，此处规避正确 |
| 回归 | 1778 断言 0 failed | ✅ |

### 3.2 桌面端特有（已由外壳代码佐证）

| 项 | 外壳事实 | 插件侧 | 判定 |
|---|---|---|---|
| 自定义 scheme | `registerSchemesAsPrivileged`：`standard/secure/supportFetchAPI/corsEnabled/stream/codeCache` 全为 true | 依赖 `fetch`+流式读取 | ✅ 满足 |
| 请求转发 | `forwardWebRequest`：仅放行 `origin === "dsh-app://app"`；删除 `host/origin/cookie/sec-fetch-site` 后注入宿主 cookie，`duplex:"half"` 原样转发 | 需要 cookie 过 2.0.2 鉴权门 | ⚠️ **结构上成立**：转发会注入宿主 cookie，且 `requestRejection` 在 0.2.0-rc.2 中存在（asar 命中 8 行）；但「带 cookie 的转发请求确实被放行」**未做端到端实测** |
| 鉴权门兼容 | 转发后 `origin` 头被删 | `isTrustedRequest` 对 `origin === undefined` 返回 **true**（`index.js:1355`） | ✅ 不会被误判 403 |
| 窗口拖拽区 | 外壳 CSS 有 12 处 `app-region` | 11 个自有根节点统一 `-webkit-app-region:no-drag`（`client.js:2262`） | ✅ |
| 剪贴板权限 | 主窗口 `setPermissionRequestHandler`：`permission !== "media"` 直接 `true` | `writeText` → 失败则 `selectNodeContents` 兜底 | ✅（真机未点验证） |
| 通知 | 主窗口非 media 权限放行，但**全包无 `setAppUserModelId`（0 命中）** | `new window.Notification(...)`，默认 `notifyOnDone:false` | ⚠️ Windows toast 可能不显示 |
| 下载 | 主窗口走 `defaultSession`，无 `will-download` 拦截（拦截只出现在登录窗与侧栏 webview） | 游离 `<a download>` | ✅（本版未复测，README §14-9 亦如此标注） |
| 菜单加速键 | 全包 `Alt+Q` **0 命中** | 默认快捷键 `Alt+Q` | ✅ 外壳不抢（输入法/他程序仍可能抢） |
| 插件产物缓存 | `/plugins/*` 响应被改写为 `cache-control: no-store`（宿主按每次启动的 revision 标 immutable，壳为避免陈旧缓存而禁存） | 349 KB 每次刷新重下（localhost，传输≈0） | ⚠️ 仅影响冷启动解析 |
| DevTools 附加 | 无 `remote-debugging-port` | — | 无法在线 profile 桌面端 |

### 3.3 网页端特有

| 项 | 事实 | 判定 |
|---|---|---|
| 部署前缀 | `API` 由 `document.baseURI` 推导（`client.js:56-64`）；`http://127.0.0.1:8080/`、`https://host/dsh/`、`dsh-app://app/` 均解析正确 | ✅ |
| **前缀无尾斜杠** | `https://host/dsh` → `/sidecard-ask/api`（**丢前缀**）；`new URL('.', base)` 把 `dsh` 当文件名 | ⚠️ 见 D3 |
| 鉴权 | 宿主登录门 + 插件门双层；页面内 `fetch` 同源自带 cookie | ✅ |
| 存储 | `localStorage` 在 `http(s)` 正常；`quota` 满时有折半丢弃重试 | ✅ |
| 渲染内核 | 随访问者浏览器浮动（本机 155；不保证 150 以下） | ℹ️ 无版本探测 |

---

## 4. 性能实测

### 4.1 插件自身启动成本

| 指标 | 网页端运行时（Node 22.23.2） | 桌面端运行时（Node 24.18.1） |
|---|---|---|
| 宿主半 `import index.js`（122 KB） | 6.73 / 7.75 / 9.89 ms | 9.58 / 9.62 / 9.91 ms |
| 宿主半 `apply()`（注册路由/配置） | 1.04 / 1.12 / 1.87 ms | 0.85 / 0.85 / 1.04 ms |
| 宿主半堆占用 | 6.1 MB | 4.5 MB |

### 4.2 客户端半（真实 `client.js`，Chromium 内核，`api.pure` 测试缝）

| 指标 | Chromium **155**（Edge headless） | Chromium **150**（Electron 43.3.0 离屏） |
|---|---|---|
| 解析 + 求值（冷） | **11.5 ms** | **5.2 ms** |
| 解析 + 求值（热，同一页面重载） | 5.7 / 7.2 ms | 0.9 / 2.2 ms |
| 工厂执行（`factory()`） | 1.4 / 0.2 / 0.3 ms | 3.8 / 0.2 / 0.2 ms |
| `renderRichText` 2 000 字符 | 0.1–0.3 ms | 0.1 ms |
| 8 000 字符 | 0.2–0.3 ms | 0.2–0.3 ms |
| 24 000 字符 | 0.6–0.7 ms | 0.5–0.9 ms |
| 64 000 字符 | 1.4–2.0 ms | 1.2–1.8 ms |
| `JSON.stringify`（37.5 KB 卡片） | 0–0.1 ms | 0.1 ms |

> 注：冷/热差异来自 V8 code cache（桌面壳 `codeCache:true`、Edge 侧 `file://`），**不是内核优劣**；两端的绝对量级都在「一帧预算（16.7 ms）以内」。

### 4.3 常驻开销（代码事实）

| 项 | 事实 | 判读 |
|---|---|---|
| 客户端定时器 | **0 个 `setInterval`**；仅在事件发生时挂 `setTimeout`（选区防抖 120 ms、流式刷新 50 ms、toast 2.6 s） | 空闲不耗 CPU |
| 观察器 | ① 面板测量 `ResizeObserver`（仅卡片打开时）② `document.body` 属性观察器（同上）③ 旧版探测 `MutationObserver`：**6 s 后自动 `disconnect()`**（`client.js:6966`） | 设计正确，但见 P2 |
| 文档级监听 | 8 个：`selectionchange` / `pointerup` / `keyup` / `mousedown` / `contextmenu` / `keydown` / `scroll` / `resize`（后 7 个走捕获阶段） | 都是「调度一次防抖」，本身极便宜 |
| 宿主 SSE | 每事件一次 `res.write`，15 s 心跳，`heartbeat.unref()`，`x-accel-buffering: no` | 无额外缓冲层 |
| 并发 | `maxConcurrentAsks` 默认 3（1–12），**宿主侧强校验**（`index.js:1809`，超限回 `busy`），客户端同名字段只用于提示 | 双层一致 |
| 体积 | `client.js` 356 823 B（gzip **96 998 B**），其中内联 CSS **26 333 B / 147 个规则块**；`index.js` 122 271 B | 见优化 4 |

---

## 5. 差异与问题清单

严重度：🔴 功能受损 / 🟠 明显体验或可维护性问题 / 🟡 边界或口径问题

| 编号 | 端 | 问题 | 证据 | 严重度 | 建议 |
|---|---|---|---|---|---|
| **D1** | 桌面 | 宿主版本比网页端**低一档**：桌面 `0.2.0-rc.2` vs 网页 `0.2.1-rc.2` | asar `package.json` + `dsh/package.json`；`DeepSeek Harness.exe` 的 FileVersion 亦为 `0.2.0-rc.2` | 🟠 | 适配矩阵按「桌面 0.2.0-rc.2 / 网页 0.2.1-rc.2」双列；设置页自检显示宿主版本，落后时给出提示 |
| **D2** | 两端 | **README §10.1 自测配方已失效**：`Invoke-WebRequest .../state` 现在恒 401（2.0.2 加的鉴权门） | 实测 401 JSON；文档仍在教免鉴权调用 | 🟠 | 文档改为「页面内自检」或「带 cookie/从宿主取会话」；或提供只读 `/ping`（见优化 6） |
| **D3** | 网页 | 部署前缀**无尾斜杠**时丢前缀：`https://host/dsh` → `/sidecard-ask/api` | 用文件里的表达式求值（`new URL('.', base)` 把 `dsh` 当文件名） | 🟡 | 解析出 `api` 后做一次探活；失败回退「根绝对 + 前缀猜测」双试；或由宿主注入 `window.__SIDECARD_API__` |
| **D4** | 桌面 | 通知可能不显示：外壳未调 `setAppUserModelId` | asar 全包 `setAppUserModelId` **0 命中**；`will-download`/`setPermission*` 均命中 | 🟡 | 保持 `notifyOnDone` 默认关；开启时在桌面端把「卡片标题角标 + 完成时间」当作兜底提示，并在设置页注明 |
| **D5** | 两端 | **外部健康检查能力消失**：`/state`、`/diagnose` 均需宿主会话 cookie，脚本/CI 无法探活 | 实测 401；`/zzz...` 404 作为对照 | 🟠 | 加一个「仅回环 + 免鉴权 + 只回 `{version, at}`」的 `/sidecard-ask/api/ping`；不放配置、不放会话信息 |
| **P1** | 两端 | **整店订阅 + 零记忆化**：`useStoreState()` 订阅整个 store，全包 `React.memo` **0 处**、`useCallback` **0 处**；每次 `store.set` 全树重渲染 | `client.js:1320-1324`；`grep React.memo` = 0 | 🟠 | 见优化 1 |
| **P2** | 两端 | 面板测量观察器把 **`class` / `style`** 放进 `attributeFilter`（`client.js:4575`）→ 聊天区任何 class/style 变更都触发一次 rAF 内的 `getBoundingClientRect` ×2 + `querySelector` 遍历（强制布局） | `client.js:4569-4578`、`4485-4548` | 🟠 | 见优化 2 |
| **P3** | 两端 | 活动卡片**无上限**：`store.set({ cards: [card, ...store.state.cards] })`，只有「持久化」侧有 0–50 卡上限 | `client.js:5753/5882/5908`；无 `MAX_OPEN` 类常量 | 🟡 | 超过 N（如 20）自动折叠最旧；或把非可见卡片卸载正文（只留标题） |
| **P4** | 两端 | 冷启动会**回放历史卡片**并在 `flow` 面全部 `open:true`；仅受 `historyMaxCards`(默认 10) 与单字段 64 KB 限制，回放侧没有总量预算（写入侧才有 2 M 预算） | `client.js:5633-5680`、`5480`/`5491` | 🟡 | 回放只渲染折叠态，展开时再解析；或回放总量预算（如 200 K 字符） |
| **P5** | 两端 | 一次 flush 可能产生**两次** `store.set`（正文一次、思考一次）→ 3 路并发时理论上 6 次/50 ms = **120 次全树渲染/秒** | `client.js:6259-6269`、`1429-1439` | 🟠 | 见优化 3 |

---

## 6. 优化建议（按投入产出排序）

**1）把「整店重渲染」改成「按卡片重渲染」（收益最大，改动中等）**
- `AnswerCard` 用 `React.memo` 包一层：props 里 `actions` 是 `apply()` 里建好的稳定对象（`client.js:5728`），但 `FloatingLayer` 传的是**每次渲染新建的箭头函数**（`4632-4645`）→ 需要改成「把 `actions` + `card` 传进去，由子组件自己调 `actions.copy(card)`」，或把回调做成 `useCallback`。
- `useStoreState()` 换成 `useSyncExternalStore` + selector（按 `cards.find(id)` 或 revision 分片），让一次 delta 只唤醒对应卡片。
- 预期：流式时重渲染从 O(卡片数) 降到 O(1)。实测可量化的是「解析」部分（64 K 答案 1.4–2.0 ms/帧 × 20 Hz ≈ 3–4% 单核）；React 协调部分本次**没有** profile 数据，但空闲卡片的重渲染是完全可省的。

**2）收窄面板测量观察器（改动极小）**
- `attributeFilter` 去掉 `'class'` 与 `'style'`，只留 `data-sidebar-right-open` / `data-dockkit-pane-active`；再补一个 120 ms 防抖兜底。
- 理由：真正需要重测的只有「右栏开/关/换窗格」，class/style 变更与几何无关，却在繁忙页面上制造大量强制布局。

**3）一次 flush 只提交一次状态（改动小）**
- `flushStreamBuffers` 里把 `appendCardText` / `appendCardReasoning` 合成的结果一次性 `store.set`（一个 `cards` 数组补丁），而不是两次。
- 并把 50 ms 固定节流改为「文本 > 32 K 时退避到 80–100 ms」或 rAF 合并。预期：极端场景渲染次数减半。

**4）瘦身首屏载荷（改动小、收益稳定）**
- 内联 CSS 26 KB 拆成独立 `.css` 由宿主静态伺服（当前每次页面加载都随 JS 解析一遍）；
- 词典按语言懒加载（现在中英双字典都在同一个 349 KB 文件里）；
- 目标：`client.js` 降至 ~250 KB（gzip 约 70 KB），冷启动解析相应下降（**估算，未实测**）。
- 注意：拆文件会改变「单文件零构建」的形态，需同步 `test/verify.mjs` 的产物断言。

**5）给活动卡片加上限，并让回放走折叠态（改动小）**
- 活动卡 > 20 张时自动折叠最旧（保留数据、卸载正文）；`restorePersisted` 回放时 `open:false`，点开再渲染。
- 直接缓解长会话的内存与 DOM 增长（当前只有持久化侧有上限）。

**6）补一个只读探活端点 `/sidecard-ask/api/ping`（改动极小）**
- 仅回环 + 免鉴权，返回 `{ok:true, value:{version, at}}`；不碰配置、不碰会话、不 spawn。
- 解决 D5/D2：CI、监控、以及 README 的自测配方都能恢复，而不会重新打开「无 cookie 就能 spawn 子代理」的口子。

**7）文档与矩阵对齐（零风险）**
- 适配矩阵按 D1 分列两端宿主版本；
- README §10.1 换成「页面内自检 / 带会话」；
- 把「桌面端冷启动即崩」改成「与安装包相关，需按版本复验」（本次已不再复现）。

---

## 7. 未验证清单（本次没做到，别当成没问题）

| 项 | 为什么 |
|---|---|
| 两端槽位真实落位（`shell.overlay` 等） | 需登录后看设置页「运行自检」或读 `/state` 的 `client.slots` |
| SSE 端到端（`start→reasoning→delta→done`） | 需一次真实模型调用（有副作用） |
| 桌面窗口内的点击/拖拽/观感 | 无 GUI 自动化；DevTools 端口未开 |
| 桌面端 `/plugins/*` 是否 gzip | 无 cookie 无法取响应头 |
| 前端真实帧率 / 长任务 | 无法对真实页面做 trace（同上） |
| 网页端在 Chromium <150 的表现 | 本机只有 Edge 155 |

---

## 8. 取证与清理

- 实测脚本临时放在 `%TEMP%\dsa-audit\`（`bench.html` / `run-edge.mjs` / `ebench/` / `host-boot.mjs`），核查结束已删除。
- 核查阶段未改动仓库任何源文件、未 bump 版本号、未安装/卸载任何东西（修复落地见 §9，那是随后的一次独立改动）。
- 为取证启动过一次桌面端（08:40:47），现已退出；未修改其配置。

---

## 9. 修复落地（2026-10-22，v2.1.0）

本报告的 D/P 清单已在 **2.1.0** 落地，除三项明确不做（见 §9.2）。回归：`verify 57 + contract 1408 +
float-placement 83 + smoke 271 = 1819`，0 failed；另在 Edge（Chromium 155）真实内核里加载过 2.1.0 的
`client.js`：解析+求值 **10.4 ms**（2.0.2 同条件 11.5 ms），`api.pure` 新增helper 全部可用，无 pageerror。

### 9.1 已落地

| 编号 | 落地方式 | 新增断言 |
|---|---|---|
| P1 | `AnswerCard` 经 `React.memo` 包装 + `useCardHandlers()` 提供按 id 稳定、经 ref 读当前卡片的回调包（缓存超 64 个 id 时整体丢弃重建） | memo 存在且被流式栈使用、回调包经 `handlersFor(card)` 展开 |
| P2 | 右栏测量观察器的 `attributeFilter` 只留两个 `data-*` 几何属性 | 断言过滤器不含 `class` |
| P3 | `MAX_LIVE_CARDS = 20`，新增纯函数 `capLiveCards()`；超限隐藏最旧的**已完成**卡片（`open:false`，数据保留） | 4 条：只藏最旧 / 跳过流式 / 已隐藏不占配额 / 不改入参 |
| P4 | `REPLAY_OPEN_BUDGET_CHARS = 200_000`，新增纯函数 `replayCardOpen()`；最新一张必定展开 | 3 条预算边界 |
| P5 | `flushStreamBuffers` 合并两个缓冲、只提交一次 `store.set`；删掉 `appendCardText` / `appendCardReasoning`；新增 `streamFlushDelay()`（>32 K 字符时 50→100 ms） | 一次 flush 恰好一次 `store.set`、节奏常量 |
| D2 | README §10.1 重写：先 `/ping` 判存活，其余接口说明需要会话 | — |
| D3 | `API_ROOT` + `apiBaseAfter()` + `fetchApi()`：首次 404 回退根绝对基址重试一次（401/403 不移动基址） | 4 条状态码矩阵 |
| D5 | 新增 `GET /sidecard-ask/api/ping`（免会话、仅回 `{version, at}`、不咨询 `connection`），路由分发改为"先解析路径、再鉴权" | 9 条：免鉴权、200/405、字段白名单、不咨询 connection、其余接口仍 fail-closed、未知路径仍 404 |

### 9.2 明确不做（附理由，不是遗漏）

| 编号 | 为什么不做 |
|---|---|
| 优化 4（拆 CSS / 懒加载词典） | 要拆就得把 CSS 变成宿主动态路由或第二个产物文件：① 样式会晚于 JS 到达，浮层首帧会**闪无样式**；② `Styles()` 现在随组件卸载一起消失，改 `<link>` 会变成页面级常驻，行为改变；③ 收益只有 gzip 后 ~8 KB 与 2–3 ms 解析。**投入产出不划算**，本轮只做实测记录（CSS 26 333 B / 147 规则块）。 |
| D1（设置页显示宿主版本） | 宿主没有通过 `ctx` 暴露自身版本（`index.js` 只取 `agents/subagents/tools/webRuntime/webServer/workspaceRegistry/connection`），插件侧只能靠猜服务名，写出来就是永远为空的死字段。**改成文档矩阵双列**（README §5.4）。 |
| D4（通知的兜底提示） | 插件无法感知"toast 因缺 AppUserModelId 而未显示"——`new Notification()` 不会抛错也不会回执。能做的是默认关（现状）+ 文档写明；再造一个"角标"要新增 i18n 键与 UI，收益不抵复杂度。 |

### 9.3 生效条件（别误判）

- `client.js` 改动：**刷新页面**即生效（产物带 revision）。
- `index.js`（含新 `/ping`）：**必须重启 DSH**；本机 8080 上跑的仍是 07:13 加载的 2.0.2 宿主模块，
  所以在重启之前 `GET /sidecard-ask/api/ping` 仍会 401——那不是 2.1.0 的问题。

