/**
 * smoke-test.mjs — end-to-end behavior of the Host half.
 *
 * Boots the plugin against the fake harness and drives its real routes:
 * happy path streaming, truncation, cancellation, persistence and restart,
 * configuration validation, every documented failure mode, the concurrency
 * caps and the request-trust fence.
 *
 * Run: `node test/smoke-test.mjs`.
 */

import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_ENTRY, createReporter, makeHostCtx, makeSubagentEngine, callRoute, hostModuleUrl } from './harness.mjs'

// Persisted user config lives under $DSH_HOME; use a scratch directory so the
// test never writes into a real profile.
const HOME = mkdtempSync(join(tmpdir(), 'selection-followup-smoke-'))
process.env.DSH_HOME = HOME
const CONFIG_FILE = join(HOME, 'selection-followup', 'config.json')

const report = createReporter('smoke')

/** Boot one host instance over a fresh fake context. */
async function boot({ patch = {}, engineOptions = {}, services = {} } = {}) {
  const host = await import(hostModuleUrl())
  const harness = makeHostCtx({ services })
  const engine = makeSubagentEngine({ emit: (event, ...args) => harness.emit(event, ...args), ...engineOptions })
  // An explicit service always wins (including an explicit `undefined`), so a
  // test can hand the plugin a slimmer composition on purpose.
  if (!Object.hasOwn(services, 'subagents')) harness.services.subagents = engine.service
  if (!Object.hasOwn(services, 'agents')) {
    const agent = { id: 'session-alpha', session: { header: { id: 'session-alpha' } } }
    harness.services.agents = {
      get: id => (id === 'session-alpha' ? agent : undefined),
      roots: () => [agent],
      list: () => [agent],
    }
  }
  // A live tool registry: `tools.restrict()` validates every allow-list name
  // against it, so the plugin must intersect with what actually exists.
  if (!Object.hasOwn(services, 'tools')) {
    harness.services.tools = {
      schemas: () => [
        { name: 'read' },
        { name: 'glob' },
        { name: 'write' },
        { name: 'bash' },
        { name: 'web_search' },
      ],
    }
  }
  host.apply(harness.ctx, { trigger: 'selection', maxChars: 4000, ...patch })
  return { host, harness, engine }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// ────────────────────────────────────────────────────────────────────────────
// 1. boot, state, capabilities
// ────────────────────────────────────────────────────────────────────────────

console.log('boot and state')
const a = await boot()
report.ok(a.harness.route() !== undefined, 'the plugin registered its route on webServer')
report.equal(a.harness.route().kind, 'prefix', 'the route is a prefix route')
report.equal(a.harness.route().path, '/selection-followup/api', 'the route is mounted at the documented prefix')
report.equal(a.harness.log.filter(entry => entry[0] === 'warn').length, 0, 'a clean boot logs no warning')

const state = (await callRoute(a.harness, '/state', { method: 'GET' })).json()
report.equal(state.ok, true, '/state answers ok')
report.equal(state.value.plugin, 'dsh-selection-followup', '/state reports the plugin id')
report.equal(state.value.version, a.host.PLUGIN_VERSION, '/state reports the plugin version')
report.equal(state.value.config.sideProvider, 'auto', '/state carries the effective config')
report.equal(state.value.capabilities.sideEngine, true, '/state reports the side engine as usable')
report.equal(state.value.capabilities.sideProviders, ['spawn'], '/state lists the subagent providers')
report.equal(state.value.provenance.persisted, false, 'nothing persisted before the first save')
report.ok(state.value.provenance.persistedPath.startsWith(HOME), 'the config path lives under $DSH_HOME')
const postState = (await callRoute(a.harness, '/state', { body: {} })).json()
report.equal(postState.ok, true, '/state also answers POST')

// ────────────────────────────────────────────────────────────────────────────
// 2. happy path: ask, stream, settle, dispose
// ────────────────────────────────────────────────────────────────────────────

console.log('\nstreaming ask')
const ask = await callRoute(a.harness, '/ask', {
  body: {
    id: 'ask-1',
    question: '这句话是什么意思？',
    selection: '槽位出口会带上 data-slot 标记。',
    zone: 'chat',
    sessionId: 'session-alpha',
  },
})
const events = ask.events()
report.equal(ask.status, 200, 'the ask route answers 200')
report.ok(String(ask.headers['content-type']).startsWith('text/event-stream'), 'the answer is an SSE stream')
report.equal(events[0].event, 'start', 'the stream opens with start')
report.equal(events.at(-1).event, 'done', 'the stream closes with done')
report.equal(events.at(-1).data.text, '这是一个流式答案', 'done carries the assembled text')
report.equal(events.at(-1).data.streaming, true, 'done reports streaming')
report.equal(events.at(-1).data.stopReason, 'completed', 'done reports the stop reason')
report.ok(events.some(event => event.event === 'status'), 'an end frame is reported as status')
report.equal(events.filter(event => event.event === 'delta').length, 4, 'every text delta reached the wire')
report.equal(a.engine.starts.length, 1, 'exactly one child agent was started')
report.equal(a.engine.starts[0].name, 'spawn', 'the spawn provider was chosen')
report.equal(a.engine.starts[0].request.parent.id, 'session-alpha', 'the asking session is the child parent')
report.equal(a.engine.starts[0].request.prompt[0].type, 'text', 'the child receives one text block')
report.ok(a.engine.promptOf(0).includes('槽位出口会带上 data-slot 标记。'), 'the selection reaches the child prompt')
report.ok(a.engine.promptOf(0).includes('这句话是什么意思？'), 'the question reaches the child prompt')
report.ok(a.engine.promptOf(0).includes('【选中来源】聊天区'), 'the prompt labels the source zone')
report.ok(a.engine.promptOf(0).includes('```text'), 'the selection is fenced as data')
report.equal(a.engine.disposed, ['child-1'], 'the run was disposed after settling')
report.equal(
  a.engine.starts[0].request.toolFilter,
  { allow: ['read', 'glob', 'web_search'] },
  'the read-only filter only names tools the live registry knows',
)
report.ok(
  !a.engine.starts[0].request.toolFilter.allow.includes('write'),
  'mutating tools are excluded from the read-only filter',
)
report.ok(
  typeof a.engine.starts[0].request.persona === 'string' && a.engine.starts[0].request.persona.includes('selection-answer'),
  'the persona travels as a provider field when supported',
)
report.equal(events[0].data.toolFilter, 'applied', 'the start event reports the read-only guard as applied')
report.equal(events[0].data.persona, 'section', 'the start event reports the persona carrier')

// A provider that advertises NO capabilities must receive no optional field at
// all — an unsupported field fails `subagents.start` outright — so the persona
// is inlined into the prompt and the missing tool guard is reported.
const bareProvider = await boot({ engineOptions: { capabilities: null } })
const bareAsk = await callRoute(bareProvider.harness, '/ask', {
  body: { id: 'ask-bare', question: 'q', selection: 'text' },
})
const bareStart = bareAsk.events()[0]
report.equal(Object.hasOwn(bareProvider.engine.starts[0].request, 'toolFilter'), false, 'a capability-less provider gets no toolFilter')
report.equal(Object.hasOwn(bareProvider.engine.starts[0].request, 'persona'), false, 'a capability-less provider gets no persona field')
report.ok(bareProvider.engine.promptOf(0).startsWith('You are DSH'), 'the persona is inlined into the prompt instead')
report.equal(bareStart.data.toolFilter, 'unsupported', 'the start event admits the read-only guard is unavailable')
report.equal(bareStart.data.persona, 'prompt', 'the start event reports the inlined persona')

// A provider that supports the fields explicitly false must be treated the same.
const partial = await boot({ engineOptions: { capabilities: { toolFilter: false, persona: true } } })
await callRoute(partial.harness, '/ask', { body: { id: 'ask-partial', question: 'q', selection: 'text' } })
report.equal(Object.hasOwn(partial.engine.starts[0].request, 'toolFilter'), false, 'toolFilter is withheld when unsupported')
report.ok(typeof partial.engine.starts[0].request.persona === 'string', 'a supported persona is still sent')

// An older run with no live child still completes: the answer arrives once
// from `run.result` and the stream honestly reports `streaming: false`.
const noChild = await boot({ engineOptions: { localAgent: false } })
const noChildAsk = await callRoute(noChild.harness, '/ask', {
  body: { id: 'ask-nochild', question: 'q', selection: 'text' },
})
const noChildDone = noChildAsk.events().at(-1)
report.equal(noChildDone.event, 'done', 'a run without a live child still settles')
report.equal(noChildDone.data.streaming, false, 'it honestly reports that nothing streamed')
report.equal(noChildDone.data.text, '这是一个流式答案', 'the full text comes from the settled result')

// A composition without a tool registry must omit the filter entirely: an
// allow-list containing an unknown name makes `tools.restrict()` refuse the
// whole start (observed live on 0.1.7-rc.2).
const noTools = await boot({ services: { tools: undefined } })
await callRoute(noTools.harness, '/ask', {
  body: { id: 'ask-notools', question: 'q', selection: 'text' },
})
report.equal(
  Object.hasOwn(noTools.engine.starts[0].request, 'toolFilter'),
  false,
  'no tool registry means no toolFilter field at all (not an empty allow-list)',
)

// `inherit` mode must not restrict anything either.
const inherit = await boot({ patch: { sideTools: 'inherit' } })
await callRoute(inherit.harness, '/ask', {
  body: { id: 'ask-inherit', question: 'q', selection: 'text' },
})
report.equal(
  Object.hasOwn(inherit.engine.starts[0].request, 'toolFilter'),
  false,
  'inherit mode passes no tool filter',
)

// ────────────────────────────────────────────────────────────────────────────
// 3. truncation of an over-long selection
// ────────────────────────────────────────────────────────────────────────────

console.log('\nlong selection')
const b = await boot({ patch: { maxChars: 400 } })
const longText = `${'开头'.repeat(200)}${'结尾'.repeat(200)}`
const longAsk = await callRoute(b.harness, '/ask', {
  body: { id: 'ask-long', question: '概括一下', selection: longText, zone: 'task' },
})
const longEvents = longAsk.events()
report.equal(longEvents[0].data.truncated, true, 'start reports the truncation')
report.ok(longEvents[0].data.droppedChars > 0, 'start reports how many characters were dropped')
report.ok(b.engine.promptOf(0).includes('已省略中间'), 'the child prompt carries the truncation marker')
report.ok(b.engine.promptOf(0).includes('（文本过长，已截断）'), 'the child prompt marks the truncated source')
report.ok(b.engine.promptOf(0).length <= 60_000, 'the prompt stays inside the hard cap')

// ────────────────────────────────────────────────────────────────────────────
// 4. cancellation of an in-flight answer
// ────────────────────────────────────────────────────────────────────────────

console.log('\nrequest lifecycle')
// Node's `IncomingMessage` emits "close" as soon as the request BODY completes.
// A disconnect listener written on `req` therefore aborts every run the moment
// the body is read — a live-only failure this case pins down.
const lifecycle = await callRoute(a.harness, '/ask', {
  closeAfterBody: true,
  body: { id: 'ask-lifecycle', question: '请求体会先结束', selection: '不要因此中断作答' },
})
report.equal(lifecycle.events().at(-1).event, 'done', 'a completed request body does not cancel the run')
report.equal(lifecycle.events().at(-1).data.text, '这是一个流式答案', 'the answer survives the request close')

console.log('\ncancel')
const c = await boot({ engineOptions: { delayMs: 25, frames: ['a', 'b', 'c', 'd', 'e', 'f'] } })
const pending = callRoute(c.harness, '/ask', {
  body: { id: 'ask-cancel', question: '慢一点', selection: '等待中的文本', zone: 'chat' },
})
await wait(60)
const cancelRes = await callRoute(c.harness, '/cancel', { body: { id: 'ask-cancel' } })
const cancelBody = cancelRes.json()
report.equal(cancelBody.ok, true, '/cancel answers ok')
report.equal(cancelBody.value.cancelled, true, '/cancel found and aborted the run')
const cancelledAsk = await pending
const cancelledEvents = cancelledAsk.events()
report.equal(cancelledEvents.at(-1).event, 'done', 'a cancelled run still delivers its partial answer')
report.equal(cancelledEvents.at(-1).data.aborted, true, 'the partial answer is marked as aborted')
report.ok(cancelledEvents.at(-1).data.text.length > 0, 'the partial text survives the cancellation')
report.ok(
  cancelledEvents.filter(event => event.event === 'delta').length < 6,
  'the cancellation stopped the stream before every frame arrived',
)

// A run cancelled before ANY frame produces a plain error instead of an empty
// "done": the Client shows the retryable error card.
const c2 = await boot({ engineOptions: { delayMs: 60, frames: ['x'] } })
const pendingEarly = callRoute(c2.harness, '/ask', {
  body: { id: 'ask-cancel-early', question: '立刻停', selection: '还没开始', zone: 'chat' },
})
await wait(10)
await callRoute(c2.harness, '/cancel', { body: { id: 'ask-cancel-early' } })
const earlyEvents = (await pendingEarly).events()
report.equal(earlyEvents.at(-1).event, 'error', 'a run cancelled before its first frame ends in an error')
report.equal(earlyEvents.at(-1).data.code, 'aborted', 'the early abort keeps the aborted code')
report.equal(earlyEvents.at(-1).data.retryable, true, 'the early abort is retryable')

const unknownCancel = (await callRoute(c.harness, '/cancel', { body: { id: 'nope' } })).json()
report.equal(unknownCancel.value.cancelled, false, 'cancelling an unknown id is a safe no-op')
report.equal((await callRoute(c.harness, '/cancel', { body: {} })).status, 400, 'a missing id is refused')

// ────────────────────────────────────────────────────────────────────────────
// 5. configuration: validation, persistence, restart, reset
// ────────────────────────────────────────────────────────────────────────────

console.log('\nconfiguration')
const d = await boot({ patch: { maxChars: 4000, trigger: 'selection' } })
const invalid = await callRoute(d.harness, '/config', { body: { trigger: 'nonsense' } })
report.equal(invalid.status, 400, 'an invalid enum value is refused')
report.equal(invalid.json().error.code, 'invalid-config', 'the refusal carries the invalid-config code')
const saved = await callRoute(d.harness, '/config', { body: { maxChars: 900, trigger: 'both' } })
report.equal(saved.status, 200, 'a valid patch is accepted')
report.equal(saved.json().value.config.maxChars, 900, 'the accepted value is effective')
report.equal(saved.json().value.provenance.persisted, true, 'the save is marked as persisted')
report.ok(existsSync(CONFIG_FILE), 'the user layer is written to <DSH_HOME>/selection-followup/config.json')
report.equal(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).maxChars, 900, 'the file holds the accepted value')

