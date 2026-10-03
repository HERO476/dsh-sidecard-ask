# Changelog

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
