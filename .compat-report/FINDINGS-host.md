# dsh-sidecard-ask v2.1.1 × DSH 0.2.1-rc.3 —— Host 半契约审计

- 审计对象：`D:\Users\34332\AI\dsh-sidecard-ask\index.js`（2749 行，Host 半）
- 对照基准：`D:\Users\34332\AI\dsh-sidecard-ask\.compat-report\evidence\dsh-0.2.1-rc.3\dsh\node_modules\@deepseek-ai\`（307 包，全部 0.2.1-rc.3；运行时包 `dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.3`；cordis 4.0.5）
- 方式：只读 grep/read 源码与 `.d.ts`/typert 声明，逐条给 `文件:行` 证据；无证据的写“未找到证据”。
- 审计员：host-audit（子代理），只读分析，除本文件外未改动任何文件。

---

## 一、结论摘要

**总体判定：有条件兼容（Host 半可加载、路由可用，但有 1 项功能性降级、1 项环境信任缺口、2 项声明缺失；无阻断性崩溃证据）。**

| # | 维度 | 判定 | 一句话 |
|---|---|---|---|
| 1 | 服务注入（ctx.inject/ctx.get） | **兼容** | 插件探测的 6 个服务名在 rc.3 全部存在（`webServer`/`subagents`/`tools`/`agents`/`connection`/`workspaceRegistry`），仅 `webRuntime` **不存在** |
| 2 | `ctx.webServer.register({kind:'prefix',…})` | **兼容** | rc.3 仍接受 `kind: 'exact' \| 'prefix'` + `path` + `handler`，返回 disposer；前缀匹配要求 `pathname !== prefix && startsWith(prefix + '/')` |
| 3 | HTTP / SSE 传输 | **兼容** | webserver 无鉴权/CORS/前缀改写/响应包装；gzip 中间件显式跳过 `text/event-stream`；handler 完全掌握 `res` |
| 4 | `ctx.subagents` 启动 API | **变化** | service 上已无 `start`；只有 `startActivation(spec)`。插件有新旧双分支，走 activation 分支可通；但 `SubagentStartRequest`/`SubagentCapabilities` 已无 `persona`/`toolFilter` |
| 5 | `sideTools: readonly` 强制只读工具 | **降级（功能失效）** | caps 中无 `toolFilter` ⇒ 插件 `toolFilterSupported=false` ⇒ 不传 filter ⇒ 子代理**继承父会话全部工具**，只读护栏失效（wire 上报 `toolFilter:'unsupported'`，UI 可提示） |
| 6 | `agent/assistant-stream` 事件 | **部分变化** | 事件名与 `{agent, frame}` 载荷成立；`frame.type==='end'` 在 rc.3 只有 `outcome`，**没有 `stopReason`** ⇒ SSE `status.stopReason` 恒为 `undefined` |
| 7 | `session/event` + `assistant/chunk` 桥 | **死代码（无害）** | `assistant/chunk` 在 rc.3 仅出现在 session-format 迁移包里 | 
| 8 | `ctx.tools.schemas()` | **兼容** | `schemas(scope?)` 仍返回带去重 `name` 的 schema 数组 |
| 9 | 认证/授权 | **兼容（有缺口）** | `connection.requestRejection()` 仍在，401/403 语义与插件映射一致；但 `webRuntime.trustedHosts` 缺失 ⇒ 非 loopback 可信部署被插件 403 |
| 10 | 配置/持久化路径 | **风险** | rc.3 用 `resolveDshHome()`（configured > `$DSH_HOME` > `~/.dsh`），插件只认 `$DSH_HOME`；`DSH_PROFILE` 在 host 进程内**未找到设置点** |
| 11 | 清单（`- insert:` / `dsh.bundle.patch`） | **兼容** | `applyEntryPatches` 仍支持 patch 级 `insert`；`bundlePatchFiles` 仍接受字符串或字符串数组 |
| 12 | `dsh.manifestVersion: 1` | **惰性字段** | rc.3 全树 0 命中 `manifestVersion`，既不校验也不拒绝 |
| 13 | 版本兼容声明 | **缺失** | 插件只有 `engines.node`，无 `engines.dsh`、无 `@deepseek-ai/dsh*` peerDependencies ⇒ 安装期零版本门禁 |

---

## 二、契约核对表（43 项）

| # | 契约 | 插件用法(index.js:行) | DSH 0.2.1-rc.3 证据(文件:行) | 判定 | 影响 |
|---|---|---|---|---|---|
| 1 | 插件导出形态 `name`/`inject`/`apply` | `export const name` (:42)、`export const inject = ['webServer']` (:45)、`export function apply(ctx, patchConfig)` (:2196) | cordis 4.0.5 `effect(execute, label = "anonymous")`（`cordis/lib/index.js:1169`）；`on(name, listener, options)` 返回 disposer（`cordis/lib/index.js:371-379`） | OK | 无 |
| 2 | `ctx.effect(fn, label)` | `:1544`、`:1554`、`:2746`（`ctx.effect(registerRoutes, \`sidecard-ask: ${ROUTE_PREFIX} routes\`)`） | `cordis/lib/index.js:1169`；disposer 收集 `:1186-1194` | OK | 无 |
| 3 | `ctx.effect(() => ctx.on(...))` 嵌套 | `:1544`、`:1554` | `on()` 返回 `this.register(...)`（= disposer，`cordis/lib/index.js:379`），被 effect 收集 | OK | 卸载时正确解绑 |
| 4 | `ctx.get('webServer')` / `inject` | `:45` 声明依赖 | `dsh-host-webserver/lib/index.js:249` `class WebServer extends Service`，`:286` `super(ctx, "webServer")` | OK | 无 |
| 5 | `ctx.webServer.register({kind,path,handler})` | `:2727` `register({ kind:'prefix', path: ROUTE_PREFIX, handler: routeHandler })`；`:2730-2740` 失败降级为逐方法 `kind:'exact'` | `dsh-host-webserver/lib/index.js:326-333`：`const table = route.kind === "exact" ? this.exact : this.prefixes; … return () => table.delete(...)` | OK | 与插件用法完全一致 |
| 6 | 前缀路由匹配语义 | 期望 `/sidecard-ask/api/ping` 命中 `/sidecard-ask/api` | `dsh-host-webserver/lib/index.js:495-504`：exact 表优先，前缀要求 `pathname !== prefix && !pathname.startsWith(\`${prefix}/\`)` 才跳过 | OK（注意） | 裸路径 `/sidecard-ask/api` 本身不命中前缀（落入 fallback 404）；插件所有调用都带方法段，不受影响 |
| 7 | 路由重复注册 | `:2727` try/catch + 降级 | `:328` 重复抛出 `webserver: duplicate ${route.kind} route "${route.path}"` | OK | 插件的 catch→exact 降级逻辑仍有效 |
| 8 | 路由 vs SPA fallback 顺序 | 依赖命名路由优先 | `:378-394` `handle()`：先 `match()`，无匹配才用 fallback（`:357` `registerFallback` 唯一所有权） | OK | 插件路由不会被 SPA 兜底吞掉 |
| 9 | handler 拥有完整响应生命周期 | `writeJson`/SSE 直接 `res.writeHead/end`（`:2645+`、heartbeat 15s） | `:378-394` handler 拿原生 `(req,res)`，webserver 不包装响应 | OK | 插件的 `{ok,value}` 信封是自有协议，不受 rc.3 影响 |
| 10 | gzip 中间件是否破坏 SSE | SSE 不设 `Content-Encoding` | `:196-221` gzip 中间件；`:203` `content-type` 以 `text/event-stream` 开头时跳过；`:109` `DEFAULT_COMPRESSION = "none"`（`:263` Config 默认值） | OK | 无；即使配置成 gzip 也不会压 SSE |
| 11 | 升级路由是否抢占 | 插件仅用 HTTP | `:340-346` `registerUpgrade`（按 path 独占 WS）；`dsh-api-gateway/lib/index.js:820` 只用 `registerUpgrade`，服务名 `typertGateway`（`:744`、`:767`） | OK | api-gateway 不注册 HTTP 前缀/兜底，不会吞掉 `/sidecard-ask/api` |
| 12 | `ctx.get('subagents')` | `:1574` `subagentsService()`；`:1591` 要求 `start` **或** `startActivation` 之一 | `dsh-subagent/lib/index.js:2992` `super(ctx, "subagents")`；`startActivation` 见 `:3036` | OK | 服务存在，探测通过 |
| 13 | `subagents.start(provider, request)` 旧 API | `:1600-1601` `if (typeof service.start === 'function')` | **0 命中**：rc.3 service 只有 `startActivation`/`startExternal`/`startExternal…`（`grep "start("` 仅 local/external 实现） | 变化 | 旧分支为死代码（不影响运行） |
| 14 | `startActivation(spec)` 签名 | `:1603-1617`：`{provider, label, delivery:'caller', signal, request:{prompt,parent,persona?,toolFilter?}}` | `dsh-subagent/lib/index.js:3036-3047`；类型 `dsh-subagent/lib/typert.host.js:821` `SubagentActivationSpec {provider, label, childId?, request, signal, delivery:'parent'\|'caller'}`；返回 `:817` `SubagentActivation {childId, messageId?, result, dispose()}` | OK | 必需字段齐备，返回值与插件解构的 `childId/result/dispose` 一致 |
| 15 | `request.prompt` 类型 | `:1912` `prompt: [{ type:'text', text: promptText }]` | `typert.host.js:897` `prompt: ContentBlock[]`；消费方 `dsh-subagent/lib/types/manager.js:395-396` 直接透传，`dsh-llm/lib/index.js:594` `content.some(...)`（字符串会 TypeError） | OK（必须保持块数组） | 目前是块数组 ⇒ 安全；若未来改成裸字符串会**硬失败** |
| 16 | `delivery:'caller'` 语义 | `:1605` | `manager.js:320` `spec.delivery === 'caller' ? this.ctx.get('sessionPersistence') : this.requirePersistence()` | OK | caller 交付不强依赖 sessionPersistence（更好） |
| 17 | 父会话归属校验 | `parent.agent` 由 `resolveParent` 从 `ctx.get('agents')` 取（`:1694`、`:1761`） | `dsh-subagent/lib/index.js:3045` `if (this.ctx.get("agents")?.get(spec.request.parent.id) !== spec.request.parent) throw … "UNAUTHORIZED"` | OK | 插件正是从 agents 取同一实例，身份相等成立 |
| 18 | 能力协商 `persona` | `:1874` `caps?.persona === true`；否则把 persona 拼进 prompt（`:1877`） | `typert.host.js:825` `SubagentCapabilities {agentOptions, agentPreset, outputSchema, depthLimit}` —— **无 persona** | 变化 → 插件已自愈 | persona 降级为提示词前缀；功能等价，仅失去结构化注入（无外来污染） |
| 19 | 能力协商 `toolFilter`（只读护栏） | `:1875` `caps?.toolFilter === true`；`:1880-1884` 否则不传 filter，wire 报 `'unsupported'` | 同上 `:825` 无 `toolFilter`；`typert.host.js:897` `SubagentStartRequest` 也无 `toolFilter` | **降级** | `sideTools:'readonly'` 实际不生效，子代理继承父会话全部工具（含写工具）；UI 会显示“继承”但用户可能忽略 |
| 20 | `provider/name` 与 provider 列表 | `:1637` 偏好 `'spawn'`；`:1737-1745` `service.list()` + `getProvider(name)` | `dsh-subagent/lib/index.js:3274` `getProvider`、`:3281` `list`；`dsh-subagent-spawn-in-process/lib/index.js:12` `providerName` 默认 `"spawn"`；标准组合注册于 `dsh-base/cordis.patch.yml:362-365`（`name: '@deepseek-ai/dsh-subagent-spawn-in-process'`, `providerName: spawn`） | OK | 默认组合下 provider 存在，侧边作答可用 |
| 21 | 深度限制 | 插件不传 `maxDepth` | `dsh-subagent/lib/index.js:3041` `assertSubagentMaxDepth(spec.request.maxDepth)`；`:120-122` 接受 `undefined` | OK | 无异常 |
| 22 | `agent/assistant-stream` 事件名/载荷 | `:1943-1944` `payload?.frame`、`payload?.agent` | `dsh-agent-loop/lib/index.js:1080` `this.dispatch.emit("agent/assistant-stream", { frame })`；`dsh-agent/lib/types/dispatch.js:37-42` `fused = (payload) => ({ ...payload, agent })` | OK | `{agent, frame}` 形状成立 |
| 23 | `frame.type==='chunk'` → `text-delta`/`reasoning-delta` | `:1958`、`:1961` | `dsh-tool-cordis/lib/types/api-catalog.js:7752` `StreamChunk` 含 `{type:'text-delta',index,text}`、`{type:'reasoning-delta',index,text}` | OK | 增量文本正常 |
| 24 | `frame.type==='end'` 的结束原因 | `:1970` `stopReason: typeof frame.stopReason === 'string' ? … : undefined` | `api-catalog.js:4803-4804` `AssistantStreamFrame` 的 end 分支只有 `{attemptId,revision,index,outcome:{kind:'committed',eventType,seq}\|{kind:'abandoned'}}`，**无 `stopReason`** | 变化（降级） | 运行中 `status` 事件恒 `undefined`；终态仍由 `result.stopReason`（`:2020`，`typert.host.js:881` 确认存在）兜底，故不影响最终判定 |
| 25 | `session/event` + `assistant/chunk` 持久化桥 | `:1554`、`:1979-1994` 监听 `session/event`，读 `event.data.chunk`，且 `event?.type !== 'assistant/chunk'` 过滤 | `dsh-session/lib/types/index.js:716` 仍 emit `('session/event', …)`；`assistant/chunk` **仅**出现在 `dsh-session-format-v0-to-v1`、`v1-to-v2` 迁移包 | 死代码 | 无害（`framesSeen` 优先），但注释里的“兼容旧版”已无对象 |
| 26 | `ctx.get('tools').schemas()` | `:1295-1302` `known = tools.schemas()`，按 `schema.name` 取交集 | `dsh-tools/lib/index.js:2798` `super(ctx,"tools")`；`:3119` `schemas(scope)` 返回可见工具 schema 数组（`schemaOf(d,true)` 带 `name`） | OK | 只读白名单计算可用（但因 #19 不会被下发） |
| 27 | `tools.restrict(filter)` 不想用 | 插件不调用 | `dsh-tools/lib/index.js:2991` 对非 agent 作用域抛出 `tools.restrict() requires a scoped context (agent.ctx)`；`api-catalog.js:8232` `ToolRestriction {allow?, deny?}` | OK（规避正确） | 若改用 restrict，必须拿 agent.ctx |
| 28 | 登录/授权判定 | `:2603-2645` `ctx.get('connection')`，要求 `requestRejection` 函数 | `dsh-client-connection/lib/index.js:710` `super(ctx,"connection")`；`:737` `requestRejection(request)`：未信任 403、已释放/未认证 401、其余 `undefined` | OK | 401/403 映射与插件一致；服务缺席时插件 fail-open 到 loopback 围栏 |
| 29 | 同源/loopback 围栏 | `:1330-1366` `isTrustedRequest(req, trustedHostsOf())` | rc.3 自身 `dsh-client-connection/lib/index.js:240-245` `isTrustedApiRequest` 除 trustedHosts 外**还接受绑定地址**（`isBindAddressAuthority`） | 变化（更严） | 插件少了 bind-address 这一路信任 |
| 30 | `ctx.get('webRuntime')` | `:2235` `dshVersionOf`（`version ?? harnessVersion`）、`:2356` `trustedHostsOf`（`webRuntime?.trustedHosts`） | 全树 grep `webRuntime`（`.js/.json/.yml`）**0 命中** | **缺失** | ① `trustedHosts` 恒 `[]` ⇒ 非 loopback 的可信访问一律 403（DSH 自身同一请求可能放行）；② `/feedback` 环境块拿不到 DSH 版本（回落 `process.env.DSH_VERSION`） |
| 31 | home 路径解析 | `:1247-1256` `process.env.DSH_HOME`（trim 非空优先）否则 `join(homedir(), '.dsh')` | `dsh-home-paths/lib/index.js:11-15`（`.dsh`/`DSH_HOME`）、`:55-57` `defaultDshHome()`、`:101-110` `resolveDshHome(configured, env)`：**configured 优先于 `$DSH_HOME`**，空/空白 `$DSH_HOME` 视为未设 | 风险 | 若启动器用“configured”方式（非 env）指定 home，插件数据目录会与 DSH 主目录分叉 |
| 32 | profile 区分 | `:1276` `process.env.DSH_PROFILE` → `config.<profile>.json` | `dsh-shell-env/lib/index.js:21-22` 定义 `DSH_PROFILE`/`DSH_PROFILE_DIR`，`:92-93` 只注入**子进程 bash 环境**；host 侧 profile 目录为 `$DSH_HOME/profiles/<name>`（`dsh-app-boot/lib/index.js:507` `PROFILES_DIR = "profiles"`、`:546-550` `resolveProfileDir`） | 风险（未完全验证） | 桌面 host 进程内 `DSH_PROFILE` 是否存在未能证实；若缺失，多 profile 会共用同一 `config.json` |
| 33 | 清单 patch 级 `insert` | `cordis.patch.yml` 顶层 `- insert: [...]`，行内 `id: sidecard-ask` | `dsh-app-boot/lib/index.js:73-92`：`const { id, insert, name, ...overrides } = patch; if (insert) { if (id) {…} else data.push(...insert); buildMap(insert); continue }` | OK | 语法仍被接受（`id` + `insert` 亦支持） |
| 34 | `dsh.bundle.patch` 字符串形式 | package.json `"bundle": { "patch": "./cordis.patch.yml" }` | `dsh-app-boot/lib/index.js:518-521` `typeof bundle.patch === "string" ? [bundle.patch] : bundle.patch`，否则抛 `dsh.bundle.patch must be a file path or a list of file paths` | OK | 单文件写法合法 |
| 35 | 安装期 bundle 识别 | 同上 | `dsh-plugin-manager/lib/index.js:312` `manifest.dsh?.bundle?.patch === void 0 ? void 0 : manifest`；`:336-341` 无 `dsh.bundle` 时仅告警（`declares no dsh.bundle — installed as a plain dependency, not a profile layer`），有则 `bundlePatchPaths(...)` + 入 `dsh.profile.bundles` | OK | 安装后会自动成为 profile 层 |
| 36 | `dsh.manifestVersion: 1` | package.json `"manifestVersion": 1` | 全树 0 命中 `manifestVersion`（`grep -rn` 覆盖 `node_modules/@deepseek-ai` 全部 `.js/.json/.yml`） | 惰性 | 既不校验也**不拒绝**：删掉更诚实，但留着不会出事 |
| 37 | 版本要求门禁 | 只有 `engines: { node: ">=20" }`，无 `engines.dsh`、无 `@deepseek-ai/dsh*` peerDependencies | `dsh-app-boot/lib/index.js:279-296` `unmetRequirements`：自身 `engines.dsh` 单独裁决，否则逐个校验 `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` peer；`:298-320` `evaluatePluginCompatibility` / `pluginCompatibilityWarning`；`dsh-plugin-market/lib/index.js:650` 只透传 `engines.dsh` | **缺失** | 装到任何 DSH 版本都不拦、也不警告 ⇒ 未来 rc.4 破坏契约时用户无护栏（本次能跑是因为巧合兼容） |
| 38 | `agents` 服务 | `:1694`、`:1761` `ctx.get('agents')` → `get(id)` / `roots()` / `list()` | `dsh-agent/lib/index.js:332` `super(ctx,"agents")`、`:596-598` `get(id)`、`:614-616` `list()`、`:623-625` `roots()`（`owner === undefined`） | OK | 父会话解析可用。注：Lead 消息里写的 `dsh-agent/lib/index.js:43` 与实测不符，正确行号是 **332** |
| 39 | `workspaceRegistry` 归档集 | `:1659` `ctx.get('workspaceRegistry')` 结构性探测 `archivedSessionIds` | `dsh-workspace/lib/index.js:376` `super(ctx,"workspaceRegistry")`；`:231`、`:245`（`archivedSessionIds: z.array(sessionId).default([])`）、`:506-507` `get archivedSessionIds()` | OK | 归档会话拦截生效 |
| 40 | 插件兜底路由未命中 | `:2746` 只用 prefix/exact | `dsh-host-webserver/lib/index.js:378-394` 无匹配时 `res.writeHead(404); res.end()`；`:357-361` fallback 由 SPA 独占 | OK | 未命中返回 404，非崩溃 |
| 41 | `ctx.logger` | 19 处，全部 `ctx.logger?.warn?.('…', error)` 形式（如 `:1549`、`:1560`、`:1847`、`:2078`） | `cordis/lib/index.js:1688` `this.logger = new LoggerService(self)`；LoggerService 是**可调用**对象（`:594` `createCallable("logger", …)`），等级方法 `error/info/warn/debug` 定义于 `:456-461`，`ctx.logger.warn()` 直调见 `:636-645` | OK | 可选链写法在 rc.3 也安全（logger 恒存在） |
| 42 | `ctx.tools.register(definition)`（本插件未使用） | 无调用（只读 `schemas()`） | `dsh-tools/lib/index.js:2974` `register(definition)`，要求 `output: {schema, render}` | 未使用 | 插件不注册工具，无迁移风险；若未来注册需补 `output.render` |
| 43 | `ctx.inject()` 方法（本插件未使用） | 无 `ctx.inject(` 调用；改用导出 `inject = ['webServer']`（`:45`） | cordis 4.0.5 支持两种注入方式（导出数组由 loader 读取） | OK | 无 |

---

## 三、发现的问题

### 阻断
无。实机证据（Lead 独立取证，本次核对一致）：`GET http://127.0.0.1:14582/sidecard-ask/api/ping` → `{"ok":true,"value":{"version":"2.1.1"}}`，说明 Host 半在 0.2.1-rc.3 成功加载并注册路由；该响应与 `index.js:2666-2672` 的 ping 分支逐字吻合（免 auth、`writeOk(res,{version,at})`）。

### 降级 D1：`sideTools: 'readonly'` 在 rc.3 实际不生效（**最严重**）
- 证据：`index.js:1875` `const toolFilterSupported = caps?.toolFilter === true`；rc.3 `SubagentCapabilities` 只有 `{agentOptions, agentPreset, outputSchema, depthLimit}`（`dsh-subagent/lib/typert.host.js:825`），`SubagentStartRequest`（同文件 `:897`）也没有 `toolFilter`。
- 后果：`readonly` 配置不传 filter，`startActivation` 的子代理**继承父会话全部工具**（含 `write`/`bash`/`edit`）。侧卡片的划词回答因此具备写入能力。
- 修复建议（任一）：
  1. 短期：在 `sideTools==='readonly'` 且 `toolFilterSupported===false` 时，不要让用户误以为已隔离——把 wire 的 `toolFilter:'unsupported'`（`:1882-1884`）在卡片上显示成明确警示（红字），或直接拒绝该配置并提示改为 `inherit`。
  2. 中期：改用 DSH 的 scoped 工具限制——在子 agent 上下文中调用 `tools.restrict({deny:[...写工具]})`（`dsh-tools/lib/index.js:2991` 要求 `agent.ctx`；`api-catalog.js:8232` `ToolRestriction`）。子 agent 句柄可从 activation 的 result/stream 归属获得，或在 provider 侧预留 `agentOptions`/`agentPreset` 组合。
  3. 或改用 `agentPreset`（`capabilities.agentPreset` 为 true 时）选一个只读预设。
- 判定：降级，不是阻断（回答仍能产出），但**安全语义与声明不符**，优先级最高。

### 降级 D2：SSE `status.stopReason` 恒 undefined
- 证据：`index.js:1970` 读 `frame.stopReason`；rc.3 `AssistantStreamFrame` 的 end 无此字段（`dsh-tool-cordis/lib/types/api-catalog.js:4803-4804`），只有 `outcome:{kind:'committed'|'abandoned', …}`。
- 后果：运行中卡片拿不到结束原因；终态仍正确（`index.js:2020` 用 `result.stopReason`，类型见 `dsh-subagent/lib/typert.host.js:881`）。
- 修复建议：`stopReason: typeof frame.stopReason === 'string' ? frame.stopReason : (frame.outcome?.kind === 'abandoned' ? 'aborted' : undefined)`；同时保留旧字段兜底。

### 提示 P1：`ctx.get('webRuntime')` 不存在（信任围栏收窄 + 版本丢失）
- 证据：全树 0 命中 `webRuntime`；`index.js:2356` `trustedHostsOf()` 恒返回 `[]`；rc.3 自己的信任判定在 `dsh-client-connection/lib/index.js:737-743`（`admit`）与 `:240-245`（含 bind-address 例外）。
- 后果：① 通过非 loopback 主机名/绑定地址访问 Web UI 时，DSH 自身可能放行而插件路由一律 403 `forbidden`（`index.js:2646+`），表现为“侧卡片突然不可用”；② `/feedback` 环境块缺 DSH 版本，回落 `DSH_VERSION`（`:2235-2245`）。
- 修复建议：把信任源改为 `connection` 服务（若 `requestRejection` 可用则让它裁决，插件只保留 origin/sec-fetch-site 兜底）；`trustedHosts` 改从 `ctx.get('webServer')?.host/port` 或 `getOrigin()` 推导（`dsh-host-webserver/lib/index.js:300-317`）；版本改从 `ctx.get('settings')`（服务名见 `dsh-settings/lib/index.js:330` `super(ownerContext, "settings")`）或运行时清单探测。

### 提示 P2：无 `engines.dsh`（安装期零门禁）
- 证据：`dsh-app-boot/lib/index.js:279-320`；插件 package.json 只有 `engines.node`。
- 建议：加 `"engines": { "node": ">=20", "dsh": ">=0.2.1-rc.3 <0.3.0" }`（`semver.satisfies(..., {includePrerelease:true})`，见 `:277`），或补 `peerDependencies: {"@deepseek-ai/dsh": "^0.2.1-rc.3"}`。

### 提示 P3：`dsh.manifestVersion: 1` 是无效字段
- 证据：全树 0 命中。建议删除或改为自描述版本号（如 `x-sidecard-manifest`），避免未来同名语义冲突。

### 提示 P4：`session/event` + `assistant/chunk` 桥是死代码
- 证据：`assistant/chunk` 仅在 `dsh-session-format-v0-to-v1` / `v1-to-v2` 迁移包出现。建议保留但降级为“仅在 frame 从未到达时兜底”的注释已如此，可不动。

### 提示 P5：`subagents.start` 旧分支为死代码
- `index.js:1600-1601` 永不命中。留着无害，但会误导后续维护；建议标注 rc.3 起已移除。

### 提示 P6：配置目录与 profile 语义
- 插件写 `$DSH_HOME/sidecard-ask/config[.<profile>].json`，而 rc.3 的 profile 数据在 `$DSH_HOME/profiles/<name>/`（`dsh-app-boot/lib/index.js:507`、`:546-550`）。位置本身不与 DSH 冲突（独立目录），但 `DSH_PROFILE` 若在 host 进程缺失，多 profile 将共用同一份配置。建议改用 `resolveDshHome()` 语义（自实现 configured>env>default 三级）或从 `ctx.get('settings')` 读取 profile 名。

---

## 四、未能验证的点 + 建议的验证方式

| # | 未能验证 | 原因 | 建议验证方式 |
|---|---|---|---|
| V1 | 桌面 host 进程是否设置 `DSH_PROFILE` / 以“configured”方式指定 home | 只看得到包内源码；`DSH_PROFILE` 只出现在 `dsh-shell-env` 的**子进程 env** 注入（`dsh-shell-env/lib/index.js:21-22`、`:92-93`），启动器（Electron 主进程，不在 asar 的这些包里）未取证 | 运行中读进程环境：`Get-Process -Id 23148` 无 env 权限时，用 Node 侧 `ctx.get('settings')` 或临时插件打印 `{DSH_HOME, DSH_PROFILE}`；或 `wmic process where processid=23148 get commandline` |
| V2 | 真实“非 loopback 访问”场景下 403 的复现 | 需要绑定非 127.x 的网卡并用别的主机名访问（本机 127.0.0.1 无法触发） | 用 `--host`（具体网卡 IP）启动另一实例，`curl http://<LAN-IP>:<port>/sidecard-ask/api/ping` 与 `curl http://<LAN-IP>:<port>/api/…`（DSH 自身端点）对比状态码 |
| V3 | 侧卡片“作答”全链路（startActivation + 流式）是否真的产出文本 | 需要真实 LLM 调用与一次划词交互，属端到端行为 | 在 Web UI 触发一次划词追问，抓 `GET/POST /sidecard-ask/api/ask` 的 SSE：应见 `start`→`delta*`→`status`→`done`；同时确认 `toolFilter` 字段值 |
| V4 | `toolFilter`/`persona` 在“未来 rc.4”是否恢复 | 只能看 rc.3 | 建立契约探测：插件已具备 caps 探测，建议在 `/diagnose` 里长期输出 `provider.capabilities`（`:1770-1782` 已有一部分），便于升级前预检 |
| V5 | 桌面 web 组合是否把 `compression` 从默认 `'none'` 改成 `'gzip'` | 默认值已确认（`dsh-host-webserver/lib/index.js:109`、`:263`），实际 profile 的 webserver 配置项未逐一核对（`dsh-web-app/cordis.patch.yml` 内 grep `webServer` 无配置行） | `grep -n "compression" <profile>/cordis.patch.yml`；或运行时打印 `ctx.webServer.config.compression`（注：即使为 gzip 也已证明不压 SSE） |

---

## 五、与 Lead 同步项的核对（含一处更正）

1. Lead：运行中桌面端为 0.2.1-rc.3 —— 与解包 `dsh/package.json`（`@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.3`）一致，**采信**。
2. Lead：`GET /sidecard-ask/api/ping` 返回 `{"ok":true,…}` —— 与 `index.js` 的 ping 分支（免 auth、`writeOk`）一致，**采信**，并据此确认 webServer 前缀路由在 rc.3 生效（对照 `dsh-host-webserver/lib/index.js:326-333`、`:495-504`）。
3. Lead：`ctx.get('agents')` 存在（引 `dsh-agent/lib/index.js:43`）—— 结论正确，**行号不准确**：`super(ctx, "agents")` 在 `dsh-agent/lib/index.js:332`；`:43` 是无关注释。本文件按 332 引用。

---

_生成时间：2026-10-24（Asia/Shanghai）。所有引用行号基于 `.compat-report/evidence/dsh-0.2.1-rc.3` 解包快照，若 DSH 后续发布 rc.4 需重新核对。_