// A fresh instance must read the persisted layer back (the restart path).
const restarted = await boot({ patch: { maxChars: 4000, trigger: 'selection' } })
const afterRestart = (await callRoute(restarted.harness, '/state', { method: 'GET' })).json()
report.equal(afterRestart.value.config.maxChars, 900, 'a restarted host reads the persisted user layer')
report.equal(afterRestart.value.config.trigger, 'both', 'the persisted layer beats the patch layer')
report.equal(afterRestart.value.provenance.persisted, true, 'provenance reports the persisted layer')

const reset = await callRoute(restarted.harness, '/reset', { body: {} })
report.equal(reset.status, 200, '/reset answers ok')
report.equal(reset.json().value.config.maxChars, 4000, '/reset restores the patch layer')
report.equal(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).maxChars, undefined, 'the user layer is emptied on disk')

// ────────────────────────────────────────────────────────────────────────────
// 6. failure modes the client renders
// ────────────────────────────────────────────────────────────────────────────

console.log('\nfailure modes')
const noEngine = await import(hostModuleUrl('noengine'))
const bare = makeHostCtx({ services: { agents: { get: () => undefined, roots: () => [], list: () => [] } } })
noEngine.apply(bare.ctx, {})
const noEngineAsk = await callRoute(bare, '/ask', {
  body: { id: 'ask-none', question: 'q', selection: 'some text' },
})
const noEngineEvents = noEngineAsk.events()
report.equal(noEngineEvents.at(-1).event, 'error', 'a composition without subagents ends in an error')
report.equal(noEngineEvents.at(-1).data.code, 'no-side-engine', 'the error names the missing engine')
report.equal(noEngineEvents.at(-1).data.fallback, 'main', 'the error offers the main-chat fallback')
const noParent = await boot({ services: { agents: { get: () => undefined, roots: () => [], list: () => [] } } })
const noParentAsk = await callRoute(noParent.harness, '/ask', {
  body: { id: 'ask-orphan', question: 'q', selection: 'some text' },
})
report.equal(noParentAsk.events().at(-1).data.code, 'no-parent', 'a missing live agent is reported as no-parent')

