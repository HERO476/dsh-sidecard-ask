# dsh-sidecard-ask 兼容性验证与修复报告（1.6.0）

- 被测插件：`dsh-sidecard-ask` v1.5.1（验证起点）→ **v1.6.0（本次修复版）**
- 验证日期：2026-10-11
- 验证对象：npm 上最近 10 个 DSH 发布版 + 生态内侧边卡片/侧边栏类插件
- 验证方式：真实安装启动（隔离 `DSH_HOME`）、HTTP/SSE 探针、运行时反射探针、**无头 Edge 真机浏览器验证**、577 项自动化测试
- 结论摘要：发现 **3 个真实问题，均已修复**；10 个版本在 1.6.0 下全部可用；侧边卡片生态**无硬性资源冲突**。

---

## 1. 十个 DSH 版本的适配结果

### 1.1 范围与重要前提（准确性说明）

1. **npm 上不存在"正式版"**：截至验证日，`@deepseek-ai/dsh` 的 32 个已发布版本全部带 `-alpha/-rc` 预发布标记，`latest` 标签指向 `0.2.0-rc.2`，`next` 指向 `0.2.1-alpha.2`。因此"最近 10 个发布版"按 npm 发布时间排序为：

   | # | 版本 | 发布通道 |
   |---|---|---|
   | 1 | 0.1.5-rc.3 | rc |
   | 2 | 0.1.6-alpha.2 | alpha |
   | 3 | 0.1.7-alpha.1 | alpha |
   | 4 | 0.1.7-alpha.2 | alpha |
   | 5 | 0.1.7-rc.1 | rc |
   | 6 | 0.1.7-rc.2 | rc（此前唯一真机版） |
   | 7 | 0.2.0-rc.1 | rc |
   | 8 | 0.2.0-rc.2 | rc（= latest） |
   | 9 | 0.2.1-alpha.1 | alpha |
   | 10 | 0.2.1-alpha.2 | alpha（= next，最新） |

2. **每个版本的验证内容**（全部在本机隔离环境真实执行，非静态推断）：
   - `dsh plugin --profile web add` 安装插件，启动 web 实例（独立临时 `DSH_HOME`，不触碰用户真实 `~/.dsh`）；
   - 插件宿主路由 `GET /sidecard-ask/api/state`（期望 200，401=未带 token 属正常）；
   - 运行时反射探针在挂载时、+8s、+22s 三个时点读取 `subagents` 服务的方法面、provider 注册表；
   - `--dump-config` 确认组合树包含 spawn/fork provider；
   - 启动日志无 `did not activate / failed to import`；
   - 对两个关键版本（0.2.0-rc.2、0.2.1-alpha.2）另做无头浏览器真机验证（选区、Alt+Q、提问框、承载面、错误降级）。

### 1.2 v1.5.1（修复前）实测矩阵

| 版本 | 安装 | 路由 | 侧边引擎 | provider | `subagents.start()` | 启动告警 |
|---|---|---|---|---|---|---|
| 0.1.5-rc.3 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.1.6-alpha.2 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.1.7-alpha.1 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.1.7-alpha.2 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.1.7-rc.1 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.1.7-rc.2 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.2.0-rc.1 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.2.0-rc.2（latest） | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| 0.2.1-alpha.1 | ✅ | 200 | **可用** | spawn, fork | 存在 | 0 |
| **0.2.1-alpha.2（next）** | ✅ | 200 | **❌ 不可用** | `[]` | **已被移除** | 0 |

**关键发现（问题 1，已在 1.6.0 修复）**：0.2.1-alpha.2 把子代理 API 从
`subagents.start(provider, request)` 重构为受管激活
`subagents.startActivation({ provider, label, request, signal, delivery })`，
返回值由 `{id, localAgent, result, dispose}` 变为 `{childId, result, dispose}`。
v1.5.1 的能力门只认 `start()`——而 provider（spawn/fork）其实注册成功，导致自检显示
"侧边作答引擎：不可用"，侧答返回 `no-side-engine` 可读错误并提示"改到主对话"。
这是**只有真机才能发现**的问题：旧的产物字符串探测（compat-probe）显示周边 API 都在。

### 1.3 v1.6.0（修复后）复核

