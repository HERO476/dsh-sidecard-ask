/**
 * dsh-sidecard-ask — Client half (`dsh.client.platform = web`).
 *
 * Browser artifact: registers one lazy factory whose id equals the package
 * name. React comes from the browser module table (`require('react')`); this
 * file imports NOTHING else, and it is plain JavaScript on purpose — no build
 * step, no bundler, no client package.
 *
 * Layout of this file:
 *   §1  constants, defaults, dictionaries
 *   §2  i18n (own dictionary + optional `locale` service)
 *   §3  wire client (JSON + SSE against the Host half)
 *   §4  module store (one observable state for every surface)
 *   §5  selection engine (read, classify, place, dedupe)
 *   §6  carriers (main conversation / independent side card)
 *   §7  side-card surfaces (native right sidebar → better-sidebar → own flow)
 *   §8  view helpers (markdown-lite renderer, styles, small controls)
 *   §9  components (overlay root, cards, settings page, session probe)
 *   §10 plugin face (apply + registrations)
 *
 * Test seam: the returned module carries `api.pure`, a frozen bag of the pure
 * helpers above. The DSH client runtime only reads `inject`/`apply`; the test
 * harness in `test/` loads this file with a synthetic `window` to exercise
 * them without a browser.
 */

window.__ModuleLoader__.load({
  id: 'dsh-sidecard-ask',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ─────────────────────────────────────────────────────────────────────
    // §1 constants and defaults
    // ─────────────────────────────────────────────────────────────────────

    const PLUGIN_ID = 'dsh-sidecard-ask'
    const API = '/sidecard-ask/api'
    /** Slot ids contributed by this plugin (also the overlay entry ids). */
    const IDS = {
      overlay: 'sidecard-ask',
      settings: 'sidecard-ask-settings',
      sessionProbe: 'sidecard-ask-session-probe',
    }
    /**
     * Version of this Client half. Single source of truth: the self-report to
     * the Host and the module's `api.version` both read it, so a report can
     * never claim a generation the browser is not actually running.
     */
    const CLIENT_VERSION = '1.8.1'

    /**
     * Tab kind served by the DSH native right rail (also its implementation id).
     */
    const CARD_KIND = 'sidecard-ask:card'

    /**
     * Tab type served by the dsh-better-sidebar plugin.
     *
     * It MUST differ from {@link CARD_KIND}: better-sidebar mirrors every tab
     * descriptor it is given into the SAME native registry
     * (`sidebarRightTabs.register`, id `dsh-better-sidebar:<id>`, band
     * `extension`), and that registry THROWS when a kind already has a
     * registration in the same band ("Everything else colliding on a kind
     * throws"). Sharing one kind made the two adapters collide: whichever
     * registered second failed — observed live on 0.2.0-rc.1, where the pane
     * listed `dsh-better-sidebar:sidecard-ask:card` and no native
     * `sidecard-ask:card` at all. `test/contract-test.mjs` now emulates that
     * registry rule so the collision cannot come back.
     */
    const CARD_KIND_BETTER = 'sidecard-ask:card:workbench'

    /**
     * How many earlier turns of a card ride the next ask payload. Mirrors the
     * Host's own cap (contract-asserted): the Host trims to the same number,
     * so sending more would only be dead wire weight.
     */
    const HISTORY_TURNS = 6

    /**
     * Client-side mirror of the Host `DEFAULT_CONFIG`. The client needs values
     * before `/state` answers (first paint) and when the Host is unreachable;
     * `test/contract-test.mjs` asserts this mirror stays identical to the
     * Host's own defaults.
     */
    const CLIENT_DEFAULTS = {
      trigger: 'selection',
      defaultCarrier: 'side',
      sideSurface: 'auto',
      maxChars: 4000,
      shortcut: 'Alt+Q',
      captureZones: 'auto',
      showInUnclassified: true,
      minChars: 2,
      maxConcurrentAsks: 3,
      sideTools: 'readonly',
      sideTimeoutMs: 180000,
      sideProvider: 'auto',
      floatMode: 'capsule',
      floatMaxWidth: 340,
      // Mirrors the Host's DEFAULT_CONFIG.quickActions (contract-asserted):
      // `builtin:*` entries are resolved through QUICK_ACTION_BUILTINS, while
      // custom entries (no builtin prefix) carry their own label/question.
      quickActions: [
        { id: 'builtin:explain', enabled: true, shortcut: '' },
        { id: 'builtin:translate', enabled: true, shortcut: '' },
        { id: 'builtin:summarize', enabled: true, shortcut: '' },
        { id: 'builtin:polish', enabled: true, shortcut: '' },
        { id: 'builtin:fix', enabled: true, shortcut: '' },
      ],
      notifyOnDone: false,
      contextMenu: true,
      historyMaxCards: 10,
      // 1.8.0 P2-1: answer detail/tone. `standard` keeps the 1.7.x persona.
      answerStyle: 'standard',
      customPersona: '',
      // 1.8.0 P2-4: model-written follow-up chips (opt-in).
      followUpSuggestions: false,
    }

    /**
     * Bounds for quick-action editing, mirrored by the Host validator. The
     * settings page refuses anything outside these before it ever posts.
     */
    const QUICK_ACTION_LIMITS = {
      maxEntries: 12,
      idLength: 40,
      labelLength: 20,
      questionLength: 500,
      shortcutLength: 40,
    }

    /**
     * Built-in quick actions. The config list only carries `builtin:<id>`;
     * the localized label and question live HERE so the wire/config layers
     * stay language-neutral. Questions are instructions only — the Host
     * fences the selection separately, so none of them needs to quote text.
     */
    const QUICK_ACTION_BUILTINS = {
      'builtin:explain': { labelKey: 'qaExplain', questionKey: 'qaExplainQ' },
      'builtin:translate': { labelKey: 'qaTranslate', questionKey: 'qaTranslateQ' },
      'builtin:summarize': { labelKey: 'qaSummarize', questionKey: 'qaSummarizeQ' },
      'builtin:polish': { labelKey: 'qaPolish', questionKey: 'qaPolishQ' },
      'builtin:fix': { labelKey: 'qaFix', questionKey: 'qaFixQ' },
    }

    /**
     * Fixed follow-up chips offered under a finished answer. They submit a
     * follow-up TURN (the answer stays in history), so the questions refer to
     * "the answer above" rather than restating the selection. Not user
     * configurable in P1: they are four fixed, universally useful refinements.
     */
    const FOLLOW_UP_CHIPS = [
      { labelKey: 'fuShorter', questionKey: 'fuShorterQ' },
      { labelKey: 'fuLonger', questionKey: 'fuLongerQ' },
      { labelKey: 'fuExample', questionKey: 'fuExampleQ' },
      { labelKey: 'fuToEnglish', questionKey: 'fuToEnglishQ' },
    ]

    /** Resolve the fixed follow-up chips for the active language. */
    function followUpChips() {
      return FOLLOW_UP_CHIPS.map(meta => ({ label: t(meta.labelKey), question: t(meta.questionKey) }))
    }

    /**
     * Format a side-answer elapsed time for the card meta line. Sub-second
     * runs show as "<1s"; everything else rounds to whole seconds (and whole
     * minutes past 60s). Pure so both the UI and the tests share one format.
     * @param {number} ms - elapsed milliseconds.
     * @returns {string}
     */
    function formatElapsed(ms) {
      const value = Number(ms)
      if (!Number.isFinite(value) || value < 0) return ''
      if (value < 1000) return '<1s'
      const seconds = Math.round(value / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`
    }

    /**
     * Deterministic local timestamp for the history manager: `YYYY-MM-DD
     * HH:MM`. Returns '' for an absent/legacy entry (v1 entries had no
     * createdAt) instead of showing 1970.
     * @param {number} ts - epoch milliseconds.
     * @returns {string}
     */
    function formatHistoryTime(ts) {
      const value = Number(ts)
      if (!Number.isFinite(value) || value <= 0) return ''
      const date = new Date(value)
      const pad = n => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** Zone classification: slot-key patterns the harness itself renders. */
    const ZONE_PATTERNS = {
      chat: [/^conversation\b/],
      task: [/\btask/i, /\btodo/i, /\bschedule/i, /\bteam/i, /\bjob/i, /\bplan/i, /^rightbar\b/, /^sidebar\.right\b/],
    }

    // ─────────────────────────────────────────────────────────────────────
    // §1b floating-layer (A) geometry
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Placement rules for the floating layer, mirrored by
     * `test/float-placement.mjs`.
     *
     * The layer is anchored to the FRAME's right edge, so it can only ever
     * grow LEFT into the conversation column. Everything here exists to stop
     * that: the layer may use the strip to the right of the conversation
     * column's right boundary (where the right rail lives), but it never
     * crosses that boundary while there is at least `minWidth` of room.
     */
    const FLOAT_GAP_RIGHT = 8
    const FLOAT_GAP_SIDEBAR = 10
    const FLOAT_MIN_WIDTH = 240
    const FLOAT_MAX_WIDTH_LIMIT = 560

    /**
     * The floating layer's width for one frame.
     *
     * Pure (no DOM) so both the runtime and the tests can call it:
     * `avail` is the distance from the conversation column's right boundary to
     * the frame's right edge, minus the right rail when one is present. The
     * boundary is treated as un-crossable while `avail >= minWidth`; below that
     * the layer gives up and clamps to `minWidth` (a pill narrower than that is
     * unusable), which is the only case where it may overlap the column.
     *
     * @param {object} input - `frameWidth`, `laneRight`, `railLeft`, `maxWidth`.
     * @returns {{width: number, avail: number, capped: boolean, bleeds: boolean}}
     */
    function floatPlacement({ frameWidth, laneRight, railLeft = null, maxWidth = CLIENT_DEFAULTS.floatMaxWidth }) {
      const frame = Number.isFinite(frameWidth) ? frameWidth : 0
      const lane = Number.isFinite(laneRight) ? laneRight : 0
      const cap = Math.min(
        FLOAT_MAX_WIDTH_LIMIT,
        Math.max(FLOAT_MIN_WIDTH, Number.isFinite(maxWidth) ? maxWidth : CLIENT_DEFAULTS.floatMaxWidth),
      )
      let avail = frame - FLOAT_GAP_RIGHT - lane
      if (Number.isFinite(railLeft)) avail = Math.min(avail, frame - railLeft - FLOAT_GAP_SIDEBAR)
      avail = Math.max(FLOAT_MIN_WIDTH, Math.floor(avail))
      const width = Math.min(cap, avail)
      // Left edge of a right-anchored layer of this width.
      const left = frame - FLOAT_GAP_RIGHT - width
      return { width, avail, capped: width < cap, bleeds: lane - left > 1 }
    }

    // ─────────────────────────────────────────────────────────────────────
    // §2 i18n
    // ─────────────────────────────────────────────────────────────────────

    const DICT = {
      zh: {
        triggerLabel: '追问选中内容',
        triggerHint: '点击用 AI 追问这段文字',
        askTitle: '追问选中内容',
        askPlaceholder: '想就这段内容问什么？（Enter 发送，Shift+Enter 换行）',
        askSubmit: '提问',
        askCancel: '取消',
        askShortcutHint: '快捷键 {key} 可随时唤起',
        carrier: '作答位置',
        carrierMain: '主对话',
        carrierSide: '侧边卡片',
        carrierMainHint: '在主对话里提问，答案随对话正常流式呈现',
        carrierSideHint: '独立子代理作答，不打扰主对话',
        zoneChat: '聊天区',
        zoneTask: '任务区',
        zoneOther: '其它区域',
        zoneCross: '跨区选择',
        chars: '{n} 字',
        truncatedBadge: '已截断 {n} 字',
        selectionEmpty: '没有选中文本',
        selectionTooShort: '选中文本太短，未触发追问',
        answerTitle: '追问',
        answerStreaming: '作答中…',
        answerDone: '已完成',
        answerStopped: '已停止',
        answerNonStreaming: '当前 DSH 版本未提供流式帧，答案一次性返回',
        answerEmpty: '（没有内容）',
        cardClosed: '该卡片已关闭',
        cardMovedToFlow: '该卡片已移至浮层显示',
        reasoningTitle: '思考过程',
        copy: '复制',
        copied: '已复制',
        copySelectedHint: '已选中答案文本，请按 Ctrl+C 复制',
        copyFailed: '复制失败，请手动选择',
        close: '关闭',
        followUp: '继续追问',
        followUpPlaceholder: '继续问下去…',
        retry: '重试',
        sendToMain: '改到主对话',
        cancelAnswer: '停止作答',
        mainSent: '已发送到主对话',
        mainSentHint: '答案会出现在主对话里，随对话正常流式输出。',
        draftInserted: '已填入输入框',
        draftInsertedHint: '主对话发送接口不可用，已把追问内容放进输入框，请按 Enter 发送。',
        noMainCarrier: '主对话发送接口不可用：既不能提交消息，也不能写入输入框',
        errorTitle: '作答失败',
        errorNoSideEngine: '这台 DSH 组合没有可用的子代理，无法在侧边卡片作答；可以改到主对话提问。',
        errorTooLarge: '请求体过大',
        errorBadRequest: '请求无效（问题或选中文本为空）',
        errorUnloaded: '插件正在卸载，无法受理新的追问',
        errorDuplicate: '该追问已在处理中，请等它完成',
        errorBusy: '并发追问已达上限（{n}），请稍后再试',
        errorNoSideEngineBody: '这台 DSH 组合没有可用的子代理 provider',
        errorNoParentBody: '当前没有活动的会话代理，无法发起独立作答',
        errorAborted: '作答被取消或超时',
        errorUnreachableBody: '宿主接口不可达',
        errorBadResponseBody: '宿主返回了无法解析的响应',
        errorStreamBrokenBody: '流式连接中断',
        errorStreamEndedBody: '流式连接意外结束',
        surfaceFlow: '浮层卡片',
        surfaceNative: '右侧栏卡片',
        surfaceBetter: '侧边卡片插件',
        surfaceFellBack: '请求的侧边面不可用，已回退到{name}',
        surfaceUnproven: '目标承载面未真正渲染该卡片，已回退到内置浮层卡片',
        settingsTitle: '划词追问',
        settingsDesc: '选中聊天或任务里的文本，就地追问。',
        setTrigger: '触发方式',
        setTriggerSelection: '选中即出现按钮',
        setTriggerShortcut: '仅快捷键',
        setTriggerBoth: '按钮 + 快捷键',
        setCarrier: '默认作答位置',
        setSurface: '侧边卡片承载面',
        setSurfaceAuto: '自动选择',
        setSurfaceFlow: '内置浮层卡片',
        setMaxChars: '最大字符数',
        setMaxCharsHint: '超过部分截断并在提问中标注',
        setFloatMode: '浮层默认形态',
        setFloatModeCapsule: '胶囊（不遮挡对话，可随时展开）',
        setFloatModeFull: '直接展开成卡片',
        setFloatModeOff: '关闭浮层（只留小圆点）',
        setFloatModeHint: '浮层贴右侧边缘，只在空间不足时才可能压到对话区',
        setFloatMaxWidth: '浮层宽度上限（px）',
        setFloatMaxWidthHint: '空间不足时自动收窄，不会硬顶',
        floatExpand: '展开侧边卡片',
        floatCollapse: '收起为胶囊（不遮挡对话）',
        floatHide: '隐藏浮层（只留小圆点）',
        floatRestore: '恢复浮层',
        floatCount: '{n} 条追问回答',
        floatStreaming: '正在作答…',
        floatDone: '已完成 {n} 条',
        setShortcut: '快捷键',
        setZones: '捕获区域',
        setZonesAuto: '全部区域',
        setZonesChat: '仅聊天区',
        setZonesTask: '仅任务区',
        setZonesBoth: '聊天区 + 任务区',
        setUnclassified: '未归类区域也触发',
        setMinChars: '最小触发字符数',
        setConcurrency: '并发作答上限',
        setSideTools: '侧边作答工具权限',
        setSideToolsReadonly: '只读（推荐）',
        setSideToolsInherit: '继承当前会话',
        setSideTimeout: '侧边作答超时（毫秒）',
        setSideTimeoutHint: '超过该时间未完成即停止作答',
        setSideProvider: '子代理 provider',
        setSideProviderHint: 'auto = 自动挑选已注册的 provider',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败：{msg}',
        reset: '重置为 patch 配置',
        resetDone: '已重置',
        diagnostics: '运行自检',
        diagTitle: '能力自检',
        diagHost: '宿主接口',
        diagSide: '侧边作答引擎',
        diagProviders: '子代理 provider',
        diagAgents: '活动会话代理',
        diagSurface: '当前侧边承载面',
        diagSession: '已识别会话',
        diagZones: '区域锚点（data-slot）',
        diagZonesMissing: '缺失，区域过滤已停用',
        diagSlots: '槽位落点',
        diagSidecard: '侧边卡片插件（dsh-better-sidebar）',
        diagFeatures: '项能力',
        diagNoTabMeta: '版本过旧：没有 tabMeta 能力，已跳过它改用其它承载面',
        diagNativeKind: 'kind',
        toolGuardUnavailable: '该 provider 不支持工具白名单，本次作答继承了当前会话的工具',
        toolGuardInherited: '按配置继承当前会话的工具',
        diagUnreachable: '宿主接口不可达：{msg}',
        yes: '可用',
        no: '不可用',
        none: '无',
        unsupportedTrigger: '无法识别该快捷键，请用形如 Alt+Q / Ctrl+Shift+K 的写法',
        surfaceUnavailable: '所选侧边承载面不可用',
        familySuppressed: '检测到同系列更新版本（{version}）已在本页运行，本实例已自动停用划词触发与快捷键，界面由更新版本接管。建议在插件页卸载本旧版本。',
        familyLegacyToast: '检测到旧版 dsh-selection-followup 同时启用，已由本版本接管；建议卸载旧包',
        familyLegacyDiag: '旧版共载',
        familyPeers: '同页实例',
        retryEdit: '改问',
        editQuestionPlaceholder: '修改问题后重新提问…',
        retryAskSubmit: '重新提问',
        copyCode: '复制代码',
        qaExplain: '解释',
        qaExplainQ: '请用简洁的语言解释这段内容的含义。',
        qaTranslate: '翻译',
        qaTranslateQ: '请把这段内容翻译成中文；如果原文已经是中文，则翻译成英文。只输出译文，不要加解释。',
        qaSummarize: '总结',
        qaSummarizeQ: '请用简短的要点总结这段内容。',
        qaPolish: '润色',
        qaPolishQ: '请润色这段文字：保持原意、修正语病与不通顺之处，只输出润色后的内容。',
        qaFix: '纠错',
        qaFixQ: '请检查这段内容中的事实性、逻辑性与文字错误，逐条列出问题并给出修正建议。',
        setQuickActions: '快捷动作',
        setQuickActionsHint: '选中文字后显示的一键动作。自定义问题中的 {selection} 会替换为选中内容；不写占位符时，原文会随问题自动附上。',
        qaEnabled: '启用',
        qaAdd: '＋ 添加动作',
        qaDelete: '删除',
        qaBuiltinBadge: '内置',
        qaLabelPlaceholder: '动作名称（如：英译中）',
        qaQuestionPlaceholder: '问题指令，可用 {selection} 引用选中内容',
        qaShortcutPlaceholder: '如 Alt+T，留空表示无快捷键',
        qaTooMany: '快捷动作最多 {n} 条',
        qaMalformed: '存在格式不正确的动作',
        qaBadId: '动作 id 缺失或超长',
        qaDuplicateId: '存在重复的动作 id',
        qaBadLabel: '动作名称必填，且不超过 {n} 个字符',
        qaBadQuestion: '问题指令必填，且不超过 {n} 个字符',
        qaBadShortcut: '“{label}”的快捷键格式不正确，请用 Alt+Q 这样的写法',
        qaDuplicateShortcut: '“{label}”的快捷键与“{other}”冲突',
        fuShorter: '更简短',
        fuShorterQ: '请用更简短的方式重新回答上面的问题，保留关键信息。',
        fuLonger: '更详细',
        fuLongerQ: '请更详细地展开回答上面的问题，补充必要的细节。',
        fuExample: '举个例子',
        fuExampleQ: '请结合一个具体的例子来说明上面的回答。',
        fuToEnglish: '译成英文',
        fuToEnglishQ: 'Please give the same answer in English.',
        metaElapsed: '耗时',
        metaProvider: '模型',
        setNotifyOnDone: '完成后桌面通知',
        setNotifyOnDoneHint: '仅当页面切到后台（其它标签页或窗口）时，作答结束才弹系统通知；首次启用需要浏览器通知权限',
        notifyGranted: '已获得通知权限',
        notifyDenied: '通知权限被拒绝，可在浏览器站点设置中开启',
        notifyUnsupported: '当前环境不支持系统通知',
        notifyDoneTitle: '侧边追问已完成',
        notifyErrorTitle: '侧边追问失败',
        setContextMenu: '选区右键菜单',
        setContextMenuHint: '在可触发区域右键选中文字时，菜单顶部显示追问与快捷动作；若与宿主自身右键菜单冲突可关闭',
        setFollowUps: '答案末尾给出建议追问',
        setFollowUpsHint: '开启后模型会用 <followups> 块在答案末尾给出 2–3 个可点的下一步问题，点一下即追问（不额外发请求）',
        setHistoryMax: '历史卡片保存数量',
        setHistoryMaxHint: '0 = 不保存；上限 50 张，单卡文本最多 64K',
        historyTitle: '历史追问卡片',
        historyDesc: '已完成的侧边卡片保存在本浏览器中，可搜索、恢复到浮层或删除；清空浏览器数据会一并删除。',
        historySearch: '搜索问题或答案…',
        historyEmpty: '还没有历史卡片',
        historyRestore: '恢复',
        historyDelete: '删除',
        historyClear: '清空全部',
        historyClearConfirm: '确定清空全部历史卡片吗？此操作不可撤销。',
        historyClearDone: '历史已清空',
        historyRestored: '已恢复到浮层',
        historyCount: '{n} 条',
        historyDeleted: '已删除',
        cardKeysHint: '键盘：R 重试 · C 复制 · Esc 取消聚焦',
        setAnswerStyle: '回答风格',
        setAnswerStyleHint: '控制答案的详略与展开程度；不会改变“用提问的语言作答”这条规则',
        setAnswerStyleConcise: '精简（只给最小完整答案）',
        setAnswerStyleStandard: '标准（默认）',
        setAnswerStyleDetailed: '详细（必要时展开并给出依据）',
        setCustomPersona: '自定义指令',
        setCustomPersonaHint: '追加在风格档位之后，随每次提问一起发送；≤{n} 字',
        setCustomPersonaPlaceholder: '例如：尽量给出可验证的来源；不要用表格',
        locate: '查看原文',
        locateHint: '回到页面里这段原文的位置并高亮',
        locateNotFound: '原文已变化或不在当前视图',
        locateUnsupported: '当前环境不支持定位（拿不到页面文本节点）',
        exportMd: '导出 .md',
        exportAllMd: '导出全部 .md',
        exportEmpty: '没有可导出的内容',
        exportFailed: '导出失败：浏览器不允许下载',
        insertToComposer: '插入到输入框',
        insertReplace: '替换原文',
        insertHint: '把这条改写结果放进主对话输入框（不改动已发送的消息）',
        insertDone: '已插入到输入框，请按 Enter 发送',
        insertStale: '输入框内容已变化，插入未生效，请重试',
        insertNoComposer: '找不到可写入的输入框',
        insertFailed: '插入失败，请手动复制',
        versionsLabel: '历史版本',
        versionN: '第 {n} 版',
        versionLatest: '返回最新',
        versionViewing: '正在查看历史版本（只读）',
        suggestionsLabel: '建议追问',
        familyLegacyDiag: '旧版共载',
        familyPeers: '同页实例',
      },
      en: {
        triggerLabel: 'Ask about selection',
        triggerHint: 'Ask AI about this text',
        askTitle: 'Ask about the selection',
        askPlaceholder: 'What do you want to ask? (Enter sends, Shift+Enter breaks a line)',
        askSubmit: 'Ask',
        askCancel: 'Cancel',
        askShortcutHint: 'Press {key} any time',
        carrier: 'Answer in',
        carrierMain: 'Main chat',
        carrierSide: 'Side card',
        carrierMainHint: 'Ask in the main conversation; the answer streams there as usual',
        carrierSideHint: 'A separate child agent answers, leaving the main chat untouched',
        zoneChat: 'Chat',
        zoneTask: 'Tasks',
        zoneOther: 'Elsewhere',
        zoneCross: 'Cross-region',
        chars: '{n} chars',
        truncatedBadge: 'truncated {n} chars',
        selectionEmpty: 'Nothing selected',
        selectionTooShort: 'Selection too short to trigger',
        answerTitle: 'Follow-up',
        answerStreaming: 'Answering…',
        answerDone: 'Done',
        answerStopped: 'Stopped',
        answerNonStreaming: 'This DSH build publishes no stream frames; the answer arrived at once',
        answerEmpty: '(empty)',
        cardClosed: 'This card was closed',
        cardMovedToFlow: 'This card moved to the floating stack',
        reasoningTitle: 'Reasoning',
        copy: 'Copy',
        copied: 'Copied',
        copySelectedHint: 'Answer selected — press Ctrl+C to copy',
        copyFailed: 'Copy failed — select the text manually',
        close: 'Close',
        followUp: 'Follow up',
        followUpPlaceholder: 'Ask again…',
        retry: 'Retry',
        sendToMain: 'Ask in main chat',
        cancelAnswer: 'Stop',
        mainSent: 'Sent to the main chat',
        mainSentHint: 'The answer appears in the main conversation and streams there.',
        draftInserted: 'Inserted into the composer',
        draftInsertedHint: 'The main-chat send API is unavailable, so the follow-up was placed in the composer — press Enter.',
        noMainCarrier: 'The main-chat send API is unavailable: neither submitting a message nor writing the composer draft worked',
        errorTitle: 'Answer failed',
        errorNoSideEngine: 'This DSH composition has no usable subagent, so the side card cannot answer; ask in the main chat instead.',
        errorTooLarge: 'The request body is too large',
        errorBadRequest: 'Invalid request (empty question or empty selection)',
        errorUnloaded: 'The plugin is unloading and cannot take new follow-ups',
        errorDuplicate: 'This follow-up is already being answered; wait for it to finish',
        errorBusy: 'Too many concurrent answers (limit {n}); try again shortly',
        errorNoSideEngineBody: 'This DSH composition has no usable subagent provider',
        errorNoParentBody: 'No active session agent to answer independently',
        errorAborted: 'The answer was cancelled or timed out',
        errorUnreachableBody: 'The host API is unreachable',
        errorBadResponseBody: 'The host returned an unreadable response',
        errorStreamBrokenBody: 'The stream connection broke',
        errorStreamEndedBody: 'The stream ended without a terminal event',
        surfaceFlow: 'Floating card',
        surfaceNative: 'Right rail',
        surfaceBetter: 'Sidebar plugin',
        surfaceFellBack: 'The requested surface is unavailable; fell back to {name}',
        surfaceUnproven: 'The target surface never rendered the card; fell back to the built-in floating card',
        settingsTitle: 'Selection Ask',
        settingsDesc: 'Select text in chat or tasks and ask about it in place.',
        setTrigger: 'Trigger',
        setTriggerSelection: 'Button on selection',
        setTriggerShortcut: 'Shortcut only',
        setTriggerBoth: 'Button + shortcut',
        setCarrier: 'Default answer carrier',
        setSurface: 'Side-card surface',
        setSurfaceAuto: 'Automatic',
        setSurfaceFlow: 'Built-in floating card',
        setMaxChars: 'Max characters',
        setMaxCharsHint: 'Longer selections are truncated and marked in the question',
        setFloatMode: 'Floating layer default',
        setFloatModeCapsule: 'Capsule (never covers the conversation)',
        setFloatModeFull: 'Expanded card stack',
        setFloatModeOff: 'Hidden (small launcher only)',
        setFloatModeHint: 'The layer is anchored to the right edge and only overlaps on very narrow frames',
        setFloatMaxWidth: 'Floating layer max width (px)',
        setFloatMaxWidthHint: 'Narrows automatically when there is not enough room',
        floatExpand: 'Expand the side cards',
        floatCollapse: 'Collapse to a capsule (stops covering the conversation)',
        floatHide: 'Hide the layer (leaves a small launcher)',
        floatRestore: 'Restore the floating layer',
        floatCount: '{n} follow-up answers',
        floatStreaming: 'Answering…',
        floatDone: '{n} done',
        setShortcut: 'Shortcut',
        setZones: 'Capture regions',
        setZonesAuto: 'Every region',
        setZonesChat: 'Chat only',
        setZonesTask: 'Tasks only',
        setZonesBoth: 'Chat + tasks',
        setUnclassified: 'Also trigger outside known regions',
        setMinChars: 'Minimum selection length',
        setConcurrency: 'Max concurrent answers',
        setSideTools: 'Side answerer tool access',
        setSideToolsReadonly: 'Read-only (recommended)',
        setSideToolsInherit: 'Inherit from the session',
        setSideTimeout: 'Side answer timeout (ms)',
        setSideTimeoutHint: 'The answer stops once this time is exceeded',
        setSideProvider: 'Subagent provider',
        setSideProviderHint: 'auto picks a registered provider automatically',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed: {msg}',
        reset: 'Reset to patch config',
        resetDone: 'Reset',
        diagnostics: 'Run diagnostics',
        diagTitle: 'Capability check',
        diagHost: 'Host API',
        diagSide: 'Side answer engine',
        diagProviders: 'Subagent providers',
        diagAgents: 'Live session agents',
        diagSurface: 'Current side surface',
        diagSession: 'Session detected',
        diagZones: 'Zone anchors (data-slot)',
        diagZonesMissing: 'missing — region filtering disabled',
        diagSlots: 'Slot landing',
        diagSidecard: 'Side-card plugin (dsh-better-sidebar)',
        diagFeatures: 'capabilities',
        diagNoTabMeta: 'too old: no tabMeta capability, skipped in favour of another surface',
        diagNativeKind: 'kind',
        toolGuardUnavailable: 'This provider supports no tool allow-list, so the answer inherited the session tools',
        toolGuardInherited: 'Inherits the session tools, as configured',
        diagUnreachable: 'Host API unreachable: {msg}',
        yes: 'yes',
        no: 'no',
        none: 'none',
        unsupportedTrigger: 'Unrecognized shortcut — use a form like Alt+Q / Ctrl+Shift+K',
        surfaceUnavailable: 'The chosen side surface is unavailable',
        familySuppressed: 'A newer family build ({version}) is already running on this page; this copy has disabled its trigger and shortcut so only one UI answers. Uninstall this older package.',
        familyLegacyToast: 'Legacy dsh-selection-followup detected alongside this plugin; this build took over. Uninstall the old package.',
        familyLegacyDiag: 'Legacy co-load',
        familyPeers: 'Copies on page',
        retryEdit: 'Edit & retry',
        editQuestionPlaceholder: 'Edit the question, then ask again…',
        retryAskSubmit: 'Ask again',
        copyCode: 'Copy code',
        qaExplain: 'Explain',
        qaExplainQ: 'Explain what this passage means, concisely.',
        qaTranslate: 'Translate',
        qaTranslateQ: 'Translate this passage into English; if it is already in English, translate it into Chinese. Output the translation only, with no explanation.',
        qaSummarize: 'Summarize',
        qaSummarizeQ: 'Summarize the key points of this passage briefly.',
        qaPolish: 'Polish',
        qaPolishQ: 'Polish this text: keep the original meaning, fix grammar and awkward phrasing, and output only the polished version.',
        qaFix: 'Proofread',
        qaFixQ: 'Check this passage for factual, logical, and writing errors. List each issue with a suggested fix.',
        setQuickActions: 'Quick actions',
        setQuickActionsHint: 'One-click actions shown after selecting text. In a custom question, {selection} is replaced by the selected text; without it, the source text is attached automatically.',
        qaEnabled: 'On',
        qaAdd: '＋ Add action',
        qaDelete: 'Delete',
        qaBuiltinBadge: 'built-in',
        qaLabelPlaceholder: 'Action name (e.g. EN→ZH)',
        qaQuestionPlaceholder: 'Question; use {selection} for the selected text',
        qaShortcutPlaceholder: 'e.g. Alt+T; blank for none',
        qaTooMany: 'At most {n} quick actions',
        qaMalformed: 'A malformed action exists',
        qaBadId: 'An action id is missing or too long',
        qaDuplicateId: 'Duplicate action ids exist',
        qaBadLabel: 'Action names are required and at most {n} characters',
        qaBadQuestion: 'Questions are required and at most {n} characters',
        qaBadShortcut: 'The shortcut for "{label}" is invalid; use a form like Alt+Q',
        qaDuplicateShortcut: 'The shortcut for "{label}" conflicts with "{other}"',
        fuShorter: 'Shorter',
        fuShorterQ: 'Answer the question above again, more briefly, keeping the key points.',
        fuLonger: 'More detail',
        fuLongerQ: 'Expand the answer above with more detail where it helps.',
        fuExample: 'Give an example',
        fuExampleQ: 'Illustrate the answer above with one concrete example.',
        fuToEnglish: 'In English',
        fuToEnglishQ: 'Please give the same answer in English.',
        metaElapsed: 'Elapsed',
        metaProvider: 'Model',
        setNotifyOnDone: 'Notify when done',
        setNotifyOnDoneHint: 'Only fires a system notification when the page is in the background (another tab or window) and the answer finishes; enabling asks for the browser notification permission once',
        notifyGranted: 'Notification permission granted',
        notifyDenied: 'Notification permission denied; enable it in the browser site settings',
        notifyUnsupported: 'This environment does not support system notifications',
        notifyDoneTitle: 'Side answer done',
        notifyErrorTitle: 'Side answer failed',
        setContextMenu: 'Selection context menu',
        setContextMenuHint: 'Right-clicking a qualifying selection shows Ask plus quick actions at the top of the menu; turn off if it conflicts with the host own menu',
        setFollowUps: 'Suggest follow-ups at the end',
        setFollowUpsHint: 'The model ends each answer with a <followups> block of 2–3 next questions, rendered as clickable chips (no extra request)',
        setHistoryMax: 'Saved history cards',
        setHistoryMaxHint: '0 = do not save; up to 50 cards, at most 64K text each',
        historyTitle: 'History cards',
        historyDesc: 'Finished side cards are kept in this browser; search, restore to the floating layer, or delete them. Clearing browser data removes them too.',
        historySearch: 'Search questions or answers…',
        historyEmpty: 'No history cards yet',
        historyRestore: 'Restore',
        historyDelete: 'Delete',
        historyClear: 'Clear all',
        historyClearConfirm: 'Clear every history card? This cannot be undone.',
        historyClearDone: 'History cleared',
        historyRestored: 'Restored to the floating layer',
        historyCount: '{n} cards',
        historyDeleted: 'Deleted',
        cardKeysHint: 'Keys: R retry · C copy · Esc unfocus',
        setAnswerStyle: 'Answer style',
        setAnswerStyleHint: 'Controls how much detail the answer carries; it never changes "answer in the question\u2019s language"',
        setAnswerStyleConcise: 'Concise (smallest complete answer)',
        setAnswerStyleStandard: 'Standard (default)',
        setAnswerStyleDetailed: 'Detailed (expand and give the basis)',
        setCustomPersona: 'Custom instruction',
        setCustomPersonaHint: 'Appended after the style directive and sent with every question; at most {n} characters',
        setCustomPersonaPlaceholder: 'e.g. cite verifiable sources; do not use tables',
        locate: 'Show source',
        locateHint: 'Jump back to the passage on the page and highlight it',
        locateNotFound: 'The source text changed or is not in the current view',
        locateUnsupported: 'This environment cannot locate text (no page text nodes reachable)',
        exportMd: 'Export .md',
        exportAllMd: 'Export all .md',
        exportEmpty: 'Nothing to export',
        exportFailed: 'Export failed: the browser refused the download',
        insertToComposer: 'Insert into composer',
        insertReplace: 'Replace the passage',
        insertHint: 'Put this rewrite into the main-chat composer (sent messages stay untouched)',
        insertDone: 'Inserted into the composer — press Enter to send',
        insertStale: 'The composer changed; the insert did not apply — try again',
        insertNoComposer: 'No writable composer found',
        insertFailed: 'Insert failed — copy the answer manually',
        versionsLabel: 'Versions',
        versionN: 'v{n}',
        versionLatest: 'Back to latest',
        versionViewing: 'Viewing an older version (read-only)',
        suggestionsLabel: 'Suggested follow-ups',
        familyLegacyDiag: 'Legacy co-load',
        familyPeers: 'Copies on page',
      },
    }

    /**
     * Pick a dictionary id from locale candidates, best first. A candidate
     * naming neither zh nor en is skipped, so a lesser preference can still
     * win — `navigator.languages` is an ordered preference list, and a user
     * whose first choice the UI cannot serve should get their second, not a
     * hard fallback. This is the ONE place locale strings become a dictionary
     * id; the harness locale subscription below feeds the same helper.
     * @param {unknown[]} candidates locale strings, best first.
     * @param {'zh'|'en'} fallback applied only when no candidate matches.
     * @returns {'zh'|'en'} the dictionary id.
     */
    function resolveLanguage(candidates, fallback) {
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate === '') continue
        const lower = candidate.toLowerCase()
        if (lower.startsWith('zh')) return 'zh'
        if (lower.startsWith('en')) return 'en'
      }
      return fallback
    }

    /**
     * The active language id, kept in step with the harness locale service.
     * When the browser lists a language the UI does not carry, the next
     * preference decides; only a list with no zh/en entry at all falls back.
     */
    const initialLocales = [
      ...(Array.isArray(navigator?.languages) ? [...navigator.languages] : []),
      ...(typeof navigator?.language === 'string' ? [navigator.language] : []),
    ]
    let lang = resolveLanguage(initialLocales, initialLocales.length > 0 ? 'en' : 'zh')

    /**
     * Translate one key with `{name}` interpolation.
     * @param {string} key - dictionary key.
     * @param {Record<string, unknown>} [vars] - interpolation values.
     */
    function t(key, vars) {
      const table = DICT[lang] ?? DICT.zh
      let text = table[key] ?? DICT.zh[key] ?? key
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    /**
     * Wire-error codes whose meaning is fully known Client-side, so an English
     * interface never has to show the Host's Chinese message line. Codes that
     * carry a live diagnostic in their message (engine-error, blocked-step,
     * http-*, internal, main-failed) are deliberately absent: the Host message
     * is the only place that reason exists, and replacing it would lose it.
     * `vars` receives the whole error when the copy needs a live value.
     */
    const ERROR_CODES = {
      'too-large': { key: 'errorTooLarge' },
      'bad-request': { key: 'errorBadRequest' },
      unloaded: { key: 'errorUnloaded' },
      duplicate: { key: 'errorDuplicate' },
      busy: { key: 'errorBusy', vars: () => ({ n: store?.state?.config?.maxConcurrentAsks ?? 0 }) },
      'no-side-engine': { key: 'errorNoSideEngineBody' },
      'no-parent': { key: 'errorNoParentBody' },
      aborted: { key: 'errorAborted' },
      unreachable: { key: 'errorUnreachableBody' },
      'bad-response': { key: 'errorBadResponseBody' },
      'stream-broken': { key: 'errorStreamBrokenBody' },
      'stream-ended': { key: 'errorStreamEndedBody' },
    }

    /** One localized line for a wire error; unknown codes keep the Host text. */
    function localizeError(error) {
      if (error === null || error === undefined) return ''
      const entry = ERROR_CODES[error?.code]
      if (entry === undefined) return error.message ?? String(error?.code ?? error)
      return t(entry.key, entry.vars?.(error))
    }

    // ─────────────────────────────────────────────────────────────────────
    // §3 wire client
    // ─────────────────────────────────────────────────────────────────────

    /**
     * POST JSON to the plugin's Host API.
     * @returns {Promise<unknown>} the `value` field of an `{ok:true}` answer.
     * @throws {Error} with a `code` for every `{ok:false}` or transport failure.
     */
    async function postJson(method, payload) {
      let response
      try {
        response = await fetch(`${API}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        })
      } catch (error) {
        throw Object.assign(new Error(String(error?.message ?? error)), { code: 'unreachable' })
      }
      let body
      try {
        body = await response.json()
      } catch {
        throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'bad-response' })
      }
      if (body?.ok === true) return body.value
      const error = new Error(body?.error?.message ?? `HTTP ${response.status}`)
      error.code = body?.error?.code ?? 'bad-response'
      throw error
    }

    /** GET the plugin state (`/state` also answers POST, GET keeps it cacheable-free). */
    async function getState() {
      const response = await fetch(`${API}/state`, { method: 'GET' })
      const body = await response.json()
      if (body?.ok !== true) throw Object.assign(new Error('state failed'), { code: 'bad-response' })
      return body.value
    }

    /**
     * Open the SSE ask stream and drive callbacks per event.
     * Split out from the React layer so a card owns no transport details.
     * @param {object} payload - the ask request.
     * @param {{onStart: Function, onDelta: Function, onReasoning: Function,
     *   onDone: Function, onError: Function, signal: AbortSignal}} handlers
     */
    async function streamAsk(payload, handlers) {
      let response
      try {
        response = await fetch(`${API}/ask`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify(payload),
          signal: handlers.signal,
        })
      } catch (error) {
        if (handlers.signal.aborted) return
        handlers.onError({ code: 'unreachable', message: String(error?.message ?? error) })
        return
      }
      if (!response.ok || response.body === null) {
        handlers.onError({ code: `http-${response.status}`, message: `HTTP ${response.status}` })
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let settled = false
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let cut = buffer.indexOf('\n\n')
          while (cut !== -1) {
            const block = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            cut = buffer.indexOf('\n\n')
            const parsed = parseSseBlock(block)
            if (parsed === null) continue
            const { event, data } = parsed
            if (event === 'start') handlers.onStart(data)
            else if (event === 'delta') handlers.onDelta(data)
            else if (event === 'reasoning') handlers.onReasoning(data)
            else if (event === 'status') handlers.onStatus?.(data)
            else if (event === 'done') { settled = true; handlers.onDone(data) }
            else if (event === 'error') { settled = true; handlers.onError(data) }
          }
        }
      } catch (error) {
        if (!handlers.signal.aborted && !settled) {
          handlers.onError({ code: 'stream-broken', message: String(error?.message ?? error) })
        }
        return
      }
      if (!settled && !handlers.signal.aborted) {
        handlers.onError({ code: 'stream-ended', message: 'stream ended without a terminal event' })
      }
    }

    /**
     * Parse one raw SSE block into `{event, data}`.
     * @returns {{event: string, data: unknown}|null} null when unusable.
     */
    function parseSseBlock(block) {
      let event = 'message'
      const dataLines = []
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) return null
      try {
        return { event, data: JSON.parse(dataLines.join('\n')) }
      } catch {
        return null
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // §4 module store
    // ─────────────────────────────────────────────────────────────────────

    /** The single observable state every surface reads. */
    const store = {
      state: {
        config: { ...CLIENT_DEFAULTS },
        problems: [],
        capabilities: null,
        provenance: null,
        hostReachable: null,
        surface: 'flow',
        surfaceNote: null,
        /**
         * In-session override of `config.floatMode`, set by the layer's own
         * collapse/hide buttons. `null` = follow the configured default.
         */
        floatMode: null,
        sessionId: null,
        trigger: null,
        popover: null,
        /** The custom selection context menu: {candidate, x, y} or null. */
        contextMenu: null,
        cards: [],
        /**
         * The durable card history (localStorage v2), mirrored into the store
         * so the settings-page manager can render/search it without IO.
         */
        history: [],
        toast: null,
        /** Whether the harness renders the `data-slot` zone anchors (null = unknown yet). */
        zoneAnchors: null,
        /** Which ladder rung each registration actually landed on. */
        slots: {},
        /** §4.5 family election: this copy owns the interaction surface. */
        familyLeader: true,
        /** Other cooperating copies currently live in this page. */
        familyPeers: [],
        /** A non-cooperating legacy build (≤1.0.x) is present and suppressed. */
        familyLegacy: false,
        revision: 0,
      },
      listeners: new Set(),
      get() { return this.state },
      set(patch) {
        this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
        for (const listener of [...this.listeners]) {
          try {
            listener()
          } catch (error) {
            console.error(`[${PLUGIN_ID}] store listener failed:`, error)
          }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }

    /** Subscribe a component to the whole store (small state, one revision). */
    function useStoreState() {
      const [, bump] = React.useReducer(count => count + 1, 0)
      React.useEffect(() => store.subscribe(bump), [])
      return store.state
    }

    // ─────────────────────────────────────────────────────────────────────
    // §4.5 family singleton
    //
    // The plugin shipped under two npm names (`dsh-selection-followup` ≤1.0.1
    // and `dsh-sidecard-ask` ≥1.1.0), and a profile can accidentally enable
    // BOTH bundles — or the same bundle twice. Two live copies used to mean
    // two trigger buttons stacked on the selection and two Alt+Q popovers.
    //
    // Cooperating copies (any build with this section) share one registry on
    // `window` and elect a single leader by version (ties → first loaded);
    // non-leaders keep their settings page but mount NO interaction surface.
    //
    // The old 1.0.x build cannot cooperate: it is detected structurally (its
    // overlay carries the same `dsa-layer` class without an owner marker), the
    // leader hides its UI with one stylesheet rule, and the user is told to
    // uninstall the old package.
    // ─────────────────────────────────────────────────────────────────────

    const FAMILY_WINDOW_KEY = '__dshSidecardFamily'
    const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const OWNER_TOKEN = `${PLUGIN_ID}@${CLIENT_VERSION}#${INSTANCE_ID}`

    /** Compare dotted numeric versions; non-numeric parts sort first. */
    function compareVersions(a, b) {
      const parts = v => String(v).split(/[.+-]/).map(part => (/^\d+$/.test(part) ? Number(part) : -1))
      const pa = parts(a)
      const pb = parts(b)
      for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const x = pa[i] ?? -1
        const y = pb[i] ?? -1
        if (x !== y) return x < y ? -1 : 1
      }
      return 0
    }

    /**
     * Elect the leader: highest version wins; a tie goes to the member that
     * joined first (Map insertion order). Pure so the contract test can pin it.
     * @returns {string} the winning member id.
     */
    function electFamilyLeader(members, selfId) {
      let winner = null
      for (const member of members) {
        // Strictly greater version replaces; an equal version keeps the member
        // that joined earlier (Map insertion order = load order).
        if (winner === null || compareVersions(member.version, winner.version) > 0) {
          winner = member
        }
      }
      return winner?.id ?? selfId
    }

    /** Fetch-or-create the cross-copy registry (survives HMR on `window`). */
    function familyTable(win) {
      const existing = win[FAMILY_WINDOW_KEY]
      if (existing !== undefined && existing !== null && typeof existing.subscribe === 'function') {
        return existing
      }
      const members = new Map()
      const listeners = new Set()
      const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* peer listener */ } } }
      const table = {
        join(member) { members.set(member.id, member); emit() },
        leave(id) { members.delete(id); emit() },
        list: () => [...members.values()],
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      }
      try {
        Object.defineProperty(win, FAMILY_WINDOW_KEY, { value: table, configurable: true, writable: true })
      } catch {
        win[FAMILY_WINDOW_KEY] = table
      }
      return table
    }

    /**
     * Find legacy (≤1.0.x, non-cooperating) family UI: a `dsa-layer` carrying
     * a trigger button but no owner marker. Every layer this build renders
     * stamps `data-dsa-owner`, so an unmarked layer can only be the old build.
     */
    function findLegacyLayers(root) {
      if (typeof root.querySelectorAll !== 'function') return []
      try {
        return [...root.querySelectorAll('.dsa-layer:not([data-dsa-owner])')]
          .filter(node => node.querySelector?.('.dsa-trigger, .dsa-pop') !== null)
      } catch { return [] }
    }

    /**
     * In-session override of the configured floating-layer shape. Deliberately
     * NOT persisted: the settings page owns the durable default, and a reload
     * should return to it (a pill hidden by accident must not stay hidden
     * across sessions).
     * @param {string} mode - `capsule` | `full` | `off`.
     */
    function setFloatMode(mode) {
      if (mode !== 'capsule' && mode !== 'full' && mode !== 'off') return
      store.set({ floatMode: mode })
    }

    /** Replace one card by id (immutably; a no-op when it is gone). */
    function patchCard(id, patch) {
      const cards = store.state.cards.map(card => (card.id === id ? { ...card, ...patch } : card))
      store.set({ cards })
      return cards.find(card => card.id === id)
    }

    /** Append text to one card's streaming answer. */
    function appendCardText(id, delta) {
      const cards = store.state.cards.map(card => (
        card.id === id ? { ...card, text: card.text + delta } : card
      ))
      store.set({ cards })
    }

    /** Append reasoning text to one card. */
    function appendCardReasoning(id, delta) {
      const cards = store.state.cards.map(card => (
        card.id === id ? { ...card, reasoning: card.reasoning + delta } : card
      ))
      store.set({ cards })
    }

    /** Show a transient toast line. */
    let toastTimer = null
    function toast(message) {
      store.set({ toast: message })
      if (toastTimer !== null) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { store.set({ toast: null }) }, 2600)
    }

    // ─────────────────────────────────────────────────────────────────────
    // §5 selection engine
    // ─────────────────────────────────────────────────────────────────────

    /** Element for a DOM node (the node itself when it is an element). */
    function elementOf(node) {
      if (node === null || node === undefined) return null
      return node.nodeType === 1 ? node : node.parentElement ?? null
    }

    /** Whether the node lives inside an editable field (composer, rename box…). */
    function isEditable(node) {
      const element = elementOf(node)
      if (element === null) return false
      const tag = element.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return element.closest('[contenteditable=""],[contenteditable="true"]') !== null
    }

    /** Whether the node belongs to this plugin's own UI. */
    function isOurUi(node) {
      const element = elementOf(node)
      return element !== null && element.closest('[data-dsa-root]') !== null
    }

    /**
     * The `data-slot` chain above a node. The harness slot renderer stamps
     * every outlet with `data-slot="<slot key>"`, so this is the sanctioned
     * way to tell *where* a selection lives without reading any plugin's
     * markup.
     * @param {Node} node - selection anchor or focus node.
     * @returns {string[]} slot keys, nearest first.
     */
    function slotPathOf(node) {
      const keys = []
      let element = elementOf(node)
      while (element !== null) {
        const key = element.getAttribute?.('data-slot')
        if (typeof key === 'string' && key !== '') keys.push(key)
        element = element.parentElement
      }
      return keys
    }

    /**
     * Classify a selection by its slot chain.
     * @param {string[]} slotPath - nearest-first slot keys.
     * @returns {'chat'|'task'|'other'} the zone.
     */
    function classifyZone(slotPath) {
      for (const key of slotPath) {
        if (ZONE_PATTERNS.chat.some(pattern => pattern.test(key))) return 'chat'
        if (ZONE_PATTERNS.task.some(pattern => pattern.test(key))) return 'task'
      }
      return 'other'
    }

    /** The rect a trigger should hang off, tolerating multi-block selections. */
    function rectOf(range) {
      let rect = range.getBoundingClientRect()
      const usable = candidate => candidate !== undefined && (candidate.width > 0 || candidate.height > 0)
      if (!usable(rect)) {
        const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : []
        rect = rects.length > 0 ? rects[rects.length - 1] : rect
      }
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }

    /**
     * Read the current DOM selection into a trigger candidate.
     * @returns {{text: string, rect: object, zone: string, cross: boolean,
     *   slotPath: string[], kind: 'text'} | null} null when nothing usable.
     */
    function readSelection() {
      if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed === true) return null
      const text = selection.toString()
      if (typeof text !== 'string' || text.trim() === '') return null
      const range = selection.getRangeAt(0)
      const anchorNode = selection.anchorNode
      const focusNode = selection.focusNode ?? anchorNode
      if (isOurUi(anchorNode) || isOurUi(focusNode)) return null
      if (isEditable(anchorNode) || isEditable(focusNode)) return null
      const anchorPath = slotPathOf(anchorNode)
      const focusPath = slotPathOf(focusNode)
      const anchorZone = classifyZone(anchorPath)
      const focusZone = classifyZone(focusPath)
      return {
        text,
        rect: rectOf(range),
        zone: anchorZone,
        cross: anchorZone !== focusZone,
        slotPath: anchorPath,
        kind: 'text',
      }
    }

    /**
     * Whether a candidate may raise the in-place trigger button.
     * @param {object|null} candidate - a `readSelection()` result.
     * @param {object} config - the effective config.
     * @param {{anchors?: boolean}} [options] - `anchors: false` means this DSH
     *   build renders no `data-slot` marker, so the selection cannot be placed
     *   in a region at all; the zone filter is then skipped instead of
     *   silently suppressing every trigger (the settings page reports why).
     * @returns {{ok: boolean, reason?: string, zoneFiltering?: string}} the decision.
     */
    function shouldOffer(candidate, config, options) {
      if (candidate === null) return { ok: false, reason: 'empty' }
      if (config.trigger === 'shortcut') return { ok: false, reason: 'shortcut-only' }
      if (codePointLength(candidate.text.trim()) < config.minChars) return { ok: false, reason: 'too-short' }
      if (options?.anchors === false) return { ok: true, zoneFiltering: 'unavailable' }
      const zones = config.captureZones
      const zone = candidate.zone
      if (zones === 'chat' && zone !== 'chat') return { ok: false, reason: 'zone' }
      if (zones === 'task' && zone !== 'task') return { ok: false, reason: 'zone' }
      if ((zones === 'chat+task' || zones === 'auto') && zone === 'other' && config.showInUnclassified !== true) {
        return { ok: false, reason: 'zone' }
      }
      return { ok: true }
    }

    /**
     * A cheap identity for a selection, used to suppress duplicate triggers
     * for the same text at (nearly) the same place.
     */
    function selectionSignature(candidate) {
      const rect = candidate.rect ?? { left: 0, top: 0 }
      return `${candidate.text.length}:${Math.round(rect.left)}:${Math.round(rect.top)}:${candidate.text.slice(0, 24)}`
    }

    /**
     * Truncate an over-long selection for an outgoing prompt, keeping head and
     * tail. Mirrors the Host's `truncateSelection` (asserted by contract test):
     * code points, not UTF-16 units, so a surrogate pair is never split.
     * @returns {{text: string, truncated: boolean, droppedChars: number}}
     */
    function truncateSelection(text, maxChars) {
      const source = typeof text === 'string' ? text : ''
      const points = Array.from(source)
      if (points.length <= maxChars) return { text: source, truncated: false, droppedChars: 0 }
      const head = Math.max(1, Math.ceil(maxChars * 0.7))
      const tail = Math.max(0, maxChars - head)
      const dropped = points.length - head - tail
      return {
        text: `${points.slice(0, head).join('')}\n…（已省略中间 ${dropped} 个字符）…\n${tail > 0 ? points.slice(points.length - tail).join('') : ''}`,
        truncated: true,
        droppedChars: dropped,
      }
    }

    /** Character count a Chinese user would expect: one glyph = one char. */
    function codePointLength(text) {
      return Array.from(String(text ?? '')).length
    }

    /** Parse a `Ctrl+Shift+K`-style accelerator into matcher facts. */
    function parseShortcut(accelerator) {
      if (typeof accelerator !== 'string') return null
      const trimmed = accelerator.trim()
      // A trailing separator ("Alt+") names a modifier as the key: refuse it.
      if (trimmed === '' || trimmed.endsWith('+')) return null
      const parts = trimmed.split('+').map(part => part.trim().toLowerCase()).filter(Boolean)
      const key = parts.pop()
      if (key === undefined || key === '') return null
      const facts = { key, ctrl: false, alt: false, shift: false, meta: false }
      for (const part of parts) {
        if (part === 'ctrl' || part === 'control') facts.ctrl = true
        else if (part === 'alt' || part === 'option') facts.alt = true
        else if (part === 'shift') facts.shift = true
        else if (part === 'meta' || part === 'cmd' || part === 'command' || part === 'win') facts.meta = true
        else return null
      }
      // A bare modifier is not an accelerator either.
      if (['ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command', 'win'].includes(facts.key)) return null
      return facts
    }

    /** Whether a keyboard event matches a parsed accelerator. */
    function matchesShortcut(event, facts) {
      if (facts === null) return false
      const key = String(event.key ?? '').toLowerCase()
      if (key !== facts.key) return false
      return event.ctrlKey === facts.ctrl
        && event.altKey === facts.alt
        && event.shiftKey === facts.shift
        && event.metaKey === facts.meta
    }

    /**
     * Resolve the configured quick actions into renderable, ENABLED entries.
     * The Host validator keeps a saved list well-formed; this is the
     * render-time guard for an in-memory/edited draft: unknown `builtin:*`
     * ids and custom entries missing label/question are skipped.
     * @param {object|Array} configOrList - the effective config or a raw list.
     * @returns {Array<{id:string,label:string,question:string,shortcut:string,builtin:boolean}>}
     */
    function quickActionsOf(configOrList) {
      const list = Array.isArray(configOrList) ? configOrList : configOrList?.quickActions
      if (!Array.isArray(list)) return []
      const out = []
      for (const entry of list) {
        if (entry === null || typeof entry !== 'object') continue
        if (entry.enabled === false) continue
        const id = String(entry.id ?? '')
        const meta = QUICK_ACTION_BUILTINS[id]
        if (meta !== undefined) {
          out.push({
            id,
            label: t(meta.labelKey),
            question: t(meta.questionKey),
            shortcut: typeof entry.shortcut === 'string' ? entry.shortcut : '',
            builtin: true,
          })
          continue
        }
        // An unknown builtin id resolves to nothing the client knows.
        if (id.startsWith('builtin:')) continue
        if (typeof entry.label === 'string' && entry.label.trim() !== ''
          && typeof entry.question === 'string' && entry.question.trim() !== '') {
          out.push({
            id,
            label: entry.label,
            question: entry.question,
            shortcut: typeof entry.shortcut === 'string' ? entry.shortcut : '',
            builtin: false,
          })
        }
      }
      return out
    }

    /**
     * The question actually sent for one quick action. A template containing
     * `{selection}` embeds the (truncated) selection inline; a template
     * without it is sent as-is, because the Host fences the selection in
     * every prompt regardless.
     * @param {{question?: string}} action - a resolved quick action.
     * @param {string} selection - the raw selected text.
     * @param {number} maxChars - the selection truncation budget.
     * @returns {string}
     */
    function renderActionQuestion(action, selection, maxChars) {
      const template = String(action?.question ?? '')
      if (!template.includes('{selection}')) return template
      const cut = truncateSelection(String(selection ?? ''), maxChars)
      return template.split('{selection}').join(cut.text)
    }

    /** Canonical fingerprint of an accelerator, for duplicate detection. */
    function shortcutFingerprint(accelerator) {
      const facts = parseShortcut(accelerator)
      if (facts === null) return null
      return `${facts.ctrl ? 1 : 0}|${facts.alt ? 1 : 0}|${facts.shift ? 1 : 0}|${facts.meta ? 1 : 0}|${facts.key}`
    }

    /** Whether this browser exposes the Notification API at all. */
    function notificationSupported() {
      return typeof window !== 'undefined' && typeof window.Notification === 'function'
    }

    /** The Notification permission flag, or 'unsupported' in a bare WebView. */
    function notificationPermission() {
      if (!notificationSupported()) return 'unsupported'
      const permission = window.Notification.permission
      return typeof permission === 'string' ? permission : 'default'
    }

    /**
     * Whether a finished run should raise a desktop notification right now.
     * All four conditions must hold: the feature is enabled, the page is in
     * the BACKGROUND (notifying a visible page is just noise), the browser
     * granted permission, and this card has not been notified yet.
     * @param {object} config - effective config.
     * @param {boolean} hidden - document.hidden at the terminal moment.
     * @param {string} permission - notificationPermission() result.
     * @param {boolean} alreadyNotified - guard against duplicate notices.
     */
    function shouldNotifyFinish(config, hidden, permission, alreadyNotified) {
      return config?.notifyOnDone === true
        && hidden === true
        && permission === 'granted'
        && alreadyNotified !== true
    }

    /** Title/body for one card's finish notification (error vs done). */
    function buildFinishNotification(card) {
      const title = card?.status === 'error' ? t('notifyErrorTitle') : t('notifyDoneTitle')
      const question = String(card?.question ?? '').trim()
      return { title, body: Array.from(question).slice(0, 80).join('') }
    }

    /**
     * Request the Notification permission once. Resolves to the resulting
     * permission string; a rejecting/absent API degrades to 'denied' so the
     * caller can render the toggle honestly without throwing.
     */
    async function requestNotificationPermission() {
      if (!notificationSupported()) return 'unsupported'
      try {
        const result = await window.Notification.requestPermission()
        return typeof result === 'string' ? result : notificationPermission()
      } catch {
        // Older Safari used a callback-only API; treat a thrown promise as a
        // refusal rather than breaking the settings page.
        return notificationPermission() === 'granted' ? 'granted' : 'denied'
      }
    }

    /**
     * Fire one notification for a finished card. Returns false when the
     * feature/permission/hidden guard fails, so the caller can stay silent.
     * Clicking the notification brings the tab forward.
     */
    function notifyCardFinish(card) {
      const hidden = typeof document !== 'undefined' && document.hidden === true
      if (!shouldNotifyFinish(store.state.config, hidden, notificationPermission(), card.notified === true)) {
        return false
      }
      try {
        const { title, body } = buildFinishNotification(card)
        const notification = new window.Notification(title, { body, tag: `dsh-sidecard-ask:${card.id}` })
        notification.onclick = () => {
          try { window.focus() } catch { /* the WebView may refuse focus */ }
          try { notification.close() } catch { /* already closed */ }
        }
        patchCard(card.id, { notified: true })
        return true
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] notification failed:`, error)
        return false
      }
    }

    /**
     * Validate a settings-page quick-action draft BEFORE posting it, so the
     * Host's all-or-nothing refusal never comes back as a surprise. Also
     * checks that no action shortcut collides with another action or with the
     * main popover shortcut.
     * @param {unknown} list - the draft `quickActions` array.
     * @param {string} mainShortcut - the configured popover shortcut.
     * @returns {{ok: true}|{ok: false, key: string, vars?: object}}
     */
    function validateQuickActionsDraft(list, mainShortcut) {
      if (!Array.isArray(list) || list.length > QUICK_ACTION_LIMITS.maxEntries) {
        return { ok: false, key: 'qaTooMany' }
      }
      const ids = new Set()
      const taken = new Map()
      const mainFingerprint = shortcutFingerprint(mainShortcut)
      if (mainFingerprint !== null) taken.set(mainFingerprint, '')
      const labelOf = (entry) => {
        const meta = QUICK_ACTION_BUILTINS[String(entry.id ?? '')]
        return meta !== undefined ? t(meta.labelKey) : String(entry.label ?? '')
      }
      for (const entry of list) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
          return { ok: false, key: 'qaMalformed' }
        }
        const id = String(entry.id ?? '')
        if (id === '' || id.length > QUICK_ACTION_LIMITS.idLength) return { ok: false, key: 'qaBadId' }
        if (ids.has(id)) return { ok: false, key: 'qaDuplicateId' }
        ids.add(id)
        const meta = QUICK_ACTION_BUILTINS[id]
        const label = labelOf(entry)
        if (meta === undefined && !id.startsWith('builtin:')) {
          const customLabel = String(entry.label ?? '')
          const customQuestion = String(entry.question ?? '')
          if (customLabel.trim() === '' || customLabel.length > QUICK_ACTION_LIMITS.labelLength) {
            return { ok: false, key: 'qaBadLabel', vars: { n: QUICK_ACTION_LIMITS.labelLength } }
          }
          if (customQuestion.trim() === '' || customQuestion.length > QUICK_ACTION_LIMITS.questionLength) {
            return { ok: false, key: 'qaBadQuestion', vars: { n: QUICK_ACTION_LIMITS.questionLength } }
          }
        }
        const shortcut = String(entry.shortcut ?? '').trim()
        if (shortcut !== '') {
          if (parseShortcut(shortcut) === null) {
            return { ok: false, key: 'qaBadShortcut', vars: { label } }
          }
          const fingerprint = shortcutFingerprint(shortcut)
          if (taken.has(fingerprint)) {
            const owner = taken.get(fingerprint)
            return {
              ok: false,
              key: 'qaDuplicateShortcut',
              vars: { label, other: owner === '' ? t('setShortcut') : owner },
            }
          }
          taken.set(fingerprint, label)
        }
      }
      return { ok: true }
    }

    // ─────────────────────────────────────────────────────────────────────
    // §6 carriers
    // ─────────────────────────────────────────────────────────────────────

    /** Compose the prompt sent to the main conversation. */
    function composeMainPrompt(selection, question, zone, maxChars) {
      const cut = truncateSelection(selection, maxChars)
      const quoted = cut.text.split('\n').map(line => `> ${line}`).join('\n')
      const zoneLabel = t(zone === 'chat' ? 'zoneChat' : zone === 'task' ? 'zoneTask' : 'zoneOther')
      const head = `${quoted}\n`
      const mark = cut.truncated ? `\n（选中文本已截断，省略约 ${cut.droppedChars} 字）` : ''
      return `${head}${mark}\n【来源：${zoneLabel}】\n${question}`
    }

    /**
     * Send one question into the main conversation.
     *
     * Four rungs, strongest first, each probed at call time — the submit API
     * moved twice inside the supported range (`sessions.retain` before
     * 0.1.6-alpha.2, `sessions.using` from then on), so a version table would
     * rot. Every rung reports which one won, and the caller renders that.
     *
     * @returns {Promise<{mode: 'session'|'draft', via: string}>}
     */
    async function askInMainConversation(input) {
      const text = composeMainPrompt(input.selection, input.question, input.zone, input.maxChars)
      const sessions = input.ctx.get('sessions')
      const sessionId = input.sessionId ?? currentSessionId(input.ctx)
      const parts = [{ type: 'text', text }]
      const accepted = (result) => {
        if (result !== undefined && result !== null && result.ok === false) {
          throw Object.assign(new Error(result.error?.message ?? 'prompt rejected'), { code: 'prompt-rejected' })
        }
      }

      // Rung 1 — `using()`: the documented helper, present from 0.1.6-alpha.2.
      if (sessionId !== null && typeof sessions?.using === 'function') {
        const result = await sessions.using(sessionId, { source: 'gateway' }, async (reference) => {
          const face = reference?.binding?.session
          if (face === undefined || typeof face.prompt !== 'function') {
            throw Object.assign(new Error('session face has no prompt()'), { code: 'no-session-face' })
          }
          return face.prompt(parts, 'queue')
        })
        accepted(result)
        return { mode: 'session', via: 'sessions.using' }
      }

      // Rung 2 — `retain()` + explicit release: the same operation spelled out,
      // and the only session-face submit path on 0.1.2-rc.1 … 0.1.6-alpha.1.
      let scope
      if (sessionId !== null && typeof sessions?.retain === 'function') {
        const reference = sessions.retain(sessionId, { source: 'gateway' })
        try {
          if (reference?.ready !== undefined) await reference.ready
          const face = reference?.binding?.session
          if (face !== undefined && typeof face.prompt === 'function') {
            accepted(await face.prompt(parts, 'queue'))
            return { mode: 'session', via: 'sessions.retain' }
          }
        } catch (error) {
          if (error?.code === 'prompt-rejected') throw error
          console.warn(`[${PLUGIN_ID}] sessions.retain 提交失败，尝试下一级：`, error)
        } finally {
          try {
            reference?.release?.()
          } catch { /* already released */ }
        }
      }

      // Rung 3 — the composer's own action face. A session-scoped slot
      // component receives `inputActions` as a standard prop (the composer tool
      // row is where this plugin collects the session id), so the harness
      // itself hands us the sanctioned draft+submit pair.
      const captured = composerFace()
      if (captured !== null) {
        const { actions } = captured
        try {
          if (typeof actions.setDraft === 'function') actions.setDraft(text)
          const submit = [actions.submit, actions.send, actions.submitPrompt]
            .find(candidate => typeof candidate === 'function')
          if (submit !== undefined) {
            await submit.call(actions)
            return { mode: 'session', via: 'inputActions.submit' }
          }
        } catch (error) {
          console.warn(`[${PLUGIN_ID}] inputActions 提交失败，回退到写入输入框：`, error)
        }
      }

      // Rung 4 — write the draft and let the user press Enter.
      //
      // PLACEHOLDER: composer-draft — `ctx.get('conversation').input.for(scope)`
      // is the harness's own composer draft face; it is not in the published
      // client service catalog, so it is last and probed defensively (the
      // supported replacement is `inputActions` above; see README §6).
      const conversation = input.ctx.get('conversation')
      if (scope === undefined && sessions !== undefined && typeof sessions.scope === 'function' && sessionId !== null) {
        scope = sessions.scope(sessionId)
      }
      if (conversation?.input?.for !== undefined && scope !== undefined) {
        const reactor = conversation.input.for(scope)
        const draft = reactor.state?.getSnapshot?.().draft ?? ''
        reactor.setDraft(draft.trim() === '' ? text : `${draft}\n\n${text}`)
        return { mode: 'draft', via: 'composer.draft' }
      }
      // PLACEHOLDER: clipboard-fallback — nothing could carry the question.
      // The caller renders this message on the card; replace this throw when a
      // supported send API appears (see README §6).
      throw Object.assign(new Error(t('noMainCarrier')), { code: 'no-main-carrier' })
    }

    /** Best-effort active session id from every sanctioned source. */
    function currentSessionId(ctx) {
      const captured = store.state.sessionId
      if (typeof captured === 'string' && captured !== '') return captured
      try {
        const better = ctx.get('betterSidebar')
        const id = better?.getSnapshot?.()?.sessionId
        if (typeof id === 'string' && id !== '') return id
      } catch { /* the service is optional */ }
      try {
        const mounted = ctx.get('sidebarRight')?.mounted
        const id = typeof mounted?.getSnapshot === 'function' ? mounted.getSnapshot() : undefined
        if (typeof id === 'string' && id !== '') return id
      } catch { /* the service is optional */ }
      return null
    }

    // ─────────────────────────────────────────────────────────────────────
    // §7 side-card surfaces
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Adapter registry. Each adapter answers two questions — "can you host a
     * card now?" and "put this card there" — so `auto` never has to guess.
     * Order matters: the native right rail is the shipped surface, the
     * better-sidebar plugin is an optional third party, and the built-in flow
     * card is the guaranteed fallback that needs nothing at all.
     */
    const surfaces = {
      native: {
        kind: 'native-rightbar',
        label: () => t('surfaceNative'),
        registry: null,
        controller: null,
        error: null,
        dispose: null,
        available() {
          return this.registry !== null && this.controller !== null && this.error === null
        },
        open(card) {
          if (!this.available() || typeof this.controller.openTab !== 'function') return false
          this.controller.openTab(CARD_KIND, { params: { cardId: card.id }, revealIfOpened: true })
          return true
        },
        close(card) {
          // The right rail owns its tab lifecycle, so closing never blocks on
          // it — but since 0.2.0 the rail controller exposes `closeTab` with
          // the same shape `openTab` has (verified only for `openTab` on this
          // machine; see README §6). Probe defensively: a mismatching rail
          // simply keeps the tab, and CardHost then shows the closed-card note.
          if (typeof this.controller?.closeTab !== 'function') return false
          try {
            this.controller.closeTab(CARD_KIND, { params: { cardId: card.id } })
            return true
          } catch (error) {
            console.warn(`[${PLUGIN_ID}] native closeTab rejected the close:`, error)
            return false
          }
        },
      },
      better: {
        kind: 'better-sidebar',
        label: () => t('surfaceBetter'),
        service: null,
        error: null,
        dispose: null,
        features: [],
        /**
         * Why this adapter is (not) usable, in the settings page's own words.
         * `null` means "usable"; a string explains the refusal.
         */
        reason: 'not-detected',
        /**
         * Reported by the plugin itself (`BetterSidebarService.version`), so the
         * settings page can say which side-card plugin version is really in use.
         */
        version: null,
        /**
         * Usable only when the service advertises the `tabMeta` capability: the
         * card id travels in `tab.meta`, and `SIDEBAR_FEATURES` has listed
         * `tabMeta` since v0.12.0 with newer versions only ever ADDING features
         * ("Features are never removed"). A pre-0.12 instance would open an
         * empty tab, so it is skipped and the ladder continues to the native
         * right rail or the built-in flow card instead.
         */
        available() {
          if (this.service === null || this.error !== null) return false
          return Array.isArray(this.features) && this.features.includes('tabMeta')
        },
        open(card) {
          if (!this.available() || typeof this.service.openTab !== 'function') return false
          const tabId = `${CARD_KIND_BETTER}:${card.id}`
          // `meta` is the transport for the card id (feature `tabMeta`), and
          // `dedupeKey` on our descriptor is what collapses repeat opens onto
          // the same tab; both are part of the stable consumer contract
          // (`lib/types/client/service.d.ts`, unchanged across 0.22.0 → 0.22.1).
          this.service.openTab(
            { type: CARD_KIND_BETTER, id: tabId, title: card.question.slice(0, 32), meta: { cardId: card.id } },
            store.state.sessionId === null ? undefined : { sessionId: store.state.sessionId },
          )
          return true
        },
        close(card) {
          if (!this.available() || typeof this.service.closeTab !== 'function') return false
          this.service.closeTab(`${CARD_KIND_BETTER}:${card.id}`)
          return true
        },
      },
      flow: {
        kind: 'flow',
        label: () => t('surfaceFlow'),
        available() { return true },
        open() { return true },
        close() { return true },
      },
    }

    /**
     * The composer action face captured from a session-scoped slot entry
     * (`inputActions`), or null before any such entry has rendered.
     */
    let capturedComposerActions = null

    /**
     * Whether `POST /diagnose` is worth calling on this host generation.
     *
     * The two halves update independently — the Host half only on a DSH
     * restart, the Client half on a page load — so a page can easily run a
     * NEWER Client against an older Host that has no `/diagnose` route. The
     * first refusal turns the channel off for this page instead of retrying
     * (and warning) on every report.
     *
     * @param {unknown} error - the thrown wire error.
     * @returns {boolean} true when the failure means "this host lacks the route".
     */
    function isDiagnosticsUnsupported(error) {
      const code = error?.code
      return code === 'not-found' || code === 'bad-response' || code === 'unreachable'
    }

    /**
     * What this Client half wants the Host to know about its own state.
     *
     * The Host cannot inspect a browser-side plugin, so this report is what
     * makes a silent CLIENT-side failure visible from outside the page
     * (`GET /sidecard-ask/api/state` → `value.client`). It was added after two
     * such failures were only diagnosable by hand-inspecting the live slot
     * inventory: a native tab type that never registered, and a client build
     * that was still the previous generation.
     *
     * @param {object} state - `store.state`.
     * @returns {object} the report body (allow-listed again on the Host).
     */
    function buildClientReport(state) {
      return {
        // Read from the module's own version constant so the report can never
        // claim a generation the browser is not actually running.
        version: CLIENT_VERSION,
        surface: state.surface,
        zoneAnchors: state.zoneAnchors,
        sessionKnown: typeof state.sessionId === 'string' && state.sessionId !== '',
        slots: { ...state.slots },
        native: {
          available: surfaces.native.available(),
          ...(surfaces.native.error === null ? {} : { reason: String(surfaces.native.error) }),
        },
        better: {
          available: surfaces.better.available(),
          ...(surfaces.better.version === null ? {} : { version: surfaces.better.version }),
          ...(surfaces.better.reason === null ? {} : { reason: String(surfaces.better.reason) }),
          features: surfaces.better.features,
        },
        // §4.5 family singleton verdict (host-side diagnostics only).
        family: {
          leader: state.familyLeader !== false,
          peers: Array.isArray(state.familyPeers) ? state.familyPeers : [],
          legacy: state.familyLegacy === true,
        },
      }
    }

    /**
     * The card id an external host is CURRENTLY rendering. `CardHost` sets it
     * on mount and clears it on unmount, which is what turns "the adapter
     * accepted the open" into "the user can actually see the card": a host
     * that swallows the open (kind mismatch, collapsed panel, an older plugin
     * version) is detected and the card falls back to the flow stack.
     */
    let renderedCardId = null

    /**
     * Pick the surface for a new card.
     * @param {string} wanted - `auto` | adapter kind.
     * @returns {{adapter: object, fellBack: boolean}}
     */
    function pickSurface(wanted) {
      const order = [surfaces.native, surfaces.better, surfaces.flow]
      if (wanted === 'auto' || wanted === undefined) {
        for (const adapter of order) if (adapter.available()) return { adapter, fellBack: false }
        return { adapter: surfaces.flow, fellBack: false }
      }
      const match = order.find(adapter => adapter.kind === wanted || adapter === surfaces[wanted])
      if (match === undefined) return { adapter: surfaces.flow, fellBack: true }
      if (!match.available()) return { adapter: surfaces.flow, fellBack: true }
      return { adapter: match, fellBack: false }
    }

    // ─────────────────────────────────────────────────────────────────────
    // §8 view helpers
    // ─────────────────────────────────────────────────────────────────────

    /** Theme-token-only stylesheet. Every class is prefixed `dsa-`. */
    const CSS_TEXT = `
/* Desktop (Electron) window-drag guard.
   The DSH desktop shell marks top-level elements as window-drag regions
   (\`-webkit-app-region: drag\`), and a click landing inside such a region MOVES
   THE WINDOW instead of reaching the UI — which would make the floating trigger,
   the question popover and the cards unclickable in the desktop app. A
   descendant of a drag region must opt out explicitly; dsh-better-sidebar ships
   exactly this guard for its own host
   (\`html[data-platform] body>[data-dsh-better-sidebar]{-webkit-app-region:initial}\`
   plus \`[data-dsh-panel-host]>*{-webkit-app-region:no-drag}\`).
   Every surface we draw declares it. The property is inert in a browser. */
.dsa-layer,.dsa-trigger,.dsa-quickbar,.dsa-pop,.dsa-ctxmenu,.dsa-float,.dsa-stack,.dsa-card,.dsa-toast,.dsa-settings{-webkit-app-region:no-drag}
.dsa-layer{pointer-events:none;position:relative;z-index:60}
.dsa-trigger{pointer-events:auto;position:fixed;display:flex;align-items:center;gap:4px;
  padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  font-size:12px;line-height:16px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);
  font-family:inherit;white-space:nowrap}
