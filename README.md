# dsh-sidecard-ask · 侧边卡片追问

在 DSH Web GUI 里**选中一段文本就能就地追问**：选中处浮出「追问选中内容」按钮 → 弹出提问框 →
答案落在**两个可切换的承载位置**上：

- **独立侧边卡片（默认）**：由子代理在**自己的会话**里作答（不继承父上下文、不打扰主对话），答案在卡片里逐字流式渲染，可关闭 / 复制 / 继续追问；
- **主对话**：追问内容带着引用块进入当前会话，答案随对话原生流式呈现。

聊天记录、任务详情、右侧栏内容……只要是能选中的文本都能用；**没装侧边卡片插件也能跑**（自动回退到内置浮层卡片）。

> **1.5.0 增强一览**（详见 CHANGELOG）：内置浮层不再压住主对话——宽度改由纯函数 `floatPlacement`
> 按「对话区右侧可用带宽」计算（旧实现是固定 400px，在用户截图上压入正文约 113px）；浮层默认是**一行高的胶囊**，
> 可随时「收起 / 隐藏」，运行时的形态切换不写回配置；新增 `floatMode`（默认 `capsule`）与
> `floatMaxWidth`（默认 340）两项设置；卡片阴影减半。

> **1.4.0 增强一览**（详见 CHANGELOG）：卡片**思考过程**（reasoning）可折叠展示并随答案流式渲染；
> **已完成卡片写入 localStorage，刷新页面不丢**；答案渲染扩展链接/斜体/引用/表格；流式输出自动滚动到底；
> 设置页补齐 `sideTimeoutMs` / `sideProvider` 控件；原生右侧栏 tab 可关闭（不再残留空壳）；
> 界面语言解析支持 `navigator.languages` 优先级回退，英文界面显示英文错误文案；
> 长答案的流式增量按 50ms 窗口合并提交（避免整卡重渲染的二次方开销）。