// The archived-session gate rejects every step of a child whose lineage
// contains an archived session, so the plugin must never pick such a parent.
const archiveRoot = { id: 'archived-root', session: { header: { id: 'archived-root' } } }
const liveRoot = { id: 'live-root', session: { header: { id: 'live-root' } } }
const archiving = await boot({
  services: {
    workspaceRegistry: { archivedSessionIds: new Set(['archived-root']) },
    agents: { get: () => undefined, roots: () => [archiveRoot, liveRoot], list: () => [archiveRoot, liveRoot] },
  },
})
const archivedState = (await callRoute(archiving.harness, '/state', { method: 'GET' })).json()
report.equal(archivedState.value.capabilities.parent.id, 'live-root', '/state reports a non-archived parent')
report.equal(archivedState.value.capabilities.parent.archived, false, '/state reports the parent as not archived')
report.equal(
  archivedState.value.capabilities.parent.candidates.length,
  2,
  '/state lists every candidate so a refusal can be diagnosed',
)
const archivedAsk = await callRoute(archiving.harness, '/ask', {
  body: { id: 'ask-live-parent', question: 'q', selection: 'text' },
})
report.equal(archivedAsk.events().at(-1).event, 'done', 'an archived root does not become the parent')
report.equal(archiving.engine.starts[0].request.parent.id, 'live-root', 'the non-archived agent was chosen')

