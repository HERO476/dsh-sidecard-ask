# dsh-sidecard-ask 2.1.1 × DSH 0.2.1-rc.3 双端适配性审计

- 审计日期：2026-10-24
- 被审对象：`dsh-sidecard-ask@2.1.1`（`index.js` 2749 行 / `client.js` 7378 行）
- 目标运行时：**DSH 桌面端**（Electron 壳，`FileVersion 0.2.1-rc.3`）与 **DSH 网页端**（同一运行时提供的 Web GUI）
- 证据基线：桌面端 `app.asar` 解包出的 307 个 `@deepseek-ai/*` 包，全部为 `0.2.1-rc.3`；前端 bundle `dsh-web-frontend/dist/assets/index-BXV-oxvX.js`
- 方法：① 逐项静态契约核对（宿主服务、Client 模块协议、槽位目录、原生右栏 API）；② **实机 HTTP 探针**（插件路由与客户端 bundle 真实可达）；③ 官方能力探针 `tools/compat-probe.mjs` 跨 rc.2/rc.3 对比；④ 仓库回归 `npm test`
- 判定口径：**只承认能在 `0.2.1-rc.3` 源码或实机响应中找到出处的结论**；无法取证的一律列入 §7「未能验证」，不当作通过。

> 说明：本次审计期间（18:55）桌面端被重启，端口由 `14582` 变为 `1151`，**版本未变**（仍 `0.2.1-rc.3`，pid 30040）。两端探针在新端口上复测结果一致。

---

## 0. 结论摘要

**总体判定：双端均可加载、可注册、核心功能可用；存在 1 处「单承载面失效」与 4 处降级，无任何加载失败/白屏风险。**

| 维度 | 桌面端 | 网页端 | 判定 |
|---|---|---|---|
| Host 半加载与路由注册 | ✅ 实机 `/sidecard-ask/api/ping` 200 | ✅ 同 | 通过 |
| Client 半组装与投递 | ✅ `/plugins/??dsh-sidecard-ask/client.js&rev=…` 200（369 873 B） | ✅ 同 | 通过 |
| 浮层承载面（`shell.overlay`） | ✅ | ✅ | 通过 |
| 输入区承载面（`conversation.input.right`） | ✅ | ✅ | 通过 |
| 设置页（`settings.section` / `settings.plugins.tab`） | ✅ | ✅ | 通过 |
| 流式作答（`agent/assistant-stream` + SSE） | ✅（`stopReason` 见 P1） | ✅ | 通过 |
| 默认承载「better-sidebar 页签」 | ✅ 服务由 `dsh-better-sidebar@0.28.0` 提供 | ✅ 同 | 通过 |
| 原生右侧栏承载（`sidebar.right.pane.tab`） | ❌ **D0** | ❌ **D0** | **失效** |
| 只读工具围栏（`sideTools:'readonly'`） | ⚠️ **D1** 不生效但已披露 | ⚠️ 同 | 降级 |
| 界面语言跟随 | ⚠️ **D3** 不跟随 | ⚠️ 同 | 降级 |

两端**无实质差异**：桌面端与网页端跑的是同一套 DSH 运行时、同一份前端 bundle，插件在两侧以同一条 junction 安装（`C:\Users\34332\.dsh\profiles\{desktop,web}\node_modules\dsh-sidecard-ask` → 仓库目录）。差异仅存在于外壳层（Electron 窗口/浮动面板、`dsh web` 的鉴权门），不影响插件契约。

---

## 1. 实机证据（最硬的一手事实）

| 探针 | 结果 |
|---|---|
| `GET /sidecard-ask/api/ping`（免鉴权） | `200 {"ok":true,"value":{"version":"2.1.1","at":1792839701309}}` |
| `GET /plugins/??dsh-sidecard-ask/client.js&rev=6a3a0a15fb1b` | `200`，`369 873 B`（服务端实际测算 `369 800 B` 源文件 + 少量包装） |
| `GET /sidecard-ask/api/state` | `401`，插件自有 JSON（「需要先通过 DSH 登录」） |
| `GET /api/state`（宿主自带） | `401 unauthorized`（对照：宿主门禁正常） |
| 仓库回归 `npm test` | `1831 passed / 0 failed`（verify 57 + contract 1420 + float 83 + smoke 271） |
| 官方探针 `compat-probe` rc.2 vs rc.3 | 能力矩阵**完全一致**；`durableChunks` / `liveChild` 两版均 ❌（插件设计上不依赖，改用 `assistant-stream` 帧） |

