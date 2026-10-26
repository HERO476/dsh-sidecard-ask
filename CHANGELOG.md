# Changelog

## 2.1.4

**主题：把「技术方案评审团」查出的 11 条缺陷一次修完。四套脚本全绿，新增 21 条回归断言。**
排查依据：Software Architect / Application Security Engineer / Reality Checker 三方评审 + 源码复核 + 实测复现。

### 修复

- **B1（阻断，静默数据丢失）关闭的卡片在下次答题完成时被抹掉**。`syncPersisted()` 只从
  「活跃卡片」重建整个持久化集合再整键覆盖，而 `close()` 只把卡片移出活跃区、durable 快照
  仍留在 `store.state.history` 里，于是关掉的那张被静默删除（`contract-test` 原先把破坏后的
  结果当成了期望值）。现在写的是并集：活跃卡片 ∪ 尚未关闭的历史条目，按 id 去重（活跃方
  优先）后按 newest-first 截到 cap。删除路径本来就先改 `store.history` 再写盘，并集不会把
  它们删掉的条目复活。
- **B2（高，虚假安全保证）`agentPreset` 在 0.2.1-alpha.2+ 的 activation 面没被转发**。
  `startSubagent` 只在旧 `start(provider, request)` 面转发 `agentPreset`，新面的 `request`
  漏了它 → 子代理拿默认全套工具，而 start 帧仍按配置上报 `toolFilter: 'preset'`，卡片于是
  对用户谎报「工具集由 preset 决定」。现在两个面都转发。
- **B3（中高，降级链断裂）Rung 1 `sessions.using()` 没有 try/catch**。它一抛（会话归档、
  形状漂移，或它内部的 `no-session-face`），整条「改发到主对话」就断在第一档，后面
  `retain` / `inputActions` / `draft` 三档全部不可达。现在与 Rung 2 对称降级，
  `prompt-rejected` 仍照旧抛给调用方（那是用户可见的拒绝，不是通道缺失）。
- **B4（中，原生栏串卡）第二张卡开进原生右栏时第一张没有迁回浮层**。它只是被盖住——卡片
  仍标 `native-rightbar`、store 里被过滤掉，流式输出继续往看不见的卡片里写，且 rail 上那张
  永远关不掉。现在 `open()` 先把栏里其它卡片迁回 `flow`；`close()` 增加归属校验（栏被另一
  张卡占用时不替它关）与 `contentId` 行匹配（多行时关「属于这张卡」的那行）；`openTab`
  抛错时回滚 `cardId`，避免 CardHost 去渲染一张根本没有 tab 的卡。
- **B5（中低）`/cancel` 把跨会话的全局 run id 列表回给页面**。`runs` 是跨会话的全局表，
  回 `active` 等于泄露别的会话正在追问的卡片 id（`cancel` 本身也不校验归属），而 Client
  从不消费它。现在只回 `{ cancelled }`。
- **B6（中低，迁移被永久挡住）空的 v3 信封会阻断 v1/v2 迁移**。`raw !== null` 就直接
  return，损坏的 JSON 或旧版本留下的空信封同样挡住。现在写盘时带 `writtenAt` 标记，只有
  「本版本自己写的空信封」才算权威（用户确实清空了历史，绝不从 v2/v1 复活），没有该标记的
  空信封与损坏 JSON 继续向下探测。
- **B7（低，卸载泄漏）`dispose()` 只清了 `streamListeners`，漏了 `chunkListeners`**。第二个
  流来源的订阅者会留下仍被 `session/event` 桥持有的闭包（它捕获整个 engine 状态）。
- **B9（低，死重量）持久化写死 `slice(-12)`，而 `followUp` 只发 6 轮**。改成
  `HISTORY_TURNS`，与上下文预算同一个上限。
- **B10（低，死代码）`let finished = false` 只赋值不读取**，删除。
- **B11（低，可诊断性）信任围栏的 403 只说 `forbidden`**。现在说明「Host 不在信任范围 +
  怎么放行（127.0.0.1 或 `trustedHosts`）」。有意**不**自动信任绑定地址：插件读不到宿主的
  bind 配置，猜一个就等于自己拆掉 DNS-rebinding 防线。
- **B8（条件性，平台限制）配置里的 SMTP 密码以明文落在 `~/.dsh/` 下的用户层 JSON**。
  写盘已带 `mode: 0o600`（POSIX 生效，Windows 忽略），代码注释与 README 均已注明；
  无进程内可做的进一步缓解，**保留为已文档化的限制**，建议优先用环境变量。

### 验证

`node test/verify.mjs` / `contract-test.mjs` / `float-placement.mjs` / `smoke-test.mjs`：
**57 / 1446 / 100 / 277 全绿（1880 条，0 失败）**。相对修复前 1859 条新增 21 条回归断言，
逐条对应上面的缺陷：关卡片后历史仍在（contract）、activation 面转发 preset 且无能力时
不带该字段（smoke）、`using()` 抛错降级而 `prompt-rejected` 仍抛（contract）、空/损坏 v3
信封不挡迁移且自有空信封不被复活（contract）、原生栏单地址与关 tab 归属（contract）、
`/cancel` 不泄露 `active`（smoke）。

## 2.1.3

**主题：折叠态胶囊不再压在聊天输入框上（2026-10-25 实拍报告）。**

### 修复

- **胶囊盖住输入框**。浮层固定在 `bottom:16px`，而输入框就在会话列底部，折叠态胶囊
  正好落在输入框上。新增纯函数
  `floatBottom({ frameHeight, composerTop, fallback, limit })`：测量 `[data-composer-card]`
  的顶边，把浮层抬到输入框上方 8px（CSS 变量 `--dsa-gap-bottom`）。两道保险——输入框
  顶边落在窗口上半部（空会话的居中输入框）时不抬；结果上限 240px，避免超高输入框把
  浮层推到会话正文上。
- **胶囊改为按内容收缩**。浮层本就贴着右边缘（`right:8px`），「再往右」没有余量，所以
  改为缩窄：内容自适应、上限 240px、容器右对齐，左边缘随之右退。内边距 8/12 → 6/10、
  行高 18 → 16，问题文本由 `flex:1` 改为 `flex:0 1 auto`（只在真放不下时才截断）。
  取舍：抬到输入框上方后它会压住最后一行消息，所以必须足够窄小。
- 新增 `node.dataset.layerBottom`（与 `layerWidth` 并列），用户反馈可以直接报出浮层
  离底多少。

### 验证

`test/float-placement.mjs` 新增 `floatBottom` 数值用例与源码钩子；四套脚本
100 / 1427 / 57 / 271 全绿。

## 2.1.2

**主题：按 DSH 0.2.1-rc.3 的实测契约修复——原生右栏卡片、语言跟随、只读工具收窄、可信主机围栏。
排查依据见 `CROSS-END-AUDIT-2.1.1.md`（桌面端 0.2.1-rc.3 / Electron 43.3.0 × 网页端 0.2.1-rc.3）。**

### 修复

- **D0 原生右侧栏永远显示「卡片已关闭」**。0.2.1-rc.3 的右侧栏 tab 记录只有
  `{ id, kind, contentId, title }`，body 组件拿不到 `tab`，也没有 `tab.meta`——插件原先读
  `props?.tab?.meta?.cardId` 恒为 `undefined`，于是 `CardHost` 走「已关闭」兜底分支，
  render proof 永不 settle，600 ms 后把卡片挪去浮层并提示「承载面未渲染」。
  新增 `hostCardIdOf(props)`：`tab.meta.cardId` → `navigation.params.cardId` →
  原生适配器打开时记下的 `surfaces.native.cardId`。内置右栏的 tab 是**按 kind 单例**的，
  同一时刻只承载一张卡，所以「打开时记下 id」是可靠来源。
  > 该缺口只影响显式选 `native-rightbar` 的用户；`auto` 的候选顺序是「侧边卡片插件 → 浮层」，
  > 本来就不选原生栏（见 `pickSurface` 注释）。
- **D2 卡片关闭后右栏 tab 残留**。rc.3 的 `sidebarRight` 控制器没有 `closeTab(kind, options)`
  （只有 `openTab/openTabIn/openResource/openResourceIn/close/closeIn/closeTarget`），
  原实现对 `closeTab` 做防御式探测，恒为「不存在」⇒ 永远返回 `false`。
  现在从 `controller.openTabs.getSnapshot()` 找 `{ sessionId, tabId, kind }` 行，用
  `closeIn(sessionId, tabId)`（无则 `close(tabId)`）真正关掉；同时删掉注释里那条错误陈述。
- **D3 切换界面语言不跟随**。rc.3 locale 快照是 `{ active, locales, revision }`，插件读的
  `snapshot.locale / snapshot.id / getLocale().locale` 三个字段都不存在。改为
  `active → locale → id → getLocale()` 的顺序读取（兼容旧壳与返回裸字符串的 `getLocale()`）。
- **D1 `sideTools: 'readonly'` 只是名义上的**。rc.3 的 `SubagentStartRequest` /
  `SubagentCapabilities` **没有 `toolFilter`，也没有 `persona`**，只读实际靠「探针拒写」。
  真正能收窄工具集的通道是 `agentPreset`（`SubagentCapabilities.agentPreset` +
  `SubagentStartRequest.agentPreset`）。新增配置 `sideAgentPreset`（默认空 = 不启用，≤120 字符）：
  设置后子代理以该 preset 启动，工具集由 preset 决定；`agentPreset` 能力位缺失时自动退回探针。
  设置页给出对应输入行（仅在 `readonly` 下可编辑），卡片上标注「工具集由 preset「X」决定」。
  **未新增任何 `toolFilter` 参数**——它在新版并不存在。
- **D4 `persona` 能力位缺失**：保持现状（persona 拼进 prompt 文本，行为正确），仅在文档标注。
- **P2 非 loopback 访问一律 403**。`webRuntime` 服务在 rc.3 中不存在，`trustedHosts` 恒空。
  `trustedHostsOf()` 现在先读 `webRuntime.trustedHosts`，再读 `connection.trustedHosts`
  （`HostConnectionService` 的公开字段，与宿主自己的 Host/Origin 围栏同源），两者皆空才返回 `[]`。
- **P3 没有安装期门禁**：`package.json` 增加 `engines.dsh: ">=0.1.2-rc.1 <0.3.0"`。
- **P6 失效的后备选择器**：从锚点阶梯删除 `.rightbar`（pre-rail 时代的类名，支持范围内无任何构建渲染它），
  观察器选择器同步清理 `[data-dsh-panel-host]`；`[data-slot^="sidebar.right"]` 保留为最后一档。
- **P1 `assistant-stream` end 帧无 `stopReason`**：保持现有兜底（取 `result.stopReason`），
  在 README §7 注明该字段在 0.2.1 上恒空的原因。

### 版本

`package.json` / `index.js` `PLUGIN_VERSION` / `client.js` `CLIENT_VERSION` 同升 2.1.2。

### 回归

- `test/contract-test.mjs`：原生 tab 生命周期的替身改为 rc.3 真实形态
  （`openTabs.getSnapshot()` + `closeIn`），断言「关闭走到拥有该 tab 的会话」而不是不存在的 `closeTab`。
- `test/float-placement.mjs`：锚点阶梯断言改为「插件自有节点先于 slot 子树」，并新增
  「`.rightbar` 已从阶梯中移除」。
- 全量：verify 57 + contract 1427 + float-placement 84 + smoke 271 = **1839 passed, 0 failed**。

## 2.1.1

**主题：卡片记录只收侧边卡片——改发到主对话的问答不再进持久化历史。** 无 API/配置变更。

### 修复

- **主对话承载的问答混进卡片记录**。`syncPersisted()` 一直只收 `carrier === 'side'`，但 v3 信封或
  v1/v2 迁移数据里可能存在 `carrier: 'main'` 的条目（旧版本写下的），
  `parseEnvelope()` 会把它当普通记录读回来并在启动时以侧边卡片回放，与主对话内容重复。
  现在读取时直接丢弃这类条目：它不写 localStorage、不进设置页的历史管理器、也不进「导出全部 .md」。
- **`sendToMain()` 成功后清理记录**。卡片改投主对话时从 durable history 删除对应 id
  （`draft` 模式只是把文本放进输入框、尚未真正发出，保留记录）。

CHANGELOG 对应回归测试：`test/contract-test.mjs` 的 `main-carrier records` 段（main 提交不写盘、
旧 payload 里的 main 条目被丢弃、`sendToMain` 删除记录）。

## 2.1.0

**主题：跨端核查后的性能与可观测性收口——流式热路径从「每次 delta 全树重渲染」改成「只重渲染变化的卡」，
新增加载预算与活动卡上限，补上一个不免鉴权的探活口，并修掉部署前缀缺少尾斜杠时的基址丢失。**

排查依据见 `CROSS-END-AUDIT-2.0.2.md`（网页端 dsh 0.2.1-rc.2 × 桌面端 dsh-desktop 0.2.0-rc.2 /
Electron 43.3.0）。本版不含破坏性变更，配置项与接口签名不变。

### 性能

- **流式热路径只重渲染变化的卡片**。`useStoreState()` 订阅整个 store，而 `FloatingLayer` 每次渲染都给
  `AnswerCard` 新建 16 个箭头函数，于是任何一次 `store.set` 都会让所有卡片的 props 全部不等——
  `React.memo` 无从下手。现在：
  - `AnswerCard` 经 `React.memo` 包装（对没有 `memo` 的 React 自动退化为原组件）；
  - 新增 `useCardHandlers(actions)`：每个卡片 id 只建一次回调包，回调通过 ref 读当时的卡片
    （否则"复制"会复制到两个 delta 之前的文本），因此未变化的卡片 props 引用稳定、整棵子树跳过。
- **一次 flush 只提交一次状态**。`flushStreamBuffers` 原来对正文和思考各调用一次
  `appendCardText`/`appendCardReasoning`，每次都是一次 `store.set`；3 路并发时理论上 120 次全树渲染/秒。
  现在两个缓冲合并成一个 `cards` 补丁、一次提交（两个旧 helper 随之删除）。
- **流式节奏按文本长度自适应**：答案超过 32 K 字符时刷新间隔 50 ms → 100 ms
  （实测 64 K 答案的 `renderRichText` 为 1.2–2.0 ms/帧，翻倍间隔即减半工作量，肉眼无差）。
- **右栏观察器不再被 class/style 吵醒**。面板测量的 `MutationObserver` 原来把 `class`、`style`
  放进 `attributeFilter`，聊天区的 hover/滚动/徽标切换每次都会触发一次 rAF 内的
  `getBoundingClientRect`（强制布局）；现在只监听 `data-sidebar-right-open` 与
  `data-dockkit-pane-active` 两个真正表示"右栏几何变了"的属性。
- **活动卡片上限 20**。此前 `store.state.cards` 无上限，长会话会把每条答案的 React 子树一直挂着。
  超过上限时最旧的**已完成**卡片隐藏为 `open:false`（数据保留、正文卸载、历史可恢复），
  正在流式的卡片永不隐藏。
