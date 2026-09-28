/**
 * Test harness for dsh-sidecard-ask.
 *
 * There is no DSH runtime in this workspace, so the three test files build a
 * *minimal but honest* stand-in for the parts the plugin touches:
 *
 *   - a fake Cordis host context whose `webServer.register` captures routes,
 *     whose `get()` serves a mutable service bag, and whose `emit()` feeds the
 *     process-local `agent/assistant-stream` bridge;
 *   - a fake subagent provider that behaves like the in-process spawn
 *     provider (`localAgent` present, `result` promise, `dispose`);
 *   - a fake Node `req`/`res` pair that records status, headers, body and SSE
 *     frames;
 *   - a synthetic browser: `window`/`navigator`/`document`/`fetch` plus a tiny
 *     React shim with real single-pass hook semantics, so a registered
 *     component can actually be rendered and inspected.
 *
 * Nothing here imports the plugin's runtime dependencies, because the plugin
 * has none.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const HOST_ENTRY = join(ROOT, 'index.js')
export const CLIENT_ENTRY = join(ROOT, 'client.js')
export const PACKAGE_JSON = join(ROOT, 'package.json')

/**
 * A fresh, importable URL for the host half. The cache-busting tag is what
 * lets one test process boot several independent host instances (the plugin
 * keeps per-activation state), and `pathToFileURL` is what makes an absolute
 * Windows path importable as ESM.
 * @param {string} [tag] - cache-busting tag; defaults to the current time.
 */
export function hostModuleUrl(tag = String(Date.now())) {
  return `${pathToFileURL(HOST_ENTRY).href}?t=${tag}`
}

