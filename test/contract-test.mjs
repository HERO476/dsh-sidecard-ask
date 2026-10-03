/**
 * contract-test.mjs — the Host↔Client wire and constant contract.
 *
 * Every check here exists because a mismatch of this kind fails *silently* in
 * the browser: the card would sit on "作答中…" forever, the settings page
 * would render an empty form, or the side panel would never appear. The test
 * drives the real Host routes, feeds their real output into the real Client
 * half, and compares the two halves' constants and pure helpers.
 *
 * Run: `node test/contract-test.mjs`.
 */

import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ROOT, HOST_ENTRY, CLIENT_ENTRY, createReporter, makeHostCtx, makeSubagentEngine,
  callRoute, loadClientModule, makeClientCtx, expandTree, byClass, byTag, textOf, hostModuleUrl,
  createLocalStorageStub,
} from './harness.mjs'

// The host persists user config under $DSH_HOME; point it at a scratch
// directory so running the tests never touches the developer's real profile.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'sidecard-ask-contract-'))

const report = createReporter('contract')
const host = await import(hostModuleUrl('contract'))
const clientSource = readFileSync(CLIENT_ENTRY, 'utf8')
const hostSource = readFileSync(HOST_ENTRY, 'utf8')

// ────────────────────────────────────────────────────────────────────────────
// A live host instance, driven over its real routes
// ────────────────────────────────────────────────────────────────────────────

const harness = makeHostCtx({})
const engine = makeSubagentEngine({
  emit: (event, ...args) => harness.emit(event, ...args),
  frames: ['**Pro** ', 'contract ', 'answer'],
})
harness.services.subagents = engine.service
harness.services.agents = {
  get: id => (id === 'session-alpha' ? { id: 'session-alpha' } : undefined),
  roots: () => [{ id: 'session-alpha' }],
  list: () => [{ id: 'session-alpha' }],
}
harness.services.tools = {
  schemas: () => [{ name: 'read' }, { name: 'grep' }, { name: 'write' }],
}
host.apply(harness.ctx, { trigger: 'both', maxChars: 1200 })

/** Serve the host's own responses to the client half as a fetch. */
function hostFetch(url, init = {}) {
  const path = String(url).replace('/sidecard-ask/api/', '')
  const body = init.body === undefined ? null : JSON.parse(init.body)
  const method = init.method ?? 'POST'
  if (path.startsWith('ask')) {
    return (async () => {
      const res = await callRoute(harness, '/ask', { body })
      const text = res.text()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        },
      })
      return { ok: true, status: 200, body: stream, json: async () => JSON.parse(text) }
    })()
  }
  return (async () => {
    const res = await callRoute(harness, `/${path}`, { method, body })
    return { ok: res.status === 0 || res.status < 400, status: res.status, json: async () => res.json() }
  })()
}

const loadedClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
const client = loadedClient.module
const pure = client.api.pure

// ────────────────────────────────────────────────────────────────────────────
// 1. constants
// ────────────────────────────────────────────────────────────────────────────

console.log('constants')
report.equal(pure.CLIENT_DEFAULTS, host.DEFAULT_CONFIG, 'client defaults mirror the host defaults exactly')

// D16: the card-history cap lived as a bare `6` on both sides; one drifted
// constant would silently change what the child ever sees.
report.equal(pure.HISTORY_TURNS, host.HISTORY_TURNS, 'client and host keep the same history-turn cap')
report.equal(
  host.buildSidePrompt({
    selection: 'S', question: 'Q', zone: 'chat', truncated: false,
    history: Array.from({ length: 10 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` })),
    historyTurns: host.HISTORY_TURNS,
  }).includes('q3:'),
  false,
  'the host prompt keeps only the last HISTORY_TURNS turns',
)
report.ok(
  host.buildSidePrompt({
    selection: 'S', question: 'Q', zone: 'chat', truncated: false,
    history: Array.from({ length: 10 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` })),
    historyTurns: host.HISTORY_TURNS,
  }).includes('Question: q4'),
  'the newest turn still rides the prompt',
)

const clientPrefix = /const API = '([^']+)'/.exec(clientSource)?.[1]
report.equal(clientPrefix, host.ROUTE_PREFIX, 'client API base equals the host route prefix')

const hostEvents = new Set([...hostSource.matchAll(/sink\.send\('([a-z]+)'/g)].map(match => match[1]))
const hostTerminalEvents = ['done', 'error']
const clientEvents = new Set([...clientSource.matchAll(/event === '([a-z]+)'/g)].map(match => match[1]))
for (const event of hostEvents) {
  report.ok(clientEvents.has(event) || event === 'status', `client parses the host's "${event}" event`)
}
for (const event of hostTerminalEvents) {
  report.ok(hostEvents.has(event), `host emits a terminal "${event}" event`)
}

const clientMethods = new Set([...clientSource.matchAll(/postJson\('([a-z]+)'/g)].map(match => match[1]))
clientMethods.add('state')
clientMethods.add('ask')
report.ok(clientMethods.size >= 4, 'client uses the documented method surface')
for (const method of clientMethods) {
  const path = method === 'state' ? '/state' : `/${method}`
  const res = await callRoute(harness, path, {
    method: method === 'state' ? 'GET' : 'POST',
    body: method === 'ask' ? { id: 'probe', question: 'q', selection: 's' } : {},
  })
  report.ok(res.status !== 404, `host route accepts "${method}"`, `status ${res.status}`)
}

console.log('\nhost error localization')
// C10: the Host hardcodes its message lines in Chinese, so an English
// interface used to show them raw. Static host codes are now mapped to the
// Client's own dictionaries; codes whose message carries a live diagnostic
// (the reason only exists inside the Host string) keep that string verbatim.
{
  const HOST_STATIC_CODES = ['too-large', 'bad-request', 'unloaded', 'duplicate', 'busy', 'no-side-engine', 'no-parent', 'aborted']
  const HOST_DYNAMIC_CODES = ['blocked-step', 'engine-error', 'internal']
  for (const code of HOST_STATIC_CODES) {
    report.ok(pure.errorCodes[code] !== undefined, `host code "${code}" is localized client-side`)
    const key = pure.errorCodes[code]?.key
    report.ok(key !== undefined && pure.dict.zh[key] !== undefined, `the zh dictionary carries "${key}"`)
    report.ok(key !== undefined && pure.dict.en[key] !== undefined, `the en dictionary carries "${key}"`)
  }
  for (const code of HOST_DYNAMIC_CODES) {
    report.ok(pure.errorCodes[code] === undefined, `host code "${code}" keeps its Host message (live diagnostic)`)
  }
  const literalCodes = new Set([...hostSource.matchAll(/code: '([a-z-]+)'/g)].map(match => match[1]))
  for (const code of literalCodes) {
    report.ok(
      HOST_STATIC_CODES.includes(code) || HOST_DYNAMIC_CODES.includes(code),
      `host error code "${code}" is classified (mapped or deliberately verbatim)`,
    )
  }
  const enClient = loadClientModule({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }),
    language: 'en',
  })
  const enPure = enClient.module.api.pure
  report.equal(
    enPure.localizeError({ code: 'unloaded', message: '插件正在卸载' }),
    'The plugin is unloading and cannot take new follow-ups',
    'an English interface shows the English line, not the Host Chinese message',
  )
  report.equal(
    pure.localizeError({ code: 'unloaded', message: '插件正在卸载' }),
    '插件正在卸载，无法受理新的追问',
    'a Chinese interface shows the zh line',
  )
  report.equal(
    pure.localizeError({ code: 'engine-error', message: '作答失败（refusal）：engine said no' }),
    '作答失败（refusal）：engine said no',
    'a diagnostic-bearing code keeps the Host message verbatim',
  )
  const busyLine = pure.localizeError({ code: 'busy', message: '并发追问已达上限（3），请稍后再试' })
  report.ok(busyLine.includes('3'), `the busy line interpolates the live limit (got "${busyLine}")`)
  report.equal(pure.localizeError(null), '', 'a null error renders as an empty line')
}

