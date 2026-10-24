# dsh-sidecard-ask v2.1.1 × DSH 0.2.1-rc.3 — Client（浏览器半）契约审计

- 审计对象：`D:\Users\34332\AI\dsh-sidecard-ask\client.js`（7378 行，`window.__ModuleLoader__` 工厂模块）
- 对照证据：`D:\Users\34332\AI\dsh-sidecard-ask\.compat-report\evidence\dsh-0.2.1-rc.3\dsh\node_modules\@deepseek-ai\`（307 包，均为 0.2.1-rc.3）与 `dsh-web-frontend\dist\assets\index-BXV-oxvX.js`
- 只读审计；本文件是唯一写入产物。

> 证据说明：解包产物中**没有** `.d.ts` 文件（`find -name "*.d.ts"` 命中 0；包的 `exports.types` 指向的 `lib/types/client/index.d.ts` 未被解包）。因此全部结论基于 `lib/client.js` 运行时源码与前端 bundle 的实际代码行，并以**运行时行为**为准；类型层面（如 `ISidebarRight` 接口形状）无法直接核对，列入"未能验证"。

---

## 结论摘要

**总体判定：能加载、不报错，但"桌面端原生右侧栏"这一承载面实际不可用（阻断该路径）。** 8 类契约中 5 类完全兼容、2 类行为降级、1 类（原生右栏 body 取 cardId）实质失效。没有任何一项会让 client.js 加载失败或白屏，所以插件的浮层/输入区/设置页承载面仍可用；判定为 **降级（阻断单一路径）**。

**最高优先问题（D0，与 Lead 独立交叉复核后一致）：** 原生右栏 tab body 永远拿不到自己的 `cardId` —— 插件读的 `props.tab.meta.cardId` 在 0.2.1-rc.3 的 tab 记录与 slot props 中都不存在，正确来源是框架注入的 `useTabInfo()` → `tab.navigation.params`。后果是每张卡片都会在 600ms 后被兜底逻辑移到 flow 并提示「承载面未渲染」。

1. **模块协议 OK。** `window.__ModuleLoader__.load({id, factory})` 形状未变；`factory(require)` 的 require 仍是"平台种子词 → 已注册包工厂"两段解析，插件只 `require('react')`，`react` 仍是种子词。manifest 的 `dsh.client.platform/inject/immediately` 三个字段仍被 Host 与前端读取。
2. **`dsh.client.inject` 里写 `@deepseek-ai/dsh-client-ui-slots` 合法且无害。** 该包在 0.2.1-rc.3 已不是独立 npm 包（node_modules 中无此目录），但它仍是浏览器静态种子表的键（前端 bundle 的 `staticModules` 映射里 `"@deepseek-ai/dsh-client-ui-slots": jI`），所以既不会被当成缺失包报错（`arriveGraphRow` 只对**图行存在**的 inject 名建立依赖，未知名静默跳过），`require` 该名也仍可解析。
3. **slots 契约 OK。** 服务名仍是 `slots`（`super(ctx,"slots")`），`inject(key,cb)` 签名与"slot 声明出现时才执行、返回幂等 disposer"语义未变；`register(options,component)` 仍返回 Cordis effect disposer。插件的 `name/id/order/label/key/inject(sessionId, actions)` 用法全部合法。
4. **9 个 slot key 全部仍被声明**（含 `shell.overlay`、4 个 `conversation.*`、`settings.section`、`settings.plugins.tab`、`sidebar.right.pane.tab(.title)`），**无改名、无命名空间前缀化**。判定所需字段：`list` 类需要 `id`（插件都给了）、`keyed` 类需要 `key`（插件都给了）。
5. **降级 1（i18n）：`sidebarRight` 之外的 `locale` 契约有实质变化。** 0.2.1-rc.3 的 locale 快照是 `{active, locales, revision}`，**没有** `locale`/`id` 字段，也没有 `getLocale()` 方法。插件读 `snapshot?.locale ?? snapshot?.id ?? locale.getLocale()?.locale` → 全为 `undefined` → **用户在设置里切换界面语言后，插件文案不会跟随**（刷新后仍由 `navigator.languages` 决定）。
6. **降级 2（关闭）：`sidebarRight.closeTab()` 在 0.2.1-rc.3 不存在。** 控制器的真实方法集是 `openTab/openTabIn/openResource/openResourceIn/close/closeIn/closeTarget/...`，没有 `closeTab(kind, options)`。插件有 `typeof !== 'function'` 守卫，所以不会抛错，但"从卡片内部关闭"这条路径永远返回 `false`（不生效）。
7. **DOM 标记：主链仍存在，两个后备选择器已消失。** `data-sidebar-right-panel / -open / -session`、`data-dockkit-pane / -column` 仍由 0.2.1-rc.3 真实渲染；`.rightbar`（旧 CSS 类名）与 `[data-dsh-panel-host]` 已不再存在（`rightbar` 现在只是**插槽名** `"rightbar"`/`"rightbar.session"`，面板根节点类名是 CSS Module 哈希 `acoR2W_panel`）。插件的选择器是阶梯式的，主链命中即可，故只算"更快路径失效"。
8. **主题 token OK。** 插件使用的 12 个 `--dsw-alias-*` token 在 `dsh-client-ui-theme` 中全部仍定义（含 `--dsw-alias-state-idle-primary`）。插件不使用 `--dsh-*` 变量，不存在改名影响。
9. **设置页注册形状 OK。** `settings.section`/`settings.plugins.tab` 均为 `list/root`，仍消费 `id/order/label/locale/inject`，与官方 `settings-account`、`settings-plugin-inventory` 注册形状逐字段一致。
10. **两条可选升级路径是死路（无害）：** 服务 `betterSidebar`（`ctx.inject(['betterSidebar'])`）与 `conversation`（`ctx.get('conversation')`）在 0.2.1-rc.3 客户端服务目录中均不存在，相关分支永远不会激活。
11. **阻断（仅原生右栏承载面）：卡片 body 取不到 `cardId`。** `client.js:7083` 读 `props?.tab?.meta?.cardId`，但 rc.3 的 tab 记录是 `{id, kind, contentId, title}`（无 `meta`，全树 `tab.meta` 0 命中），slot 第二参是 `{}`（`dsh-client-ui-sidebar-right/lib/client.js:1399-1403`），body 只能通过 `useTabInfo()` 拿 `tab.navigation.params`（内置插件全如此：`dsh-client-ui-plan/lib/client.js:178-182`、`dsh-client-ui-deliverables/lib/client.js:1794-1795`）。因此 `card` 恒 `undefined` → 渲染 `cardClosed` 兜底脸 → 600ms 后 `client.js:6134-6144` 把卡片移到 flow 并 toast。详见 D0。
12. **Slot 注册必填项没有新增**：`list` 需 `id`、`keyed` 需 `key`、`chain` 需 `select`（`index-BXV-oxvX.js` 内 `slot "${name}" requires options.id/key/select`），`name/order/label/priority/inject/store/locale` 语义未变，插件全部满足。`locale` 是**可选**项，且未注册的 namespace 不会抛错（`dsh-client-locale/lib/client.js:1414-1427` `bind(ns)` → `translate` 回退到 `common` 再回退到 key 本身）——所以"必须预先注册 NS"不成立。

---

## 契约核对表

| # | 契约 | 插件用法(client.js:行) | DSH 0.2.1-rc.3 证据(文件:行) | 判定 | 影响 |
|---|---|---|---|---|---|
| 1 | 模块注册门面 `__ModuleLoader__.load({id,factory})` | `client.js:27` `window.__ModuleLoader__.load({ id: 'dsh-sidecard-ask', factory(require) {...} })` | `dsh-client-modules/lib/client.js:696-698` `target.load = (registration) => { this.register(registration) }`；`:702-714` `register()` 接受 `{id, chunk?, factory}`，重复注册才抛错；`:810` 同步物化 | OK | 加载路径不变 |
| 2 | `factory(require)` 解析语义 | `client.js:27` 只 `require('react')` | `dsh-client-modules/lib/client.js:831-841` `makeRequire`：`if (this.seed.has(spec)) return this.seed.get(spec)` → 否则查 `loadCache`/`factories` → 否则抛 `require("…") missed the module table`；种子表见 `dsh-web-frontend/dist/assets/index-BXV-oxvX.js` `OZ()`：`{react, "react/jsx-runtime", "react-dom", "react-dom/client", "@deepseek-ai/cordis", zod, "@tanstack/react-virtual", "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-dockkit"}` | OK | `react` 仍在种子表，插件不越界 require 其他模块，安全 |
| 3 | `dsh.client.platform` | `package.json` `dsh.client.platform = "web"` | `dsh-client-modules/lib/index.js:733` `if (decl === void 0 \|\| decl.platform !== "web") { …; return null }` | OK | 非 "web" 会被静默跳过；插件取值正确 |
| 4 | `dsh.client.immediately` | `package.json` `immediately: true` | `dsh-client-modules/lib/client.js:140` `immediately: row.immediately === true`；`dsh-web-frontend/…index-BXV-oxvX.js` `prefetchImmediateTier(){…filter(e=>e.immediately).map(e=>this.modules.prefetch(e.id)…)}` | OK | 影响预取时机，不影响正确性 |
| 5 | `dsh.client.inject` 声明（含已非独立包的 `…ui-slots`） | `package.json` `inject: ["…/dsh-client-locale","…/dsh-client-ui-slots","…/dsh-client-ui-conversation"]` | `dsh-client-modules/lib/index.js:742-747` 透传 `decl.inject` 进图行；`dsh-client-modules/lib/client.js:789-792` `for (const packageName of row.inject) { const dependency = this.graphRows.get(packageName); if (dependency !== void 0) … }` ——**非图行的 inject 名静默跳过**；`…ui-slots` 目录确实不存在（`ls` 失败），但作为 `staticModules` 键仍可 `require` | OK（无害） | `locale`/`conversation` 是真图行→保证先加载；`ui-slots` 既不成边也不报错。**建议**改成 `"@deepseek-ai/dsh-client-ui-slots"` 之外更稳的写法或直接删除该项，因为它是"种子词"而非包，语义上属于 `external` 而非 `inject`。 |
| 6 | `exports["./client"]` 客户端入口解析 | `package.json` `"./client": "./client.js"`（字符串形式） | `dsh-client-modules/lib/index.js:171-181` 接受字符串或一层条件对象（内置包用 `{types, default}`），其余报错 | OK | 入口解析不变 |
| 7 | `slots` 服务名 + `ctx.slots.inject(key, cb)` | `client.js:5610` `inject: ['slots']`；`client.js:6824` `ctx.slots.inject(key, () => {…})` | `dsh-client-ui-renderer/lib/client.js:1348` `super(ctx, "slots")`；`:1368-1397` `inject(key, callback)`：`ctx.effect(() => {… const spec = this._core.specDynamic(key); if (spec === void 0) return; const disposeEffect = ctx.effect(callback, …)…})`，返回幂等 disposer，**slot 声明出现/变更时回调重跑** | OK | 插件的阶梯探测（`SLOT_PROBE_MS=1500` 后取下一个 rung）语义完全成立 |
| 8 | `ctx.slots.register(options, component)` 返回 disposer | `client.js:6826` `const disposeRegistration = ctx.slots.register(built.options, built.component)` | `dsh-client-ui-renderer/lib/client.js:1813-1816` `register(rawOptions, component) { return this.ctx.effect(() => this["_register"](options, component), "slots.register()") }` | OK | 卸载=dispose effect，插件按 disposer 收集正确 |
| 9 | 注册选项字段 `name/id/order/label/key/inject` | `client.js:6898` `{name: slotKey, id: IDS.overlay, order: 45, label: () => t('triggerLabel')}`；`6911` `{…id: IDS.settings, order: 60, label}`；`6924` `{…id: IDS.sessionProbe, order: 90}`；`6985` `{name:'sidebar.right.pane.tab', key: CARD_KIND, inject: sessionId => ({sessionId})}`；`6989` `{name, key: CARD_KIND}` | `dsh-client-ui-renderer/lib/client.js:435-442` `runInject`：`if (binding!==void 0) args.push(binding.key); if (actions!==void 0) args.push(actions); return bindInjectSources(inject(...args))`；同包 `dsh-client-ui-plan/lib/client.js:696` `inject: (sessionId) => ({ exitPlanMode: … ctx.remote.commands.execute(sessionId, …) })` 印证首参=sessionId；`label` 仍被消费（`dsh-client-ui-settings-plugins/lib/client.js:187` `resolveSlotLabel(entry.options.label) ?? ""`） | OK | 关键点：`inject` 首参在 session 域 slot 里是 **sessionId**（`binding.key`），插件 `inject: sessionId => ({sessionId})` 语义正确，不是误用 keyed 的 entry key |
| 10 | slot key `shell.overlay` | `client.js:6896` 首 rung | `dsh-client-ui-layout/lib/client.js:643-646` `"shell.overlay": { kind: "list", scope: "root" }`；`:313` `renderSlot("shell.overlay", {})` | OK（`list` 需 `id`，已给） | 浮层首选挂载点仍在 |
| 11 | slot key `conversation.input.right / left / dock`、`conversation.composer.dock` | `client.js:6896, 6921`（两处阶梯） | `dsh-client-ui-conversation/lib/client.js:19938-19941` `"conversation.input.dock": {kind:"list",scope:"session"}`；`:20093-20096` `.input.left`；`:20101-20104` `.input.right`；`:20113-20116` `"conversation.composer.dock": {kind:"list",scope:"session"}` | OK | 无改名；4 个都是 `list/session`，需 `id`，已给 |
| 12 | slot key `settings.section` / `settings.plugins.tab` | `client.js:6908-6911` | `dsh-client-ui-settings-general/lib/client.js:1264-1267` `"settings.section": { kind:"list", scope:"root" }`；`dsh-client-ui-settings-plugins/lib/client.js:208-211` `children: { "settings.plugins.tab": { kind:"list", scope:"root" } }` | OK | 设置页与插件页两个挂载点都在；`plugins.tab` 需该页渲染时才声明，插件有 `inject` 等待机制，兼容 |
| 13 | slot key `sidebar.right.pane.tab` / `.title` | `client.js:6984-6992` | `dsh-client-ui-sidebar-right/lib/client.js:5046-5055` `"sidebar.right.pane.tab": { kind:"keyed", scope:"session", inject:{hooks:{tabInfo:tabInfoFactory}} }`；`.title` 同形 | OK（`keyed` 需 `key`，已给） | 与官方 `dsh-client-ui-plan/lib/client.js:691-700` 的注册形状一致 |
| 14 | 服务 `sidebarRightTabs` / `sidebarRight` 存在性 | `client.js:6948` `ctx.inject(['sidebarRightTabs','sidebarRight'], (injected) => …)` | `dsh-client-ui-sidebar-right/lib/client.js:4965-4966` `ctx.reflect.provide("sidebarRightTabs", tabs)` / `ctx.reflect.provide("sidebarRight", controller)` | OK | 服务名未变；`ctx.inject` 返回 uninject 也被正确使用 |
| 15 | `sidebarRightTabs.register(definition)` 真实签名 | `client.js:6960-6970` `registry.register({ id: CARD_KIND, kind: CARD_KIND, title: () => t('answerTitle'), guide: [{ id: CARD_KIND, order: 120, title: …, description: … }] })` | `dsh-client-ui-sidebar-right/lib/client.js:4580-4620` `register(definition)` 解构 `{id, kind}`、`definition.guide ?? []`、`definition.priority ?? DEFAULT_BAND`、`definition.patterns ?? []`，`ctx.effect(...)` 返回 disposer；`definition.title(...)` 在 `:707` `title: definition.title(pageAddress(kind))` 与 `:2305` 被调用；guide 项在 `:540/:623/:642` 以 `entry.title()` 消费 | OK | 插件签名正确；`title` **会被**调用（无需参数，多传参被忽略，无害）；`guide[]` 的 `order/title/description` 都被消费 |
| 16 | `sidebarRight.openTab(kind, {params, revealIfOpened})` | `client.js:2239` `this.controller.openTab(CARD_KIND, { params: { cardId: card.id }, revealIfOpened: true })` | `dsh-client-ui-sidebar-right/lib/client.js:2243-2245` `openTab(kind, options = {}) { const {sessionId, actions} = this.require(); this.placeTab(sessionId, actions, kind, options) }`；`:2298` `placeTab(...) → this.place(…, options, options.params)`；`:2309` `place(sessionId, actions, claim, address, placement, params)`；`:2322` `revealIfOpened`、`:2326` `params` 均被写入布局意图 | OK | 打开与"已开则揭示"语义保留；`params` 进入 tab body 首帧 |
| 17 | `sidebarRight.closeTab(kind, options)` | `client.js:2248-2251` `if (typeof this.controller?.closeTab !== 'function') return false; … this.controller.closeTab(CARD_KIND, { params: { cardId: card.id } })` | 控制器方法全集（`awk NR 2100-2600`）：`openTab/openTabIn/openResource/.../closeIn(sessionId, tabId)`(:2278)、`close(tabId)`(:2344)、`closeTarget(target)`(:2448)…**无 `closeTab`** | 缺失（有守卫） | 插件"从卡片内部关闭当前卡片"永远返回 `false`；不抛错、不影响其他功能。**修复建议**：改用 `controller.closeIn(sessionId, tabId)`（需先由 `tabsIn(sessionId)` 找到 `tabId`），或走 `closeTarget`/让用户用轨道自带关闭按钮 |
| 18 | `sidebarRight.mounted` 快照 | `client.js:2196-2212` `ctx.get('sidebarRight')?.mounted` + `mounted.getSnapshot()` | `dsh-client-ui-sidebar-right/lib/client.js:2135` `const onScreen = createSnapshotStore(void 0)`；`:2217` `this.mounted = sessions.onScreen` | OK | `getSnapshot()` 返回当前会话 id 或 `undefined`，与插件期望一致 |
| 19 | 会话提交 `sessions.using / retain / scope` | `client.js:2123` `sessions.using(sessionId, {source:'gateway'}, async reference => reference.binding.session.prompt(parts,'queue'))`；`:2138` `sessions.retain(...)`；`:2184` `sessions.scope(...)` | `dsh-api-session-controller/lib/client.js:3842-3850` `retain(target, options)`；`:3856-3863` `async using(target, options, operation) { const reference = this.retain(target, options); try { await reference.ready; return await operation(reference) } finally { reference.release() } }`；`:4013` `scope(id)`；`:2341` `async prompt(content, mode, signal, requestId)` | OK | 三级提交主路仍成立（服务名为 `sessions`，由 `dsh-api-session-controller/lib/client.js:3840` `reflect.provide("sessions", …)` 提供） |
| 20 | 标准 prop `inputActions`（composer 提交） | `client.js:5557` `const actions = props?.inputActions`；`2160` `composerFace()` | `dsh-client-ui-conversation/lib/client.js:19905-19911` 会话域 slot 注入 `props: { inputActions: shell.actions }`；`setDraft`、`captureInsertion`、`submit` 在同包可见，`submitPrompt` 全树无定义 | OK（`submitPrompt` 分支恒 false，无害） | 插件 `setDraft → submit` 路径可用；`actions.submitPrompt` 探测项永远落空但不报错 |
| 21 | `ctx.get('locale')` + `getSnapshot()/subscribe()` | `client.js:6742` `const locale = ctx.get('locale')`；`6748` `snapshot?.locale ?? snapshot?.id ?? locale.getLocale()?.locale`；`6762` `locale.subscribe(read)` | `dsh-client-locale/lib/client.js:1526` `ctx.provide("locale", locale)`；`:1250-1252` `getSnapshot() { return this.snapshot }`；`:1260-1265` `subscribe(fn)` 返回退订；`:1443-1448` `publish()` → `this.snapshot = Object.freeze({ active, locales, revision })` | **变化（降级）** | 订阅本身有效（切换时会触发回调），但 **快照没有 `locale`/`id` 字段，服务也没有 `getLocale()`** → `id` 恒为 `null` → 语言永不更新。**修复**：改读 `snapshot?.active`（唯一可用的语言 id 字段） |
| 22 | locale 词典注册（自带 `locale/*.json`） | `client.js` **全文无** `ctx.locale.register` / `locale.bind`（grep `locale.register\|ctx.locale` 命中 0） | `dsh-client-locale/lib/client.js:1387` `register(ns, localeOrDicts, dict)`、`:1414` `bind(ns)`；官方 `dsh-client-ui-layout` 仍用两参形式 `ctx.locale.register("shortcuts.layout", {zh,en})` | 兼容（但未使用） | 插件自带字典、不经 locale 服务，因此**不会**因 API 变化而崩；代价是文案不受"界面语言"设置统一管理。若要与宿主一致，可改为 `ctx.locale.register(ns, {zh, en})` + 组件内 `ctx.locale.bind` |
| 23 | DOM 标记 `data-sidebar-right-panel / -open / -session` | `client.js:417-418` `'[data-sidebar-right-panel][data-sidebar-right-open]'`；`:4766` MutationObserver `attributeFilter: ['data-sidebar-right-open','data-dockkit-pane-active']` | `dsh-client-ui-sidebar-right/lib/client.js:1529-1531` `"data-sidebar-right-session": sessionId, "data-sidebar-right-panel": fullscreen ? "fullscreen" : "push", "data-sidebar-right-open": expanded \|\| void 0`；`:1704` 同样三元；CSS `:1258` `[data-sidebar-right-open]` | OK | 三个标记仍渲染；`-open` 只在展开时存在（`undefined` 不写属性），插件把它当"展开态"判断是正确用法 |
| 24 | DOM 标记 `data-dockkit-pane / -column -active` | `client.js:417/425/443` `'[data-dockkit-pane]'`；`:4766` `data-dockkit-pane-active` | `dsh-client-ui-sidebar-right/lib/client.js:48-49, 77-81, 105-107, 133` 以选择器消费；`:1258` CSS `[data-dockkit-column="0"][data-dockkit-pane]`、`[data-dockkit-pane-active]`；`data-dockkit-float` 为新的一族 | OK | 仍渲染（由 `dsh-client-ui-dockkit` 打标）；注意新增 `data-dockkit-float` 家族，浮窗态插件未覆盖（不影响既有路径） |
| 25 | DOM 标记 `.rightbar` | `client.js:427` `'.rightbar'`（阶梯末位）；`:4655` `'…, .rightbar, …'` | 全树无 `.rightbar` **类名**；`rightbar` 仅作为插槽名出现：`dsh-client-ui-sidebar-right/lib/client.js:1707` `renderSlot("rightbar.session", {…})`、`:5032` `name: "rightbar"`；面板根类名是 CSS Module 哈希 `acoR2W_panel`（`:1258`） | 缺失（后备档） | 该 rung 恒不命中；主链（`data-sidebar-right-*`）命中时无影响，仅在主链全部失效时提前降级。**修复**：删除或替换为 `[data-slot="sidebar.right.session"]` |
| 26 | DOM 标记 `[data-dsh-panel-host]` | `client.js:2427`（样式注释）、`:4655`（选择器） | 全树 `grep -l data-dsh-panel-host` → **0 命中** | 缺失（后备档） | 同上，仅降低后备命中率 |
| 27 | `[data-slot]` 锚点 | `client.js:4655` `'[data-slot^="conversation"], …[data-slot^="sidebar.right"]'`；`:6596-6624` 区域过滤 | `dsh-client-ui-renderer/lib/client.js:1117-1127` `{ "data-slot": slotKey, style: ANCHOR_STYLE /* display:contents */, children }`；`:1243` `"data-slot": "root"`；失败项标 `data-slot-error` | OK | 锚点仍在，插件的区域判定与 `[data-slot^="sidebar.right"]` 均有效 |
| 28 | `data-composer-input` / `data-lexical-editor` | `client.js:3515` `['[data-composer-input]','[data-lexical-editor="true"]','[data-slot^="conversation"] textarea']` | `grep -l` 分别命中 `dsh-client-ui-conversation`（1 包） | OK | 遗留 DOM 依赖仍在，未消失 |
| 29 | `data-phase` | `client.js` 全文 **无** `phase`（grep `phase` 命中 0） | `dsh-client-ui-conversation/lib/client.js:17616` `"data-phase": phase`、`:18336` 同；CSS `:17386` `[data-phase=active\|hero\|settling]` | 不适用 | 任务清单里的 `data-phase` 是本插件**未使用**的标记；0.2.1-rc.3 仍在渲染（值 `active/hero/settling`），如需做"对话进行中"判断可用 |
| 30 | 主题 token `--dsw-alias-*` | `client.js` CSS 中使用 12 个：`--dsw-alias-label-secondary`(20) `--dsw-alias-border-l*`(21) `--dsw-alias-brand-primary`(19) `--dsw-alias-label-primary`(15) `--dsw-alias-bg-layer-*`(14) `--dsw-alias-bg-overlay`(12) `--dsw-alias-state-{error,warn,success,idle}-primary` | `dsh-client-ui-theme/lib/client.js` 中逐个 `grep --dsw-<name>`：`alias-border-l3` / `alias-label-secondary` / `alias-brand-primary` / `alias-label-primary` / `alias-bg-overlay` / `alias-state-error-primary` / `alias-state-warn-primary` / `alias-state-success-primary` / `alias-state-idle-primary` / `alias-state-business-primary` **全部 PRESENT** | OK | 不存在 token 改名影响；插件不依赖 `--dsh-*` |
| 31 | `<style>` 注入 | `client.js` 自建 `<style>` 注入 CSS | `dsh-client-modules/lib/client.js:620-630` 会"认领并清点"工厂运行期间注入的 `<style>`（卸载时清理）；`:617` 记录工厂运行前已存在的未打标 `<style>` | OK（需注意） | 框架按工厂归属管理样式；插件若在**组件渲染期**再动态插入 `<style>`（晚于工厂执行），可能不被归属清理。属于提示级，未发现插件在渲染期重复插入的证据 |
| 32 | `ctx.get(name)` | `client.js:2113` `ctx.get('sessions')`；`2196-2212` `ctx.get('sidebarRight')`/`get('betterSidebar')`；`6742` `ctx.get('locale')`；`2181` `ctx.get('conversation')` | `cordis/lib/index.js:763` `get(name, strict = true)` 未变；客户端服务目录（`grep -rho 'provide("X"'`）：`chatFileMentions, cordisInspect, documentPreviews, dynamicCordisRunner, feedbackUi, inspector, layout, locale, modules, pluginNavigation, resources, sessionLogDownload, sessions, sidebarRight, sidebarRightTabs, theme, uiRenderer, userQuestionPanels` + `appExit, appReady, connection, dshHomePath, webApp, workspaceChanges, cmdlineArgs` | 部分缺失 | `sessions/locale/sidebarRight` 在；**`betterSidebar`(:7038) 与 `conversation`(:2181) 不在目录中** → 两条可选分支永不激活（本身是 try/catch 保护，无害） |
| 33 | 设置页注册形状（`title`/`description` vs `label`） | `client.js:6910` `{ name:'settings.section', id: IDS.settings, order: 60, label: () => t('settingsTitle') }` | `dsh-client-ui-settings-account/lib/client.js:4765+` `register({ name:"settings.section", id:"account", order:-10, label:()=>t("nav"), locale:"settings.account", inject:()=>operations }, AccountSection)`；`dsh-client-ui-settings-plugin-inventory/lib/client.js:758-765` `{ name:"settings.plugins.tab", id:"all", order:10, label:()=>t("tab"), locale:NS, inject:injected }` | OK | 部分名为 `label`（不是 `title`/`description`），插件用法与官方一致；未提供 `locale` 命名空间不影响渲染（只影响宿主 locale 绑定） |
| 34 | 原生右栏 tab 记录 schema（`cardId` 来源） | `client.js:7083` `const cardId = props?.tab?.meta?.cardId`；`client.js:2239` 通过 `openTab(CARD_KIND, { params: { cardId: card.id } })` 传参 | `dsh-client-ui-sidebar-right/lib/client.js:787-794` tab 记录只有 `{id: tabId, kind, contentId, title}`；`README.md:93` "the Tab domain records the navigation — `params` reach the body as `navigation.params`"（navigation **不在** layout tab 记录里）；全树 `grep -c "tab\.meta"` = **0 命中** | **缺失/变化** | 原生右栏 body 拿不到 cardId → 见 D0（阻断该承载面） |
| 35 | `sidebar.right.pane.tab` body 的真实 props | `client.js:6986` `(props) => h(CardHost, { props, actions })`，`CardHost` 内只读 `props.tab` | `dsh-client-ui-sidebar-right/lib/client.js:1378-1403` `TabSlot` 构造 `hookContext = {tabId, shortcuts, title, fullscreen, active, signal, actions: tabActions, useStore, useTabNavigation}`，再 `renderSlot(seat, {}, { entryKey, fallback, hookContext })`（第二参是 `{}`，`tab` 不进 props 也不进 hookContext）；`:4856-4890` `tabInfoFactory` 返回 `useTabInfo()` → `{ sidebar, panel, tab: { ...tabRecord, visible, navigation, signal, actions, refreshShortcut } }`；`:435-442` `bindInjectSources` 把 `{hooks:{tabInfo}}` 变成标准 hook prop `useTabInfo` | **变化** | 正确取法：`const { tab } = props.useTabInfo(); tab.navigation.params.cardId`。内置插件例证：`dsh-client-ui-plan/lib/client.js:178-182` `PlanPreview({ useTabInfo, … }){ const tab = useTabInfo(); … params = tab.tab.navigation.params }` |
| 36 | slot 注册必填项（rc.3 是否新增） | `client.js:6898` list 带 `id`；`6985/6989` keyed 带 `key` | 种子包 `@deepseek-ai/dsh-client-ui-slots`（前端 bundle `index-BXV-oxvX.js` 内，`grep -o 'requires options\.\(id\|key\|select\)'`）：`slot "${name}" requires options.id` / `.key` / `.select` | OK（无新增） | `list` 需 `id`、`keyed` 需 `key`、`chain` 需 `select`；插件的三种注册都满足，无需改 |
| 37 | 注册选项 `locale` 是否必须已注册 NS | 插件**未**传 `locale` | `dsh-client-ui-renderer/lib/client.js:742-745` 仅在 `entry.locale !== void 0` 时才要求 locale 面存在；`:542-557` `localeSeat` → `face.bind(ns)`；`dsh-client-locale/lib/client.js:1414-1427` `bind(ns)` 不抛错，`translate` 依次回退 `ns` → `common` → **key 本身** | OK（可选） | "必须预注册 NS"不成立；不传 `locale` 完全合法，只是拿不到宿主 `t` |
| 38 | `renderSlot` 对 slot 的渲染可见性（三个关键锚点） | `client.js:6896` `shell.overlay`；`client.js:6896` `conversation.input.dock`；`client.js:6908-6911` `settings.plugins.tab` | `dsh-client-ui-layout/lib/client.js:313` `renderSlot("shell.overlay", {})`；`dsh-client-ui-conversation/lib/client.js:17909` `renderSlot("conversation.input.dock")`（另有 `:19255` left / `:19263` right / `:19347` composer.dock）；`dsh-client-ui-settings-plugins/lib/client.js:68` 与 `:124` `renderSlot("settings.plugins.tab")` | OK | 声明 + 渲染点都在，不是"声明了但不渲染"的空挂载点 |

---

## 发现的问题

### 阻断（会导致插件不可用）

**D0（阻断：仅"桌面端原生右侧栏"承载面）. tab body 取不到自己的 `cardId`，卡片必然被兜底移到 flow**

- 插件侧证据：
  - `client.js:7082-7083` `function CardHost({ props }) { … const cardId = props?.tab?.meta?.cardId` —— 从 slot props 的 `tab.meta` 取。
  - `client.js:6984-6988` pane.tab 注册为 `{ name:'sidebar.right.pane.tab', key: CARD_KIND, inject: sessionId => ({ sessionId }) }`，组件 `(props) => h(CardHost, { props, actions })`。
  - `client.js:7087-7101` 渲染证明仅在 `cardId` 为非空字符串时才 `renderedCardId = cardId` 并清除定时器。
  - `client.js:6134-6144` 600ms 后若 `renderedCardId !== card.id` → `store.set({surface:'flow', surfaceNote:t('surfaceUnproven')})` + `patchCard(...)` + `toast(...)`。
- DSH 0.2.1-rc.3 侧证据（三条独立事实，互相印证）：
  1. tab 记录无 `meta`：`dsh-client-ui-sidebar-right/lib/client.js:787-794` `{ id: tabId, kind, contentId, title }`；全树 `grep -c "tab\.meta"` = **0 命中**。
  2. slot props 无 `tab`：`:1378-1403` `TabSlot` 以 `renderSlot(seat, {}, { entryKey, fallback, hookContext })` 渲染，第二参固定 `{}`；`tab` 也不在 `hookContext` 里。
  3. 唯一合法来源是 `useTabInfo()`：`:4856-4890` `tabInfoFactory` 返回 `useTabInfo()` → `{ sidebar, panel, tab: { ...tabRecord, visible, navigation, signal, actions, refreshShortcut } }`；`README.md:93` 明确 `params` 以 `navigation.params` 到达 body。内置实现全部如此：`dsh-client-ui-plan/lib/client.js:178-182`、`dsh-client-ui-schedule/lib/client.js:6098`、`dsh-client-ui-deliverables/lib/client.js:1794-1795`。
- 影响：原生右栏（`sidebarRight` 路径）每次打开卡片 → 先渲染 `cardClosed` 兜底脸（`client.js:7103-7108`）→ 600ms 后卡片被移到内置浮层 flow 并 toast「目标承载面未真正渲染该卡片」。**不崩、不丢数据**（卡片数据在 store，流仍在 flow 里继续），但该承载面等于不可用，且用户会看到一条误导性的失败提示。
- 修复建议（择一，推荐 A）：
  - A. `CardHost` 内改取 `props.useTabInfo`：`const { tab } = props.useTabInfo(); const cardId = tab?.navigation?.params?.cardId`，保留 `props?.tab?.meta?.cardId` 作为旧版回退。注意 **hook 必须在任何 early return 之前调用**（现有 `React.useEffect` 顺序约束不变）。
  - B. 其余不变，另在 `openTab` 时给每张卡一个可解析的 `contentId`/address（如 `dsh-resource://…` 或把 `cardId` 编进 `kind`），body 侧从 `tab.contentId` 反解。此改法还能顺手解决 N4 的"单 kind 单 tab 互相覆盖"。
  - C. 若短期不想改：把原生右栏注册整体关掉（`surfaces.native` 直接置不可用），避免 600ms 兜底 toast 与 `cardClosed` 闪脸，让卡片稳定落在 flow。
- 附带提示：`inject: sessionId => ({ sessionId })` 在 keyed 的 `pane.tab` 槽上没有先例依据（内置注册此处均为零参 `inject`，如 `dsh-client-ui-schedule/lib/client.js:7459`、`dsh-client-ui-deliverables/lib/client.js:2315`）；它本身无害（sessionId 确实会被传入），但并非恢复 cardId 的正确方向。

其余：client.js 在 0.2.1-rc.3 下可完整加载、注册 slot、渲染 UI（与 Lead 侧实测 `/plugins/??dsh-sidecard-ask/client.js&rev=…` 200 / 369873 B 一致），浮层 / 输入区 / 设置页三条承载面均可用。

### 降级（功能可用但行为退化）

**D1. 界面语言切换不再生效（i18n 快照字段改名）**
- 证据：`client.js:6749` 读 `snapshot?.locale ?? snapshot?.id ?? locale.getLocale()?.locale`；`dsh-client-locale/lib/client.js:1443-1448` 快照只有 `{active, locales, revision}`，且服务无 `getLocale`。
- 影响：用户在 DSH 设置里把界面语言从中文切到英文，插件文案仍是旧语言；刷新后由 `navigator.languages`（`client.js:1124-1127`）决定，与宿主设置可能长期不一致。
- 修复：把 `client.js:6749` 的取值改为 `snapshot?.active`（回退顺序建议 `snapshot?.active ?? snapshot?.locale ?? null`），保留现有 `resolveLanguage([id],'en')` 归一化。这是**一处一行**的改动。

**D2. 从卡片内关闭卡片无效（`closeTab` 不存在）**
- 证据：`client.js:2248-2251`；控制器方法全集无 `closeTab`（`dsh-client-ui-sidebar-right/lib/client.js:2226-2594`）。
- 影响：关闭按钮/快捷键路径静默返回 `false`，用户只能通过轨道自带的关闭 UI 关闭。功能不崩，但交互承诺未兑现。
- 修复：`const tabs = controller.tabsIn(sessionId)` 找到目标 `tabId` 后调 `controller.closeIn(sessionId, tabId)`；或在 `registry` 上按 `kind` 注册关闭处理（同包 `:2194 registerCloseHandler(kind, handler)` 是 0.2.1-rc.3 提供的钩子，值得优先评估）。

### 提示（不阻断，可择机处理）

**N1. `.rightbar` 选择器已失效**
`client.js:427`、`:4655`。0.2.1-rc.3 中 `rightbar` 只是插槽名，面板根类名是哈希。建议替换为 `[data-slot="sidebar.right.session"]`（或直接删除该 rung，主链已足够）。

**N2. `[data-dsh-panel-host]` 在 0.2.1-rc.3 全树 0 命中**
`client.js:2427`（注释）、`:4655`（选择器）。建议删除或改为 `[data-slot^="sidebar.right"]`。

**N3. `betterSidebar` / `conversation` 服务不存在，两条分支是死路**
`client.js:7038`、`:2181`。当前是 capability-probed + try/catch，**不会报错**，但也不要再把它写进 README 的"支持路径"。若未来要对接，请以服务目录实际存在为前提。

**N4. 单 kind 单 tab：多张卡片会互相覆盖 `params`**
`pageAddress(kind)` 使同一 `kind` 只有一个页面地址，`client.js:2239` 每次 `openTab(CARD_KIND,{params:{cardId}})` 会覆盖上一张卡片的 `params`。若插件 UI 期望"多张卡片并存于轨道"，行为会与预期不符（表现为切卡而非并存）。**这与 D0 是同一处设计的两面**：修 D0 时若选方案 B（把 cardId 编进 contentId/address），可同时解决并存问题。

**N5. 插件注释与事实不符（准确性提示）**
`client.js:2244` 注释称"since 0.2.0 the rail controller exposes `closeTab`"。0.2.1-rc.3 证据显示控制器**没有** `closeTab`。该注释会误导后续维护者，建议更正为实际存在的 `closeIn/closeTarget`。

**N6. `<style>` 归属时机**
框架只认领工厂执行期间注入的 `<style>`（`dsh-client-modules/lib/client.js:617-630`）。插件若在组件副作用里重复插入 `<style>`，卸载时可能残留。建议一次性在工厂阶段注入，并保留现有 disposer 清理。

---

## 未能验证的点

1. **类型契约（`.d.ts`）**：解包产物内无任何 `.d.ts`（`find … -name "*.d.ts"` 命中 0），`package.json` 的 `exports.types` 指向的 `lib/types/client/index.d.ts` 未随包解出。因此"接口声明层面"（`ISidebarRight`、`SlotMap` 的类型键名）无法直接核对，本报告的 slot key 与签名结论全部来自运行时源码与前端 bundle 的实际代码行。搜索词：`find . -name "*.d.ts"`、`grep -rn "interface ISidebarRight"`。
2. **运行时实测**：本次为静态代码审计；未在运行中的 Web GUI（http://127.0.0.1:14582）里实际验证"切换语言后插件文案是否刷新""卡片关闭按钮是否无反应""原生右栏是否每张卡都退回 flow"。结论基于代码路径推断。D0 的证据链是静态闭合的（无 `meta` 字段 + slot props 无 `tab` + 内置全走 `useTabInfo`），但仍建议在桌面端实测一次：打开一张卡 → 观察是否出现 `cardClosed` 兜底脸与「目标承载面未真正渲染该卡片」toast。
3. **`betterSidebar` 是否为未来的可选第三方服务**：当前 `@deepseek-ai/` 目录下无同义包，也未在服务目录中出现；无法排除由外部插件提供。
4. **`settings.plugins.tab` 的实际可见性**：该 slot 是 `settings.plugins` 的 `children`，声明时机依赖插件页渲染；插件有 `inject` 等待机制，但"用户从未打开插件设置页时该挂载点是否长期缺失"未做运行时观测（不影响主挂载点 `settings.section`）。
5. **`data-dockkit-*` 的浮窗家族（`data-dockkit-float`）**：0.2.1-rc.3 新增，插件阶梯完全未覆盖；未验证浮窗态下插件的区域/定位兜底是否仍然可用。
6. **盒模型/样式实测**：未做像素级渲染核对，`--dsw-alias-*` token 只验证了"存在"，未验证取值在浅/深色主题下的对比度表现。
