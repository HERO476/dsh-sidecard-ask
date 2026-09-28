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
    /** Side-card tab type registered in a side-card host. */
    const CARD_KIND = 'sidecard-ask:card'

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
    }

    /** Zone classification: slot-key patterns the harness itself renders. */
    const ZONE_PATTERNS = {
      chat: [/^conversation\b/],
      task: [/\btask/i, /\btodo/i, /\bschedule/i, /\bteam/i, /\bjob/i, /\bplan/i, /^rightbar\b/, /^sidebar\.right\b/],
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

    /** The active language id, kept in step with the harness locale service. */
    let lang = (() => {
      const raw = typeof navigator !== 'undefined' && typeof navigator.language === 'string'
        ? navigator.language.toLowerCase()
        : 'zh'
      return raw.startsWith('zh') ? 'zh' : 'en'
    })()

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
      if (candidate.text.trim().length < config.minChars) return { ok: false, reason: 'too-short' }
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
     * tail. Mirrors the Host's `truncateSelection` (asserted by contract test).
     * @returns {{text: string, truncated: boolean, droppedChars: number}}
     */
    function truncateSelection(text, maxChars) {
      const source = typeof text === 'string' ? text : ''
      if (source.length <= maxChars) return { text: source, truncated: false, droppedChars: 0 }
      const head = Math.max(1, Math.ceil(maxChars * 0.7))
      const tail = Math.max(0, maxChars - head)
      const dropped = source.length - head - tail
      return {
        text: `${source.slice(0, head)}\n…（已省略中间 ${dropped} 个字符）…\n${tail > 0 ? source.slice(source.length - tail) : ''}`,
        truncated: true,
        droppedChars: dropped,
      }
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
        close() {
          // The right rail owns its tab lifecycle; the store entry is enough.
          return true
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
          const tabId = `${CARD_KIND}:${card.id}`
          // `meta` is the transport for the card id (feature `tabMeta`), and
          // `dedupeKey` on our descriptor is what collapses repeat opens onto
          // the same tab; both are part of the stable consumer contract
          // (`lib/types/client/service.d.ts`, unchanged across 0.22.0 → 0.22.1).
          this.service.openTab(
            { type: CARD_KIND, id: tabId, title: card.question.slice(0, 32), meta: { cardId: card.id } },
            store.state.sessionId === null ? undefined : { sessionId: store.state.sessionId },
          )
          return true
        },
        close(card) {
          if (!this.available() || typeof this.service.closeTab !== 'function') return false
          this.service.closeTab(`${CARD_KIND}:${card.id}`)
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
.dsa-layer{pointer-events:none;position:relative;z-index:60}
.dsa-trigger{pointer-events:auto;position:fixed;display:flex;align-items:center;gap:4px;
  padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  font-size:12px;line-height:16px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);font-family:inherit}
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
.dsa-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));border-radius:8px;overflow:hidden}
.dsa-seg button{padding:3px 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary, #555);
  font:inherit;font-size:12px;cursor:pointer}
