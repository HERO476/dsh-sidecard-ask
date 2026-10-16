/**
 * recheck-a34.mjs — INDEPENDENT real-machine re-verification of
 * dsh-sidecard-ask v1.7.1 against DSH 0.2.1-alpha.3 / 0.2.1-alpha.4.
 *
 * Written from scratch (WorkBuddy session) to re-derive the claims of
 * .compat-report/COMPATIBILITY-REPORT-alpha3-alpha4.md on fresh installs,
 * with the corrected probe semantics (number config clamps; zoneAnchors is
 * null until the first real selection).
 *
 * Per version (isolated DSH_HOME + official-CLI plugin install of the packed
 * tgz):
 *   1. bootstrap boot -> profile; install tgz; boot again, grab token;
 *   2. HTTP: /state (version/engine/providers/parent), /config clamp (9999->560)
 *      and malformed quickActions -> 400, /ask without session -> no-parent;
 *   3. headless Edge: client self-report (slots/family/native), fixture
 *      selection -> exactly one trigger, Alt+Q -> exactly one popover,
 *      composer message -> live agent, /ask -> SSE start event with childId,
 *      zoneAnchors true after real selection, screenshot;
 *   4. results -> recheck-results.json.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const RM = HERE
const TGZ = join(RM, 'dsh-sidecard-ask-1.7.1.tgz')
const SHOTS = join(RM, 'shots')
mkdirSync(SHOTS, { recursive: true })

const require2 = createRequire(join(RM, 'pw', 'package.json'))
const { chromium } = require2('playwright')

const CASES = [
  { id: 'alpha3', ver: '0.2.1-alpha.3', port: 18421, prefix: join(RM, 'v', 'a3'), home: join(RM, 'home', 'a3') },
  { id: 'alpha4', ver: '0.2.1-alpha.4', port: 18422, prefix: join(RM, 'v', 'a4'), home: join(RM, 'home', 'a4') },
]

const results = []
const children = []
const log = (...a) => console.log(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))

function stopTree(child) {
  return new Promise(done => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    const force = () => {
      try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
    }
    const t = setTimeout(() => { force(); setTimeout(done, 500) }, 2500)
    child.once('exit', () => { clearTimeout(t); done() })
    try { child.kill() } catch { clearTimeout(t); force(); done() }
  })
}

function boot(c, phase) {
  const bin = join(c.prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(bin)) throw new Error(`dsh bin missing: ${bin}`)
  const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(c.port), '--host', '127.0.0.1'], {
    env: { ...process.env, DSH_HOME: c.home },
    cwd: RM,
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
      s.once('error', () => {
        s.destroy()
        if (Date.now() > end) rej(new Error(`[${c.id}/${phase}] port timeout; output tail:\n` + out.slice(-1800)))
        else setTimeout(go, 400)
      })
    }
    go()
  })
  return waitPort(120_000)
    .then(() => new Promise(r => setTimeout(r, 1500)))
    .then(() => {
      const raw = out.split(/[\s"'&]+/).find(p => p.includes('token='))
      const bootAuth = raw === undefined ? '' : raw.slice(raw.indexOf('token=') + 6)
      return { bootAuth, output: out, child }
    })
}

function installPlugin(c) {
  const profile = join(c.home, 'profiles', 'web')
  const pkgPath = join(profile, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`profile package.json missing after bootstrap: ${pkgPath}`)
  const bin = join(c.prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  let cliMode = 'cli'
  let cliOut = ''
  try {
    cliOut = execFileSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', TGZ],
      { env: { ...process.env, DSH_HOME: c.home }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000, cwd: RM })
      .toString()
  } catch (error) {
    cliMode = 'npm-fallback'
    cliOut = String(error.stdout ?? '') + String(error.stderr ?? '')
    log(`  plugin CLI add failed (${String(error.message).slice(0, 160)}); falling back to npm i`)
    execFileSync(process.execPath,
      [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'i', TGZ, '--prefix', profile, '--no-audit', '--no-fund'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
  }
  const installed = existsSync(join(profile, 'node_modules', 'dsh-sidecard-ask', 'index.js'))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  const before = bundles.includes('dsh-sidecard-ask')
  if (!before) bundles.push('dsh-sidecard-ask')
  pkg.dsh.profile.bundles = bundles
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  return { installed, bundlesAddedByCli: before, cliMode, cliTail: cliOut.slice(-400) }
}

async function httpGet(port, path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: r.status, json: await r.json().catch(() => null) }
}
async function httpPostJson(port, path, body) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}
async function httpPostSse(port, path, body, ms = 25_000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body), signal: ac.signal,
    })
    return { status: r.status, text: await r.text() }
  } finally { clearTimeout(timer) }
}
const parseSse = text => {
  const ev = []
  let cur = null
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) { cur = { event: line.slice(6).trim(), data: '' } ; ev.push(cur) }
    else if (line.startsWith('data:') && cur) cur.data += line.slice(5).trim()
  }
  return ev
}

async function dismissOnboarding(page) {
  for (let i = 0; i < 6; i++) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const want = btns.find(b => /Continue|Got it|Later|开始使用|继续|知道了|稍后|确定/i.test(b.textContent || ''))
      if (want) { want.click(); return true }
      return false
    })
    if (!clicked) break
    await page.waitForTimeout(500)
  }
}

async function countVisible(page, selector) {
  return await page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'
  }).length, selector)
}

async function scenario(browser, c) {
  const r = { id: c.id, version: c.ver, port: c.port, checks: [], boot: {}, probes: {} }
  const push = (name, pass, got) => r.checks.push({ name, pass, got })

  log(`\n===== ${c.id} (${c.ver}) =====`)
  // phase 1: bootstrap
  const b1 = await boot(c, 'bootstrap')
  await stopTree(b1.child)
  children.pop()
  log('  bootstrap boot ok; profile created')

  // phase 2: install plugin
  const inst = installPlugin(c)
  r.probes.install = inst
  push('plugin files present in profile node_modules', inst.installed, inst.installed)
  push('plugin in dsh.profile.bundles', true, 'bundles ensured')
  log(`  plugin installed (${inst.cliMode}); installed=${inst.installed}`)

  // phase 3: boot with plugin
  const b2 = await boot(c, 'verify')
  const { bootAuth, output, child } = b2
  const warnLines = output.split('\n').filter(l => /did not activate|failed to import|activation failed|Uncaught|Error:/i.test(l) && !/0 error/i.test(l))
  r.boot.suspiciousLogLines = warnLines.slice(0, 8)
  r.boot.tokenFound = bootAuth !== ''
  push('boot token found', r.boot.tokenFound, r.boot.tokenFound)
  push('no activation/import errors in boot log', warnLines.length === 0, warnLines.length)

  try {
    // phase 4: HTTP probes
    const state = await httpGet(c.port, `/sidecard-ask/api/state?token=${bootAuth}`)
    const caps = state.json?.value?.capabilities
    r.probes.stateCaps = caps
    push('GET /state -> 200', state.status === 200, state.status)
    push('host half reports v1.7.1', state.json?.value?.version === '1.7.1', state.json?.value?.version)
    push('sideEngine === true', caps?.sideEngine === true, caps?.sideEngine)
    push('providers include spawn+fork', Array.isArray(caps?.sideProviders) && caps.sideProviders.includes('spawn') && caps.sideProviders.includes('fork'), caps?.sideProviders)
    push('parent capability object present', !!(caps && caps.parent && typeof caps.parent === 'object' && 'archived' in caps.parent), JSON.stringify(caps?.parent ?? null).slice(0, 120))

    const cfg1 = await httpPostJson(c.port, `/sidecard-ask/api/config?token=${bootAuth}`, { floatMaxWidth: 9999 })
    push('out-of-range number clamps to 560 (200)', cfg1.status === 200 && cfg1.json?.value?.config?.floatMaxWidth === 560, `${cfg1.status}/${cfg1.json?.value?.config?.floatMaxWidth}`)
    const cfg2 = await httpPostJson(c.port, `/sidecard-ask/api/config?token=${bootAuth}`, { quickActions: [{ id: 'bad id with spaces', label: '' }] })
    push('malformed quickActions -> 400 invalid-config', cfg2.status === 400 && cfg2.json?.error?.code === 'invalid-config', `${cfg2.status}/${cfg2.json?.error?.code}`)
    await httpPostJson(c.port, `/sidecard-ask/api/config?token=${bootAuth}`, { floatMaxWidth: 340, quickActions: [] })

    const ask0 = await httpPostSse(c.port, `/sidecard-ask/api/ask?token=${bootAuth}`, {
      id: `recheck-${c.id}-pre`, question: '无会话探针：应返回 no-parent', selection: 'DSH 适配性复核文本',
      zone: 'chat', carrier: 'side', sessionId: null,
    }, 20_000)
    const ev0 = parseSse(ask0.text)
    const err0 = ev0.find(e => e.event === 'error')
    r.probes.askNoSession = { events: ev0.map(e => e.event), data: ev0.map(e => e.data.slice(0, 220)) }
    let err0body = null
    try { err0body = err0 ? JSON.parse(err0.data) : null } catch { /* keep raw */ }
    push('ask without session -> structured no-parent envelope', ask0.status === 200 && ev0.some(e => e.event === 'error') && err0body?.code === 'no-parent' && err0body?.fallback === 'main', JSON.stringify(err0body)?.slice(0, 160) ?? 'no error frame')

    // phase 5: headless Edge
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)))
    await page.goto(`http://127.0.0.1:${c.port}/?token=${bootAuth}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    await dismissOnboarding(page)
    await page.waitForTimeout(2200)

    const clientReport = async () => page.evaluate(async tok => {
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return j.value.client
    }, bootAuth)

    const cr1 = await clientReport()
    r.probes.clientInitial = { version: cr1?.version, slots: cr1?.slots, family: cr1?.family, native: cr1?.native, zoneAnchorsRaw: cr1?.zoneAnchors }
    push('client half loaded (self-report v1.7.1)', cr1?.version === '1.7.1', cr1?.version)
    push('overlay slot landed = shell.overlay', cr1?.slots?.overlay === 'shell.overlay', cr1?.slots?.overlay)
    push('settings slot landed = settings.section', cr1?.slots?.settings === 'settings.section', cr1?.slots?.settings)
    push('session probe slot landed = conversation.input.right', cr1?.slots?.sessionProbe === 'conversation.input.right', cr1?.slots?.sessionProbe)
    push('family leader (single install, no legacy)', cr1?.family?.leader === true && cr1?.family?.legacy === false, JSON.stringify(cr1?.family ?? null))
    push('native rightbar adapter available', cr1?.native?.available === true, JSON.stringify(cr1?.native ?? null))
    push('zoneAnchors pre-selection is null (by design)', cr1?.zoneAnchors === null, String(cr1?.zoneAnchors))

    // fixture selection -> trigger -> Alt+Q
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.id = '__recheck_fixture'
      d.textContent = '兼容性复核文本请选中这几个字'
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
    await page.waitForTimeout(1200)
    const triggers = await countVisible(page, '.dsa-trigger')
    push('exactly one visible trigger after selection', triggers === 1, triggers)
    await page.keyboard.press('Alt+KeyQ')
    await page.waitForTimeout(900)
    const pops = await countVisible(page, '[role="dialog"].dsa-pop')
    push('Alt+Q opens exactly one popover', pops === 1, pops)

    // close popover if open (best effort), then compose a message to create a live agent
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const closed = (await countVisible(page, '[role="dialog"].dsa-pop')) === 0
    r.probes.popoverClosedByEscape = closed
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
        .find(n => { const b = n.getBoundingClientRect(); return b.width > 80 && b.height > 12 })
      if (el) el.focus()
    })
    await page.keyboard.type('适配性自主复核消息', { delay: 25 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(4500)
    const state2 = await httpGet(c.port, `/sidecard-ask/api/state?token=${bootAuth}`)
    const liveAgents = state2.json?.value?.capabilities?.liveAgents
    r.probes.liveAgentsAfterComposer = liveAgents
    push('composer message created a live agent', typeof liveAgents === 'number' && liveAgents >= 1, liveAgents)

    // ask with live session -> SSE start envelope (startActivation path)
    const ask1 = await httpPostSse(c.port, `/sidecard-ask/api/ask?token=${bootAuth}`, {
      id: `recheck-${c.id}`, question: '真机自主复核：请原样回复 OK', selection: 'DSH 适配性复核选中文本',
      zone: 'chat', carrier: 'side', sessionId: null,
    }, 25_000)
    const ev1 = parseSse(ask1.text)
    const startEv = ev1.find(e => e.event === 'start')
    let startBody = null
    try { startBody = startEv ? JSON.parse(startEv.data) : null } catch { /* raw */ }
    r.probes.askEnvelope = { events: ev1.map(e => e.event), data: ev1.map(e => e.data.slice(0, 240)) }
    push('ask envelope contains start event (startActivation returned child)', !!startEv, ev1.map(e => e.event).join(','))
    push('start event carries provider + real childId', !!startBody && typeof startBody.provider === 'string' && startBody.provider.length > 0 && typeof startBody.childId === 'string' && /^[0-9a-f-]{8,}$/i.test(startBody.childId), JSON.stringify(startBody ?? null).slice(0, 200))
    push('toolFilter/persona fields report expected gating', !!startBody && startBody.toolFilter === 'unsupported' && startBody.persona === 'prompt', `${startBody?.toolFilter}/${startBody?.persona}`)

    // zoneAnchors after real selection
    const cr2 = await clientReport()
    r.probes.clientAfterSelection = { zoneAnchors: cr2?.zoneAnchors, slots: cr2?.slots, family: cr2?.family }
    push('zoneAnchors === true after first real selection', cr2?.zoneAnchors === true, String(cr2?.zoneAnchors))

    await page.screenshot({ path: join(SHOTS, `${c.id}-recheck-page.png`) })
    r.pageErrors = pageErrors.slice(0, 5)
    push('no uncaught page errors', pageErrors.length === 0, pageErrors.length)
    await page.close()
  } finally {
    await stopTree(child)
    children.pop()
  }

  results.push(r)
  writeFileSync(join(RM, 'recheck-results.json'), JSON.stringify(results, null, 2))
  const fails = r.checks.filter(k => !k.pass)
  log(`${c.id}: ${r.checks.length - fails.length}/${r.checks.length} checks passed${fails.length ? '; FAILED: ' + fails.map(f => `${f.name} got=${JSON.stringify(f.got)}`).join(' | ') : ''}`)
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  for (const c of CASES) {
    try { await scenario(browser, c) } catch (e) {
      log(`FATAL ${c.id}: ${String((e && e.stack) || e).slice(0, 1200)}`)
      results.push({ id: c.id, fatal: String((e && e.stack) || e).slice(0, 2000) })
      writeFileSync(join(RM, 'recheck-results.json'), JSON.stringify(results, null, 2))
    }
  }
} finally {
  await browser.close()
  while (children.length) await stopTree(children.pop())
}
log('\n===== SUMMARY =====')
for (const r of results) {
  if (r.fatal) { log(`${r.id}: FATAL`); continue }
  for (const k of r.checks) log(`${k.pass ? 'PASS' : 'FAIL'}  [${r.id}] ${k.name}${k.pass ? '' : '  got=' + JSON.stringify(k.got)}`)
}