`rev` 的算法在 rc.3 有变体风险，本次按 `dsh-client-modules/lib/index.js:184-196` 复算确认：`sha1(framedHash('plugin-artifact',[mtimeMs,ctimeMs,size]))` 取前 12 hex ⇒ 实测 `6a3a0a15fb1b`，与请求一致，证明**客户端半确实被 0.2.1-rc.3 的 ClientModuleRegistry 组装并可投递**。

---

## 2. 安装形态与清单解析

- 两个 profile 的 `cordis.yml` 均为 `"[]"`，插件由 `package.json` 的 `dsh.profile.bundles` + **`cordis.patch.yml`（patch 级 `- insert:`，`cordis.patch.yml:11-38`）** 组合进树。
- rc.3 仍接受该形态：patch 级 insert（`dsh-app-boot/lib/index.js:73-92`）、`dsh.bundle.patch` 字符串（`:518`）、`plugin-manager:312` 读取 `dsh.bundle.patch`。
- `dsh.manifestVersion: 1` 在 rc.3 **无任何校验代码**（全树 0 命中）⇒ 惰性字段，无害（见 P5）。
- `package.json` 的 `engines` 只有 `node >= 20`，**未声明 DSH 版本范围**；rc.3 的安装门禁在 `dsh-app-boot/lib/index.js:279-320`，插件无 `engines.dsh` ⇒ 零安装期拦截（见 P3）。
- Client manifest：`{platform:'web', immediately:true, inject:[locale, ui-slots, ui-conversation]}`，三项仍被 Host 与前端消费。

---

## 3. 逐面判定

### A. Client 模块协议 —— ✅ 通过

`window.__ModuleLoader__.load({id, factory(require)})` 形状未变（`client.js:27-32`），插件只 `require('react')`，`react` 仍是平台种子词；rc.3 官方模板 `dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js` 形状完全相同，且同样声明 `inject:['slots']`。

`dsh.client.inject` 里的 `@deepseek-ai/dsh-client-ui-slots` 在 rc.3 **已不是独立包**（node_modules 无此目录），但仍是前端 `staticModules` 的键（bundle 内 `jI`），而不在图行中的 inject 名会被 `dsh-client-modules/lib/client.js:946` 静默跳过 ⇒ **合法且无害**（与官方模板一致，保留）。

### B. slots 服务与槽位目录 —— ✅ 通过

- 服务名仍 `slots`；`inject(key, cb)` 语义为「**等到声明**（`declarationEpoch`）而非等挂载」（`dsh-client-ui-renderer/lib/client.js:1367-1425`）⇒ 插件 `firstLiveSlot` 阶梯（`client.js:6791-6845`）成立；三个阶梯每一级的 key 在 rc.3 均有真实声明，故**全部落在第一级**，1500ms 兜底不会误报。
- 官方槽位目录 `CLIENT_SLOT_API` 共 **103 槽**（解析自 `dsh-cordis-client-runner/lib/client.js`），插件使用的 9 个 key 全部仍在、无改名、无前缀化；
- 注册必填项无新增（`list`→`id`、`keyed`→`key`、`chain`→`select`），插件三条路径全部满足；`locale` 未注册不抛错（`dsh-client-locale/lib/client.js:1414-1427` 回退 `common`→key）。

逐槽契约（含插件注册项是否合规）：

| 槽位 | 形态 | 标准 props | 插件注册 | 判定 |
|---|---|---|---|---|
| `shell.overlay` | list / root | 无 `sessionId` | `id:'sidecard-ask'`（OverlayRoot 只依赖 store） | ✅ |
| `conversation.input.right` | list / session | **含 `inputActions` + `sessionId`** | `id:'sidecard-ask-session-probe'` | ✅ |
| `conversation.composer.dock` | list / session | 含 `inputActions` + `sessionId` | 备用阶梯 | ✅ |
| `settings.section` | list / root | — | `id:'sidecard-ask-settings'`，不与 `agent-presets/account/general/models/plugins` 撞名 | ✅ |
| `settings.plugins.tab` | list / root | — | 占用者仅 `all` | ✅ |
| `sidebar.right.pane.tab` | **keyed / session** | 含 `sessionId`，**不含 `tab`** | 注册项 `inject` 非该槽契约字段 | ❌ 见 D0 |

