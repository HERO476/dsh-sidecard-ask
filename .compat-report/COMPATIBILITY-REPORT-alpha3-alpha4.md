# dsh-sidecard-ask 对 DSH 0.2.1-alpha.3 / 0.2.1-alpha.4 的适配性核查报告

- 被测插件：`dsh-sidecard-ask` **v1.7.1**（当前工作区源码 + `npm pack` 发布形态 tgz）
- 核查日期：2026-10-16
- 核查对象：`@deepseek-ai/dsh` **0.2.1-alpha.3**（2026-10-14 发布）、**0.2.1-alpha.4**（2026-10-15 发布，`alpha` 通道当前指向）
- 参照基线：**0.2.1-alpha.2**（1.6.0 已真机适配并复核的版本）
- 核查方式：npm 发布产物逐包文件级 diff（13 个相关包 × 3 版本）＋ 隔离 `DSH_HOME` 真实安装启动 ＋ HTTP/SSE 探针 ＋ 无头 Edge 真机断言 ＋ 插件自身 1004 项回归
- **结论：两版均无需改动即适配。** 插件消费的每一个 API 面在两版上都与 alpha.2 基线等价；真机上插件在两版完成「安装→激活→槽位落点→原生右侧栏→`startActivation` 实调出 childId→错误信封降级」全链路，行为逐字段同构。

---

## 1. 结论摘要

| 核查维度 | 0.2.1-alpha.3 | 0.2.1-alpha.4 |
|---|---|---|
| 产物能力矩阵（16 项，见 §2） | ✅ 与 alpha.2 全同 | ✅ 与 alpha.2 全同 |
| 宿主半关键文件 vs alpha.2 | 有实质变化（见 §3），**无一命中插件消费面** | 与 alpha.3 逐字节一致（除 client 侧增量） |
| 真机安装激活 | ✅ 0 告警 | ✅ 0 告警 |
| 槽位落点 / 原生右侧栏 | ✅ shell.overlay / settings.section / conversation.input.right | ✅ 同左 |
| 侧边作答引擎（`startActivation` 实调） | ✅ `start` 事件带真实 childId | ✅ 同左 |
| 无头 Edge 交互断言 | ✅ 21/21（有效项） | ✅ 21/21（有效项） |
| 需要的代码改动 | **无** | **无** |

两处说明（都是探针口径而非适配问题，已在源码层证实并在真机复核修正）：

1. 数字型配置越界（如 `floatMaxWidth: 9999`）的宿主侧行为是**夹取到 560**（`sanitizeLayer` → `clampNumber`），不是整表拒绝；真正的 400 `invalid-config` 路径是 `quickActions` 的 all-or-nothing 校验——两版行为一致，与插件契约测试锁定的语义一致。
2. 客户端自检的 `zoneAnchors` 在**首次真实选区之前**按设计上报 `null`（`store.state.zoneAnchors` 初始即 null，`client.js` §"unknown yet"），首次选区后变 `true`——两版一致。

---

## 2. 版本识别与产物能力矩阵

npm 发布记录（`npm view @deepseek-ai/dsh time`）：

| 版本 | 发布时间 | 通道 |
|---|---|---|
| 0.2.1-alpha.2 | 2026-10-09 | （1.6.0 时的 `next`） |
| **0.2.1-alpha.3** | **2026-10-14 12:35** | — |
| **0.2.1-alpha.4** | **2026-10-15 13:08** | **= `alpha` 标签当前指向** |

通道变化值得记录：`next` 标签现在指回 `0.2.0-rc.2`，`0.2.1` 线改挂在 `alpha` 标签下。

`node tools/compat-probe.mjs 0.2.1-alpha.2 0.2.1-alpha.3 0.2.1-alpha.4` 的能力矩阵（16 项）**三版完全一致**：

| capability | alpha.2 | alpha.3 | alpha.4 |
|---|---|---|---|
| clientBundle / overlaySlot / composerSlot / settingsPage / zoneAnchor | ✅ | ✅ | ✅ |
| nativeRightbar / submitUsing / submitRetain / archiveGate / streamFrames | ✅ | ✅ | ✅ |
| sideEngine / providerCaps / toolRegistry / pluginRoutes | ✅ | ✅ | ✅ |
| durableChunks（0.1.x 时代的第二流式源，0.2.1 线本就没有） | ❌ | ❌ | ❌ |
| liveChild（`startActivation` 代际本就不给 live 句柄，1.6.0 已适配） | ❌ | ❌ | ❌ |