.dsa-trigger:hover{border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:1px}
/* The one-click action bar: the trigger button plus compact chips, laid out
   in one wrapping row under the selection. The container is positioned by the
   component; chips keep their own pointer-events because .dsa-layer is a
   click-through layer. */
.dsa-quickbar{pointer-events:auto;position:fixed;display:flex;align-items:center;gap:6px;
  max-width:min(620px, 92vw);flex-wrap:wrap;z-index:60}
.dsa-chip{pointer-events:auto;padding:3px 10px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  font:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap;
  box-shadow:0 2px 8px rgba(0,0,0,.14)}
.dsa-chip:hover{border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:1px}
/* Chips rendered INSIDE the popover need no floating shadow. */
.dsa-pop-chips{display:flex;gap:6px;flex-wrap:wrap}
.dsa-pop-chips .dsa-chip{box-shadow:none}
/* Post-answer follow-up chips live inside a card: quiet, pill-shaped, no
   floating shadow; the row is shown only for a terminal answer with text. */
.dsa-fu-chips{display:flex;gap:6px;flex-wrap:wrap}
.dsa-fu-chips .dsa-chip{box-shadow:none;padding:2px 9px;font-size:11px;line-height:15px}
/* 1.8.0 P2-4: model-suggested follow-ups sit under the fixed refinement chips,
   labelled so the two chip rows are never confused. */