- 自动化：577 项测试全部通过（verify 53 / contract 323 / float-placement 38 / smoke 163），
  其中新增的 smoke 用例在"只有 startActivation、没有 start"的替身组合上端到端验证了作答链路。
- 无头 Edge 真机（4 个隔离 profile，共 18 项断言全部 PASS）：

| Profile | 关键断言 | 结果 |
|---|---|---|
| 0.2.1-alpha.2 | 引擎可用、provider=[spawn,fork]、客户端 v1.6.0 | 4/4 PASS |
| 0.2.0-rc.2 | 引擎可用 + data-slot 锚点两次自检不翻转 + 单实例选举 | 5/5 PASS |
| 新旧包共载 | 旧层存在但被隐藏、可见触发按钮恰好 1 个、Alt+Q 弹层恰好 1 个、family.legacy=true | 7/7 PASS |
| + dsh-better-sidebar 0.25.0 | 承载面识别 available，版本 0.25.x | 3/3 PASS |

更早版本（0.1.2-rc.1 ~ 0.1.5-rc.3）仍只有 README §7 记载的**产物标记 + 降级分支**证据，
不在本轮真机范围；1.6.0 未改动任何旧分支代码（双 API 按运行时方法面自动选择）。

---

## 2. 侧边卡片 / 侧边栏类插件专项冲突检测

### 2.1 目标识别

从官方收录索引（`awesome-dsh-plugin`，4489 个条目）中按"文件名强信号 + 描述主语"识别出
**25 个**侧边卡片/侧边栏类插件（24 个成功取得发布产物，1 个仓库无可用包：
`qcsjjjjj/dsh-hero-rightbar`——其收录条目本身是脚手架模板）。

分组：
- **侧边承载面本体**：`omdsh-dev/DSH-better-sidebar`（npm `dsh-better-sidebar`，canonical，最新 0.25.0）、
  `All3nCN/dsh-better-sidebar-N23`（npm `@all3cn/dsh-better-sidebar-n23`，0.12.3 服务协议的工作台 fork）；
- **better-sidebar 扩展**：drscrewdriver 的 brief / canvas-tsx / docx / opensheet / pptx 五个只读视图，
  以及索引中数十个"注册为 better-sidebar tab"的应用（git graph、媒体预览、工作区搜索等，与本插件无交互面重叠）；
- **独立右侧面板/浮层**：popout-sidebar、flyout-sidebar、codex-sidebar、git-sidebar、right-sidebar、
  sidebar-plus、sidebar-width、sidebar-balance、token-usage-sidebar、sidebar-annotations、
  sidebar-views、settings-drawer、chat-rail；
- **同功能竞品**（选中文字→侧边作答）：`hufeide/dsh-sidebar-assistant`（npm `dsh-sidehelper`）、
  `Ruiming-cn/dsh-ask-in-sidebar`、`anzhaohao/dsh-side-chat-plus-plus`。

### 2.2 静态资源重叠（24 个产物逐一扫描）

| 冲突维度 | 结果 |
|---|---|
| localStorage 键 | **0 冲突**（本插件唯一键 `dsh-sidecard-ask:cards:v1` 无人共用；57 个第三方键中仅 "daily" 被两个互不相关的插件使用，与本插件无关） |
| 宿主 HTTP 路由前缀 | **0 冲突**（本插件 `/sidecard-ask/api`；第三方各用 `/sidebar/api`、`/git-sidebar/api` 等） |
| 右侧栏 tab kind | **0 冲突**（本插件 `sidecard-ask:card` / `…:workbench` 唯一） |
| bundle patch id | **0 冲突**（宿主对同 band+kind 二次注册直接抛错的规则下，10 版本启动均无此类错误） |
| `$DSH_HOME` 目录 | **0 冲突**（本插件只写 `sidecard-ask/config.json`） |
| 默认快捷键 Alt+Q | **0 冲突**（侧边类中无人占用） |
| `shell.overlay` 槽位共用 | 8 个（popout / flyout / codex / git-sidebar / right-sidebar / ask-in-sidebar / side-chat++ / chat-rail）——list 槽位设计上允许多注册，实测共载时各自渲染 |
| `sidebar.right.pane.tab` 共用 | 9 个（含 better-sidebar 本体与其扩展）——tab kind 互不相同 |