console.log('\nlanguage resolution')
// C12: the boot language used to come from navigator.language alone, parsed
// separately from the harness locale subscription. One helper now walks the
// whole navigator.languages preference list: an unsupported first choice
// yields to the next supported one instead of the hard fallback.
{
  report.equal(pure.resolveLanguage(['ja-JP', 'zh-HK'], 'en'), 'zh', 'a preference list falls through to its second choice')
  report.equal(pure.resolveLanguage(['en-US', 'zh-CN'], 'en'), 'en', 'the first preference wins')
  report.equal(pure.resolveLanguage(['ja-JP'], 'en'), 'en', 'a list with no known entry uses the caller fallback')
  report.equal(pure.resolveLanguage([], 'zh'), 'zh', 'an empty list uses the caller fallback')
  report.equal(pure.resolveLanguage([null, '', 'en-GB'], 'zh'), 'en', 'dirty entries are skipped, not fatal')
  const stubFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: {} }) })
  const jaCtx = makeClientCtx({})
  const jaClient = loadClientModule({ fetchImpl: stubFetch, language: 'ja-JP', languages: ['ja-JP', 'zh-HK'] })
  jaClient.module.apply(jaCtx.ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  const jaSettings = jaCtx.find('settings.section', pure.IDS.settings)
  const jaText = textOf(expandTree(jaClient.shim.React.createElement(jaSettings.component, {})))
  report.ok(jaText.includes('划词追问'), 'a navigator listing ja then zh serves the zh UI (second preference wins)')
  const frCtx = makeClientCtx({})
  const frClient = loadClientModule({ fetchImpl: stubFetch, language: 'fr-FR', languages: ['fr-FR'] })
  frClient.module.apply(frCtx.ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  const frSettings = frCtx.find('settings.section', pure.IDS.settings)
  const frText = textOf(expandTree(frClient.shim.React.createElement(frSettings.component, {})))
  report.ok(frText.includes('Selection Ask'), 'a navigator carrying no known language falls back to en')
}

// ────────────────────────────────────────────────────────────────────────────
// 2. response envelopes the client reads
// ────────────────────────────────────────────────────────────────────────────

console.log('\nresponse envelopes')
const stateRes = await callRoute(harness, '/state', { method: 'GET' })
const stateBody = stateRes.json()
report.equal(stateBody.ok, true, '/state answers {ok:true, …}')
report.ok(stateBody.value?.config !== undefined, '/state value carries config (client reads value.config)')
report.ok(stateBody.value?.capabilities !== undefined, '/state value carries capabilities')
report.ok(stateBody.value?.provenance !== undefined, '/state value carries provenance')

const configRes = await callRoute(harness, '/config', { body: { maxChars: 1500 } })
report.ok(configRes.status < 400, '/config accepts a valid patch')
const configBody = configRes.json()
report.equal(configBody.ok, true, '/config answers {ok:true, …}')
report.equal(configBody.value?.config?.maxChars, 1500, '/config returns the effective config')
report.ok(configBody.value?.provenance !== undefined, '/config returns provenance (same body as /state)')
report.ok(
  configBody.value?.problems !== undefined && configBody.value?.provenance !== undefined,
  '/config response shape equals /state (bare snapshots would break the settings page)',
)

// ────────────────────────────────────────────────────────────────────────────
// 3. SSE framing — host output consumed by the client parser
// ────────────────────────────────────────────────────────────────────────────

console.log('\nSSE framing')
const startsBefore = engine.starts.length
const askRes = await callRoute(harness, '/ask', {
  body: {
    id: 'contract-ask',
    question: '这段讲的什么？',
    selection: 'DSH 的槽位层会给每个出口打上 data-slot 标记。',
    zone: 'chat',
    sessionId: 'session-alpha',
    history: [{ question: '之前问过什么？', answer: '之前答过什么。' }],
  },
})
const runIndex = startsBefore
const events = askRes.events()
report.equal(
  events.map(event => event.event),
  ['start', 'delta', 'delta', 'delta', 'status', 'done'],
  'host emits start → deltas → status → done',
)
report.equal(events.at(-1).data.text, '**Pro** contract answer', 'done carries the full text')
report.equal(events.at(-1).data.streaming, true, 'done reports that frames really streamed')
report.equal(events[0].data.provider, 'spawn', 'start reports the provider that answered')
report.equal(engine.starts.length, startsBefore + 1, 'the ask started exactly one child run')
report.ok(engine.promptOf(runIndex).includes('之前问过什么？'), 'follow-up history reaches the child prompt')
report.ok(engine.starts[runIndex].request.signal instanceof AbortSignal, 'the run received an AbortSignal')
report.ok(
  Array.isArray(engine.starts[runIndex].request.toolFilter?.allow),
  'read-only mode passes an allow-list tool filter',
)
report.equal(
  engine.starts[runIndex].request.toolFilter.allow.includes('write'),
  false,
  'the allow-list never names a mutating tool',
)

// Replay the host's exact SSE text through the client's own parser: this is
// the check that catches framing drift (a stray `\r\n`, a missing blank line,
// a renamed event) which would otherwise leave the card on "作答中…" forever.
const parsedByClient = askRes.text()
  .split('\n\n')
  .map(block => pure.parseSseBlock(block))
  .filter(Boolean)
report.equal(parsedByClient.length, events.length, 'the client parser reads every host frame')
report.equal(parsedByClient[0].event, 'start', 'client parser resolves the start frame')
report.equal(
  parsedByClient.filter(frame => frame.event === 'delta').map(frame => frame.data.text).join(''),
  '**Pro** contract answer',
  'client parser reassembles the streamed answer',
)

// ────────────────────────────────────────────────────────────────────────────
// 4. pure helpers agree across the two halves
// ────────────────────────────────────────────────────────────────────────────

console.log('\npure helper parity')
for (const sample of ['short', 'x'.repeat(500), 'a\nb\nc'.repeat(400), '😀猫𠀀'.repeat(300)]) {
  report.equal(
    pure.truncateSelection(sample, 200),
    host.truncateSelection(sample, 200),
    `truncateSelection agrees for length ${sample.length}`,
  )
}

// B8: caps and badges count Unicode code points, not UTF-16 units, so an
// emoji-heavy or Plane-2 selection is neither miscounted nor cut in half.
const emojiSample = '😀猫𠀀'.repeat(300) // 900 code points, 1500 UTF-16 units
const emojiCut = pure.truncateSelection(emojiSample, 200)
report.ok(emojiCut.truncated === true, 'a surrogate-heavy selection still truncates')
report.equal(emojiCut.droppedChars, 900 - 200, 'dropped counts code points, not code units')
const pairCut = pure.truncateSelection('👨👩', 1)
report.equal(pairCut.text.split('\n')[0], '👨', 'a cut never keeps half a surrogate pair')
report.equal(
  JSON.stringify(pure.truncateSelection('😀'.repeat(10), 200)),
  JSON.stringify({ text: '😀'.repeat(10), truncated: false, droppedChars: 0 }),
  'an emoji-only selection within the cap passes through untouched',
)
report.equal(
  pure.shouldOffer(
    { text: '😀'.repeat(3), zone: 'chat' },
    { trigger: 'selection', minChars: 4, captureZones: 'chat', showInUnclassified: true },
    { anchors: true },
  ).ok,
  false,
  'minChars compares code points (3 emoji < 4, not 6 UTF-16 units)',
)
const prompt = host.buildSidePrompt({
  selection: 'SELECTED-TEXT',
  question: 'WHY?',
  zone: 'task',
  truncated: false,
  history: [],
  historyTurns: 6,
})
report.ok(prompt.includes('SELECTED-TEXT') && prompt.includes('WHY?'), 'host prompt carries selection and question')
report.ok(prompt.includes('task area'), 'host prompt labels the source zone')
report.ok(prompt.includes('Question:'), 'host prompt scaffolding is English (C11), matching the English persona')
report.equal(prompt.includes('【'), false, 'host prompt carries no Chinese scaffolding markers')
const historyPrompt = host.buildSidePrompt({
  selection: 'S', question: 'Q', zone: 'chat', truncated: false,
  history: [{ question: '问过', answer: '答过' }], historyTurns: 6,
})
report.ok(historyPrompt.includes('Question: 问过') && historyPrompt.includes('Answer: 答过'), 'history turns keep their own language inside English scaffolding')

console.log('\nmarkdown-lite rendering')
// A6: answers routinely contain links, italics, blockquotes and tables;
// all four used to degrade to raw text. Everything renders as React nodes —
// no HTML injection — and the link parser only accepts http/https.
const asTree = nodes => expandTree({ __element: true, type: 'div', props: {}, children: nodes })
const mdTree = asTree(pure.renderRichText([
  '参考 [官方文档](https://example.com/docs) 与 *备注* 以及 `code`。',
  '',
  '> 引用第一行',
  '> 引用第二行',
  '',
  '| 字段 | 说明 |',
  '| --- | :-: |',
  '| id | 标识 |',
  '',
  '- 列表 **加粗** 项',
].join('\n')))
const mdLinks = byTag(mdTree, 'a')
report.equal(mdLinks.length, 1, 'one inline link renders')
report.equal(mdLinks[0]?.props?.href, 'https://example.com/docs', 'the link href survives')
report.equal(mdLinks[0]?.props?.target, '_blank', 'the link opens in a new tab')
report.ok(String(mdLinks[0]?.props?.rel ?? '').includes('noopener'), 'the link is hardened with rel=noopener')
report.ok(textOf(mdLinks[0]) === '官方文档', 'the link label renders as its own text')
const mdEm = byTag(mdTree, 'em')
report.equal(mdEm.length, 1, 'italic syntax renders an em element')
report.ok(textOf(mdEm[0]).includes('备注'), 'the italic text survives')
const mdQuote = byTag(mdTree, 'blockquote')
report.equal(mdQuote.length, 1, 'quote lines render one blockquote')
report.ok(textOf(mdQuote[0]).includes('引用第一行') && textOf(mdQuote[0]).includes('引用第二行'), 'both quote lines are kept')
const mdTable = byTag(mdTree, 'table')
report.equal(mdTable.length, 1, 'a table renders when a separator row follows the header')
report.equal(byTag(mdTable[0], 'th').length, 2, 'the table has a two-column header')
report.equal(byTag(mdTable[0], 'td').length, 2, 'the table has one data row')
report.ok(textOf(mdTable[0]).includes('字段') && textOf(mdTable[0]).includes('标识'), 'table cells keep their text')
report.ok(byTag(mdTree, 'ul').length === 1 && textOf(mdTree).includes('加粗'), 'the pre-existing list and bold syntax keep working')
const badTree = asTree(pure.renderRichText('看 [点我](javascript:alert(1)) 与 [x](data:text/html,hi)'))
report.equal(byTag(badTree, 'a').length, 0, 'a javascript:/data: URL never becomes a link')
report.ok(textOf(badTree).includes('javascript:alert(1)'), 'the unsafe link stays as visible text')
report.equal(byTag(badTree, 'code').length + byTag(mdTree, 'code').length >= 1, true, 'inline code still renders')

report.ok(prompt.includes('```text'), 'host fences the selection as data')

const mainPrompt = pure.composeMainPrompt('line1\nline2', '为什么？', 'chat', 1000)
report.ok(mainPrompt.startsWith('> line1\n> line2'), 'main-carrier prompt quotes the selection')
report.ok(mainPrompt.includes('为什么？'), 'main-carrier prompt carries the question')

report.equal(pure.classifyZone(['conversation.chat.node', 'main']), 'chat', 'conversation slots classify as chat')
report.equal(pure.classifyZone(['sidebar.right.pane.tab']), 'task', 'right-rail slots classify as task')
report.equal(pure.classifyZone(['root', 'shell.overlay']), 'other', 'unknown slots classify as other')

const shortcut = pure.parseShortcut('Alt+Q')
report.ok(shortcut !== null, 'Alt+Q parses')
report.equal(pure.parseShortcut('Alt+'), null, 'a trailing plus is rejected')
report.equal(pure.parseShortcut('Bogus+Q'), null, 'an unknown modifier is rejected')
report.ok(
  pure.matchesShortcut({ key: 'q', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }, shortcut),
  'Alt+Q matches',
)
report.ok(
  !pure.matchesShortcut({ key: 'q', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }, shortcut),
  'a bare Q does not match',
)

// ────────────────────────────────────────────────────────────────────────────
// 5. client registrations and rendering
// ────────────────────────────────────────────────────────────────────────────

console.log('\nclient registrations')
const betterTabs = []
const clientCtx = makeClientCtx({
  services: {
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {}, mounted: { getSnapshot: () => 'session-alpha', subscribe: () => () => {} } },
    betterSidebar: {
      features: ['tabMeta', 'tabLifecycle'],
      registerTab: descriptor => { betterTabs.push(descriptor); return () => {} },
      openTab: () => {},
      closeTab: () => {},
      getSnapshot: () => ({ sessionId: 'session-alpha' }),
    },
  },
})
client.apply(clientCtx.ctx)