- **冷启动回放预算 200 K 字符**。回放原来把所有历史卡片以 `open:true` 恢复，仅受卡数（默认 10）
  与单字段 64 K 限制，最坏要挂 64 万字符的 markdown；现在最新一张必定展开，其余按累计字符预算展开，
  超预算的以折叠态回来。

### 修复

- **部署前缀不带尾斜杠时基址丢失**。`new URL('.', 'https://host/dsh')` 会把 `dsh` 当文件名，
  于是 `API` 退化成 `/sidecard-ask/api`，前缀部署下全部 404。现在首次 404 会回退到根绝对路径重试一次
  （401/403 都**不**改基址：那是鉴权/围栏的答案，不是"路径不对"）。正常部署（文档根或带尾斜杠）
  取值与旧值完全相同，不产生额外请求。

### 可观测性

- **新增 `GET /sidecard-ask/api/ping`**：唯一免宿主会话的接口，只回 `{version, at}`。
  2.0.2 的会话门把脚本/CI 的探活路径全挡住了（连 README 里的 `Invoke-WebRequest` 都变成 401），
  这条补回"插件是否加载"的判别能力，同时不重新打开"无 cookie 就能 spawn 子代理"的口子。
  它仍受 loopback/Origin 围栏保护，且**不咨询** `connection` 服务——会话服务坏掉时探活照常工作。
- 路由分发顺序随之调整：路径解析提前到会话门之前（`ping` 在此之前应答），未知路径仍然对所有动词
  回同一个 404。

### 文档

- README §10.1 的自测配方改为"先 `/ping` 判存活，其余接口需会话"（旧配方在 2.0.2 之后恒 401）。
- 新增 README §5.4：2026-10-22 桌面端复核（宿主版本落差、Chromium 150、scheme 特权、请求转发、
  权限、AUMID、加速键、产物缓存）。
- README §14 补 12–15 四条限制（`/ping` 的边界、活动卡上限、回放预算、前缀重试）。
- 更正 2.0.2 的一处结论：「桌面端在本机冷启动即崩」**2026-10-22 未能复现**（冷启动成功、宿主在 19387
  正常服务），改为"与安装包/启动方式相关，需按版本复验"。

### 测试

- `verify` 57、`contract` **1408**（原 1377）、`float-placement` **83**（原 82）、`smoke` **271**（原 262），
  合计 **1819 通过，0 失败**。
- 新增覆盖：`apiBaseAfter` 的四种状态码（404 改基址、401/403 不改、根绝对不循环）、
  `capLiveCards` 的隐藏规则（只藏最旧、跳过流式卡片、已隐藏不占配额、不改入参）、
  `replayCardOpen` 的预算边界、`React.memo` 与稳定回调包的接线、一次 flush 只有一次 `store.set`、
  `attributeFilter` 不再含 `class`、`/ping` 免鉴权与 405、`/ping` 不咨询 `connection`、
  其余接口仍 fail-closed、未知路径仍 404。

## 2.0.2

**主题：跨端（网页端 / 桌面端）排查后的六个修复 —— 插件 API 补上宿主会话鉴权、诊断上报不再互相覆盖、prompt 预算真正守住 60k、SMTP 密码状态自洽、未知接口状态码对称、用户层配置按 profile 分文件。**

排查方式：网页端在真实宿主上跑运行态探针（curl 打全部 7 个接口 + 真跑一次 SSE 作答）；桌面端读
`DeepSeek Harness.exe` 里 `app.asar` 的 `lib/main.js`（网络转发、权限、下载拦截、窗口参数）做静态取证。

### 安全

- **插件 API 之前绕过了宿主的 401 登录门禁**（D1）。`ctx.webServer.register` 注册的 prefix 路由不经过
  `dsh-client-connection` 的 `authorizeIndex`，插件自己又只做「回环 / 可信域 + `Origin` + `Sec-Fetch-Site`」围栏——
  实测**不带任何 cookie 的 `POST /sidecard-ask/api/ask` 真的会 spawn 一个子代理**，`POST /config` 会写配置。
  现在在围栏之后追加一次 `ctx.get('connection').requestRejection(req)`：
  - 返回 `401` → 一律 `{code:"unauthorized"}`「需要先通过 DSH 登录（宿主会话未认证）」；
  - 返回 `403` → `{code:"forbidden"}`「请求来源不受信任」；
  - 宿主**没有**挂载 `connection` 服务（旧组合 / 单测）→ 只记一条 info 日志，退回原来的单层围栏；
  - 校验本身抛错 → fail-closed 按 401 拒绝。
  桌面端不受影响：`forwardWebRequest` 本来就会注入宿主启动时换来的鉴权 cookie（`lib/main.js:8268-8299`）。

### 修复

- **`/diagnose` 上报是 last-write-wins**（D2）。`clientReport = report` 无条件覆盖，于是「哪个页面最后上报，
  `/state` 里的客户端诊断就只剩它看到的那点东西」——实测发一个 `{}` 就能把整段诊断清空。改为
  `mergeClientReport(previous, next)`：本次没观测到的字段保留旧值（`slots` / `native` / `better` 浅合并），
  `at` 取新值；完全空的上报直接 `400 bad-request`，不再当成一次有效观测。
- **prompt 预算算不准**（D3）。`truncateSelection` 把省略标记加在预算之外（给 100 字符的预算返回 119 字符），
  `fixedLength` 又比实际 join 少算一个分隔符，实测总量落到 60018–60023（`MAX_PROMPT_CHARS = 60000`），
  极端组合（超长 question + 6 轮历史）能把 selection 压到 1 个字符。现在：
  - 省略标记**计入**预算，任何 `maxChars` 下结果都 ≤ cap（`test/contract-test.mjs` 用 9 档 cap × 900 点的
    emoji 样本逐档断言）；
  - 固定块先算长度、selection 吃剩余预算，问题行长按 `MAX_QUESTION_CHARS = 20000` 先截断，
    selection 保留 `SELECTION_FLOOR_CHARS = 2000` 下限，预算不够时按轮丢弃更旧的历史而不是把 selection 压没；
  - 最坏组合（19000 字问题 + 6 轮历史 + 20000 字 selection）总量验证 ≤ 60000；
  - `start` 帧新增 `promptTruncated` / `promptDroppedChars` / `promptHistoryDropped`：prompt 侧的截断
    以前对客户端完全不可见，用户只会看到"答案变短了"。
- **SMTP 状态自相矛盾**（D4）。`configured` 走 `resolveSmtp()`（环境变量优先），`hasPassword` 却只看设置页里那一格，
  于是「凭据来自环境变量」时报出 `configured: true` + `hasPassword: false`。现在 `hasPassword` 表示
  **手上真的有一份能用的密码**（任一层），并新增 `source`（`config` / `env`）与 `storedPassword`
  （设置页里是否存了一份）区分两层来源。
- **未知接口的状态码不对称**（D5）。`GET /nope` 回 405（`method-error`）、`POST /nope` 回 404（`not-found`）——
  方法名判定排在动词判定之后。现在先判方法名：任何动词打未知接口都是 `404 not-found`，已知接口用错动词才是 405。
- **网页端与桌面端共用同一份 `config.json`**（D6）。两边是同一台机器上的两个 profile，共用一个 `DSH_HOME`，
  于是 web 端存的 `sideTools: inherit` 会直接作用于桌面端的运行。用户层文件改为
  `<DSH_HOME>/sidecard-ask/config.<DSH_PROFILE>.json`（profile 名只接受 `[A-Za-z0-9._-]`，否则退回旧名，
  防止路径穿越）；`DSH_PROFILE` 未设置时仍是 `config.json`，**旧文件不迁移、不删除**：新 profile 第一次启动
  会继承它一次（`/state` 的 `provenance.persistedInheritedFrom` 会说明），下一次保存在自己的文件里落盘。
- **客户端 `getState()` 丢掉了宿主的错误码**（D1 的配套）。`ok !== true` 时统一抛 `bad-response`，于是 401 会被
  渲染成"宿主接口不可达"。现在透传 `body.error.code`，并给 `unauthorized` / `forbidden` 各加一条中英文案。

### 复审追加（同版本内）

- **一个 `%` 就能打断设置页**。`parseSmtpUrl` 用 `decodeURIComponent` 解账号/密码，密码里带未转义的 `%`
  （`pass%word`）会抛 `URIError`；异常经 `describeFeedback → resolveSmtp → readSmtpFromEnv` 一路逃到 `/state`，
  而 `/state` 分支当时在 `routeHandler` 的 `try` 之外，于是整页变成「宿主接口不可达」。现在解析失败返回
  `{ok:false, reason}`，且 `/state` 与其余接口共用同一个 try（失败回可读的 500，而不是未处理的拒绝）。
- **`history` 里的坏条目会把提问打成 TypeError**。`composeSidePrompt` 直接读 `turn.question`，`history:[null]`
  在 `ask()` 的 try 之前抛出，前端只看到英文 `Cannot read properties of null`。现在非对象条目被丢弃；
  顺带修掉 `historyTurns: 0` 被 `slice(-0)` 解释成「全部历史」的边界。
- **历史持久化在配额满时是 O(n²)**。按字段上限单卡最坏 ~0.9 MB、默认 10 卡 ~8.8 MB，超过常见 5 MB 配额后
  旧实现逐张丢弃并整份重新 `JSON.stringify`。现在先按 2M UTF-16 单元的总预算裁剪，失败时折半丢弃。
- **答案流式期间重复解析 reasoning**。`renderRichText(card.reasoning)` 未 memo，答案每 50 ms 刷新都重解析
  整段思考过程；现在与正文一样按文本 memo。
- **旧版插件探测在启动 6 秒内全文档扫描**。`MutationObserver` 每次 DOM 变更都跑
  `querySelectorAll('.dsa-layer:not([data-dsa-owner])')`，现在合并成 250 ms 一次的尾随扫描，卸载时清定时器。
- **已存的 SMTP 密码无法清除**（空串＝保留）。新增 `feedbackSmtpPassClear: true` 显式清除。
- `inlineNodes` 的 token 正则从每次调用新建改为模块级常量（用前复位 `lastIndex`）。
- `openSse.end()` 在流已关闭时提前返回、跳过 `clearInterval`，现在关闭动作统一走 `shutdown()`。
- README 自测规模更正为实测值，并补上本轮 9 条回归断言（坏 `%` 两处、坏 `history` 条目、`historyTurns: 0`、
  配额下的裁剪/落盘/删除保持）——现为 verify 57 + contract 1377 + float-placement 82 + smoke 262 = **1778 项**；
  同时删掉仓库里未声明、无 lock 的 `node_modules`（js-yaml / argparse）残留，`.acl-recovery/` 加入 `.gitignore`。

### 未修：宿主 / 安装包侧（不是本插件能修的）

- **桌面端在本机冷启动即崩**：`DeepSeek Harness.exe` 6 秒内退出，唯一确凿栈是
  `Received fatal exception EXCEPTION_BREAKPOINT` → `electron::fuses::IsLoadBrowserProcessSpecificV8SnapshotEnabled`
  → `v8::ScriptCompiler::CreateCodeCacheForFunction`，崩在 V8 snapshot fuse 初始化阶段、早于任何插件加载。
  安装根还缺 `browser_v8_context_snapshot.bin`。因此桌面端的结论只能来自 `app.asar` 静态取证，没有运行态验证。
- **桌面壳没有 `app.setAppUserModelId`**（只有 `setAsDefaultProtocolClient("dsh")`，`lib/main.js:13055`）：
  Windows 上 toast 通知可能不显示。插件 `notifyOnDone` 走的就是 `new window.Notification`，这一项**待验证**，
  插件侧无法兜底（`Notification` 是桌面壳的默认会话权限，非麦克风权限一律放行）。

### 排查中推翻的三个旧判断

1. **桌面端下载没有被取消。** `will-download → preventDefault()` 只出现在 `dsh-policy-auth-*` 登录窗
   （`lib/main.js:10113`）和侧边栏 webview 的 `dsh-sidebar-browser-*` 分区（`lib/main.js:10632`，由
   `configureSession` 安装）。主窗口走 `defaultSession`，没有该拦截，`downloadMarkdown()` 在桌面端可用。
2. **剪贴板不存在"静默无操作"。** `copyText(text, fallbackElement)` 在 `navigator.clipboard` 缺失或失败时
   会 `selectNodeContents` 选中卡片正文并返回 `'selected'`，最后才 `'failed'`。
3. **`getState()` 没有未处理的 rejection。** 它的两个调用点都收口（`await` + `.catch(() => {})`）。

### 测试

- `node test/contract-test.mjs` 1377 通过（2.0.1 是 1334）；`smoke-test.mjs` 262（原 226）；`verify.mjs` 57；
  `float-placement.mjs` 82。合计 **1778 通过，0 失败**。
- 新增覆盖：`truncateSelection` 的「结果 ≤ cap」不变式（9 档 cap）、最坏组合的 prompt 预算、`start` 帧的
  prompt 侧截断字段、`/diagnose` 的合并与空上报拒绝、宿主会话门禁四种返回（401 / 403 / undefined / 抛错）、
  未知接口在 GET/HEAD/POST 下的 404、profile 分文件与一次性继承、`describeSmtpSettings` 的两层来源；
  复审追加 9 条：坏 `%` 的解析与 `/state` 降级（4）、坏 `history` 条目与 `historyTurns: 0`（2）、
  配额下的历史裁剪 / 落盘 / 删除保持（3）。

## 2.0.1

**主题：清掉 6 个死 i18n 键。无行为变化，无 API / 配置变化，升级无需任何操作。**

- **删除 4 个纯死字符串**：`selectionEmpty`、`selectionTooShort`、`floatDocked`、`resetDone`。它们对应的界面在早期版本
  就已下线，此后没有任何 `t()` 调用点，只是留在字典里被 `locale/*.json` 与打包产物带着走。
- **删除 2 个重复定义的界面标签**：`familyLegacyDiag`（旧版共载 / Legacy co-load）、`familyPeers`（同页实例 / Copies on page）。
  它们在 zh、en 两个字典里各被**重复定义两次**（后一份静默覆盖前一份），且都没有调用点。同一功能的
  `familyLegacyToast` / `familySuppressed` 仍在使用，保留；**运行时状态字段** `familyPeers`（family 接管详情里的同页实例列表）
  是数据而非标签，同样保留。
- **字典规模**：`client.js` 每个语言从 272 键降到 266 键，zh / en 键集仍完全一致。
- **防回流**：`test/contract-test.mjs` 的「退役键必须在两个字典里都是 undefined」断言从 4 个键扩到 10 个。

## 2.0.0

**主题：追问卡片标题栏的 `×` 从「隐藏整个浮层」改成「删除这条追问对话」——一次 Breaking 的语义重定义，顺带把「隐藏浮层」这套能力整体下线，并移除反馈表单里「用邮件客户端发送」这条出口。**

`×` 原来是全局开关：点一下整个浮层缩成一个带计数的圆点，再点圆点恢复。用户实际想要的是**删掉眼前这条追问**，
而当时删除只能绕两条路走（卡片底部按钮 / 设置页历史管理器），且 `×` 的「隐藏」在多卡场景下会连着别的卡片一起收走。
2.0.0 把 `×` 直接对齐到用户心智，并**不再保留**「隐藏整个浮层」这套能力（不是挪位置，是不留替代入口）。