// Every candidate archived → the run is still ATTEMPTED with a flag, because
// the archived-session gate that rejects such a child's steps exists only from
// 0.1.7-alpha.1 on (probed against the published packages); refusing outright
// would break 0.1.2 – 0.1.6-alpha.2, where an archived parent answers normally.
const allArchived = await boot({
  services: {
    workspaceRegistry: { archivedSessionIds: ['archived-root'] },
    agents: { get: () => undefined, roots: () => [archiveRoot], list: () => [archiveRoot] },
  },
})
const allArchivedAsk = await callRoute(allArchived.harness, '/ask', {
  body: { id: 'ask-all-archived', question: 'q', selection: 'text' },
})
report.equal(allArchivedAsk.events()[0].data.parentArchived, true, 'the start event flags an archived parent')
report.equal(allArchivedAsk.events().at(-1).event, 'done', 'an archived-only composition still gets an answer')
report.equal(allArchived.engine.starts.length, 1, 'the run was attempted rather than refused')

// 0.1.2-rc.1 logs durable `assistant/chunk` events and publishes no frames.
const chunked = await boot({ engineOptions: { frameMode: 'chunks' } })
const chunkedAsk = await callRoute(chunked.harness, '/ask', {
  body: { id: 'ask-chunks', question: 'q', selection: 'text' },
})
const chunkedEvents = chunkedAsk.events()
report.equal(
  chunkedEvents.filter(event => event.event === 'delta').map(event => event.data.text).join(''),
  '这是一个流式答案',
  'the durable-chunk source streams the answer',
)
report.equal(chunkedEvents.at(-1).data.streaming, true, 'durable chunks count as streaming')
report.equal(chunkedEvents.at(-1).data.streamSource, 'chunks', 'the done event names the chunk source')