.dsa-sug{display:flex;flex-direction:column;gap:4px}
.dsa-sug .dsa-sug-chips .dsa-chip{max-width:100%;white-space:normal;text-align:left}
/* 1.8.0 P2-5b: version switcher. The data-on attribute marks the version
   currently being read. */
.dsa-versions{flex-wrap:wrap}
.dsa-versions .dsa-btn{padding:2px 9px;font-size:11px;line-height:16px}
.dsa-versions .dsa-btn[data-on="true"]{border-color:var(--dsw-alias-brand-primary, #4c8dff);font-weight:600}
/* The selection context menu: a compact vertical list at the cursor. */
.dsa-ctxmenu{pointer-events:auto;position:fixed;z-index:65;display:flex;flex-direction:column;
  min-width:168px;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  box-shadow:0 10px 30px rgba(0,0,0,.24);font-size:13px}
.dsa-ctx-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 10px;
  border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;
  line-height:17px;cursor:pointer;white-space:nowrap}
.dsa-ctx-item:hover,.dsa-ctx-item:focus-visible{background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));outline:none}
.dsa-ctx-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1, rgba(127,127,127,.25))}
.dsa-ctx-badge{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary, #888)}
/* Inside the trigger bar the main button and chips are one flex row: the
   trigger drops its own fixed positioning, chips join the row directly. */
.dsa-trigger-embedded{position:static;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.dsa-quickbar-chips{display:contents}
.dsa-pop{pointer-events:auto;position:fixed;width:min(420px, 92vw);display:flex;flex-direction:column;gap:8px;
  padding:12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  box-shadow:0 10px 30px rgba(0,0,0,.24);font-size:13px;line-height:19px}
.dsa-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsa-title{font-weight:600;font-size:13px}
.dsa-quote{margin:0;padding:6px 8px;max-height:96px;overflow:auto;white-space:pre-wrap;word-break:break-word;
  border-left:3px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));border-radius:4px;
  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary, #444);
  font-size:12px;line-height:17px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsa-badge{padding:1px 6px;border-radius:999px;font-size:11px;line-height:16px;
  border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary, #555)}
.dsa-badge-warn{border-color:var(--dsw-alias-state-warn-primary, #b8860b);color:var(--dsw-alias-state-warn-primary, #b8860b)}
.dsa-textarea{width:100%;box-sizing:border-box;min-height:64px;max-height:180px;resize:vertical;padding:8px;
  border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));
  background:var(--dsw-alias-bg-layer-1, transparent);color:inherit;font:inherit;font-size:13px}
.dsa-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-btn{pointer-events:auto;padding:4px 10px;border-radius:8px;cursor:pointer;font:inherit;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-layer-1, transparent);color:var(--dsw-alias-label-primary, #111)}
.dsa-btn:hover{border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-btn-primary{background:var(--dsw-alias-brand-primary, #4c8dff);border-color:var(--dsw-alias-brand-primary, #4c8dff);
  color:#fff;font-weight:500}
.dsa-btn:disabled{opacity:.55;cursor:default}
/* Icon-only variant (the floating layer's collapse/hide controls): square and
   quiet so the card title bar stays one line and the title keeps the weight. */
.dsa-btn-icon{padding:4px 7px;line-height:1;font-size:13px;color:var(--dsw-alias-label-secondary, #666)}
.dsa-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));border-radius:8px;overflow:hidden}
.dsa-seg button{padding:3px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary, #555);
  font:inherit;font-size:12px;cursor:pointer}
.dsa-seg button[data-on="true"]{background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
  color:var(--dsw-alias-label-primary, #111);font-weight:500}
.dsa-card{pointer-events:auto;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  box-shadow:0 4px 16px rgba(0,0,0,.10);font-size:13px;line-height:19px}
/* The floating layer (A). Anchored to the frame's RIGHT edge and sized by
   \`floatPlacement\` through --dsa-float-w, so it grows left only as far as the
   conversation column allows. pointer-events stays off on the container so the
   empty area around the pill never eats a click meant for the conversation. */
.dsa-float{pointer-events:none;position:fixed;right:var(--dsa-gap-right, 8px);bottom:16px;
  display:flex;flex-direction:column;gap:8px;width:var(--dsa-float-w, 340px);max-width:92vw}
.dsa-float > *{pointer-events:auto}
.dsa-stack{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto}
.dsa-capsule{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;text-align:left;
  padding:8px 12px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px;line-height:18px;
  border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  box-shadow:0 2px 10px rgba(0,0,0,.14)}
.dsa-capsule:hover{border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-capsule:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:1px}
.dsa-capsule-dot{flex:none;width:8px;height:8px;border-radius:50%;
  background:var(--dsw-alias-state-idle-primary, #8a8f98)}
.dsa-capsule-dot[data-status="streaming"]{background:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-capsule-dot[data-status="done"]{background:var(--dsw-alias-state-success-primary, #2e9e5b)}
.dsa-capsule-dot[data-status="error"]{background:var(--dsw-alias-state-error-primary, #c0392b)}
.dsa-capsule-dot[data-status="stopped"]{background:var(--dsw-alias-state-warn-primary, #b8860b)}
.dsa-capsule-label{font-weight:600;white-space:nowrap}
.dsa-capsule-q{min-width:0;flex:1;color:var(--dsw-alias-label-secondary, #666);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsa-capsule-chev{flex:none;color:var(--dsw-alias-label-secondary, #888)}
.dsa-launcher{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:6px 11px;
  border-radius:999px;cursor:pointer;font:inherit;font-size:12px;line-height:18px;
  border:1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.45));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-secondary, #666)}
.dsa-launcher:hover{border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-answer{max-height:44vh;overflow:auto;word-break:break-word}
.dsa-answer .dsa-p{margin:0 0 6px}
.dsa-answer .dsa-ul{margin:0 0 6px;padding-left:18px}
.dsa-answer .dsa-h{font-weight:600;margin:0 0 6px}
.dsa-answer .dsa-gap{height:4px}
.dsa-details summary{cursor:pointer;user-select:none;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary, #666)}
.dsa-reasoning{max-height:24vh;overflow:auto;margin:4px 0 8px;padding:6px 8px;word-break:break-word;
  border-left:3px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));border-radius:4px;
  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));font-size:12px;line-height:17px}
.dsa-a{color:var(--dsw-alias-brand-primary, #0066cc);text-decoration:underline;word-break:break-all}
.dsa-quote{margin:0 0 6px;padding:6px 10px;border-left:3px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  border-radius:4px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
  font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary, #555)}
.dsa-table{border-collapse:collapse;margin:0 0 6px;font-size:12px;max-width:100%}
.dsa-table th,.dsa-table td{border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  padding:4px 8px;text-align:left;word-break:break-word;vertical-align:top}
.dsa-table th{background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));font-weight:600}
.dsa-pre-wrap{position:relative;margin:0 0 6px}
.dsa-pre-wrap .dsa-pre{margin:0}
.dsa-code-copy{position:absolute;top:4px;right:4px;padding:1px 7px;line-height:16px;
  font-size:12px;opacity:.72;background:var(--dsw-alias-bg-overlay, #fff)}
.dsa-code-copy:hover,.dsa-code-copy:focus-visible{opacity:1}
.dsa-pre{margin:0 0 6px;padding:8px;border-radius:8px;overflow:auto;
  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));font-size:12px;line-height:17px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsa-code{padding:0 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dsa-muted{color:var(--dsw-alias-label-secondary, #666);font-size:11px;line-height:16px}
.dsa-error{color:var(--dsw-alias-state-error-primary, #c0392b);font-size:12px}
.dsa-toast{pointer-events:auto;position:fixed;left:50%;transform:translateX(-50%);bottom:24px;padding:6px 12px;
  border-radius:999px;font-size:12px;background:var(--dsw-alias-bg-overlay, #222);
  color:var(--dsw-alias-label-primary, #eee);border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3))}
.dsa-settings{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary, #111)}
.dsa-field{display:flex;flex-direction:column;gap:4px}
.dsa-field > label{font-size:12px;color:var(--dsw-alias-label-secondary, #555)}
.dsa-input{padding:5px 8px;border-radius:8px;font:inherit;font-size:13px;box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));
  background:var(--dsw-alias-bg-layer-1, transparent);color:inherit}
.dsa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.dsa-check{display:flex;align-items:center;gap:6px;font-size:12px}
/* Quick-action editor (settings page): one wrapped row per action. */
.dsa-qa{display:flex;flex-direction:column;gap:8px}
.dsa-qa-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:8px;border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));border-radius:8px}
.dsa-qa-row .dsa-input{flex:1;min-width:120px}
.dsa-qa-question{flex-basis:100%!important;min-width:0!important}
.dsa-qa-head{display:flex;align-items:center;gap:8px;font-size:12px;
  color:var(--dsw-alias-label-secondary, #555)}
/* History-card manager (settings page). */
.dsa-hist{display:flex;flex-direction:column;gap:8px}
.dsa-hist-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:8px;border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));border-radius:8px}
.dsa-hist-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.dsa-hist-q{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:var(--dsw-alias-label-primary, #111)}
.dsa-hist-meta{font-size:11px;color:var(--dsw-alias-label-secondary, #777)}
.dsa-diag{display:flex;flex-direction:column;gap:2px;font-size:12px;
  color:var(--dsw-alias-label-secondary, #555)}
/* §4.5 legacy coexistence: an unmarked dsa-layer can only be the old
   dsh-selection-followup ≤1.0.x build. When this build is the elected
   leader it hides the old build's whole interaction surface so exactly
   one trigger button / popover answers the selection. Our own layer always
   carries data-dsa-owner, so this never matches current-generation UI. */
.dsa-layer:not([data-dsa-owner]){display:none!important}
.dsa-family-notice{padding:8px 10px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-state-warn-primary, #b8860b);
  color:var(--dsw-alias-state-warn-primary, #b8860b)}
`

    /** Render the stylesheet as a React element (removed with its component). */
    function Styles() {
      return h('style', { 'data-dsa-style': '' }, CSS_TEXT)
    }

    /** Inline markdown-lite: `code`, **bold**, *italic*, [label](http url) — never innerHTML. */
    function inlineNodes(text, key) {
      const out = []
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) out.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          out.push(h('code', { key: `c${key}-${index++}`, className: 'dsa-code' }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          out.push(h('strong', { key: `b${key}-${index++}` }, token.slice(2, -2)))
        } else if (token.startsWith('*')) {
          out.push(h('em', { key: `i${key}-${index++}` }, token.slice(1, -1)))
        } else {
          // [label](url). The protocol allow-list (http/https only) is the
          // whole security story: a model answer must not be able to make a
          // `javascript:` or `data:` URL clickable. The label stays plain
          // text — no nested syntax inside a link label.
          const split = token.indexOf('](')
          out.push(h('a', {
            key: `a${key}-${index++}`,
            className: 'dsa-a',
            href: token.slice(split + 2, -1),
            target: '_blank',
            rel: 'noopener noreferrer',
          }, token.slice(1, split)))
        }
        last = match.index + token.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    /**
     * Render answer text as React nodes: fenced code, lists, headings,
     * blockquotes, tables, paragraphs. No HTML injection anywhere, so model
     * output cannot become markup.
     */
    function renderRichText(text) {
      const lines = String(text ?? '').split('\n')
      const nodes = []
      let i = 0
      let key = 0
      const isBullet = line => /^\s*([-*+]|\d+\.)\s+/.test(line)
      const isHeading = line => /^#{1,6}\s+/.test(line)
      const isQuote = line => /^>\s?/.test(line)
      // A GFM table separator: `|---|---|`, `---|:---:`, whole row nothing
      // but pipes, dashes, colons and spaces.
      const isTableSplit = line => /^\s*\|?[\s:|-]*\|[\s:|-]*$/.test(line)
      const tableCells = rowText => rowText
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map(cell => cell.trim())
      while (i < lines.length) {
        const line = lines[i]
        if (/^```/.test(line)) {
          const body = []
          i += 1
          while (i < lines.length && !/^```/.test(lines[i])) {
            body.push(lines[i])
            i += 1
          }
          i += 1
          const code = body.join('\n')
          // A per-block copy button: answers are code-heavy, and dragging a
          // selection across a scrollable <pre> used to miss lines. The
          // click closes over the code text (never re-read from the DOM), and
          // reuses the same clipboard API → selection fallback as card copy.
          nodes.push(h('div', { key: `f${key++}`, className: 'dsa-pre-wrap' },
            h('pre', { className: 'dsa-pre' }, h('code', null, code)),
            h('button', {
              type: 'button',
              className: 'dsa-btn dsa-btn-icon dsa-code-copy',
              title: t('copyCode'),
              'aria-label': t('copyCode'),
              onClick: (event) => {
                try {
                  const host = event?.currentTarget ?? event?.target
                  const wrap = typeof host?.closest === 'function' ? host.closest('.dsa-pre-wrap') : null
                  const codeNode = wrap !== null && typeof wrap?.querySelector === 'function'
                    ? wrap.querySelector('code')
                    : null
                  void copyText(code, codeNode).then((result) => {
                    toast(result === 'copied'
                      ? t('copied')
                      : result === 'selected' ? t('copySelectedHint') : t('copyFailed'))
                  })
                } catch { /* a clipboard failure must not break the card */ }
              },
            }, '⧉')))
          continue
        }
        if (line.includes('|') && i + 1 < lines.length && isTableSplit(lines[i + 1])) {
          const header = tableCells(line)
          i += 2
          const rows = []
          while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
            rows.push(tableCells(lines[i]))
            i += 1
          }
          nodes.push(h('table', { key: `t${key}`, className: 'dsa-table' },
            h('thead', null, h('tr', null,
              header.map((cell, index) => h('th', { key: `th${key}-${index}` }, inlineNodes(cell, `${key}h-${index}`))))),
            h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: `tr${key}-${rowIndex}` },
              row.map((cell, index) => h('td', { key: `td${key}-${rowIndex}-${index}` }, inlineNodes(cell, `${key}-${rowIndex}-${index}`))))))))
          key += 1
          continue
        }
        if (isBullet(line)) {
          const items = []
          while (i < lines.length && isBullet(lines[i])) {
            items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
            i += 1
          }
          nodes.push(h('ul', { key: `u${key++}`, className: 'dsa-ul' },
            items.map((item, index) => h('li', { key: index }, inlineNodes(item, `${key}-${index}`)))))
          continue
        }
        if (isHeading(line)) {
          nodes.push(h('div', { key: `h${key}`, className: 'dsa-h' }, inlineNodes(line.replace(/^#{1,6}\s+/, ''), key)))
          key += 1
          i += 1
          continue
        }
        if (isQuote(line)) {
          const quoted = []
          while (i < lines.length && isQuote(lines[i])) {
            quoted.push(lines[i].replace(/^>\s?/, ''))
            i += 1
          }
          nodes.push(h('blockquote', { key: `q${key}`, className: 'dsa-quote' },
            quoted.map((row, index) => h('div', { key: `ql${key}-${index}` }, inlineNodes(row, `${key}-${index}`)))))
          key += 1
          continue
        }
        if (line.trim() === '') {
          nodes.push(h('div', { key: `g${key++}`, className: 'dsa-gap' }))
          i += 1
          continue
        }
        const paragraph = []
        while (
          i < lines.length
          && lines[i].trim() !== ''
          && !/^```/.test(lines[i])
          && !isBullet(lines[i])
          && !isHeading(lines[i])
          && !isQuote(lines[i])
        ) {
          paragraph.push(lines[i])
          i += 1
        }
        nodes.push(h('p', { key: `p${key}`, className: 'dsa-p' }, inlineNodes(paragraph.join('\n'), key)))
        key += 1
      }
      return nodes
    }

    /**
     * Rough advance width of a 12px label, in CSS pixels: full-width for CJK
     * ideographs and fullwidth forms, ~0.55em for everything else. The zh
     * trigger label ("追问选中内容") estimates ~72px of text while the en one
     * ("Ask about selection") estimates ~125px — exactly the difference a
     * hard-coded clamp width tuned for zh would miss.
     */
    function estimateLabelWidth(text, fontSize = 12) {
      let units = 0
      for (const char of typeof text === 'string' ? text : '') {
        const code = char.codePointAt(0)
        const fullWidth = (code >= 0x2e80 && code <= 0x9fff)
          || (code >= 0xf900 && code <= 0xfaff)
          || (code >= 0xff00 && code <= 0xffef)
          || (code >= 0x30000 && code <= 0x3134f)
        units += fullWidth ? 1 : 0.55
      }
      return units * fontSize
    }

    /** Clamp a fixed-position box into the viewport. */
    function clampBox(rect, width, height, prefer = 'below') {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768
      let left = rect.right + 8
      if (left + width > vw - 8) left = Math.max(8, Math.min(vw - width - 8, rect.left - 8 - width))
      let top = prefer === 'below' ? rect.bottom + 6 : rect.top - height - 6
      if (top + height > vh - 8) top = Math.max(8, vh - height - 8)
      if (top < 8) top = 8
      return { left: Math.round(left), top: Math.round(top) }
    }

    /**
     * Copy text to the clipboard.
     *
     * Only the async Clipboard API is used: this plugin never inserts an
     * element into `document.body` (a hidden textarea is how the legacy
     * `execCommand('copy')` path is usually built, and it would put DOM outside
     * the component tree). When the Clipboard API is unavailable, the rendered
     * answer node is SELECTED instead, so the user can finish with Ctrl+C.
     *
     * @param {string} text - the text to copy.
     * @param {Element|null} [fallbackElement] - the rendered node to select.
     * @returns {Promise<'copied'|'selected'|'failed'>}
     */
    async function copyText(text, fallbackElement) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          return 'copied'
        }
      } catch { /* fall through to the selection fallback */ }
      try {
        if (fallbackElement !== null && fallbackElement !== undefined && typeof window !== 'undefined') {
          const range = document.createRange()
          range.selectNodeContents(fallbackElement)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          return 'selected'
        }
      } catch { /* report the failure below */ }
      return 'failed'
    }

    /** The zone badge label for a candidate. */
    function zoneLabel(candidate) {
      if (candidate.cross) return t('zoneCross')
      if (candidate.zone === 'chat') return t('zoneChat')
      if (candidate.zone === 'task') return t('zoneTask')
      return t('zoneOther')
    }

    // ─────────────────────────────────────────────────────────────────────
    // §8b 1.8.0 P2 helpers: export, source-locating, answer versions
    // ─────────────────────────────────────────────────────────────────────

    /** Mirrors the Host's cap (contract-asserted); counted in code points. */
    const MAX_CUSTOM_PERSONA_CHARS = 500
    /** Code points kept on each side of a passage signature. */
    const LOCATE_HEAD_POINTS = 40
    const LOCATE_TAIL_POINTS = 40
    /** How long a located passage stays highlighted. */
    const LOCATE_HIGHLIGHT_MS = 4000
    /** The highlight registry name (`CSS.highlights` is page-wide). */
    const LOCATE_HIGHLIGHT_NAME = 'dsa-locate'
    /** How many older answers one card keeps (P2-5b). */
    const MAX_CARD_VERSIONS = 5
    /** Built-in actions whose finished answer is meant to go back into the composer. */
    const REWRITE_ACTION_IDS = ['builtin:polish', 'builtin:fix']

    /**
     * Head/tail signature of a passage, counted in CODE POINTS so an emoji or a
     * Plane-2 glyph is one character on both ends of the comparison.
     *
     * The pair (head, tail, chars) is deliberately cheap: a full passage would
     * be megabytes of comparison work, while 40+40 code points already pin a
     * unique position in a rendered conversation.
     *
     * @param {unknown} text - the selected passage.
     * @param {{head?: number, tail?: number}} [options] - window sizes.
     * @returns {{head: string, tail: string, chars: number}} the signature.
     */
    function buildTextSignature(text, options = {}) {
      const headSize = Number.isFinite(options?.head) ? Math.max(1, Math.round(options.head)) : LOCATE_HEAD_POINTS
      const tailSize = Number.isFinite(options?.tail) ? Math.max(0, Math.round(options.tail)) : LOCATE_TAIL_POINTS
      const points = Array.from(typeof text === 'string' ? text : '')
      if (points.length === 0) return { head: '', tail: '', chars: 0 }
      const head = points.slice(0, headSize).join('')
      const tail = points.length > headSize + tailSize ? points.slice(-tailSize).join('') : ''
      return { head, tail, chars: points.length }
    }

    /**
     * Find a signature in a haystack of page text.
     *
     * Walks every occurrence of the head (not just the first): a conversation
     * that quotes the same opening line twice would otherwise always resolve to
     * the earlier copy, which is the wrong passage. The tail must line up at
     * exactly `chars` away, so a coincidental head-only match is rejected.
     *
     * @param {string} haystack - normalized page text.
     * @param {{head: string, tail: string, chars: number}} signature - from {@link buildTextSignature}.
     * @returns {{start: number, end: number}|null} the matched span, or null.
     */
    function locateSignature(haystack, signature) {
      const source = typeof haystack === 'string' ? haystack : ''
      if (signature === null || typeof signature !== 'object') return null
      const head = typeof signature.head === 'string' ? signature.head : ''
      const tail = typeof signature.tail === 'string' ? signature.tail : ''
      const chars = Number.isFinite(signature.chars) ? Math.round(signature.chars) : 0
      if (head === '' || chars <= 0) return null
      let from = 0
      while (from <= source.length) {
        const start = source.indexOf(head, from)
        if (start === -1) return null
        const end = start + chars
        if (end <= source.length) {
          const expectedTail = tail === '' ? head.slice(-Math.min(head.length, chars)) : tail
          const tailFrom = Math.max(start, end - expectedTail.length)
          if (source.slice(tailFrom, end) === expectedTail) return { start, end }
        }
        from = start + 1
      }
      return null
    }

    /**
     * Markdown for one finished card: question as a heading, the passage as a
     * blockquote, then the answer verbatim (it is already Markdown).
     *
     * Pure so the export can be asserted without touching the DOM or a Blob;
     * `buildCardMarkdown` is also what the card's own `.md` button writes.
     *
     * @param {object} card - a card or a durable history entry.
     * @returns {string} the file body (never empty).
     */
    function buildCardMarkdown(card) {
      const question = String(card?.question ?? '').trim()
      const answer = String(card?.text ?? '')
      const passage = String(card?.selection ?? card?.selected ?? '').trim()
      const parts = []
      if (question !== '') parts.push(`# ${question}`)
      if (passage !== '') {
        // Every line gets its own `>` so a multi-paragraph passage stays one
        // blockquote instead of becoming prose.
        parts.push(passage.split('\n').map(line => `> ${line}`).join('\n'))
      }
      if (answer.trim() !== '') parts.push(answer.trim())
      if (parts.length === 0) return '# (empty card)\n'
      return `${parts.join('\n\n')}\n`
    }

    /**
     * Markdown for the whole history: one `##`-level section per entry with a
     * horizontal rule between them. Deliberately flat (no nested headings) so
     * a model-written `#` inside an answer cannot break the outline.
     *
     * @param {Array<object>} entries - durable history entries.
     * @returns {string} the file body.
     */
    function buildHistoryMarkdown(entries) {
      const list = Array.isArray(entries) ? entries.filter(entry => entry !== null && typeof entry === 'object') : []
      if (list.length === 0) return ''
      const sections = list.map((entry, index) => {
        const body = buildCardMarkdown(entry)
        const question = String(entry?.question ?? '').trim()
        const stamp = formatHistoryTime(entry?.createdAt)
        const meta = [stamp, typeof entry?.provider === 'string' ? entry.provider : ''].filter(Boolean).join(' · ')
        // Demote the card heading from `#` to `##` so the file keeps one H1.
        const demoted = question === '' ? body : body.replace(/^# /, '## ')
        const head = meta === '' ? '' : `<!-- ${index + 1} · ${meta} -->\n`
        return `${head}${demoted.trimEnd()}`
      })
      return `# dsh-sidecard-ask history\n\n${sections.join('\n\n---\n\n')}\n`
    }

    /** `YYYY-MM-DD-HHMM` file stamp in LOCAL time; '' for an unusable value. */
    function fileStamp(at) {
      const value = Number(at)
      if (!Number.isFinite(value) || value <= 0) return ''
      const date = new Date(value)
      const pad = n => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
    }

    /** Download file name for one export: `<prefix>-<stamp>.md`. */
    function markdownFilename(at, prefix = 'sidecard-ask') {
      const stamp = fileStamp(at)
      return `${prefix}-${stamp === '' ? 'unknown-time' : stamp}.md`
    }

    /**
     * Normalize page text for signature matching: every whitespace run becomes
     * ONE `\n`, and each normalized character remembers the RAW index it came
     * from, so a match can be mapped back onto real DOM offsets.
     *
     * The selection a user makes across two paragraphs carries `\n\n`, while
     * the DOM text nodes carry no separator at all; normalizing both sides is
     * what makes the two comparable.
     *
     * @param {string} raw - concatenated page text.
     * @returns {{text: string, map: number[]}}
     */
    function normalizeForLocate(raw, mode = 'block') {
      const source = typeof raw === 'string' ? raw : ''
      // `block` keeps ONE newline per whitespace run (paragraph boundaries stay
      // meaningful, so the first attempt is precise). `flow` DROPS whitespace
      // entirely: rich text splits one sentence into several text nodes, which
      // looks like a line break to the block mode but is not one to the reader.
      const flow = mode === 'flow'
      const out = []
      const map = []
      let index = 0
      while (index < source.length) {
        const char = source[index]
        if (/\s/.test(char)) {
          let end = index
          while (end < source.length && /\s/.test(source[end])) end += 1
          if (!flow && out.length > 0) {
            out.push('\n')
            map.push(index)
          }
          index = end
          continue
        }
        out.push(char)
        map.push(index)
        index += 1
      }
      // A trailing separator carries no information and would offset the tail.
      while (out.length > 0 && out[out.length - 1] === '\n') {
        out.pop()
        map.pop()
      }
      return { text: out.join(''), map }
    }

    /**
     * Collect every visible prose text node of the page into one string.
     *
     * Skips this plugin's own UI, script/style nodes, and editable fields: the
     * passage the user selected lived in a read-only message body, and matching
     * it against the composer or our own card would "find" the wrong thing.
     *
     * @param {Document} doc - the page document.
     * @returns {{raw: string, nodes: Array<{node: Text, start: number}>, capped: boolean}|null}
     */
    function collectPageText(doc) {
      if (doc === null || doc === undefined || typeof doc.createTreeWalker !== 'function') return null
      const body = doc.body ?? doc.documentElement
      if (body === null || body === undefined) return null
      let walker
      try {
        walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */, null)
      } catch {
        return null
      }
      const nodes = []
      let raw = ''
      let truncated = false
      const MAX_CHARS = 400_000
      let current = walker.currentNode
      // `nextNode` on a fresh walker already starts at the first text node.
      while (current !== null) {
        const parent = current.parentElement
        if (parent !== null && parent !== undefined) {
          const skip = parent.closest?.('[data-dsa-root],script,style,noscript,textarea,input,select')
          const editable = parent.closest?.('[contenteditable=""],[contenteditable="true"]')
          if (skip === null && editable === null) {
            const value = String(current.nodeValue ?? '')
            if (value !== '') {
              nodes.push({ node: current, start: raw.length })
              raw += value
              raw += '\n'
              if (raw.length > MAX_CHARS) { truncated = true; break }
            }
          }
        }
        current = walker.nextNode()
      }
      return { raw, nodes, capped: truncated }
    }

    /** Map a raw string index onto `{node, offset}` inside the collected nodes. */
    function nodeAtOffset(nodes, index) {
      if (!Array.isArray(nodes) || nodes.length === 0) return null
      let low = 0
      let high = nodes.length - 1
      let found = null
      while (low <= high) {
        const mid = (low + high) >> 1
        if (nodes[mid].start <= index) { found = nodes[mid]; low = mid + 1 } else high = mid - 1
      }
      if (found === null) return null
      const offset = Math.min(String(found.node.nodeValue ?? '').length, Math.max(0, index - found.start))
      return { node: found.node, offset }
    }

    /**
     * Locate a passage in the live page and build a Range over it.
     *
     * @param {string} text - the passage as it was selected.
     * @param {Document} doc - the page document.
     * @returns {{range: Range, mode: 'dom'}|null} the range, or null when the
     *   passage is no longer in this view (virtual list, re-render, edit).
     */
    function locatePassageRange(text, doc) {
      const signature = buildTextSignature(text)
      if (signature.chars === 0) return null
      const collected = collectPageText(doc)
      if (collected === null) return null
      const passage = String(text ?? '')
      // Two passes, precise first: `block` keeps paragraph boundaries, `flow`
      // ignores whitespace entirely for passages split by inline markup.
      for (const mode of ['block', 'flow']) {
        const normalized = normalizeForLocate(collected.raw, mode)
        const target = {
          head: normalizeForLocate(signature.head, mode).text,
          tail: normalizeForLocate(signature.tail, mode).text,
          // The length must be the normalized length of the WHOLE passage: the
          // raw code-point count would be off by every collapsed run.
          chars: normalizeForLocate(passage, mode).text.length,
        }
        if (target.head === '' || target.chars <= 0) continue
        const hit = locateSignature(normalized.text, target)
        if (hit === null) continue
        const rawStart = normalized.map[hit.start]
        const rawEnd = normalized.map[Math.max(0, hit.end - 1)]
        if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue
        // `rawEnd` is the LAST character; the Range end is exclusive.
        const start = nodeAtOffset(collected.nodes, rawStart)
        const end = nodeAtOffset(collected.nodes, rawEnd + 1)
        if (start === null || end === null) continue
        try {
          const range = doc.createRange()
          range.setStart(start.node, start.offset)
          range.setEnd(end.node, end.offset)
          if (range.collapsed === true) continue
          return { range, mode: 'dom' }
        } catch {
          continue
        }
      }
      return null
    }

    /** Clear the page-wide locate highlight (idempotent). */
    function clearLocateHighlight() {
      try {
        const registry = typeof window !== 'undefined' ? window.CSS?.highlights : undefined
        if (registry !== undefined && typeof registry.delete === 'function') registry.delete(LOCATE_HIGHLIGHT_NAME)
      } catch { /* an older browser has no highlight registry */ }
      try {
        const selection = typeof window !== 'undefined' && typeof window.getSelection === 'function'
          ? window.getSelection() : null
        // Only clear a selection THIS helper created (it always spans the mark
        // we set); wiping the user's own selection would be rude.
        if (selection !== null && selection.rangeCount > 0 && selection.__dsaLocated === true) {
          selection.removeAllRanges()
          selection.__dsaLocated = false
        }
      } catch { /* nothing to clear */ }
    }

    /** One pending highlight-clear timer, module-wide (no stacking). */
    let locateTimer = null

    /**
     * Paint one located range and scroll it into view.
     *
     * Preference order is deliberate: the CSS Custom Highlight API does not
     * touch the DOM at all, so a React-controlled conversation never sees a
     * mutation; `window.getSelection()` is the fallback for browsers without
     * the registry. Both are read-only with respect to text nodes — this
     * plugin never edits page content.
     *
     * @param {Range} range - the passage range.
     * @returns {'highlight'|'selection'|'none'} which mechanism won.
     */
    function paintLocatedRange(range) {
      if (range === null || range === undefined) return 'none'
      if (locateTimer !== null) {
        clearTimeout(locateTimer)
        locateTimer = null
      }
      clearLocateHighlight()
      // Scroll first: a range outside the viewport would highlight invisibly.
      try {
        const element = range.startContainer?.parentElement ?? null
        element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      } catch { /* scrolling is best effort */ }
      let mode = 'none'
      try {
        const registry = typeof window !== 'undefined' ? window.CSS?.highlights : undefined
        if (registry !== undefined && typeof registry.set === 'function' && typeof window.Highlight === 'function') {
          registry.set(LOCATE_HIGHLIGHT_NAME, new window.Highlight(range))
          mode = 'highlight'
        }
      } catch { /* fall through to the selection path */ }
      if (mode === 'none') {
        try {
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          selection.__dsaLocated = true
          mode = 'selection'
        } catch { /* an unselectable range (detached node) */ }
      }
      locateTimer = setTimeout(() => {
        locateTimer = null
        clearLocateHighlight()
      }, LOCATE_HIGHLIGHT_MS)
      return mode
    }

    /**
     * Download a text file without adding anything to `document.body`.
     *
     * The anchor is never appended: this plugin is forbidden from writing into
     * `document.body` (it would put DOM outside the component tree), and
     * Chromium/Safari fire `click()` on a detached anchor. A browser that
     * insists on a connected anchor simply gets no download — the caller shows
     * the failure instead of pretending it worked.
     *
     * @returns {'ok'|'unsupported'|'failed'}
     */
    function downloadMarkdown(filename, content) {
      let url = null
      try {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return 'unsupported'
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return 'unsupported'
        const blob = new Blob([String(content ?? '')], { type: 'text/markdown;charset=utf-8' })
        url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = String(filename ?? 'export.md')
        anchor.rel = 'noopener'
        anchor.style.display = 'none'
        anchor.click()
        return 'ok'
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] export failed:`, error)
        return 'failed'
      } finally {
        // The object URL must be released even when the click itself threw.
        if (url !== null) {
          try { URL.revokeObjectURL(url) } catch { /* already gone */ }
        }
      }
    }

    /**
     * Whether one card may offer "insert into the composer".
     *
     * All four must hold: a finished side answer with text, a rewrite-style
     * action (the feature exists for 润色/纠错, not for every Q&A), and a live
     * write path. `support` comes from {@link composerWriteSupport}; passing
     * it in keeps this decision pure and testable.
     *
     * @param {object} card - the card.
     * @param {'actions'|'dom'|'none'} support - live write capability.
     * @returns {boolean}
     */
    function canInsertAnswer(card, support) {
      if (card === null || card === undefined) return false
      if (card.carrier !== 'side') return false
      if (card.status !== 'done' && card.status !== 'stopped') return false
      if (String(card.text ?? '').trim() === '') return false
      if (!REWRITE_ACTION_IDS.includes(String(card.actionId ?? ''))) return false
      return support === 'actions' || support === 'dom'
    }

    /**
     * Push one snapshot of a card's current answer onto its version list.
     *
     * Pure and bounded: an empty answer is not a version (retrying an errored
     * card must not create a blank entry), and the oldest entry is dropped past
     * the cap, because a card's version history is a convenience, not an
     * archive.
     *
     * @param {unknown} versions - the current list.
     * @param {{question?: string, text?: string, reasoning?: string, at?: number}} snapshot
     * @param {number} [limit] - cap, defaults to {@link MAX_CARD_VERSIONS}.
     * @returns {Array<object>} the next list (same array identity is not required).
     */
    function withVersion(versions, snapshot, limit = MAX_CARD_VERSIONS) {
      const list = Array.isArray(versions)
        ? versions.filter(entry => entry !== null && typeof entry === 'object' && typeof entry.text === 'string')
        : []
      const text = String(snapshot?.text ?? '')
      if (text.trim() === '') return list.slice(-limit)
      const entry = {
        question: String(snapshot?.question ?? ''),
        text,
        reasoning: String(snapshot?.reasoning ?? ''),
        at: Number.isFinite(snapshot?.at) ? snapshot.at : Date.now(),
      }
      const last = list[list.length - 1]
      // A retry that produced nothing new must not fill the list with copies.
      if (last !== undefined && last.text === entry.text && last.question === entry.question) return list
      return [...list, entry].slice(-Math.max(1, limit))
    }

    /**
     * The patch that preserves a card's current answer before a retry
     * replaces it (P2-5b). `viewingVersion` always resets, because the version
     * the reader was looking at may no longer be the one they get back.
     *
     * @param {object} card - the live card.
     * @returns {{versions: Array<object>, viewingVersion: null}}
     */
    function versionPatch(card) {
      return {
        versions: withVersion(card?.versions, {
          question: card?.question,
          text: card?.text,
          reasoning: card?.reasoning,
          at: Date.now(),
        }),
        viewingVersion: null,
      }
    }

    // ── P2-2: write an answer back into the composer ────────────────────
    //
    // Probe result (2026-10-17, real DSH 0.2.x page, headless Edge):
    //   · the composer is a Lexical contenteditable div
    //     (`[data-composer-input][data-lexical-editor="true"]`), NOT a textarea;
    //   · `document.execCommand('insertText')` returns false and moves NOTHING;
    //   · a synthetic `beforeinput` InputEvent(inputType:'insertText') IS
    //     honoured: the text lands and the send button enables;
    //   · the sanctioned API is the slot-provided `inputActions` face:
    //     `captureInsertion()` + `insertText(text, span)` + `setDraft(text)`.
    //
    // So the write ladder is: action face → DOM beforeinput → give up loudly.
    // A caret-precise insert through a DOM Range did NOT work (Lexical keeps
    // its own selection model), which is why the DOM rung appends at the end.

    /** The composer element this page renders, or null. */
    function findComposerElement() {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null
      // The first two selectors are the DSH composer itself (probe-verified);
      // the third only matches a textarea INSIDE the conversation slot, so a
      // stray textarea in some other plugin's panel is never written to.
      for (const selector of ['[data-composer-input]', '[data-lexical-editor="true"]', '[data-slot^="conversation"] textarea']) {
        try {
          const found = document.querySelector(selector)
          if (found !== null && found !== undefined) return found
        } catch { return null }
      }
      return null
    }

    /** What can be written to right now: `actions` (best), `dom`, or `none`. */
    let composerProbeAt = 0
    let composerProbe = null
    function composerWriteSupport() {
      if (capturedComposerActions !== null
        && typeof capturedComposerActions.insertText === 'function'
        && typeof capturedComposerActions.captureInsertion === 'function') {
        return 'actions'
      }
      // The probe is a couple of `querySelector` calls; caching it briefly
      // keeps it off the streaming render path without going stale for long.
      const now = Date.now()
      if (composerProbe !== null && now - composerProbeAt < 1500) return composerProbe
      composerProbe = findComposerElement() === null ? 'none' : 'dom'
      composerProbeAt = now
      return composerProbe
    }

    /** The editable element focused before our popover took focus, or null. */
    let capturedComposer = null
    /** The caret span handed out by `inputActions.captureInsertion()`. */
    let composerSpan = null

    /**
     * Remember the composer (and its selection) BEFORE our UI steals focus.
     *
     * Called when the popover opens and when a chip/card action fires. Reading
     * `document.activeElement` is only meaningful at that instant: one
     * `textarea.focus()` inside the popover and the composer is no longer it.
     *
     * @returns {{element: Element, kind: 'field'|'editor', start: number|null, end: number|null}|null}
     */
    function captureComposerTarget() {
      const element = typeof document !== 'undefined' ? document.activeElement : null
      if (element === null || element === undefined) return null
      // Never capture OUR OWN inputs: a chip inside the popover is clicked
      // while the popover's textarea owns focus, and remembering that would
      // later "insert" into a closed popover instead of the composer.
      const own = typeof element.closest === 'function' ? element.closest('[data-dsa-root]') : null
      if (own !== null && own !== undefined) return null
      const tag = String(element.tagName ?? '')
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        capturedComposer = {
          element,
          kind: 'field',
          start: Number.isInteger(element.selectionStart) ? element.selectionStart : null,
          end: Number.isInteger(element.selectionEnd) ? element.selectionEnd : null,
        }
        return capturedComposer
      }
      const editable = element.getAttribute?.('contenteditable')
      if (editable === '' || editable === 'true') {
        capturedComposer = { element, kind: 'editor', start: null, end: null }
        return capturedComposer
      }
      return null
    }

    /** Whether "replace the passage in the composer" is offerable at all. */
    function composerReplaceAvailable() {
      return capturedComposer !== null
        && capturedComposer.kind === 'field'
        && Number.isInteger(capturedComposer.start)
        && Number.isInteger(capturedComposer.end)
        && capturedComposer.end > capturedComposer.start
    }

    /**
     * Compute the next value of a plain text field.
     *
     * Pure so the insert/replace arithmetic is testable without a DOM: an
     * absent selection means "append", a collapsed one inserts at the caret,
     * and a ranged one replaces that range.
     *
     * @param {unknown} value - the field's current value.
     * @param {unknown} start - selection start (null/undefined = append).
     * @param {unknown} end - selection end.
     * @param {unknown} text - the text to insert.
     * @returns {{value: string, caret: number}}
     */
    function nextComposerValue(value, start, end, text) {
      const source = typeof value === 'string' ? value : ''
      const insert = typeof text === 'string' ? text : ''
      const from = Number.isInteger(start) ? Math.max(0, Math.min(source.length, start)) : source.length
      const to = Number.isInteger(end) ? Math.max(from, Math.min(source.length, end)) : from
      return { value: source.slice(0, from) + insert + source.slice(to), caret: from + insert.length }
    }

    /**
     * Write `text` into the composer.
     *
     * Every failure is a returned reason, never a thrown error, so the caller
     * can always show something: `no-composer`, `stale`, `not-accepted`,
     * `write-failed`.
     *
     * @param {string} text - the answer to insert.
     * @param {{replace?: boolean}} [options] - replace the remembered selection.
     * @returns {{ok: boolean, mode: 'actions'|'field'|'editor'|'none'|'stale'|'failed', reason?: string}}
     */
    function insertIntoComposer(text, options = {}) {
      const body = typeof text === 'string' ? text : ''
      if (body.trim() === '') return { ok: false, mode: 'none', reason: 'empty' }
      const replace = options?.replace === true

      // Rung 1 — the harness's own action face (verified on a real page).
      const actions = capturedComposerActions
      let actionRefused = false
      if (actions !== null
        && typeof actions.insertText === 'function'
        && typeof actions.captureInsertion === 'function') {
        const attempt = (span) => {
          if (span === null || span === undefined) return false
          try {
            // The API answers false when the draft revision moved on.
            return actions.insertText(body, span) !== false
          } catch {
            return false
          }
        }
        if (composerSpan === null) {
          try { composerSpan = actions.captureInsertion() } catch { composerSpan = null }
        }
        if (attempt(composerSpan)) return { ok: true, mode: 'actions' }
        // One re-capture: the user may simply have typed since we remembered.
        try { composerSpan = actions.captureInsertion() } catch { composerSpan = null }
        if (attempt(composerSpan)) return { ok: true, mode: 'actions' }
        // Refused twice. The API rejects BEFORE mutating, so falling through to
        // the DOM rung can only add the text once — and a user who switched
        // editors mid-answer still gets their answer inserted.
        actionRefused = true
      }

      // Rung 2 — the DOM.
      const remembered = capturedComposer?.element
      const element = remembered !== null && remembered !== undefined && remembered.isConnected !== false
        ? remembered
        : findComposerElement()
      if (element === null || element === undefined) {
        return actionRefused
          ? { ok: false, mode: 'stale', reason: 'stale' }
          : { ok: false, mode: 'none', reason: 'no-composer' }
      }
      const tag = String(element.tagName ?? '')
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        const before = String(element.value ?? '')
        const useRange = replace
          && capturedComposer !== null
          && capturedComposer.kind === 'field'
          && capturedComposer.element === element
        const start = useRange ? capturedComposer.start : before.length
        const end = useRange ? capturedComposer.end : before.length
        const plan = nextComposerValue(before, start, end, body)
        try {
          const proto = Object.getPrototypeOf(element)
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          // React controlled inputs ignore a plain assignment: the native
          // setter plus one bubbling `input` event is what moves their state.
          if (typeof setter === 'function') setter.call(element, plan.value)
          else element.value = plan.value
          element.dispatchEvent(new Event('input', { bubbles: true }))
          try { element.setSelectionRange(plan.caret, plan.caret) } catch { /* not a text field */ }
          // A controlled field that silently reverted is a FAILED write, not a
          // success we merely cannot see.
          if (String(element.value ?? '') !== plan.value) {
            return { ok: false, mode: 'failed', reason: 'not-accepted' }
          }
          return { ok: true, mode: 'field' }
        } catch {
          return { ok: false, mode: 'failed', reason: 'write-failed' }
        }
      }
      // A contenteditable (Lexical in DSH): only `beforeinput` is honoured.
      try {
        element.focus?.()
        const doc = element.ownerDocument ?? document
        const view = doc.defaultView ?? window
        const range = doc.createRange()
        range.selectNodeContents(element)
        range.collapse(false)
        const selection = view.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        if (typeof InputEvent !== 'function') return { ok: false, mode: 'failed', reason: 'no-input-event' }
        const event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: body,
        })
        element.dispatchEvent(event)
        const after = String(element.innerText ?? element.textContent ?? '')
        return after.includes(body)
          ? { ok: true, mode: 'editor' }
          : { ok: false, mode: 'failed', reason: 'not-accepted' }
      } catch {
        return { ok: false, mode: 'failed', reason: 'write-failed' }
      }
    }

    // ── P2-4: model-written follow-up suggestions ────────────────────────
    /** How many suggestion chips one answer may carry. */
    const MAX_FOLLOWUP_CHIPS = 3
    /** Code-point cap for ONE suggestion (a runaway question is not a chip). */
    const MAX_FOLLOWUP_CHARS = 120
    /** Cap for the whole block; beyond it the model did not follow the format. */
    const MAX_FOLLOWUP_BLOCK_CHARS = 600
    /** Opening tag, tolerant of `</ followups >` style spacing and case. */
    const FOLLOWUP_OPEN_RE = /<\s*followups\s*>/i
    /** A complete block, global + case-insensitive. */
    const FOLLOWUP_BLOCK_RE = /<\s*followups\s*>([\s\S]*?)<\s*\/\s*followups\s*>/gi
    /** A closing tag without its opener. */
    const FOLLOWUP_CLOSE_RE = /<\s*\/\s*followups\s*>/gi

    /**
     * Split one `<followups>` body on unescaped `|`.
     *
     * `\|` is an escaped separator and survives as a literal pipe — a question
     * like "`a | b` 是什么语法？" must stay ONE chip instead of becoming two
     * broken halves.
     *
     * @param {string} inner - the block body.
     * @returns {string[]} raw question strings (not trimmed yet).
     */
    function splitFollowUpList(inner) {
      const parts = []
      let current = ''
      const source = String(inner ?? '')
      for (let index = 0; index < source.length; index += 1) {
        const char = source[index]
        if (char === '\\' && source[index + 1] === '|') {
          current += '|'
          index += 1
          continue
        }
        if (char === '|') {
          parts.push(current)
          current = ''
          continue
        }
        current += char
      }
      parts.push(current)
      return parts
    }

    /**
     * Strip the follow-up block out of an answer and resolve its questions.
     *
     * Must be tolerant by contract: no block, half a block, a stray closing
     * tag, an oversized block or 40 questions all degrade to "plain answer,
     * no chips". It never throws and never hides prose that came BEFORE the
     * block — the streaming case relies on that.
     *
     * @param {unknown} text - the answer text.
     * @returns {{text: string, followups: string[]}} the prose and up to 3 questions.
     */
    function parseFollowUps(text) {
      let source = typeof text === 'string' ? text : ''
      const blocks = []
      source = source.replace(FOLLOWUP_BLOCK_RE, (_match, inner) => {
        blocks.push(String(inner ?? ''))
        return ''
      })
      // Half-open block (stream cut mid-answer, or the model forgot the close):
      // everything from the opening tag onward is unreliable formatting.
      const dangling = FOLLOWUP_OPEN_RE.exec(source)
      if (dangling !== null) source = source.slice(0, dangling.index)
      source = source.replace(FOLLOWUP_CLOSE_RE, '')
      const followups = []
      const inner = blocks[0]
      if (typeof inner === 'string' && inner.length <= MAX_FOLLOWUP_BLOCK_CHARS) {
        for (const raw of splitFollowUpList(inner)) {
          // Tolerate list decoration the model likes to add ("1. ", "- ", "• ").
          const question = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
          if (question === '') continue
          if (codePointLength(question) > MAX_FOLLOWUP_CHARS) continue
          if (followups.includes(question)) continue
          followups.push(question)
          if (followups.length >= MAX_FOLLOWUP_CHIPS) break
        }
      }
      return { text: source.replace(/\n{3,}/g, '\n\n').trim(), followups }
    }

    /**
     * What to render WHILE a card is still streaming.
     *
     * The block must never flash as prose: from an unclosed `<followups>` on,
     * everything is hidden, and so is a trailing PARTIAL tag (`<fol`,
     * `</follow`) — those few characters would otherwise appear for a frame
     * every time a chunk boundary splits the marker.
     *
     * @param {unknown} text - the streaming text so far.
     * @returns {string} the visible prefix.
     */
    function streamVisibleText(text) {
      let source = typeof text === 'string' ? text : ''
      source = source.replace(FOLLOWUP_BLOCK_RE, '')
      const open = FOLLOWUP_OPEN_RE.exec(source)
      if (open !== null) return source.slice(0, open.index)
      const at = source.lastIndexOf('<')
      if (at === -1) return source
      const tail = source.slice(at)
      const partial = /^<\s*(\/?)\s*([a-z]*)\s*>?$/i.exec(tail)
      if (partial === null) return source
      const name = partial[2].toLowerCase()
      // Both `followups` and `/followups` share the name; a lone '<' (empty
      // name) is a marker in progress too.
      if (name === '' || 'followups'.startsWith(name)) return source.slice(0, at)
      return source
    }


    // ─────────────────────────────────────────────────────────────────────
    // §9 components
    // ─────────────────────────────────────────────────────────────────────

    /** The in-place trigger button floating at the selection. */
    function TriggerButton({ candidate, onOpen, embedded = false }) {
      // The clamp width follows the live label: icon + gap + padding + border
      // (~38px of chrome) plus a safety margin, over the estimated label width.
      const width = Math.ceil(estimateLabelWidth(t('triggerLabel')) + 62)
      const box = embedded ? null : clampBox(candidate.rect, width, 30, 'below')
      return h('button', {
        type: 'button',
        className: embedded ? 'dsa-trigger dsa-trigger-embedded' : 'dsa-trigger',
        style: embedded ? undefined : { left: `${box.left}px`, top: `${box.top}px` },
        title: t('triggerHint'),
        'aria-label': `${t('triggerLabel')}：${zoneLabel(candidate)}`,
        onMouseDown: (event) => { event.preventDefault() },
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onOpen()
        },
      }, h('span', { 'aria-hidden': true }, '💬'), h('span', null, t('triggerLabel')))
    }

    /**
     * Compact quick-action chips, shared by the in-place trigger bar and the
     * popover. The trigger bar lays chips out directly (`display:contents`);
     * the popover wraps them in its own borderless chip row.
     */
    function QuickChips({ actions, onPick, inline = false, wrapClassName }) {
      if (!Array.isArray(actions) || actions.length === 0) return null
      // Roving focus with the arrow keys: chip rows sit beside the trigger
      // button and inside the popover, and keyboard users must be able to walk
      // them without Tabbing through the whole page.
      const onChipKeyDown = (event, index) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft'
          && event.key !== 'Home' && event.key !== 'End') return
        const siblings = typeof event.currentTarget?.parentElement?.querySelectorAll === 'function'
          ? [...event.currentTarget.parentElement.querySelectorAll('.dsa-chip')]
          : []
        if (siblings.length === 0) return
        event.preventDefault()
        let next = index
        if (event.key === 'ArrowRight') next = (index + 1) % siblings.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + siblings.length) % siblings.length
        else if (event.key === 'Home') next = 0
        else next = siblings.length - 1
        siblings[next]?.focus?.()
      }
      return h('div', { className: wrapClassName ?? (inline ? 'dsa-quickbar-chips' : 'dsa-pop-chips') },
        actions.map((action, index) => h('button', {
          key: action.id,
          type: 'button',
          className: 'dsa-chip',
          title: typeof action.shortcut === 'string' && action.shortcut.trim() !== ''
            ? `${action.question}\n${action.shortcut}`
            : action.question,
          'aria-label': `${action.label}：${action.question}`,
          onMouseDown: (event) => { event.preventDefault() },
          onKeyDown: event => onChipKeyDown(event, index),
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            onPick(action)
          },
        }, action.label)))
    }

    /**
     * The in-place trigger bar: the main "ask" button followed by every
     * enabled quick action. A chip click skips the popover entirely — the
     * question is fixed and the answer goes straight to the side card.
     */
    function TriggerBar({ candidate, config, onOpen, onQuick }) {
      const actions = quickActionsOf(config)
      const mainWidth = Math.ceil(estimateLabelWidth(t('triggerLabel')) + 62)
      // Rough row width for viewport clamping: main button + 6px gap + an
      // estimate per chip (label + ~24px padding/chrome). Wrapped rows cost
      // height, not width, so the clamp stays usable even when it wraps.
      const chipsWidth = actions.reduce(
        (sum, action) => sum + Math.ceil(estimateLabelWidth(action.label) + 24), 0)
      const rowWidth = Math.min(620, mainWidth + (actions.length > 0 ? 6 + chipsWidth : 0))
      const box = clampBox(candidate.rect, rowWidth, 34, 'below')
      return h('div', {
        className: 'dsa-quickbar',
        style: { left: `${box.left}px`, top: `${box.top}px` },
        onMouseDown: event => event.stopPropagation(),
      },
        h(TriggerButton, { candidate, onOpen, embedded: true }),
        h(QuickChips, { actions, onPick: onQuick, inline: true }))
    }

    /**
     * The selection context menu (#8). Opens at the cursor with the main Ask
     * entry plus the FIRST THREE enabled quick actions (kept short so it
     * never grows past a normal context menu). This is a capability-gated
     * overlay: the listener only suppresses the native menu when config
     * allows it AND the candidate passes the same shouldOffer() gate as the
     * trigger button.
     */
    const CONTEXT_MENU_ACTION_LIMIT = 3
    function SelectionContextMenu({ candidate, position, config, onClose, onOpen, onQuick }) {
      const actions = quickActionsOf(config).slice(0, CONTEXT_MENU_ACTION_LIMIT)
      // Cursor rect: clampBox reads left/top/right/bottom.
      const point = {
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        right: position?.x ?? 0,
        bottom: position?.y ?? 0,
        width: 0,
        height: 0,
      }
      const box = clampBox(point, 200, 40 + actions.length * 31, 'below')
      const item = (glyph, label, onClick, badge) => h('button', {
        type: 'button',
        className: 'dsa-ctx-item',
        onMouseDown: event => event.preventDefault(),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onClose()
          onClick()
        },
      }, h('span', { 'aria-hidden': true }, glyph), h('span', null, label),
        badge !== undefined ? h('span', { className: 'dsa-ctx-badge' }, badge) : null)
      return h('div', {
        className: 'dsa-ctxmenu',
        role: 'menu',
        'aria-label': t('askTitle'),
        style: { left: `${box.left}px`, top: `${box.top}px` },
        onMouseDown: event => event.stopPropagation(),
        onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } },
      },
        item('💬', t('triggerLabel'), () => onOpen(candidate), zoneLabel(candidate)),
        actions.length > 0 ? h('div', { className: 'dsa-ctx-sep', 'aria-hidden': true }) : null,
        actions.map(action => h('button', {
          key: action.id,
          type: 'button',
          role: 'menuitem',
          className: 'dsa-ctx-item',
          onMouseDown: event => event.preventDefault(),
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            onQuick(action)
          },
        }, h('span', null, action.label))))
    }

    /** The question popover. */
    function AskPopover({ candidate, config, onClose, onSubmit, onQuick }) {
      const [question, setQuestion] = React.useState('')
      const [carrier, setCarrier] = React.useState(config.defaultCarrier)
      const [busy, setBusy] = React.useState(false)
      const areaRef = React.useRef(null)
      const cut = truncateSelection(candidate.text, config.maxChars)
      const box = clampBox(candidate.rect, 420, 300, 'below')
      const quickActions = quickActionsOf(config)

      React.useEffect(() => {
        const area = areaRef.current
        if (area !== null) area.focus()
      }, [])

      const submit = async () => {
        const text = question.trim()
        if (text === '' || busy) return
        setBusy(true)
        try {
          await onSubmit({ question: text, carrier })
        } finally {
          setBusy(false)
        }
      }

      return h('div', {
        className: 'dsa-pop',
        style: { left: `${box.left}px`, top: `${box.top}px` },
        role: 'dialog',
        'aria-label': t('askTitle'),
        onMouseDown: event => event.stopPropagation(),
        onKeyDown: (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          // Alt+1..9 fires the Nth chip without leaving the keyboard. The alt
          // modifier keeps it from colliding with ordinary digit input, and a
          // composing IME sequence must pass through untouched.
          if (event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing
            && /^[1-9]$/.test(event.key)) {
            const index = Number(event.key) - 1
            const action = quickActions[index]
            if (action !== undefined) {
              event.preventDefault()
              onQuick(action)
            }
            return
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            void submit()
          }
        },
      },
      h('div', { className: 'dsa-row' },
        h('span', { className: 'dsa-title' }, t('askTitle')),
        h('span', { className: 'dsa-badge' }, zoneLabel(candidate)),
        h('span', { className: 'dsa-badge' }, t('chars', { n: codePointLength(candidate.text) })),
        cut.truncated
          ? h('span', { className: 'dsa-badge dsa-badge-warn' }, t('truncatedBadge', { n: cut.droppedChars }))
          : null),
      h('pre', { className: 'dsa-quote' },
        codePointLength(candidate.text) > 400
          ? `${Array.from(candidate.text).slice(0, 400).join('')}…`
          : candidate.text),
      // Same chips as the in-place bar: shortcut-only users reach them via
      // Alt+Q, and a click here submits directly (the popover closes because
      // submit/quickAsk both clear `popover`).
      h(QuickChips, { actions: quickActions, onPick: action => onQuick(action) }),
      h('textarea', {
        ref: areaRef,
        className: 'dsa-textarea',
        value: question,
        placeholder: t('askPlaceholder'),
        onChange: event => setQuestion(event.target.value),
      }),
      h('div', { className: 'dsa-row' },
        h('span', { className: 'dsa-muted' }, t('carrier')),
        h('div', { className: 'dsa-seg' },
          h('button', {
            type: 'button',
            'data-on': String(carrier === 'main'),
            title: t('carrierMainHint'),
            onClick: () => setCarrier('main'),
          }, t('carrierMain')),
          h('button', {
            type: 'button',
            'data-on': String(carrier === 'side'),
            title: t('carrierSideHint'),
            onClick: () => setCarrier('side'),
          }, t('carrierSide')))),
      h('div', { className: 'dsa-row', style: { justifyContent: 'flex-end' } },
        h('span', { className: 'dsa-muted', style: { marginRight: 'auto' } },
          t('askShortcutHint', { key: config.shortcut })),
        h('button', { type: 'button', className: 'dsa-btn', onClick: onClose }, t('askCancel')),
        h('button', {
          type: 'button',
          className: 'dsa-btn dsa-btn-primary',
          disabled: busy || question.trim() === '',
          onClick: () => { void submit() },
        }, t('askSubmit'))))
    }

    /** The streamed answer card body, shared by every surface. */
    function AnswerBody({ card, containerRef }) {
      // The reasoning stream is collapsible on purpose: it is diagnostic
      // context, not the answer, and a long chain-of-thought would otherwise
      // bury the answer the user asked for. Collapsed by default, open on
      // demand — the text inside still streams live while it is open.
      const reasoning = typeof card.reasoning === 'string' && card.reasoning !== ''
        ? h('details', { className: 'dsa-details' },
            h('summary', null, t('reasoningTitle')),
            h('div', { className: 'dsa-reasoning' }, renderRichText(card.reasoning)))
        : null
      // P2-4: the `<followups>` block is machine-readable scaffolding, never
      // prose. While streaming it is hidden from the first unclosed tag (a
      // half-written marker must not flash); once terminal the whole block is
      // stripped and only the answer is rendered.
      const bodyText = card.status === 'streaming'
        ? streamVisibleText(card.text)
        : parseFollowUps(card.text).text
      // Follow the stream only while the reader sits at the bottom; scrolling
      // up to reread an earlier paragraph must win over the auto-scroll. The
      // 48px slack keeps single-line deltas from losing the tail.
      React.useEffect(() => {
        if (card.status !== 'streaming') return undefined
        const element = containerRef?.current
        if (element === null || element === undefined) return undefined
        if (element.scrollHeight - element.scrollTop - element.clientHeight <= 48) {
          element.scrollTop = element.scrollHeight
        }
        return undefined
      }, [card.text, card.reasoning, card.status, containerRef])
      if (card.error !== null) {
        const engineMissing = card.error.code === 'no-side-engine' || card.error.code === 'no-parent'
        return h('div', { className: 'dsa-error' },
          h('div', { className: 'dsa-title' }, t('errorTitle')),
          h('div', null, localizeError(card.error)),
          engineMissing ? h('div', { className: 'dsa-muted' }, t('errorNoSideEngine')) : null)
      }
      // `bodyText`, not `card.text`: an answer that so far contains ONLY a
      // <followups> block has no prose to show yet, and an empty body with a
      // live "作答中…" line beats a blank rectangle.
      if (bodyText === '' && card.status === 'streaming') {
        return h('div', null, reasoning, h('div', { className: 'dsa-muted' }, t('answerStreaming')))
      }
      if (bodyText === '' && card.status === 'done') {
        return h('div', null, reasoning, h('div', { className: 'dsa-muted' }, t('answerEmpty')))
      }
      return h('div', { className: 'dsa-answer', ref: containerRef },
        reasoning, renderRichText(bodyText))
    }

    /** Card footer: status, copy, follow-up, retry/edit-retry, close. */
    function CardActions({ card, onCopy, onFollowUp, onRetry, onRetryEdit, onClose, onCancel, onSendToMain, onLocate, onExport, onInsert, onReplace, readOnly = false }) {
      const terminal = card.status === 'done' || card.status === 'error' || card.status === 'stopped'
      const hasSelection = String(card.selection ?? '').trim() !== ''
      const hasAnswer = String(card.text ?? '').trim() !== ''
      // P2-2: only a rewrite answer, only with a live write path.
      const insertable = canInsertAnswer(card, composerWriteSupport())
      return h('div', { className: 'dsa-row' },
        h('span', { className: 'dsa-muted' },
          card.status === 'streaming' ? t('answerStreaming')
            : card.status === 'done' ? (card.streaming === false ? t('answerNonStreaming') : t('answerDone'))
              : card.status === 'stopped' ? t('answerStopped') : t('answerTitle')),
        card.status === 'streaming'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onCancel }, t('cancelAnswer'))
          : null,
        terminal && !readOnly && card.status !== 'done' && card.carrier === 'side'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onRetry }, t('retry'))
          : null,
        // Edit & retry is available for EVERY terminal side card: a typo in
        // the question used to invalidate the whole card (plain retry only
        // resends verbatim), and an error card can be corrected the same way.
        terminal && !readOnly && card.carrier === 'side'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onRetryEdit }, t('retryEdit'))
          : null,
        card.status === 'error' && !readOnly && card.carrier === 'side'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onSendToMain }, t('sendToMain'))
          : null,
        terminal && card.text !== ''
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onCopy }, t('copy'))
          : null,
        // 1.8.0 P2-3: jump back to the passage. Offered whenever the card
        // still knows what was selected; a click that finds nothing explains
        // itself instead of doing nothing (virtual lists do lose passages).
        hasSelection
          ? h('button', {
            type: 'button',
            className: 'dsa-btn',
            title: t('locateHint'),
            onClick: onLocate,
          }, t('locate'))
          : null,
        // 1.8.0 P2-5a: the answer is already Markdown, so the export is a
        // straight concatenation — no re-rendering, no fidelity loss.
        hasAnswer
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onExport }, t('exportMd'))
          : null,
        // 1.8.0 P2-2: a rewrite goes back into the composer. Offered only when
        // a write path really exists — a dead button is worse than no button.
        insertable
          ? h('button', {
            type: 'button',
            className: 'dsa-btn',
            title: t('insertHint'),
            onClick: onInsert,
          }, t('insertToComposer'))
          : null,
        insertable && composerReplaceAvailable()
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onReplace }, t('insertReplace'))
          : null,
        terminal && !readOnly
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onFollowUp }, t('followUp'))
          : null,
        h('button', {
          type: 'button',
          className: 'dsa-btn',
          style: { marginLeft: 'auto' },
          onClick: onClose,
        }, t('close')))
    }

    /**
     * One answer card; `embedded` is true inside a host's tab.
     *
     * `onFloatMode` is passed ONLY by the floating layer: it renders the
     * collapse/hide controls that let the user get the layer out of the way
     * (the layer is the only surface that can cover the conversation). A host
     * tab that embeds the same card passes no callback and gets no buttons.
     */
    function AnswerCard({ card, surfaceLabel, onCopy, onFollowUp, onRetry, onRetryEdit, onClose, onCancel, onSendToMain, onFloatMode, onLocate, onExport, onInsert, onReplace, onViewVersion }) {
      const [followOpen, setFollowOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      // Edit-&-retry editor: prefilled with the card's CURRENT question and
      // kept separate from the follow-up draft (follow-up appends a turn;
      // edit-retry regenerates THIS turn, keeping the card's earlier turns).
      const [editOpen, setEditOpen] = React.useState(false)
      const [editDraft, setEditDraft] = React.useState('')
      const answerRef = React.useRef(null)
      const config = store.state.config
      // P2-5b: an older version is READ-ONLY content swapped into the same
      // body. Keeping it out of the store means "back to latest" is just a
      // click, never a re-fetch.
      const versions = Array.isArray(card.versions) ? card.versions : []
      const viewingVersion = Number.isInteger(card.viewingVersion)
        && card.viewingVersion >= 0 && card.viewingVersion < versions.length
        ? card.viewingVersion
        : null
      const shown = viewingVersion === null
        ? card
        : {
          ...card,
          question: String(versions[viewingVersion].question ?? ''),
          text: String(versions[viewingVersion].text ?? ''),
          reasoning: String(versions[viewingVersion].reasoning ?? ''),
        }
      const parsedFollowUps = parseFollowUps(card.text)
      // Icon-only, so the header row keeps one line: the full labels
      // ("收起为胶囊（不遮挡对话）") are 12+ characters each and would wrap the
      // title bar. The words stay on `title`/`aria-label`.
      const floatControl = (mode, labelKey, glyph) => h('button', {
        type: 'button',
        className: 'dsa-btn dsa-btn-icon',
        title: t(labelKey),
        'aria-label': t(labelKey),
        onClick: () => onFloatMode(mode),
      }, glyph)
      // #10: the card is keyboard-focusable; R retries a failed/stopped run,
      // C copies the answer, Esc releases focus. Plain keys are accepted only
      // without modifiers and never while composing or inside an editor.
      const onCardKeyDown = (event) => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
        const tag = String(event.target?.tagName ?? '')
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON'
          || event.target?.closest?.('[contenteditable=""],[contenteditable="true"]') !== null) {
          if (event.key === 'Escape' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
            event.currentTarget?.blur?.()
          }
          return
        }
        const key = String(event.key ?? '').toLowerCase()
        if (key === 'r' && (card.status === 'error' || card.status === 'stopped')) {
          event.preventDefault()
          onRetry()
        } else if (key === 'c' && card.text !== '') {
          event.preventDefault()
          onCopy(answerRef.current)
        } else if (event.key === 'Escape') {
          event.currentTarget?.blur?.()
        }
      }
      const terminalWithAnswer = (card.status === 'done' || card.status === 'stopped')
        && card.carrier === 'side' && card.text !== ''
      // #9: which model answered and how long it took. provider arrives on the
      // start event; elapsed is measured client-side across the stream.
      const metaBits = []
      if (typeof card.provider === 'string' && card.provider !== '') metaBits.push(`${t('metaProvider')} ${card.provider}`)
      if (typeof card.elapsedMs === 'number' && Number.isFinite(card.elapsedMs) && formatElapsed(card.elapsedMs) !== '') {
        metaBits.push(`${t('metaElapsed')} ${formatElapsed(card.elapsedMs)}`)
      }
      return h('section', {
        className: 'dsa-card',
        'aria-label': t('answerTitle'),
        tabIndex: 0,
        title: t('cardKeysHint'),
        onKeyDown: onCardKeyDown,
      },
        h('div', { className: 'dsa-row' },
          h('span', { className: 'dsa-title' }, t('answerTitle')),
          h('span', { className: 'dsa-badge' }, zoneLabel(card)),
          surfaceLabel !== null ? h('span', { className: 'dsa-badge' }, surfaceLabel) : null,
          card.truncated ? h('span', { className: 'dsa-badge dsa-badge-warn' }, t('truncatedBadge', { n: card.droppedChars })) : null,
          typeof onFloatMode === 'function'
            ? h('span', { className: 'dsa-row', style: { marginLeft: 'auto' } },
              floatControl('capsule', 'floatCollapse', '⇥'),
              floatControl('off', 'floatHide', '×'))
            : null),
        h('pre', { className: 'dsa-quote' }, shown.question),
        versions.length > 0
          ? h('div', { className: 'dsa-row dsa-versions' },
            h('span', { className: 'dsa-muted' }, t('versionsLabel')),
            versions.map((entry, index) => h('button', {
              key: `v${index}`,
              type: 'button',
              className: 'dsa-btn',
              'data-on': String(index === viewingVersion),
              onClick: () => onViewVersion(index),
            }, t('versionN', { n: index + 1 }))),
            viewingVersion !== null
              ? h('button', {
                type: 'button',
                className: 'dsa-btn dsa-btn-primary',
                onClick: () => onViewVersion(null),
              }, t('versionLatest'))
              : null)
          : null,
        viewingVersion !== null
          ? h('div', { className: 'dsa-muted' }, t('versionViewing'))
          : null,
        viewingVersion === null && metaBits.length > 0
          ? h('div', { className: 'dsa-muted' }, metaBits.join(' · '))
          : null,
        h(AnswerBody, { card: shown, containerRef: answerRef }),
        card.toolFilter === 'unsupported'
          ? h('div', { className: 'dsa-muted' }, t('toolGuardUnavailable'))
          : (card.toolFilter === 'inherit' ? h('div', { className: 'dsa-muted' }, t('toolGuardInherited')) : null),
        card.carrier === 'main' && card.status === 'done'
          ? h('div', { className: 'dsa-muted' }, t('mainSentHint'))
          : null,
        followOpen
          ? h('div', { className: 'dsa-field' },
            h('textarea', {
              className: 'dsa-textarea',
              value: draft,
              placeholder: t('followUpPlaceholder'),
              autoFocus: true,
              onChange: event => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                  event.preventDefault()
                  const text = draft.trim()
                  if (text === '') return
                  setDraft('')
                  setFollowOpen(false)
                  onFollowUp(text)
                }
              },
            }))
          : null,
        editOpen
          ? h('div', { className: 'dsa-field' },
            h('textarea', {
              className: 'dsa-textarea',
              value: editDraft,
              placeholder: t('editQuestionPlaceholder'),
              autoFocus: true,
              onChange: event => setEditDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                  event.preventDefault()
                  const text = editDraft.trim()
                  if (text === '') return
                  setEditDraft('')
                  setEditOpen(false)
                  onRetryEdit(text)
                }
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setEditOpen(false)
                }
              },
            }),
            h('div', { className: 'dsa-row', style: { justifyContent: 'flex-end' } },
              h('button', {
                type: 'button',
                className: 'dsa-btn',
                onClick: () => setEditOpen(false),
              }, t('askCancel')),
              h('button', {
                type: 'button',
                className: 'dsa-btn dsa-btn-primary',
                disabled: editDraft.trim() === '',
                onClick: () => {
                  const text = editDraft.trim()
                  if (text === '') return
                  setEditDraft('')
                  setEditOpen(false)
                  onRetryEdit(text)
                },
              }, t('retryAskSubmit'))))
          : null,
        // #7: one-tap refinements of a finished answer. They submit follow-up
        // TURNS through the same handler as the textarea, so the answer stays
        // in history and each chip costs one ordinary request.
        terminalWithAnswer && viewingVersion === null
          ? h(QuickChips, {
            wrapClassName: 'dsa-fu-chips',
            actions: followUpChips(),
            onPick: chip => onFollowUp(chip.question),
          })
          : null,
        // P2-4: chips the MODEL proposed for this answer. The block has
        // already been stripped from the body; a missing/half/oversized block
        // simply yields none. Clicking one submits an ordinary follow-up turn.
        //
        // The ROW follows `followUpSuggestions`, while the STRIP above stays
        // unconditional: the toggle owns "do we offer the feature", and a
        // stray block from a model must never render as raw prose even when
        // the user never asked for chips.
        terminalWithAnswer && viewingVersion === null && config.followUpSuggestions === true
          && parsedFollowUps.followups.length > 0
          ? h('div', { className: 'dsa-sug' },
            h('span', { className: 'dsa-muted' }, t('suggestionsLabel')),
            h(QuickChips, {
              wrapClassName: 'dsa-fu-chips dsa-sug-chips',
              actions: parsedFollowUps.followups.map((question, index) => ({
                id: `sug-${index}`,
                label: question,
                question,
                shortcut: '',
              })),
              onPick: chip => onFollowUp(chip.question),
            }))
          : null,
        h(CardActions, {
          card: shown,
          // An older version is read-only: retry / edit / follow-up all act on
          // the LIVE turn, so showing them here would silently switch context.
          readOnly: viewingVersion !== null,
          onCopy: () => onCopy(answerRef.current),
          onRetry,
          onCancel,
          onSendToMain,
          onLocate: () => onLocate(shown),
          onExport: () => onExport(shown),
          onInsert: () => onInsert(shown),
          onReplace: () => onReplace(shown),
          onRetryEdit: () => {
            // Open with the live question, so reopening after an earlier edit
            // re-edits the question actually asked, not the card's first one.
            setEditDraft(card.question)
            setEditOpen(open => !open)
          },
          onFollowUp: () => setFollowOpen(open => !open),
          onClose,
        }),
        surfaceLabel === null ? h('div', { className: 'dsa-muted' }, `${t('carrierSide')} · max ${config.maxChars}`) : null)
    }

    /**
     * The flow surface, i.e. the floating layer (A).
     *
     * Three shapes, all sharing one right-anchored container:
     *   - `capsule`: a single ~34px pill (status + truncated question). The
     *     default, because a one-line pill cannot bury the conversation.
     *   - `full`: the classic card stack, collapsed on demand.
     *   - `off`: only a small launcher, so nothing covers the page until asked.
     *
     * The width comes from {@link floatPlacement}, so the layer stops growing
     * left as soon as it would cross the conversation column's right boundary.
     */
    function FloatingLayer({ cards, actions }) {
      const containerRef = React.useRef(null)
      const state = useStoreState()
      const visible = cards.filter(card => card.surface === 'flow' && card.open)
      const total = visible.length
      const mode = state.floatMode ?? state.config.floatMode ?? CLIENT_DEFAULTS.floatMode
      const maxWidth = state.config.floatMaxWidth ?? CLIENT_DEFAULTS.floatMaxWidth

      // Measure the conversation column + right rail, then pin the layer's
      // width to what is left. Recomputed on frame resize and on rail toggles
      // (ResizeObserver), not once at mount. Every probe is optional: the test
      // harness's synthetic DOM has no `querySelectorAll`, and an older WebView
      // may have no `ResizeObserver` — neither may break the layer.
      React.useEffect(() => {
        const node = containerRef.current
        if (node === null || node === undefined) return undefined
        const selector = '[data-slot^="conversation"], .rightbar, [data-slot^="sidebar.right"], [data-dsh-panel-host]'
        const all = () => {
          try {
            return typeof document.querySelectorAll === 'function'
              ? [...document.querySelectorAll(selector)]
              : []
          } catch { return [] }
        }
        const one = (query) => {
          try { return typeof document.querySelector === 'function' ? document.querySelector(query) : null } catch { return null }
        }
        let frame = 0
        const apply = () => {
          if (typeof node.style?.setProperty !== 'function') return
          const lane = one('[data-slot^="conversation"]')
          const rail = one('.rightbar, [data-slot^="sidebar.right"], [data-dsh-panel-host]')
          const rootWidth = document.documentElement?.clientWidth ?? window.innerWidth
          const laneRight = lane === null
            ? rootWidth
            : lane.getBoundingClientRect().right
          const railLeft = rail === null ? null : rail.getBoundingClientRect().left
          const placement = floatPlacement({ frameWidth: rootWidth, laneRight, railLeft, maxWidth })
          node.style.setProperty('--dsa-float-w', `${placement.width}px`)
          node.style.setProperty('--dsa-gap-right', `${FLOAT_GAP_RIGHT}px`)
          // Readable placement, so a user report can say WHERE the layer sat.
          node.dataset.layerWidth = String(placement.width)
        }
        const schedule = () => {
          if (typeof window.requestAnimationFrame !== 'function') { apply(); return }
          if (frame !== 0) return
          frame = window.requestAnimationFrame(() => {
            frame = 0
            apply()
          })
        }
        apply()
        let observer = null
        if (typeof window.ResizeObserver === 'function') {
          observer = new window.ResizeObserver(schedule)
          for (const target of all()) {
            try { observer.observe(target) } catch { /* not an element we can watch */ }
          }
        }
        if (typeof window.addEventListener === 'function') window.addEventListener('resize', schedule)
        return () => {
          if (typeof window.removeEventListener === 'function') window.removeEventListener('resize', schedule)
          if (observer !== null) { try { observer.disconnect() } catch { /* already gone */ } }
          if (frame !== 0 && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
        }
      }, [maxWidth, total, mode])

      if (total === 0) return null

      const dot = h('span', {
        className: 'dsa-capsule-dot',
        'data-status': visible.some(card => card.status === 'streaming') ? 'streaming' : visible[0].status,
      })
      const label = visible.some(card => card.status === 'streaming')
        ? t('floatStreaming')
        : t('floatDone', { n: total })
      const firstQuestion = visible[0].question

      const container = children => h('div', {
        className: 'dsa-float',
        'data-dsa-root': '',
        ref: containerRef,
        'data-dsa-float-mode': mode,
      }, children)

      if (mode === 'off') {
        return container(h('button', {
          type: 'button',
          className: 'dsa-launcher',
          title: t('floatRestore'),
          onClick: () => setFloatMode('full'),
        }, dot, t('floatCount', { n: total })))
      }

      if (mode === 'capsule') {
        return container(h('button', {
          type: 'button',
          className: 'dsa-capsule',
          title: t('floatExpand'),
          onClick: () => setFloatMode('full'),
        }, dot, h('span', { className: 'dsa-capsule-label' }, label),
        h('span', { className: 'dsa-capsule-q' }, firstQuestion),
        h('span', { className: 'dsa-capsule-chev' }, '›')))
      }

      return container(h('div', { className: 'dsa-stack' },
        visible.map(card => h(AnswerCard, {
          key: card.id,
          card,
          surfaceLabel: null,
          onCopy: element => actions.copy(card, element),
          onFollowUp: text => actions.followUp(card, text),
          onRetry: () => actions.retry(card),
          onRetryEdit: text => actions.retryEdit(card, text),
          onCancel: () => actions.cancel(card),
          onSendToMain: () => actions.sendToMain(card),
          onClose: () => actions.close(card),
          onLocate: target => actions.locateCard(target ?? card),
          onExport: target => actions.exportCard(target ?? card),
          onInsert: target => actions.insertAnswer(target ?? card),
          onReplace: target => actions.insertAnswer(target ?? card, { replace: true }),
          onViewVersion: index => actions.viewVersion(card, index),
          onFloatMode: setFloatMode,
        }))))
    }

    /** The `shell.overlay` entry: styles + trigger + popover + cards + toast. */
    function OverlayRoot({ actions }) {
      const state = useStoreState()
      // §4.5 a non-leader copy mounts no interaction surface at all (its
      // settings page stays available to explain the situation).
      if (state.familyLeader === false) return null
      const config = state.config
      const candidate = state.trigger
      const popover = state.popover
      return h('div', {
        className: 'dsa-layer',
        'data-dsa-root': '',
        // §4.5 stamps ownership so the legacy-suppression stylesheet can
        // distinguish this build's layer from an unmarked ≤1.0.x layer.
        'data-dsa-owner': OWNER_TOKEN,
      },
        h(Styles, null),
        candidate !== null && popover === null && config.trigger !== 'shortcut'
          ? h(TriggerBar, {
            candidate,
            config,
            onOpen: () => actions.openPopover(candidate),
            onQuick: action => actions.quickAsk(candidate, action),
          })
          : null,
        popover !== null
          ? h(AskPopover, {
            candidate: popover.candidate,
            config,
            onClose: () => actions.closePopover(),
            onSubmit: payload => actions.submit(popover.candidate, payload),
            onQuick: action => actions.quickAsk(popover.candidate, action),
          })
          : null,
        state.contextMenu !== null
          ? h(SelectionContextMenu, {
            candidate: state.contextMenu.candidate,
            position: state.contextMenu.position,
            config,
            onClose: () => actions.closeContextMenu(),
            onOpen: (candidate) => actions.openPopover(candidate),
            onQuick: action => actions.quickAsk(state.contextMenu.candidate, action),
          })
          : null,
        h(FloatingLayer, { cards: state.cards, actions }),
        state.toast !== null ? h('div', { className: 'dsa-toast' }, state.toast) : null)
    }

    /** The settings page (`settings.section`). */
    function SettingsSection({ actions }) {
      const state = useStoreState()
      const [draft, setDraft] = React.useState(state.config)
      const [status, setStatus] = React.useState('idle')
      const [diag, setDiag] = React.useState(null)
      const [historyQuery, setHistoryQuery] = React.useState('')
      const [notifyPerm, setNotifyPerm] = React.useState(
        typeof notificationPermission === 'function' ? notificationPermission() : 'unsupported')
      const config = state.config

      React.useEffect(() => { setDraft(config) }, [config])

      // #5: enabling the toggle asks for the Notification permission
      // immediately, and the resulting verdict is shown beside the checkbox
      // so a denied toggle never looks silently broken.
      const onNotifyToggle = async (enabled) => {
        setDraft({ ...draft, notifyOnDone: enabled })
        if (enabled !== true) return
        if (notifyPerm === 'granted') return
        const result = await requestNotificationPermission()
        setNotifyPerm(result)
        if (result !== 'granted') toast(result === 'unsupported' ? t('notifyUnsupported') : t('notifyDenied'))
        else toast(t('notifyGranted'))
      }

      const field = (label, control, hint) => h('div', { className: 'dsa-field' },
        h('label', null, label),
        control,
        hint !== undefined ? h('span', { className: 'dsa-muted' }, hint) : null)

      const select = (key, options) => h('select', {
        className: 'dsa-input',
        value: String(draft[key]),
        onChange: event => setDraft({ ...draft, [key]: event.target.value }),
      }, options.map(([value, label]) => h('option', { key: value, value }, label)))

      const number = (key, min, max) => h('input', {
        className: 'dsa-input',
        type: 'number',
        min,
        max,
        value: String(draft[key]),
        onChange: event => setDraft({ ...draft, [key]: Number(event.target.value) }),
      })

      /**
       * Provider picker: `auto` plus whatever `/state` reported live. The
       * current draft value is always offered, so a stale saved name or an
       * unreachable host never blanks the select.
       */
      const providerSelect = () => {
        const reported = Array.isArray(state.capabilities?.sideProviders)
          ? state.capabilities.sideProviders.filter(name => typeof name === 'string' && name !== '')
          : []
        const known = ['auto', ...reported]
        const value = String(draft.sideProvider)
        const options = known.includes(value) ? known : [...known, value]
        return h('select', {
          className: 'dsa-input',
          value,
          onChange: event => setDraft({ ...draft, sideProvider: event.target.value }),
        }, options.map(name => h('option', { key: name, value: name }, name)))
      }

      // ── quick-action list editor ───────────────────────────────────────
      // The draft always carries the FULL list (the user layer replaces
      // defaults wholesale): built-in rows are editable only in
      // enabled/shortcut, custom rows also in label/question.
      const qaList = () => (Array.isArray(draft.quickActions) ? draft.quickActions : [])
      const patchAction = (index, patch) => {
        const quickActions = qaList().map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
        setDraft({ ...draft, quickActions })
      }
      const addAction = () => {
        const list = qaList()
        // Host cap is enforced on save; do not even append beyond it.
        if (list.length >= QUICK_ACTION_LIMITS.maxEntries) return
        const id = `custom:${Date.now().toString(36)}-${list.length + 1}`
        setDraft({ ...draft, quickActions: [...list, { id, label: '', question: '', enabled: true, shortcut: '' }] })
      }
      const removeAction = (index) => {
        setDraft({ ...draft, quickActions: qaList().filter((_, i) => i !== index) })
      }
      const quickActionsEditor = h('div', { className: 'dsa-field' },
        h('label', null, t('setQuickActions')),
        h('div', { className: 'dsa-qa' },
          qaList().map((entry, index) => {
            const meta = QUICK_ACTION_BUILTINS[String(entry.id)]
            const isBuiltin = meta !== undefined
            return h('div', { key: `${entry.id}-${index}`, className: 'dsa-qa-row' },
              h('label', { className: 'dsa-check', title: t('qaEnabled') },
                h('input', {
                  type: 'checkbox',
                  checked: entry.enabled !== false,
                  onChange: event => patchAction(index, { enabled: event.target.checked }),
                }),
                t('qaEnabled')),
              isBuiltin ? h('span', { className: 'dsa-badge' }, t('qaBuiltinBadge')) : null,
              isBuiltin
                ? h('span', { className: 'dsa-title' }, t(meta.labelKey))
                : h('input', {
                  className: 'dsa-input',
                  value: String(entry.label ?? ''),
                  maxLength: QUICK_ACTION_LIMITS.labelLength,
                  placeholder: t('qaLabelPlaceholder'),
                  onChange: event => patchAction(index, { label: event.target.value }),
                }),
              h('input', {
                className: 'dsa-input',
                style: { maxWidth: '150px' },
                value: String(entry.shortcut ?? ''),
                maxLength: QUICK_ACTION_LIMITS.shortcutLength,
                placeholder: t('qaShortcutPlaceholder'),
                onChange: event => patchAction(index, { shortcut: event.target.value }),
              }),
              isBuiltin
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dsa-btn',
                  onClick: () => removeAction(index),
                }, t('qaDelete')),
              isBuiltin
                ? h('div', { className: 'dsa-muted dsa-qa-question' }, t(meta.questionKey))
                : h('input', {
                  className: 'dsa-input dsa-qa-question',
                  value: String(entry.question ?? ''),
                  maxLength: QUICK_ACTION_LIMITS.questionLength,
                  placeholder: t('qaQuestionPlaceholder'),
                  onChange: event => patchAction(index, { question: event.target.value }),
                }))
          }),
          h('div', null, h('button', {
            type: 'button',
            className: 'dsa-btn',
            disabled: qaList().length >= QUICK_ACTION_LIMITS.maxEntries,
            onClick: addAction,
          }, t('qaAdd')))),
        h('span', { className: 'dsa-muted' }, t('setQuickActionsHint')))

      const save = async () => {
        if (parseShortcut(draft.shortcut) === null) {
          setStatus(`error:${t('unsupportedTrigger')}`)
          return
        }
        // Pre-flight the quick-action list: the Host would all-or-nothing
        // refuse it anyway, but a local check names the offending row instead
        // of surfacing a wire error after the save.
        const qaResult = validateQuickActionsDraft(draft.quickActions, draft.shortcut)
        if (qaResult.ok === false) {
          setStatus(`error:${t(qaResult.key, qaResult.vars)}`)
          return
        }
        setStatus('saving')
        try {
          await actions.saveConfig(draft)
          setStatus('saved')
        } catch (error) {
          setStatus(`error:${t('saveFailed', { msg: error?.message ?? error })}`)
        }
      }

      // ── history manager (#6) ─────────────────────────────────────────
      const zoneLabelOf = zone => (zone === 'chat' ? t('zoneChat') : zone === 'task' ? t('zoneTask') : t('zoneOther'))
      const query = historyQuery.trim().toLowerCase()
      const filteredHistory = query === ''
        ? state.history
        : state.history.filter(entry =>
          String(entry.question ?? '').toLowerCase().includes(query)
          || String(entry.text ?? '').toLowerCase().includes(query))
      const historySection = h('div', { className: 'dsa-field' },
        h('label', null, `${t('historyTitle')}（${t('historyCount', { n: state.history.length })}）`),
        h('span', { className: 'dsa-muted' }, t('historyDesc')),
        h('input', {
          className: 'dsa-input',
          value: historyQuery,
          placeholder: t('historySearch'),
          onChange: event => setHistoryQuery(event.target.value),
        }),
        state.history.length === 0
          ? h('div', { className: 'dsa-muted' }, t('historyEmpty'))
          : h('div', { className: 'dsa-hist' },
            filteredHistory.length === 0 && query !== ''
              ? h('div', { className: 'dsa-muted' }, t('historyEmpty'))
              : null,
            filteredHistory.map(entry => h('div', { key: entry.id, className: 'dsa-hist-row' },
              h('div', { className: 'dsa-hist-main' },
                h('div', { className: 'dsa-hist-q', title: entry.question }, entry.question),
                h('div', { className: 'dsa-hist-meta' },
                  [
                    zoneLabelOf(entry.zone),
                    formatHistoryTime(entry.createdAt),
                    typeof entry.provider === 'string' && entry.provider !== ''
                      ? `${t('metaProvider')} ${entry.provider}`
                      : '',
                    Number.isFinite(entry.elapsedMs) ? `${t('metaElapsed')} ${formatElapsed(entry.elapsedMs)}` : '',
                  ].filter(part => part !== '').join(' · '))),
              h('button', {
                type: 'button',
                className: 'dsa-btn',
                onClick: () => actions.restoreHistoryCard(entry.id),
              }, t('historyRestore')),
              String(entry.selection ?? '').trim() !== ''
                ? h('button', {
                  type: 'button',
                  className: 'dsa-btn',
                  title: t('locateHint'),
                  onClick: () => actions.locateText(entry.selection),
                }, t('locate'))
                : null,
              h('button', {
                type: 'button',
                className: 'dsa-btn',
                onClick: () => actions.exportCard(entry),
              }, t('exportMd')),
              h('button', {
                type: 'button',
                className: 'dsa-btn',
                onClick: () => {
                  void copyText(String(entry.text ?? '')).then((result) => {
                    toast(result === 'copied' ? t('copied') : result === 'selected' ? t('copySelectedHint') : t('copyFailed'))
                  })
                },
              }, t('copy')),
              h('button', {
                type: 'button',
                className: 'dsa-btn',
                onClick: () => actions.deleteHistoryCard(entry.id),
              }, t('historyDelete')))),
            state.history.length > 0
              ? h('div', { className: 'dsa-row' },
                h('button', {
                  type: 'button',
                  className: 'dsa-btn',
                  onClick: () => actions.exportHistory(),
                }, t('exportAllMd')),
                h('button', {
                  type: 'button',
                  className: 'dsa-btn',
                  onClick: () => {
                    // confirm() is optional in embedded WebViews; when absent,
                    // clear immediately (the manager is explicitly user-driven).
                    if (typeof window.confirm === 'function' && !window.confirm(t('historyClearConfirm'))) return
                    actions.clearHistory()
                  },
                }, t('historyClear')))
              : null))

      // §4.5 a non-leader copy explains why its interaction surface is gone.
      const familyBanner = state.familyLeader === false
        ? h('div', { className: 'dsa-family-notice', role: 'status' },
          t('familySuppressed', { version: (state.familyPeers[0]?.version) ?? '?' }))
        : (state.familyLegacy === true
          ? h('div', { className: 'dsa-family-notice', role: 'status' }, t('familyLegacyToast'))
          : null)

      return h('div', { className: 'dsa-settings', 'data-dsa-root': '' },
        h(Styles, null),
        h('div', null,
          h('div', { className: 'dsa-title' }, t('settingsTitle')),
          h('div', { className: 'dsa-muted' }, t('settingsDesc'))),
        familyBanner,
        h('div', { className: 'dsa-grid' },
          field(t('setTrigger'), select('trigger', [
            ['selection', t('setTriggerSelection')],
            ['shortcut', t('setTriggerShortcut')],
            ['both', t('setTriggerBoth')],
          ])),
          field(t('setCarrier'), select('defaultCarrier', [
            ['side', t('carrierSide')],
            ['main', t('carrierMain')],
          ])),
          field(t('setSurface'), select('sideSurface', [
            ['auto', t('setSurfaceAuto')],
            ['flow', t('setSurfaceFlow')],
            ['native-rightbar', t('surfaceNative')],
            ['better-sidebar', t('surfaceBetter')],
          ])),
          field(t('setZones'), select('captureZones', [
            ['auto', t('setZonesAuto')],
            ['chat', t('setZonesChat')],
            ['task', t('setZonesTask')],
            ['chat+task', t('setZonesBoth')],
          ])),
          field(t('setMaxChars'), number('maxChars', 200, 60000), t('setMaxCharsHint')),
          field(t('setFloatMode'), select('floatMode', [
            ['capsule', t('setFloatModeCapsule')],
            ['full', t('setFloatModeFull')],
            ['off', t('setFloatModeOff')],
          ]), t('setFloatModeHint')),
          field(t('setFloatMaxWidth'), number('floatMaxWidth', 240, 560), t('setFloatMaxWidthHint')),
          field(t('setMinChars'), number('minChars', 0, 200)),
          field(t('setConcurrency'), number('maxConcurrentAsks', 1, 12)),
          field(t('setShortcut'), h('input', {
            className: 'dsa-input',
            value: String(draft.shortcut),
            onChange: event => setDraft({ ...draft, shortcut: event.target.value }),
          })),
          field(t('setSideTools'), select('sideTools', [
            ['readonly', t('setSideToolsReadonly')],
            ['inherit', t('setSideToolsInherit')],
          ])),
          field(t('setSideTimeout'), number('sideTimeoutMs', 5000, 3600000), t('setSideTimeoutHint')),
          field(t('setSideProvider'), providerSelect(), t('setSideProviderHint')),
          field(t('setAnswerStyle'), select('answerStyle', [
            ['concise', t('setAnswerStyleConcise')],
            ['standard', t('setAnswerStyleStandard')],
            ['detailed', t('setAnswerStyleDetailed')],
          ]), t('setAnswerStyleHint')),
          field(t('setHistoryMax'), number('historyMaxCards', 0, 50), t('setHistoryMaxHint'))),
        quickActionsEditor,
        field(t('setCustomPersona'), h('textarea', {
          className: 'dsa-textarea',
          value: String(draft.customPersona ?? ''),
          maxLength: MAX_CUSTOM_PERSONA_CHARS,
          rows: 3,
          placeholder: t('setCustomPersonaPlaceholder'),
          onChange: event => setDraft({ ...draft, customPersona: event.target.value }),
        }), t('setCustomPersonaHint', { n: MAX_CUSTOM_PERSONA_CHARS })),
        h('label', { className: 'dsa-check' },
          h('input', {
            type: 'checkbox',
            checked: draft.showInUnclassified === true,
            onChange: event => setDraft({ ...draft, showInUnclassified: event.target.checked }),
          }),
          t('setUnclassified')),
        h('label', { className: 'dsa-check' },
          h('input', {
            type: 'checkbox',
            checked: draft.contextMenu === true,
            onChange: event => setDraft({ ...draft, contextMenu: event.target.checked }),
          }),
          t('setContextMenu')),
        h('span', { className: 'dsa-muted' }, t('setContextMenuHint')),
        h('label', { className: 'dsa-check' },
          h('input', {
            type: 'checkbox',
            checked: draft.notifyOnDone === true,
            disabled: notifyPerm === 'unsupported',
            onChange: event => { void onNotifyToggle(event.target.checked) },
          }),
          t('setNotifyOnDone')),
        h('span', { className: 'dsa-muted' },
          notifyPerm === 'unsupported'
            ? t('notifyUnsupported')
            : notifyPerm === 'denied'
              ? t('notifyDenied')
              : t('setNotifyOnDoneHint')),
        h('label', { className: 'dsa-check' },
          h('input', {
            type: 'checkbox',
            checked: draft.followUpSuggestions === true,
            onChange: event => setDraft({ ...draft, followUpSuggestions: event.target.checked }),
          }),
          t('setFollowUps')),
        h('span', { className: 'dsa-muted' }, t('setFollowUpsHint')),
        historySection,
        h('div', { className: 'dsa-row' },
          h('button', {
            type: 'button',
            className: 'dsa-btn dsa-btn-primary',
            disabled: status === 'saving',
            onClick: () => { void save() },
          }, status === 'saving' ? t('saving') : t('save')),
          h('button', {
            type: 'button',
            className: 'dsa-btn',
            onClick: async () => {
              try {
                await actions.resetConfig()
                setStatus('saved')
              } catch (error) {
                setStatus(`error:${String(error?.message ?? error)}`)
              }
            },
          }, t('reset')),
          h('button', {
            type: 'button',
            className: 'dsa-btn',
            onClick: async () => {
              try {
                const value = await actions.diagnose()
                setDiag(value)
              } catch (error) {
                setDiag({ unreachable: String(error?.message ?? error) })
              }
            },
          }, t('diagnostics')),
          h('span', { className: 'dsa-muted' },
            status === 'saved' ? t('saved')
              : status === 'idle' ? ''
                : status === 'saving' ? t('saving') : status.replace(/^error:/, ''))),
        diag !== null
          ? h('div', { className: 'dsa-diag' },
            h('div', { className: 'dsa-title' }, t('diagTitle')),
            diag.unreachable !== undefined
              ? h('div', { className: 'dsa-error' }, t('diagUnreachable', { msg: diag.unreachable }))
              : [
                h('div', { key: 'host' }, `${t('diagHost')}: ${t('yes')} · v${diag.version}`),
                h('div', { key: 'side' }, `${t('diagSide')}: ${diag.capabilities?.sideEngine ? t('yes') : t('no')}`),
                h('div', { key: 'prov' }, `${t('diagProviders')}: ${(diag.capabilities?.sideProviders ?? []).join(', ') || t('none')}`),
                h('div', { key: 'agents' }, `${t('diagAgents')}: ${diag.capabilities?.liveAgents ?? 0}`),
                h('div', { key: 'surface' }, `${t('diagSurface')}: ${state.surface}`),
                h('div', { key: 'session' }, `${t('diagSession')}: ${state.sessionId ?? t('none')}`),
                h('div', { key: 'zones' }, `${t('diagZones')}: ${state.zoneAnchors === false ? t('diagZonesMissing') : t('yes')}`),
                h('div', { key: 'slots' }, `${t('diagSlots')}: ${Object.entries(state.slots).map(([k, v]) => `${k}=${v}`).join(' · ')}`),
                // The side-card plugin's own report: which version is loaded and
                // whether it advertises the capability this adapter needs.
                h('div', { key: 'sidecard' }, `${t('diagSidecard')}: ${describeSurfaces()}`),
                h('div', { key: 'path' }, `${t('settingsTitle')} → ${diag.provenance?.persistedPath ?? ''}`),
              ])
          : null)
    }

    /** Session probe: an invisible entry in the composer tool row. */
    function SessionProbe(props) {
      const sessionId = props?.sessionId
      // `inputActions` is a STANDARD prop of every session-scoped slot entry
      // (the slot catalog lists it beside `sessionId`), so the composer's own
      // action face is captured here rather than guessed at from a service.
      const actions = props?.inputActions
      React.useEffect(() => {
        if (typeof sessionId === 'string' && sessionId !== '' && store.state.sessionId !== sessionId) {
          store.set({ sessionId })
        }
        if (actions !== undefined && actions !== null) capturedComposerActions = actions
      }, [sessionId, actions])
      return null
    }

    /** The composer action face captured from a session-scoped slot entry. */
    function composerFace() {
      return capturedComposerActions === null ? null : { actions: capturedComposerActions }
    }

    /**
     * One line describing how each optional side-card surface resolved, for the
     * settings page's capability check. Both adapters are reported, because a
     * failing NATIVE registration was previously invisible here (it only showed
     * up as a missing entry in the pane's own slot inventory).
     * @returns {string} human-readable state.
     */
    function describeSurfaces() {
      const native = surfaces.native.available()
        ? `${t('yes')} · ${t('diagNativeKind')}=${CARD_KIND}`
        : `${t('no')}${surfaces.native.error === null ? '' : `（${surfaces.native.error}）`}`
      return `${t('surfaceNative')}: ${native} ／ ${t('surfaceBetter')}: ${describeSidecardAdapter()}`
    }

    /**
     * The optional side-card plugin's own report: which version is loaded and
     * whether it advertises the capability this adapter needs.
     * @returns {string} human-readable state.
     */
    function describeSidecardAdapter() {
      const better = surfaces.better
      if (better.error !== null) return `${t('no')}（${better.error}）`
      if (better.version === null && better.service === null) return t('none')
      const version = better.version ?? '?'
      if (better.available()) {
        return `v${version} · ${better.features.length} ${t('diagFeatures')} · ${t('yes')}`
      }
      if (better.reason === 'no-tab-meta') {
        return `v${version} · ${t('diagNoTabMeta')}`
      }
      return `v${version} · ${better.reason ?? t('no')}`
    }

    // ─────────────────────────────────────────────────────────────────────
    // §10 plugin face
    // ─────────────────────────────────────────────────────────────────────

    return {
      inject: ['slots'],
      apply(ctx) {
        /** Everything this activation must undo. */
        const disposers = []
        const controllers = new Map()
        /** Pending surface render-proof timers (cleared on unload). */
        const pendingProofs = new Map()
        let lastSignature = null
        let lastAt = 0
        let pendingTimer = null
        let nextCardId = 1

        // ── configuration ────────────────────────────────────────────────
        const refreshState = async () => {
          try {
            const value = await getState()
            store.set({
              config: { ...CLIENT_DEFAULTS, ...(value.config ?? {}) },
              problems: value.problems ?? [],
              capabilities: value.capabilities ?? null,
              provenance: value.provenance ?? null,
              hostReachable: true,
            })
            return value
          } catch (error) {
            store.set({ hostReachable: false })
            console.error(`[${PLUGIN_ID}] /state failed:`, error)
            throw error
          }
        }

        // ── card persistence ────────────────────────────────────────────
        // A page reload used to lose every finished answer: the store is
        // memory-only and the reload drops the SSE link mid-stream. Finished
        // cards are therefore mirrored into `localStorage` (same data, no
        // server round-trip) and replayed on boot. Everything here is optional
        // by design — a private-mode window (throws on setItem), a full quota,
        // or a tampered payload must degrade to "no history", never break boot.
        // v2 (1.8.0): adds `createdAt`, a configurable cap
        // (`historyMaxCards`, 0–50) and per-entry manager actions. The v1
        // payload is read once and imported into v2 on boot; the v1 key is
        // left untouched (no destructive migration), so a downgrade still
        // finds it.
        // v3 (1.8.0): adds `versions` (older answers kept across retry /
        // retry-edit). The chain v1 → v2 → v3 is read in order; every older
        // key is LEFT IN PLACE (non-destructive migration), so a downgrade
        // still finds its own payload.
        const PERSIST_KEY = 'dsh-sidecard-ask:cards:v3'
        const PERSIST_V2_KEY = 'dsh-sidecard-ask:cards:v2'
        const PERSIST_LEGACY_KEY = 'dsh-sidecard-ask:cards:v1'
        const PERSIST_FALLBACK_CARDS = 10
        const PERSIST_TEXT_LIMIT = 65536

        /** Configured durable cap, clamped to the Host's 0–50 range. */
        const historyCap = () => {
          const value = Number(store.state.config.historyMaxCards)
          if (!Number.isFinite(value)) return PERSIST_FALLBACK_CARDS
          return Math.max(0, Math.min(50, Math.round(value)))
        }

        /** Parse one localStorage envelope of a given schema version. */
        const parseEnvelope = (raw, version) => {
          if (raw === null || raw === undefined) return []
          try {
            const value = JSON.parse(raw)
            if (value?.version !== version || !Array.isArray(value.cards)) return []
            return value.cards
              .filter(entry => typeof entry?.id === 'string' && entry.id !== '' && typeof entry.question === 'string')
          } catch { return [] }
        }

        function readPersisted() {
          let raw = null
          try {
            raw = window.localStorage?.getItem(PERSIST_KEY)
          } catch { return [] }
          const v3 = parseEnvelope(raw, 3).slice(0, 50)
          if (v3.length > 0 || (raw !== null && raw !== undefined)) return v3
          // v2 → v3: v2 entries have no `versions`, so the field is seeded empty.
          let v2raw = null
          try {
            v2raw = window.localStorage?.getItem(PERSIST_V2_KEY)
          } catch { return [] }
          if (v2raw !== null && v2raw !== undefined) {
            return parseEnvelope(v2raw, 2).slice(0, 50).map(entry => ({ ...entry, versions: [] }))
          }
          // v1 → v3: v1 entries carry neither createdAt nor versions.
          let legacy = null
          try {
            legacy = window.localStorage?.getItem(PERSIST_LEGACY_KEY)
          } catch { return [] }
          return parseEnvelope(legacy, 1).slice(0, 50).map(entry => ({ ...entry, createdAt: 0, versions: [] }))
        }

        function writePersisted(cards) {
          try {
            window.localStorage?.setItem(PERSIST_KEY, JSON.stringify({ version: 3, cards }))
          } catch (error) {
            // Quota or privacy mode — the cards stay on screen, just not durable.
            console.warn(`[${PLUGIN_ID}] card history not persisted:`, error)
          }
        }

        /** Recompute the durable set from the live store and write it. */
        const syncPersisted = () => {
          const cap = historyCap()
          const finished = store.state.cards
            .filter(card => card.carrier === 'side'
              && (card.status === 'done' || card.status === 'stopped')
              && card.text !== '')
            .slice(0, cap)
            .map(card => ({
              id: card.id,
              question: card.question,
              selected: String(card.selected ?? '').slice(0, PERSIST_TEXT_LIMIT),
              selection: String(card.selection ?? '').slice(0, PERSIST_TEXT_LIMIT),
              text: String(card.text ?? '').slice(0, PERSIST_TEXT_LIMIT),
              reasoning: String(card.reasoning ?? '').slice(0, PERSIST_TEXT_LIMIT),
              status: card.status === 'stopped' ? 'stopped' : 'done',
              carrier: 'side',
              zone: card.zone,
              truncated: card.truncated === true,
              droppedChars: Number(card.droppedChars ?? 0),
              createdAt: Number.isFinite(card.createdAt) ? card.createdAt : Date.now(),
              provider: typeof card.provider === 'string' ? card.provider : '',
              elapsedMs: Number.isFinite(card.elapsedMs) ? card.elapsedMs : null,
              history: Array.isArray(card.history) ? card.history.slice(-12) : [],
              // P2-2: kept so a replayed rewrite card still offers "insert".
              actionId: typeof card.actionId === 'string' ? card.actionId.slice(0, 60) : null,
              // P2-5b: bounded, text-capped older answers. `question` is short
              // by nature; the answer is capped like the live one.
              versions: Array.isArray(card.versions)
                ? card.versions
                  .filter(entry => entry !== null && typeof entry === 'object' && typeof entry.text === 'string')
                  .slice(-MAX_CARD_VERSIONS)
                  .map(entry => ({
                    question: String(entry.question ?? '').slice(0, 2000),
                    text: String(entry.text ?? '').slice(0, PERSIST_TEXT_LIMIT),
                    reasoning: String(entry.reasoning ?? '').slice(0, PERSIST_TEXT_LIMIT),
                    at: Number.isFinite(entry.at) ? entry.at : 0,
                  }))
                : [],
            }))
          // cap === 0 disables persistence: do not touch the existing key
          // (documented as "kept until an explicit clear"), just mirror the
          // in-memory state (empty manager view).
          if (cap === 0) {
            store.set({ history: [] })
            return
          }
          writePersisted(finished)
          store.set({ history: finished })
        }

        /** Replay finished cards from a previous page load into the store. */
        const restorePersisted = () => {
          // Detect the migration BEFORE reading: when the CURRENT key is
          // absent but an older payload exists, the imported set is written
          // out under the current version once (non-destructively; v1/v2 are
          // kept, so a downgrade still finds its own key).
          let currentRaw
          try {
            currentRaw = window.localStorage?.getItem(PERSIST_KEY)
          } catch { currentRaw = null }
          const cap = historyCap()
          const saved = readPersisted().slice(0, cap)
          store.set({ history: saved })
          if (saved.length === 0) return
          if (cap > 0 && (currentRaw === null || currentRaw === undefined)) {
            writePersisted(saved)
          }
          const replayed = saved.map(entry => ({
            id: entry.id,
            question: entry.question,
            selected: String(entry.selected ?? ''),
            selection: String(entry.selection ?? ''),
            text: String(entry.text ?? ''),
            reasoning: String(entry.reasoning ?? ''),
            status: entry.status === 'stopped' ? 'stopped' : 'done',
            carrier: 'side',
            zone: entry.zone,
            truncated: entry.truncated === true,
            droppedChars: Number(entry.droppedChars ?? 0),
            streaming: null,
            error: null,
            provider: typeof entry.provider === 'string' && entry.provider !== '' ? entry.provider : null,
            elapsedMs: Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : null,
            createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
            // P2-5b: replayed versions stay switchable after a reload.
            versions: replayVersions(entry.versions),
            viewingVersion: null,
            actionId: typeof entry.actionId === 'string' && entry.actionId !== '' ? entry.actionId : null,
            // A native/better tab cannot survive a reload, so history always
            // comes back on the flow stack where it is visible immediately.
            surface: 'flow',
            open: true,
            history: Array.isArray(entry.history)
              ? entry.history
                  .filter(turn => turn !== null && typeof turn === 'object')
                  .map(turn => ({ question: String(turn.question ?? ''), answer: String(turn.answer ?? '') }))
              : [],
          }))
          store.set({ cards: [...replayed, ...store.state.cards] })
        }

        /** Sanitize a persisted `versions` array into the live shape. */
        function replayVersions(raw) {
          if (!Array.isArray(raw)) return []
          return raw
            .filter(entry => entry !== null && typeof entry === 'object' && typeof entry.text === 'string')
            .slice(-MAX_CARD_VERSIONS)
            .map(entry => ({
              question: String(entry.question ?? ''),
              text: String(entry.text ?? ''),
              reasoning: String(entry.reasoning ?? ''),
              at: Number.isFinite(entry.at) ? entry.at : 0,
            }))
        }

        /** Map one durable history entry back to a live flow card. */
        const historyEntryToCard = (entry) => ({
          id: entry.id,
          question: entry.question,
          selected: String(entry.selected ?? ''),
          selection: String(entry.selection ?? ''),
          text: String(entry.text ?? ''),
          reasoning: String(entry.reasoning ?? ''),
          status: entry.status === 'stopped' ? 'stopped' : 'done',
          carrier: 'side',
          zone: entry.zone,
          truncated: entry.truncated === true,
          droppedChars: Number(entry.droppedChars ?? 0),
          streaming: null,
          error: null,
          provider: typeof entry.provider === 'string' && entry.provider !== '' ? entry.provider : null,
          elapsedMs: Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : null,
          createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
          notified: true,
          versions: replayVersions(entry.versions),
          viewingVersion: null,
          actionId: typeof entry.actionId === 'string' && entry.actionId !== '' ? entry.actionId : null,
          surface: 'flow',
          open: true,
          history: Array.isArray(entry.history)
            ? entry.history
                .filter(turn => turn !== null && typeof turn === 'object')
                .map(turn => ({ question: String(turn.question ?? ''), answer: String(turn.answer ?? '') }))
            : [],
        })

        const actions = {
          openPopover(candidate) {
            // P2-2: the composer must be remembered BEFORE the popover's
            // textarea takes focus, otherwise "insert into composer" has no
            // target by the time the answer is ready.
            captureComposerTarget()
            try { composerSpan = capturedComposerActions?.captureInsertion?.() ?? null } catch { composerSpan = null }
            store.set({ popover: { candidate } })
          },
          closePopover() {
            store.set({ popover: null })
          },
          openContextMenu(candidate, position) {
            store.set({ contextMenu: { candidate, position } })
          },
          closeContextMenu() {
            if (store.state.contextMenu !== null) store.set({ contextMenu: null })
          },
          /** Bring one durable card back onto the floating stack. */
          restoreHistoryCard(id) {
            const entry = store.state.history.find(item => item.id === id)
            if (entry === undefined) return false
            if (store.state.cards.some(card => card.id === id)) {
              patchCard(id, { surface: 'flow', open: true })
            } else {
              store.set({ cards: [historyEntryToCard(entry), ...store.state.cards] })
            }
            // A hidden (off/capsule) layer would swallow the restored card;
            // this is a session-only override, exactly like clicking expand.
            setFloatMode('full')
            toast(t('historyRestored'))
            return true
          },
          /** Delete one entry from durable history (and its live card). */
          deleteHistoryCard(id) {
            const next = store.state.history
              .filter(item => item.id !== id)
              .slice(0, historyCap())
            writePersisted(next)
            store.set({
              history: next,
              cards: store.state.cards.filter(card => card.id !== id),
            })
            toast(t('historyDeleted'))
          },
          /**
           * Empty the durable history without touching running cards.
           *
           * Removes EVERY generation key, not just the current one:
           * {@link readPersisted} falls back to v2 → v1 whenever the current
           * key is absent (that fallback is exactly what makes the
           * non-destructive migration work), so deleting only v3 let a legacy
           * payload resurrect the "cleared" history on the next page load —
           * reproduced live, 2026-10-17. An explicit user clear is destructive
           * by definition: it is the one action allowed to drop the old keys.
           */
          clearHistory() {
            try {
              for (const key of [PERSIST_KEY, PERSIST_V2_KEY, PERSIST_LEGACY_KEY]) {
                window.localStorage?.removeItem(key)
              }
            } catch (error) {
              console.warn(`[${PLUGIN_ID}] history clear failed:`, error)
            }
            store.set({ history: [] })
            toast(t('historyClearDone'))
          },
          async submit(candidate, payload) {
            store.set({ popover: null, trigger: null })
            const config = store.state.config
            const cut = truncateSelection(candidate.text, config.maxChars)
            const card = {
              id: `card-${Date.now()}-${nextCardId++}`,
              question: payload.question,
              selection: candidate.text,
              selected: cut.text,
              truncated: cut.truncated,
              droppedChars: cut.droppedChars,
              zone: candidate.zone,
              carrier: payload.carrier,
              status: 'pending',
              text: '',
              reasoning: '',
              streaming: null,
              error: null,
              surface: 'flow',
              open: true,
              history: [],
              // #9 transparency: provider from the start event, elapsed
              // measured across the stream; createdAt feeds history v2.
              provider: null,
              elapsedMs: null,
              createdAt: Date.now(),
              // #5 guard: at most one notification per card.
              notified: false,
              // P2-5b: older answers this card can switch back to.
              versions: [],
              viewingVersion: null,
              // P2-2: which quick action started this card (rewrite actions
              // offer "insert into the composer"); null for a typed question.
              actionId: payload?.actionId ?? null,
            }
            if (payload.carrier === 'main') {
              store.set({ cards: [card, ...store.state.cards] })
              try {
                const result = await askInMainConversation({
                  ctx,
                  sessionId: currentSessionId(ctx),
                  selection: candidate.text,
                  question: payload.question,
                  zone: candidate.zone,
                  maxChars: config.maxChars,
                })
                patchCard(card.id, {
                  status: 'done',
                  text: result.mode === 'draft' ? t('draftInsertedHint') : t('mainSentHint'),
                  streaming: null,
                })
                toast(result.mode === 'draft' ? t('draftInserted') : t('mainSent'))
              } catch (error) {
                patchCard(card.id, {
                  status: 'error',
                  error: { code: error?.code ?? 'main-failed', message: String(error?.message ?? error), retryable: true },
                })
              }
              return
            }
            const { adapter, fellBack } = pickSurface(config.sideSurface)
            card.surface = adapter.kind
            store.set({ cards: [card, ...store.state.cards], surface: adapter.kind })
            if (fellBack) {
              store.set({ surfaceNote: t('surfaceFellBack', { name: adapter.label() }) })
              toast(t('surfaceUnavailable'))
            }
            if (adapter.kind !== 'flow') {
              let opened = false
              try {
                opened = adapter.open(card) === true
              } catch (error) {
                console.error(`[${PLUGIN_ID}] surface open failed:`, error)
                opened = false
              }
              if (!opened) {
                store.set({ surface: 'flow' })
                patchCard(card.id, { surface: 'flow' })
                scheduleReport(0)
              } else {
                // Render proof: an adapter that accepts the open but never
                // mounts our body would leave an empty tab. Unless the card is
                // mounted by then (CardHost cancels its own proof on mount),
                // move it to the flow stack — the card's data lives in the
                // store, so the running stream simply continues on the other
                // surface. A proof that fires before a lazy host mounts is
                // what the "moved to the flow stack" body below covers.
                const proof = setTimeout(() => {
                  pendingProofs.delete(card.id)
                  const live = store.state.cards.find(item => item.id === card.id)
                  if (live === undefined || live.surface === 'flow') return
                  if (renderedCardId === card.id) return
                  store.set({ surface: 'flow', surfaceNote: t('surfaceUnproven') })
                  patchCard(card.id, { surface: 'flow' })
                  toast(t('surfaceUnproven'))
                  scheduleReport(0)
                }, 600)
                pendingProofs.set(card.id, proof)
              }
            }
            void runSideCard(card.id)
          },
          /**
           * P2-2: write a finished rewrite into the composer.
           *
           * `replace` is only meaningful for a plain text field whose
           * selection we actually captured; a contenteditable composer gets
           * the answer appended (Lexical ignores a programmatic range).
           * Returns the mode so a test (and the toast) can tell what happened.
           */
          insertAnswer(card, options = {}) {
            const replace = options?.replace === true && composerReplaceAvailable()
            const result = insertIntoComposer(String(card?.text ?? ''), { replace })
            if (result.ok === true) {
              toast(t('insertDone'))
              return result.mode
            }
            toast(result.mode === 'stale'
              ? t('insertStale')
              : result.mode === 'none' ? t('insertNoComposer') : t('insertFailed'))
            return result.mode
          },
          /**
           * One quick-action chip: resolve the template ({selection} is the
           * only placeholder), then take the SAME path as a popover submit
           * fixed to the side card — surface picking, render proof and the
           * stream loop all live in submit(), so this stays a thin adapter.
           */
          quickAsk(candidate, action) {
            const config = store.state.config
            const question = renderActionQuestion(action, candidate.text, config.maxChars)
            if (question.trim() === '') return
            // P2-2: a chip click also has to remember where the composer was.
            captureComposerTarget()
            try { composerSpan = capturedComposerActions?.captureInsertion?.() ?? null } catch { composerSpan = null }
            void actions.submit(candidate, { question, carrier: 'side', actionId: action?.id ?? null })
          },
          copy(card, element) {
            void copyText(card.text, element).then((result) => {
              toast(result === 'copied' ? t('copied') : result === 'selected' ? t('copySelectedHint') : t('copyFailed'))
            })
          },
          /**
           * 1.8.0 P2-3: jump back to the passage one card/history entry came
           * from. Returns `'highlight' | 'selection' | 'missing' |
           * 'unsupported'` — every non-success path toasts, so a click can
           * never look like a no-op.
           */
          locateText(text) {
            const source = String(text ?? '')
            if (source.trim() === '') {
              toast(t('locateNotFound'))
              return 'missing'
            }
            // A headless/embedded surface may have no text walker at all; say
            // so instead of pretending the passage "changed".
            if (typeof document === 'undefined'
              || typeof document.createRange !== 'function'
              || typeof document.createTreeWalker !== 'function') {
              toast(t('locateUnsupported'))
              return 'unsupported'
            }
            let found = null
            try {
              found = locatePassageRange(source, document)
            } catch (error) {
              console.warn(`[${PLUGIN_ID}] locate failed:`, error)
            }
            if (found === null) {
              toast(t('locateNotFound'))
              return 'missing'
            }
            const mode = paintLocatedRange(found.range)
            if (mode === 'none') {
              toast(t('locateUnsupported'))
              return 'unsupported'
            }
            return mode
          },
          locateCard(card) {
            return actions.locateText(card?.selection ?? '')
          },
          /** 1.8.0 P2-5a: write one card to `<prefix>-<stamp>.md`. */
          exportCard(card) {
            if (String(card?.text ?? '').trim() === '') {
              toast(t('exportEmpty'))
              return 'empty'
            }
            const result = downloadMarkdown(markdownFilename(Date.now()), buildCardMarkdown(card))
            if (result !== 'ok') toast(t('exportFailed'))
            return result
          },
          /** 1.8.0 P2-5a: write the whole durable history to one file. */
          exportHistory() {
            const entries = store.state.history
            if (!Array.isArray(entries) || entries.length === 0) {
              toast(t('exportEmpty'))
              return 'empty'
            }
            const result = downloadMarkdown(
              markdownFilename(Date.now(), 'sidecard-ask-history'),
              buildHistoryMarkdown(entries),
            )
            if (result !== 'ok') toast(t('exportFailed'))
            return result
          },
          followUp(card, text) {
            const history = [...card.history, { question: card.question, answer: card.text }]
            const next = patchCard(card.id, {
              question: text,
              history,
              text: '',
              reasoning: '',
              status: 'pending',
              error: null,
              streaming: null,
              // A new turn is a new answer: leave any old-version view.
              viewingVersion: null,
            })
            if (next === undefined) return
            if (next.carrier === 'side') void runSideCard(card.id)
            else {
              void askInMainConversation({
                ctx,
                sessionId: currentSessionId(ctx),
                selection: next.selection,
                question: text,
                zone: next.zone,
                maxChars: store.state.config.maxChars,
              }).then(() => {
                patchCard(card.id, { status: 'done', text: t('mainSentHint') })
              }).catch((error) => {
                patchCard(card.id, {
                  status: 'error',
                  error: { code: error?.code ?? 'main-failed', message: String(error?.message ?? error), retryable: true },
                })
              })
            }
          },
          retry(card) {
            // P2-5b: the answer being replaced is kept as a version first.
            patchCard(card.id, {
              ...versionPatch(card),
              status: 'pending',
              text: '',
              reasoning: '',
              error: null,
              streaming: null,
            })
            if (card.carrier === 'side') void runSideCard(card.id)
          },
          /**
           * Regenerate the CURRENT turn with an edited question. Unlike
           * followUp, this does NOT push the old Q/A into `history`: the
           * earlier turns on the card stay, the question text is replaced,
           * and the answer streams again from scratch.
           */
          retryEdit(card, question) {
            const trimmed = String(question ?? '').trim()
            if (trimmed === '' || card.carrier !== 'side') return
            patchCard(card.id, {
              ...versionPatch(card),
              question: trimmed,
              status: 'pending',
              text: '',
              reasoning: '',
              error: null,
              streaming: null,
            })
            void runSideCard(card.id)
          },
          /**
           * P2-5b: show one older version (or the live one with `null`).
           * Read-only by construction — nothing is re-fetched, the card's own
           * data is swapped into the body.
           */
          viewVersion(card, index) {
            const versions = Array.isArray(card?.versions) ? card.versions : []
            const next = Number.isInteger(index) && index >= 0 && index < versions.length ? index : null
            if (next === null && index !== null && index !== undefined) return null
            patchCard(card.id, { viewingVersion: next })
            return next
          },
          cancel(card) {
            const controller = controllers.get(card.id)
            if (controller !== undefined) {
              controller.abort()
              // The local abort stops only the browser's stream: the Host's
              // child run would keep burning until its timeout unless told,
              // so POST /cancel too. Fire-and-forget on purpose — the card is
              // already stopped locally, and a dead host must not turn the
              // Stop button into a failure.
              void postJson('cancel', { id: card.id }).catch(() => {})
            }
            patchCard(card.id, { status: 'stopped' })
          },
          async sendToMain(card) {
            try {
              const result = await askInMainConversation({
                ctx,
                sessionId: currentSessionId(ctx),
                selection: card.selection,
                question: card.question,
                zone: card.zone,
                maxChars: store.state.config.maxChars,
              })
              patchCard(card.id, {
                carrier: 'main',
                status: 'done',
                text: result.mode === 'draft' ? t('draftInsertedHint') : t('mainSentHint'),
                error: null,
                streaming: null,
              })
              toast(result.mode === 'draft' ? t('draftInserted') : t('mainSent'))
            } catch (error) {
              patchCard(card.id, {
                status: 'error',
                error: { code: error?.code ?? 'main-failed', message: String(error?.message ?? error), retryable: true },
              })
            }
          },
          close(card) {
            const controller = controllers.get(card.id)
            if (controller !== undefined) {
              controller.abort()
              // Same host-side release as the Stop button: closing a card
              // mid-stream must not leave the child running server-side.
              void postJson('cancel', { id: card.id }).catch(() => {})
            }
            controllers.delete(card.id)
            // A closed card's buffered-but-unflushed deltas belong to nobody:
            // drop them here so the next tick's flush cannot touch them.
            pendingDeltas.delete(card.id)
            pendingReasonings.delete(card.id)
            // Every surface gets a chance to close its own container: an
            // orphaned native tab is indistinguishable from a stuck card to
            // the user, so closing the card must close the tab too (the rail
            // silently ignores a close it cannot perform).
            if (card.surface === 'better-sidebar') {
              try {
                surfaces.better.close(card)
              } catch { /* the host may already be gone */ }
            } else if (card.surface === 'native-rightbar') {
              try {
                surfaces.native.close(card)
              } catch { /* the right rail owns its lifecycle */ }
            }
            store.set({ cards: store.state.cards.filter(item => item.id !== card.id) })
            // #6: closing a card only removes it from the live surface; the
            // durable history (written when the answer finished) is retained
            // and managed explicitly in the settings-page history manager.
          },
          async saveConfig(patch) {
            const value = await postJson('config', patch)
            store.set({
              config: { ...CLIENT_DEFAULTS, ...(value.config ?? {}) },
              problems: value.problems ?? [],
              provenance: value.provenance ?? null,
            })
            return value
          },
          async resetConfig() {
            const value = await postJson('reset', {})
            store.set({
              config: { ...CLIENT_DEFAULTS, ...(value.config ?? {}) },
              problems: value.problems ?? [],
              provenance: value.provenance ?? null,
            })
            return value
          },
          async diagnose() {
            return await getState()
          },
        }

        /**
         * Streaming deltas coalesce into one store commit per tick. Every
         * commit re-renders every card and re-parses the whole answer, so a
         * fast stream on a long answer was quadratic work. A terminal event
         * (or cancel, or close) flushes the buffer first, so no streamed text
         * is ever lost on the way into the store.
         */
        const pendingDeltas = new Map()
        const pendingReasonings = new Map()
        let deltaFlushTimer = null

        const flushStreamBuffers = () => {
          if (deltaFlushTimer !== null) {
            clearTimeout(deltaFlushTimer)
            deltaFlushTimer = null
          }
          if (pendingDeltas.size > 0) {
            for (const [cardId, chunk] of [...pendingDeltas.entries()]) appendCardText(cardId, chunk)
            pendingDeltas.clear()
          }
          if (pendingReasonings.size > 0) {
            for (const [cardId, chunk] of [...pendingReasonings.entries()]) appendCardReasoning(cardId, chunk)
            pendingReasonings.clear()
          }
        }

        const bufferStreamDelta = (cardId, chunk) => {
          if (chunk === '') return
          pendingDeltas.set(cardId, (pendingDeltas.get(cardId) ?? '') + chunk)
          if (deltaFlushTimer === null) deltaFlushTimer = setTimeout(flushStreamBuffers, 50)
        }

        const bufferStreamReasoning = (cardId, chunk) => {
          if (chunk === '') return
          pendingReasonings.set(cardId, (pendingReasonings.get(cardId) ?? '') + chunk)
          if (deltaFlushTimer === null) deltaFlushTimer = setTimeout(flushStreamBuffers, 50)
        }

        /** Stream one side answer into its card. */
        const runSideCard = async (cardId) => {
          const card = store.state.cards.find(item => item.id === cardId)
          if (card === undefined) return
          const controller = new AbortController()
          controllers.set(cardId, controller)
          // #9: wall time from the (re)start of THIS attempt to its terminal
          // frame. retry/retryEdit both run this function again, so the timer
          // naturally measures the fresh attempt only.
          const startedAt = Date.now()
          patchCard(cardId, {
            status: 'streaming',
            text: '',
            reasoning: '',
            error: null,
            provider: null,
            elapsedMs: null,
            notified: false,
          })
          await streamAsk({
            id: cardId,
            question: card.question,
            selection: card.selected,
            zone: card.zone,
            carrier: 'side',
            sessionId: currentSessionId(ctx),
            history: card.history.slice(-HISTORY_TURNS),
          }, {
            signal: controller.signal,
            onStart: (data) => {
              patchCard(cardId, {
                truncated: data?.truncated === true || card.truncated,
                droppedChars: data?.droppedChars ?? card.droppedChars,
                // Reported by the host so the card can be honest about the
                // read-only guard when the provider cannot take a tool filter.
                toolFilter: typeof data?.toolFilter === 'string' ? data.toolFilter : null,
                provider: typeof data?.provider === 'string' ? data.provider : (card.provider ?? null),
              })
            },
            onDelta: data => bufferStreamDelta(cardId, String(data?.text ?? '')),
            onReasoning: data => bufferStreamReasoning(cardId, String(data?.text ?? '')),
            onDone: (data) => {
              // A locally cancelled stream can still see its terminal frame
              // (a harness stream ignores the abort signal; a real host may
              // race the abort): the card's local "stopped" verdict wins.
              if (controller.signal.aborted) return
              flushStreamBuffers()
              const current = store.state.cards.find(item => item.id === cardId)
              const status = data?.aborted === true ? 'stopped' : 'done'
              patchCard(cardId, {
                status,
                streaming: data?.streaming === true,
                text: typeof data?.text === 'string' && data.text !== '' ? data.text : (current?.text ?? ''),
                reasoning: typeof data?.reasoning === 'string' ? data.reasoning : (current?.reasoning ?? ''),
                elapsedMs: Date.now() - startedAt,
              })
              controllers.delete(cardId)
              syncPersisted()
              // #5: background finish notification (guarded inside).
              const finished = store.state.cards.find(item => item.id === cardId)
              if (finished !== undefined) notifyCardFinish(finished)
            },
            onError: (error) => {
              if (controller.signal.aborted) return
              flushStreamBuffers()
              patchCard(cardId, { status: 'error', error, elapsedMs: Date.now() - startedAt })
              controllers.delete(cardId)
              const failed = store.state.cards.find(item => item.id === cardId)
              if (failed !== undefined) notifyCardFinish(failed)
            },
          })
        }

        // ── selection listeners ──────────────────────────────────────────
        const evaluate = () => {
          pendingTimer = null
          // §4.5 a non-leader copy must not surface its trigger, even if a
          // stale selection event arrives.
          if (store.state.familyLeader === false) return
          const config = store.state.config
          const candidate = readSelection()
          // Zone anchors: the harness stamps every slot outlet with
          // `data-slot="<key>"`. This is a property of the BUILD, not of the
          // current selection — a selection on a body-mounted node (an
          // onboarding modal, another plugin's raw-DOM panel) has an empty
          // slot path even though the frame is full of anchors. Probe the
          // whole document instead, or one such selection would flip the
          // global verdict to "missing" and silently disable zone filtering.
          if (candidate !== null && store.state.zoneAnchors !== true) {
            const buildHasAnchors = candidate.slotPath.length > 0
              || (typeof document !== 'undefined' && document.querySelector('[data-slot]') !== null)
            if (buildHasAnchors) {
              if (store.state.zoneAnchors !== true) scheduleReport(0)
              store.set({ zoneAnchors: true })
            } else if (store.state.zoneAnchors === null && candidate.slotPath.length === 0) {
              // Only the build-wide miss (and never a single unanchored
              // selection) flips the verdict to unavailable.
              store.set({ zoneAnchors: false })
              scheduleReport(0)
              console.info(`[${PLUGIN_ID}] 该版本没有 data-slot 锚点，区域过滤不可用，已按"全部区域"工作`)
            }
          }
          const decision = shouldOffer(candidate, config, { anchors: store.state.zoneAnchors !== false })
          if (!decision.ok) {
            lastSignature = null
            if (store.state.trigger !== null || store.state.popover !== null) {
              store.set({ trigger: null })
            }
            return
          }
          const signature = selectionSignature(candidate)
          const now = Date.now()
          if (signature === lastSignature && now - lastAt < 400) return
          lastSignature = signature
          lastAt = now
          store.set({ trigger: candidate })
        }

        const schedule = () => {
          if (pendingTimer !== null) clearTimeout(pendingTimer)
          pendingTimer = setTimeout(evaluate, 120)
        }

        const onDocumentDown = (event) => {
          const element = elementOf(event.target)
          if (element !== null && element.closest('[data-dsa-root]') !== null) return
          if (store.state.popover !== null) store.set({ popover: null })
          if (store.state.contextMenu !== null) store.set({ contextMenu: null })
        }

        // #8: right-click on a qualifying selection raises OUR menu instead
        // of the native one. The same gates as the trigger button apply —
        // leader, config toggle, editable-field exclusion, zone filter — and
        // when any gate fails we do NOT preventDefault, so the host's native
        // menu opens untouched (that is the documented conflict fallback).
        const onContextMenu = (event) => {
          if (store.state.familyLeader === false) return
          const config = store.state.config
          if (config.contextMenu !== true) return
          const candidate = readSelection()
          const decision = shouldOffer(candidate, config, { anchors: store.state.zoneAnchors !== false })
          if (!decision.ok) {
            if (store.state.contextMenu !== null) store.set({ contextMenu: null })
            return
          }
          event.preventDefault()
          event.stopPropagation()
          actions.openContextMenu(candidate, { x: event.clientX, y: event.clientY })
        }

        const onKeyDown = (event) => {
          // §4.5 only the leader answers the shortcut; otherwise two copies
          // would each preventDefault and each open their own popover.
          if (store.state.familyLeader === false) return
          // Never steal keys while the user is typing in our own popover or
          // card editors (Enter/Escape there are handled by the components).
          const target = elementOf(event.target)
          if (target !== null && target.closest('[data-dsa-root]') !== null
            && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
              || target.closest('[contenteditable=""],[contenteditable="true"]') !== null)) {
            return
          }
          const config = store.state.config
          const facts = parseShortcut(config.shortcut)
          if (matchesShortcut(event, facts)) {
            const candidate = readSelection() ?? store.state.trigger
            if (candidate !== null) {
              event.preventDefault()
              actions.openPopover(candidate)
              return
            }
          }
          // Per-action shortcuts: the main shortcut wins on a collision, and
          // the candidate falls back to the last raised trigger, exactly like
          // the main shortcut. A chip then submits straight to a side card.
          for (const action of quickActionsOf(config)) {
            if (action.shortcut === '' || !matchesShortcut(event, parseShortcut(action.shortcut))) continue
            const candidate = readSelection() ?? store.state.trigger
            if (candidate !== null) {
              event.preventDefault()
              actions.quickAsk(candidate, action)
              return
            }
          }
          if (event.key === 'Escape') {
            if (store.state.popover !== null) store.set({ popover: null })
            if (store.state.contextMenu !== null) store.set({ contextMenu: null })
          }
        }

        const onScroll = () => {
          if (store.state.popover === null && store.state.trigger !== null) store.set({ trigger: null })
          if (store.state.contextMenu !== null) store.set({ contextMenu: null })
        }

        if (typeof document !== 'undefined') {
          document.addEventListener('selectionchange', schedule)
          document.addEventListener('pointerup', schedule, true)
          document.addEventListener('keyup', schedule, true)
          document.addEventListener('mousedown', onDocumentDown, true)
          document.addEventListener('contextmenu', onContextMenu, true)
          document.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('scroll', onScroll, true)
          window.addEventListener('resize', onScroll, true)
          disposers.push(() => {
            document.removeEventListener('selectionchange', schedule)
            document.removeEventListener('pointerup', schedule, true)
            document.removeEventListener('keyup', schedule, true)
            document.removeEventListener('mousedown', onDocumentDown, true)
            document.removeEventListener('contextmenu', onContextMenu, true)
            document.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('scroll', onScroll, true)
            window.removeEventListener('resize', onScroll, true)
            if (pendingTimer !== null) clearTimeout(pendingTimer)
          })
        }

        // ── locale ───────────────────────────────────────────────────────
        try {
          const locale = ctx.get('locale')
          if (locale !== undefined && typeof locale.subscribe === 'function') {
            const read = () => {
              let id = null
              try {
                const snapshot = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null
                id = snapshot?.locale ?? snapshot?.id ?? (typeof locale.getLocale === 'function' ? locale.getLocale()?.locale : null)
              } catch { /* keep the previous language */ }
              if (typeof id === 'string' && id !== '') {
                // The service names ONE locale (no preference list behind it),
                // so an id the UI cannot serve falls back to en — same rule the
                // initial resolution applies to a preference list with no hit.
                const next = resolveLanguage([id], 'en')
                if (next !== lang) {
                  lang = next
                  store.set({})
                }
              }
            }
            read()
            const off = locale.subscribe(read)
            if (typeof off === 'function') disposers.push(off)
          }
        } catch (error) {
          console.error(`[${PLUGIN_ID}] locale probe failed:`, error)
        }

        // ── slot registrations ───────────────────────────────────────────
        //
        // A slot key is a version-scoped contract: `shell.overlay` has been the
        // frame-wide floating layer for the whole supported range, but nothing
        // guarantees it in a build we have not seen. Each registration below
        // therefore walks a LADDER of equivalent slots and keeps the best one
        // that is actually declared: a later rung is dropped the moment an
        // earlier one goes live, so the UI never doubles up.
        //
        // Every rung is a LIST slot on purpose — registering into a `single`
        // slot would REPLACE shipped UI (the catalog marks those
        // `shadows-shipped-ui`).
        const SLOT_PROBE_MS = 1500

        /**
         * Register one entry into the first ladder rung that accepts it.
         * @param {string[]} candidates - slot keys, best first.
         * @param {(slotKey: string) => {options: object, component: Function}} build
         * @param {(from: string, to: string) => void} [onFallback] - reported when
         *   a rung is skipped (the settings page shows the outcome).
         * @returns {() => void} disposer for every rung and timer.
         */
        const firstLiveSlot = (candidates, build, onFallback) => {
          const injected = []
          const timers = new Set()
          const registrations = new Map()
          let activeIndex = Number.POSITIVE_INFINITY
          let disposed = false

          const takeOver = (index, disposeRegistration) => {
            if (disposed || index >= activeIndex) {
              // A better rung is already live: this one is surplus.
              if (index >= activeIndex) {
                try {
                  disposeRegistration()
                } catch { /* already gone */ }
              }
              return
            }
            // This rung is better than whatever a previous fallback installed.
            for (const [otherIndex, entry] of registrations) {
              if (otherIndex <= index) continue
              try {
                entry.dispose()
              } catch { /* already gone */ }
              registrations.delete(otherIndex)
            }
            activeIndex = index
            registrations.set(index, { dispose: disposeRegistration })
          }

          const attempt = (index) => {
            if (disposed || index >= candidates.length) return
            const key = candidates[index]
            try {
              injected.push(ctx.slots.inject(key, () => {
                const built = build(key)
                const disposeRegistration = ctx.slots.register(built.options, built.component)
                takeOver(index, disposeRegistration)
                return disposeRegistration
              }))
            } catch (error) {
              console.error(`[${PLUGIN_ID}] slot inject failed for "${key}":`, error)
            }
            const timer = setTimeout(() => {
              timers.delete(timer)
              if (disposed) return
              const next = candidates[index + 1]
              if (next === undefined) return
              if (activeIndex <= index) return
              onFallback?.(key, next)
              attempt(index + 1)
            }, SLOT_PROBE_MS)
            timers.add(timer)
          }

          attempt(0)
          return () => {
            disposed = true
            for (const timer of timers) clearTimeout(timer)
            timers.clear()
            for (const entry of registrations.values()) {
              try {
                entry.dispose()
              } catch { /* already gone */ }
            }
            registrations.clear()
            for (const dispose of injected) {
              try {
                dispose()
              } catch { /* already gone */ }
            }
          }
        }

        /**
         * Debounced self-report to the Host. Diagnostics are best-effort: a
         * failure is logged and never surfaces as a user-visible error, and a
         * host too old to have the route is remembered so the channel is not
         * retried for the rest of the page's life.
         */
        let reportTimer = null
        let diagnosticsSupported = true
        const scheduleReport = (delay = 600) => {
          if (!diagnosticsSupported) return
          if (reportTimer !== null) clearTimeout(reportTimer)
          reportTimer = setTimeout(() => {
            reportTimer = null
            void postJson('diagnose', buildClientReport(store.state)).catch((error) => {
              if (isDiagnosticsUnsupported(error)) {
                diagnosticsSupported = false
                console.info(`[${PLUGIN_ID}] 宿主半尚不支持自检上报（宿主半比客户端旧，重启 DSH 后生效）`)
                return
              }
              console.warn(`[${PLUGIN_ID}] 自检上报失败（不影响功能）：`, error?.message ?? error)
            })
          }, delay)
        }

        /** Record which rung a registration actually landed on. */
        const noteSlot = (name, key) => {
          const slots = { ...(store.state.slots ?? {}), [name]: key }
          store.set({ slots })
          scheduleReport()
        }

        disposers.push(firstLiveSlot(
          ['shell.overlay', 'conversation.input.dock', 'conversation.composer.dock'],
          slotKey => ({
            options: { name: slotKey, id: IDS.overlay, order: 45, label: () => t('triggerLabel') },
            component: () => h(OverlayRoot, { actions }),
          }),
          (from, to) => {
            console.info(`[${PLUGIN_ID}] ${from} 不可用，浮层改挂 ${to}`)
            noteSlot('overlay', to)
          },
        ))
        noteSlot('overlay', 'shell.overlay')

        disposers.push(firstLiveSlot(
          ['settings.section', 'settings.plugins.tab'],
          slotKey => ({
            options: { name: slotKey, id: IDS.settings, order: 60, label: () => t('settingsTitle') },
            component: () => h(SettingsSection, { actions }),
          }),
          (from, to) => {
            console.info(`[${PLUGIN_ID}] ${from} 不可用，设置页改挂 ${to}`)
            noteSlot('settings', to)
          },
        ))
        noteSlot('settings', 'settings.section')

        disposers.push(firstLiveSlot(
          ['conversation.input.right', 'conversation.input.left', 'conversation.composer.dock', 'conversation.input.dock'],
          slotKey => ({
            options: { name: slotKey, id: IDS.sessionProbe, order: 90 },
            component: SessionProbe,
          }),
          (from, to) => {
            console.info(`[${PLUGIN_ID}] ${from} 不可用，会话 id 采集改挂 ${to}`)
            noteSlot('sessionProbe', to)
          },
        ))
        noteSlot('sessionProbe', 'conversation.input.right')

        // ── side-card surfaces ───────────────────────────────────────────
        // The native right rail: its registry accepts tab types and its
        // controller opens them by kind. Every call is defensive — an older
        // harness simply leaves `native` unavailable and `auto` falls through.
        //
        // PLACEHOLDER: native-rightbar — the call shapes below were taken from
        // the native surface's own consumer (`sidebarRightTabs.register` with a
        // `guide[]` entry, `sidebarRight.openTab(kind, { params })`, and the
        // keyed `sidebar.right.pane.tab` slot with `inject: sessionId => …`).
        // They are NOT verified on this machine (no right-rail composition),
        // so the whole block is capability-probed and try/caught: a mismatch
        // degrades to the next surface and logs, never breaks the plugin.
        // See README §6 for the replacement checklist.
        try {
          const uninject = ctx.inject(['sidebarRightTabs', 'sidebarRight'], (injected) => {
            try {
              const registry = injected.get('sidebarRightTabs')
              const controller = injected.get('sidebarRight')
              if (registry === null || registry === undefined) return
              surfaces.native.registry = registry
              surfaces.native.controller = controller ?? null
              // Register the tab TYPE first, then its body/title slots — and
              // roll the type back if a slot refuses to register.
              //
              // The host takes the id the moment `register` returns and refuses
              // a second registration of the same id; a slot registration that
              // throws (an already-inactive context during a reload/disposal)
              // would then leave the kind taken for the rest of the page's life,
              // rendering the host's "nothing can view this" face forever. This
              // mirrors what dsh-better-sidebar 0.22.1 fixed in its own native
              // glue (`disposeSafely` + partial-set release in
              // `src/client/native/index.ts`).
              let releaseType = null
              if (typeof registry.register === 'function') {
                const off = registry.register({
                  id: CARD_KIND,
                  kind: CARD_KIND,
                  title: () => t('answerTitle'),
                  guide: [{
                    id: CARD_KIND,
                    order: 120,
                    title: () => t('settingsTitle'),
                    description: () => t('settingsDesc'),
                  }],
                })
                releaseType = typeof off === 'function' ? off : null
                surfaces.native.dispose = releaseType
              }
              const slotDisposers = []
              try {
                slotDisposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
                  name: 'sidebar.right.pane.tab',
                  key: CARD_KIND,
                  inject: sessionId => ({ sessionId }),
                }, (props) => h(CardHost, { props, actions }))))
                slotDisposers.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
                  name: 'sidebar.right.pane.tab.title',
                  key: CARD_KIND,
                }, () => h('span', null, t('answerTitle')))))
              } catch (error) {
                for (const dispose of slotDisposers) {
                  try {
                    dispose()
                  } catch { /* releasing must not mask the failure */ }
                }
                if (releaseType !== null) {
                  try {
                    releaseType()
                  } catch { /* releasing must not mask the failure */ }
                  surfaces.native.dispose = null
                }
                surfaces.native.registry = null
                surfaces.native.controller = null
                throw error
              }
              disposers.push(() => {
                for (const dispose of slotDisposers) {
                  try { dispose() } catch { /* already disposed */ }
                }
                try { surfaces.native.dispose?.() } catch { /* already disposed */ }
              })
            } catch (error) {
              surfaces.native.error = String(error?.message ?? error)
              console.error(`[${PLUGIN_ID}] native right-rail adapter unavailable:`, error)
            }
          })
          // ctx.inject's own reverse-registration must unwind with the plugin
          // too, or the host keeps routing injections into a disposed fiber.
          if (typeof uninject === 'function') disposers.push(uninject)
        } catch (error) {
          surfaces.native.error = String(error?.message ?? error)
        }

        // The dsh-better-sidebar plugin, when installed: its client service
        // registers a tab type and opens one per card.
        //
        // Verified against the published consumer contract: between 0.22.0 and
        // 0.22.1 `lib/types/client/service.d.ts` is byte-identical apart from the
        // version constant, and 0.22.1's `src/client/native/index.ts` changes are
        // robustness fixes in ITS own native glue — no field we use changed. The
        // `features` array is the forward-compatible half of that contract
        // ("Features are never removed"), so the adapter gates on `tabMeta`
        // instead of on a version number.
        try {
          const uninject = ctx.inject(['betterSidebar'], (injected) => {
            try {
              const service = injected.get('betterSidebar')
              if (service === null || service === undefined) return
              const features = Array.isArray(service.features) ? service.features : []
              surfaces.better.features = features
              surfaces.better.version = typeof service.version === 'string' ? service.version : null
              surfaces.better.reason = features.includes('tabMeta') ? null : 'no-tab-meta'
              if (typeof service.registerTab !== 'function') {
                surfaces.better.reason = 'no-register-tab'
                return
              }
              const off = service.registerTab({
                // A DIFFERENT type from the native rail's: better-sidebar mirrors
                // this descriptor into `sidebarRightTabs` as an `extension`-band
                // registration, and a second registration of the same kind in
                // that band throws (see CARD_KIND_BETTER).
                id: CARD_KIND_BETTER,
                title: () => t('answerTitle'),
                description: () => t('settingsDesc'),
                order: 120,
                dedupeKey: tab => (tab?.meta?.cardId !== undefined ? String(tab.meta.cardId) : undefined),
                component: props => h(CardHost, {
                  props: { tab: props?.tab, sessionId: props?.scope?.sessionId },
                  actions,
                }),
              })
              surfaces.better.service = service
              surfaces.better.dispose = typeof off === 'function' ? off : null
              disposers.push(() => {
                try { surfaces.better.dispose?.() } catch { /* already disposed */ }
              })
            } catch (error) {
              surfaces.better.error = String(error?.message ?? error)
              console.error(`[${PLUGIN_ID}] better-sidebar adapter unavailable:`, error)
            }
          })
          if (typeof uninject === 'function') disposers.push(uninject)
        } catch (error) {
          surfaces.better.error = String(error?.message ?? error)
        }

        /** Embedded card body used by both external hosts. */
        function CardHost({ props }) {
          const state = useStoreState()
          const cardId = props?.tab?.meta?.cardId
          const card = state.cards.find(item => item.id === cardId)
          // The proof hook MUST run before any early return (hook order), and
          // it is what lets `submit` detect a host that never rendered us.
          React.useEffect(() => {
            if (typeof cardId !== 'string' || cardId === '') return undefined
            renderedCardId = cardId
            // Mounting settles the render proof, even when this host mounted
            // late (a lazy tab panel slower than the 600ms timer) — the proof
            // must never fire after the card is demonstrably on screen.
            const proof = pendingProofs.get(cardId)
            if (proof !== undefined) {
              clearTimeout(proof)
              pendingProofs.delete(cardId)
            }
            return () => {
              if (renderedCardId === cardId) renderedCardId = null
            }
          }, [cardId])
          if (card === undefined) {
            return h('div', { className: 'dsa-settings', 'data-dsa-root': '' },
              h(Styles, null),
              h('div', { className: 'dsa-muted' }, t('cardClosed')))
          }
          if (card.surface === 'flow') {
            // The proof already moved this card to the flow stack and this
            // host mounted afterwards. Rendering the answer again here would
            // show it in two places, so close the tab we can and leave the
            // note for a rail that keeps it.
            try { surfaces.native.close(card) } catch { /* the rail owns its lifecycle */ }
            try { surfaces.better.close(card) } catch { /* the host may already be gone */ }
            return h('div', { className: 'dsa-settings', 'data-dsa-root': '' },
              h(Styles, null),
              h('div', { className: 'dsa-muted' }, t('cardMovedToFlow')))
          }
          return h('div', { className: 'dsa-settings', 'data-dsa-root': '', style: { padding: '10px' } },
            h(Styles, null),
            h(AnswerCard, {
              card,
              surfaceLabel: state.surface === 'better-sidebar' ? t('surfaceBetter') : t('surfaceNative'),
              onCopy: element => actions.copy(card, element),
              onFollowUp: text => actions.followUp(card, text),
              onRetry: () => actions.retry(card),
              onRetryEdit: text => actions.retryEdit(card, text),
              onCancel: () => actions.cancel(card),
              onSendToMain: () => { void actions.sendToMain(card) },
              onClose: () => actions.close(card),
              onLocate: target => actions.locateCard(target ?? card),
              onExport: target => actions.exportCard(target ?? card),
              onInsert: target => actions.insertAnswer(target ?? card),
              onReplace: target => actions.insertAnswer(target ?? card, { replace: true }),
              onViewVersion: index => actions.viewVersion(card, index),
            }))
        }

        // ── boot ─────────────────────────────────────────────────────────
        try {
          restorePersisted()
        } catch (error) {
          // Corrupt-but-parseable history must never block startup.
          console.warn(`[${PLUGIN_ID}] card history restore failed:`, error)
        }

        // §4.5 family singleton: register this copy, (re)elect on every join
        // or leave, and gate the interaction surface on the verdict.
        const family = familyTable(window)
        family.join({ id: INSTANCE_ID, version: CLIENT_VERSION, at: Date.now() })
        const reelect = () => {
          const members = family.list()
          const leaderId = electFamilyLeader(members, INSTANCE_ID)
          const leader = leaderId === INSTANCE_ID
          const peers = members
            .filter(member => member.id !== INSTANCE_ID)
            .map(member => ({ id: member.id, version: member.version }))
          store.set({ familyLeader: leader, familyPeers: peers })
          scheduleReport(0)
          if (leader) detectLegacy()
        }
        const unsubscribeFamily = family.subscribe(reelect)

        // Legacy (≤1.0.x) detection: it never joins the registry, so watch
        // the overlay tree for an unmarked dsa-layer carrying family UI. The
        // suppression stylesheet then hides it; we only need detection to
        // raise the toast/report. Repeated matches are a no-op.
        let legacyAnnounced = false
        let legacyObserver = null
        const detectLegacy = () => {
          if (store.state.familyLeader !== true || legacyAnnounced === true) return
          const root = typeof document !== 'undefined' ? document : null
          if (root === null) return
          const found = findLegacyLayers(root).length > 0
          if (found === false) return
          legacyAnnounced = true
          // Inject the suppression rule directly: the React stylesheet only
          // exists while our overlay is mounted, but the legacy layer must
          // stay hidden even during its own re-renders.
          try {
            if (root.getElementById('dsa-family-legacy-style') === null) {
              const style = root.createElement('style')
              style.id = 'dsa-family-legacy-style'
              style.textContent = '.dsa-layer:not([data-dsa-owner]){display:none!important}'
              root.head?.appendChild(style)
            }
          } catch { /* React stylesheet already carries the same rule */ }
          store.set({ familyLegacy: true })
          toast(t('familyLegacyToast'))
          scheduleReport(0)
        }
        const legacyTimers = [300, 1200, 3000].map(delay => setTimeout(detectLegacy, delay))
        if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
          legacyObserver = new MutationObserver(() => detectLegacy())
          try {
            legacyObserver.observe(document.documentElement ?? document, { childList: true, subtree: true })
          } catch { /* document without a root yet — timers still cover it */ }
        }

        reelect()
        void refreshState().catch(() => { /* the settings page shows the failure */ })
        // One report after the slot ladders have had time to settle, so the
        // Host ends up holding the CLIENT's real registration state.
        scheduleReport(2500)
        disposers.push(() => {
          for (const controller of controllers.values()) controller.abort()
          controllers.clear()
          pendingDeltas.clear()
          pendingReasonings.clear()
          if (deltaFlushTimer !== null) {
            clearTimeout(deltaFlushTimer)
            deltaFlushTimer = null
          }
          for (const proof of pendingProofs.values()) clearTimeout(proof)
          pendingProofs.clear()
          if (toastTimer !== null) clearTimeout(toastTimer)
          if (reportTimer !== null) clearTimeout(reportTimer)
          for (const timer of legacyTimers) clearTimeout(timer)
          try {
            if (typeof document !== 'undefined' && document.getElementById) {
              document.getElementById('dsa-family-legacy-style')?.remove()
            }
          } catch { /* torn down */ }
          try { legacyObserver?.disconnect() } catch { /* already gone */ }
          try { unsubscribeFamily() } catch { /* registry torn down */ }
          try { family.leave(INSTANCE_ID) } catch { /* registry torn down */ }
          store.set({
            trigger: null,
            popover: null,
            contextMenu: null,
            cards: [],
            history: [],
            toast: null,
            sessionId: null,
            surface: 'flow',
          })
        })

        ctx.effect(() => () => {
          for (const dispose of disposers.splice(0)) {
            try {
              dispose()
            } catch (error) {
              console.error(`[${PLUGIN_ID}] cleanup failed:`, error)
            }
          }
        }, 'sidecard-ask: client activation')
      },

      /**
       * Test seam: pure helpers, frozen. The DSH client runtime only reads
       * `inject`/`apply`; `test/*.mjs` loads this file with a synthetic
       * `window` and exercises these without a browser.
       */
      api: Object.freeze({
        version: CLIENT_VERSION,
        /** Read-only state accessor for diagnostics and the test harness. */
        snapshot: () => store.state,
        pure: Object.freeze({
          CLIENT_DEFAULTS,
          IDS,
          CARD_KIND,
          CARD_KIND_BETTER,
          HISTORY_TURNS,
          estimateLabelWidth,
          parseSseBlock,
          truncateSelection,
          parseShortcut,
          matchesShortcut,
          quickActionsOf,
          renderActionQuestion,
          validateQuickActionsDraft,
          shortcutFingerprint,
          followUpChips,
          formatElapsed,
          formatHistoryTime,
          notificationSupported,
          notificationPermission,
          shouldNotifyFinish,
          buildFinishNotification,
          requestNotificationPermission,
          QUICK_ACTION_BUILTINS,
          QUICK_ACTION_LIMITS,
          FOLLOW_UP_CHIPS,
          CONTEXT_MENU_ACTION_LIMIT,
          classifyZone,
          slotPathOf,
          shouldOffer,
          selectionSignature,
          composeMainPrompt,
          askInMainConversation,
          buildClientReport,
          isDiagnosticsUnsupported,
          renderRichText,
          pickSurface,
          floatPlacement,
          compareVersions,
          electFamilyLeader,
          findLegacyLayers,
          localizeError,
          errorCodes: ERROR_CODES,
          resolveLanguage,
          dict: DICT,
          // 1.8.0 P2 surfaces
          MAX_CUSTOM_PERSONA_CHARS,
          MAX_CARD_VERSIONS,
          REWRITE_ACTION_IDS,
          LOCATE_HEAD_POINTS,
          LOCATE_TAIL_POINTS,
          buildTextSignature,
          locateSignature,
          locatePassageRange,
          normalizeForLocate,
          buildCardMarkdown,
          buildHistoryMarkdown,
          markdownFilename,
          fileStamp,
          canInsertAnswer,
          composerWriteSupport,
          composerReplaceAvailable,
          captureComposerTarget,
          nextComposerValue,
          insertIntoComposer,
          withVersion,
          versionPatch,
          parseFollowUps,
          streamVisibleText,
          splitFollowUpList,
          MAX_FOLLOWUP_CHIPS,
        }),
      }),
    }
  },
})