### Breaking

- **`×` 语义变更**：卡片标题栏最右侧的 `×` 由「隐藏整个浮层」改为「**删除这条追问对话**」，`title` / `aria-label`
  改用新键 `cardDelete`。删除会同时从活动卡片列表与持久历史里移除该卡片，**不可撤销**。
- **`floatMode` 移除 `off`**：枚举从 `['capsule', 'full', 'off']` 收窄为 `['capsule', 'full']`，设置页该下拉只剩两项。
  旧配置里存过 `'off'` 的**无需手工迁移**：宿主 `sanitizeLayer` 判定为非法值 → 忽略并在 `problems` 里提示，
  回退默认 `capsule`（不写迁移代码，也不静默改写用户配置）。
- **小圆点 launcher 删除**：浮层不再有「只剩一个计数圆点」的形态，相关渲染分支、样式与恢复入口一并删除。
  浮层只剩 `capsule`（一行高胶囊）与 `full`（完整卡片栈，铺满右栏 dock 时为 `dock`）。
- **删除 4 个 i18n 键**：`setFloatModeOff`（设置页「隐藏」项）、`floatHide`（`×` 的旧 title）、
  `floatRestore`（从圆点恢复浮层的入口）、`floatCount`（圆点计数）。`floatStreaming` / `floatDone` 保留（胶囊仍在用）。

### 新增：删除交互

- **空卡直接删**：该卡无任何已完成追问轮（`history.length === 0`）且主回答正文与思考过程都为空、且不在作答中
  （非 `pending` / `streaming`）时，点 `×` **直接删除，不弹确认**。
- **其余情况弹插件内轻量确认层**（`DeleteConfirmDialog`，不使用 `window.confirm`）：标题「删除这条追问对话？」，
  正文说明会同时从浮层与追问历史里移除、不可撤销；已有追问轮次时追加一行「含 {n} 轮追问」；
  两个按钮「取消」/「删除」（删除为危险色 `.dsa-btn-danger`）。
- **无障碍与误触防护**：`role="dialog"` / `aria-modal="true"` / `aria-label` 取标题；默认焦点固定在被标记 `autoFocus`
  的「取消」上（不落在危险按钮，防连按 Enter）；`Esc` 取消（`stopPropagation`，不冒泡到卡片自身的 Esc 处理）、
  点遮罩取消（仅当 `event.target === event.currentTarget`）；确认层打开时卡片的 `R` / `C` / `Esc` 快捷键全部失效。
- **流式中删除**：先 `abort()` 中止请求 + 通知宿主 `cancel`，丢弃该卡进行中的增量缓冲（`pendingDeltas` / `pendingReasonings`），再执行删除。
- **删除动作顺序固定**：按同一 `id` 从 `history` 与 `cards` 双移除 → 立即写盘持久化 → 关闭该卡已打开的侧栏 / host tab 表面
  → 浮层 toast「已删除这条追问对话」（2600ms 自动消失）。
- **删除后重排**：剩余卡片按原顺序塌缩补位；删掉最后一张时 `total === 0` → 浮层整体不渲染（无空态）。
- **上下文隔离**：每张卡的追问上下文本就按卡隔离，删除不影响其它卡片；后续生成只读取剩余卡片自身历史。

### 移除：反馈表单的「用邮件客户端发送」出口

- **UI**：反馈弹窗从三条出口减到两条（`发送` / `复制内容`），删掉 `data-feedback-mailto` 按钮与
  `sendFeedbackByMailApp()`；没有发信服务时弹窗仍按两种就绪状态说明缺什么，并指向「复制内容」。
- **Host**：删掉 `POST /feedback-mailto` 路由、`buildMailtoUrl()` 构造器与 `API_METHODS` 里的条目。
  未命中的方法由既有兜底返回 `404 not-found`（`error.message` 带方法名），旧页面调用会明确失败而不是静默。
- **`/state`**：`capabilities.feedback.transport` 在未配置时由 `'mailto'` 改为 `'none'`；`reason` 只回 SMTP 的原因。
- **i18n**：`feedbackMailto` 删除，`feedbackMailtoOnly` 重命名为 `feedbackNoCredentials`（文案改指向「复制内容」），
  `feedbackUnconfigured` 同步改写；zh/en 两侧键集仍然完全一致。
- **理由**：这条出口只是把同一封邮件交给系统邮件应用，与「复制内容」的实际效果重叠，却让 Host 多出一个
  任何人都能调的 URL 构造接口（还会把明文收件地址拼进 URL）。删掉它，反馈的发送面只剩 SMTP 一条。
- **测试**：`test/contract-test.mjs` 删除 `buildMailtoUrl` / 路由 200 / 按钮存在三类断言，改为断言
  `transport === 'none'`、`/feedback-mailto` 两次 404（有/无收件人）、`data-feedback-mailto` 不存在、
  两个退役 i18n 键在 zh/en 都是 `undefined`（`node test/verify.mjs` 的 `t()` 键扫描同时覆盖新键名）。

### 清理：1.9.1 遗留的 10 个死 i18n 键

- **删掉 10 个 `feedbackSmtp*` 标签键**：`feedbackSmtpShow` / `feedbackSmtpHide` / `feedbackSmtpEnvNote` /
  `feedbackSmtpHost` / `feedbackSmtpSecure` / `feedbackSmtpPassSaved` / `feedbackSmtpPass` / `feedbackSmtpFrom` /
  `feedbackSmtpHint` / `feedbackSmtpSaveHint`。它们只属于 1.9.1 删掉的设置页 SMTP 表单，全仓已无任何
  `t('feedbackSmtp…')` 调用点，留着只是让翻译者以为这些输入框还在。
- **配置键不动**：`feedbackSmtpHost` / `feedbackSmtpPort` / `feedbackSmtpSecure` / `feedbackSmtpUser` /
  `feedbackSmtpPass` / `feedbackSmtpFrom` 作为 `config.json` 字段与 `client.js` 的 `CLIENT_DEFAULTS` 继续存在，
  按环境变量或用户层配置生效；删的只是同名的**界面标签**。
- **zh/en 同步删**，键集仍完全一致；`test/contract-test.mjs` 的退役键断言扩到 12 个键（含上一节的两个），
  两个字典都必须取到 `undefined`。

### 兼容性与边界

- **不涉及**：无服务端会话存储、无多端同步、无遥测埋点（这些维度 N/A）；删除不进「回收站」，**不提供撤销**
  （无 Undo、无快照、无 5 秒窗口）。
- **承载面差异**：`×` 只出现在**浮层 / 内嵌浮层**（含 dock 到右侧栏的浮层卡片）上。被宿主 tab 承载的同一张卡
  （`better-sidebar` / `native-rightbar` 独立标签页）**不提供 `×`**，沿用它自己的标签关闭 + 底部「关闭」——
  「关闭」只把卡片摘离浮层、**历史仍保留**在设置页历史管理器里，与「删除」是两种真实需求。
- **版本号**：`1.9.1 → 2.0.0`，三处同步（`package.json` 的 `version`、`index.js` 的 `PLUGIN_VERSION`、`client.js` 的 `CLIENT_VERSION`）。
- **测试**：`test/float-placement.mjs` 增补 2.0.0 行为断言（无 `dsa-launcher` / `floatRestore`、`floatControl('capsule')` 存在、
  `onDelete` 已接线、无 `mode === 'off'` 渲染分支、`floatMode` 默认 `capsule`）；`test/contract-test.mjs` 增补
  `sanitizeLayer` 丢弃 `'off'`、设置页 option 序列为 `['capsule','full']`、卡片头恰有一枚 `aria-label === cardDelete` 的按钮、
  `deleteCard` 的四类行为、4 个已删键为 `undefined`。
- **文档**：README 的配置表 / dock 形态说明 / 自测第 8–9 条同步改写，反馈章节的「三条出口」表改为两条并记下移除理由；
  `docs/PRD-followup-delete.md` 出 v3 修订（D0 定稿 + 隐藏能力下线 + 规格逐条对齐已交付代码，路由清单去掉 `feedback-mailto`）。

## 1.9.1

**主题：反馈入口重做——从「设置页里一整块常驻表单」改成「顶部一行横幅 + 居中弹窗」。**

用户看过 1.9.0 的界面后原话是「啥也没改啊，反馈部分全部重新做」。复盘：1.9.0 虽然把横幅改成了「默认收起」，
但收起态仍是一条**整宽品牌色描边大卡片**，展开态把类型/标题/描述/邮箱/SMTP 六行表单全塞进设置页，视觉上跟改之前
没区别，真正的设置项还是被挤到首屏之外。所以 1.9.1 不再做增量修饰，**整块重写**：

- **`dsa-feedback-bar` 一行横幅**替代原来的 `dsa-feedback-hero` 卡片：左侧「反馈」标题 + 一句说明，
  右侧一个主按钮；高度只有一行，设置页第一眼看到的就是真正的设置项。
- **表单搬进居中对话框**（`FeedbackDialog`，`role="dialog"` / `aria-modal="true"`，`Esc`、点背景、`×` 三种关闭），
  复用插件已有的 `.dsa-backdrop` / `.dsa-dialog` 弹窗样式，不再往页面流里插任何表单节点。
- **删掉设置页里的「设置邮件发送（SMTP）」区块**（host/端口/SSL/账号/密码/From 六个输入框 + 折叠按钮）：
  发信凭证属于部署方/维护者，改用**环境变量或用户层 `config.json`**，填报人看不到也不需要这些概念。
  配置键本身保留，host 侧行为不变。
- **`/state` 反馈就绪状态**改成在弹窗里用一行状态条说明（已就绪 / 有收件人缺 SMTP / 未配置），不再占设置页版面。
- 保留 1.9.0 已定的语义：收件人打包默认 `b64:` 混淆值且环境变量优先、填报人「你的邮箱」写进 `Reply-To:`、
  三条出口（发送 / 用邮件客户端发送 / 复制内容）、host 侧限速与打码日志。
- 测试：`test/contract-test.mjs` 里原先针对内联表单的 61 行断言整块替换为 126 行（横幅只有一行、点开才渲染表单、
  弹窗可独立渲染、关闭路径三种、SMTP 输入框**不存在**、字典键齐全），contract 1209/13 → **1239/0**。
- README §4.4 与配置表同步重写；不再出现「在设置页填 SMTP」这类指引。

## 1.9.0

**主题：设置页多了一个「反馈」入口——把问题与建议直接用邮件发出去，而仓库里不存任何邮箱或密码。**

起因是用户要求：在插件设置页新增「反馈」按钮，让用户把问题和建议通过邮件发到指定邮箱，并明确要求
「邮箱地址与服务凭证通过配置项或环境变量注入，不得硬编码或写入仓库」「不引入非必要第三方依赖」。

- **一条可折叠的反馈横幅**（设置页**最顶部**、**默认收起**、品牌色描边卡片 `data-dsa-feedback-section`）：收起时只有
  一行（标题 + 一句话说明 + 主按钮），点开才是表单——类型（问题 / 建议 / 疑问 / 其他）、标题（4–120 码点）、
  详细描述（10–4000 码点）、可选的**你的邮箱**；收件人不占界面位置（见下）。
  标题拒绝换行（头注入的第二道防线）；计数按**码点**，一段 120 个 emoji 的标题不会被当成 240 字拒绝。
- **`From:` 仍是维护者自己的 SMTP 账号，填报人的邮箱进 `Reply-To:`**。QQ/163 会拒收不属于本账号的
  `From:`（553），所以发件身份不变；填报人在「你的邮箱」里填了地址，Host 校验为邮箱后写成 `Reply-To:`，
  维护者按「回复」直接回到填报人（该值不含 CR/LF，无法注入头字段）；留空则整行不写。`mailto:` 回退路径
  没有 `Reply-To` 可用，同一地址同时留在正文 `Contact:` 行。（早期版本一度完全删掉 `Reply-To`、只留正文行；
  在用户要求「跟 recycle-bin 的效果一样」之后改回现在的形态。）
- **收件人完全不在页面上出现**：`/state` 只给 `hasRecipient` / `toMasked` 这类摘要，`config` 里也删掉了
  `feedbackAddress`；设置页既没有掩码行，也没有「更换收件人」入口与地址输入框。收件人优先级是**环境变量
  （`DSH_SIDECARD_FEEDBACK_TO` 或共用的 `DSH_CRB_FEEDBACK_TO`）> 用户层/打包配置 `feedbackAddress`**。
  「用邮件客户端发送」向 Host 要一条拼好的 `mailto:` URL 再跳转。
  就绪状态分三种说（没地址 / 有地址缺 SMTP / 齐全），不再把「能用邮件客户端发送」说成「未配置」。
  这条经历**两轮返工**：第一版给了 `type="password"` + 「显示收件人」开关，用户截图指出「这不是直接暴露
  我的邮箱吗」——一键看明文本身就是暴露面；第二版改成只渲染掩码 + 只写更换入口，用户又指出这两块本来
  就不该存在，于是全部删除。
- **三条出口**：`发送`（收件邮箱 + SMTP 凭证齐备时可用，成功后清空草稿）/ `用邮件客户端发送`（只要收件邮箱，
  拼 `mailto:`，**零凭证**）/ `复制内容`（总是可用，纯文本进剪贴板）。未配置时提交按钮**不置灰**——
  点下去会拿到 503 与原因，比一个死按钮更容易自查。
- **凭证优先从环境变量来**（后来补上设置页，见下一条）：`DSH_SIDECARD_SMTP_URL`（`smtps://user%40example.com:pass@smtp.example.com`；
  也接受共用的 `DSH_CRB_SMTP_URL`）或分开的 `DSH_SIDECARD_SMTP_{HOST,PORT,SECURE,USER,PASS,FROM}`。
  收件邮箱走 `DSH_SIDECARD_FEEDBACK_TO` / `DSH_CRB_FEEDBACK_TO`（**优先**）或配置项 `feedbackAddress`。
  `?from=` / `DSH_SIDECARD_SMTP_FROM` / `USER` 取到的发件地址必须像邮箱，否则整条 SMTP 路径判为未配置。
- **SMTP 也能直接在设置页填**（用户报「无法发送邮件」之后补的）：本机 DSH 进程里没有任何 `DSH_SIDECARD_*`
  变量——普通用户不会给 DSH 设环境变量，所以「凭证只能来自环境变量」等于「发送按钮永远 503」。于是新增
  `feedbackSmtpHost/Port/Secure/User/Pass/From` 六个配置项，折叠在「设置邮件发送（SMTP）」里，保存在
  用户层 `config.json`（仓库外，不进 npm 包）。**密码只写不读**：`/state` 删掉该键、页面永远拿到空串、
  空串保存＝保留原值、`/state` 的 `config` 里也没有它。默认端口 465 配隐式 TLS；587 走 STARTTLS。
  顺带修掉一个真 bug：**STARTTLS 现在只在 `EHLO` 回复声明了它时才升级**，否则会给没开 STARTTLS 的中继
  发一个必被拒的动词，把一个正常的明文中继判成「发信失败」。