const overlay = clientCtx.find('shell.overlay', pure.IDS.overlay)
const settings = clientCtx.find('settings.section', pure.IDS.settings)
const probe = clientCtx.find('conversation.input.right', pure.IDS.sessionProbe)
report.ok(overlay !== undefined, 'overlay entry registers into shell.overlay')
report.ok(settings !== undefined, 'settings page registers into settings.section')
report.ok(probe !== undefined, 'session probe registers into conversation.input.right')
report.equal(settings?.options.label(), '划词追问', 'settings label follows the active language')
report.ok(clientCtx.injections.includes('sidebar.right.pane.tab'), 'native right-rail body slot is wired')
const injectedNames = clientCtx.injections.flatMap(entry => (Array.isArray(entry) ? entry : [entry]))
report.ok(injectedNames.includes('betterSidebar'), 'better-sidebar adapter is probed')
report.equal(betterTabs.length, 1, 'better-sidebar received one tab descriptor')
report.equal(betterTabs[0]?.id, pure.CARD_KIND_BETTER, 'the registered tab type is the better-sidebar kind')
report.ok(typeof betterTabs[0]?.component === 'function', 'the tab descriptor carries a renderable component')

console.log('\nclient rendering')
// apply() fires refreshState() asynchronously; give it a tick so the rendered
// settings page reflects the capabilities /state actually reported.
await new Promise(resolve => setTimeout(resolve, 20))
const overlayTree = expandTree(loadedClient.shim.React.createElement(overlay.component, {}))
report.ok(byClass(overlayTree, 'dsa-layer').length === 1, 'overlay renders its root layer')
report.ok(byTag(overlayTree, 'style').length >= 1, 'overlay renders its stylesheet with the component')
report.equal(byClass(overlayTree, 'dsa-trigger').length, 0, 'no trigger button before a selection exists')
report.equal(byClass(overlayTree, 'dsa-card').length, 0, 'no answer card before a question is asked')
report.equal(textOf(overlayTree).trim(), '', 'the idle overlay renders no visible text')

// Desktop (Electron) window-drag guard. The desktop shell marks top-level
// elements as window-drag regions, so a floating plugin surface that does not
// opt out turns a click into a window drag; every root we draw must declare it.
const styleNode = byTag(overlayTree, 'style')[0]
const styleText = styleNode?.children?.join('') ?? ''
report.ok(styleText.includes('-webkit-app-region:no-drag'), 'the stylesheet declares the window-drag guard')
const guardRule = styleText.split('\n').find(line => line.includes('-webkit-app-region:no-drag') && line.includes('.dsa-')) ?? ''
report.ok(guardRule !== '', 'the guard exists as a real rule, not only inside the comment')
for (const root of ['dsa-layer', 'dsa-trigger', 'dsa-pop', 'dsa-card', 'dsa-toast', 'dsa-settings']) {
  report.ok(guardRule.includes(`.${root}`), `the drag guard covers .${root}`)
}
report.ok(styleText.includes('pointer-events:none'), 'the overlay layer itself stays click-through')

// D18: the trigger's viewport clamp used a hard-coded 132px tuned for the zh
// label; the en label ("Ask about selection") is ~50px wider, so a selection
// near the right edge spilled the button out of the viewport, and without
// nowrap the label could wrap to two lines in the squeezed space.
report.ok(
  Math.ceil(pure.estimateLabelWidth('追问选中内容') + 62) >= 132,
  'the zh trigger clamp stays at least as wide as the old hard-coded 132px',
)
const enTriggerWidth = Math.ceil(pure.estimateLabelWidth('Ask about selection') + 62)
report.ok(enTriggerWidth > 150, `the en trigger clamp widens for the longer English label (${enTriggerWidth}px)`)
report.ok(
  pure.estimateLabelWidth('划词追问') > pure.estimateLabelWidth('ask'),
  'label estimation scales with the text it is given',
)
report.ok(styleText.includes('white-space:nowrap'), 'the trigger label never wraps to a second line')
report.ok(
  !readFileSync(CLIENT_ENTRY, 'utf8').includes('clampBox(candidate.rect, 132'),
  'the trigger clamp no longer carries the zh-tuned hard-coded width',
)

const settingsTree = expandTree(loadedClient.shim.React.createElement(settings.component, {}))
const settingsText = textOf(settingsTree)
for (const label of ['触发方式', '默认作答位置', '最大字符数', '快捷键', '捕获区域']) {
  report.ok(settingsText.includes(label), `settings page renders the "${label}" row`)
}
report.ok(byTag(settingsTree, 'select').length >= 4, 'settings page renders its dropdowns')
report.ok(byTag(settingsTree, 'input').length >= 4, 'settings page renders its numeric fields')
report.ok(settingsText.includes('划词追问'), 'settings page renders its title')

// A1: the two config keys the host accepts but the page had no control for.
report.ok(settingsText.includes('侧边作答超时（毫秒）'), 'settings page renders the side timeout field')
report.ok(settingsText.includes('子代理 provider'), 'settings page renders the provider picker')
const settingsInputs = byTag(settingsTree, 'input')
report.ok(
  settingsInputs.some(node => node.props.type === 'number' && Number(node.props.min) === 5000 && Number(node.props.max) === 3600000),
  'the side timeout control uses the host-side accepted range',
)
const settingsSelects = byTag(settingsTree, 'select')
const providerSelectNode = settingsSelects.find(node => (node.children ?? []).some(
  option => option?.props?.value === 'spawn'))
report.ok(providerSelectNode !== undefined, 'the provider picker offers the providers /state reported (spawn)')
report.equal(providerSelectNode?.props?.value, 'auto', 'the provider picker defaults to auto')

