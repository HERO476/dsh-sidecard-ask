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
    const CLIENT_VERSION = '1.5.1'

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
        cards: [],
        toast: null,
        /** Whether the harness renders the `data-slot` zone anchors (null = unknown yet). */
        zoneAnchors: null,
        /** Which ladder rung each registration actually landed on. */
        slots: {},
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
.dsa-layer,.dsa-trigger,.dsa-pop,.dsa-float,.dsa-stack,.dsa-card,.dsa-toast,.dsa-settings{-webkit-app-region:no-drag}
.dsa-layer{pointer-events:none;position:relative;z-index:60}
.dsa-trigger{pointer-events:auto;position:fixed;display:flex;align-items:center;gap:4px;
  padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  font-size:12px;line-height:16px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);
  font-family:inherit;white-space:nowrap}
.dsa-trigger:hover{border-color:var(--dsw-alias-brand-primary, #4c8dff)}
.dsa-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:1px}
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
.dsa-diag{display:flex;flex-direction:column;gap:2px;font-size:12px;
  color:var(--dsw-alias-label-secondary, #555)}
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
          nodes.push(h('pre', { key: `f${key++}`, className: 'dsa-pre' }, h('code', null, body.join('\n'))))
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
    // §9 components
    // ─────────────────────────────────────────────────────────────────────

    /** The in-place trigger button floating at the selection. */
    function TriggerButton({ candidate, onOpen }) {
      // The clamp width follows the live label: icon + gap + padding + border
      // (~38px of chrome) plus a safety margin, over the estimated label width.
      const width = Math.ceil(estimateLabelWidth(t('triggerLabel')) + 62)
      const box = clampBox(candidate.rect, width, 30, 'below')
      return h('button', {
        type: 'button',
        className: 'dsa-trigger',
        style: { left: `${box.left}px`, top: `${box.top}px` },
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

    /** The question popover. */
    function AskPopover({ candidate, config, onClose, onSubmit }) {
      const [question, setQuestion] = React.useState('')
      const [carrier, setCarrier] = React.useState(config.defaultCarrier)
      const [busy, setBusy] = React.useState(false)
      const areaRef = React.useRef(null)
      const cut = truncateSelection(candidate.text, config.maxChars)
      const box = clampBox(candidate.rect, 420, 260, 'below')

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
      if (card.text === '' && card.status === 'streaming') {
        return h('div', null, reasoning, h('div', { className: 'dsa-muted' }, t('answerStreaming')))
      }
      if (card.text === '' && card.status === 'done') {
        return h('div', null, reasoning, h('div', { className: 'dsa-muted' }, t('answerEmpty')))
      }
      return h('div', { className: 'dsa-answer', ref: containerRef },
        reasoning, renderRichText(card.text))
    }

    /** Card footer: status, copy, follow-up, retry, close. */
    function CardActions({ card, onCopy, onFollowUp, onRetry, onClose, onCancel, onSendToMain }) {
      const terminal = card.status === 'done' || card.status === 'error' || card.status === 'stopped'
      return h('div', { className: 'dsa-row' },
        h('span', { className: 'dsa-muted' },
          card.status === 'streaming' ? t('answerStreaming')
            : card.status === 'done' ? (card.streaming === false ? t('answerNonStreaming') : t('answerDone'))
              : card.status === 'stopped' ? t('answerStopped') : t('answerTitle')),
        card.status === 'streaming'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onCancel }, t('cancelAnswer'))
          : null,
        terminal && card.status !== 'done'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onRetry }, t('retry'))
          : null,
        card.status === 'error' && card.carrier === 'side'
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onSendToMain }, t('sendToMain'))
          : null,
        terminal && card.text !== ''
          ? h('button', { type: 'button', className: 'dsa-btn', onClick: onCopy }, t('copy'))
          : null,
        terminal
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
    function AnswerCard({ card, surfaceLabel, onCopy, onFollowUp, onRetry, onClose, onCancel, onSendToMain, onFloatMode }) {
      const [followOpen, setFollowOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const answerRef = React.useRef(null)
      const config = store.state.config
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
      return h('section', { className: 'dsa-card', 'aria-label': t('answerTitle') },
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
        h('pre', { className: 'dsa-quote' }, card.question),
        h(AnswerBody, { card, containerRef: answerRef }),
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
        h(CardActions, {
          card,
          onCopy: () => onCopy(answerRef.current),
          onRetry,
          onCancel,
          onSendToMain,
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
          onCancel: () => actions.cancel(card),
          onSendToMain: () => actions.sendToMain(card),
          onClose: () => actions.close(card),
          onFloatMode: setFloatMode,
        }))))
    }

    /** The `shell.overlay` entry: styles + trigger + popover + cards + toast. */
    function OverlayRoot({ actions }) {
      const state = useStoreState()
      const config = state.config
      const candidate = state.trigger
      const popover = state.popover
      return h('div', { className: 'dsa-layer', 'data-dsa-root': '' },
        h(Styles, null),
        candidate !== null && popover === null && config.trigger !== 'shortcut'
          ? h(TriggerButton, { candidate, onOpen: () => actions.openPopover(candidate) })
          : null,
        popover !== null
          ? h(AskPopover, {
            candidate: popover.candidate,
            config,
            onClose: () => actions.closePopover(),
            onSubmit: payload => actions.submit(popover.candidate, payload),
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
      const config = state.config

      React.useEffect(() => { setDraft(config) }, [config])

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

      const save = async () => {
        if (parseShortcut(draft.shortcut) === null) {
          setStatus(`error:${t('unsupportedTrigger')}`)
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

      return h('div', { className: 'dsa-settings', 'data-dsa-root': '' },
        h(Styles, null),
        h('div', null,
          h('div', { className: 'dsa-title' }, t('settingsTitle')),
          h('div', { className: 'dsa-muted' }, t('settingsDesc'))),
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
          field(t('setSideProvider'), providerSelect(), t('setSideProviderHint'))),
        h('label', { className: 'dsa-check' },
          h('input', {
            type: 'checkbox',
            checked: draft.showInUnclassified === true,
            onChange: event => setDraft({ ...draft, showInUnclassified: event.target.checked }),
          }),
          t('setUnclassified')),
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
        const PERSIST_KEY = 'dsh-sidecard-ask:cards:v1'
        const PERSIST_MAX_CARDS = 10
        const PERSIST_TEXT_LIMIT = 65536

        function readPersisted() {
          let raw = null
          try {
            raw = window.localStorage?.getItem(PERSIST_KEY)
          } catch { return [] }
          if (raw === null || raw === undefined) return []
          try {
            const value = JSON.parse(raw)
            if (value?.version !== 1 || !Array.isArray(value.cards)) return []
            return value.cards
              .filter(entry => typeof entry?.id === 'string' && entry.id !== '' && typeof entry.question === 'string')
              .slice(0, PERSIST_MAX_CARDS)
          } catch { return [] }
        }

        function writePersisted(cards) {
          try {
            window.localStorage?.setItem(PERSIST_KEY, JSON.stringify({ version: 1, cards }))
          } catch (error) {
            // Quota or privacy mode — the cards stay on screen, just not durable.
            console.warn(`[${PLUGIN_ID}] card history not persisted:`, error)
          }
        }

        /** Recompute the durable set from the live store and write it. */
        const syncPersisted = () => {
          const finished = store.state.cards
            .filter(card => card.carrier === 'side'
              && (card.status === 'done' || card.status === 'stopped')
              && card.text !== '')
            .slice(0, PERSIST_MAX_CARDS)
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
              history: Array.isArray(card.history) ? card.history.slice(-12) : [],
            }))
          writePersisted(finished)
        }

        /** Replay finished cards from a previous page load into the store. */
        const restorePersisted = () => {
          const saved = readPersisted()
          if (saved.length === 0) return
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

        const actions = {
          openPopover(candidate) {
            store.set({ popover: { candidate } })
          },
          closePopover() {
            store.set({ popover: null })
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
          copy(card, element) {
            void copyText(card.text, element).then((result) => {
              toast(result === 'copied' ? t('copied') : result === 'selected' ? t('copySelectedHint') : t('copyFailed'))
            })
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
            patchCard(card.id, { status: 'pending', text: '', reasoning: '', error: null, streaming: null })
            if (card.carrier === 'side') void runSideCard(card.id)
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
            syncPersisted()
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
          patchCard(cardId, { status: 'streaming', text: '', reasoning: '', error: null })
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
              patchCard(cardId, {
                status: data?.aborted === true ? 'stopped' : 'done',
                streaming: data?.streaming === true,
                text: typeof data?.text === 'string' && data.text !== '' ? data.text : (current?.text ?? ''),
                reasoning: typeof data?.reasoning === 'string' ? data.reasoning : (current?.reasoning ?? ''),
              })
              controllers.delete(cardId)
              syncPersisted()
            },
            onError: (error) => {
              if (controller.signal.aborted) return
              flushStreamBuffers()
              patchCard(cardId, { status: 'error', error })
              controllers.delete(cardId)
            },
          })
        }

        // ── selection listeners ──────────────────────────────────────────
        const evaluate = () => {
          pendingTimer = null
          const config = store.state.config
          const candidate = readSelection()
          // Zone anchors: the harness stamps every slot outlet with
          // `data-slot="<key>"`. A build that renders no such marker (or a
          // selection made outside the frame's own tree) leaves the slot path
          // empty, and then region filtering is impossible — reported once and
          // relaxed rather than silently swallowing every trigger.
          if (candidate !== null) {
            const anchored = candidate.slotPath.length > 0
            if (store.state.zoneAnchors !== anchored) {
              store.set({ zoneAnchors: anchored })
              if (!anchored) {
                console.info(`[${PLUGIN_ID}] 该版本没有 data-slot 锚点，区域过滤不可用，已按"全部区域"工作`)
              }
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
        }

        const onKeyDown = (event) => {
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
          if (event.key === 'Escape') {
            if (store.state.popover !== null) store.set({ popover: null })
          }
        }

        const onScroll = () => {
          if (store.state.popover === null && store.state.trigger !== null) store.set({ trigger: null })
        }

        if (typeof document !== 'undefined') {
          document.addEventListener('selectionchange', schedule)
          document.addEventListener('pointerup', schedule, true)
          document.addEventListener('keyup', schedule, true)
          document.addEventListener('mousedown', onDocumentDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('scroll', onScroll, true)
          window.addEventListener('resize', onScroll, true)
          disposers.push(() => {
            document.removeEventListener('selectionchange', schedule)
            document.removeEventListener('pointerup', schedule, true)
            document.removeEventListener('keyup', schedule, true)
            document.removeEventListener('mousedown', onDocumentDown, true)
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
              onCancel: () => actions.cancel(card),
              onSendToMain: () => { void actions.sendToMain(card) },
              onClose: () => actions.close(card),
            }))
        }

        // ── boot ─────────────────────────────────────────────────────────
        try {
          restorePersisted()
        } catch (error) {
          // Corrupt-but-parseable history must never block startup.
          console.warn(`[${PLUGIN_ID}] card history restore failed:`, error)
        }
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
          store.set({
            trigger: null,
            popover: null,
            cards: [],
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
          localizeError,
          errorCodes: ERROR_CODES,
          resolveLanguage,
          dict: DICT,
        }),
      }),
    }
  },
})