- **没有新依赖**：`node:net` + `node:tls` 手写最小 SMTP 客户端（`sendSmtpMessage`）——多行 `250-` 应答汇总、
  `EHLO` → `STARTTLS`（非隐式 TLS 时）→ `AUTH PLAIN`（被拒回退 `AUTH LOGIN`）→ `MAIL FROM` → `RCPT TO` →
  `DATA`（dot-stuffing + `\r\n.\r\n`）→ `QUIT`，20 秒超时，finally 清 socket/timer。
- **邮件本身**：`text/plain; charset=UTF-8` + base64 正文，主题 RFC 2047 编码（中文标题不乱码），
  正文附插件版本 / DSH 版本 / Node 版本 / 平台 / 时间；**不含主机名、用户名、路径**。
- **限速与日志**：Host 侧 30 秒 1 封、1 小时 5 封，失败返回 `feedback-too-fast` / `feedback-too-many` 并带
  `retry-after`；只有真正投递成功才计入配额。日志只记 kind 与打码收件人（`o***@example.com`），**从不记正文**。
- **收件邮箱以 `b64:` 混淆打包**：默认值是维护者收件箱，存成 `b64:<base64>`，所以明文 `name@domain` 不出现在
  仓库与 npm 包里，挡的是正则抓取。**这是混淆不是加密**——`decodeAddress()` 就在同包里，拿到包的人总能还原；
  地址也仍可由用户层配置或环境变量整体接管。早期版本默认空字符串、要求每个部署方自己配；用户要求
  「跟 recycle-bin 的效果一样」之后改成现在这样，代价是维护者邮箱随包公开（可接受：反馈本来就该寄给它）。
- 错误码契约：`feedback-invalid`（400，边界/头注入）、`feedback-unconfigured`（503，缺收件人或缺 SMTP）、
  `feedback-too-fast` / `feedback-too-many`（429）、`feedback-send-failed`（502，附服务器原文）。
  `/state` 的 `capabilities.feedback` 给出 `{transport, configured, toMasked, reason, limits}`，设置页据此显示就绪状态。
- 顺手把深色主题下的主按钮字色改成深墨（`.dsa-btn-primary`）：这是全站一直存在的 2.79:1，不是本次引入，
  但新卡片里的「发送」正好是主按钮，一并修掉。
- 修复了一处顺带发现的真问题：`writeJson` 用 `res.writeHead(status, {...})` 会**丢弃**此前 `setHeader` 的值，
  429 的 `retry-after` 因此一直发不出去；`writeJson/writeError` 现在接受 `extraHeaders`。
- 测试：`contract` 新增 **232** 项（纯函数边界、`parseSmtpUrl`/`readSmtpFromEnv` 两种写法（含 `DSH_CRB_SMTP_URL`
  别名）、`b64:` 收件人解码、「环境变量优先于配置项」的优先级回归、`Reply-To:` 组头、组信的 base64 与 RFC 2047、
  限速闸门，以及一条**真 socket** 的 `/feedback` 端到端——本地 SMTP 假中继逐条断言 `AUTH PLAIN`、信封、`DATA`、
  编码后的主题与正文、限速 429 与 `retry-after`，并断言正文**没有进日志**）。
  总项数 1359 → **1582**（verify 57 + contract 1221 + float 78 + smoke 226）。
- **同日二次配置（用户要求「跟 dsh-conversation-recycle-bin 的效果一样」）**，四处对齐：
  1. 反馈横幅**默认收起**成一行，主按钮点开才展开表单（原来默认展开，把真正的设置项挤到屏幕外）；
  2. 「联系方式」改成**你的邮箱**：`type="email"` + 客户端格式预校验 + Host 侧再校验，填了作为 `Reply-To:`；
  3. 收件人默认值改为**打包的 `b64:` 混淆地址**，并让**环境变量优先**于它（原来配置优先，一旦默认非空，
     环境变量就永久失效）；`feedbackAddress` 也接受 `b64:` 形式并在解码后校验；
  4. 直接复用兄弟插件的 `DSH_CRB_SMTP_URL` / `DSH_CRB_FEEDBACK_TO`：本机只配一次，两个插件都能发信。
  实测（本机用户级 `DSH_CRB_SMTP_URL` 注入后）：`describeFeedback()` → `configured:true, transport:'smtp'`。
- **如实标注**：
  1. 只对**本地假中继**验证过协议，没有连过真实服务商（Gmail / QQ / 163 的应用专用密码、白名单、
     `MAIL FROM` 与 `USER` 同域等要求都未实测）；
  2. 设置页的**展开交互**仍无法在合成 DOM 里断言——`test/harness.mjs` 的 `useState` 不触发重渲染；测试覆盖的是
     「默认收起（`style.display:none`）、按钮存在、`aria-expanded='false'`、字段齐全」，展开后的输入与提交需在页面上手测；
  3. 「用邮件客户端发送」只验证了 URL 的编码，没有真的拉起系统邮件应用；
  4. 只有纯文本，没有附件/截图上传（见交付说明里的待确认项）。

## 1.8.4

**主题：选区旁的动作条从「六枚等价胶囊排成一排」改成一块面板加一个主操作——并顺手堵掉右侧被窗口裁掉的那条路。**

起因是用户截图（574×42）：「💬 追问选中内容」后面紧接 `解释 / 翻译 / 总结 / 润色 / 纠错` 五枚带边框胶囊，
全部挤在一行，右端被窗口边缘切断；用户的意见是「全部排成一排不好看」。

- **诊断（不是「一行」的问题，是层级与预算两个问题）**：
  1. 六枚胶囊同色同粗、各自带边框与阴影，读起来像六个并列功能，没有主操作；
  2. 定位宽度是**估算**出来的（`estimateLabelWidth(label) + 24` 相加），它只用于夹取 `left`，
     一旦估小或选区靠右，整条就会顶出右边缘——`max-width:min(620px,92vw)` 也挡不住，
     因为它是相对视口的，不是相对面板左边剩下的空间。
- **单一面板**：`.dsa-quickbar` 从「无底色的 flex 行」改成一块控件——`padding:3px`、`border-radius:12px`、
  中灰描边 `rgba(127,127,127,.5)`、`0 6px 20px rgba(0,0,0,.16)` 投影、`background:bg-overlay`。
- **一个主操作**：`.dsa-quickbar .dsa-trigger-embedded` 改成品牌实底 + 白字 + 600 字重；
  深色主题改深墨字 `#0a1428`（本机 uiskin 深色品牌 `#5b9cf5` 上白字实测 **2.79:1**，低于 4.5:1 正文下限；
  深墨 **6.57:1**），与 1.8.2 的分段芯片同一处理。
- **一条细分隔线**：`.dsa-quickbar-sep`（1px × 15px，`border-l1`）分开「做那一件事」与「或从现成问题里挑一个」，
  只在有快捷动作时渲染。
- **五个动作降级为幽灵胶囊**：`.dsa-quickbar .dsa-chip` 去掉边框/底色/阴影，字色 `label-secondary`，
  hover 才浮出 `bg-layer-2` 底与 `label-primary` 字色。弹层里的 chip 与右键菜单不受影响。
- **宽度改成算出来的**：`TriggerBar` 读 `window.innerWidth`，给面板加
  `max-width: min(620, 视口宽 − 面板左边 − 8)`，并用 `${Math.min(620, room)}px` 落到内联样式；
  放不下就换行（`flex-wrap:wrap`），不再被窗口切掉。`window` 不存在时（测试/SSR）取 620。
- **行为零变化**：键盘漫游（←/→/Home/End）、`Alt+1…5`、右键菜单、点芯片直接发问都照旧；
  不新增配置项——这是版式修正，不需要开关。
- 测试：`contract` 新增 **9** 项（渲染侧 3 条：恰好一个 `.dsa-quickbar-sep`、chips 自成一组、
  主按钮是 `dsa-trigger-embedded` 变体；样式侧 6 条：单一面板、品牌实底主按钮、chips 去边框、
  `.dsa-quickbar-sep` 规则存在、深色墨字覆盖、面板自带 `maxWidth` 上限）。总项数 1350 → **1359**。
- **如实标注**：交付时给的四张图（`design-preview/10-quickbar-*.png`）是**离屏渲染**——
  真 CSS 从 `client.js` 抽、主题值取自本机 uiskin 皮肤、无头 Edge 截图，不是运行中页面的截图；
  hover / focus 态与真实选区定位没有截图证明，需要在页面上手测（刷新即生效，`link:` 安装）。
- 顺手把 README §4.3 补成这一条的外观说明（含深色原因、换行行为与「不写配置项」的结论）。

## 1.8.3

**主题：右侧栏打开时，答案卡直接铺满它、读成栏内的一页——而不是 340px 的浮层压在右栏正文上。**

起因是用户截图：右栏开着「团队任务板」，答案卡浮在它上面，正文被挤成一条窄缝，标题与操作行占掉大半。

- **`dockRail`（默认 `true`）**：右栏可见且已展开时，把卡片铺到**标签条下方**的内容区——宽度取右栏宽，
  高度取到帧底；右栏自己的标签条仍然露出可点。这个形态下卡片去掉圆角、描边与阴影，只留一条左边线
  与右栏内容区分界；标题栏（追问 + 徽标 + ⇥/×）与底部操作行固定上下两端，`AnswerBody` 独立滚动，
  长答案不再把操作行推出视野。收起为胶囊（⇥）、关闭（×）或关掉本项，立即回到常规浮层。
- **几何是量出来的，不是猜的**：`dockedBodyRect(node)` 取右栏面板的 `getBoundingClientRect()`，若它在
  `[data-dockkit-pane]` 里，再把顶边抬到所有 `[data-dockkit-tab]` 的底边——否则卡片会盖住右栏自己的标签条。
  `findRail(scope)` 按世代尝试选择器（最具体的在前）：
  `[data-dsa-rail-host]`（本插件自己渲染在右栏里的 `CardHost` 节点——它所在的位置就是「一页正文」）→
  `[data-sidebar-right-panel][data-sidebar-right-open] [data-dockkit-pane]` → 面板本身 →
  `[data-sidebar-right-session][data-sidebar-right-open]` → `[data-dockkit-pane]` / `[data-dockkit-column]`
  （只渲染 dockkit 标记的构建）→ `.rightbar` → `[data-slot^="sidebar.right"]`；
  **只接受展开态**（折叠的面板会滑出帧外，它的 rect 不能用；`railOnScreen` 负责拒绝），量不到、
  宽 < 280px 或高 < 240px 一律回退浮层。
  这些标记不是文档给的，是从安装包里的 `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js` 读出来的。
- **纯函数 `railDock`**：`enabled` 为假、坐标非有限、宽高低于 280/240 → `null`（= 不 dock）；矩形夹进
  `[0,frameWidth] × [0,frameHeight]`，夹完仍不足最小尺寸也返回 `null`；`clipped` 表示「画出来的不是量到的」——
  尺寸被夹小，或原点被拉回帧内（右栏入场动画期间可能量到负坐标）。已导出到 `api.pure`，测试与运行时共用一份实现。
- **渲染**：`docked = mode === 'full' && dock !== null`；容器改 `data-dsa-float-mode="dock"` 并写 inline
  `left/top/width/height`（同时释放基类的 `right/bottom`，否则会过约束），`.dsa-stack` 带
  `data-dsa-dock-body="<px>"` 供对照；三种形态复用同一份 `cardNodes`，没有分叉出第二套卡片。
- **设置页**新增「右侧栏打开时占满它」复选框（只写草稿，点保存才落盘），并给出「收起为胶囊或关闭即恢复原状；
  右侧栏不在时不生效」的说明；三个 i18n 键（zh/en 各三条）。
- **为什么不做成"真的注册右栏的一页"（如实）**：`sidebarRightTabs` / `sidebarRight` 两个服务在当前构建里
  **确实存在**（从 `app.asar` 里读到 `ctx.reflect.provide("sidebarRightTabs", tabs)`），注册形状
  （`register({id, kind, guide, …})`）与槽派发键（`entryKey = definition?.id ?? tab.kind`，本插件两处都是
  `sidecard-ask:card`）也逐一核对过；但实测 `controller.openTab` 路径仍回落到浮层，且没定位到抛错点。
  在它修好之前，`dockRail` 是**视觉等价、失败即回退**的兜底层——README §6.1 仍把它标为占位接口，没有说成官方能力。
- **已知代价（如实）**：dock 期间会盖住右栏内容区里的其他面板（那些面板仍在下面），也会暂时压住右栏的
  拖拽改宽手柄；这两点都写进了 README §4.2 与代码注释。
- 测试：`float-placement` 新增 **40** 项（`railDock` 的夹取、最小尺寸、`clipped` 语义、不修改入参、非有限输入、
  `dockRail` 默认值、源码钩子、上面三个缺陷的回归断言，以及承载面自动链的顺序断言）；`contract` 新增 **8** 项
  （设置页复选框：唯一一行、单个 checkbox、默认勾选、带写草稿的 onChange、说明文案；承载面 `auto` 的
  新偏好）；3 个新 i18n 键由既有词典用例自动覆盖。
  总项数 1293 → **1350**。
- **发布前的一次真实回合（用户截图 + 一个「？」）修掉的三个缺陷**——首次交付的 dock 在真机上**没有生效**：
  卡片仍以约 505px 浮在右栏上，而右栏里留着一个正文写着「该卡片已关闭」的空 tab。
  1. `apply()` 里残留 `rail` 变量：改用 `railBox` 后旧守卫没删干净，一旦 `ResizeObserver` 回调进来就抛
     `ReferenceError: rail is not defined`，并且**右栏节点永远不会被 observe**。已删，并加回归断言
     （源码里不得再出现 `observed.has(rail)`）。
  2. **右栏开合不触发重算**：effect 依赖只有 `[maxWidth, total, mode, dockWanted]`，而被观察的是挂载时
     就已存在的节点——右栏是后开的，量不到就永远不 dock。现在的触发源有四个：`window resize`、
     `ResizeObserver`（对话区 + 当前被接受的那个右栏节点）、**只盯属性的 `MutationObserver`**
     （`data-sidebar-right-open` / `data-dockkit-pane-active` / `style` / `class`；**不盯 childList**，
     否则流式 token 每帧都会唤醒几何计算）、以及挂载后 `[80,200,420,800]ms` 四次重测（罩住右栏滑入动画）。
  3. **不再靠猜右栏标记**：`CardHost` 自己渲染在右栏里的节点就是「一页正文」，它的矩形就是答案。三个
     `CardHost` 包装节点加 `data-dsa-rail-host`，并作为 `RAIL_SELECTORS` 的**第一优先**锚点（设置页根节点
     故意不加，否则浮层会停靠到设置面板上）；其后才是 `data-sidebar-right-*`、dockkit 世代、`.rightbar`
     与 `sidebar.right` 槽。折叠态另由 `railOnScreen()` 拒绝（`left >= frameWidth - 1` 或
     `top >= frameHeight - 1` 视为不在屏上），不会被 `railDock` 夹进视野。
