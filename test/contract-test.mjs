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
for (const sample of ['short', 'x'.repeat(500), 'a\nb\nc'.repeat(400)]) {
  report.equal(
    pure.truncateSelection(sample, 200),
    host.truncateSelection(sample, 200),
    `truncateSelection agrees for length ${sample.length}`,
  )
}
const prompt = host.buildSidePrompt({
  selection: 'SELECTED-TEXT',
  question: 'WHY?',
  zone: 'task',
  truncated: false,
  history: [],
  historyTurns: 6,
})
report.ok(prompt.includes('SELECTED-TEXT') && prompt.includes('WHY?'), 'host prompt carries selection and question')
report.ok(prompt.includes('任务区'), 'host prompt labels the source zone')
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
const overlayTree = expandTree(loadedClient.shim.React.createElement(overlay.component, {}))
report.ok(byClass(overlayTree, 'dsa-layer').length === 1, 'overlay renders its root layer')
report.ok(byTag(overlayTree, 'style').length >= 1, 'overlay renders its stylesheet with the component')
report.equal(byClass(overlayTree, 'dsa-trigger').length, 0, 'no trigger button before a selection exists')
report.equal(byClass(overlayTree, 'dsa-card').length, 0, 'no answer card before a question is asked')
report.equal(textOf(overlayTree).trim(), '', 'the idle overlay renders no visible text')

const settingsTree = expandTree(loadedClient.shim.React.createElement(settings.component, {}))
const settingsText = textOf(settingsTree)
for (const label of ['触发方式', '默认作答位置', '最大字符数', '快捷键', '捕获区域']) {
  report.ok(settingsText.includes(label), `settings page renders the "${label}" row`)
}
report.ok(byTag(settingsTree, 'select').length >= 4, 'settings page renders its dropdowns')
report.ok(byTag(settingsTree, 'input').length >= 4, 'settings page renders its numeric fields')
report.ok(settingsText.includes('划词追问'), 'settings page renders its title')

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
const kindCtx = makeClientCtx({
  services: {
    sidebarRightTabs: nativeRegistry,
    sidebarRight: { openTab: () => {}, mounted: { getSnapshot: () => 'session-alpha', subscribe: () => () => {} } },
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

report.summary()
