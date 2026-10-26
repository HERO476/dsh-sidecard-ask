/**
 * float-placement.mjs — the floating layer (A) must not cover the conversation.
 *
 * Why this file exists: the card used to be a fixed 400px block pinned to the
 * frame's bottom-right, which buried the last lines of the answer behind it
 * (live report, screenshot 2026-10-08). The fix moved the layer to the frame's
 * RIGHT EDGE and made its width a function of the space that is actually left
 * (`floatPlacement` in client.js). That rule is geometry, not taste — so it is
 * asserted here with the numbers from the reporting machine, plus the frame and
 * rail extremes, instead of being trusted.
 *
 * Run: `node test/float-placement.mjs`
 */

import { createReporter, loadClientModule } from './harness.mjs'

const report = createReporter('float-placement')
const { module } = loadClientModule()
const pure = module.api.pure
const place = pure.floatPlacement

// ────────────────────────────────────────────────────────────────────────────
// fixture: the frame the regression was reported on
// ────────────────────────────────────────────────────────────────────────────

/** 1400px frame, 212px left rail, ~400px right rail, conversation ends at 971. */
const REPORTED = { frameWidth: 1400, laneRight: 971, railLeft: 1000, maxWidth: 340 }
/**
 * The old implementation: a fixed 400px block, 16px from the right edge.
 * Kept here so the regression is expressed as a number instead of a memory.
 */
const LEGACY_WIDTH = 400
const LEGACY_GAP = 16
const legacyLeft = frameWidth => frameWidth - LEGACY_GAP - LEGACY_WIDTH

console.log('reported frame')
const reported = place(REPORTED)
report.equal(legacyLeft(REPORTED.frameWidth), 984,
  'the old block started at x=984 on the reported 1400px frame')
report.ok(legacyLeft(REPORTED.frameWidth) > REPORTED.laneRight,
  'on the reported frame the old block happened to stay right of the boundary',
  `legacy left=${legacyLeft(REPORTED.frameWidth)} lane right=${REPORTED.laneRight}`)
// Widen the report by 20px while the conversation column loses 1px: the old
// width never moved, so it ends up on top of the text. This is the shape of the
// report; the absolute window size only decides how visible it is.
const NARROW = { frameWidth: 1380, laneRight: 980, railLeft: 1010, maxWidth: 340 }
report.ok(legacyLeft(NARROW.frameWidth) < NARROW.laneRight,
  'the old fixed 400px block does cross the boundary once the column narrows',
  `legacy left=${legacyLeft(NARROW.frameWidth)} lane right=${NARROW.laneRight}`)
report.ok(!place(NARROW).bleeds, 'the new layer does not cross it there either',
  JSON.stringify(place(NARROW)))
report.ok(!reported.bleeds, 'the new layer does not cross it', JSON.stringify(reported))
report.equal(reported.width, REPORTED.maxWidth, 'the new layer uses the configured cap when there is room')
report.ok(REPORTED.laneRight <= REPORTED.frameWidth - 8 - reported.width,
  'its left edge stays right of the conversation boundary',
  `left=${REPORTED.frameWidth - 8 - reported.width} lane right=${REPORTED.laneRight}`)

// ────────────────────────────────────────────────────────────────────────────
// the invariant, across frames and rail widths
// ────────────────────────────────────────────────────────────────────────────

console.log('\ninvariant: never crosses the boundary while there is room')
const frames = [1920, 1600, 1400, 1280, 1100, 1000, 900, 800]
const railWidths = [480, 400, 330, 280]
let checked = 0
for (const frameWidth of frames) {
  for (const railWidth of railWidths) {
    const railLeft = frameWidth - railWidth
    const laneRight = railLeft - 8
    const result = place({ frameWidth, laneRight, railLeft, maxWidth: 340 })
    checked++
    const legal = result.width >= 240 && result.width <= 340
    if (!legal) report.ok(false, `width out of range at ${frameWidth}/${railWidth}`, JSON.stringify(result))
    // The boundary may only be crossed when even the minimum width does not fit.
    const roomForMin = frameWidth - 8 - laneRight >= 240
    if (roomForMin && result.bleeds) {
      report.ok(false, `crossed the boundary with room to spare at ${frameWidth}/${railWidth}`, JSON.stringify(result))
    }
  }
}
report.ok(true, `checked ${checked} frame x rail combinations`)