- **诊断属性**：浮层根节点新增 `data-dsa-dock`，取值 `dock` / `no-rail` / `rail-too-small` / `off` / `mode`，
  一眼区分「没找到右栏」「找到了但太窄」「开关关了」「当前不是完整卡片形态」。
- **承载面 `auto` 的顺序改了：dsh-better-sidebar → 内置浮层卡片；原生右侧栏退出自动链。**
  原因是那个空 tab：卡片被塞进右栏只是一个 tab，tab 的生命周期不归插件管——卡片关掉后右栏仍留着一条
  读作「该卡片已关闭」的标签，还和用户自己的右栏标签抢位置，落点又取决于我们不控制的宿主细节。
  原生右侧栏保留为**强制选项**（下拉里标注「强制，不参与自动」，新增 `surfaceNativeForce` 文案），
  显式 `sideSurface: 'native-rightbar'` 仍然走它。下拉顺序同步为 auto / 插件 / 内置卡片 / 强制右侧栏。
  连带把三条依赖「auto 会挑原生」的既有用例改成显式指定 `native-rightbar`（它们测的是原生适配器本身，
  不该再由 auto 顶上来）。
- 版本号三处同步到 1.8.3。

本机实测（四项均 exit 0）：verify **57** / contract **989** / float-placement **78** / smoke **226**
= **1350 项全部通过**（1.8.2 为 1293；float-placement 由 38 → 78，含 `railDock` 用例、上面三个缺陷的回归钩子，
以及「自动链里不出现原生右侧栏」的顺序断言；contract 972 → 989）。

> 未验证（如实记录）：`design-preview/09-dock-{light,dark,narrow-light}.png` 三张图是**离屏渲染**——
> 无头 Edge 加载"从 `client.js` 切出的真实样式表 + 本机 uiskin 皮肤令牌真值 + 按 `app.asar` 里读到的
> 右栏标记搭的静态结构"的页面，**不是**运行中 DSH 窗口的截图。因此它证明的是"这套 CSS 在给定矩形里
> 摆成什么样"，不证明真实页面里右栏的实测矩形、滚动性能，也不证明 dock 与右栏拖宽手柄的冲突手感。
> 这些仍需刷新页面人工确认（README §9 A 路径第 9 条给了可执行的判据）。

## 1.8.2

**主题：提问框底部的「作答位置」从"两枚看不出选中哪一侧的标签"改成一眼可辨的分段芯片；并把 1.8.1 之后写在本地、尚未提交的弹层对比度修补一并发布。**

起因是用户截图：弹层底部「作答位置 ｜ 主对话 ｜ 侧边卡片」两个选项长得几乎一样，看不出答案会去主对话还是侧边卡片。

- **选中态不可辨（用户反馈，已复现）**：旧选中态只有 `background: var(--dsw-alias-bg-layer-2)`，
  叠在弹层 `--dsw-alias-bg-overlay` 上几乎是同色（本机皮肤下 `rgba(243,247,253,.95)` on
  `rgba(248,251,255,.98)`），选中与未选中的差别只剩字重。
  改法：`.dsa-seg` 变成带中灰描边（`rgba(127,127,127,.5)`）与内凹阴影的轨道；两个选项各带一枚 13px
  内联 SVG 图标（气泡＝主对话，带右轨的框＝侧边卡片），**选中侧为品牌实底 + 白色 600 字 + 内白环 + 投影**，
  未选侧为 `label-secondary` + 透明底；补 `:hover` 与 `:focus-visible`（品牌色 outline）。
  组件抽成 `CarrierSeg`（client §9），带 `role="group"`、`aria-pressed`、`title` 说明；文案仍走 i18n。
- **深色主题里白字压品牌色只有 2.79:1（复核时发现的，非用户反馈）**：本机皮肤深色把
  `--dsw-alias-brand-primary` 提亮到 `#5b9cf5`，白色 600 字在其上低于 4.5:1 正文下限、也低于 3:1 大字下限。
  改法：`[data-ds-dark-theme]` 下选中侧改用深墨 `#0a1428`（实测 6.57:1）；浅色保持白字
  （`#2563c0` 上 5.79:1）。令牌值取自本机 `uiskin-theme`，对比度按 WCAG 相对亮度公式实算，不是目测。
- **弹层边框/阴影修补（1.8.1 之后写在本地、未提交，本次一并发布；含一处数字更正）**：`.dsa-pop` 的 1px 边
  改显式中灰 `rgba(127,127,127,.55)`，阴影改两层衰减
  `0 14px 36px rgba(0,0,0,.30), 0 3px 10px rgba(0,0,0,.14)`；`.dsa-pop` 内的次级文案改用
  `label-primary` 并保留 `.78` 不透明度。
  **更正**：随该补丁一起写下的代码注释声称"外框用 `border-l2` 只量到 ≈1.3–1.7:1"，实测不成立——
  按本机皮肤令牌复合（bg-base .55 over white → bg-overlay .98）后，`border-l2` 是 **1.95:1（浅）/ 2.88:1（深）**；
  1.40:1 那个数字属于内层 `border-l1` 的 1px 边。换成中灰 .55 后测得 **1.96:1（浅）/ 2.12:1（深）**——
  所以这一步是**色度修正（蓝对蓝 → 中性灰），不是亮度对比度提升**，深色下还略弱。
  真正抬高可读性的是两层阴影与次级文案换成 `label-primary`（6.11:1）。
  若需要更强的实体边框，中灰 .85 测得 ≈3.03:1，但视觉更硬，未擅自采用。
- 测试：contract 新增 **16** 项钉住这个控件（唯一 `.dsa-seg`、恰好两个按钮、恰好一个
  `aria-pressed="true"`、每个选项带一枚内联 `svg`、`data-on` 只有一个真值、两个去向的标签不互换、
  品牌实底规则与深色覆盖规则必须出现在样式表里）。**点击切换本身仍然不可测**：harness 的
  `useState` 只回队列式 setter、不触发重渲染，注释里写明了原因，没有假装测过。
- 版本号三处同步到 1.8.2。

本机实测（四项均 exit 0）：verify **57** / contract **972** / float-placement **38** / smoke **226**
= **1293 项全部通过**（1.8.1 为 1277，contract 956 → 972）。

> 未验证（如实记录）：浅色/深色两张对比图（`design-preview/07-carrier-seg-{light,dark}.png`）是
> **离屏渲染**——无头 Edge 加载"从 `client.js` 抽取的真实 CSS + 本机皮肤真实令牌值"的静态页，
> 不是运行中 DSH 窗口的截图。真实页面里的点击手感、字体栅格化差异、弹层背后背景图的影响，
> 仍需刷新页面人工看一次。此前一轮口头汇报里说"新增 8 条"是数错了，实际新增 16 条。

## 1.8.1

**主题：对 1.8.0 交付做实证复核后的三项修正——1 个已复现的真实缺陷、1 处开关失效、1 条缺证据的声明。**

复核方式：不采信文档，独立跑四套测试、读全部新增代码、对可疑点写最小复现脚本并落盘证据。

- **P0（真实缺陷，已复现）「清空全部历史」刷新后复活**：`clearHistory()` 只删了当前的
  `:cards:v3` 键，而 `readPersisted()` 在 v3 缺席时会回落到 `:cards:v2` → `:cards:v1`
  （这条回落正是"非破坏式迁移"的实现方式）。于是**从 1.7.x 升级上来的用户**点「清空全部历史」
  后刷新页面，旧卡片会从遗留的 v2 键整份读回来——2026-10-17 用独立脚本复现
  （清空前 history=1 → 清空后=0、v3 键为 null、v2 键仍在 → 重载后 history=1，卡片 id 为旧数据）。
  修法：`clearHistory` 同时删除 v3/v2/v1 三代键（显式清空本就是破坏性操作，它是唯一允许丢弃旧键的动作）。
  测试为什么原先没拦住：旧用例只断言"v3 键被删掉"，且只播种 v3 键、清空后**不重载客户端**——
  钉的是实现细节而非用户可见结果。新增用例覆盖"遗留 v2 + 清空 + 重载仍为空"。
- **P2（开关失效）建议追问芯片未跟随 `followUpSuggestions`**：只要答案里存在 `<followups>` 块，
  芯片就渲染，与默认关闭的 opt-in 语义不符。现在渲染跟随开关；**块剥离保持无条件**
  （模型乱写标记时，正文仍不会被污染成散文）。旧用例正是"开关关闭却断言芯片出现"，已改为开启态，
  并补关闭态回归守卫。
- **P1（证据链 + 勘误）`inputActions` 写入面**：1.8.0 把"官方写入面存在
  `captureInsertion()` / `insertText()` / `setDraft()`"写成探针的第④条结论，但
  `.compat-report/scripts/composer-probe.mjs` 的正文**从未探测 `inputActions`**（只有脚本头注释
  承诺过），仓库内也没有任何证据文件出现过这两个标识符。经复核，**声明本身成立**，现补产物层证据：
  `npm pack @deepseek-ai/dsh-client-ui-conversation@0.2.0-rc.2` 与 `@0.2.1-rc.2` 解包后，
  `lib/types/client/contract/input.d.ts` 含 `captureInsertion(): TokenSpan` 与
  `insertText(text: string, span: TokenSpan): boolean`，`lib/client.js` 含 `var SessionInputShell = class`。
  逐条命中、行号与官方契约原文见 `.compat-report/evidence/p2-inputactions-contract-2026-10-17.json`；
  README §6.3 与 1.8.0 条目已就地勘误，探针脚本头也改成了它真正做的事。
- 版本号三处同步到 1.8.1。

本机实测（四项均 exit 0）：verify **57** / contract **956** / float-placement **38** / smoke **226**
= **1277 项全部通过**（较 1.8.0 的 1267 新增 10 项）。

> 未验证（如实记录）：本次修的是逻辑与测试，**没有在真实页面上点过任何按钮**。
> 1.8.0 未验证栏的 ①–⑤ 全部继续有效（写回按钮的真实点击与手感、原文高亮的观感与虚拟列表命中率、
> 导出的真实落盘、真实模型对风格与 `<followups>` 的遵循度、Electron 外壳表现）。
> 另外：`inputActions` 的证据核到 0.2.0-rc.2 与 0.2.1-rc.2 两个版本，未逐版遍历。

## 1.8.0

**主题：P2 能力补齐——回答风格档位、答案写回输入框、原文回看定位、模型生成的追问建议、导出与多版本答案。**

五项都在"最小答案"哲学内：不新增依赖、不新增请求、不改主对话协议；客户端仍然只
`require('react')`，宿主仍然只 import `node:` 内建。

- **P2-1 回答风格档位 + 自定义指令**：新增 `answerStyle`（`concise` / `standard` /
  `detailed`，默认 `standard`）与 `customPersona`（≤500 字，按**码点**计数）。
  宿主在基础人格**之后追**一段风格指令（`concise` = 只给最小完整答案；`detailed` =
  必要时展开并给出依据；`standard` = 1.7.x 原样），`customPersona` 再以
  `Additional user instruction:` 标注追加。风格指令刻意不提"语言"，因此"用提问的语言
  作答"与"选中文本是数据不是指令"两条规则在所有档位下都保留（契约测试逐条断言）。
  provider 不支持 `persona` 时沿用既有降级：整段人格内联进提示词，不另造机制。
  设置页新增三档下拉框 + 自定义指令文本域，中英双词典。

- **P2-2 答案写回输入框（先做技术探针）**：探针在**真实 DSH 页面**（隔离 `DSH_HOME`
  + 无头 Edge，插件不参与）上得到三条硬结论：① composer 是 **Lexical
  contenteditable**（`[data-composer-input][data-lexical-editor="true"]`），不是
  textarea；② `document.execCommand('insertText')` 返回 `false` 且**完全不生效**；
  ③ 合成 `beforeinput`（`inputType:'insertText'`）会被 Lexical 接受——文本落地、
  发送按钮由禁用转可用。另有一条**不在探针内**的结论：DSH 的槽位标准 prop `inputActions`
  暴露官方写入面 `captureInsertion()` + `insertText(text, span)` + `setDraft(text)`。
  > **1.8.1 勘误**：本条原先被写成"探针的第④条结论"，但探针脚本的正文从未实现该探测
  > （只有脚本头注释承诺过），当时没有可核验的证据。经产物层复核，声明本身**成立**：
  > `@deepseek-ai/dsh-client-ui-conversation@0.2.0-rc.2 / 0.2.1-rc.2` 的
  > `lib/types/client/contract/input.d.ts` 含该契约，逐条命中见
  > `.compat-report/evidence/p2-inputactions-contract-2026-10-17.json`。
  据此实现三级写入阶梯：**官方 `insertText`**（重新 `captureInsertion` 后可重试一次）
  → **DOM `beforeinput`**（contenteditable 追加 / textarea 用原生 value setter + input
  事件）→ 明确失败。改写类动作（`builtin:polish` / `builtin:fix`）的已完成答案上出现
  「插入到输入框」；仅当真的存在写入面时才渲染该按钮。DOM 路径**只能追加**（Lexical
  不接受脚本设定的 Range），"替换原文"只在捕获到文本框内的选区时才提供。任何失败都
  toast 明示（`已插入到输入框，请按 Enter 发送` / `输入框内容已变化…` / `找不到可写入的输入框`）。

- **P2-3 原文回看定位**：卡片与历史管理条目新增「查看原文」。用**码点级首尾签名**
  （各 40 码点）在页面文本节点中反查；遍历跳过本插件 DOM（`[data-dsa-root]`）与
  编辑框；匹配前对两边做空白归一（连续空白 → 单个换行）并保留回原始索引的映射，
  因此跨段落选中也能命中，且"同一开头出现两次"时用尾签名挑对那一段。
  高亮**优先 CSS Custom Highlight API**（`CSS.highlights` + `Highlight`，不改 DOM，
  实测本机 Edge 155 支持），次选 `window.getSelection()`；4 秒后自动清除，多次点击
  不叠加。找不到时明示「原文已变化或不在当前视图」——**不承诺 100% 命中**：虚拟列表与
  DOM 重渲染必然存在失败场景（README §14 已写明）。

- **P2-4 模型生成的追问建议**：新增 `followUpSuggestions`（布尔，**默认 false**）。
  开启后宿主在人格末尾要求模型用 `<followups>问题1 | 问题2</followups>` 输出 2–3 个
  建议；客户端**宽容解析**：无块 / 半块 / 多余闭合标签 / 块超 600 字符 / 单问超 120
  码点 / 重复项 / 超过 3 条，全部退化为"无芯片"，绝不报错、绝不影响答案正文。
  流式期间从**未闭合的 `<followups>` 起整段隐藏**，并额外隐藏末尾的半个标签
  （`<fol`、`</follow`、孤立 `<`），避免标记闪现；`done` 后整体解析。点击芯片走既有
  `followUp`（旧问答进 history）。**不额外发请求**（smoke 断言一次 ask 只启动一个子代理）。