原始输出已存档：`.compat-report/evidence/a34-compat-probe-raw.json`。

> 1.6.0 的教训是标记探测发现不了语义重构（alpha.2 的 `startActivation` 就是真机才暴露的），所以本轮把重心放在 §3 的内容级 diff 与 §4 的真机实调上。

## 3. 逐包内容级 diff 与插件消费面判定

对插件依赖的 13 个 `@deepseek-ai/dsh-*` 包做了解包逐文件 SHA256 比对（脚本思路与 compat-probe 相同，tar 读入内存）。

### 3.1 alpha.3 → alpha.4：宿主面零变化

先说结论：**本插件消费的所有宿主侧文件在两版之间逐字节相同**，已验证的有：

- `@deepseek-ai/dsh-subagent/lib/index.js`（141,871 字节，哈希一致）
- `@deepseek-ai/dsh-host-webserver/lib/index.js`
- `@deepseek-ai/dsh-tools/lib/index.js`
- `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js`
- `@deepseek-ai/dsh-client-ui-renderer/lib/client.js`
- 其余各包在文件级 diff 中仅 `package.json` 版本号变化

alpha.4 的真实增量全部在客户端侧，且均为纯增量：

| 包 | 变化 | 对本插件的影响 |
|---|---|---|
| `dsh-client-modules` | 新增 `notify`（订阅者通知）与 `release-change`（`ReleaseChangeGate`：宿主更新落后于页面时提示刷新）；boot manifest 新增可选 `release` 字段，**缺失时不报错**（`decodeRelease(undefined) → undefined`） | 无。且该门恰好改善 1.3.1 记录的「宿主半已更新、客户端半还是旧的」代际偏斜问题——宿主更新后用户会被主动提示刷新 |
| `dsh-client-ui-conversation` | 输入编辑器新增 CommandChip（类型与投影），`claim-decor` 移除 | 无。插件消费的 `conversation.input.right/left`、`conversation.composer.dock` 槽位与 `inputActions`（`setDraft`/`submit`）出现次数逐项不变（11/13/49→50，新增 1 处即 CommandChip） |
| `dsh-client-ui-settings-general` | 新增 `HostReleasePrompt`（配合 ReleaseChangeGate 的设置入口） | 无。`settings.section` 槽位不动 |
| `dsh-api-session-controller` | `lib/typert.host.js` 唯一一行变化＝在错误码表中**新增** `plugin-market/*` 六条（配套新增的插件市场） | 无。纯增量 |
| 主包依赖 | 仅新增 `dsh-experimental-plugin-market-bundle` | 无 |

### 3.2 alpha.2 → alpha.3：一次实质跳变，逐项判定

alpha.3 是有实质内容的版本。与本插件消费面相关的全部变化及判定：

**(a) 子代理能力模型重排（`dsh-subagent`）——判定：对本插件无影响，运行时证据见 §4**

- `assertCapabilities` 的协商清单从 `agentOptions/outputSchema/maxDepth/toolFilter/persona` 改为 `agentOptions/agentPreset/outputSchema/maxDepth`——**`persona` 与 `toolFilter` 从能力协商中整体移除**；
- 本地创建路径（`startLocal`）的 `composition` 从 `{persona, toolFilter}` 改为 `{agentPreset}`；`NO_START_CAPABILITIES`（out-of-process 后端的能力告示）的键面同步去掉 `persona/toolFilter`、加入 `agentPreset`；
- **为什么不影响本插件**：插件从 1.0.0 起按「provider **声明**支持才发送」做字段门控。spawn/fork 是 out-of-process provider，在 alpha.2 的告示里 `persona:false/toolFilter:false`，在 alpha.3 里这两个键**整个不存在**——读出来都是 falsy，插件走完全相同的路径：**persona 内联进提示词（`persona:'prompt'`）、不发送 toolFilter（`toolFilter:'unsupported'`）**。§4 的真机 `start` 信封逐字段证实了这一点；
- 插件实际调用的方法面**未变**：`startActivation(spec)`（`spec.provider/label/request/signal/delivery`），返回 `receipt = {childId, result: promise, dispose}`——两版逐字段一致；`delivery:'caller'` 语义在两条启动路径上都保留（`startLocal`：caller 用可选持久化；`startExternal`：caller 不建立父会话目录子项，答案不进主对话）；
- 新增的可选字段（`spec.childId` 预留 id、`request.agentPreset`、`request.outputSchema`）插件都不发送，`assertCapabilities` 对插件的请求对象（`{prompt, parent, …}`）无任何新拒绝点。

