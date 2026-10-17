/**
 * composer-probe.mjs — P2-2 technical probe (NOT part of the shipped package).
 *
 * Answers three questions against a REAL running DSH page (headless Edge):
 *   ① what the composer's DOM actually is (textarea / contenteditable / custom)
 *   ② whether an official write surface exists (inputActions.setDraft,
 *      sessions.using(...).binding.session.*, conversation.input.for)
 *   ③ whether a native value setter + an `input` event makes React state move
 *
 * Usage (needs `playwright-core` + an installed Edge):
 *   node .compat-report/scripts/composer-probe.mjs [url]
 *
 * It writes a JSON summary to stdout and never mutates the page's session
 * (the typing step is only performed when `--type` is passed explicitly).
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(join(process.env.TEMP, 'dsa-p2-probe', 'package.json'))
const { chromium } = require('playwright-core')

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8080/'
const ALLOW_TYPE = process.argv.includes('--type')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const consoleErrors = []
page.on('pageerror', error => consoleErrors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(6000)

const summary = await page.evaluate(() => {
  const our = '[data-dsa-root]'
  const describe = (el) => {
    if (el === null || el === undefined) return null
    const style = getComputedStyle(el)
    return {
      tag: el.tagName,
      className: String(el.className ?? '').slice(0, 120),
      contentEditable: el.getAttribute('contenteditable'),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder'),
      visible: style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null,
      rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } })(),
      dataSlots: (() => {
        const out = []
        let node = el
        while (node !== null && out.length < 6) {
          const slot = node.getAttribute?.('data-slot')
          if (slot) out.push(slot)
          node = node.parentElement
        }
        return out
      })(),
    }
  }
  const editable = [...document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"],[role="textbox"]')]
    .filter(el => !el.closest(our))
  const candidates = editable.map(el => describe(el))
  // The composer is the editable closest to the bottom of the viewport.
  const sorted = editable
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => b.r.top - a.r.top)
  const best = sorted[0]?.el ?? null
  const deepest = best === null ? null : (() => {
    // Report the innermost element that actually holds the editable text.
    const inner = best.querySelector('[contenteditable=""],[contenteditable="true"]')
    return describe(inner ?? best)
  })()
  return {
    url: location.href,
    title: document.title,
    editableCount: editable.length,
    candidates,
    composerGuess: deepest,
    composerOuterHTML: best === null ? null : String(best.outerHTML).slice(0, 800),
    hasProseMirror: document.querySelector('.ProseMirror') !== null,
    hasLexical: document.querySelector('[data-lexical-editor="true"]') !== null,
    hasSlate: document.querySelector('[data-slate-editor="true"]') !== null,
    hasDraftJs: document.querySelector('.DraftEditor-root') !== null,
    bodyTextSample: String(document.body.innerText ?? '').slice(0, 300),
  }
})

// ── ③ which write path actually moves the editor's own state? ─────────────
// Three candidate rungs, tried in order on the REAL composer:
//   a) native value setter + `input`  (only meaningful for input/textarea)
//   b) `document.execCommand('insertText')` after focusing + placing a caret
//   c) a synthetic `beforeinput` InputEvent with inputType 'insertText'
// Evidence that state moved = the composer's own text PLUS the send control
// turning enabled (a pure DOM write leaves the send button disabled).
let writeProbe = null
if (ALLOW_TYPE) {
  writeProbe = await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const composer = () => document.querySelector('[data-composer-input], [data-lexical-editor="true"], textarea')
    const sendState = () => {
      const buttons = [...document.querySelectorAll('button')]
      const send = buttons.find((button) => {
        const label = `${button.getAttribute('aria-label') ?? ''}${button.title ?? ''}${button.textContent ?? ''}`
        return /发送|Send/i.test(label)
      })
      return send === undefined ? null : {
        disabled: send.disabled === true || send.getAttribute('aria-disabled') === 'true',
        label: (send.getAttribute('aria-label') ?? send.textContent ?? '').trim().slice(0, 20),
      }
    }
    const state = () => {
      const el = composer()
      return {
        tag: el?.tagName ?? null,
        text: el === null ? null : (el.tagName === 'TEXTAREA' ? el.value : el.innerText),
        send: sendState(),
      }
    }
    const before = state()
    const results = {}
    const el = composer()
    if (el === null) return { ok: false, reason: 'no composer', before }

    // a) native setter — expected to FAIL for a contenteditable (reports why)
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
      if (setter) {
        setter.call(el, 'PROBE-NATIVE')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(250)
        results.nativeSetter = state()
        setter.call(el, '')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(150)
      }
    } else {
      results.nativeSetter = { skipped: 'composer is not a textarea (contenteditable: no value setter applies)' }
    }

    // b) execCommand insertText after a real caret
    const marker = `PROBE-EXEC-${Date.now()}`
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    results.execCommand = { supported: typeof document.execCommand === 'function' }
    let inserted = false
    try { inserted = document.execCommand('insertText', false, marker) } catch (error) { results.execCommand.threw = String(error) }
    await sleep(350)
    results.execCommand.result = inserted
    results.execCommand.after = state()
    results.execCommand.stateMoved = (results.execCommand.after.text ?? '').includes(marker)
    results.execCommand.sendEnabled = results.execCommand.after.send?.disabled === false

    // Clean the draft again (select-all + delete keeps the editor model sane).
    el.focus()
    const clean = document.createRange()
    clean.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(clean)
    try { document.execCommand('delete') } catch { /* best effort */ }
    await sleep(200)
    results.afterCleanup = state()

    // c) synthetic beforeinput (only if b failed to move state)
    if (results.execCommand.stateMoved !== true) {
      const marker2 = `PROBE-BEFORE-${Date.now()}`
      el.focus()
      const range2 = document.createRange()
      range2.selectNodeContents(el)
      range2.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range2)
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: marker2,
      })
      let notCancelled = true
      try { notCancelled = el.dispatchEvent(event) } catch (error) { results.beforeInput = { threw: String(error) } }
      await sleep(300)
      results.beforeInput = { ...(results.beforeInput ?? {}), notCancelled, after: state() }
      results.beforeInput.stateMoved = (results.beforeInput.after.text ?? '').includes(marker2)
      el.focus()
      const clean2 = document.createRange()
      clean2.selectNodeContents(el)
      selection.removeAllRanges()
      selection.addRange(clean2)
      try { document.execCommand('delete') } catch { /* best effort */ }
      await sleep(150)
    }
    return { ok: true, before, results }
  })
}

// ── ④ CSS Custom Highlight API (P2-3's preferred paint path) ──────────────
// Read-only check: does this Edge build expose CSS.highlights + Highlight, and
// does a page-wide highlight survive a read-back? No DOM mutation is involved.
const highlightProbe = await page.evaluate(() => {
  const supported = typeof CSS !== 'undefined'
    && CSS.highlights !== undefined
    && typeof Highlight === 'function'
  if (!supported) return { supported: false }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
  let node = walker.nextNode()
  while (node !== null && String(node.nodeValue ?? '').trim().length < 8) node = walker.nextNode()
  if (node === null) return { supported: true, range: false }
  const range = document.createRange()
  range.setStart(node, 0)
  range.setEnd(node, Math.min(5, String(node.nodeValue).length))
  CSS.highlights.set('dsa-probe', new Highlight(range))
  const size = CSS.highlights.size
  CSS.highlights.delete('dsa-probe')
  return {
    supported: true,
    range: true,
    registered: size,
    cleared: CSS.highlights.size,
    sample: String(node.nodeValue).slice(0, 12),
  }
})

console.log(JSON.stringify({ ...summary, writeProbe, highlightProbe, consoleErrors: consoleErrors.slice(0, 8) }, null, 2))
await browser.close()