### 2.3 动态共载实测（0.2.0-rc.2，真实启动）

1. **+ dsh-better-sidebar 0.25.0（canonical）**：安装/启动 0 告警；本插件引擎正常；
   客户端自检识别 better 服务 available、版本 0.25.x、tabMeta 能力具备；
   我们注册的 tab kind 与 better 自己的注册表不冲突。
2. **canonical 0.25.0 + N23 fork 同时安装**：N23 **激活失败**（`failed to import`，
   源码目录安装时缺 `ws` 包解析——**N23 自身打包缺陷，与本插件无关**；其 npm 包依赖声明存在，
   正式 npm 安装路径下用户应能复现/反馈给 N23 作者）。两个实现都 `ctx.provide("betterSidebar")`，
   同名服务只会有一个生效；本插件按"谁加载成功用谁"消费，不产生崩溃。
3. **+ 两个同功能竞品**：`dsh-ask-in-sidebar` 正常激活；`dsh-side-chat-plus-plus` 激活失败
   （依赖 `@deepseek-ai/dsh-typert-protocol`，该内部包在 0.2.0-rc.2 不存在——**竞品自身缺陷**）；
   `dsh-sidehelper` 被官方供应链策略拦截（需 `--accept-risk`，其安装清单声明了版本兼容范围）。
   行为层面的"多个选中浮层并存"属于 UX 叠加（各自独立的 fixed 浮层与 z-index），
   不存在数据覆盖、路由抢占或崩溃；本插件不 stopPropagation 文档级选区事件，不阻断他人。
4. **旧名包 `dsh-selection-followup@1.0.1`（本插件作者自己的旧名）+ 1.6.0 共载**：
   这是实测中唯一的"同作者双份"场景，v1.5.1 会双重触发（见问题 2），1.6.0 已解决。

### 2.4 与记忆类插件的关系（澄清）

记忆类并非本次专项对象；前序轮次已扫描 209 个 category=memory 插件，
无一对本插件的 localStorage/路由/tab/目录构成硬冲突。记忆插件之间互相存在
同名工具注册（如 `memory_recall` 被两个不同插件同时注册导致其中一个未激活）、
共享约定文件名（AGENTS.md 51 个、MEMORY.md 29 个）等现象，但均与本插件无关。

---

## 3. 已修复问题清单（v1.6.0）

### 问题 1：0.2.1-alpha.2 侧边引擎失效（严重，最新版不可用）

- 现象：自检"侧边作答引擎：不可用"、provider 列表空、侧答返回 `no-side-engine`。
- 根因：宿主子代理 API 换代，能力门与启动调用只认旧的 `start()`。
- 修复（`index.js`）：
  - `subagentsService()` 接受两代方法面（`start` 或 `startActivation` 任一即可启动）；
  - 新增 `startSubagent()` 归一化层：新 API 用 `delivery: 'caller'`（答案不进主对话，保持旧语义），
    请求字段移入 `request`，流式帧改由子会话 id 归因（新运行时不再给 live Agent 句柄）；
  - 旧 9 个版本的调用路径与字段门控（persona/toolFilter 能力协商）完全不变。
- 回归：smoke 新增 13 项（含 caller delivery、字段归位、无 start 方法、按会话 id 收流）。

### 问题 2：新旧包名共载双重触发（中，功能冲突）

- 现象：`dsh-selection-followup`（≤1.0.1）与 `dsh-sidecard-ask` 同时启用时，
  选区旁叠两个"追问选中内容"按钮（2px 错位、旧按钮被完全遮挡点不到），一次 Alt+Q 弹两个相同提问框。
- 修复（`client.js` §4.5 家族单例）：
  - 协作副本（任何含本节的版本）通过 `window.__dshSidecardFamily` 注册表选举唯一领导者
    （版本号高者胜，同版本先加载者胜）；落选副本保留设置页（显示停用横幅）但不挂载任何交互面、
    不响应快捷键；
  - 无法协作的 1.0.x 旧版按结构特征识别（无 `data-dsa-owner` 标记的 `dsa-layer`），
    领导者注入样式隐藏旧版整个交互层，并 toast 提示卸载旧包；
  - 自检上报新增 `family: {leader, legacy, peers}`，宿主白名单做长度裁剪（smoke 覆盖）。