- **P2-5a 导出 Markdown**：单卡「导出 .md」+ 历史管理「导出全部 .md」。`card.text`
  本身是 Markdown，导出时拼上问题标题与 `> 原文` 引用块后整体落盘，保真无损；
  Blob + `URL.createObjectURL` + `a.download`（**不往 `document.body` 插节点**），
  文件名带本地时间戳，`finally` 里 `revokeObjectURL`。导出内容由纯函数
  `buildCardMarkdown` / `buildHistoryMarkdown` 生成，测试直接断言字符串，不触发下载。

- **P2-5b 多版本答案**：`retry` / `retryEdit` 覆盖答案前把旧问答（含 reasoning）
  存入 `card.versions`（上限 **5** 条，空答案不记、完全相同的重试不重复记）。
  卡片上出现版本切换条，旧版本**只读**渲染（复用 `renderRichText`），可一键「返回最新」。
  localStorage schema **v2 → v3**（新增 `versions`）：读取顺序 v3 → v2 → v1，**旧键全部保留**，
  损坏数据仍降级为"无历史"。

- 新增 CSS：`.dsa-sug`（建议芯片行）、`.dsa-versions`（版本切换条）；两者均渲染在既有
  `.dsa-card` 之内、只使用 `--dsw-alias-*` 主题令牌，**没有新增浮层根节点**，
  因此既有的 `-webkit-app-region:no-drag` 守卫原样覆盖它们。

本机实测（四项均 exit 0）：verify **57** / contract **946** / float-placement **38** /
smoke **226** = **1267 项全部通过**（较 1.7.2 的 1004 项新增 263 项）。

> 未验证（如实记录，测试通过不等于真机通过）：
> ① P2-2 的「插入到输入框」按钮**没有在真实页面里点过**——探针验证的是写入机制
> （官方 `insertText` 存在、`beforeinput` 能改 Lexical 状态），插件的按钮渲染与点击链路
> 只由契约测试覆盖；insert 的真实手感、插入位置（末尾追加而非光标处）需人工确认。
> ② P2-3 的**视觉观感未验证**：高亮颜色/对比度、滚动落点、4 秒后清除的实际观感，
> 以及虚拟列表滚动后的命中率，均未在真实会话里逐项点过；CSS Highlight 的**能力**已实测。
> ③ P2-5a 的真实下载未验证：测试环境没有 `anchor.click()`，只断言了"失败必须 toast"；
> 浏览器/Electron 内是否真的落盘、中文文件名是否正常，需人工确认。
> ④ P2-1 / P2-4 对**真实模型的**风格与 `<followups>` 遵循度未验证（本机无模型凭据），
> 验证到的是"指令确实进了人格/提示词"与"客户端对任意畸形块都能降级"。
> ⑤ 桌面 Electron 外壳内的表现（窗口拖拽区、下载权限）未复测。

## 1.7.2

**主题：文档补丁版——把 DSH 0.2.1-alpha.3 / 0.2.1-alpha.4 的适配核查结论带上 npm 包。**

功能与 1.7.1 **完全一致，没有任何行为改动**（`index.js` 与 `client.js` 只有版本号字符串不同，
可用 `git diff` 逐字节核对）。这个补丁版存在的理由是发布两项文档更新：

- **README §7.3** 新增「1.7.1 复核（2026-10-16）」真机验证记录——**0.2.1-alpha.3 / 0.2.1-alpha.4
  两版均无需任何代码改动**：产物层（16 项能力矩阵在 alpha.2/3/4 上逐项一致；13 个相关包的逐文件
  SHA256 diff 证明 alpha.3 → alpha.4 宿主侧零变化，`dsh-subagent` 的 `lib/index.js` 两版逐字节一致；
  主包唯一新增依赖 `dsh-experimental-plugin-market-bundle`）、真机层（隔离 `DSH_HOME` 从零安装、
  官方 CLI 装入 `npm pack` 产物、无头 Edge：**28/28 断言 × 两版全过**，含
  `subagents.startActivation` 实调出真实 childId）、插件四套自测 **1004 项全过**。核查针对 v1.7.1
  完成；本版除版本号外与之逐字节相同，结论原样适用。
- **README §7.4 / §14**：真机覆盖范围更新至 0.2.1-alpha.4（1.6.0 与 1.7.1 两轮实测）；§14 第 6 条
  修正 1.6.0 轮次遗留的过期表述（「除 0.1.7-rc.2 外只做过产物层验证 / 289 项」→「安装启动验证从
  0.1.5-rc.3 起 / 1004 项」），第 2 条补 §7.3 指向。
- 版本号三处同步到 1.7.2：`package.json` 的 `version`、`index.js` 的 `PLUGIN_VERSION`、
  `client.js` 的 `CLIENT_VERSION`（`test/verify.mjs` 会同时断言三处一致）。
- 核查的完整证据（复现脚本 / 原始输出 / 截图）随本版提交进 `.compat-report/`——`wb-*` 前缀为
  2026-10-16 的独立复核产物，报告见 `COMPATIBILITY-REPORT-alpha3-alpha4.md`。

本机实测（四项均 exit 0）：verify 53 / contract 721 / float-placement 38 / smoke 192 = **1004 项全部通过**。

> 未验证（如实记录）：真实模型流式作答（本机无凭据，验证到 spawn + childId 深度，完整
> `start→delta×N→done` 由 smoke 按真实事件形状覆盖）；桌面 Electron 与 better-sidebar 共载本轮未复测。

## 1.7.1

**主题：P1 体验补齐——后台通知、历史卡片管理、答后追问芯片、右键菜单、作答透明信息、键盘操作。**

- **作答完成后台通知**：新增 `notifyOnDone`（默认关）。仅当页面处于后台（其它标签页/窗口）且作答
  到达终态（完成/失败）时弹系统 Notification；设置页打开开关时即时请求浏览器通知权限，
  权限拒绝/环境不支持时就地说明并静默降级；同一张卡至多通知一次，点击通知聚焦页面。
- **历史卡片管理中心**：localStorage schema **v1 → v2**（新增 `createdAt`、provider、耗时）；
  首次启动自动从 v1 非破坏式导入（v1 键保留，便于降级）。设置页新增「历史追问卡片」区：
  关键字搜索（问题/答案）、恢复到浮层、复制、单条删除、清空全部（带确认）。
  新增 `historyMaxCards`（0–50，默认 10，**0 = 不写盘**）。语义变化：**关闭浮层卡片不再删除
  持久历史**（1.7.0 及以前会随关闭清空），历史改由管理中心显式删除。
- **答后通用追问芯片**：已完成/已停止的侧边卡片答案下出现「更简短 / 更详细 / 举个例子 /
  译成英文」四个固定芯片，一键追加一轮（旧问答进入 history，区别于 1.7.0 的「改问」重新生成当前轮）。
- **选区右键菜单**：新增 `contextMenu`（默认开）。在可触发区域右键选中文字时，菜单顶部出现
  「追问选中内容」+ 前三个已启用快捷动作；任何门槛不满足（编辑框内/区域过滤/开关关闭/非 leader）
  都**不拦截**原生右键菜单，作为与宿主菜单冲突时的回退；滚动/Esc/外部点击自动关闭。
- **作答透明信息**：卡片问题下显示 provider（子代理）与本次作答耗时（`<1s`/`Ns`/`XmYs`），
  随历史持久化；开始事件的 `provider` 字段下放到卡片。
- **键盘操作**：提问框中 `Alt+1..9` 直接触发对应芯片；芯片行支持 ←/→/Home/End 焦点环移；
  卡片可聚焦（tabIndex 0），聚焦后 `R` 重试（失败/停止态）、`C` 复制答案、`Esc` 取消聚焦，
  卡片标题悬停可见按键提示；插件自身输入框内不拦截任何快捷键。
- 新增样式 `.dsa-ctxmenu/.dsa-ctx-item/.dsa-fu-chips/.dsa-hist-*`，右键菜单根节点同步
  Electron `-webkit-app-region:no-drag` 守卫；中英词典新增 40+ 键（整表奇偶断言锁定）。

本机实测：verify 53 / contract 721 / float-placement 38 / smoke 192 = **1004 项全部通过**
（较 1.7.0 的 861 项新增 143 项；含通知决策真值表/耗时格式化/v1→v2 迁移与
历史恢复-删除-清空/右键菜单拦截与开关回退/Alt+数字与答后芯片端到端/新配置宿主校验等）。

> 未验证（如实记录）：浏览器与桌面 Electron 内的视觉观感与真实点按仍需人工确认——重点是
> ①系统通知在切后台后的真实弹出与权限弹窗；②右键菜单是否与宿主自身选区菜单冲突
> （Electron 菜单加速键也未在真机验证）；③历史管理区长列表观感。测试覆盖组件树、
> 事件监听与端到端数据流，替代不了真机观感。

## 1.7.0

**主题：P0 交互提效——一键快捷动作、自定义动作模板、改问重试、代码块复制。**

- **一键快捷动作条（划词主路径 4 步 → 1 步）**：选中文字后，触发按钮旁直接出现
  「解释 / 翻译 / 总结 / 润色 / 纠错」五个动作芯片，点击即跳过提问框、以预置问题
  直接在侧边卡片发起作答；提问框顶部也有同一排芯片（`Alt+Q` 与"仅快捷键"用户同样可达）。
  芯片 `title` 悬停展示完整问题指令与快捷键。
- **自定义动作模板**：新增配置项 `quickActions`（三层合并、随用户层持久化）。
  设置页「快捷动作」区可启用/停用内置动作、为每个动作配独立快捷键、新增/删除自定义动作
  （名称 + 问题指令 + 快捷键），问题指令支持 `{selection}` 占位符（内嵌选中正文；
  不写占位符时原文按既有方式随问题附上）。内置 5 个动作的文案在客户端按界面语言解析，
  配置与线协议保持语言中立。
  - 宿主端新增**有界结构校验** `sanitizeQuickActions`：≤12 条、id 唯一且 ≤40 字符、
    自定义动作名称 1–20 字 / 问题 1–500 字、快捷键 ≤40 字符；任何一条非法即**整表拒绝**
    （`/config` 返回 `invalid-config`），不做半表保存。客户端保存前同样预检，
    并检查动作快捷键之间、动作与主快捷键之间的冲突（大小写不敏感）。
  - 每个动作的快捷键在页面 keydown 捕获阶段分发：主快捷键优先；在插件自己的输入框/编辑器中
    不拦截任何快捷键；无选区时回退到最近一次触发候选（与主快捷键同语义）。
- **编辑问题后重新提问（改问重试）**：终态侧边卡片（已完成 / 失败 / 已停止）新增「改问」按钮，
  就地编辑原问题后**重新生成当前这一轮**（不把旧问答压入 history，区别于"继续追问"的追加一轮）；
  原「重试」保留（原样重发，仅失败/停止态显示）；空问题不触发。
- **代码块单独复制**：答案中的围栏代码块右上角新增复制按钮，复用既有剪贴板 API →
  选区降级链与 toast 提示；`pre` 改为 `pre-wrap` 容器承载，代码文本与样式不变。
- 浮层/弹层样式新增 `.dsa-quickbar` / `.dsa-chip` / `.dsa-pre-wrap` / `.dsa-code-copy` /
  `.dsa-qa-*`，并同步加入 Electron 窗口拖拽守卫（`-webkit-app-region:no-drag`）。

本机实测：verify 53 / contract 589 / float-placement 38 / smoke 181 = **861 项全部通过**
（较 1.6.0 的 577 项新增 284 项；含动作解析/占位符截断/快捷键冲突/宿主整表校验/
芯片与触发条渲染/quickAsk 与 retryEdit 端到端/代码块复制按钮/中英词典整表奇偶等用例）。

> 未验证（如实记录）：浏览器与桌面 Electron 内的视觉观感与真实点按——本工作区无 GUI 自动化
> 接入运行实例，动作条换行/定位、芯片点击、代码块复制按钮、设置页编辑器需在真实页面按
> README 第九节路径人工确认；单测覆盖组件树与端到端数据流，替代不了观感验证。

## 1.6.0

**主题：最新版 DSH（0.2.1-alpha.2）适配 + 新旧包名共载时的单例护栏。**

十版本真机矩阵（隔离 DSH_HOME、真实安装启动、HTTP/探针双证据）发现并修复：

- **0.2.1-alpha.2 侧边作答引擎失效（真问题）**：该版本把 `subagents.start(provider, request)`
  重构为受管激活 API `subagents.startActivation({provider, label, request, signal, delivery})`
  （返回值由 `{id, localAgent, result, dispose}` 变为 `{childId, result, dispose}`）。
  旧代码的能力门只认 `start()`，导致 provider 明明注册成功（spawn/fork）却自检显示
  「侧边作答引擎：不可用」，侧答走降级。现按运行时方法面自动选择两代 API：新 API 用
  `delivery: 'caller'` 保持"答案不进主对话"的旧语义，流式帧改由子会话 id 归因（新运行时不再
  提供 live Agent 句柄）。0.1.5-rc.3～0.2.1-alpha.1 的调用路径保持不变。
- **新旧包名同时启用时双重触发（真问题）**：`dsh-selection-followup`（≤1.0.1 旧名）与
  `dsh-sidecard-ask` 被同时装入一个 profile 时，选区旁叠出两个悬浮按钮，一次 Alt+Q 弹两个
  提问框。现新增**页面内家族注册表**（`window.__dshSidecardFamily`）：协作的副本按版本号选举
  唯一领导者（同版本先加载者胜），落选副本保留设置页（显示停用说明横幅）但不挂载任何交互面、
  不响应快捷键；无法协作的 1.0.x 旧版通过结构特征识别（无 owner 标记的 `dsa-layer`），
  领导者注入一条样式规则隐藏其整个交互层，并提示卸载旧包。
- **data-slot 锚点自检结果不稳定（真问题）**：旧逻辑用"当前选区是否落在锚点链内"反推
  "本版本是否支持锚点"，选区落在直接挂 body 的节点（引导弹窗、第三方裸 DOM 面板）时会把
  全局判定翻成"缺失"，导致同一次自检两次结果不一致。改为构建级探测（全文档是否存在
  `[data-slot]`），单个无锚点选区不再影响全局判定。

客户端自检上报新增 `family` 字段（leader/legacy/peers），宿主侧白名单做同样的长度裁剪。

本机实测：verify 53 / contract 323 / float-placement 38 / smoke 163 = **577 项全部通过**；
另在 0.2.0-rc.2 与 0.2.1-alpha.2 真机（headless）复核：两版引擎均可用、共载单实例、
锚点判定稳定、better-sidebar 0.25.0 承载面识别正常。

## 1.5.1

**主题：1.5.0 的发布收尾——把发布闸门补全，并把校验记录进版本号。**

功能与 1.5.0 **完全一致，没有任何行为改动**（`client.js` 与 `index.js` 只有版本号字符串不同，
可用 sha256 逐字节核对）。这个补丁版存在的理由是发布流程本身：