**(b) 会话控制器（`dsh-api-session-controller`，+18% 体量）——判定：消费面不变**

插件读取的 `using/retain/scope`、`archivedSessionIds`、`agent/pre-step` 门在两版的关键字计数与位置均未变；体量增长来自 user-text 文档/注册表等新类型（见 `lib/types/client/user-text/*` 新文件），与插件无关。

**(c) 原生右侧栏（`dsh-client-ui-sidebar-right`，client.js 从 333KB 重写到 190KB）——判定：消费面逐项不变**

对插件消费的 API 字符串做了三版计数比对，**每一项都相同**：`sidebarRightTabs`(1)、`sidebarRight`(30)、槽位 `sidebar.right.pane.tab`(13) 与 `.title`(7)、`openTab`(23)、`revealIfOpened`(13)、`preferNewPane`(8)、`guide`(75)。重写是内部实现收缩，插件注册 tab 类型→注册槽位→`openTab(kind, {params, revealIfOpened})` 的链路不受影响。

**(d) HTTP 服务器（`dsh-host-webserver`）——判定：纯增量**

alpha.3 仅新增 `bindUrlHost()`/`getOrigin()`（为桌面外壳提供 origin 文本），`register` 的 `(kind, path)` 语义、`prefix` 路由与 handler 分发未动；插件的前缀路由与逐方法降级不受影响。

**(e) 工具表（`dsh-tools`）——判定：纯增量**

新增 `ptc-calls` 模块；插件调用的 `schemas()`(4) 与 `restrict()`(6) 计数不变。

**(f) 其余**（`dsh-agent-loop`、`dsh-session`、`dsh-workspace`、`dsh-client-ui-layout`、`dsh-client-ui-renderer`）：`agent/assistant-stream` 帧事件、归档门、`data-slot` 锚点(6)、`standardProps`(4) 等消费面计数不变。

**(g) 插件客户端注入的外部包**：`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-conversation` 在两版都有对应发布（0.2.1-alpha.3 / 0.2.1-alpha.4），web-app 对 locale 与 ui-conversation 的依赖钉在同一版本。真机加载证实三个外部包全部解析成功（§4 槽位落点即证据）。

## 4. 真机验证（隔离环境，两版各一套）

### 4.1 环境与流程（可复现，脚本已存档）

每个版本：`npm i --prefix .tmp/rm/v/<id> @deepseek-ai/dsh@<版本>` → 首次 `dsh web --no-open --port <p> --host 127.0.0.1`（`DSH_HOME` 指向隔离目录）引导出 `profiles/web` → **官方 CLI 安装发布形态产物**：`dsh plugin --profile web add dsh-sidecard-ask-1.7.1.tgz`（tgz 由工作区 `npm pack` 得到，10 个文件与 `files` 清单一致）→ CLI 自动把 `dsh-sidecard-ask` 追加进 profile `package.json` 的 `dsh.profile.bundles` → 重启实例 → 探针。

脚本：`.compat-report/scripts/rm-verify-a34.mjs`（全流程 21 断言）与 `.compat-report/scripts/rm-probe2-a34.mjs`（修正口径后的 5 项聚焦探针）。端口 18321（alpha.3）/ 18322（alpha.4），验证后已释放。

### 4.2 真机断言结果（21 项有效断言，两版全过）