console.log('\nstrips')
report.equal(place({ frameWidth: 1400, laneRight: 992, railLeft: null }).width, 340,
  'no right rail: the frame edge strip is wide enough for the cap')
report.equal(place({ frameWidth: 1400, laneRight: 992, railLeft: null }).bleeds, false,
  'no right rail: still right of the boundary')
const narrow = place({ frameWidth: 700, laneRight: 660, railLeft: 680 })
report.equal(narrow.width, 240, 'a 12px strip clamps to the minimum width, not below')
const clamped = place({ frameWidth: 900, laneRight: 200, railLeft: 500, maxWidth: 400 })
report.equal(clamped.width, 390, 'a 390px strip under a 400px cap yields 390px')
report.equal(clamped.avail, 390, 'the rail left edge, not the cap, is what limits it')
report.equal(clamped.capped, true, 'capped reports that the cap was not reachable')
report.equal(place({ frameWidth: 1400, laneRight: 992, railLeft: null }).capped, false,
  'not capped when the cap fits')

console.log('\nextremes')
report.equal(place({ frameWidth: 200, laneRight: 40, railLeft: null }).width, 240,
  'a 152px strip still returns the usable minimum')
report.equal(place({ frameWidth: 200, laneRight: 40, railLeft: null }).bleeds, true,
  'and it reports that it had to cross the boundary')
// A rail left of the conversation boundary is degenerate (it would be inside
// the column). The budget may only shrink, so the width clamps to the minimum.
const degenerate = place({ frameWidth: 1400, laneRight: 1200, railLeft: 1000 })
report.equal(degenerate.width, 240,
  'a rail whose left edge is left of the lane cannot widen the layer')
report.equal(degenerate.bleeds, true,
  'and that degenerate case is reported as crossing the boundary')

console.log('\nrobustness')
const immutable = { frameWidth: 1400, laneRight: 971, railLeft: 1000, maxWidth: 340 }
const before = JSON.stringify(immutable)
place(immutable)
report.equal(JSON.stringify(immutable), before, 'the input object is never mutated')
const twice = [place(REPORTED), place(REPORTED)]
report.equal(twice[0], twice[1], 'the function is pure (same input, same output)')
report.equal(place({ frameWidth: Number.NaN, laneRight: Number.NaN }).width, 240,
  'non-finite measurements degrade to the minimum width, never to NaN')
report.equal(place({ frameWidth: 1400, laneRight: 992, railLeft: null, maxWidth: Number.NaN }).width, 340,
  'a non-finite cap falls back to the documented default')
report.equal(place({ frameWidth: 1400, laneRight: 700, railLeft: null, maxWidth: 9999 }).width, 560,
  'an absurd cap is clamped to the hard limit')
report.equal(place({ frameWidth: 1400, laneRight: 700, railLeft: null, maxWidth: 9999 }).capped, false,
  'hitting the hard cap is not "capped" (capped means the budget was the limit)')
report.equal(place({ frameWidth: 1400, laneRight: 992, railLeft: null, maxWidth: 10 }).width, 240,
  'an absurd cap never goes below the usable minimum')
report.equal(place({ frameWidth: 1400, laneRight: 971, maxWidth: 340 }).avail, 421,
  'avail is the raw budget (frame - gap - lane right), before the cap')
report.equal(place(REPORTED).avail, 390,
  'a right rail narrows the budget to its own left edge')
report.equal(place({ frameWidth: 1400, laneRight: 400, railLeft: 1200 }).avail, 240,
  'the budget never goes below the usable minimum, even with a huge rail')

// ────────────────────────────────────────────────────────────────────────────
// the dock: the card fills the right rail instead of hovering over it (1.8.3)
// ────────────────────────────────────────────────────────────────────────────

console.log('\nrail dock')
const dock = pure.railDock

const RAIL = { railLeft: 1000, railTop: 64, railWidth: 380, railHeight: 800 }
const docked = dock({ ...RAIL, frameWidth: 1400, frameHeight: 900 })
report.equal(docked.left, 1000, 'the dock starts at the rail\'s left edge')
report.equal(docked.top, 64, 'the dock starts at the rail\'s top edge')
report.equal(docked.width, 380, 'the dock is exactly as wide as the rail')
report.equal(docked.height, 800, 'the dock is exactly as tall as the rail')
report.equal(docked.clipped, false, 'a rail that fits the frame is not clipped')

report.equal(dock({ ...RAIL, enabled: false }), null,
  'the dock is off when the setting is off')