- `README` 第十三节的发布闸门原先只列了 `verify` / `contract-test` / `smoke-test` 三个脚本，
  **漏掉了 1.5.0 新增的 `float-placement`**——照那一节执行会漏跑浮层几何用例（1.5.0 发布时就漏跑了，
  事后才补上，38 项通过）。现已把 `node test/float-placement.mjs` 加进闸门，并把 `git tag v1.5.0`
  改成 `git tag v<package.json 的 version>`，避免照抄上一版的标签号。**1.5.0 的 npm 包内 README 是补全前的版本，这一版起才是补全后的。**
- 版本号三处同步到 1.5.1：`package.json` 的 `version`、`index.js` 的 `PLUGIN_VERSION`、`client.js` 的 `CLIENT_VERSION`
  （`test/verify.mjs` 会同时断言这三处一致）。这样 npm 上的 `latest` 带上了完整的闸门说明，
  下一次发布不会再照着缺一行的清单执行。
- 1.5.0 的发布过程有个值得记的坑：`npm publish` 返回的是 **HTTP 202 "being processed"**，
  之后约 2 分钟 registry 文档仍显示 `latest: 1.4.0`、`...-1.5.0.tgz` 还是 404。
  这**不是失败**，不要立即重发（重发会撞版本已存在）；等 2–5 分钟再查 `npm view dsh-sidecard-ask dist-tags` 即可。

本机实测（四项均 exit 0）：verify 53 / contract 296 / float-placement 38 / smoke 138 = **525 项全部通过**。

## 1.5.0

**主题：浮层不再压住主对话——「A 胶囊 + C 右栏」定案，一个算宽度的纯函数 + 一个默认收起的形态。**

用户实测反馈（截图：原文被卡片尾部盖住）：右下角卡片从 `right:16px` 往左固定铺 400px，
截图上（1400px 宽的窗口）对话区右边界 x≈971，而**卡片左边界 x≈858，压进对话区约 113px**。
如实记录一点：这个位置关系随帧宽变化——1400px 下理论值是 `1400−16−400=984`，本身并不越界；
问题是宽度写死 400px，窗口一窄就必然压住正文（这正是截图里的情形）。
同时定案 A（悬浮胶囊，可随时收起/隐藏）+ C（停靠原生右侧栏）。

### 位置：宽度由预算决定，不再固定 400px

- A1 新增纯函数 `floatPlacement({frameWidth, laneRight, railLeft, maxWidth})` →
  `{width, avail, capped, bleeds}`：`avail = 帧宽 − 8 − 对话区右边界`，有右栏时再取
  `min(avail, 帧宽 − 右栏左边界 − 10)`；`width = min(上限, max(240, avail))`。
  语义是**浮层只使用对话区右侧那条预留带，不越过对话区右边界**；只有带宽跌破 240px（胶囊再窄就不可用）
  才允许压入，并把这种情况如实报成 `bleeds`。
- A2 浮层 `right` 锚定帧右边缘，宽度写进 CSS 变量 `--dsa-float-w`（不再有 `width:min(400px,92vw)`）；
  挂载、窗口 resize、右栏开合（`ResizeObserver`）时重算，流式刷新只重渲染不清算几何。
- A3 新增配置 `floatMaxWidth`（240–560，默认 **340**）：实际宽度是 `min(上限, 可用带宽)`。
  旧的 400px 在多数窗口下本就超预算，故默认下调到 340。
- A4 浮层节点带 `data-layer-width` 与 `data-dsa-float-mode`：出问题时截图即可定位几何与形态。

### 形态：默认胶囊，随时收起或隐藏

- A5 新增配置 `floatMode`（`capsule` | `full` | `off`，默认 **`capsule`**）：作答期只有一行，
  完成后显示问题首句；`full` 展开为完整卡片栈；`off` 只留一个带计数的圆点启动器。
- A6 运行时可即时切换且**不写回配置**：卡片标题栏右侧新增两个**图标按钮**「⇥ 收起为胶囊 / × 隐藏浮层」
  （完整文案放在 `title` 与 `aria-label`——中文全称 12 个字以上，写成文字会把标题栏挤成两行），
  它们只改会话内状态（`state.floatMode`），刷新后回到设置页的默认形态——按一下隐藏不会变成永久设置。
  这两个按钮只有浮层里的卡片才有；被原生右侧栏 tab 承载的同一张卡不传该回调，因此不出现（宿主 tab 不会遮挡对话区）。
- A7 设置页新增「浮层默认形态」「浮层宽度上限」两项控件。

### 视觉

- A8 卡片阴影 `0 10px 30px rgba(0,0,0,.22)` → `0 4px 16px rgba(0,0,0,.10)`
  （DSH 主题**没有**阴影令牌，只能硬编码 rgba；数值参照其 14 个 `--dsw-alias-*` 令牌的对比度下调）。

### 测试

- 新增 `test/float-placement.mjs`：把几何写成断言——旧实现固定 400px，在**帧宽收窄**时左边界必然越到
  对话区右边界左侧（用例 fixture：帧 1380 / 边界 980 / 右栏左界 1010 → 旧左边界 964 < 980，新实现同组不越界）；
  并如实保留一条「上报帧宽 1400 时旧实现 984 其实并未越界」，防止把一个随窗口变化的位置关系说成永远成立。
  另含 8 种帧宽 × 4 种右栏宽的不变量（有空间就绝不越界）；带宽条带与极端值（390px 带宽得 390 且 `capped`
  为 false、`avail` 取夹取前的原始预算、NaN 退化到 240 而非 NaN、上限 9999 夹到 560、上限 10 夹到 240）；
  纯函数性（不改输入、同入同出）；默认形态必须是 `capsule`；以及源码里旧固定 400px 规则确实已消失
  （防止只改测试不改实现）。
- `test/contract-test.mjs` 的两面默认值等价断言（`pure.CLIENT_DEFAULTS` 对 `host.DEFAULT_CONFIG`）覆盖新键。
- **既有契约用例改为显式要求 `floatMode: 'full'`**：`test/contract-test.mjs` 里读卡片正文的三处
  （思考过程、刷新后重放、渲染证明回退）本来依赖「浮层就是卡片栈」，而新的默认形态是胶囊——
  这些用例断言的是**卡片内容**，所以它们显式要 `full`；胶囊这个默认值本身由 `float-placement` 断言。
  不改它们的话，默认值一改就会三处变红，而那不是回归。
- 版本三处同步到 1.5.0：`package.json` 的 `version`、`index.js` 的 `PLUGIN_VERSION`、`client.js` 的
  `CLIENT_VERSION`（`test/verify.mjs` 会同时断言这三处）。

### 本机实测结果（权威）

- `node --check` 对 `index.js`、`client.js` 与全部 `test/*.mjs`、`tools/compat-probe.mjs` 通过（exit 0）。
- `node test/verify.mjs` → **53 passed, 0 failed**（含 zh/en 两本词典的 `t()` 键覆盖断言）。
- `node test/contract-test.mjs` → **296 passed, 0 failed**。
- `node test/float-placement.mjs` → **38 passed, 0 failed**。
- `node test/smoke-test.mjs` → **138 passed, 0 failed**。
- 诚实记录：`float-placement` 第一轮报 **7 条红**，逐条查完**全部是我把测试写错**，实现未因此改动：
  ① 旧实现越界的 fixture 手算错（1420/991 那组其实不越界）；② 一条断言把左右关系写成了负值恒假；
  ③④ 退化右栏用例期望 340/false，实测 240/true；⑤ 硬上限用例的 `avail` 只有 400，压根碰不到 560；
  ⑥ 新增的 `capped` 断言把语义写反（`capped` 指"被可用带宽限制"，命中硬上限时为 false）；
  ⑦ `avail` 断言误用了带右栏的用例（390 而非 421）；⑧ 源码钩子去找根本不存在的
  `setFloatMode('capsule')` 调用——控制项实际走 `floatControl('capsule','floatCollapse','⇥')` 的
  `onFloatMode` 回调，正则已改。
- 本版一度新增 `tools/balance-check.mjs` 与 `tools/i18n-check.mjs` 两个「替代检查」，**现已删除**：
  它们本身是错的——前者用「正则字面量 vs 除号」的启发式，把 8 个源文件全部误报为残损；
  后者定位词典块的缩进假设写错，解析出 0 个键并误报上百条缺失。会撒谎的检查器比没有检查器更糟。

> 仍未验证：**浏览器内的视觉观感**（浮层实际宽度是否等于预算、是否真的不越过对话区右边界）。
> 请按 README 第九节 **A 路径第 8 条**在真实页面确认（读 `data-dsa-float-mode` 与 `data-layer-width`），
> 单测替代不了这一步。1.5.0 前半段本工作区 shell 工具整体不可用
> （`SetNamedSecurityInfoW failed (Win32 5)`），当时的改动确实没跑过任何命令；故障解除后才补跑上述四项。

## 1.4.0

**主题：一次系统性的代码走查——19 项改进，功能缺口、正确性边界、i18n、代码卫生一次补齐。**

### 功能缺口（A）

- **A1 设置页补齐控件**：`sideTimeoutMs`（5000–3600000，即宿主侧接受的范围）与 `sideProvider`
  （下拉，选项来自 `/state` 实际报告的 provider 列表，默认 `auto`）此前宿主接受但设置页没有控件，
  只能手改 `config.json`——现在设置页直接可改。
- **A2 思考过程可见**：子代理的 `reasoning` 帧此前被丢弃；现在卡片上以**可折叠的「思考过程」区**展示，
  流式期间与答案同窗口合并提交，复制答案不含思考文本。
- **A3 原生右侧栏 tab 可关闭**：此前的「关闭」只撤掉渲染证明、tab 留成空壳；现在真正关闭 tab
  并携带空态文案，关闭失败的兜底路径（回退关 tab）一并处理。
- **A4 卡片持久化**：已完成（含已停止且非空）的侧边卡片镜像进 `localStorage`（schema `v1`，
  最多 10 张、单卡文本上限 64K），页面刷新后重放进浮层卡片栈（原生/better 的 tab 无法跨刷新存活）；
  隐私模式、配额满、数据被篡改一律降级为「无历史」，不阻断启动。
- **A5 流式自动滚动**：侧边卡片答案流式增长时自动滚动到底部（仅当用户已在底部附近，不打断上翻）。
- **A6 markdown-lite 扩展**：行内新增斜体与链接（链接协议白名单 http/https、`noopener` 打开，
  模型输出不可能造出 `javascript:` URL）；块级新增引用块与表格（此前行内只有代码/粗体，
  块级只有代码块/列表/标题）。

### 正确性与边界（B）

- **B7 渲染证明竞态**：同一卡片在两个承载面（原生右侧栏与 better-sidebar）同时出现过的窗口期，
  第二面的渲染证明会顶掉第一面；现在挂载即撤销旧证明，回退路径改为关闭 tab 而非仅撤证明。
- **B8 码点计数**：截断、徽标、`minChars` 全部从 UTF-16 单元计数改为 **Unicode 码点**计数
  （两端 `truncateSelection` 同步，契约测试断言等价）：emoji 或扩展区汉字不再被数成两个字符、
  截断不再切半个代理对。
- **B9 流式增量节流合并**：每个流式 delta 曾触发一次全卡重渲染（整卡 re-render + 全文重解析，
  长答案下是二次方开销）；现在 50ms 窗口内合并为一次提交，终止事件（done/error/cancel/close）
  先冲刷缓冲再落终态，**不丢任何流式文本**；关闭卡片会丢弃未冲刷的缓冲（冲刷 tick 不复活已关卡片）。

### i18n 与一致性（C）

- **C10 宿主错误消息本地化**：含义完全已知的错误码（`too-large`/`busy`/`aborted` 等）在英文界面
  显示英文文案，不再显示宿主拼接的中文消息；携带实时诊断的错误码（`engine-error`/`blocked-step` 等）
  **保留宿主原文**（那是原因唯一所在，替换即丢失）。
- **C11 子代理提示词统一英文**：`buildSidePrompt` 生成的指令段落统一英文，与 persona 语言一致。
- **C12 语言解析集中化**：`resolveLanguage()` 集中解析，优先 `navigator.languages` 逐项回退，
  不再散落多处手写判断。

### 代码卫生（D）

- **D13 停止/关闭真正终止子代理**：此前只中断浏览器端流；现在同时 `POST /cancel`，宿主侧运行
  登记表真正清空（子代理不再跑到超时）。
- **D14 移除载荷死字段 `cross`**：ask 载荷里宿主从不读取的字段，连同客户端构造一并删除
  （`zoneLabel` 的 `candidate.cross` 显示逻辑保留——那是客户端自用）。
- **D15/D17 dispose 对称清理**：所有 `ctx.inject` 的返回反注册都保存并在 dispose 时调用，
  不再只清理部分订阅；补齐一处缩进格式问题。
- **D16 历史轮数常量化**：卡片继续追问携带的历史轮数从两处裸 `6` 提为导出常量 `HISTORY_TURNS`
  （客户端与宿主各自导出，契约测试断言两值相等，且宿主提示词只保留最近 N 轮）。
- **D18 触发按钮宽度自适应**：视口钳制宽度从按中文估的硬编码 132px 改为按**当前语言文案**估算
  （CJK 全宽、其余 ~0.55em + 固定 chrome 余量）：英文按钮（"Ask about selection"）比中文宽约 50px，
  此前选区靠右时会溢出视口右缘；样式加 `white-space:nowrap` 杜绝挤压折行。

### 可选加固（E）

- **E19 信任围栏端口比较**：`isTrustedRequest` 的 Origin 与 Host 比较改为**完整 authority（host:port）**——
  同主机名不同端口的 Origin 是不同源，此前只比主机名会放行；`trustedHosts` 条目带端口时只信任该端口，
  不带端口则信任该主机全部端口（管理员语义）。

### 其他

- 修复契约测试中 B9 用例的定时器竞态（Windows 定时器粒度 ~15.6ms 下，80ms 的 done 门与 65ms 的
  检查点余量不足；门移至 130ms 并放宽后续等待）。

自测 336 → **487 项**（verify 53 / contract 296 / smoke 138），契约测试连跑 5 次全绿。

## 1.3.2

**主题：核对并适配 DSH 桌面版（Electron，0.2.0-rc.2）。**

核对结论（实测，详见 README §5.3）：

- 桌面版是**独立运行形态**：Electron-as-Node 跑 `app.asar\dsh\...\dsh-desktop-host`，框架包全在 `app.asar` 内，
  自带 node 24.18.1 + pnpm 11.7.0；`DSH_PROFILE=desktop`，与 web 版的 `profiles\web` **各自独立**；
- 本插件在桌面 profile 中已登记（`link:D:/Users/34332/AI/dsh-sidecard-ask` + `dsh.profile.bundles`），
  **无需改动即加载**：宿主半 `v1.3.1` 正常，客户端自检上报显示三个槽位落点正常、两个适配器均可用，
  真机 `start→reasoning×106→delta×46→status→done`（1.89 s）通过；
- 桌面版用的 dsh-better-sidebar 是 **0.24.1**：与 0.22.1 的消费端契约差异**纯增量**
  （`target` 增加 `'side'`、新增可选 `preferNewPane`），本插件不传这两项 → 不受影响。