- 回归：contract 新增 27 项（选举纯函数、DOM 识别、双真实副本共载只出一个触发按钮/弹层）。

### 问题 3：data-slot 锚点自检两次结果不一致（低，诊断误导）

- 现象：同一页面连续两次"运行自检"，"区域锚点（data-slot）"一次"可用"一次"缺失，区域过滤被误停。
- 根因：旧逻辑用"当前选区是否在锚点链内"反推"本版本是否支持锚点"；选区落在直接挂 body 的节点
  （引导弹窗、第三方裸 DOM）时把全局判定翻成 false。
- 修复：改为构建级探测（全文档是否存在 `[data-slot]`），单个无锚点选区不再影响全局判定；
  判定变化时立即补一次 `/diagnose` 上报（此前宿主侧只能看到启动时的旧快照）。
- 回归：无头真机两版本各连续两次选区+上报，`zoneAnchors` 均稳定为 true。

---

## 4. 可复现的验证过程

所有产物均在 `%TEMP%\dsh-compat\`（验证后已清理）；可保留的脚本与截图已收入本目录：

- `scripts/headless-verify.mjs`：启动 4 个隔离 profile → 无头 Edge 跑 18 项断言；
  依赖 `playwright` + 系统 Edge（`channel: 'msedge'`，无需下载浏览器）。
- `scripts/anchor-probe.mjs`：锚点判定稳定性专项（两版本 × 两次选区）。
- 复现步骤（每个 DSH 版本）：
  1. `npm i --prefix <临时目录> @deepseek-ai/dsh@<版本>`；
  2. 用该版本 CLI 引导独立 profile：`<bin> --profile web --port <端口>`（生成后关闭）；
  3. `<bin> plugin --profile web add dsh-sidecard-ask-1.6.0.tgz`（或解包后的 package 目录）；
  4. 重启后 `GET /sidecard-ask/api/state?token=<启动日志中的 token>`，核对
     `capabilities.sideEngine === true`、`sideProviders` 含 spawn/fork；
  5. 无头浏览器打开带 token 的页面，选区→看唯一触发按钮→Alt+Q→唯一提问框；
  6. 共载场景：再 `add dsh-selection-followup@1.0.1`，重复第 5 步。

截图证据（无头 Edge 实拍）：

| 文件 | 内容 |
|---|---|
| `shots/alpha2-engine.png` | 0.2.1-alpha.2 修复后引擎可用 |
| `shots/anchor-rc2.png` / `shots/anchor-alpha2.png` | 锚点判定稳定 |
| `shots/coload-single.png` | 新旧包共载，仅一个可见触发面 |
| `shots/better025.png` | better-sidebar 0.25.0 共载 |
| `shots/rc2-anchors.png` | rc2 设置/自检页 |

---

## 5. 残留观察项（非阻塞，供后续跟进）

1. **生产包引用了 dev-only 的 `/@vite/client`**：所有 DSH web 实例的 Network 面板都有
   `GET /@vite/client → ERR_ABORTED`，来自宿主自身的构建残留，与本插件无关，不影响功能。
2. **两个生态插件自身打包缺陷**（实测激活失败，建议向作者反馈，无需本插件改动）：
   `@all3cn/dsh-better-sidebar-n23`（源码安装缺 `ws`）、
   `dsh-side-chat-plus-plus`（引用 0.2.0-rc.2 不存在的 `@deepseek-ai/dsh-typert-protocol`）。
3. **桌面端拖拽区、Electron 菜单加速键**仍只有 README §5.3 记载的 2026-09-30 实测，本轮未复测桌面 App。
4. 更早的 6 个发布版（≤0.1.5-rc.3）未做本轮真机安装，仅保留产物层证据。
5. 端到端"真实模型流式作答"需要用户自己的 API Key 与工作区，本轮在无凭据条件下验证到
   SSE 错误信封与降级按钮层（alpha.2 时代）；修复后引擎可用、provider 在册，
   作答链路由 163 项 smoke（替身按真实事件形状发帧）保证。