> ## 名字改过两次，原因都写在这里（避免再撞名）
>
> 1. **`dsh-selection-ask` → ✗**：npm 上已被 `chestnut23` 占用（仓库 `lzbaclz/dsh-selection-ask`）。
> 2. **`dsh-selection-followup` → ✗**（1.0.0 / 1.0.1 用的名字）：npm 上当时是空的，但 **DSH 插件生态里已被 `zzx-dear` 使用**——
>    GitHub 仓库 [`zzx-dear/dsh-selection-followup`](https://github.com/zzx-dear/dsh-selection-followup) 与官方收录索引
>    `data/plugins/zzx-dear__dsh-selection-followup.yml`（category: ui，早于本插件约 20 天）。
>    我最初只查了 npm 名字是否可用，**漏查了 GitHub 仓库名与收录索引**，这是本项目的失误，已在 1.1.0 修正。
> 3. **`dsh-sidecard-ask` → ✓**（1.1.0 起）：npm 无同名包、GitHub 无同名仓库；
>    同时它与已有的 8 个"选中文字→引用进输入框/翻译/批注"类插件（`dsh-selection-ask`、`dsh-selection-explain`、
>    `dsh-selection-toolbar`、`dsh-quote-selection`、`dsh-ui-quote-selection`、`dsh-quote-annotate`、
>    `dsh-selection-memory`、`dsh-plugin-followup`）在**名字与定位上都区分开**：本插件的答案是**独立子代理在侧边卡片里流式产出**，
>    而不是把选中内容塞进输入框。
>
> 旧 npm 包名 `dsh-selection-followup` 已 `npm deprecate` 指向新名字；升级只需卸旧装新（见 §三）。



---

## 一、三条关键路径（先看这个）

| 路径 | 操作 | 期望结果 |
|---|---|---|
| **A. 就地追问（侧边卡片）** | 在聊天区选中一句话 → 点浮出的按钮 → 输入问题 → Enter | 右下角浮出卡片，答案逐字流出；卡片底部有「复制 / 继续追问 / 关闭」 |
| **B. 主对话追问** | 选中 → 提问框里把「作答位置」切到**主对话** → Enter | 追问以引用块形式出现在主对话，答案由当前会话正常流式输出 |
| **C. 快捷键 + 降级** | 选中 → 按 `Alt+Q`（默认） | 直接弹出提问框；若侧边作答引擎不可用，卡片给出错误提示与「改到主对话」按钮 |

---

## 二、目录结构与逐文件用途

```
dsh-sidecard-ask/
├── package.json          清单：包名/版本/导出/dsh.bundle.patch/dsh.client（web 平台、immediately、inject）
├── cordis.patch.yml      bundle 补丁：向 profile 插入 id 为 sidecard-ask 的宿主行，并给出全部默认配置
├── index.js              Host 半（宿主侧）：插件自有 API（JSON + SSE）、配置三层合并与持久化、
│                         独立作答引擎（ctx.subagents 子代理 + agent/assistant-stream 桥接）、请求信任围栏
├── client.js             Client 半（浏览器侧）：dsh.client 浏览器产物，单文件、无构建步骤
│                         §1 常量与默认值 §2 i18n §3 线协议客户端 §4 模块级 store §5 选区引擎
│                         §6 两种承载方式 §7 侧边承载面适配 §8 视图工具 §9 组件 §10 插件入口
├── locale/zh.json        插件元数据的中文显示文案（Plugins 页卡片标题/描述）
├── locale/en.json        同上，英文
├── icon.svg              Plugins 页卡片图标（<256 KiB，相对路径）
├── README.md             本文件
├── CHANGELOG.md          版本变更记录
├── LICENSE               MIT
├── design-preview/       1.5.0 的方案讨论资料，**不参与发布**：00–02 是手绘 SVG 示意图（非截图），
│                         03-prototype-ac.html 是可直接双击打开的可点按原型（自带近似色板，非真实观感）
├── tools/
│   └── compat-probe.mjs  DSH 版本能力探测（§7 矩阵的来源）
└── test/
    ├── harness.mjs       测试替身：假宿主 ctx / 假 req·res / 假子代理 provider / 合成浏览器 + 迷你 React
    ├── verify.mjs        静态完整性：清单、补丁、两半导出面、i18n 键覆盖、零依赖承诺
    ├── contract-test.mjs 两端契约：常量一致性、响应信封形状、SSE 逐帧往返、纯函数等价、槽位注册与渲染
    ├── float-placement.mjs 浮层几何：宽度预算不越过对话区右边界、胶囊默认形态、源码钩子（1.5.0 新增）
    └── smoke-test.mjs    宿主端到端：流式、截断、取消、持久化与重启、失败分支、并发上限、传输围栏
```

**不引入任何外部依赖**：宿主半只 import `node:` 内建模块；客户端半只 `require('react')`（由浏览器模块表提供）。
`test/` 目录不进 `files`，不会发布。

---

## 三、安装与启用

### 方式 1：从 npm 安装（推荐）

```powershell
# 在 profile 目录（默认 %USERPROFILE%\.dsh\profiles\web）执行
pnpm add dsh-sidecard-ask
# 然后把包名写进 profile package.json 的 dsh.profile.bundles 数组
#    "dsh.profile": { "bundles": [ ..., "dsh-sidecard-ask" ] }
# 重启 DSH（重启后插件行、客户端产物、设置页一起生效）
```

### 方式 2：让 DSH 自己装（本工作区源码）

在会话里让 Agent 执行 `plugin_manager` 的 `install_bundle`，target 指向本目录的**绝对路径**：

```
plugin_manager(action="install_bundle", target="D:\\Users\\34332\\AI\\dsh-sidecard-ask")
```

`install_bundle` 会自行完成 profile 的写入与 bundle 选择，**不要**手改 profile 的 `package.json` / `cordis.patch.yml`。

### 方式 3：本地联调（junction）

```powershell
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-sidecard-ask" "D:\Users\34332\AI\dsh-sidecard-ask"
# 再手动把 "dsh-sidecard-ask" 加进 profile package.json 的 dsh.profile.bundles
```

### 启用与验证

1. 重启 DSH（新包需要重启才会加载一行全新的 JavaScript 模块）。
2. 打开 Web GUI → **设置 → 插件**，应能看到卡片「侧边卡片追问」。
3. 打开**设置 → 侧边卡片追问**页，点「运行自检」：应显示宿主接口可用、侧边作答引擎可用、provider 列表（本机为 `spawn`）、活动会话代理数。
4. 若自检显示"宿主接口不可达"，说明 `/sidecard-ask/api` 路由没起来——检查 profile 里该 bundle 是否在 `dsh.profile.bundles` 中、以及 DSH 是否重启过。

### 从旧名字升级（1.0.x → 1.1.0）

```powershell
# 1) 卸掉旧 bundle（profile 里旧名字是 dsh-selection-followup）
plugin_manager(action="remove_bundle", target="dsh-selection-followup")
# 2) 装新名字（本工作区源码）
plugin_manager(action="install_bundle", target="D:\\Users\\34332\\AI\\dsh-sidecard-ask")
# 3) 重启 DSH；旧配置目录 <DSH_HOME>\selection-followup 可以删掉（新名字用 <DSH_HOME>\sidecard-ask）
```

> 改了 `client.js` 后如果 `pnpm run dev:web` 没有在跑，浏览器需要刷新页面；改了 `index.js` 需要重启 DSH。

---

## 四、配置项说明表

配置有**三层**，优先级从低到高：

1. **内置默认值**（`index.js` 的 `DEFAULT_CONFIG`）
2. **bundle 补丁层**：`cordis.patch.yml` 的 `config:`（改这里需要重启）
3. **用户层**：设置页保存后写入 `<DSH_HOME>/sidecard-ask/config.json`
   （`DSH_HOME` 未设置或为空白时回退到 `~/.dsh`；**不会**写进程当前目录）

设置页点「重置为 patch 配置」会清空用户层。

| 配置项 | 类型 / 取值 | 默认 | 作用 | 生效方式 |
|---|---|---|---|---|
| `trigger` | `selection` \| `shortcut` \| `both` | `selection` | **触发方式**：选中即浮出按钮 / 只用快捷键 / 两者都要 | 改后立即（客户端读 /state） |
| `defaultCarrier` | `main` \| `side` | `side` | **默认作答位置**：提问框里仍可临时切换 | 立即 |
| `sideSurface` | `auto` \| `native-rightbar` \| `better-sidebar` \| `flow` | `auto` | **窗口模式（侧边承载面）**：自动挑选 / 强制 DSH 原生右侧栏 / 强制 dsh-better-sidebar / 强制内置浮层卡片 | 立即 |
| `maxChars` | 200–60000 | `4000` | **最大字符数**：超出部分头尾保留、中间截断并标注 | 立即 |
| `floatMode` | `capsule` \| `full` \| `off` | `capsule` | **内置浮层的默认形态**：胶囊（一行，最小遮挡）/ 完整卡片栈 / 只留一个计数圆点。运行时可即时收起、隐藏，但不写回本项——刷新后仍回到这里设的默认 | 立即 |
| `floatMaxWidth` | 240–560 | `340` | **内置浮层宽度上限**（px）：实际宽度 = `min(本项, 对话区右侧可用带宽)`，可用带宽不足 240px 时才会压入对话区 | 立即 |
| `shortcut` | 形如 `Alt+Q`、`Ctrl+Shift+K` | `Alt+Q` | **快捷键**：唤起提问框（`trigger` 允许时） | 立即 |
| `captureZones` | `auto` \| `chat` \| `task` \| `chat+task` | `auto` | 只在哪些区域触发 | 立即 |
| `showInUnclassified` | 布尔 | `true` | 无法归类的区域是否也触发 | 立即 |
| `minChars` | 0–200 | `2` | 少于该字符数的选区不触发 | 立即 |
| `maxConcurrentAsks` | 1–12 | `3` | 侧边卡片并发作答上限，超出返回 `busy`（可重试） | 立即 |
| `sideTools` | `readonly` \| `inherit` | `readonly` | 侧边作答者的工具权限：只读白名单 / 继承当前会话 | 下一次提问 |
| `sideTimeoutMs` | 5000–3600000 | `180000` | 单次侧边作答超时 | 下一次提问 |
| `sideProvider` | 字符串 \| `auto` | `auto` | 指定子代理 provider（`auto` 优先 `spawn`） | 下一次提问 |

非法值会被拒绝（设置页报错、接口返回 `invalid-config`），并把被忽略的项列在 `/state` 的 `problems` 里——不会静默吞掉。

### 4.1 内置浮层的位置规则（`floatPlacement`）

用户实测报告过一个问题：浮层是 `position:fixed; right:16px; width:min(400px,92vw)` 的实心卡片。
实测那一次（1400px 宽的窗口）对话区右边界在 x≈971，而浮层左边界在 x≈858，**压住正文约 113px**，
最后几行答案被盖住。两点如实说明：**旧实现并不是任何窗口宽度下都越界**——1400px 窗口理论上
`1400-16-400=984`，还在 971 右侧；越界与否取决于当时的帧宽与对话区带宽，而固定 400px 的选择
让「窗口一窄就必然压住正文」。这条读数（971 / 858 / 113px）是截图上的像素测量，不是日志里的一手数据。
现在的位置由 `client.js` 里的纯函数 `floatPlacement` 决定：

```js
// floatPlacement({ frameWidth, laneRight, railLeft = null, maxWidth = floatMaxWidth })
avail = 帧宽 - 8 - 对话区右边界          // 对话区右侧那条「预留带」
if (右栏存在) avail = min(avail, 帧宽 - 右栏左边界 - 10)
avail = max(240, floor(avail))            // 240px 以下胶囊也不可用，故为硬下限
width = min(floatMaxWidth, avail)
left  = 帧宽 - 8 - width                  // 右锚定
bleeds = 对话区右边界 - left > 1          // 只有带宽 < 240px 时才可能为 true
```

- 浮层**只使用对话区右侧的预留带**（右栏也在这条带里），窗口越窄它越窄，而不是越靠左。
- `capped: true` 表示「上限没用满，是被可用带宽压住的」——这是正常的自适应，不是错误。
- 挂载时、窗口 resize 时、右栏开合时（`ResizeObserver`）都会重算；流式刷新只重渲染，不动几何。
- 浮层根节点带 `data-layer-width`（实际宽度）与 `data-dsa-float-mode`：报告问题时可直接读这两个值。

---

## 五、侧边承载面与"侧边卡片插件"适配

侧边卡片的渲染面按**能力探测**依次挑选，任何一层不可用都不影响整体可用：

| 顺序 | 承载面 | 依赖 | 失败时 |
|---|---|---|---|
| 1 | DSH 原生右侧栏 | `ctx.sidebarRightTabs`（注册 tab 类型）+ `ctx.sidebarRight`（`openTab`），并占用槽位 `sidebar.right.pane.tab` / `…tab.title` | 记 `surfaces.native.error`，落到下一层；**类型注册会回滚**（见下） |
| 2 | **dsh-better-sidebar**（侧边卡片插件） | 客户端服务 `ctx.betterSidebar`：`registerTab` + `openTab(seed, scope)`；卡片 id 走 `tab.meta.cardId`，因此**要求其 `features` 含 `tabMeta`** | 同上（缺 `tabMeta` 时记 `no-tab-meta` 并跳过，而不是开一个空 tab） |
| 3 | **内置浮层卡片**（默认兜底） | 只需要 `shell.overlay` 槽位 | ——（这是保底面，永远可用） |

- 装了 `dsh-better-sidebar`：卡片以它的 tab 形式出现在它的面板里，关闭卡片会同时 `closeTab`，不残留空 tab。
- 没装：自动使用内置浮层卡片，功能完全一致——**这条路径是本插件的默认与保底路径**。
  浮层默认是**贴帧右边缘的胶囊**（一行高，只有状态与问题首句），点击才展开成完整卡片，
  标题栏右侧的「收起 / 隐藏」可随时收回；它的宽度由 `floatPlacement` 计算，
  只会占用**对话区右侧那条预留带**，不会压住正文（细节见 §4.1）。
- 强制指定了一个不可用的承载面：回退到内置浮层，并在卡片上标注「已回退」。

### 5.1 与 dsh-better-sidebar 0.22.1 的适配核对（2026-09-28）

做法：把 0.22.0 与 0.22.1 的发布产物都拉下来、解包、逐文件比对（`npm pack` + SHA256）。

| 检查项 | 结果 |
|---|---|
| 消费端契约 `lib/types/client/service.d.ts` | **除 `SIDEBAR_SERVICE_VERSION` 常量外逐字节相同** → `BetterSidebarService` 的方法/参数/返回类型没变 |
| `SIDEBAR_FEATURES`（能力清单） | **未变**（`tabMeta` 等仍在；契约承诺"Features are never removed"） |
| `dsh.client.inject` / peer 依赖 | 未变（仍是 locale / ui-slots / ui-conversation / ui-sidebar-right / client-modules） |
| `src/client/native/index.ts`（0.22.1 唯一大体量改动） | 是它**自己原生胶水的健壮性修复**：`disposeSafely` + 槽位注册失败时回滚已注册的 tab 类型；不涉及我们调用的任何字段 |
| 本插件实际用到的面 | `registerTab({id,title,description,order,dedupeKey,component})`、`openTab({type,id,title,meta},{sessionId})`、`closeTab(id)`、`features`、`version` —— 全部仍在 |

**因此 0.22.1 下适配为「无需改动即兼容」**；本轮据此做了三处加固：

1. **能力门控而非版本判断**：适配器只在 `features` 含 `tabMeta` 时可用（0.12 起才有，旧版会开出空 tab）；
   不满足时 `auto` 直接跳到原生右侧栏/内置浮层，设置页自检里写明原因（`no-tab-meta`）。
2. **原生承载面类型注册回滚**：先注册 tab 类型、再注册槽位；槽位注册抛错（reload/teardown 期的失活 context）时
   **释放已占用的类型 id**——这正是 0.22.1 在自己原生胶水里修的同一类问题（否则该 kind 会永久占用并显示宿主"没有实现"的空面）。
3. **运行时可见**：设置页「运行自检」新增一行，直接显示**侧边卡片插件自己的 `version` 与能力项数**，
   以及本插件对它的判定（可用 / 版本过旧 / 未检测到），不再依赖 package.json 的声明。

> 注意：`version` 是加载到浏览器里的那份模块报告的版本。页面刷新后即可用它确认"跑的是不是 0.22.1"。

### 5.2 与 DSH 0.2.0-rc.1 的适配核对（2026-09-29）

本机实际运行的就是 **0.2.0-rc.1**（`@deepseek-ai/dsh` 的 `next` 通道；`latest` 仍是 0.1.7-rc.2）。核对分两层：

**① 包内容层面**（`node tools/compat-probe.mjs 0.1.7-rc.2 0.2.0-rc.1`）：
16 项能力**逐项与 0.1.7-rc.2 完全一致**——`shell.overlay`、`conversation.input.right`、`settings.section`、
`data-slot` 锚点、原生右侧栏、`sessions.using/retain`、归档门、`agent/assistant-stream`、子代理、`tools.schemas`、
`webServer` 路由……全部 ✅。

**② 在运行中的实例上实测**：

| 检查 | 结果 |
|---|---|
| 宿主半是否加载 | ✅ `/sidecard-ask/api/state` 返回 `dsh-sidecard-ask v1.2.0`，`sideEngine=true`（provider `spawn,fork`）、`capabilities.parent` 正常 |
| 客户端半是否注册 | ✅ `shell.overlay` 有 `sidecard-ask`（order 45、active）、`conversation.input.right` 有 `sidecard-ask-session-probe`、`settings.section` 有设置页 |
| 依赖的槽位与标准 prop | ✅ `conversation.input.right` 仍是 list/session，`standardProps` 仍含 **`sessionId`** 与 **`inputActions`** |
| 依赖的客户端服务 | ✅ `sessions`（`retain`/`using`/`scope`）、`slots`、`locale`、`layout`、`theme` 全在；`sessions.fork`/`uiWorkspace.forkSession` 只是**新增**了可选 `onCreated`，不影响既有调用 |
| 端到端作答 | ✅ 真机 `start→delta×31→status→done`（1.36 s，`streamSource=frames`），只读工具白名单照常生效 |

**③ 由此发现并修掉的真实缺陷（1.2.1）**：运行中的 `sidebar.right.pane.tab` 清单里只有
`dsh-better-sidebar:sidecard-ask:card`，**没有我的原生 `sidecard-ask:card`**。原因是两个适配器用了**同一个 tab kind**：
better-sidebar 会把收到的每个 tab 描述符**镜像注册进同一个原生注册表**（`sidebarRightTabs.register`，band `extension`），
而该注册表对*同 band 同 kind 的二次注册直接抛错*（源码注释：*"Everything else colliding on a kind throws"*）——
后注册的那一方就此失败，而且**在界面上不可见**。修法：

1. better-sidebar 承载面改用独立类型 **`sidecard-ask:card:workbench`**，两端 kind 不再重叠；
2. `contract-test` **模拟该注册表的"重复 kind 抛错"规则**，此类冲突今后会直接让测试失败；
3. 设置页自检行改为**同时报告两个适配器**的状态（此前原生适配器的错误压根看不到）。

**④ 修复后的运行实例复核（2026-09-29，1.3.0）**：`sidebar.right.pane.tab` 的占用者现在**同时**包含

| key | 来源 |
|---|---|
| `sidecard-ask:card` | 本插件的**原生右侧栏**承载面（1.2.1 之前完全缺失） |
| `dsh-better-sidebar:sidecard-ask:card:workbench` | 经 dsh-better-sidebar 镜像注册的承载面（独立 kind） |

两者共存、均 `active: true` —— 即"同 kind 冲突"已被消除，`auto` 默认走原生右侧栏，强制 `sideSurface: better-sidebar` 仍可用。

### 5.3 与 DSH 桌面版（Electron）的适配核对（2026-09-30）

桌面版与命令行/web 版**不是同一套运行形态**，核对结论如下。

| 维度 | 事实（实测） |
|---|---|
| 桌面 App | `DeepSeek Harness.exe` **0.2.0-rc.2**（`resources\app-update.yml` 更新通道 `nightly`，源 `download.deepseek.com/dsh-desk/feeds/win-x64/`） |
| 运行形态 | Electron-as-Node 跑 `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js`；**框架包全部打包在 `app.asar` 内**（121 MB 归档，普通 shell/glob/grep 读不到，只能靠运行实例的 inspection 查） |
| 自带运行时 | `resources\runtime\versions.json`：node **24.18.1** + pnpm **11.7.0**（装插件用的是它自带的 pnpm） |
| profile | **`DSH_PROFILE=desktop` → `C:\Users\34332\.dsh\profiles\desktop`**，与 web 版的 `profiles\web` **互相独立**：两者各有自己的 `package.json`/`node_modules`/`dsh.profile.bundles`，插件必须分别安装 |
| 本插件安装状态 | 桌面 profile 的 `package.json` 中为 `"dsh-sidecard-ask": "link:D:/Users/34332/AI/dsh-sidecard-ask"`，且已在 `dsh.profile.bundles` 内 → **无需改动即加载** |
| 宿主半 | `GET http://127.0.0.1:19387/sidecard-ask/api/state` → `dsh-sidecard-ask v1.3.1`、`sideEngine=true`（provider `spawn,fork`）、`capabilities.parent` 正常、配置落点 `~/.dsh/sidecard-ask/config.json` |
| 客户端半 | 由本插件自己的自检上报读出：`version=1.3.1`、`slots={overlay: shell.overlay, settings: settings.section, sessionProbe: conversation.input.right}`、`native.available=true`、`better.available=true` 且 `better.version=0.24.1` |
| 端到端 | 真机 `start→reasoning×106→delta×46→status→done`，1.89 s，`done.text` 是真实答案（子代理 + 流式帧 + 只读工具白名单全部正常） |
| 客户端服务目录 | 与 web 版**完全一致**（layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces），无桌面专属差异 |

**桌面版用到的 dsh-better-sidebar 是 0.24.1**（比上轮核对的 0.22.1 新）：0.22.1 → 0.24.1 的
`lib/types/client/service.d.ts` 差异是**纯增量**——`target?: 'right' | 'bottom'` 增加 `'side'`（右侧栏第二窗格），
并新增可选 `preferNewPane?: boolean`；`SIDEBAR_FEATURES` 仍含 `tabMeta`，`dsh.client.inject` 未变。
本插件不传这两个字段 → **不受影响**（默认落点行为未变）。

**桌面版特有的适配修改（1.3.2）：窗口拖拽区。** 桌面外壳会把顶层元素标记为窗口拖拽区
（`-webkit-app-region: drag`），落在拖拽区内的点击会**变成拖动窗口**而不是点中 UI。同生态的
dsh-better-sidebar 为此专门带了一条防御（`html[data-platform] body>[data-dsh-better-sidebar]{-webkit-app-region:initial}`
+ `[data-dsh-panel-host]>*{-webkit-app-region:no-drag}`）。本插件的浮层此前**没有这条防御**，现已在样式表里为
每个自有根节点声明 `-webkit-app-region:no-drag`
（`.dsa-layer/.dsa-trigger/.dsa-pop/.dsa-stack/.dsa-card/.dsa-toast/.dsa-settings`），并加回归测试锁定该规则。
该属性在浏览器里无效，不影响 web 版。

**桌面形态下确认「不需要改」的两点**：

- `styles.insert` / `host.call` 属于**动态运行时**的插件能力（inspection 的 `Builtin` 定义就是
  "Plain-JavaScript symbols available to a **dynamic** Client half"）。本插件是**静态**客户端半
  （`__ModuleLoader__.load` + `require('react')`），官方形态就是手工插入 `<style>`——同为静态形态的
  `uiskin-theme` 在源码里注明 "the static twin of the dynamic runner's `styles.insert`"；宿主通信走自有的
  `/sidecard-ask/api` 路由；
- 名为 `shortcuts` 与 `conversation` 的客户端服务**都不在运行实例的服务目录里**（inspection 明确报
  `no catalogued Service named ...`）。所以"并入宿主快捷键注册表"与"使用 composer 草稿服务"两条路都不存在：
  本插件继续自带 keydown 监听（快捷键可配置）与 `PLACEHOLDER: composer-draft` 降级路径。

**仍未验证的部分（如实记录）**：桌面窗口内的**视觉与点击行为**（本工作区无 GUI 自动化，无法点按验证）；
`Alt+Q` 是否会撞上桌面 App 的菜单加速键（Electron 的菜单加速键由菜单先处理，页面的 keydown 可能收不到；
若冲突，在设置页改成 `Ctrl+Alt+Q` 之类即可）；Electron 下 `navigator.clipboard` 的写入权限（已有"选中文本"降级兜底）。

---

## 六、未知 DSH API：占位接口与替换方式

开发时以**运行时能力探测**为主，任何"本机没验证到"的接口都在代码里显式留了占位与替换点。它们集中在两处：

### 1. `client.js` §7 —— `surfaces.native`（原生右侧栏适配器）

```js
// 现状：结构性子集 + try/catch，任何一步不成立就置 error 并降级
ctx.inject(['sidebarRightTabs', 'sidebarRight'], (injected) => { ... })
```

- **已实测的调用形态**：`registry.register({ id, kind, title, guide: [{ id, order, title, description }] })`、
  `controller.openTab(kind, { params, revealIfOpened })`、槽位 `sidebar.right.pane.tab`（keyed，`inject: sessionId => ({ sessionId })`）。
- **未逐版本实测的部分**（占位）：`guide[].icon`、`canOpen/patterns`、`closeIn/activateIn`。
  替换方式：在 `client.js` 搜索 `PLACEHOLDER: native-rightbar`，按目标 DSH 版本的真实签名补齐；
  补齐前该分支只会记录错误并降级，不会破坏插件。

### 2. `client.js` §6/§3 —— 主对话发送与线协议

- **已实测**：客户端服务 `ctx.sessions` 的 `using(id, { source:'gateway' }, ref => ref.binding.session.prompt(parts, 'queue'))`。
- **占位 1（草稿降级）**：`ctx.get('conversation').input.for(scope)` → `{ state.getSnapshot().draft, setDraft(text) }`。
  这是**未出现在服务目录里**的接口（属 harness 内部形态），所以只作为第二顺位降级；搜索 `PLACEHOLDER: composer-draft`。
- **占位 2（最后兜底）**：前两者都不可用时，插件抛出可读错误并提示用户复制文本，搜索 `PLACEHOLDER: clipboard-fallback`。
- **线协议**：客户端与宿主半之间是插件**自有的** `/sidecard-ask/api`（`GET /state`、`POST /ask|cancel|config|reset|diagnose`），
  不依赖任何 harness 内部 RPC；若未来 harness 提供正式的同进程 RPC，替换点就是 `client.js` §3 的 `postJson/streamAsk`。
- **`POST /diagnose`（客户端自检上报）**：宿主**看不到浏览器里的客户端半**，所以客户端在启动、槽位落点变化、
  承载面回退时把自己的一份受限摘要（版本、承载面、区域锚点、槽位落点、两个适配器的可用性与原因、侧边卡片插件版本与能力）
  POST 给宿主；随后 `GET /state` 的 `value.client` 就能读到它。宿主侧对上报做**白名单 + 长度截断**（未知键丢弃、
  字符串截断到 200 字符、能力列表最多 40 项），所以页面即使被注入垃圾也不会污染状态面。
  这条通道是在两次"客户端静默失效只能靠人工翻槽位清单才发现"之后补上的。

> 约定：所有占位点都写成 `PLACEHOLDER: <名字>` 注释 + 可运行的降级路径，替换时只需改该函数的实现，调用方（卡片、设置页）无需改动。

---

## 七、DSH 版本适配（近 10 余个版本，**证据来自已发布产物**）

不是靠字段笔记，而是把每个版本要用的包从 npm 拉下来、解包、按标记字符串判定：

```powershell
node tools/compat-probe.mjs                        # 13 个版本 × 12 个包
node tools/compat-probe.mjs --json tools/.cache/matrix.json
```

脚本会 `npm pack` 相应包到 `tools/.cache/tarballs/`（已在 .gitignore），用内置 tar 读取器在内存里搜索，
然后打印下面的能力矩阵。**矩阵里的 ❌ 就是插件必须降级的点**，而插件对每一个 ❌ 都有对应分支。

### 7.1 能力矩阵（0.1.2-rc.1 → 0.1.7-rc.2）

| 能力（依赖的 API） | 0.1.2-rc.1 | 0.1.3-alpha.2 | 0.1.5-alpha.1 … 0.1.5-rc.3 | 0.1.6-alpha.1 | 0.1.6-alpha.2 | 0.1.7-alpha.1 … 0.1.7-rc.2 |
|---|---|---|---|---|---|---|
| 客户端产物协议 `window.__ModuleLoader__.load` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `shell.overlay`（浮层/触发按钮挂载点） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `conversation.input.right`（会话 id 采集） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `settings.section`（设置页） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `data-slot` 出口锚点（区域归类） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 原生右侧栏 `sidebarRightTabs` + `sidebar.right.pane.tab` | **❌** | **❌** | ✅ | ✅ | ✅ | ✅ |
| 主对话提交 `sessions.using(target, options, operation)` | **❌** | **❌** | **❌** | **❌** | ✅ | ✅ |
| 主对话提交 `sessions.retain(target, options)` | **❌** | **❌** | **❌** | **❌** | ✅ | ✅ |
| 归档会话门（拒绝归档血统的每一步） | **❌** | **❌** | **❌** | **❌** | **❌** | ✅ |
| 进程内流式帧 `agent/assistant-stream` | **❌** | ✅ | ✅ | ✅ | ✅ | ✅ |
| 持久化分块 `assistant/chunk`（会话事件） | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| 子代理 `subagents.start` + `SubagentRun.localAgent` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| provider 能力面（`toolFilter` / `persona`） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tools.schemas()` + `tools.restrict()` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 宿主路由 `webServer.register({kind:'prefix'})` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 7.2 每个 ❌ 对应的适配（都在代码里）

| 缺口 | 适配实现 | 在真机/测试里的表现 |
|---|---|---|
| 0.1.2 / 0.1.3 没有原生右侧栏 | 承载面探测链：原生右侧栏 → `dsh-better-sidebar` → **内置浮层卡片**；不可用的一律不计入 `pickSurface` | `contract-test` 断言 `pickSurface('auto')` 在无插件组合下落到 `flow`；`auto` 在可用时优先原生 |
| ≤0.1.6-alpha.1 没有 `using`/`retain` | 主对话提交**四级阶梯**（调用时逐级探测，不查版本表）：`sessions.using` → `sessions.retain`+`release` → 槽位标准 prop `inputActions`（`setDraft` + `submit`）→ 仅写入输入框并明确提示"请按 Enter" | `contract-test` 逐级断言 `via`：`sessions.using` / `sessions.retain`（并断言 `release()` 被调用）/ `inputActions.submit` / `composer.draft` / 全无时抛 `no-main-carrier` |
| ≤0.1.6-alpha.2 没有归档门 | 不再因"父会话已归档"直接拒绝：仍优先挑未归档代理，但只有归档候选时**照常尝试**，并在 `start` 事件里带 `parentArchived:true`；真被门拒绝时把空 turn 的 `refusal` 翻译成 `blocked-step` 并说明原因 | `smoke-test`：全归档组合仍能拿到答案；`refusal` 用例断言 `code=blocked-step` 且文案提到归档 |
| 0.1.2-rc.1 没有进程内帧 | 增加**第二条流式源**：订阅 `session/event` 的持久化 `assistant/chunk`（`{turn,step,chunk}`，形状取自该版本自己的 `chunk-rows.js`），与帧源**互斥**（先说话的那个生效，绝不重复计一次文本） | `smoke-test`：`frameMode:'chunks'` 用例断言 delta 拼出完整答案、`streaming:true`、`streamSource:'chunks'`；同时断言两源并存时文本不重复 |
| provider 能力面差异 | 只发 provider **声明支持**的启动字段（`capabilities.persona/toolFilter`）；`persona` 不支持时**内联进提示词**；`toolFilter` 不支持时在 `start` 事件里报 `toolFilter:'unsupported'`，卡片明说"本 provider 不支持工具白名单" | `smoke-test`：`capabilities:null` 与 `{toolFilter:false,persona:true}` 两种 provider 的字段断言 |
| 槽位键在老版本可能不同 | 每个注册走**槽位阶梯**（都是 `list` 槽，绝不碰 `single` 槽以免替换宿主 UI）：浮层 `shell.overlay → conversation.input.dock → conversation.composer.dock`；设置页 `settings.section → settings.plugins.tab`；会话采集 `conversation.input.right → conversation.input.left → composer.dock → input.dock`。**先到者胜**，更好的槽位后到会顶掉兜底 | `contract-test`：`absentSlots` 模拟未声明的槽位，断言注册落到下一级且诊断里记录了落点 |
| 没有 `data-slot` 锚点 | 检测到选区但槽位路径为空 → 判定"区域锚点不可用"，**停用区域过滤**（否则 `captureZones:chat` 会静默失效）并在设置页自检里标明 | `contract-test`：`shouldOffer(..., {anchors:false})` 断言放宽且返回 `zoneFiltering:'unavailable'` |
| 路由 kind 不被接受 | `prefix` 注册失败 → 退化为**逐方法精确路由**（`state/ask/cancel/config/reset`），处理器不变 | 前缀路由由 smoke 全流程覆盖；退化分支为纯 fallback（未在真机触发过） |

### 7.3 还没做真机验证的部分（如实标注）

- 上表所有 ✅/❌ 都是**包内容层面的证据**（字符串/签名存在于该版本的发布产物），不等于"插件在该版本上跑起来过"。
  唯一跑过真机的是 **0.1.7-rc.2**（见 §10.1 的实测记录）。
- 在 0.1.2-rc.1 … 0.1.6-alpha.2 这几个版本上，我只验证了"所需 API 是否存在 + 插件有为缺失准备的分支"，
  **没有**在那些版本上安装并启动过插件。
- `inputActions` 作为会话槽位标准 prop：13 个版本的 `dsh-client-ui-conversation` 产物里都有该名字，
  0.1.7-rc.2 的槽位目录也把它列为 `conversation.input.right` 的 standardProps；**更早版本是否真的把它下发给该槽位条目未验证**，
  插件对此是探测式使用（取不到就走草稿降级）。

---

## 八、边界处理清单（对应需求第六点）

| 边界 | 处理 | 代码位置 |
|---|---|---|
| **空选 / 过短** | 选区为空、折叠、或短于 `minChars` → 不浮出按钮并清掉上一次的触发态 | `readSelection` / `shouldOffer`（client §5） |
| **编辑框内选择** | 选区锚点/焦点落在 `input`/`textarea`/`contenteditable` 内 → 视为编辑操作，不触发 | `isEditable`（client §5） |
| **跨区选择** | 锚点与焦点区域不同 → 标为"跨区选择"，按**锚点**区域归类并在徽标上显示；仍可追问 | `readSelection` 的 `cross`、`zoneLabel` |
| **超长文本** | 头 70% + 尾 30% 保留，中间插入「已省略中间 N 个字符」；提问框与卡片都显示截断徽标；宿主侧再做一次硬上限（60000 字符提示词上限） | `truncateSelection`（两端一致，契约测试断言等价） |
| **接口失败** | 逐层降级：子代理不可用 → 卡片错误 + 「改到主对话」；主对话发送不可用 → 草稿写入；再不可用 → 明确报错不静默 | `toWireError` / `askInMainConversation` |
| **重复触发** | 同一选区 + 近似位置在 400ms 内只触发一次；同一卡片 id 的重复请求返回 `duplicate`；并发超限返回 `busy`（可重试） | `selectionSignature`、`runs.has(id)`、`maxConcurrentAsks` |
| **流式中断** | 浏览器断开 / 点「停止作答」/ 超时 → `AbortController` 取消子代理：有部分文本时以 `done{aborted:true}` 收尾并保留已流出的内容（卡片显示「已停止」），一个字都没流出时才用 `error.code='aborted'` | `handleAsk` 的 `res.on('close')` 判定、`sideTimeoutMs` |
| **父会话已归档** | 归档门会拒绝**整条子代理血统**里的每一步（表现为「没有发起任何模型请求的空 turn」），但它只存在于 0.1.7-alpha.1+。插件优先挑未归档代理；只剩归档候选时**照常尝试**并在 `start` 事件里带 `parentArchived:true`（旧版本本来就能正常作答，一刀切拒绝会误伤 0.1.2–0.1.6） | `resolveParent` / `archivedSessionIds`（host） |
| **步骤被宿主拒绝** | 子代理接缝把这种空 turn 记为 `refusal`；插件翻译成 `blocked-step`，文案点明常见原因（会话已归档）并给出「改到主对话」 | `ask()` 的终局映射（host） |
| **卸载** | 插件卸载时取消全部进行中的作答、注销槽位、移除 DOM 监听、断开流式桥 | `ctx.effect` + `disposers` |
| **跨站请求** | 插件路由带信任围栏：Host 必须是回环或配置的可信域，`sec-fetch-site: cross-site` 或跨域 `Origin` 一律 403 | `isTrustedRequest`（host） |

### 错误码对照（`error` 事件的 `code`）

| code | 含义 | 是否可重试 | 建议动作 |
|---|---|---|---|
| `bad-request` | 问题或选中文本为空 | 否 | 重新选中/输入 |
| `busy` | 并发追问达上限 | 是 | 稍后重试 |
| `duplicate` | 同一卡片 id 已有在跑的任务 | 否 | 等它结束 |
| `no-side-engine` | 没有可用的子代理 provider | 否 | 「改到主对话」 |
| `no-parent` | 没有活动会话代理 | 否 | 「改到主对话」 |
| `blocked-step` | 这一步被宿主的 `agent/pre-step` 拒绝（未发起请求）；0.1.7+ 上最常见的原因是会话已归档 | 是 | 换会话或「改到主对话」 |
| `aborted` | 被取消或超时，且没有已流出的内容 | 是 | 重试 |
| `engine-error` / 其它 | 子代理启动、模型调用或传输失败 | 是 | 重试或改到主对话 |

---

## 九、三条关键路径的自测要点

### A. 路径一：就地追问 → 侧边卡片流式作答

1. 在聊天区选中一句**非输入框内**的文本（例如助手消息里的半句话）；
2. 选区末端应浮出「💬 追问选中内容」按钮，按钮带区域徽标（聊天区 / 任务区 / 跨区选择）；
3. 点击后按钮消失、提问框出现，焦点在输入框，引文预览显示选中文本；
4. 输入问题按 Enter → 提问框关闭，右下角出现卡片，状态先为「作答中…」并**逐字增长**；
5. 结束后状态变「已完成」；底部出现「复制 / 继续追问 / 关闭」；
6. 点「复制」→ 出现「已复制」提示；点「继续追问」→ 输入第二条问题，卡片内容**重置换行**后继续流式；
7. 点「关闭」→ 卡片消失；若承载面是 better-sidebar/原生右侧栏，对应 tab 也应关闭。
8. **浮层形态与位置（1.5.0）**：默认应是一个**一行高的胶囊**（状态 + 问题首句），点它才展开成完整卡片；
   展开后标题栏右侧有「收起为胶囊」（⇥）与「隐藏浮层」（×）——隐藏后只剩一个带计数的圆点，点它恢复。
   用 F12 选中浮层根节点（`[data-dsa-root]`）读两个值自检：
   - `data-dsa-float-mode` 应为 `capsule` / `full` / `off`；
   - `data-layer-width` 应等于 `min(floatMaxWidth, 对话区右边界到帧右边缘的可用带宽)`。
   **关键判据：胶囊/卡片的左边缘不得越过对话区（`[data-slot^="conversation"]`）的右边界**。
   把窗口从 1920px 拖到 900px、再开关一次右侧栏，浮层应随之变窄而不是往左压住正文；
   只有窗口窄到可用带宽不足 240px 时才允许压入（此时是设计内的降级，不是 bug）。

**失败信号**：卡片停在「作答中…」不动 = SSE 帧没到达（看 console 是否有 `/sidecard-ask/api/ask` 报错）；`done.streaming=false` = 该版本没有流式帧（属预期降级，卡片会写明）。

### B. 路径二：主对话承载

1. 选中文本 → 提问框里把「作答位置」切到**主对话** → 输入问题 → Enter；
2. 主对话应立刻出现一条用户消息，形如：

   ```
   > 选中的原文（逐行引用）
   > …（已截断时会有「已省略约 N 字」）

   【来源：聊天区】
   你的问题
   ```

3. 该消息的答案由**当前会话**正常流式输出（这就是"主对话承载"的定义）；
4. 卡片侧显示「已发送到主对话」并说明答案在主对话中；若接口不可用而降级为草稿写入，卡片会明确显示「已填入输入框」，此时需手动按 Enter 发送（**不算失败**，但要能看到这条提示）。

### C. 路径三：快捷键 + 引擎不可用的降级

1. 选中文本 → 按 `Alt+Q` → 提问框直接出现（无需点按钮）；
2. 在设置页把「触发方式」改成「仅快捷键」→ 再选中文本时**不应**出现按钮，但 `Alt+Q` 仍可用；
3. 把「侧边卡片承载面」强制设为 `native-rightbar` 或 `better-sidebar`（未安装/未启用时）→ 追问应回退到内置浮层卡片，并提示"已回退"；
4. 用一个没有子代理的 DSH 组合（或临时把 `sideProvider` 设成一个不存在的名字）→ 侧边作答应返回错误卡片：
   文案说明"没有可用的子代理"，并给出「改到主对话」按钮；点它应把同一问题转到主对话（不得丢失已选中的文本与问题）。

---

## 十、自测脚本

```powershell
cd D:\Users\34332\AI\dsh-sidecard-ask
node test/verify.mjs            # 静态：清单/补丁/导出面/i18n/零依赖
node test/contract-test.mjs     # 契约：常量、信封、SSE 逐帧、纯函数、槽位注册与渲染
node test/float-placement.mjs   # 几何：浮层宽度不越过对话区右边界（1.5.0 新增）
node test/smoke-test.mjs        # 端到端：流式/截断/取消/持久化/失败分支/并发/围栏
```

四个脚本都以 `process.exitCode` 反映结果，失败会列出具体条目；测试会把 `DSH_HOME` 指向临时目录，不会污染真实配置。
当前规模（1.5.0 本机实测，四项均 exit 0）：verify **53** 项 + contract **296** 项 + float-placement **38** 项 +
smoke **138** 项 = **525 项全部通过**。

> 1.5.0 之前这里还放过 `tools/balance-check.mjs` 与 `tools/i18n-check.mjs` 两个「替代检查」。
> 它们已被**删除**：前者用「正则字面量 vs 除号」的启发式判断，把 8 个源文件全部误报为残损；
> 后者定位词典块的缩进假设写错，解析出 0 个键并误报上百条缺失。**跑不了测试时宁可标注「未验证」，
> 也不要引入会撒谎的检查器**——真实把关始终只有上面那四个 `test/*.mjs`。

### 10.2 版本能力探测（§7 矩阵的来源）

```powershell
node tools/compat-probe.mjs                       # 13 个版本 × 12 个包，逐个 npm pack 后按标记判定
node tools/compat-probe.mjs --json tools/.cache/matrix.json
node tools/compat-probe.mjs 0.1.7-rc.2            # 也可只探某个版本
```

首次运行会下载约 250 个包到 `tools/.cache/tarballs/`（已 gitignore，之后走缓存）；输出的矩阵就是 README §7 的表。

### 10.1 对已安装实例做真实联调（本机实测通过）

```powershell
# 1) 宿主接口与能力（archived 父会话检测也在这里）
(Invoke-WebRequest http://127.0.0.1:8080/sidecard-ask/api/state -UseBasicParsing).Content

# 2) 端到端流式作答：把 sessionId 换成当前会话 id（$env:DSH_SESSION_ID）
#    期望事件序列：start → reasoning*/delta* → status → done（done.text 是真实答案）
$body = @{ id='probe'; question='用一句话说明这句话在说什么。';
           selection='槽位出口会带上 data-slot 标记。'; zone='chat';
           sessionId=$env:DSH_SESSION_ID } | ConvertTo-Json -Compress
$tmp = Join-Path $env:TEMP 'probe.json'
[System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
(Invoke-WebRequest http://127.0.0.1:8080/sidecard-ask/api/ask -Method POST `
   -ContentType 'application/json; charset=utf-8' -InFile $tmp -TimeoutSec 240 -UseBasicParsing).Content

# 3) 客户端半的真实状态（浏览器跑的那份代码/槽位落点/两个适配器）
#    页面加载后 GET /state，看 value.client —— 这是唯一能从页面外读到客户端状态的通道
((Invoke-WebRequest http://127.0.0.1:8080/sidecard-ask/api/state -UseBasicParsing).Content | ConvertFrom-Json).value.client
```

**客户端状态样例**（1.3.0 起）：

```json
{
  "at": 1790555771338,
  "version": "1.3.0",
  "surface": "native-rightbar",
  "zoneAnchors": true,
  "sessionKnown": true,
  "slots": { "overlay": "shell.overlay", "settings": "settings.section", "sessionProbe": "conversation.input.right" },
  "native": { "available": true },
  "better": { "available": true, "version": "0.22.1", "features": ["badge", "…", "tabMeta"] }
}
```

`native.reason` / `better.reason` 会写明**为什么**某个承载面不可用（例如 `no-tab-meta` 或注册表的报错原文）——
1.2.1 修掉的那个 tab kind 冲突正是靠这类信息才定位到的。

> **两半代际不一致是常态**：宿主半只在重启 DSH 时更新，客户端半在页面加载时更新。
> 所以"新客户端 + 旧宿主"很常见——此时 `/diagnose` 还不存在，客户端会**识别这一点、只提示一次并停止重试**
> （`not-found` / SPA 兜底 HTML / 不可达三类失败），不会每次加载都刷警告。

**2026-09-28 在 DSH 0.1.7-rc.2 上的实测结果**（`provider=spawn`、`sideTools=readonly`）：
`start x1 → reasoning x181 → delta x90 → status x1 → done x1`，耗时 2.6 s，`done.text` 为真实模型答案。
这条记录同时说明：子代理启动、只读工具白名单（与真实工具表求交后）、流式帧桥接、SSE 线协议、运行结束后的 `dispose()` 都是**在真实宿主上跑通的**，
不只是单元测试里的替身。

> 改过 `index.js` 之后**必须重启 DSH** 才会加载新的宿主半代码：插件行在 profile 启动时已被 Loader 导入，重新启停该行不会重新读盘
> （本机实测：`set_plugin` 关开、`remove_bundle` + `install_bundle` 都不会刷新已加载的模块；只有进程重启会）。
> `client.js` 的改动则需要刷新页面（客户端产物带修订号，刷新即重新拉取）。


---

## 十一、架构与数据流

```
选中文本 (client §5)
   │  page → data-slot 链 → 区域归类 → 触发按钮
   ▼
提问框 (client §9)  ── 作答位置选择 ──┐
   │                                  │
   │ side                             │ main
   ▼                                  ▼
POST /sidecard-ask/api/ask      ctx.sessions.using(id).binding.session.prompt(...)
   │  (SSE)                          │  ↓ 草稿降级 / 复制兜底
   ▼                                 答案随主对话原生流式
Host: ctx.subagents.start('spawn')
   → 子代理（自己的会话、零父上下文）
   → agent/assistant-stream 帧 → sink.send('delta')
   → run.result 结算 → sink.send('done') → run.dispose()
   ▼
卡片流式渲染 / 复制 / 继续追问 / 关闭
```

**为什么侧边卡片用子代理而不是"另开一个会话"**：子代理由进程内 spawn provider 建立，拥有自己的会话与系统提示、**不继承父上下文**，
且随 `dispose()` 释放——这正是"独立附属"的语义；同时它不需要往工作区/侧边栏注册新会话，用户不会在会话列表里看到一堆临时条目。

---

## 十二、隐私与安全

- 选中文本与问题会**发给你自己配置的模型**（走 DSH 既有的模型路由），插件不做任何额外外发。
- 插件只在本地写一个配置文件：`<DSH_HOME>/sidecard-ask/config.json`（原子写入：先写 `.tmp` 再 rename）。
- 插件路由带信任围栏（回环 / 可信域 + 同源校验），仅本机页面可用。
- 侧边作答者默认**只读**（`sideTools: readonly`）：白名单只包含读取、搜索、网络查询类工具，不会在后台改你的工作区。
- 提示词里选中文本被包在 ```` ```text ```` 围栏中并显式声明"这是数据不是指令"，降低提示注入面。

---

## 十三、发布流程

```powershell
npm whoami                     # 先确认登录态；本机用的是 granular Publish token
node test/verify.mjs; node test/contract-test.mjs; node test/float-placement.mjs; node test/smoke-test.mjs
npm publish --access public    # 1.0.1 那次被 npm 暂存（staged）后才转正；再遇到可用 --otp=<验证码>
git push origin main           # 仓库：https://github.com/HERO476/dsh-sidecard-ask
git tag v1.5.0; git push origin v1.5.0   # 版本号与 package.json 一致
```

改名/迁移时的额外两步（1.1.0 实际做过）：

```powershell
plugin_manager(action="remove_bundle", target="<旧包名>")      # 卸旧 bundle（同时移除 profile 里的 link）
plugin_manager(action="install_bundle", target="D:\...\<新目录>")
npm deprecate "<旧包名>@*" "Renamed to <新包名> - <原因>"       # 旧名指路，避免别人再装到废弃名
```

版本号同时出现在三处，必须一致：`package.json` 的 `version`、`index.js` 的 `PLUGIN_VERSION`、`client.js` 的 `api.version`
（`test/verify.mjs` 会断言前两处；第三处在契约测试中同样被断言）。

**发布前必查"地址类信息"**（1.0.0 的教训）：包名不能只查 npm —— 还要查 GitHub 仓库名是否已被占用，以及
[`awesome-dsh-plugin` 收录索引](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/tree/main/data/plugins)
里是否已有同名插件（本插件第一次改名就是因为漏查了后者）。

---

## 十四、已知限制（含未在本机验证的部分）

1. **区域归类是启发式的**：`data-slot` 名称来自 harness 自己；其它插件若在自己的面板里不再经由槽位渲染，
   该区域会被归为"其它区域"——用 `captureZones: auto` + `showInUnclassified: true`（默认）仍然可用，或改用 `captureZones` 限制。
   本机实测能识别：`conversation.*`（聊天）、`rightbar` / `sidebar.right.*` / 名字含 task·todo·schedule·team·job·plan 的面板（任务）。
2. **浏览器内的视觉与交互未在本机验证**：本工作区没有浏览器自动化工具，因此"按钮出现在选区旁""卡片逐字增长""浮层不挡操作"这些**只能由你按第九节点一遍**。
   已做的保障是：只使用 `--dsw-alias-*` 主题令牌、只在槽位内渲染（`shell.overlay` / `settings.section` / `conversation.input.right`）、不写 `document.body`、不 import harness 客户端包。
2b. **1.5.0 的浮层改动：四个测试脚本已在本机实跑通过（各 exit 0），但页面里的观感仍未验证**：
   写这个版本的前半段，本工作区的 shell 工具整体不可用（任何命令都返回
   `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<工作区>)`），所以当时的改动**没有跑过任何命令**，
   我也没有资格说它"验证过"。后半段该故障解除后已补跑：`node --check` 对全部源文件通过，
   `verify` 53 / `contract` 296 / `float-placement` 38 / `smoke` 138 **全部 0 failed**。
   其中 float-placement 第一轮曾报 7 条红，逐条查完**全部是我把测试写错**（旧实现的越界 fixture 算错、
   `avail` 期望值用了带右栏的用例、`capped` 语义写反、以及去找一个源码里并不存在的
   `setFloatMode('capsule')` 调用点——真实实现走 `floatControl('capsule','floatCollapse','⇥')` 的
   `onFloatMode` 回调），实现本身没有因此改动。
   仍未验证的是**浏览器内的视觉观感**：浮层实际宽度是否等于预算、是否真的不越过对话区右边界，
   必须按第九节 **A 路径第 8 条**在真实页面上确认（读 `data-dsa-float-mode` 与 `data-layer-width`），测试替代不了。
   此外，本版一度新增过 `tools/balance-check.mjs` 与 `tools/i18n-check.mjs` 两个"替代检查"，
   **现已删除**：它们本身有错（前者把 8 个源文件全误报为残损，后者解析出 0 个词典键并误报上百条缺失），
   属于会撒谎的检查器——跑不了测试时应当标注"未验证"，而不是用一个错的检查器去证明没问题。
3. **原生右侧栏承载面未在真实宿主上验证**：本机 profile 虽已启用 `@deepseek-ai/dsh-client-ui-sidebar-right`，但没有浏览器控件去确认 tab 是否真的渲染。
   为此加了一道**渲染证明**：适配器接受了打开请求后 600ms 内若没有观察到我们的卡片组件挂载，就自动把卡片移到内置浮层（流式内容不丢，因为卡片数据在 store 里）。
4. **主对话承载的"发送"依赖客户端会话服务**：`ctx.sessions.using(...).prompt(...)` 在会话未被保留/不可用时降级为草稿写入，
   降级时会在卡片上明确显示，需要手动按 Enter。
5. **宿主半代码更新必须重启 DSH**：本机实测 `set_plugin` 关开与 `remove_bundle` + `install_bundle` 都不会让已加载的模块重新读盘。
   本仓库当前文件比运行中的宿主模块新（1.0.1 的「归档父会话不再一刀切 / 持久化 chunk 流式源 / 能力门控 / 路由降级」），
   **重启后**这些改动才生效；`/state` 的 `version` 与 `capabilities.parent` 字段可以直接确认是否已加载新版。
6. **除 0.1.7-rc.2 外，其余版本只做了产物层验证**：见 §7.3——插件在 0.1.2-rc.1 … 0.1.6-alpha.2 上安装启动过**没有**得到验证，
   验证到的是"这些版本缺哪些 API + 插件对每个缺失都有分支"，分支本身由 289 项自测覆盖。