插件三个 `id` 均自带 `sidecard-ask` 前缀，无覆盖内置参与者风险。

### C. 原生右侧栏 API —— ❌ 单承载面失效（D0）

rc.3 仍以原名提供两个服务：`sidebarRightTabs`（`dsh-client-ui-sidebar-right/lib/client.js:4965`）与 `sidebarRight`（`:4966`），`register(definition)` 形状（`:4580`）与插件的注册对象一致，`openTab(kind, options)`（`:2243`）存在。

**但 body 取不到自己卡片的 `cardId`**，链路如下：

1. 插件注册 body 时写 `inject: sessionId => ({ sessionId })`（`client.js:6987`）——该槽是 **keyed/session**，`registerOptions` 只接受 `key`；且 rc.3 的 `TabSlot` 调 `renderSlot(seat, {}, {entryKey, fallback, hookContext})`（`:1378-1408`），**第二个参数恒为空对象，`tab` 也不进 `hookContext`**（`TabHookContext` 只有 `tabId/shortcuts/title/fullscreen/active/signal/actions/useStore/useTabNavigation`）。
2. 因此插件组件拿到的 `props.tab` 为 `undefined`，而 `CardHost` 正是读 `props?.tab?.meta?.cardId`（`client.js:7083`）。
3. 即便能拿到 `tab`，rc.3 的 tab 记录 schema 也只有 `{id, kind, contentId, title}`（`sidebar-right/lib/client.js:787-794`），**全树 `tab.meta` 0 命中**；`openTab` 传的 `options.params` 会被 `placeTab`（`:2298`）→ `place`（`:2311`）送进 Tab 域的导航记录，正确读法是 `tab.navigation.params.cardId`（内置实现一致：`dsh-client-ui-plan/lib/client.js:178-182`、`dsh-client-ui-deliverables/lib/client.js:1794-1795`、`dsh-client-ui-schedule/lib/client.js:6098/6166-6167`）。
4. 后果：`card` 恒 `undefined` ⇒ 渲染 `cardClosed` 兜底脸；`client.js:7087-7101` 的 render proof 永不 settle ⇒ `client.js:6134-6144` 的 600ms 定时器把卡片移到 flow 并 toast「承载面未渲染」。**不崩、不丢数据**（卡片数据在 store 里，流继续在 flow 面跑）。

**触发范围（重要，别夸大）**：`pickSurface`（`client.js:2393-2411`）在 `sideSurface:'auto'`（默认，`client.js:191-198`）下 `autoOrder = [better, flow]`，**有意跳过原生右栏**（`:2394-2400` 注释说明：tab 生命周期不归插件、会占用户栏位）。⇒ **只有用户显式选择 `native-rightbar` 才受影响**，默认配置不受影响。
**修复**：把 `CardHost` 的 cardId 来源改为框架注入的 tab 信息（`useTabInfo()` → `tab.navigation.params.cardId`），去掉对 `props.tab.meta` 的依赖；`inject` 回调对该槽无效，可直接删。

### D. 宿主（Host）服务 —— ✅ 通过，两处降级

| 契约 | rc.3 事实 | 插件 | 判定 |
|---|---|---|---|
| `ctx.subagents` | 无 `start()`；只有 `startActivation(spec)`（`dsh-subagent/lib/index.js:3036-3047`） | `index.js:1603-1617` 调法与解构匹配，prompt 为块数组（`:1912`） | ✅ |
| `SubagentStartRequest` | `{cwd?, agentPreset?, label?, prompt[], parent, signal, agentOptions?, outputSchema?, maxDepth?}` | 传 `persona`/`toolFilter` 均被能力位拦截后**不发送** | ✅（见 D1/D4） |
| `agent/assistant-stream` | 载荷 `{agent, frame}`；**end 帧只有 `outcome`，无 `stopReason`**（`api-catalog.js:4803-4804`） | SSE `status.stopReason` 恒 `undefined`，终态由 `result.stopReason` 兜底 | ⚠️ P1 |
| `webServer.register` | `{kind:'prefix', path, handler}` 仍在（`dsh-host-webserver/lib/index.js:326-333`），前缀匹配 `:495-504`，SPA fallback 仅无匹配时接管 `:378-394`，gzip 跳过 `text/event-stream` `:203` | `index.js:2727` + 逐方法兜底 `:2734` | ✅ |
| `connection.requestRejection` | 存在（`dsh-client-connection/lib/index.js:737`） | 用于门禁 | ✅ |
| `agents` | 服务在 `dsh-agent/lib/index.js:332`（**更正前一版记录 :43**，那是无关注释） | `agents.get` / `roots` / `list` 用法正确 | ✅ |
| `ctx.get('webRuntime')` | **全树 0 命中**（不存在） | 仅用于 `/feedback` 环境版本块，缺失回退 `process.env.DSH_VERSION` | ⚠️ P2 |
| 所有 `ctx.get` | — | 均为软取 + try/catch，缺失只降级不崩 | ✅ |