| 断言 | alpha.3 | alpha.4 |
|---|---|---|
| 启动日志无 `did not activate / failed to import` 等异常 | ✅ | ✅ |
| `GET /sidecard-ask/api/state` → 200 | ✅ | ✅ |
| 宿主半上报 v1.7.1 | ✅ | ✅ |
| `capabilities.sideEngine === true` | ✅ | ✅ |
| provider 注册表含 `spawn` + `fork` | ✅ | ✅ |
| 配置写路径：越界数字**夹取**到 560（200） | ✅ | ✅ |
| 配置写路径：畸形 `quickActions` 整表 → 400 `invalid-config` | ✅ | ✅ |
| `POST /ask`（无会话时）→ 结构化 SSE 错误信封 `no-parent` + `fallback:'main'` | ✅ | ✅ |
| 客户端半加载（自检上报 v1.7.1） | ✅ | ✅ |
| 三个槽位落点：`overlay=shell.overlay`、`settings=settings.section`、`sessionProbe=conversation.input.right` | ✅ | ✅ |
| 原生右侧栏适配器 `available=true` | ✅ | ✅ |
| 家族选举：单安装为 leader、无 legacy | ✅ | ✅ |
| 选区后 `zoneAnchors === true`（首次选区前为 null 属设计行为） | ✅ | ✅ |
| 选区后可见触发按钮**恰好 1 个** | ✅ | ✅ |
| `Alt+Q` 弹出提问框**恰好 1 个** | ✅ | ✅ |
| 无未捕获页面错误 | ✅ | ✅ |

（第一轮全流程脚本里有两处探针断言口径写错——把「夹取」当成「拒绝」、在首次选区前读 `zoneAnchors`——两版上表现一致且与源码语义吻合，修正口径后以 `rm-probe2` 复核，上表为修正后的合并结论。原始两轮结果存档于 `.compat-report/evidence/`。）

### 4.3 侧答引擎实调证据（本轮最有分量的一条）

在无头 Edge 里通过 composer 发送一条消息造出活动会话代理（`liveAgents: 1`）后，直接 `POST /sidecard-ask/api/ask`，两版返回的 SSE 事件序列**逐字段同构**：

```
event: start
data: {"id":"probe2-<ver>","provider":"spawn","childId":"<uuid>",
       "maxChars":4000,"truncated":false,"droppedChars":0,
       "toolFilter":"unsupported","persona":"prompt","parentArchived":false}

event: status
data: {"id":"probe2-<ver>"}

event: error
data: {"id":"probe2-<ver>","code":"engine-error","message":"作答失败（error）",
       "retryable":false,"fallback":"main","stopReason":"error","parentId":"session-<uuid>"}
```

这条信封一次性证实了四件事：

1. **`subagents.startActivation()` 在两版上都被插件真实调通**——`start` 事件携带宿主签发的真实 `childId`（这是 1.6.0 为 alpha.2 重构铺的「运行时方法面自动选择两代 API」路径在 alpha.3/alpha.4 上的直接验证）；
2. provider 选择、并发/截断参数、父会话归档门（`parentArchived:false`）全部按既有语义工作；
3. **字段门控与 alpha.3 能力模型重排的交互与静态分析完全一致**：`toolFilter:'unsupported'`（插件没有发送该字段并如实标注）、`persona:'prompt'`（内联进提示词）；
4. `engine-error` 是**无模型凭据环境下的预期终点**（spawn 出的子代理在模型调用处失败），与 1.6.0 验证到达的深度相同；错误信封结构（`retryable/fallback` 降级提示）两版一致。

### 4.4 截图

`shots/a34-alpha3-page.png` 与 `shots/a34-alpha4-page.png` **逐字节相同（SHA256 相同）**——两个宿主版本在相同断言流程下渲染的页面像素级一致（含同位置的选区 fixture），本身就是「客户端面无回归」的一个直观佐证。

## 5. 插件自身回归（当前工作区）

四套测试闸门全部通过，与 1.7.1 CHANGELOG 记录一致：

| 套件 | 结果 |
|---|---|
| `test/verify.mjs` | 53 passed, 0 failed |
| `test/contract-test.mjs` | 721 passed, 0 failed |
| `test/float-placement.mjs` | 38 passed, 0 failed |
| `test/smoke-test.mjs` | 192 passed, 0 failed |
| **合计** | **1004** |