const probeTree = expandTree(loadedClient.shim.React.createElement(probe.component, { sessionId: 'session-beta' }))
report.equal(probeTree, null, 'session probe renders nothing (no layout impact)')
loadedClient.shim.flushEffects()
report.equal(client.api.snapshot().sessionId, 'session-beta', 'the probe taught the store the active session id')
report.equal(client.api.snapshot().cards.length, 0, 'no card is created before a question is asked')
report.equal(
  (await callRoute(harness, '/state', { method: 'GET' })).json().value.plugin,
  'dsh-sidecard-ask',
  'host still healthy after the client render pass',
)

console.log('\nreasoning reach')
// A2: reasoning used to stream over the wire and land in the store but had
// NO rendered surface — a dead feature. This drives a composition whose
// provider really emits reasoning-delta frames, submits one real question,
// and asserts the collapsible block exists in the rendered card.
const reasoningHost = makeHostCtx({})
const reasoningEngine = makeSubagentEngine({
  emit: (event, ...args) => reasoningHost.emit(event, ...args),
  frames: ['答案', '文本'],
  reasoningPrefix: '思考',
})
reasoningHost.services.subagents = reasoningEngine.service
reasoningHost.services.agents = {
  get: id => (id === 'session-alpha' ? { id: 'session-alpha' } : undefined),
  roots: () => [{ id: 'session-alpha' }],
  list: () => [{ id: 'session-alpha' }],
}
host.apply(reasoningHost.ctx, {})
const reasoningFetch = (url, init = {}) => {
  const path = String(url).replace('/sidecard-ask/api/', '')
  const body = init.body === undefined ? null : JSON.parse(init.body)
  const method = init.method ?? 'POST'
  return (async () => {
    const res = await callRoute(reasoningHost, `/${path}`, { method, body })
    if (path.startsWith('ask')) {
      const text = res.text()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        },
      })
      return { ok: true, status: 200, body: stream, json: async () => JSON.parse(text) }
    }
    return { ok: res.status < 400, status: res.status, json: async () => res.json() }
  })()
}
const reasoningCtx = makeClientCtx({})
const reasoningClient = loadClientModule({ fetchImpl: reasoningFetch, language: 'zh-CN' })
reasoningClient.module.apply(reasoningCtx.ctx)
await new Promise(resolve => setTimeout(resolve, 20))
const reasoningOverlay = reasoningCtx.find('shell.overlay', pure.IDS.overlay)
const reasoningActions = reasoningOverlay.component().props.actions
reasoningActions.submit(
  {
    text: '一段值得追问的选中文本',
    rect: { left: 10, top: 10, right: 300, bottom: 32, width: 290, height: 22 },
    zone: 'chat',
    cross: false,
    slotPath: ['conversation.chat.node'],
    kind: 'text',
  },
  { question: '这段讲什么？', carrier: 'side' },
)
await new Promise(resolve => setTimeout(resolve, 150))
const reasoningCards = reasoningClient.module.api.snapshot().cards
report.equal(reasoningCards.length, 1, 'the submitted question created exactly one card')
report.equal(reasoningCards[0]?.status, 'done', 'the side answer completed')
report.ok(
  typeof reasoningCards[0]?.reasoning === 'string' && reasoningCards[0].reasoning.includes('思考'),
  'reasoning deltas reached the card store',
)
const reasoningTree = expandTree(reasoningOverlay.component())
report.ok(
  byTag(reasoningTree, 'details').some(node => String(node.props.className ?? '').split(/\s+/).includes('dsa-details')),
  'the card renders a collapsible reasoning block',
)
report.ok(
  byTag(reasoningTree, 'summary').some(node => textOf(node) === '思考过程'),
  'the reasoning block carries its summary label',
)
report.ok(textOf(reasoningTree).includes('思考'), 'the reasoning text is rendered inside the block')
report.ok(byClass(reasoningTree, 'dsa-reasoning').length >= 1, 'the reasoning body has its own style class')
report.ok(
  byTag(reasoningTree, 'details').length === 1,
  'a card with no reasoning history still renders exactly one reasoning block',
)

console.log('\nstream coalescing')
// B9: every streamed delta used to commit the store on arrival, and every
// commit re-renders every card and re-parses the whole answer — quadratic
// work on a long answer. This drives the real client against a hand-built
// SSE stream that pauses between its delta frames and its done frame:
// nothing may reach the card before the flush tick, a whole window of
// deltas must land in one commit, and a done frame carrying no text must
// still surface every buffered character (the flush-before-done order).
{
  const coalesceHost = makeHostCtx({})
  host.apply(coalesceHost.ctx, {})
  const encoder = new TextEncoder()
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const coalesceFetch = (url, init = {}) => {
    const path = String(url).replace('/sidecard-ask/api/', '')
    const body = init.body === undefined ? null : JSON.parse(init.body)
    const method = init.method ?? 'POST'
    return (async () => {
      const res = await callRoute(coalesceHost, `/${path}`, { method, body })
      if (!path.startsWith('ask')) {
        return { ok: res.status < 400, status: res.status, json: async () => res.json() }
      }
      let release
      const gate = new Promise(resolve => { release = resolve })
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(
            frame('start', { id: 'coalesce-1' })
            + frame('reasoning', { id: 'coalesce-1', text: '想' })
            + ['一', '二', '三'].map(text => frame('delta', { id: 'coalesce-1', text })).join('')))
          await gate
          controller.enqueue(encoder.encode(
            ['四', '五', '六'].map(text => frame('delta', { id: 'coalesce-1', text })).join('')
            + frame('done', { id: 'coalesce-1', text: '', reasoning: '想', streaming: true, stopReason: 'completed', aborted: false })))
          controller.close()
        },
      })
      // The gate sits at 130ms: the mid-frame check lands at ~65ms (submit +15
      // +50) even after one Windows timer-quantum (~15.6ms) of drift on each
      // wait, which is exactly the slack that once let the done frame race the
      // check at 80ms.
      setTimeout(release, 130)
      return { ok: true, status: 200, body: stream, json: async () => JSON.parse(res.text()) }
    })()
  }
  const coalesceCtx = makeClientCtx({})
  const coalesceClient = loadClientModule({ fetchImpl: coalesceFetch, language: 'zh-CN' })
  coalesceClient.module.apply(coalesceCtx.ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  const coalesceOverlay = coalesceCtx.find('shell.overlay', pure.IDS.overlay)
  coalesceOverlay.component().props.actions.submit(
    {
      text: '合并提交节的选中文本',
      rect: { left: 10, top: 10, right: 300, bottom: 32, width: 290, height: 22 },
      zone: 'chat',
      cross: false,
      slotPath: ['conversation.chat.node'],
      kind: 'text',
    },
    { question: '合并成几次提交？', carrier: 'side' },
  )
  await new Promise(resolve => setTimeout(resolve, 15))
  const earlyCards = coalesceClient.module.api.snapshot().cards
  report.equal(earlyCards[0]?.status, 'streaming', 'the stream is open before the flush tick')
  report.equal(earlyCards[0]?.text, '', 'deltas stay in the buffer before the flush tick (no per-delta commit)')
  report.equal(earlyCards[0]?.reasoning, '', 'reasoning deltas stay in the buffer before the flush tick')
  await new Promise(resolve => setTimeout(resolve, 50))
  const midCards = coalesceClient.module.api.snapshot().cards
  report.equal(midCards[0]?.status, 'streaming', 'the card is still streaming before the done frame')
  report.equal(midCards[0]?.text, '一二三', 'a whole window of deltas lands in ONE commit')
  report.equal(midCards[0]?.reasoning, '想', 'buffered reasoning commits with the same tick')
  await new Promise(resolve => setTimeout(resolve, 100))
  const lateCards = coalesceClient.module.api.snapshot().cards
  report.equal(lateCards[0]?.status, 'done', 'the done frame closed the card')
  report.equal(lateCards[0]?.text, '一二三四五六', 'a textless done still surfaces every buffered character (flush before terminal patch)')
  report.ok(String(lateCards[0]?.reasoning ?? '').includes('想'), 'buffered reasoning survives the terminal flush')
}