### E. 默认承载面 better-sidebar —— ✅ 通过

`dsh-better-sidebar@0.28.0` 在客户端以 `ctx.provide("betterSidebar", service)` 暴露服务（`lib/client.js:31961`），插件 `ctx.inject(['betterSidebar'])` 可解析；`tabMeta`、`openTab({type,id,title,meta})` 的 `meta`、`closeTab(tabId)`、`TabComponentProps.{tab,scope}` 四项契约与插件调用逐个字段一致。

> **修正 client-audit 报告第 10 项**：该条称「`betterSidebar` 服务在 0.2.1-rc.3 不存在」——那是**只按官方包**扫描得出的结论；该服务由第三方插件 `dsh-better-sidebar` 提供，本机两个 profile 均已安装，故默认承载面实际可用。原文一并修正。

### F. 主题 / DOM 标记 —— ✅ 主链有效，两处后备失效

12 个 `--dsw-alias-*` token 全部仍在 `dsh-client-ui-theme`；`data-composer-input`、`data-lexical-editor`、`data-slot`、`data-platform`、`data-ds-dark-theme`、`data-dockkit-pane`、`data-dockkit-tab`、`data-sidebar-right-panel`、`data-sidebar-right-open` 全部由 rc.3 真实渲染。
失效的只有**后备**选择器：`.rightbar`（rc.3 中只是插槽名，面板根类是 CSS Module 哈希）与 `[data-dsh-panel-host]`（0 命中）；插件是阶梯式探测，主链命中即可（P6）。

### G. 安装与回归 —— ✅ 通过

`npm test` 1831 断言全绿；`node --check` 双文件通过；版本三处（`package.json` / `PLUGIN_VERSION` / `CLIENT_VERSION`）一致为 2.1.1。

### H. 网页端特有约束 —— ✅ 通过

网页端与桌面端共用同一前端；`dsh web` 的 `--host/--password` 门禁在 `connection` 层，与插件无关。插件自己的 `/sidecard-ask/*` 路由**不参与**宿主登录，但用 `connection.requestRejection` 做了同源校验（桌面端 loopback 放行，实机 401/200 行为符合预期）。

---

## 4. 问题清单

### D0 —— 原生右侧栏 body 取不到 `cardId`（严重，阻断单一路径）

- **证据**：`client.js:7083` vs `sidebar-right/lib/client.js:787-794`（schema 无 `meta`）、`:1378-1408`（第二参恒 `{}`）、`useTabInfo`（`:4856-4890`）；内置插件统一走 `tab.navigation.params`。
- **影响**：显式选择 `native-rightbar` 时，每张卡片 600ms 后被移到 flow 并 toast 一次；原生栏 tab 留在空壳 `cardClosed` 状态。
- **范围**：仅 `sideSurface:'native-rightbar'`；默认 `auto` 不受影响。双端同等。
- **修复（两条路，后者零依赖）**：
  1. 框架正解：`CardHost` 换成读 `useTabInfo()` 里的 `tab.navigation.params.cardId`（内置插件全此写法），并删掉对 `props.tab.meta` 的依赖与 body 上无效的 `inject(sessionId)`。
  2. 零依赖最小改：插件注册的 tab 类型**未声明 `multiple: true`**，`placeTab`（`:2298-2306`）因此用 `pageAddress(kind)` 作为唯一 contentId ⇒ **该 kind 全进程只对应一个 tab**，body 无需从 tab 反查 cardId；`open()` 时把「本 kind 当前展示的 cardId」写进插件自己的 store，`CardHost` 直接读即可（同时天然修掉「第二张卡片覆盖第一张」的隐患）。
     附带收益：这条改法不依赖任何 rc.3 私有导出，跨版本最稳。