/** Key-sorted JSON, so structural comparison ignores key order. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Tiny assertion helpers with a shared pass/fail tally. */
export function createReporter(name) {
  const failures = []
  let passed = 0
  const api = {
    ok(condition, label, detail = '') {
      if (condition) {
        passed += 1
        console.log(`  ✔ ${label}`)
      } else {
        failures.push(label)
        console.log(`  ✘ ${label}${detail === '' ? '' : `\n      ${detail}`}`)
      }
      return condition
    },
    equal(actual, expected, label) {
      return api.ok(
        stableStringify(actual) === stableStringify(expected),
        label,
        `expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
      )
    },
    summary() {
      console.log(`\n${name}: ${passed} passed, ${failures.length} failed`)
      if (failures.length > 0) {
        console.log('failed checks:')
        for (const failure of failures) console.log(`  - ${failure}`)
        process.exitCode = 1
      }
      return failures.length === 0
    },
  }
  return api
}

// ────────────────────────────────────────────────────────────────────────────
// Fake host context
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a fake host context.
 * @param {{services?: Record<string, unknown>, trustedHosts?: string[]}} [options]
 */
export function makeHostCtx(options = {}) {
  const services = { ...(options.services ?? {}) }
  if (options.trustedHosts !== undefined) {
    services.webRuntime = { trustedHosts: options.trustedHosts }
  }
  const routes = []
  const listeners = new Map()
  const log = []
  const ctx = {
    logger: {
      info: (...args) => log.push(['info', args.map(String).join(' ')]),
      warn: (...args) => log.push(['warn', args.map(String).join(' ')]),
      error: (...args) => log.push(['error', args.map(String).join(' ')]),
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const at = routes.indexOf(route)
          if (at !== -1) routes.splice(at, 1)
        }
      },
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    get(name) {
      return services[name]
    },
  }
  return {
    ctx,
    services,
    routes,
    listeners,
    log,
    /**
     * Feed one event to every listener. Variadic because core events differ:
     * `agent/assistant-stream` carries one payload object, while
     * `session/event` carries `(session, event)`.
     */
    emit(event, ...args) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
    },
    /** The single registered route. */
    route() {
      return routes[0]
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fake HTTP request / response
// ────────────────────────────────────────────────────────────────────────────

/**
 * A `req` that emits one body and then `end`.
 * @param {{method?: string, url?: string, headers?: Record<string, string>, body?: unknown,
 *   closeAfterBody?: boolean}} [options] - `closeAfterBody` mirrors Node's real
 *   `IncomingMessage` behavior ("close" fires when the request is COMPLETED),
 *   which is exactly what a disconnect listener must not mistake for a hang-up.
 */
export function makeReq({ method = 'POST', url = '/', headers = {}, body = null, closeAfterBody = false } = {}) {
  const handlers = new Map()
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:8080', ...headers },
    on(event, listener) {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      return req
    },
    destroy() {},
    emit(event, ...args) {
      for (const listener of handlers.get(event) ?? []) listener(...args)
    },
  }
  // Deliver the body on the next tick so listeners are attached first.
  queueMicrotask(() => {
    if (body !== null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    req.emit('end')
    if (closeAfterBody) req.emit('close')
  })
  return req
}

/** A `res` that records status, headers, body and SSE frames. */
export function makeRes() {
  const closeHandlers = []
  const res = {
    status: 0,
    headers: {},
    chunks: [],
    writableEnded: false,
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
      return res
    },
    write(chunk) {
      res.chunks.push(String(chunk))
      return true
    },
    end(chunk) {
      if (chunk !== undefined) res.chunks.push(String(chunk))
      res.writableEnded = true
      for (const listener of closeHandlers) listener()
      return res
    },
    on(event, listener) {
      if (event === 'close') closeHandlers.push(listener)
      return res
    },
    /** The response body as text. */
    text() {
      return res.chunks.join('')
    },
    /** The parsed JSON body. */
    json() {
      return JSON.parse(res.text())
    },
    /** Parsed SSE events in arrival order. */
    events() {
      const out = []
      for (const block of res.text().split('\n\n')) {
        if (block.trim() === '' || block.startsWith(':')) continue
        let event = 'message'
        const data = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trim())
        }
        if (data.length === 0) continue
        out.push({ event, data: JSON.parse(data.join('\n')) })
      }
      return out
    },
  }
  return res
}

/**
 * Drive one plugin route end to end.
 * @param {{route: object}} harness - the makeHostCtx result.
 * @param {string} path - path under the route prefix.
 * @param {{method?: string, body?: unknown, headers?: Record<string, string>,
 *   closeAfterBody?: boolean}} [options]
 * @returns {Promise<object>} the fake `res`.
 */
export async function callRoute(harness, path, options = {}) {
  const route = harness.route()
  if (route === undefined) throw new Error('no route registered')
  const req = makeReq({
    method: options.method ?? 'POST',
    url: `${route.path}${path}`,
    headers: options.headers ?? {},
    body: options.body ?? null,
    closeAfterBody: options.closeAfterBody ?? false,
  })
  const res = makeRes()
  await route.handler(req, res)
  return res
}

// ────────────────────────────────────────────────────────────────────────────
// Fake subagent engine (mirrors the in-process spawn provider's contract)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A subagents service double.
 * @param {{emit: Function, frames?: string[], delayMs?: number, chunksPerFrame?: number,
 *   startError?: Error, stopReason?: string, providerNames?: string[],
 *   capabilities?: Record<string, boolean>|null, localAgent?: boolean}} options
 *   `capabilities` mirrors a real provider's advertisement; `null` means this
 *   DSH version has no capability face at all, so the plugin must send no
 *   optional start field. `localAgent: false` models an older `SubagentRun`
 *   with no live-child handle, whose frames therefore cannot be attributed.
 */
export function makeSubagentEngine(options) {
  const emit = options.emit
  const frames = options.frames ?? ['这是', '一个', '流式', '答案']
  const delayMs = options.delayMs ?? 0
  const providerNames = options.providerNames ?? ['spawn']
  const capabilities = options.capabilities === undefined
    ? { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
    : options.capabilities
  const withLocalAgent = options.localAgent !== false
  const starts = []
  const disposed = []
  const live = new Set()
  const service = {
    list: () => [...providerNames],
    getProvider: name => (providerNames.includes(name)
      ? {
        name,
        inheritsParentContext: false,
        ...(capabilities === null ? {} : { capabilities }),
      }
      : undefined),
    async start(name, request) {
      starts.push({ name, request })
      if (options.startError !== undefined) throw options.startError
      const id = `child-${starts.length}`
      const child = { id, session: { id, header: { id } } }
      // Without a live-child handle the frames cannot be attributed to this
      // run (an older provider whose run/session ids do not line up), which is
      // exactly the case the non-streaming fallback must cover.
      const frameAgent = withLocalAgent ? child : { id: 'foreign-child', session: { id: 'foreign-child' } }
      live.add(id)
      const signal = request.signal
      // `frameMode` models the two streaming surfaces the host supports:
      // process-local frames (0.1.3+) and the durable `assistant/chunk` session
      // event that only 0.1.2-rc.1 logs.
      const frameMode = options.frameMode ?? 'frames'
      const result = (async () => {
        try {
          for (let index = 0; index < frames.length; index += 1) {
            await new Promise(resolve => setTimeout(resolve, delayMs))
            if (signal?.aborted === true) return { output: [], stopReason: 'aborted' }
            if (frameMode === 'frames') {
              emit('agent/assistant-stream', {
                agent: frameAgent,
                frame: { type: 'start', attemptId: `attempt-${id}`, turn: 1, step: 1 },
              })
              emit('agent/assistant-stream', {
                agent: frameAgent,
                frame: {
                  type: 'chunk',
                  attemptId: `attempt-${id}`,
                  index,
                  time: Date.now(),
                  chunk: { type: 'text-delta', index: 0, text: frames[index] },
                },
              })
              if (options.reasoningPrefix !== undefined) {
                emit('agent/assistant-stream', {
                  agent: frameAgent,
                  frame: {
                    type: 'chunk',
                    attemptId: `attempt-${id}`,
                    index: index + 1000,
                    time: Date.now(),
                    chunk: { type: 'reasoning-delta', index: 1, text: `${options.reasoningPrefix}${index}` },
                  },
                })
              }
            } else if (frameMode === 'chunks') {
              emit('session/event', child.session, {
                type: 'assistant/chunk',
                seq: index,
                time: Date.now(),
                data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: frames[index] } },
              })
            }
          }
          if (frameMode === 'frames') {
            emit('agent/assistant-stream', { agent: frameAgent, frame: { type: 'end', stopReason: options.stopReason ?? 'completed' } })
          } else if (frameMode === 'chunks' && options.reasoningPrefix !== undefined) {
            emit('session/event', child.session, {
              type: 'assistant/chunk',
              seq: frames.length,
              time: Date.now(),
              data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 1, text: options.reasoningPrefix } },
            })
          }
          if (options.stopReason !== undefined && options.stopReason !== 'completed') {
            return { output: [], stopReason: options.stopReason, diagnostic: 'engine said no' }
          }
          return {
            output: [{ type: 'text', text: frames.join('') }],
            stopReason: 'completed',
          }
        } finally {
          live.delete(id)
        }
      })()
      return {
        id,
        ...(withLocalAgent ? { localAgent: child } : {}),
        result,
        async dispose() {
          disposed.push(id)
          signal?.abort?.()
        },
      }
    },
  }
  return {
    service,
    starts,
    disposed,
    /** The prompt text the provider received for one start. */
    promptOf(index = 0) {
      const blocks = starts[index]?.request?.prompt ?? []
      return blocks.map(block => block.text ?? '').join('')
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal React shim + synthetic browser, to load and render the client half
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single-pass React substitute. Hooks keep real call order and state slots;
 * effects are collected so the caller can flush them (a second render pass is
 * not modelled — the plugin never depends on one).
 */
export function createReactShim() {
  const effects = []
  const pending = []
  const React = {
    createElement(type, props, ...children) {
      return {
        __element: true,
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== true),
      }
    },
    useState(initial) {
      const slot = pending.length
      pending.push(initial)
      return [initial, (next) => { pending[slot] = typeof next === 'function' ? next(pending[slot]) : next }]
    },
    useReducer(_reducer, initial) {
      return React.useState(initial)
    },
    useEffect(callback) {
      effects.push(callback)
    },
    useLayoutEffect(callback) {
      effects.push(callback)
    },
    useRef(initial) {
      return { current: initial }
    },
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    Fragment: 'Fragment',
  }
  return {
    React,
    effects,
    /** Flush every collected effect (returns the cleanups it produced). */
    flushEffects() {
      const cleanups = []
      while (effects.length > 0) {
        const callback = effects.shift()
        const cleanup = callback()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return cleanups
    },
  }
}

/** Expand a component element tree (function components render inline). */
export function expandTree(element) {
  if (element === null || element === undefined || typeof element !== 'object') return element
  if (element.__element !== true) return element
  if (typeof element.type === 'function') {
    const rendered = element.type({ ...element.props, children: element.children })
    return expandTree(rendered)
  }
  return { ...element, children: element.children.map(expandTree) }
}

/** Every host-element node in an expanded tree, in document order. */
export function hostNodes(tree, out = []) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  if (tree.__element !== true) return out
  out.push(tree)
  for (const child of tree.children) hostNodes(child, out)
  return out
}

/** All text in an expanded tree (style/script content is not user-visible text). */
export function textOf(tree) {
  if (typeof tree === 'string') return tree
  if (tree === null || tree === undefined || typeof tree !== 'object') return ''
  if (tree.type === 'style' || tree.type === 'script') return ''
  return tree.children.map(textOf).join('')
}

/** Find host elements whose class list contains `className`. */
export function byClass(tree, className) {
  return hostNodes(tree).filter(node => String(node.props.className ?? '').split(/\s+/).includes(className))
}

/** Find host elements by tag name. */
export function byTag(tree, tag) {
  return hostNodes(tree).filter(node => node.type === tag)
}

/**
 * Load `client.js` in a synthetic browser and return its registered module.
 * @param {{fetchImpl?: Function, services?: Record<string, unknown>, language?: string}} [options]
 */
export function loadClientModule(options = {}) {
  const source = readFileSync(CLIENT_ENTRY, 'utf8')
  const registrations = []
  const window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      },
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
  }
  const listeners = new Map()
  const document = {
    addEventListener(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    removeEventListener(event, listener) {
      listeners.get(event)?.delete(listener)
    },
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
    execCommand: () => true,
    querySelector: () => null,
  }
  const navigatorShim = { language: options.language ?? 'zh-CN', clipboard: null }
  const fetchImpl = options.fetchImpl ?? (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, value: { config: {}, capabilities: {}, provenance: {} } }),
  }))
  const factory = new Function(
    'window',
    'document',
    'navigator',
    'fetch',
    'console',
    `${source}\n;return window.__ModuleLoader__.load;`,
  )
  factory(window, document, navigatorShim, fetchImpl, console)
  if (registrations.length !== 1) {
    throw new Error(`client.js registered ${registrations.length} modules; expected exactly 1`)
  }
  const shim = createReactShim()
  const module = registrations[0].factory(specifier => {
    if (specifier === 'react') return shim.React
    throw new Error(`client.js required an unexpected module: ${specifier}`)
  })
  return { registration: registrations[0], module, shim, document, window, listeners }
}

// ────────────────────────────────────────────────────────────────────────────
// Fake client context (slots + services)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a fake client-side Cordis context that records slot registrations.
 * @param {{services?: Record<string, unknown>, absentSlots?: Iterable<string>,
 *   throwOnSlots?: Iterable<string>}} [options]
 *   `absentSlots` lists slot keys this composition never declares: their
 *   `inject` callback never runs, which is how an older shell without that key
 *   behaves — and what the registration ladder must survive.
 *   `throwOnSlots` lists keys whose `inject` itself throws — the
 *   reload/teardown failure a registration must roll back from.
 */
export function makeClientCtx(options = {}) {
  const services = { ...(options.services ?? {}) }
  const absentSlots = new Set(options.absentSlots ?? [])
  const throwOnSlots = new Set(options.throwOnSlots ?? [])
  const registrations = []
  const injections = []
  const effects = []
  const ctx = {
    get: name => services[name],
    on: () => () => {},
    provide: () => () => {},
    effect(callback) {
      const dispose = callback()
      effects.push(() => { if (typeof dispose === 'function') dispose() })
      return () => {}
    },
    inject(deps, callback) {
      injections.push(deps)
      callback({ get: name => services[name] })
      return () => {}
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        if (throwOnSlots.has(key)) throw new Error(`slot context "${key}" is already inactive`)
        if (absentSlots.has(key)) return () => {}
        callback()
        return () => {}
      },
      register(registrationOptions, component) {
        registrations.push({ options: registrationOptions, component })
        return () => {}
      },
    },
  }
  return {
    ctx,
    services,
    registrations,
    injections,
    effects,
    /** Look up one registration by slot + id. */
    find(slot, id) {
      return registrations.find(item => item.options.name === slot && item.options.id === id)
    },
  }
}