console.log('\nstream buffer discard')
// B9's other half: close() must drop a card's buffered-but-unflushed deltas
// instead of letting the pending flush tick resurrect text into a card that
// no longer exists.
{
  const discardHost = makeHostCtx({})
  host.apply(discardHost.ctx, {})
  const encoder = new TextEncoder()
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const discardFetch = (url, init = {}) => {
    const path = String(url).replace('/sidecard-ask/api/', '')
    const body = init.body === undefined ? null : JSON.parse(init.body)
    const method = init.method ?? 'POST'
    return (async () => {
      const res = await callRoute(discardHost, `/${path}`, { method, body })
      if (!path.startsWith('ask')) {
        return { ok: res.status < 400, status: res.status, json: async () => res.json() }
      }
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(
            frame('start', { id: 'discard-1' })
            + ['甲', '乙', '丙'].map(text => frame('delta', { id: 'discard-1', text })).join('')))
        },
      })
      return { ok: true, status: 200, body: stream, json: async () => JSON.parse(res.text()) }
    })()
  }
  const discardCtx = makeClientCtx({})
  const discardClient = loadClientModule({ fetchImpl: discardFetch, language: 'zh-CN' })
  discardClient.module.apply(discardCtx.ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  const discardOverlay = discardCtx.find('shell.overlay', pure.IDS.overlay)
  discardOverlay.component().props.actions.submit(
    {
      text: '丢弃缓冲节的选中文本',
      rect: { left: 10, top: 10, right: 300, bottom: 32, width: 290, height: 22 },
      zone: 'chat',
      cross: false,
      slotPath: ['conversation.chat.node'],
      kind: 'text',
    },
    { question: '关掉后还剩什么？', carrier: 'side' },
  )
  await new Promise(resolve => setTimeout(resolve, 15))
  const beforeClose = discardClient.module.api.snapshot().cards
  report.equal(beforeClose[0]?.status, 'streaming', 'the card is streaming when it is closed')
  report.equal(beforeClose[0]?.text, '', 'its deltas are still buffered at close time')
  discardOverlay.component().props.actions.close(beforeClose[0])
  await new Promise(resolve => setTimeout(resolve, 100))
  report.equal(discardClient.module.api.snapshot().cards.length, 0, 'a card closed mid-stream stays closed (the pending flush cannot resurrect it)')
}

console.log('\nhost cancel routing')
// D13: Stop and Close used to abort only the browser's stream — the Host's
// child kept running to its timeout. Both paths now also POST /cancel, and
// the host-side run registry really drains.
{
  const cancelHost = makeHostCtx({})
  const cancelEngine = makeSubagentEngine({
    emit: (event, ...args) => cancelHost.emit(event, ...args),
    frames: ['慢', '速', '流', '式'],
    delayMs: 30,
  })
  cancelHost.services.subagents = cancelEngine.service
  cancelHost.services.agents = {
    get: id => (id === 'session-alpha' ? { id: 'session-alpha' } : undefined),
    roots: () => [{ id: 'session-alpha' }],
    list: () => [{ id: 'session-alpha' }],
  }
  host.apply(cancelHost.ctx, {})
  const calls = []
  const cancelFetch = (url, init = {}) => {
    const path = String(url).replace('/sidecard-ask/api/', '')
    const body = init.body === undefined ? null : JSON.parse(init.body)
    const method = init.method ?? 'POST'
    return (async () => {
      const res = await callRoute(cancelHost, `/${path}`, { method, body })
      calls.push({ path, body })
      if (path.startsWith('ask')) {
        const text = res.text()
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text))
            controller.close()
          },
        })
        return { ok: true, status: 200, body: stream, json: async () => JSON.parse(text) }
      }
      return { ok: res.status < 400, status: res.status, json: async () => res.json() }
    })()
  }
  const cancelCtx = makeClientCtx({})
  const cancelClient = loadClientModule({ fetchImpl: cancelFetch, language: 'zh-CN' })
  cancelClient.module.apply(cancelCtx.ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  const cancelOverlay = cancelCtx.find('shell.overlay', pure.IDS.overlay)
  cancelOverlay.component().props.actions.submit(
    {
      text: '取消路由节的选中文本',
      rect: { left: 10, top: 10, right: 300, bottom: 32, width: 290, height: 22 },
      zone: 'chat',
      cross: false,
      slotPath: ['conversation.chat.node'],
      kind: 'text',
    },
    { question: '停止后宿主还跑吗？', carrier: 'side' },
  )
  await new Promise(resolve => setTimeout(resolve, 25))
  const streamingCard = cancelClient.module.api.snapshot().cards[0]
  report.equal(streamingCard?.status, 'streaming', 'the card is streaming when it is stopped')
  cancelOverlay.component().props.actions.cancel(streamingCard)
  const stoppedCard = cancelClient.module.api.snapshot().cards[0]
  report.equal(stoppedCard?.status, 'stopped', 'the card stops locally at once')
  await new Promise(resolve => setTimeout(resolve, 20))
  const cancelCall = calls.find(call => call.path === 'cancel')
  report.ok(cancelCall !== undefined, 'stopping a streaming card POSTs /cancel')
  report.equal(cancelCall?.body?.id, streamingCard?.id, 'the cancel POST names the card id')
  await new Promise(resolve => setTimeout(resolve, 150))
  const stateAfter = (await callRoute(cancelHost, '/state', { method: 'GET' })).json()
  report.equal(stateAfter.value.capabilities.activeRuns, 0, 'the host-side run registry drains after the cancel')
  const cardsAfter = cancelClient.module.api.snapshot().cards
  report.equal(cardsAfter[0]?.status, 'stopped', 'the card stays stopped (no late host event flips it)')
  // D14: `cross` used to ride the ask payload although the Host never read
  // it — pure dead weight on every request.
  const askCall = calls.find(call => call.path === 'ask')
  report.equal(askCall !== undefined && 'cross' in askCall.body, false, 'the ask payload carries no dead cross field')
}

console.log('\ncard persistence')
// A4: a page reload used to lose every finished answer. Finished cards are
// now mirrored into localStorage and replayed on boot — deterministically,
// bounded, and degrading to "no history" on quota/corruption instead of
// breaking startup.
const PERSIST_KEY = 'dsh-sidecard-ask:cards:v1'
const sharedStorage = createLocalStorageStub()
const persistCtx = makeClientCtx({})
const persistClient = loadClientModule({ fetchImpl: hostFetch, storage: sharedStorage, language: 'zh-CN' })
persistClient.module.apply(persistCtx.ctx)
await new Promise(resolve => setTimeout(resolve, 20))
const persistOverlay = persistCtx.find('shell.overlay', pure.IDS.overlay)
const persistActions = persistOverlay.component().props.actions
persistActions.submit(
  {
    text: '持久化节的选中文本',
    rect: { left: 8, top: 8, right: 260, bottom: 28, width: 252, height: 20 },
    zone: 'chat',
    cross: false,
    slotPath: ['conversation.chat.node'],
    kind: 'text',
  },
  { question: '会留下来吗？', carrier: 'side' },
)
await new Promise(resolve => setTimeout(resolve, 150))
let stored = JSON.parse(sharedStorage.getItem(PERSIST_KEY))
report.equal(stored.cards.length, 1, 'a finished card is mirrored into localStorage')
report.equal(stored.cards[0]?.question, '会留下来吗？', 'the persisted card keeps its question')
report.equal(stored.cards[0]?.text, '**Pro** contract answer', 'the persisted card keeps the full answer')
report.equal(stored.cards[0]?.status, 'done', 'only terminal cards are persisted')
persistActions.close(persistClient.module.api.snapshot().cards[0])
stored = JSON.parse(sharedStorage.getItem(PERSIST_KEY))
report.equal(stored.cards.length, 0, 'closing a card removes it from the durable set too')

// Simulate a reload: a fresh client module over the SAME storage replays the
// history into the flow stack (a right-rail tab cannot survive a reload).
persistActions.submit(
  {
    text: '恢复节的选中文本',
    rect: { left: 8, top: 40, right: 260, bottom: 60, width: 252, height: 20 },
    zone: 'chat',
    cross: false,
    slotPath: ['conversation.chat.node'],
    kind: 'text',
  },
  { question: '刷新后还在吗？', carrier: 'side' },
)
await new Promise(resolve => setTimeout(resolve, 150))
const reloadClient = loadClientModule({ fetchImpl: hostFetch, storage: sharedStorage, language: 'zh-CN' })
const reloadCtx = makeClientCtx({})
reloadClient.module.apply(reloadCtx.ctx)
await new Promise(resolve => setTimeout(resolve, 20))
const reloaded = reloadClient.module.api.snapshot().cards
report.equal(reloaded.length, 1, 'a fresh page replays the persisted card once')
report.equal(reloaded[0]?.question, '刷新后还在吗？', 'the replayed card keeps its question')
report.equal(reloaded[0]?.text, '**Pro** contract answer', 'the replayed card keeps its answer')
report.equal(reloaded[0]?.surface, 'flow', 'replayed cards come back on the flow stack')
report.equal(reloaded[0]?.status, 'done', 'replayed cards are terminal, not "streaming"')
const reloadOverlay = reloadCtx.find('shell.overlay', pure.IDS.overlay)
const reloadTree = expandTree(reloadOverlay.component())
report.equal(byClass(reloadTree, 'dsa-card').length, 1, 'the replayed card is visible on the flow stack')
report.ok(textOf(reloadTree).includes('刷新后还在吗？'), 'the replayed card shows its question')