### D1 —— `sideTools:'readonly'` 在 rc.3 不生效（中，已披露）

- **机制（按源码更正表述）**：`SubagentCapabilities` 只有 `{agentOptions, agentPreset, outputSchema, depthLimit}`（`dsh-subagent/lib/typert.host.js:825`），**没有 `toolFilter` 位**；插件读到 `caps.toolFilter !== true` 后**主动不发送** `toolFilter`（`index.js:1916`），并在 wire 上标注 `toolFilter:'unsupported'`（`:1935-1937`），卡片据此显示 `t('toolGuardUnavailable')` 的灰色提示行。⇒ **不是「传了被忽略」而是「能力位不存在 ⇒ 插件不传并披露」**；宿主侧 `startLocal` 的 composition 也确实只透传 `agentPreset`（`dsh-subagent/lib/index.js` `composition: { agentPreset: request.agentPreset }`），即便硬传 `toolFilter` 也不会生效。
- **影响**：子代理继承父会话全部工具（含写工具），用户侧有提示但围栏不成立。
- **修复**：rc.3 提供 `agentPreset` 能力位与 `request.agentPreset` 透传 ⇒ 用一个「只读工具集」的 preset 承载 `sideTools:'readonly'`；`caps.agentPreset===true` 时才启用，否则维持现在的披露式降级。

### D2 —— 从卡片内部关闭原生栏 tab 恒失败（中）

- **证据**：`sidebarRight` 控制器方法集是 `openTab/openTabIn/openResource/openResourceIn/close/closeIn/closeTarget/…`，**无 `closeTab(kind, options)`**；插件 `surfaces.native.close`（`client.js:2242-2256`）用 `typeof this.controller?.closeTab !== 'function'` 守卫，恒为真 ⇒ 直接返回 `false`（不抛错）。`client.js:2244` 注释「since 0.2.0 暴露 closeTab」是错误陈述。
- **修复**：body 内部应使用该 tab 的 `actions`（`TabHookContext.actions`）或 `controller.close(tabId)`，不要再探测 `closeTab`。

### D3 —— 界面语言切换不跟随（轻）

- **证据**：rc.3 locale 服务快照是 `{active, locales, revision}`（`dsh-client-locale/lib/client.js:1217-1222`，服务在 `:1526`）；插件读 `snapshot?.locale ?? snapshot?.id ?? getLocale()?.locale`（`client.js:6745-6755`）——三个字段都不存在 ⇒ 恒 `undefined` ⇒ 刷新后仍按 `navigator.languages`。
- **修复**：改读 `snapshot.active`。

### D4 —— `persona` 能力位缺失（轻，无功能损失）

`SubagentCapabilities.persona` 不存在 ⇒ 插件把 persona 降级拼进 prompt 文本（`index.js:1909`），行为正确、无信息丢失，只是少了一条独立通道。

### P1–P7（提示项）

| 编号 | 内容 | 建议 |
|---|---|---|
| P1 | `assistant-stream` 的 end 帧无 `stopReason`，SSE 该字段恒空 | 前端已用 `result.stopReason` 兜底，保持；文档标注即可 |
| P2 | `webRuntime` 服务不存在 ⇒ `trustedHosts` 恒空 ⇒ 非 loopback 访问插件路由一律 403 | 若未来要支持局域网/隧道访问，需改为读 `connection` 的等价能力 |
| P3 | 未声明 `engines.dsh` ⇒ 无安装期门禁 | 建议加 `"engines": {"dsh": ">=0.2.1-rc.3"}`（rc.3 门禁会读） |
| P4 | `inject` 中 `@deepseek-ai/dsh-client-ui-slots` 已非独立包 | 与官方模板一致，保留；无风险 |
| P5 | `dsh.manifestVersion` 在 rc.3 惰性（不校验不拒绝） | 保留即可 |
| P6 | `.rightbar` / `[data-dsh-panel-host]` 后备选择器失效 | 主链有效，可清理 |
| P7 | `conversation` 服务取 composer 草稿是插件自述的 PLACEHOLDER | 已是防御式最后一档，保留 |

