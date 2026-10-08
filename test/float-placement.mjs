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

console.log('\nsource hooks')
const { readFileSync } = await import('node:fs')
const { CLIENT_ENTRY } = await import('./harness.mjs')
const source = readFileSync(CLIENT_ENTRY, 'utf8')
report.ok(/data-dsa-float-mode/.test(source), 'the layer exposes its mode for diagnostics')
// The card's controls go through its `onFloatMode` prop (the layer passes
// `setFloatMode`), so assert the call sites rather than a function name.
report.ok(/floatControl\(\s*'capsule'/.test(source) && /floatControl\(\s*'off'/.test(source),
  'the card offers collapse/hide controls')
report.ok(/--dsa-float-w/.test(source), 'the width is a CSS variable, not a hardcoded 400px')
// `[^}]` (not `.`) on purpose: CSS rules wrap across lines in the stylesheet.
report.ok(!/\.dsa-stack\{[^}]*position:\s*fixed/.test(source) && !/\.dsa-stack\{[^}]*width:\s*min\(400px/.test(source),
  'the old fixed-position 400px stack is gone')
report.ok(/\.dsa-float\{[^}]*right:var\(--dsa-gap-right/.test(source), 'the layer is anchored to the right edge')
report.ok(/floatMode:\s*'capsule'/.test(source), 'the client mirror advertises the capsule default')

report.summary()