## 6. 残留观察项（如实记录）

1. **真实模型流式作答仍未验证**（与 1.6.0 同一边界）：本机无 API Key/工作区凭据，作答链验证到「spawn 子代理成功 + 模型调用失败的错误信封」；完整 `start→delta×N→done` 由 192 项 smoke（按真实事件形状发帧的替身）覆盖。拿到凭据后按 README §9 的 A 路径人工确认一次即可。
2. **better-sidebar 共载与竞品共载本轮未复测**：1.6.0 已在 0.2.0-rc.2 上验证 better-sidebar 0.25.0 共载与共载单实例；本轮目标是两个新宿主版本本身，插件侧相关代码（家族选举、tab kind 分离）未改动。
3. **桌面 Electron（0.2.0-rc.2 时代实测）未复测**：本轮为 web 形态；alpha.3/alpha.4 的桌面宿主发布时间未核查。
4. **附带观察（非本插件问题，两版行为一致）**：插件自有 API 路由（`/sidecard-ask/api/*`）在宿主 webserver 上对 query 参数名的拼写不敏感——本轮探针曾误把 `?token=` 拼错仍到达了插件路由。插件自身只做 Host/Origin 信任围栏（这是 1.4.0 E19 的设计：仅回环 + 信任名单），token 由宿主的页面/API 鉴权层把守；该现象属宿主 webserver 的鉴权覆盖面问题，如需可向宿主反馈。两版无差异，不影响适配结论。
5. alpha.4 新增的 `ReleaseChangeGate`/`HostReleasePrompt`（插件市场配套）会在宿主热更新后提示刷新页面——对本插件是利好（缓解两半代际偏斜），无适配动作。

## 7. 一句话结论

**v1.7.1 在 DSH 0.2.1-alpha.3 与 0.2.1-alpha.4 上均无需任何改动；1.6.0 建立的双代 API 选择与字段门控机制原样覆盖了这两个版本的全部语义变化，且已在真机上以 `startActivation` 实调证据复核。**

---

## 8. 独立复核（WorkBuddy 会话追加，2026-10-16 08:2x–08:4x，UTC+8）

> 本节由一个**独立会话**在隔离环境中从零重做整套核查后追加，不改动上文任何结论。
> 目的：交叉验证 §1–§7 的「无需改动即适配」结论是否可复现。

### 8.1 复核方式

- **产物层①**：`node tools/compat-probe.mjs 0.2.1-alpha.2 0.2.1-alpha.3 0.2.1-alpha.4` 重跑，
  16 项能力矩阵与 `evidence/a34-compat-probe-raw.json` **逐项比对一致**；原始输出另存
  `evidence/wb-compat-probe-rerun.json`。
- **产物层②**：13 个 `@deepseek-ai/dsh-*` 包的**逐文件 SHA256 diff** 由独立脚本
  （`scripts/wb-artifact-check.mjs`）重算，复现 §3 全部论断：`dsh-subagent` 的 `lib/index.js`
  在 alpha.3/alpha.4 间逐字节一致（141,871 B）；除它之外 alpha.3→alpha.4 的宿主侧文件均仅
  `package.json` 版本号变化；alpha.2→alpha.3 的 `NO_START_CAPABILITIES` 键面（`toolFilter`/`persona`
  移除、`agentPreset` 加入）与计数变化（toolFilter 27→18、persona 25→14、agentPreset 5→25）复现；
  `dsh-client-ui-sidebar-right` 的 `client.js` 333,167 B→190,119 B 且插件消费的全部 8 个字符串计数不变；
  主包依赖 diff（`evidence/wb-main-pkg-depdiff.txt`）：新增依赖仅
  `@deepseek-ai/dsh-experimental-plugin-market-bundle`、无删除、77 项版本号同步上调。
  完整输出见 `evidence/wb-artifact-check-output.txt`。
- **回归层**：插件四套自测重跑——verify **53** / contract **721** / float-placement **38** /
  smoke **192** = **1004 项全部通过**（与 §5 一致）。