// Bounded replay: a tampered/oversized payload must never flood the store.
sharedStorage.setItem(PERSIST_KEY, JSON.stringify({
  version: 1,
  cards: Array.from({ length: 12 }, (_, index) => ({
    id: `fake-${index}`,
    question: `问题 ${index}`,
    text: '答案',
    status: 'done',
  })),
}))
const floodCtx = makeClientCtx({})
const floodClient = loadClientModule({ fetchImpl: hostFetch, storage: sharedStorage, language: 'zh-CN' })
floodClient.module.apply(floodCtx.ctx)
await new Promise(resolve => setTimeout(resolve, 20))
report.equal(
  floodClient.module.api.snapshot().cards.length,
  10,
  'replay is capped at the persistence limit even for a hand-written payload',
)
sharedStorage.setItem(PERSIST_KEY, 'not-json-at-all')
const corruptCtx = makeClientCtx({})
const corruptClient = loadClientModule({ fetchImpl: hostFetch, storage: sharedStorage, language: 'zh-CN' })
corruptClient.module.apply(corruptCtx.ctx)
await new Promise(resolve => setTimeout(resolve, 20))
report.equal(corruptClient.module.api.snapshot().cards.length, 0, 'corrupt history degrades to no history')

console.log('\nsurface fallback chain')
// The same client module, applied to a composition with NO side-card plugin:
// every adapter must report itself unavailable, and `auto` must land on the
// built-in flow card instead of failing.
const bareClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
const bareCtx = makeClientCtx()
bareClient.module.apply(bareCtx.ctx)
report.equal(bareClient.module.api.pure.pickSurface('auto').adapter.kind, 'flow', 'auto falls back to the flow card')
report.equal(bareClient.module.api.pure.pickSurface('better-sidebar').fellBack, true, 'a missing plugin is reported as a fallback')
report.equal(bareClient.module.api.pure.pickSurface('native-rightbar').adapter.kind, 'flow', 'a missing right rail falls back to flow')
// With both services present, `auto` prefers the shipped right rail.
report.equal(pure.pickSurface('auto').adapter.kind, 'native-rightbar', 'auto prefers the native right rail when present')
report.equal(pure.pickSurface('better-sidebar').adapter.kind, 'better-sidebar', 'an explicit surface is honoured when available')

console.log('\nzone anchors and slot ladders')
// Without the harness's `data-slot` anchors a region filter can never match;
// the decision must relax instead of silently swallowing every selection.
const chatOnly = { trigger: 'selection', minChars: 1, captureZones: 'chat', showInUnclassified: false }
const sample = { text: 'some selected text', zone: 'other' }
report.equal(pure.shouldOffer(sample, chatOnly, { anchors: true }).ok, false, 'a region filter still applies when anchors exist')
report.equal(pure.shouldOffer(sample, chatOnly, { anchors: false }).ok, true, 'the region filter is dropped when anchors are missing')
report.equal(pure.shouldOffer(sample, chatOnly, { anchors: false }).zoneFiltering, 'unavailable', 'the relaxed decision says why')
report.equal(pure.shouldOffer({ text: '  ', zone: 'chat' }, chatOnly, { anchors: false }).ok, false, 'an empty selection is still refused')

// A shell that never declares `shell.overlay` must fall through the ladder to
// the next declared rung instead of losing the whole UI.
const ladder = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
const ladderCtx = makeClientCtx({ absentSlots: ['shell.overlay', 'settings.section', 'conversation.input.right'] })
ladder.module.apply(ladderCtx.ctx)
report.ok(ladderCtx.find('shell.overlay', pure.IDS.overlay) === undefined, 'no registration lands in an undeclared slot')
report.ok(ladderCtx.find('settings.section', pure.IDS.settings) === undefined, 'the settings ladder skips the undeclared rung')
await new Promise(resolve => setTimeout(resolve, 1800))
const landedOverlay = ladderCtx.find('conversation.input.dock', pure.IDS.overlay)
const landedSettings = ladderCtx.find('settings.plugins.tab', pure.IDS.settings)
const landedProbe = ladderCtx.find('conversation.input.left', pure.IDS.sessionProbe)
report.ok(landedOverlay !== undefined, 'the overlay ladder falls through to the next declared rung')
report.ok(landedSettings !== undefined, 'the settings ladder falls through as well')
report.ok(landedProbe !== undefined, 'the session probe ladder falls through as well')
report.equal(ladder.module.api.snapshot().slots.overlay, 'conversation.input.dock', 'the diagnostics record where the overlay landed')
report.equal(ladder.module.api.snapshot().slots.settings, 'settings.plugins.tab', 'the diagnostics record the settings landing')

console.log('\nmain-conversation submit ladder')
// The submit API moved inside the supported range (`retain` before
// 0.1.6-alpha.2, `using` from then on), so every rung is probed at call time
// and each one must report which API actually carried the message.
const ask = (ctx, extra = {}) => pure.askInMainConversation({
  ctx,
  sessionId: 'session-alpha',
  selection: '选中的原文',
  question: '为什么？',
  zone: 'chat',
  maxChars: 4000,
  ...extra,
})

const usingCalls = []
const usingCtx = {
  get: name => (name === 'sessions' ? {
    using: async (id, options, operation) => {
      usingCalls.push({ id, source: options.source })
      return operation({
        binding: {
          session: {
            prompt: async (parts, mode) => {
              usingCalls.push({ parts, mode })
              return { ok: true }
            },
          },
        },
      })
    },
  } : undefined),
}
report.equal((await ask(usingCtx)).via, 'sessions.using', 'rung 1 uses the documented using() helper')
report.equal(usingCalls[1].mode, 'queue', 'the message is queued like a user submission')

const retainCalls = []
const retainCtx = {
  get: name => (name === 'sessions' ? {
    retain: (id, options) => {
      retainCalls.push({ id, source: options.source })
      return {
        ready: Promise.resolve(),
        binding: {
          session: {
            prompt: async (parts) => {
              retainCalls.push({ text: parts[0].text })
              return { ok: true }
            },
          },
        },
        release: () => { retainCalls.push({ released: true }) },
      }
    },
  } : undefined),
}
const retainResult = await ask(retainCtx)
report.equal(retainResult.via, 'sessions.retain', 'rung 2 falls back to retain() when using() is absent')
report.ok(retainCalls.some(call => call.released === true), 'the retained reference is always released')
report.ok(retainCalls.find(call => call.text)?.text.includes('为什么？'), 'the composed prompt carries the question')

const draftCalls = []
const draftCtx = {
  get: (name) => {
    if (name === 'sessions') return { scope: () => ({ sessionId: 'session-alpha' }) }
    if (name === 'conversation') {
      return {
        input: {
          for: () => ({
            state: { getSnapshot: () => ({ draft: '' }) },
            setDraft: (text) => { draftCalls.push(text) },
          }),
        },
      }
    }
    return undefined
  },
}
const draftResult = await ask(draftCtx)
report.equal(draftResult.via, 'composer.draft', 'the last rung writes the composer draft')
report.ok(draftCalls[0].includes('> 选中的原文'), 'the draft carries the quoted selection')

// Rung 3 uses the composer action face the harness hands to a session-scoped
// slot entry as a standard prop.
const actionCalls = []
const actionProbe = clientCtx.find('conversation.input.right', pure.IDS.sessionProbe)
expandTree(loadedClient.shim.React.createElement(actionProbe.component, {
  sessionId: 'session-alpha',
  inputActions: {
    setDraft: text => { actionCalls.push({ setDraft: text }) },
    submit: () => { actionCalls.push({ submit: true }) },
  },
}))
loadedClient.shim.flushEffects()
const actionResult = await ask({ get: () => undefined })
report.equal(actionResult.via, 'inputActions.submit', 'rung 3 submits through the composer action face')
report.ok(actionCalls.some(call => call.setDraft !== undefined), 'the draft is written before submitting')
report.ok(actionCalls.some(call => call.submit === true), 'the composer submit action is invoked')

// A module instance that has never captured a composer face is the real
// "nothing can carry it" case; the one above legitimately keeps using the
// action face it holds.
let carrierError
try {
  await ladder.module.api.pure.askInMainConversation({
    ctx: { get: () => undefined },
    sessionId: 'session-alpha',
    selection: 'x',
    question: 'y',
    zone: 'chat',
    maxChars: 1000,
  })
} catch (error) {
  carrierError = error
}
report.equal(carrierError?.code, 'no-main-carrier', 'with no carrier at all the failure is explicit, not silent')