// A build that publishes frames must never double-count the same text.
const bothSources = await boot({ engineOptions: { frameMode: 'chunks', localAgent: true } })
report.equal(bothSources.engine.starts.length, 0, 'no run is started before the ask')
const bothAsk = await callRoute(bothSources.harness, '/ask', {
  body: { id: 'ask-both', question: 'q', selection: 'text' },
})
report.equal(bothAsk.events().at(-1).data.text, '这是一个流式答案', 'the answer text is never duplicated')

// A step the host blocks surfaces as `refusal` from the subagent seam; the
// message must explain it instead of leaking the bare stop reason.
const blocked = await boot({ engineOptions: { stopReason: 'refusal', frames: [] } })
const blockedAsk = await callRoute(blocked.harness, '/ask', {
  body: { id: 'ask-blocked', question: 'q', selection: 'text' },
})
report.equal(blockedAsk.events().at(-1).data.code, 'blocked-step', 'a blocked step gets its own code')
report.equal(blockedAsk.events().at(-1).data.stopReason, 'refusal', 'the raw stop reason is preserved')
report.ok(
  blockedAsk.events().at(-1).data.message.includes('归档'),
  'the blocked-step message names the usual cause',
)
report.equal(blockedAsk.events().at(-1).data.fallback, 'main', 'the blocked step offers the main-chat fallback')

