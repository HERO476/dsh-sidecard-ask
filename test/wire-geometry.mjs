/**
 * wire-geometry.mjs — the layer's REAL geometry writes, read back from the node.
 *
 * Why this suite exists: until 2.3.0 nothing read `--dsa-*`. `apply()` returned
 * on its first line because the harness never assigned a `ref`, and the effect
 * body after that line — the whole 2.2.0/2.2.2 geometry work — never ran. Proof
 * at the time: replacing `const node = containerRef.current` with `null` left
 * all 2094 assertions green.
 *
 * These cases are the teeth. Each one fails when:
 *   - the wiring is cut (no `ref` → no write at all),
 *   - the keyboard inset is zeroed at the call site (2.2.0 F3),
 *   - the value written to the stylesheet drifts from the value reported on the
 *     node (a card that reports one thing and renders another),
 *   - the surface policy stops choosing the phone sheet.
 *
 * Numbers are read from what the layer wrote, never re-derived here — except
 * where a value is a hard floor the algorithm must respect.
 */
import { createReporter, loadClientModule, makeClientCtx, expandTree, createLocalStorageStub } from './harness.mjs'

const report = createReporter('wire-geometry')

/** Read one `--dsa-*` value off the node the layer wrote to. */
function readNode(node) {
  return {
    gapBottom: node?.style?.getPropertyValue('--dsa-gap-bottom') ?? '',
    floatWidth: node?.style?.getPropertyValue('--dsa-float-w') ?? '',
    gapRight: node?.style?.getPropertyValue('--dsa-gap-right') ?? '',
    capsuleMax: node?.style?.getPropertyValue('--dsa-capsule-max') ?? '',
    dataset: node?.dataset ?? {},
  }
}

/**
 * Mount the overlay in a synthetic browser and return what the layer wrote.
 * @param {{frameWidth?: number, frameHeight?: number, pointerCoarse?: boolean,
 *   visualViewport?: object|null}} [options]
 */
function mount(options = {}) {
  // The layer only exists once there is a visible flow card (`total === 0`
  // returns null before the container is built), so seed one through the same
  // persistence key a reload reads. That is also the realistic path: a page
  // load replays the previous answer and the layer measures itself immediately.
  const storage = createLocalStorageStub()
  storage.setItem('dsh-sidecard-ask:cards:v3', JSON.stringify({
    version: 3,
    cards: [{
      id: 'wire-card',
      question: '几何接线是否可执行？',
      text: '答案',
      status: 'done',
      createdAt: Date.now(),
      sessionId: null,
    }],
  }))
  const client = loadClientModule({
    frameWidth: options.frameWidth ?? 1280,
    frameHeight: options.frameHeight ?? 800,
    pointerCoarse: options.pointerCoarse === true,
    visualViewport: options.visualViewport ?? null,
    storage,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: { config: {}, capabilities: {}, provenance: {} } }),
    }),
  })
  const ctxHandle = makeClientCtx({ services: {} })
  client.module.apply(ctxHandle.ctx)
  const overlay = ctxHandle.find('shell.overlay', client.module.api.pure.IDS.overlay)
  if (overlay === undefined) throw new Error('overlay did not register')
  // Rendering the OVERLAY is what mounts the layer component: the ref is
  // assigned by the shim during createElement, and the effect runs on flush.
  const tree = expandTree(client.shim.React.createElement(overlay.component, {}))
  client.shim.flushEffects()
  client.flushRaf()

  const layer = findLayer(tree)
  return { ...readNode(layer), layer, client }
}

/**
 * Find the node the geometry effect wrote to.
 *
 * The shim assigns one fake node per ref'd element; the layer is the one that
 * received `--dsa-gap-bottom`.
 */
function findLayer(tree) {
  const wrote = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    const ref = node.props?.ref
    if (ref !== null && typeof ref === 'object' && ref.current?.style?.properties?.has('--dsa-gap-bottom')) {
      wrote.push(ref.current)
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return wrote.at(-1) ?? null
}

// ─── desktop: no keyboard, no composer ────────────────────────────────────────
{
  const seen = mount({ frameWidth: 1280, frameHeight: 800 })
  report.equal(seen.gapBottom, '16px', 'desktop writes the 16px floor to --dsa-gap-bottom')
  report.equal(seen.dataset.layerBottom, '16', 'the readable dataset agrees with the stylesheet')
  report.equal(seen.dataset.keyboardInset, '0', 'desktop reports no keyboard inset')
  report.equal(seen.dataset.islandBottom, '0', 'a plain browser advertises no island inset')
  report.equal(seen.gapRight, '8px', 'desktop keeps the 8px right gap')
  report.ok(/^\d+px$/.test(seen.floatWidth), 'desktop writes a numeric float width', `got "${seen.floatWidth}"`)
  report.equal(seen.capsuleMax, '240px', 'the capsule ceiling is written even when unused')
}

// ─── phone: coarse pointer, keyboard open (visual viewport 504 of 844) ────────
{
  const keyboard = 844 - 504
  const seen = mount({
    frameWidth: 412,
    frameHeight: 844,
    pointerCoarse: true,
    visualViewport: { height: 504, offsetTop: 0 },
  })
  report.equal(
    seen.dataset.keyboardInset,
    String(keyboard),
    'the phone reports the keyboard inset it measured (2.2.0 F3)',
  )
  // The keyboard must LIFT the layer. Zeroing it at the call site — the exact
  // mutation that used to leave every suite green — makes this fail.
  report.ok(
    Number(seen.dataset.layerBottom) >= keyboard,
    'the bottom offset is at least the keyboard height',
    `layerBottom=${seen.dataset.layerBottom} keyboard=${keyboard}`,
  )
  // ...and it must stay inside the frame.
  report.ok(
    Number(seen.dataset.layerBottom) <= 844 - 80,
    'the bottom offset never pushes the layer out of the frame',
    `layerBottom=${seen.dataset.layerBottom}`,
  )
  report.equal(
    seen.gapBottom,
    `${seen.dataset.layerBottom}px`,
    'the stylesheet value is the dataset value, in px',
  )
  report.equal(seen.dataset.dsaSurface, 'sheet', 'a coarse pointer takes the sheet surface')
  report.equal(seen.floatWidth, '396px', 'the sheet fills the frame minus both 8px gaps')
}

// ─── desktop: a taller frame must not change the floor ────────────────────────
{
  const seen = mount({ frameWidth: 1024, frameHeight: 640 })
  report.equal(seen.gapBottom, '16px', 'a shorter desktop frame still writes the floor')
  report.equal(seen.dataset.layerBottom, '16', 'the dataset agrees on the shorter frame')
}

const ok = report.summary()
// The effect installs observers and re-measure timers; nothing here needs them
// to fire, and leaving them pending would hold the process open.
process.exit(ok ? 0 : 1)