**桌面特有修改：窗口拖拽区防御。** 桌面外壳把顶层元素标记为窗口拖拽区（`-webkit-app-region: drag`），
落在其中的点击会变成拖动窗口；同生态的 dsh-better-sidebar 为此专门带了一条防御，而本插件的浮层此前没有。
现在样式表为每个自有根节点声明 `-webkit-app-region:no-drag`（`.dsa-layer/.dsa-trigger/.dsa-pop/.dsa-stack/
.dsa-card/.dsa-toast/.dsa-settings`），并有回归测试锁定该规则（含"该规则是真实规则而非只出现在注释里"的断言）。
该属性在浏览器中无效，web 版不受影响。

**确认无需改动的部分**：`styles.insert` / `host.call` 只属于**动态**客户端半（本插件是静态形态，官方等价做法
就是手工插 `<style>`，宿主通信走自有 HTTP 路由）；名为 `shortcuts` 与 `conversation` 的客户端服务在运行实例中
**都不存在**（inspection 报 `no catalogued Service`），因此快捷键与 composer 草稿保持既有实现与占位降级。

自测 327 → **336 项**（verify 53 / contract 149 / smoke 134）。

## 1.3.1

**主题：让"两半代际不一致"成为一个被处理的状态，而不是噪声。**

这个插件的宿主半只在**重启 DSH** 时更新，客户端半在**页面加载**时更新，所以"新客户端 + 旧宿主"是结构性常态
（当前本机就是这个状态：页面已跑到 1.3.x，宿主仍是重启前的 1.2.0）。

- 客户端在自检上报被宿主以 `not-found`（该路由还不存在，旧宿主）、`bad-response`（SPA 兜底返回 HTML）
  或 `unreachable` 拒绝时，**记住"此宿主不支持自检"并停止重试**，只打一条 info 说明"重启 DSH 后生效"；
  其它错误（例如配置类真实错误）仍按 warning 记录，不会错误地关闭通道。
- 新增纯函数 `isDiagnosticsUnsupported(error)` 并纳入契约测试（5 条断言覆盖各错误码）。

自测 322 → **327 项**（verify 53 / contract 140 / smoke 134）。

## 1.3.0

**主题：把"客户端半的状态"变成宿主可读——补上导致前两次缺陷排查困难的观测盲点。**

- 新增 **`POST /sidecard-ask/api/diagnose`**：客户端半在启动、槽位落点变化、承载面回退时把一份受限摘要
  （客户端版本、当前承载面、区域锚点是否可用、三个槽位的真实落点、两个适配器的可用性与失败原因、
  侧边卡片插件的版本与能力列表）上报给宿主；`GET /state` 的 **`value.client`** 即可读到。
  宿主对上报做**白名单 + 截断**（未知键丢弃、字符串 ≤200 字符、能力列表 ≤40 项、槽位 ≤8 项）。
- 客户端版本改为单一常量 `CLIENT_VERSION`：自检上报与 `api.version` 同源，报告不会声称一个页面其实没在跑的版本。
- 此前两次客户端静默失效（原生 tab 类型因 kind 冲突从未注册；客户端产物是上一代）都只能靠人工翻阅
  槽位清单才发现，这条通道把它们变成一条命令就能查到的事实。

**同时复核 1.2.1 的修复在运行实例上生效**：`sidebar.right.pane.tab` 的占用者现在**同时**包含
`sidecard-ask:card`（本插件原生右侧栏）与 `dsh-better-sidebar:sidecard-ask:card:workbench`（better-sidebar 镜像），
两者均 active——kind 冲突已消除。

自测 295 → **322 项**（verify 53 / contract 135 / smoke 134），新增用例覆盖上报的接收、白名单裁剪、
截断、非法体拒绝，以及客户端上报体的构造。

## 1.2.1

**主题：核对 DSH 0.2.0-rc.1 的适配性，并修掉由此暴露的一个真实缺陷。**

核对（本机运行中的就是 0.2.0-rc.1，`@deepseek-ai/dsh` 的 `next` 通道）：

- 包内容层面：`node tools/compat-probe.mjs 0.1.7-rc.2 0.2.0-rc.1` → 16 项能力**逐项一致**，没有任何依赖被移除或改名；
- 运行实例上：宿主半 `v1.2.0` 正常（`sideEngine`、provider `spawn,fork`、`capabilities.parent` 均可用）；
  客户端半在 `shell.overlay` / `conversation.input.right` 都已注册；`standardProps` 仍含 `sessionId` 与 `inputActions`；
  真机端到端作答 `start→delta×31→status→done`（1.36 s）通过。新增的 `sessions.fork`/`uiWorkspace.forkSession`
  可选参数 `onCreated` 是纯增量，不影响既有调用。

**修掉的缺陷**：`sidebar.right.pane.tab` 的运行清单里只有 `dsh-better-sidebar:sidecard-ask:card`，
没有本插件原生右侧栏的 `sidecard-ask:card`——两个适配器用了同一个 tab kind，而 better-sidebar 会把每个 tab 描述符
镜像注册进**同一个**原生注册表（band `extension`），该注册表对同 band 同 kind 的二次注册抛错，后注册的一方静默失败。

- better-sidebar 承载面改用独立类型 `sidecard-ask:card:workbench`（`CARD_KIND_BETTER`），两端不再重叠；
- `contract-test` 新增"surface kinds must not collide"一节：**在测试里模拟该注册表的重复 kind 抛错规则**
  与 better-sidebar 的镜像注册行为，若两者再共用 kind，测试立即失败；
- 设置页自检行改为同时报告**两个适配器**（原先原生适配器的错误在界面上不可见，只能靠翻槽位清单发现）。

自测 289 → **295 项**（verify 53 / contract 124 / smoke 118）。

## 1.2.0

**主题：核对并加固与 dsh-better-sidebar 0.22.1 的适配。**

核对方式（可复现）：把 0.22.0 与 0.22.1 的发布产物都拉下来解包，逐文件 SHA256 比对。结论：

- 消费端契约 `lib/types/client/service.d.ts` **除 `SIDEBAR_SERVICE_VERSION` 常量外逐字节相同**；
  `SIDEBAR_FEATURES`、`dsh.client.inject`、peer 依赖均未变；
- 0.22.1 唯一的大体量改动是它**自己** `src/client/native/index.ts` 的健壮性修复（`disposeSafely` +
  槽位注册失败时回滚已注册的 tab 类型），不涉及本插件调用的任何字段；
- 本插件用到的 `registerTab / openTab(seed, scope) / closeTab / features / version` 全部仍在。

即 **0.22.1 下无需改动即兼容**。据此做了三处加固：

1. **按能力而非版本判断**：适配器仅在 `features` 含 `tabMeta` 时可用（该能力自 better-sidebar 0.12 起提供，
   更早的版本会打开一个读不到 `meta.cardId` 的空 tab）；不满足时 `auto` 跳到原生右侧栏/内置浮层，
   并在自检里给出 `no-tab-meta`。
2. **原生承载面注册回滚**：先注册 tab 类型再注册槽位，槽位注册抛错时释放已占用的类型 id
   （正是 0.22.1 在自己原生胶水里修的同类问题，否则该 kind 会永久占用、渲染宿主"无实现"的空面）。
3. **运行时可见**：设置页「运行自检」新增一行，显示侧边卡片插件**自己报告的 `version` 与能力项数**，
   以及本插件对它的判定（可用 / 版本过旧 / 未检测到）。

自测 276 → **289 项**（verify 53 / contract 118 / smoke 118），新增用例覆盖：0.22.1 形状的服务被接受、
`openTab(seed, scope)` 的字段与作用域、缺 `tabMeta` 时被拒绝并落到浮层、缺 `registerTab` 时被拒绝、
槽位注册失败时类型被释放且适配器转为不可用。

## 1.1.0

**改名：`dsh-selection-followup` → `dsh-sidecard-ask`**（显示名「划词追问」→「侧边卡片追问」）。

原因（可复核）：

- `dsh-selection-followup` 在 **DSH 插件生态里已被他人使用**——GitHub 仓库
  `zzx-dear/dsh-selection-followup` 与官方收录索引 `data/plugins/zzx-dear__dsh-selection-followup.yml`
  （category: ui），早于本插件约 20 天。1.0.0 发布时只核对了 npm 名字是否可用（当时为空），
  **没有核对 GitHub 仓库名与收录索引**，这是本项目的疏漏。
- 新名 `dsh-sidecard-ask` 的 npm 包名与 GitHub 仓库名都已核对为空，并且与既有的
  `dsh-selection-ask` / `dsh-selection-explain` / `dsh-selection-toolbar` / `dsh-quote-selection` /
  `dsh-ui-quote-selection` / `dsh-quote-annotate` / `dsh-selection-memory` / `dsh-plugin-followup`
  在名字与定位上都区分开：本插件由**独立子代理在侧边卡片里流式作答**，不是把选中内容塞进输入框。

随之变更的标识（旧 → 新）：

| 项 | 旧 | 新 |
|---|---|---|
| npm 包名 / bundle 名 | `dsh-selection-followup` | `dsh-sidecard-ask` |
| 宿主行 id | `selection-followup` | `sidecard-ask` |
| 插件自有路由 | `/selection-followup/api` | `/sidecard-ask/api` |
| 客户端模块 id / 槽位条目 id | `dsh-selection-followup` / `selection-followup` | `dsh-sidecard-ask` / `sidecard-ask` |
| 侧边卡片类型 | `selection-followup:card` | `sidecard-ask:card` |
| 用户配置目录 | `<DSH_HOME>/selection-followup/` | `<DSH_HOME>/sidecard-ask/` |
| 显示名（Plugins 页 / 设置页） | 划词追问 | 侧边卡片追问 |

其它：`package.json` 增加中英文关键词（划词 / 选中追问 / 侧边卡片）；自测同步改名，仍是 **276 项全通过**；
旧 npm 包名已 `deprecate` 指向新名字。功能与 API 与 1.0.1 完全一致，**升级只需卸旧装新**（见 README §三）。

## 1.0.1

**主题：把"版本适配"从字段笔记变成可验证的适配。**

- 新增 `tools/compat-probe.mjs`：从 npm 拉取 **13 个 DSH 版本**（0.1.2-rc.1 → 0.1.7-rc.2）
  × **12 个相关包**的已发布产物，解包后按标记字符串判定能力，输出矩阵（结果写进 README §7）。
  据此确认的缺口与适配：
  - **原生右侧栏**（0.1.2 / 0.1.3 缺）→ 承载面探测链已有降级；
  - **主对话提交**（≤0.1.6-alpha.1 既无 `using` 也无 `retain`）→ 新增四级提交阶梯
    `using → retain+release → 槽位标准 prop inputActions(setDraft+submit) → 仅写草稿`，逐级探测并回报实际生效的一级；
  - **归档会话门**（仅 0.1.7-alpha.1+ 存在）→ 修正上一版引入的误伤：不再对归档父会话一刀切拒绝，
    改为优先挑未归档代理、只剩归档候选时照常尝试并在 `start` 事件标注 `parentArchived`；
  - **流式帧**（0.1.2-rc.1 无 `agent/assistant-stream`）→ 新增第二条流式源，桥接该版本持久化的
    `assistant/chunk` 会话事件，与帧源互斥（先到者生效，绝不重复累计文本），并在 `done` 里给出 `streamSource`。
- **新增槽位阶梯**：浮层 / 设置页 / 会话采集各自在多个等价 `list` 槽位间回退（先到者胜，更好的槽位后到会顶掉兜底），
  诊断里记录真实落点；`single` 槽位一律不碰（避免替换宿主 UI）。
- **区域锚点缺失时不再静默失效**：检测不到 `data-slot` 时停用区域过滤并在自检里说明（原先 `captureZones:chat` 会永远不触发）。
- **provider 能力门控**：只发送 provider 声明支持的启动字段（`capabilities.persona/toolFilter`），
  `persona` 不支持时内联进提示词，`toolFilter` 不支持时在卡片上明说"本次继承了会话工具"。
- **路由注册降级**：`prefix` 路由被拒时退化为逐方法精确路由。
- 自测从 236 项扩到 **276 项**（verify 53 / contract 105 / smoke 118），新增用例覆盖上面每一条降级路径。

## 1.0.0

首个版本（发布名 `dsh-sidecard-ask`：npm 上的 `dsh-selection-ask` 已被他人占用）。

- **划词追问**：在聊天区 / 任务区选中文本，选区末端就地浮出「追问选中内容」按钮，点击弹出提问框。
- **两种作答承载**：主对话（引用块进入当前会话，答案原生流式）与独立侧边卡片（子代理在自己的会话里作答，零父上下文），可在提问框临时切换并配置默认值。
- **侧边承载面适配**：DSH 原生右侧栏 → `dsh-better-sidebar` → 内置浮层卡片，三层能力探测自动降级；未安装侧边卡片插件时功能完整。
  适配器"接受打开但没渲染"时由**渲染证明**在 600ms 后把卡片移到内置浮层，不会留下空 tab。
- **流式渲染**：宿主半把 `agent/assistant-stream` 帧桥接到 SSE；卡片支持关闭、复制、继续追问、停止作答、重试。
- **边界处理**：空选/过短、编辑框内选择、跨区选择、超长截断（两端算法一致）、接口失败逐层降级、重复触发抑制、并发上限、请求超时、卸载清理。
- **配置三层**：内置默认 ← bundle 补丁 ← 用户层（`<DSH_HOME>/sidecard-ask/config.json`，原子写入），设置页可视化编辑 + 运行自检。
- **零运行时依赖**：宿主半只用 `node:` 内建；客户端半只 `require('react')`。
- 附带三套可运行自测（236 项）：`test/verify.mjs`、`test/contract-test.mjs`、`test/smoke-test.mjs`。

### 真实宿主联调中发现并修掉的问题（DSH 0.1.7-rc.2）

1. **`tools.restrict()` 会拒绝未知工具名**：硬编码的只读工具白名单里有若干本组合不存在的名字，导致子代理启动即失败。
   现在白名单在调用时与 `tools.schemas()` 求交，交集为空则完全不传 `toolFilter`。
2. **`req.on('close')` 不是"浏览器断开"**：Node 的 `IncomingMessage` 在请求体读完时就触发 `close`，用它作断线信号会在请求体结束的瞬间取消作答。
   改为只监听 `res.on('close')`，并要求 `res.writableEnded !== true`。
3. **父会话可能已被归档**：宿主的归档门会拒绝整条子代理血统的每一步（空 turn → 子代理接缝记为 `refusal`），
   而 `agents.roots()[0]` 可能正好落在归档会话上。现在按"提问会话 → 首个未归档活动代理"选择父代理，
   候选全部归档时直接返回 `parent-archived`；其它 `refusal` 也被翻译成可读的 `blocked-step`。
4. **终止事件必须最后**：末尾多余的 `status{settled}` 会让"最后一个事件是终局"的读法失效，已移除。
5. **`/config` 之后的 `provenance.persisted` 是启动时的快照**：保存后仍显示未持久化，改为按当前用户层实时计算。
