# Changelog

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