const emptyQuestion = await callRoute(a.harness, '/ask', { body: { id: 'x', question: '   ', selection: 'text' } })
report.equal(emptyQuestion.events().at(-1).data.code, 'bad-request', 'an empty question is refused')
const emptySelection = await callRoute(a.harness, '/ask', { body: { id: 'y', question: 'q', selection: '  ' } })
report.equal(emptySelection.events().at(-1).data.code, 'bad-request', 'an empty selection is refused')

const engineError = await boot({ engineOptions: { startError: Object.assign(new Error('provider offline'), { code: 'subagent/unavailable' }) } })
const engineErrorAsk = await callRoute(engineError.harness, '/ask', {
  body: { id: 'ask-err', question: 'q', selection: 'text' },
})
report.equal(engineErrorAsk.events().at(-1).data.code, 'subagent/unavailable', 'a provider failure keeps its code')
report.equal(engineErrorAsk.events().at(-1).data.retryable, true, 'a provider failure is retryable')

// ────────────────────────────────────────────────────────────────────────────
// 7. concurrency caps and duplicate ids
// ────────────────────────────────────────────────────────────────────────────

console.log('\nconcurrency')
const g = await boot({ patch: { maxConcurrentAsks: 1 }, engineOptions: { delayMs: 30, frames: ['slow'] } })
const first = callRoute(g.harness, '/ask', { body: { id: 'busy-1', question: 'q1', selection: 'text one' } })
await wait(15)
const duplicate = await callRoute(g.harness, '/ask', { body: { id: 'busy-1', question: 'q1', selection: 'text one' } })
report.equal(duplicate.events().at(-1).data.code, 'duplicate', 'the same card id cannot run twice')
const second = await callRoute(g.harness, '/ask', { body: { id: 'busy-2', question: 'q2', selection: 'text two' } })
report.equal(second.events().at(-1).data.code, 'busy', 'the concurrency cap refuses a further run')
report.equal(second.events().at(-1).data.retryable, true, 'the busy refusal is retryable')
await first
const stateAfter = (await callRoute(g.harness, '/state', { method: 'GET' })).json()
report.equal(stateAfter.value.capabilities.activeRuns, 0, 'the run registry drains after settling')

// ────────────────────────────────────────────────────────────────────────────
// 8. transport guards
// ────────────────────────────────────────────────────────────────────────────

console.log('\ntransport guards')
const fenced = await callRoute(a.harness, '/state', { method: 'GET', headers: { host: 'evil.example' } })
report.equal(fenced.status, 403, 'a foreign Host header is refused')
const crossSite = await callRoute(a.harness, '/state', {
  method: 'GET',
  headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site' },
})
report.equal(crossSite.status, 403, 'a cross-site fetch marker is refused')
const crossOrigin = await callRoute(a.harness, '/state', {
  method: 'GET',
  headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' },
})
report.equal(crossOrigin.status, 403, 'a foreign Origin is refused')
const trusted = await callRoute(a.harness, '/state', {
  method: 'GET',
  headers: { host: 'box.local:8080', origin: 'http://box.local:8080' },
})
report.equal(trusted.status, 403, 'an untrusted non-loopback authority is refused')

const unknown = await callRoute(a.harness, '/nope', { body: {} })
report.equal(unknown.status, 404, 'an unknown method is a 404')
report.equal(unknown.json().error.code, 'not-found', 'the 404 carries the not-found code')
const wrongVerb = await callRoute(a.harness, '/ask', { method: 'GET' })
report.equal(wrongVerb.status, 405, 'the wrong verb is a 405')
const nested = await callRoute(a.harness, '/ask/extra', { body: {} })
report.equal(nested.status, 404, 'a nested path is a 404')
const badJson = await callRoute(a.harness, '/config', { body: '{oops' })
report.equal(badJson.status, 400, 'a malformed body is a 400')

// A trusted non-loopback authority passes the fence when configured.
const trustedHost = await boot({ services: { webRuntime: { trustedHosts: ['box.local:8080'] } } })
const allowed = await callRoute(trustedHost.harness, '/state', {
  method: 'GET',
  headers: { host: 'box.local:8080', origin: 'http://box.local:8080' },
})
report.equal(allowed.status, 200, 'a configured trusted authority is allowed through the fence')

report.summary()