---

## 5. 与上一轮（2.0.2 口径）相比的变化

| 项 | 上一轮（网页 0.2.1-rc.2 × 桌面 0.2.0-rc.2） | 本轮（双端 0.2.1-rc.3） |
|---|---|---|
| 加载与注册 | 通过 | 通过（实机 ping + bundle 双证） |
| 槽位 | 9 个 key 全在 | 仍全在，且按 103 槽官方目录逐项核对 |
| 原生右栏 | 当时记录为「可用/未验证」 | **确认失效（D0）**，原因从「未验证」变为「契约错位」 |
| 只读围栏 | 记录为「rc.2 支持」 | **rc.3 能力位缺失（D1）**，已披露 |
| 关闭 tab | 记录为「0.2.0 起可用」 | **rc.3 无 `closeTab`（D2）**，注释需更正 |
| locale | 记录为「跟随」 | **不跟随（D3）**，字段名变更 |

上一轮 2.1.0 已修的 P1-P5（性能/回放/重试/`/ping`）在本轮回归中保持有效，无回退。

---

## 6. 建议的修复顺序

1. **D0（必修）**：cardId 取 `useTabInfo().tab.navigation.params.cardId`；顺带删掉 body 上无效的 `inject(sessionId)`。
2. **D2（必修，一行）**：改用 `actions.close` / `controller.close(tabId)`，删掉错误的 `closeTab` 注释。
3. **D3（低成本）**：locale 读 `active`。
4. **D1（设计改造）**：以 `agentPreset` 承载只读围栏，`caps.agentPreset===true` 时启用；README §5.4 与卡片提示同步更新。
5. **P3**：补 `engines.dsh`，让不兼容版本装不上而不是装完才炸。

修完 1-3 后，双端「原生右栏 + 关闭 + 语言」三条路径即可与内置插件行为对齐；D1 属于宿主能力演进，需单独设计。

---

## 7. 未能验证（明确不当作通过）

1. **浏览器级端到端**：桌面端 Web GUI 需签名 cookie（`connection` 用内存 secret 签发），无法在无交互环境取得 ⇒ 卡片渲染、SSE 流、toast 的实际视觉行为未做真机截图验证；仅以其「服务端可达 + 契约签名匹配」推断。
2. **`dsh-web-frontend` 内部实现**：dockkit（`@deepseek-ai/dsh-client-ui-dockkit`）不是独立安装包，是前端 staticModules 的虚拟模块；本报告对 tab 记录形状的结论来自 `sidebar-right` 的 zod schema（权威落盘格式），未反编译该虚拟模块。
3. **解包产物无 `.d.ts`**：`exports.types` 指向的文件未随包解出，类型层（如 `ISidebarRight` 接口全貌）只能以运行时源码为准。
4. **rc.2 基线**：工作区未保留 rc.2 解包产物，跨版本差异以官方 `compat-probe` 的两版输出为准，未逐行 diff。
5. **`dsh` CLI 独立启动的网页端**：本机未发现全局 `dsh` 命令，网页端由桌面端进程内托管；纯 `dsh web` 进程下的插件加载未单独复现（同运行时，风险低）。

---

## 附录 A：取证方法

- 解包：`npx asar extract "<…>/app.asar" .compat-report/evidence/dsh-0.2.1-rc.3/dsh`（307 包，版本一致）
- 插件路由实机探针：`curl http://127.0.0.1:<port>/sidecard-ask/api/ping`
- bundle rev 复算：`.compat-report/scripts/rev.mjs`（照 `dsh-client-modules` 的 `framedHash` 实现）
- 槽位目录解析：`.compat-report/scripts/slotcatalog.cjs`（从 `dsh-cordis-client-runner/lib/client.js` 的 `CLIENT_SLOT_API` 提取 103 槽及注册项/标准 props）
- 官方能力探针：`npm run probe -- 0.2.1-rc.2 0.2.1-rc.3 --json .compat-report/evidence/probe-0.2.1.json`

## 附录 B：产出物