console.log('\ndsh-better-sidebar contract')
// Verified against the published packages: 0.22.0 → 0.22.1 changes only the
// version constant in `lib/types/client/service.d.ts` (byte-identical
// otherwise) and robustness in ITS own native glue, so this adapter keys on the
// capability list — which the contract promises never shrinks — instead of on a
// version number.
const fullFeatures = ['badge', 'tabLifecycle', 'updateTab', 'openFile', 'targetedOpen', 'stateSubscription', 'tabMeta', 'pluginSettings', 'urlTarget', 'settingSelect', 'fileIcons']
const openCalls = []
const betterCtx = makeClientCtx({
  services: {
    betterSidebar: {
      version: '0.22.1',
      features: fullFeatures,
      registerTab: () => () => {},
      openTab: (seed, scope) => { openCalls.push({ seed, scope }) },
      closeTab: () => {},
      getSnapshot: () => ({ sessionId: 'session-zeta' }),
    },
  },
})
const betterClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
betterClient.module.apply(betterCtx.ctx)
const betterSurface = betterClient.module.api.pure.pickSurface('better-sidebar')
report.equal(betterSurface.fellBack, false, 'a 0.22.1-shaped service is accepted')
report.equal(betterSurface.adapter.kind, 'better-sidebar', 'the adapter is selectable')
// The session scope comes from the composer slot's `sessionId` prop, so the
// probe must have rendered before an open can be scoped.
const betterProbe = betterCtx.find('conversation.input.right', pure.IDS.sessionProbe)
expandTree(betterClient.shim.React.createElement(betterProbe.component, { sessionId: 'session-zeta' }))
betterClient.shim.flushEffects()
report.equal(betterClient.module.api.snapshot().sessionId, 'session-zeta', 'the probe captured the session id')
betterSurface.adapter.open({ id: 'card-7', question: '这是什么？' })
report.equal(openCalls.length, 1, 'open() drives the documented openTab(seed, scope)')
report.equal(openCalls[0].seed.type, pure.CARD_KIND_BETTER, 'the seed carries the better-sidebar kind')
report.equal(openCalls[0].seed.meta.cardId, 'card-7', 'the card id travels in seed.meta (feature tabMeta)')
report.equal(openCalls[0].scope.sessionId, 'session-zeta', 'the open is scoped to the asking session')

// A pre-0.12 service (no tabMeta) must be SKIPPED, not used with an empty card.
const oldCtx = makeClientCtx({
  services: {
    betterSidebar: {
      version: '0.11.0',
      features: ['badge', 'updateTab'],
      registerTab: () => () => {},
      openTab: () => { throw new Error('must not be called') },
      closeTab: () => {},
      getSnapshot: () => ({ sessionId: 'session-zeta' }),
    },
  },
})
const oldClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
oldClient.module.apply(oldCtx.ctx)
report.equal(oldClient.module.api.pure.pickSurface('better-sidebar').fellBack, true, 'a service without tabMeta is refused')
report.equal(oldClient.module.api.pure.pickSurface('auto').adapter.kind, 'flow', 'auto then falls through to the flow card')

// A service that cannot register a tab type at all is refused the same way.
const noRegister = makeClientCtx({
  services: { betterSidebar: { version: '0.22.1', features: fullFeatures, openTab: () => {}, closeTab: () => {} } },
})
const noRegisterClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
noRegisterClient.module.apply(noRegister.ctx)
report.equal(noRegisterClient.module.api.pure.pickSurface('better-sidebar').fellBack, true, 'a service without registerTab is refused')

console.log('\nnative right-rail rollback')
// A slot registration can throw after the tab TYPE was taken; the type must be
// released again or that id stays unusable for the rest of the page's life —
// the same class of failure dsh-better-sidebar 0.22.1 hardened in its own
// native glue (`disposeSafely` + partial-set release).
const typeReleases = []
const rollbackCtx = makeClientCtx({
  throwOnSlots: ['sidebar.right.pane.tab'],
  services: {
    sidebarRightTabs: {
      register: () => () => { typeReleases.push('released') },
    },
    sidebarRight: { openTab: () => {}, mounted: { getSnapshot: () => 'session-alpha', subscribe: () => () => {} } },
  },
})
const rollbackClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
rollbackClient.module.apply(rollbackCtx.ctx)
report.equal(typeReleases.length, 1, 'the tab type is released when a slot registration fails')
report.equal(
  rollbackClient.module.api.pure.pickSurface('native-rightbar').fellBack,
  true,
  'the failed native adapter reports itself unavailable',
)
report.equal(
  rollbackClient.module.api.pure.pickSurface('auto').adapter.kind,
  'flow',
  'auto then falls through to the flow card',
)

console.log('\nsurface kinds must not collide')
// Live evidence from DSH 0.2.0-rc.1: `sidebar.right.pane.tab` listed
// `dsh-better-sidebar:sidecard-ask:card` but no native `sidecard-ask:card`,
// because both adapters registered a type for the SAME kind — and
// `sidebarRightTabs` throws on a same-band duplicate kind ("Everything else
// colliding on a kind throws"). better-sidebar mirrors every tab descriptor it
// receives into that same registry, so the two adapters must use different ids.
const nativeIds = new Set()
const nativeKinds = new Map()
const nativeDefs = []
const nativeRegistry = {
  register(definition) {
    if (nativeIds.has(definition.id)) {
      throw new Error(`sidebarRight: duplicate registration of id "${definition.id}"`)
    }
    const band = definition.priority ?? 'extension'
    const slot = `${definition.kind}|${band}`
    const taken = nativeKinds.get(slot)
    if (taken !== undefined && taken !== definition.id) {
      throw new Error(`sidebarRight: kind "${definition.kind}" already has a ${band} registration`)
    }
    nativeIds.add(definition.id)
    nativeKinds.set(slot, definition.id)
    nativeDefs.push(definition)
    return () => {
      nativeIds.delete(definition.id)
      nativeKinds.delete(slot)
    }
  },
}
const mirroredDescriptors = []
const kindTabsOpened = []
const kindTabsClosed = []
const kindCtx = makeClientCtx({
  services: {
    sidebarRightTabs: nativeRegistry,
    sidebarRight: {
      openTab: (kind, request) => { kindTabsOpened.push({ kind, request }) },
      closeTab: (kind, request) => { kindTabsClosed.push({ kind, request }) },
      mounted: { getSnapshot: () => 'session-alpha', subscribe: () => () => {} },
    },
    betterSidebar: {
      version: '0.22.1',
      features: fullFeatures,
      // better-sidebar's real behavior: each descriptor becomes an
      // `extension`-band type in the native registry under its own prefix.
      registerTab: (descriptor) => {
        mirroredDescriptors.push(descriptor)
        return nativeRegistry.register({
          id: `dsh-better-sidebar:${descriptor.id}`,
          kind: descriptor.id,
          priority: 'extension',
        })
      },
      openTab: () => {},
      closeTab: () => {},
      getSnapshot: () => ({ sessionId: 'session-alpha' }),
    },
  },
})
const kindClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
kindClient.module.apply(kindCtx.ctx)
report.ok(pure.CARD_KIND !== pure.CARD_KIND_BETTER, 'the two adapters use different tab kinds')
report.equal(
  nativeKinds.get(`${pure.CARD_KIND}|extension`),
  pure.CARD_KIND,
  'the native adapter registered its own kind on the shared registry',
)
report.equal(
  nativeKinds.get(`${pure.CARD_KIND_BETTER}|extension`),
  `dsh-better-sidebar:${pure.CARD_KIND_BETTER}`,
  'the better-sidebar mirror registered a DIFFERENT kind, so neither threw',
)
report.equal(mirroredDescriptors.length, 1, 'better-sidebar received exactly one descriptor')
report.equal(
  kindClient.module.api.pure.pickSurface('auto').adapter.kind,
  'native-rightbar',
  'with both adapters healthy, auto prefers the native right rail',
)
report.equal(
  kindClient.module.api.pure.pickSurface('better-sidebar').fellBack,
  false,
  'and the better-sidebar carrier stays available',
)

console.log('\nnative tab lifecycle')
// A3: closing a card used to orphan its right-rail tab (the native adapter's
// close() was a no-op). It now probes `closeTab` on the rail controller with
// the same shape `openTab` verified, and the leftover tab body — when a rail
// refuses the close — says the card was closed instead of a bare "(empty)".
const kindOverlay = kindCtx.find('shell.overlay', pure.IDS.overlay)
const kindActions = kindOverlay.component().props.actions
kindActions.submit(
  {
    text: 'kind 节的选中文本',
    rect: { left: 5, top: 5, right: 200, bottom: 25, width: 195, height: 20 },
    zone: 'task',
    cross: false,
    slotPath: ['sidebar.right.pane.tab'],
    kind: 'text',
  },
  { question: '这段讲什么？', carrier: 'side' },
)
await new Promise(resolve => setTimeout(resolve, 120))
const kindCards = kindClient.module.api.snapshot().cards
report.equal(kindCards.length, 1, 'the submitted card lives in the store')
report.equal(kindCards[0]?.surface, 'native-rightbar', 'the card is carried by the native right rail')
report.ok(kindTabsOpened.length === 1, 'opening the card opened exactly one rail tab')
report.equal(kindTabsOpened[0]?.kind, pure.CARD_KIND, 'the rail tab was opened under the card kind')
kindActions.close(kindCards[0])
report.ok(kindTabsClosed.length === 1, 'closing the card asks the rail to close its tab')
report.equal(kindTabsClosed[0]?.kind, pure.CARD_KIND, 'the close targets the same card kind')
report.equal(kindTabsClosed[0]?.request?.params?.cardId, kindCards[0].id, 'the close names the card id')
report.equal(kindClient.module.api.snapshot().cards.length, 0, 'the card is gone from the store after close')
// After the close nothing renders a card anywhere, and a leftover tab body
// (a rail that ignored the close) says the card was closed, not "(empty)".
const afterCloseTree = expandTree(kindOverlay.component())
report.equal(byClass(afterCloseTree, 'dsa-card').length, 0, 'no card renders anywhere after close')
const betterHostTree = expandTree(mirroredDescriptors[0].component({ tab: { meta: { cardId: 'no-such-card' } } }))
report.ok(
  textOf(betterHostTree).includes('该卡片已关闭'),
  'an embedded host whose card is gone says the card was closed',
)