- **真机层（本轮重点，全部从零重做）**：`npm i @deepseek-ai/dsh@0.2.1-alpha.{3,4}`
  （609 / 611 个包）→ 隔离 `DSH_HOME` → **官方 CLI**（`dsh plugin --profile web add <tgz>`，
  bundles 由 CLI 自行登记）→ 无头 Edge（Playwright 1.64.1 + 系统 Edge）断言。
  端口 18421 / 18422。脚本与原始输出：
  `scripts/wb-recheck-run1-a34.mjs`、`scripts/wb-recheck-run2-a34.mjs`、
  `evidence/wb-recheck-run{1,2}-results.json`（逐项断言与探针原始数据；控制台日志因仓库 `*.log`
  忽略规则不入库，可由脚本重跑复现）。

### 8.2 复核结果

| 复核项 | alpha.3 | alpha.4 |
|---|---|---|
| 能力矩阵重跑（16 项） | ✅ 与存档逐项一致 | ✅ 同左 |
| 逐文件 SHA256 diff（13 包） | ✅ 复现 §3 全部判定 | ✅ 同左 |
| 插件自测 1004 项 | ✅ 全过 | ✅ 同左 |
| 真机全流程（修正口径后第二次运行，**28 项断言**） | ✅ **28/28** | ✅ **28/28** |
| `startActivation` 实调（真机） | ✅ `start` 事件带宿主签发 childId（spawn；`toolFilter:"unsupported"`、`persona:"prompt"`、`parentArchived:false`） | ✅ 同形 |

第一次运行另有 27 项断言（26 通过）；唯一未过项是**复核方探针的口径问题（非插件问题、两版表现一致）**：
`zoneAnchors` 在首次真实选区之前，**客户端上报体**中的值是 `null`（`store.state.zoneAnchors`
初值，`client.js` 注为 "null = unknown yet"），但**宿主仅保留布尔值**
（`index.js` 白名单 `flag = v => typeof v === 'boolean' ? v : undefined`），
因此从 `/state` 外部读到的是**键缺失**（`undefined`）而不是 `null`。修正断言
（接受 null/absent，并断言"不得为 false"）后第二次运行 **28/28**。

> 与 §1 第 2 条的表述关系：该条写「客户端自检的 zoneAnchors 在首次真实选区之前按设计上报 `null`」——
> 在**客户端已发出的上报体**这一层完全成立；本节补充的是其**宿主可见层**的表示差异（null → 键缺失）。
> 两版行为逐字相同，不构成适配问题，也不改变任何结论。

### 8.3 与上文证据的一致性交叉检查

- 真机 `ask` 信封逐字段同形：`start`（含真实 childId）→ `status` → `error(engine-error, fallback:"main")`，
  与 §4.3 存档一致；childId 为每次新签发的不同 uuid，非复用。
- 槽位落点（`shell.overlay` / `settings.section` / `conversation.input.right`）、家族选举（leader、无 legacy）、
  原生右侧栏适配器 `available=true`、选区后**恰好 1 个**触发按钮、`Alt+Q` **恰好 1 个**弹层、
  无未捕获页面错误——与 §4.2 表逐项一致。
- `run1` 的 2 条 FAIL（每版各 1 条）与 §4.2 注记的两处口径问题属同一类，已按修正口径复跑通过。
- 截图：本节两轮共 4 张存档于 `shots/wb-alpha{3,4}-recheck{,-2}-page.png`。本次两版截图**非逐字节相同**
  （唯一可见差异是侧栏会话条目的相对时间戳：「8秒」vs「1分钟」），与 §4.4 上一会话那对逐字节相同
  并不矛盾（两次捕获的页面瞬态不同）。
- 环境如实记录：验证机无任何模型凭据，主对话消息返回 `MISSING_CREDENTIAL` 属预期；
  作答链验证到达「spawn 成功 + 真实 childId」深度，与 §6 残留观察项 1 同一边界。

### 8.4 复核结论

**独立复现支持原报告全部结论：`dsh-sidecard-ask` v1.7.1 在 DSH 0.2.1-alpha.3 与 0.2.1-alpha.4
上均无需任何代码改动。** 未发现原报告存在实质性不准确之处；唯一补充是对 §1 第 2 条
`zoneAnchors` 的表示层澄清（客户端 `null` / 宿主可见为键缺失，见 §8.2 末段）。