- `.compat-report/FINDINGS-host.md`（Host 半 43 项契约表 + 6 问题）
- `.compat-report/FINDINGS-client.md`（Client 半 38 行契约表 + D0 + 2 降级 + 6 提示）
- `.compat-report/evidence/probe-0.2.1.json`（官方探针两版原始输出）
- 本文件：`CROSS-END-AUDIT-2.1.1.md`

> 解包出的 449 MB 运行时副本（`.compat-report/evidence/dsh-0.2.1-rc.3/`）在审计结束后已删除以节省空间；复现命令：
> `node .compat-report/scripts/extract-asar.mjs "C:\Users\34332\AppData\Local\Programs\DeepSeek Harness\resources\app.asar" .compat-report/evidence/dsh-0.2.1-rc.3`
> （本报告正文引用的行号均以 `0.2.1-rc.3` 该解包结果为准，路径前缀 `dsh/node_modules/@deepseek-ai/`。）

> 本报告对两份子报告做了**交叉复核与更正**：① Host 半 D1 的机制表述（能力位缺失导致插件不发送，而非发送被忽略）；② Client 半第 10 项（`betterSidebar` 由第三方插件提供，默认承载面可用）；③ `agents` 服务行号为 `dsh-agent/lib/index.js:332`。

---

## 附录 C：修复状态（2026-10-24，插件 2.1.2）

本报告列出的 4 项降级与 7 项提示已按「全部修复」指令处理，**改动与验证如下**（细节见 `CHANGELOG.md` 2.1.2 与 README §5.5）：

| 编号 | 处置 | 落点 |
|---|---|---|
| D0 | ✅ 已修：新增 `hostCardIdOf(props)`，三级回退（`tab.meta.cardId` → `navigation.params.cardId` → 适配器记录的 `surfaces.native.cardId`） | `client.js` `CardHost` / `surfaces.native.open` |
| D1 | ✅ 已修：新增配置 `sideAgentPreset`（≤120 字符，能力位门控），`agentPreset` 是 0.2.1 唯一真实收窄通道；未引入不存在的 `toolFilter` | `index.js` `DEFAULT_CONFIG`/`sanitizeLayer`/`ask`；`client.js` 设置页与卡片提示 |
| D2 | ✅ 已修：改用 `openTabs.getSnapshot()` + `closeIn(sessionId, tabId)`，删除对不存在的 `closeTab` 的探测与错误注释 | `client.js` `surfaces.native.close` |
| D3 | ✅ 已修：按 `active → locale → id` 顺序读取（兼容旧壳与裸字符串 `getLocale()`） | `client.js` locale 订阅 |
| D4 | ⏸ 保持：persona 拼进 prompt 文本，行为正确，仅在 README/CHANGELOG 标注 | — |
| P1 | 📝 文档标注：end 帧无 `stopReason`，前端取 `result.stopReason` 兜底 | README §5.5 |
| P2 | ✅ 已修：`trustedHostsOf()` 增读 `connection.trustedHosts`（与宿主自身围栏同源） | `index.js` |
| P3 | ✅ 已加：`engines.dsh: ">=0.1.2-rc.1 <0.3.0"`；已按宿主门禁的 `includePrerelease:true` 实测 `0.2.1-rc.3 → true`、`0.3.0 → false` | `package.json` |
| P4/P5 | ⏸ 保留：与官方模板一致，rc.3 不校验 | — |
| P6 | ✅ 已清理：锚点阶梯与观察器移除 `.rightbar`、`[data-dsh-panel-host]` | `client.js` `RAIL_SELECTORS` / ResizeObserver |
| P7 | ⏸ 保留：防御式最后一档 | — |

**回归**：`verify 57 + contract 1427 + float-placement 84 + smoke 271 = 1839 passed, 0 failed`。
其中 contract 新增两条针对本报告结论的锁定断言：①「0.2.1 的 tab body 没有 `tab` 属性时仍能渲染适配器打开的卡片」（D0）；
②「关闭走到拥有该 tab 的会话」（D2，替身改为 rc.3 真实形态 `openTabs` + `closeIn`）。

**仍无法自动验证的部分（如实记录）**：桌面窗口内的真实点击/视觉行为（本机无 GUI 自动化）；
非 loopback 访问的 P2 修复（需要一次局域网/隧道实测）；`sideAgentPreset` 在真实 preset 注册表上的端到端效果
（能力位与参数传递已核，实际工具集取决于用户配置的 preset）。
