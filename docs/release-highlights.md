# 发布要点与命名历史

本文件是从 [`README.md`](../README.md) 搬出来的两段"开场自述"：

1. **1.4.0 → 1.8.4 的四段「增强一览」** —— 它们描述的功能早已稳定，留在 README 开头只会
   让第一次打开仓库的人先读四段历史，才能看到"怎么装、怎么用"。
2. **两次改名的原因** —— 这段要留着（换个名字就会重新撞名的教训），但不该占据首屏。

当前版本的变更请看 [`CHANGELOG.md`](../CHANGELOG.md)；安装与使用回到 [`README.md`](../README.md)。

> 事实核对：本文件内容与搬出前逐字一致，未做改写。若与 CHANGELOG 冲突，以 CHANGELOG 为准
> —— 它是按版本维护的，这里只是把当年的"宣布"归档。

---

**1.8.4 增强一览**（详见 CHANGELOG）：选区旁的动作条不再「六枚等价胶囊排成一排」——改成**一块面板 + 一个主操作**：
品牌实底按钮「追问选中内容」、一条细分隔线、五个无边框文字胶囊（hover 才浮出底色），深色主题把主按钮
的字改成深墨色（白字在深色品牌上只有 2.79:1）；宽度也改成按「视口宽 − 面板左边 − 8」算，
放不下就换行，不再被窗口右边缘切掉。见 [README §4.3](../README.md#四配置项说明表)。

**1.8.0 增强一览**（P2，详见 CHANGELOG）：**回答风格档位**（`answerStyle` 精简/标准/详细）
与 ≤500 字的自定义指令；改写类答案可**写回主对话输入框**（先做了真实页面探针，走官方
`inputActions.insertText`，DOM 路径退化为 `beforeinput` 追加）；卡片与历史条目可**查看原文**
（码点签名反查 + CSS Custom Highlight 高亮，找不到会明说）；可选的**模型建议追问**芯片
（`<followups>` 块，宽容解析，不额外发请求）；**导出 .md**（单卡 / 全部）与**多版本答案**
（localStorage 升到 v3，v1/v2 非破坏式迁移）。

**1.5.0 增强一览**（详见 CHANGELOG）：内置浮层不再压住主对话——宽度改由纯函数 `floatPlacement`
按「对话区右侧可用带宽」计算（旧实现是固定 400px，在用户截图上压入正文约 113px）；浮层默认是**一行高的胶囊**，
可随时「收起为胶囊」，运行时的形态切换不写回配置；卡片标题栏右侧的 `×` 自 2.0.0 起是**删除这条追问对话**
（连同追问历史一起删），不再是隐藏浮层；新增 `floatMode`（默认 `capsule`）与
`floatMaxWidth`（默认 340）两项设置；卡片阴影减半。

**1.4.0 增强一览**（详见 CHANGELOG）：卡片**思考过程**（reasoning）可折叠展示并随答案流式渲染；
**已完成卡片写入 localStorage，刷新页面不丢**；答案渲染扩展链接/斜体/引用/表格；流式输出自动滚动到底；
设置页补齐 `sideTimeoutMs` / `sideProvider` 控件；原生右侧栏 tab 可关闭（不再残留空壳；该能力在
0.2.1-rc.3 上一度因控制器无 `closeTab` 而失效，2.1.2 改用 `closeIn` 修复）；
界面语言解析支持 `navigator.languages` 优先级回退，英文界面显示英文错误文案；
长答案的流式增量按 50ms 窗口合并提交（避免整卡重渲染的二次方开销）。

## 名字改过两次，原因都写在这里（避免再撞名）

1. **`dsh-selection-ask` → ✗**：npm 上已被 `chestnut23` 占用（仓库 `lzbaclz/dsh-selection-ask`）。
2. **`dsh-selection-followup` → ✗**（1.0.0 / 1.0.1 用的名字）：npm 上当时是空的，但 **DSH 插件生态里已被 `zzx-dear` 使用**——
   GitHub 仓库 [`zzx-dear/dsh-selection-followup`](https://github.com/zzx-dear/dsh-selection-followup) 与官方收录索引
   `data/plugins/zzx-dear__dsh-selection-followup.yml`（category: ui，早于本插件约 20 天）。
   我最初只查了 npm 名字是否可用，**漏查了 GitHub 仓库名与收录索引**，这是本项目的失误，已在 1.1.0 修正。
3. **`dsh-sidecard-ask` → ✓**（1.1.0 起）：npm 无同名包、GitHub 无同名仓库；
   同时它与已有的 8 个"选中文字→引用进输入框/翻译/批注"类插件（`dsh-selection-ask`、`dsh-selection-explain`、
   `dsh-selection-toolbar`、`dsh-quote-selection`、`dsh-ui-quote-selection`、`dsh-quote-annotate`、
   `dsh-selection-memory`、`dsh-plugin-followup`）在**名字与定位上都区分开**：本插件的答案是**独立子代理在侧边卡片里流式产出**，
   而不是把选中内容塞进输入框。

旧 npm 包名 `dsh-selection-followup` 已 `npm deprecate` 指向新名字；升级只需卸旧装新（见 [README §三](../README.md#三安装与启用)）。