.dsa-seg button[data-on="true"]{background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
  color:var(--dsw-alias-label-primary, #111);font-weight:500}
.dsa-card{pointer-events:auto;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-overlay, #fff);color:var(--dsw-alias-label-primary, #111);
  box-shadow:0 10px 30px rgba(0,0,0,.22);font-size:13px;line-height:19px}
.dsa-stack{pointer-events:none;position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;
  width:min(400px, 92vw);max-height:70vh;overflow:auto}
.dsa-answer{max-height:44vh;overflow:auto;word-break:break-word}
.dsa-answer .dsa-p{margin:0 0 6px}
.dsa-answer .dsa-ul{margin:0 0 6px;padding-left:18px}
.dsa-answer .dsa-h{font-weight:600;margin:0 0 6px}
.dsa-answer .dsa-gap{height:4px}
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

    /** Inline markdown-lite: `code` and **bold** only — never innerHTML. */
    function inlineNodes(text, key) {
      const out = []
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) out.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          out.push(h('code', { key: `c${key}-${index++}`, className: 'dsa-code' }, token.slice(1, -1)))
        } else {
          out.push(h('strong', { key: `b${key}-${index++}` }, token.slice(2, -2)))
        }
        last = match.index + token.length
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    /**
     * Render answer text as React nodes: fenced code, lists, headings,
     * paragraphs. No HTML injection anywhere, so model output cannot become
     * markup.
     */
    function renderRichText(text) {
      const lines = String(text ?? '').split('\n')
      const nodes = []
      let i = 0
      let key = 0
      const isBullet = line => /^\s*([-*+]|\d+\.)\s+/.test(line)
      const isHeading = line => /^#{1,6}\s+/.test(line)
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
        ) {
          paragraph.push(lines[i])
          i += 1
        }
        nodes.push(h('p', { key: `p${key}`, className: 'dsa-p' }, inlineNodes(paragraph.join('\n'), key)))
        key += 1
      }
      return nodes
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
      const box = clampBox(candidate.rect, 132, 30, 'below')
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
        h('span', { className: 'dsa-badge' }, t('chars', { n: candidate.text.length })),
        cut.truncated
          ? h('span', { className: 'dsa-badge dsa-badge-warn' }, t('truncatedBadge', { n: cut.droppedChars }))
          : null),
      h('pre', { className: 'dsa-quote' }, candidate.text.length > 400 ? `${candidate.text.slice(0, 400)}…` : candidate.text),
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
      if (card.error !== null) {
        const engineMissing = card.error.code === 'no-side-engine' || card.error.code === 'no-parent'
        return h('div', { className: 'dsa-error' },
          h('div', { className: 'dsa-title' }, t('errorTitle')),
          h('div', null, card.error.message ?? String(card.error.code ?? '')),
          engineMissing ? h('div', { className: 'dsa-muted' }, t('errorNoSideEngine')) : null)
      }
      if (card.text === '' && card.status === 'streaming') {
        return h('div', { className: 'dsa-muted' }, t('answerStreaming'))
      }
      if (card.text === '' && card.status === 'done') {
        return h('div', { className: 'dsa-muted' }, t('answerEmpty'))
      }
      return h('div', { className: 'dsa-answer', ref: containerRef }, renderRichText(card.text))
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

    /** One answer card; `embedded` is true inside a host's tab. */
    function AnswerCard({ card, surfaceLabel, onCopy, onFollowUp, onRetry, onClose, onCancel, onSendToMain }) {
      const [followOpen, setFollowOpen] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const answerRef = React.useRef(null)
      const config = store.state.config
      return h('section', { className: 'dsa-card', 'aria-label': t('answerTitle') },
        h('div', { className: 'dsa-row' },
          h('span', { className: 'dsa-title' }, t('answerTitle')),
          h('span', { className: 'dsa-badge' }, zoneLabel(card)),
          surfaceLabel !== null ? h('span', { className: 'dsa-badge' }, surfaceLabel) : null,
          card.truncated ? h('span', { className: 'dsa-badge dsa-badge-warn' }, t('truncatedBadge', { n: card.droppedChars })) : null),
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

    /** The flow surface: a fixed stack of cards at the frame's bottom-right. */
    function FlowStack({ cards, actions }) {
      const visible = cards.filter(card => card.surface === 'flow' && card.open)
      if (visible.length === 0) return null
      return h('div', { className: 'dsa-stack', 'data-dsa-root': '' },
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
        })))
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
        h(FlowStack, { cards: state.cards, actions }),
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
          ]))),
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
                h('div', { key: 'sidecard' }, `${t('diagSidecard')}: ${describeSidecardAdapter()}`),
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
     * One line describing how the optional side-card plugin resolved, for the
     * settings page's capability check. Reported from the plugin's OWN
     * `version`/`features` fields, so the answer is what is running, not what
     * package.json claims.
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
        const pendingProofs = new Set()
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
              cross: candidate.cross,
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
              } else {
                // Render proof: an adapter that accepts the open but never
                // mounts our body would leave an empty tab. Unless the card is
                // on screen shortly after, move it to the flow stack — the
                // card's data lives in the store, so the running stream simply
                // continues in the other surface.
                const proof = setTimeout(() => {
                  pendingProofs.delete(proof)
                  const live = store.state.cards.find(item => item.id === card.id)
                  if (live === undefined || live.surface === 'flow') return
                  if (renderedCardId === card.id) return
                  store.set({ surface: 'flow', surfaceNote: t('surfaceUnproven') })
                  patchCard(card.id, { surface: 'flow' })
                  toast(t('surfaceUnproven'))
                }, 600)
                pendingProofs.add(proof)
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
            if (controller !== undefined) controller.abort()
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
            controllers.get(card.id)?.abort()
            controllers.delete(card.id)
            if (card.surface === 'better-sidebar') {
              try {
                surfaces.better.close(card)
              } catch { /* the host may already be gone */ }
            }
            store.set({ cards: store.state.cards.filter(item => item.id !== card.id) })
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
            cross: card.cross,
            carrier: 'side',
            sessionId: currentSessionId(ctx),
            history: card.history.slice(-6),
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
            onDelta: data => appendCardText(cardId, String(data?.text ?? '')),
            onReasoning: data => appendCardReasoning(cardId, String(data?.text ?? '')),
            onDone: (data) => {
              const current = store.state.cards.find(item => item.id === cardId)
              patchCard(cardId, {
                status: data?.aborted === true ? 'stopped' : 'done',
                streaming: data?.streaming === true,
                text: typeof data?.text === 'string' && data.text !== '' ? data.text : (current?.text ?? ''),
              })
              controllers.delete(cardId)
            },
            onError: (error) => {
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
                const next = id.toLowerCase().startsWith('zh') ? 'zh' : 'en'
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

        /** Record which rung a registration actually landed on. */
        const noteSlot = (name, key) => {
          const slots = { ...(store.state.slots ?? {}), [name]: key }
          store.set({ slots })
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
          ctx.inject(['sidebarRightTabs', 'sidebarRight'], (injected) => {
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
          ctx.inject(['betterSidebar'], (injected) => {
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
                id: CARD_KIND,
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
            return () => {
              if (renderedCardId === cardId) renderedCardId = null
            }
          }, [cardId])
          if (card === undefined) {
            return h('div', { className: 'dsa-settings', 'data-dsa-root': '' },
              h(Styles, null),
              h('div', { className: 'dsa-muted' }, t('answerEmpty')))
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
        void refreshState().catch(() => { /* the settings page shows the failure */ })
        disposers.push(() => {
          for (const controller of controllers.values()) controller.abort()
          controllers.clear()
          for (const proof of pendingProofs) clearTimeout(proof)
          pendingProofs.clear()
          if (toastTimer !== null) clearTimeout(toastTimer)
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
        version: '1.2.0',
        /** Read-only state accessor for diagnostics and the test harness. */
        snapshot: () => store.state,
        pure: Object.freeze({
          CLIENT_DEFAULTS,
          IDS,
          CARD_KIND,
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
          renderRichText,
          pickSurface,
          dict: DICT,
        }),
      }),
    }
  },
})