console.log('\nrender proof timing')
// B7: the render proof used to be a blind 600ms timer against one global
// `renderedCardId`. A lazy host that mounted AFTER the timer duplicated the
// card on two surfaces at once. Mounting now settles its own proof, and a
// genuinely late mount renders the moved-to-flow note instead of a second
// copy of the answer, asking the rail to close the tab it kept.
const proofTabsOpened = []
const proofTabsClosed = []
const proofDescriptors = []
const proofCtx = makeClientCtx({
  services: {
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: {
      openTab: (kind, request) => { proofTabsOpened.push({ kind, request }) },
      closeTab: (kind, request) => { proofTabsClosed.push({ kind, request }) },
      mounted: { getSnapshot: () => 'session-alpha', subscribe: () => () => {} },
    },
    betterSidebar: {
      version: '0.22.1',
      features: fullFeatures,
      registerTab: descriptor => { proofDescriptors.push(descriptor); return () => {} },
      openTab: () => {},
      closeTab: () => {},
      getSnapshot: () => ({ sessionId: 'session-alpha' }),
    },
  },
})
const proofClient = loadClientModule({ fetchImpl: hostFetch, language: 'zh-CN' })
proofClient.module.apply(proofCtx.ctx)
await new Promise(resolve => setTimeout(resolve, 20))
const proofOverlay = proofCtx.find('shell.overlay', pure.IDS.overlay)
const proofActions = proofOverlay.component().props.actions
const hostTreeFor = cardId => expandTree(
  proofDescriptors[0].component({ tab: { meta: { cardId } } }))

// Scene 1 — the host mounts inside the proof window: mounting settles the
// proof, so no late timer ever moves the card away from its tab.
proofActions.submit(
  {
    text: '场景一的选中文本',
    rect: { left: 5, top: 5, right: 200, bottom: 25, width: 195, height: 20 },
    zone: 'task',
    cross: false,
    slotPath: ['sidebar.right.pane.tab'],
    kind: 'text',
  },
  { question: '挂载会撤销证明吗？', carrier: 'side' },
)
await new Promise(resolve => setTimeout(resolve, 30))
const sceneOneId = proofClient.module.api.snapshot().cards[0]?.id
const sceneOneTree = hostTreeFor(sceneOneId)
proofClient.shim.flushEffects()
await new Promise(resolve => setTimeout(resolve, 700))
const sceneOneCard = proofClient.module.api.snapshot().cards.find(item => item.id === sceneOneId)
report.equal(sceneOneCard?.surface, 'native-rightbar', 'an on-time mount keeps the card on its host surface')
report.ok(
  textOf(sceneOneTree).includes('挂载会撤销证明吗？'),
  'the mounted host renders the real card body',
)

// Scene 2 — no host ever mounts within the window: the proof moves the card
// to the flow stack, and a host that mounts LATE shows the moved-to-flow
// note (and asks the rail to close the kept tab) instead of duplicating.
proofActions.submit(
  {
    text: '场景二的选中文本',
    rect: { left: 5, top: 45, right: 200, bottom: 65, width: 195, height: 20 },
    zone: 'task',
    cross: false,
    slotPath: ['sidebar.right.pane.tab'],
    kind: 'text',
  },
  { question: '迟到挂载会双显吗？', carrier: 'side' },
)
await new Promise(resolve => setTimeout(resolve, 700))
const sceneTwoCard = proofClient.module.api.snapshot().cards.find(
  item => item.question === '迟到挂载会双显吗？')
report.equal(sceneTwoCard?.surface, 'flow', 'an unproven mount moves the card to the flow stack')
const closeCallsBeforeLateMount = proofTabsClosed.length
const lateTree = hostTreeFor(sceneTwoCard.id)
proofClient.shim.flushEffects()
report.ok(
  textOf(lateTree).includes('该卡片已移至浮层显示'),
  'a late mount renders the moved-to-flow note',
)
report.equal(
  byClass(lateTree, 'dsa-card').length,
  0,
  'a late mount never renders a second copy of the answer',
)
report.ok(
  proofTabsClosed.length === closeCallsBeforeLateMount + 1,
  'a late mount asks the rail to close the duplicated tab',
)

// The popover badge counts what a reader would count: two emoji are two
// characters, not four UTF-16 units.
proofActions.openPopover({
  text: '😀😀',
  rect: { left: 5, top: 5, right: 120, bottom: 25, width: 115, height: 20 },
  zone: 'chat',
  cross: false,
  slotPath: ['conversation.chat.node'],
  kind: 'text',
})
const popoverTree = expandTree(proofOverlay.component())
report.ok(
  textOf(popoverTree).includes('2 字'),
  'the popover badge counts code points (2 emoji read as 2 characters)',
)

console.log('\ndispose symmetry')
// D15: ctx.inject's reverse-registration used to be dropped on the floor —
// after unload the host kept routing injections into a disposed plugin
// fiber. Both adapters now unwind their injections with everything else.
{
  const disposeFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: {} }) })
  const disposeCtx = makeClientCtx({
    services: {
      betterSidebar: { version: '0.22.1', features: ['tabMeta'], registerTab: () => () => {} },
    },
  })
  const disposeClient = loadClientModule({ fetchImpl: disposeFetch, language: 'zh-CN' })
  disposeClient.module.apply(disposeCtx.ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  report.equal(disposeCtx.uninjects.length, 0, 'no injection unwinds before the plugin is disposed')
  for (const teardown of disposeCtx.effects.splice(0)) teardown()
  const unwound = disposeCtx.uninjects.map(deps => (Array.isArray(deps) ? deps.join('+') : String(deps)))
  report.ok(unwound.includes('sidebarRightTabs+sidebarRight'), 'the native adapter unwinds its ctx.inject on dispose')
  report.ok(unwound.includes('betterSidebar'), 'the better-sidebar adapter unwinds its ctx.inject on dispose')
}

console.log('\nclient self-report')
// The Host cannot inspect a browser-side plugin, so the Client posts a bounded
// summary and `/state` hands it back. The body is built by a pure helper, which
// is what this section exercises (smoke-test covers the host endpoint).
const reportBody = pure.buildClientReport({
  surface: 'better-sidebar',
  zoneAnchors: false,
  sessionId: 'session-alpha',
  slots: { overlay: 'shell.overlay' },
})
report.equal(reportBody.version, client.api.version, 'the report carries the client version')
report.equal(reportBody.surface, 'better-sidebar', 'the report carries the chosen surface')
report.equal(reportBody.zoneAnchors, false, 'the report carries the zone-anchor verdict')
report.equal(reportBody.sessionKnown, true, 'the report says whether a session was resolved')
report.equal(reportBody.slots.overlay, 'shell.overlay', 'the report carries the slot landings')
report.ok(typeof reportBody.native.available === 'boolean', 'the report carries the native adapter state')
report.ok(typeof reportBody.better.available === 'boolean', 'the report carries the side-card plugin state')
report.ok(Array.isArray(reportBody.better.features), 'the plugin capability list is reported')

const emptyReport = pure.buildClientReport({ surface: 'flow', zoneAnchors: null, sessionId: null, slots: {} })
report.equal(emptyReport.sessionKnown, false, 'no session is reported honestly')
report.equal(emptyReport.zoneAnchors, null, 'an unknown zone verdict stays null')

// The two halves update independently (host on restart, client on page load),
// so a newer client must stop reporting to a host that has no `/diagnose`.
report.equal(pure.isDiagnosticsUnsupported({ code: 'not-found' }), true, 'a 404 host disables the channel')
report.equal(pure.isDiagnosticsUnsupported({ code: 'bad-response' }), true, 'an SPA-fallback HTML answer disables it too')
report.equal(pure.isDiagnosticsUnsupported({ code: 'unreachable' }), true, 'an unreachable host disables it too')
report.equal(pure.isDiagnosticsUnsupported({ code: 'invalid-config' }), false, 'a real error does NOT disable it')
report.equal(pure.isDiagnosticsUnsupported(undefined), false, 'an unknown failure does not disable it')

report.summary()
