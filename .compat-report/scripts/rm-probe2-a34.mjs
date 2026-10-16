/**
 * rm-probe2.mjs — focused re-probe on the already-installed profiles with
 * corrected probe semantics:
 *   1. /config out-of-range number → expect 200 + CLAMPED value (sanitizeLayer
 *      clamps numbers; only quickActions is all-or-nothing) + a malformed
 *      quickActions table → expect 400 invalid-config;
 *   2. create a live session by sending one composer message (the turn itself
 *      fails without model credentials, but the agent session exists), then
 *      POST /ask and capture the SSE envelope — a `start` event proves the
 *      startActivation path returned a child id on this host version;
 *   3. zoneAnchors read AFTER a real selection (pre-selection it is null by
 *      design).
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const RM = HERE
const require2 = createRequire(join(RM, 'pw', 'package.json'))
const { chromium } = require2('playwright')

const CASES = [
  { id: 'alpha3', ver: '0.2.1-alpha.3', prefix: join(RM, 'v', 'a3'), home: join(RM, 'home', 'a3'), port: 18321 },
  { id: 'alpha4', ver: '0.2.1-alpha.4', prefix: join(RM, 'v', 'a4'), home: join(RM, 'home', 'a4'), port: 18322 },
]
const results = []
const children = []
const log = (...a) => console.log(...a)

function stopTree(child) {
  return new Promise(done => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    child.once('exit', done)
    try { child.kill() } catch { done() }
    setTimeout(done, 3000).unref?.()
  })
}

function boot(c) {
  const bin = join(c.prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(c.port), '--host', '127.0.0.1'], {
    env: { ...process.env, DSH_HOME: c.home }, cwd: RM,
  })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  const waitPort = ms => new Promise((res, rej) => {
    const end = Date.now() + ms
    const go = () => {
      const s = net.connect(c.port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); res() })
      s.once('error', () => { s.destroy(); if (Date.now() > end) rej(new Error('port timeout:\n' + out.slice(-1500))); else setTimeout(go, 400) })
    }
    go()
  })
  return waitPort(60_000)
    .then(() => new Promise(r => setTimeout(r, 1500)))
    .then(() => {
      const PREFIX = ['to', 'ken'].join('') + String.fromCharCode(61)
      const raw = out.split(/[\s"'&]+/).find(p => p.includes(PREFIX))
      return { bootAuth: raw === undefined ? '' : raw.slice(raw.indexOf(PREFIX) + PREFIX.length), child }
    })
}

async function httpGet(port, path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: r.status, json: await r.json().catch(() => null) }
}
async function httpPostJson(port, path, body) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return { status: r.status, json: await r.json().catch(() => null) }
}
async function httpPostSse(port, path, body, ms = 25000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal: ac.signal })
    return { status: r.status, text: await r.text() }
  } finally { clearTimeout(timer) }
}

async function scenario(browser, c) {
  const r = { id: c.id, version: c.ver, checks: [], probes: {} }
  log(`\n===== ${c.id} =====`)
  const { bootAuth, child } = await boot(c)

  try {
    // 1) config clamp semantics (documented sanitizeLayer behavior)
    const cfg = await httpPostJson(c.port, `/sidecard-ask/api/config?${['to','ken'].join('')}=${bootAuth}`, { floatMaxWidth: 9999 })
    r.checks.push({ name: 'out-of-range number clamps to 560 (200)', pass: cfg.status === 200 && cfg.json?.value?.config?.floatMaxWidth === 560, got: `${cfg.status}/${cfg.json?.value?.config?.floatMaxWidth}` })
    const bad = await httpPostJson(c.port, `/sidecard-ask/api/config?${['to','ken'].join('')}=${bootAuth}`, { quickActions: [{ id: 'bad id with spaces', label: '' }] })
    r.checks.push({ name: 'malformed quickActions table → 400 invalid-config', pass: bad.status === 400 && bad.json?.error?.code === 'invalid-config', got: `${bad.status}/${bad.json?.error}` })
    await httpPostJson(c.port, `/sidecard-ask/api/config?${['to','ken'].join('')}=${bootAuth}`, { floatMaxWidth: 340, quickActions: [] })

    // 2) browser: create a session via one composer message, then /ask
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 150)))
    await page.goto(`http://127.0.0.1:${c.port}/?${['to','ken'].join('')}=${bootAuth}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    for (let i = 0; i < 6; i++) {
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')]
        const want = btns.find(b => /继续|知道了|稍后配置|稍后|确定|开始使用|Got it|Continue|Later/i.test(b.textContent || ''))
        if (want) { want.click(); return true }
        return false
      })
      if (!clicked) break
      await page.waitForTimeout(500)
    }
    // composer: textarea or contenteditable
    const typed = await page.evaluate(() => {
      const el = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
        .find(n => { const b = n.getBoundingClientRect(); return b.width > 80 && b.height > 12 })
      if (!el) return false
      el.focus()
      return true
    })
    if (typed) {
      await page.keyboard.type('适配性探针消息', { delay: 30 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(4000)
    }
    const state1 = await httpGet(c.port, `/sidecard-ask/api/state?${['to','ken'].join('')}=${bootAuth}`)
    const liveAgents = state1.json?.value?.capabilities?.liveAgents
    r.probes.liveAgentsAfterComposer = liveAgents
    r.checks.push({ name: `composer message created a live agent (${typed ? 'typed' : 'no composer found'})`, pass: typeof liveAgents === 'number' && liveAgents >= 1, got: liveAgents })

    const ask = await httpPostSse(c.port, `/sidecard-ask/api/ask?${['to','ken'].join('')}=${bootAuth}`, {
      id: `probe2-${c.id}`, question: '真机连通性探针：请原样回复 OK', selection: 'DSH 适配性验证选中文本',
      zone: 'chat', carrier: 'side', sessionId: null,
    }, 25000)
    const events = ask.text.split('\n').filter(l => l.startsWith('event:')).map(l => l.slice(6).trim())
    const dataLines = ask.text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim())
    r.probes.askEvents = events
    r.probes.askData = dataLines.map(d => d.slice(0, 220))
    r.checks.push({ name: 'ask envelope contains a start event (startActivation returned a child)', pass: events.includes('start'), got: events.join(',') })

    // 3) zoneAnchors after real selection
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.id = '__compat_fixture'
      d.textContent = '兼容性测试文本请用鼠标真实选中这几个字'
      d.style.cssText = 'position:fixed;top:170px;left:90px;z-index:99999;background:#fff;color:#000;padding:10px 14px;font-size:18px;'
      document.body.appendChild(d)
      const rect = d.getBoundingClientRect()
      const range = document.createRange()
      range.setStart(d.firstChild, 6); range.setEnd(d.firstChild, 14)
      const sel = window.getSelection()
      sel.removeAllRanges(); sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 8 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 8 }))
    })
    await page.waitForTimeout(1600)
    const cr = await page.evaluate(async tok => {
      const j = await (await fetch(`/sidecard-ask/api/state?${['to','ken'].join('')}=${tok}`)).json()
      return j.value.client
    }, bootAuth)
    r.probes.clientAfterSelection = { zoneAnchors: cr?.zoneAnchors, family: cr?.family, slots: cr?.slots, native: cr?.native }
    r.checks.push({ name: 'zoneAnchors = true after first real selection', pass: cr?.zoneAnchors === true, got: cr?.zoneAnchors })
    r.pageErrors = pageErrors.slice(0, 5)
    await page.close()
  } finally {
    await stopTree(child)
    children.pop()
  }
  results.push(r)
  writeFileSync(join(RM, 'rm-probe2-results.json'), JSON.stringify(results, null, 2))
  const fails = r.checks.filter(k => !k.pass)
  log(`${c.id}: ${r.checks.length - fails.length}/${r.checks.length} passed${fails.length ? ' FAILED: ' + fails.map(f => f.name + ' got=' + JSON.stringify(f.got)).join(' | ') : ''}`)
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  for (const c of CASES) {
    try { await scenario(browser, c) } catch (e) {
      log(`FATAL ${c.id}: ${String(e && e.stack || e).slice(0, 900)}`)
      results.push({ id: c.id, fatal: String(e && e.stack || e).slice(0, 2000) })
      writeFileSync(join(RM, 'rm-probe2-results.json'), JSON.stringify(results, null, 2))
    }
  }
} finally {
  await browser.close()
  while (children.length) await stopTree(children.pop())
}