report.equal(dock({ ...RAIL, railLeft: Number.NaN }), null,
  'an unmeasurable rail falls back to the floating card')
report.equal(dock({ ...RAIL, railWidth: 279, railHeight: 800 }), null,
  'a rail too narrow to read the card in is refused')
report.equal(dock({ ...RAIL, railWidth: 380, railHeight: 239 }), null,
  'a rail too short to read the card in is refused')
report.equal(dock({ ...RAIL, railWidth: 280, railHeight: 240 }).width, 280,
  'the minimum accepted rail is used as-is')

// A rail dragged past the frame edge must be clipped, not trusted: the dock owns
// the page, so an over-hanging rectangle would put the card's header off-screen.
const overhang = dock({ railLeft: 1100, railTop: 40, railWidth: 380, railHeight: 800, frameWidth: 1400, frameHeight: 900 })
report.equal(overhang.left, 1100, 'a rail that starts inside the frame keeps its left edge')
report.equal(overhang.width, 300, 'the dock is clipped to the frame, never wider')
report.equal(overhang.clipped, true, 'clipping is reported so the UI can explain it')
report.equal(dock({ railLeft: 1300, railTop: 40, railWidth: 400, railHeight: 800, frameWidth: 1400, frameHeight: 900 }), null,
  'a rail clipped below the minimum width is refused instead of painting a sliver')

// Negative origins can happen while a panel animates in; clamping keeps the
// rectangle inside the viewport instead of letting it escape upward.
const animated = dock({ railLeft: -20, railTop: -30, railWidth: 380, railHeight: 800, frameWidth: 1400, frameHeight: 900 })
report.equal(animated.left, 0, 'a rail still sliding in is clamped to the frame')
report.equal(animated.top, 0, 'a rail still sliding in is clamped to the top edge')
report.equal(animated.clipped, true, 'the clamp is reported')

// Frame size is optional: without it the rail's own rectangle is the reference.
const noFrame = dock({ railLeft: 1000, railTop: 64, railWidth: 380, railHeight: 800 })
report.equal(noFrame.width, 380, 'the frame size is optional')
report.equal(noFrame.clipped, false, 'without a frame there is nothing to clip against')

// Purity: the caller's measurement object must survive untouched.
const measured = { ...RAIL, frameWidth: 1400, frameHeight: 900 }
const measuredBefore = JSON.stringify(measured)
dock(measured)
report.equal(JSON.stringify(measured), measuredBefore, 'the measurement object is not mutated')

// ────────────────────────────────────────────────────────────────────────────
// the shipped defaults: A defaults to the capsule
// ────────────────────────────────────────────────────────────────────────────

console.log('\ndefaults')
report.equal(pure.CLIENT_DEFAULTS.floatMode, 'capsule',
  'the floating layer defaults to the collapsed capsule (user requirement)')
report.equal(pure.CLIENT_DEFAULTS.floatMaxWidth, 340, 'default width cap is the tested 340px')
report.ok(pure.CLIENT_DEFAULTS.floatMaxWidth >= 240 && pure.CLIENT_DEFAULTS.floatMaxWidth <= 560,
  'the default cap is inside the host-accepted range')

// ────────────────────────────────────────────────────────────────────────────
// the layer must actually ship these hooks (a passing pure test is not enough)
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// vertical clearance (2.1.3): the capsule must not sit on the composer
//
// Live report 2026-10-25 (screenshot): the capsule covered the chat input box.
// The layer is already flush with the frame's right edge, so the only way it can
// retreat is to shrink AND to move up off the composer. `floatBottom` owns the
// second half; `floatPlacement` still owns the first.
// ────────────────────────────────────────────────────────────────────────────

console.log('\ncomposer clearance')
const bottom = pure.floatBottom
report.ok(typeof bottom === 'function', 'floatBottom is exported for the tests')
// A 900px frame whose composer card starts 140px above the bottom edge.
report.equal(bottom({ frameHeight: 900, composerTop: 760 }), 148,
  'the layer clears the composer by the 8px gap')
report.equal(bottom({ frameHeight: 900, composerTop: null }), 16,
  'with no composer in the DOM the layer keeps the old 16px anchor')
report.equal(bottom({}), 16, 'an empty frame measurement falls back instead of throwing')
report.equal(bottom({ frameHeight: 0, composerTop: 100 }), 16,
  'a zero-height frame is treated as unmeasured')
// The empty-session composer is vertically centred; lifting to it would park the
// pill in the middle of the screen, which is why the upper half is rejected.
report.equal(bottom({ frameHeight: 900, composerTop: 300 }), 16,
  'a centred (hero) composer is not treated as a bottom bar')
// 600 - 320 + 8 = 288, clamped to the 240px ceiling.
report.equal(bottom({ frameHeight: 600, composerTop: 320 }), 240,
  'a very tall composer cannot push the layer over the conversation')
report.equal(bottom({ frameHeight: 900, composerTop: 895 }), 16,
  'a composer flush with the bottom edge never lifts the layer above the fallback')
report.equal(bottom({ frameHeight: 900, composerTop: 760, fallback: 300 }), 300,
  'the fallback raises the floor: the layer never sits below it')
report.equal(bottom({ frameHeight: 600, composerTop: 320, limit: 100 }), 100,
  'the ceiling is a parameter too')

console.log('\nsource hooks')
const { readFileSync } = await import('node:fs')
const { CLIENT_ENTRY } = await import('./harness.mjs')
const source = readFileSync(CLIENT_ENTRY, 'utf8')
report.ok(/data-dsa-float-mode/.test(source), 'the layer exposes its mode for diagnostics')
// The card's controls go through its props (the layer passes `setFloatMode` and
// `actions.deleteCard`), so assert the call sites rather than a function name.
// 2.0.0: the header's × stopped being a "hide the layer" toggle and became the
// delete action, and the `off` shape went with it — pin both halves so a future
// edit cannot quietly reintroduce the launcher or drop the delete wiring.
report.ok(/floatControl\(\s*'capsule'/.test(source), 'the card offers the collapse control')
report.ok(!/floatControl\(\s*'off'/.test(source), 'the card no longer offers a hide-the-layer control')
report.ok(!/\bdsa-launcher\b/.test(source) && !/\bfloatRestore\b/.test(source),
  'the hidden-layer launcher is gone from the stylesheet and the dictionary')
// 2.1.0: the handlers moved into a per-card bundle (stable identity so
// `React.memo` can skip untouched cards), and the bundle reads the card through
// a ref at call time. Assert the wiring survives the move: × still reaches
// `actions.deleteCard`, and the layer still hands the bundle to the card.
report.ok(/onDelete:\s*\(\)\s*=>\s*actions\.deleteCard\((?:card|current\(\))\)/.test(source),
  'the floating layer wires the card × to the delete action')
report.ok(/\.\.\.handlersFor\(card\)/.test(source) && /useCardHandlers\(actions\)/.test(source),
  'the floating layer hands every card one stable handler bundle')
report.ok(/['"]off['"]/.test(source) === false || !/mode === 'off'/.test(source),
  'no render branch reacts to the retired `off` shape')
report.ok(/--dsa-float-w/.test(source), 'the width is a CSS variable, not a hardcoded 400px')
// `[^}]` (not `.`) on purpose: CSS rules wrap across lines in the stylesheet.
report.ok(!/\.dsa-stack\{[^}]*position:\s*fixed/.test(source) && !/\.dsa-stack\{[^}]*width:\s*min\(400px/.test(source),
  'the old fixed-position 400px stack is gone')
report.ok(/\.dsa-float\{[^}]*right:var\(--dsa-gap-right/.test(source), 'the layer is anchored to the right edge')
report.ok(/floatMode:\s*'capsule'/.test(source), 'the client mirror advertises the capsule default')
// 2.1.3 (2026-10-25 live report): the capsule covered the chat input box. Pin
// both halves of the fix — a variable vertical anchor that is measured from the
// composer, and a pill that sizes to its own content.
report.ok(/--dsa-gap-bottom/.test(source), 'the vertical anchor is a CSS variable, not a hardcoded 16px')
report.ok(/bottom:var\(--dsa-gap-bottom/.test(source),
  'the layer anchors above the composer instead of on top of it')
report.ok(/\[data-composer-card\]/.test(source),
  'the composer is located through its published DOM marker')
report.ok(/floatBottom\(/.test(source), 'the layer calls the pure floatBottom helper')
report.ok(/\.dsa-float\[data-dsa-float-mode="capsule"\]\{[^}]*width:auto/.test(source),
  'capsule mode sizes to its content instead of the full layer width')
report.ok(/\.dsa-capsule\{[^}]*width:auto/.test(source), 'the pill itself is content-sized')

// The dock is a DOM-measured presentation: no published API exposes the rail's
// rectangle, so the shipped code has to look the rail up by selector and hand the
// measurement to the pure function. Assert both halves are actually wired.
report.ok(/data-dsa-float-mode="dock"/.test(source) || /'dock'/.test(source),
  'the layer has a dock presentation')
report.ok(/railDock\(/.test(source), 'the layer calls the pure railDock helper')
report.ok(/\.dsa-float\[data-dsa-float-mode="dock"\]\{[^}]*right:auto/.test(source),
  'the docked layer releases the right/bottom anchor it inherits')
report.ok(/\[data-dsa-float-mode="dock"\]\s*\.dsa-card\{[^}]*height:100%/.test(source),
  'the docked card fills its page instead of scrolling inside it')
report.ok(/dockRail:\s*true/.test(source), 'the client mirror ships the dock enabled by default')
report.ok(/RAIL_SELECTOR/.test(source), 'the rail lookup lives in one named place')

// 1.8.3 live-report regression (2026-10-18, screenshot): a card stayed floating
// while the rail was open, because (a) the layer cleaned up a variable that no
// longer existed (`rail`) and (b) nothing re-measured when the rail opened. Both
// are pinned here: the anchor ladder must start with our own rail-hosted node,
// the effect must re-run on DOM changes, and the stale identifier must stay gone.
report.ok(/'\[data-dsa-rail-host\]'/.test(source),
  'the dock anchors on the plugin own rail-hosted node first')
const railAnchorAt = source.indexOf("'[data-dsa-rail-host]'")
// 2.1.2 dropped the pre-rail `.rightbar` class: no build in the supported
// range renders it, so the ladder now ends with the `sidebar.right` slot
// subtree instead of a dead spelling.
const slotAt = source.indexOf('\'[data-slot^="sidebar.right"]\'', railAnchorAt)
report.ok(railAnchorAt > -1 && slotAt > railAnchorAt,
  'the plugin anchor is tried before the slot-subtree fallback')
report.ok(!/'\.rightbar'/.test(source),
  'the dead .rightbar spelling is gone from the anchor ladder')
report.ok(/data-dsa-rail-host/.test(source), 'the in-rail card host is marked for measuring')
report.ok(/MutationObserver/.test(source),
  'opening the rail re-measures (DOM mutation, not just window resize)')
report.ok(/attributeFilter:/.test(source),
  'the mutation observer is limited to attributes so streaming does not re-measure every frame')
report.ok(/dataDock|dsaDock/.test(source),
  'the layer records WHY it is docked (dock / no-rail / rail-too-small / off / mode)')
report.ok(/railOnScreen\(/.test(source),
  'a collapsed (off-frame) rail is rejected instead of being clamped into view')
report.ok(!/observed\.has\(rail\)/.test(source) && !/\brail !== null && !observed/.test(source),
  'the stale `rail` identifier from the first dock attempt is gone')

// The carrier preference is an ORDER, not a boolean, so a behavioural assertion
// alone cannot catch a future re-ordering: the automatic ladder itself is pinned.
// A card re-hosted as a rail tab is a tab the plugin does not own, so `auto`
// must never reach the rail on its own.
const autoOrderAt = source.indexOf('const autoOrder = [')
const autoOrder = autoOrderAt === -1 ? '' : source.slice(autoOrderAt, source.indexOf(']', autoOrderAt))
report.ok(/surfaces\.better/.test(autoOrder), 'auto tries the side-card plugin first')
report.ok(/surfaces\.better[\s\S]*surfaces\.flow/.test(autoOrder), 'the built-in card is the second choice')
report.ok(!/surfaces\.native/.test(autoOrder), 'the right rail is not part of the automatic chain')
report.ok(/const all = \[surfaces\.native, surfaces\.better, surfaces\.flow\]/.test(source),
  'the rail stays reachable when the user names it')
const surfaceSelectAt = source.indexOf("select('sideSurface'")
const surfaceSelect = surfaceSelectAt === -1 ? '' : source.slice(surfaceSelectAt, surfaceSelectAt + 420)
const optionOrder = ['auto', 'better-sidebar', 'flow', 'native-rightbar'].map(key => surfaceSelect.indexOf(`'${key}'`))
report.ok(optionOrder.every(index => index > -1)
  && optionOrder.every((index, position) => position === 0 || index > optionOrder[position - 1]),
  'the settings options are listed in the same preference order')
report.ok(/surfaceNativeForce/.test(surfaceSelect),
  'the rail option says it is forced and outside `auto`')

report.summary()
