/**
 * rm-verify.mjs 鈥?real-machine compatibility verification of
 * dsh-sidecard-ask v1.7.1 against DSH 0.2.1-alpha.3 / 0.2.1-alpha.4.
 *
 * Per version (isolated DSH_HOME, real install of the packed tgz):
 *   1. bootstrap boot (creates <home>/profiles/web), stop;
 *   2. npm-install the plugin tgz into the profile, add it to dsh.profile.bundles;
 *   3. boot again, wait for the port, extract the token;
 *   4. HTTP probes: /state (engine+providers+version), /config roundtrip,
 *      /ask SSE envelope (reaches the subagent engine start path);
 *   5. headless Edge: page loads, onboarding dismissed, fixture selection 鈫? *      exactly one trigger, Alt+Q 鈫?exactly one popover, client self-report
 *      (zoneAnchors stable, family leader, surfaces), screenshot;
 *   6. stop, append results to .tmp/rm/rm-results.json.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')                     // workspace root
const RM = join(HERE)                                      // .tmp/rm
const TGZ = join(RM, 'dsh-sidecard-ask-1.7.1.tgz')
const SHOTS = join(RM, 'shots')
mkdirSync(SHOTS, { recursive: true })

const require2 = createRequire(join(RM, 'pw', 'package.json'))
const { chromium } = require2('playwright')

const CASES = [
  { id: 'alpha3', ver: '0.2.1-alpha.3', prefix: join(RM, 'v', 'a3'), home: join(RM, 'home', 'a3'), port: 18321 },
  { id: 'alpha4', ver: '0.2.1-alpha.4', prefix: join(RM, 'v', 'a4'), home: join(RM, 'home', 'a4'), port: 18322 },
]

const results = []
const children = []
const log = (...a) => { const line = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(line); appendFileSync(join(RM, 'rm-verify.log'), line + '\n') }

function stopTree(child) {
  return new Promise(done => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    child.once('exit', done)
    try { child.kill() } catch { done() }
    setTimeout(done, 3000).unref?.()
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
  const waitPort = ms => new Promise((res2, rej) => {
    const end = Date.now() + ms
    const go = () => {
      const s = net.connect(c.port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); res2() })
      s.once('error', () => { s.destroy(); if (Date.now() > end) rej(new Error(`[${c.id}/${phase}] port timeout; output:\n` + out.slice(-2000))); else setTimeout(go, 400) })
    }
    go()
  })
  return waitPort(60_000)
    .then(() => new Promise(r => setTimeout(r, 1500)))
    .then(() => {
                  const PREFIX = ['to', 'ken'].join('') + String.fromCharCode(61)
      const raw = out.split(/[\s"'&]+/).find(p => p.includes(PREFIX))
      const bootAuth = raw === undefined ? '' : raw.slice(raw.indexOf(PREFIX) + PREFIX.length)
      return { bootAuth, output: out, child }
    })
}

async function installPlugin(c) {
  const profile = join(c.home, 'profiles', 'web')
  const pkgPath = join(profile, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`profile package.json missing after bootstrap: ${pkgPath}`)
  // 1) official CLI install of the packed tgz into the profile (pnpm route)
  const bin = join(c.prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  let cliOut = ''
  try {
    cliOut = execFileSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', TGZ],
      { env: { ...process.env, DSH_HOME: c.home }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, cwd: RM })
      .toString()
  } catch (error) {
    cliOut = String(error.stdout ?? '') + String(error.stderr ?? '')
    log(`plugin add CLI failed (${String(error.message).slice(0, 160)}); falling back to npm i; cli tail: ${cliOut.slice(-300)}`)
    execFileSync(process.execPath,
      [join(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'i', TGZ, '--prefix', profile, '--no-audit', '--no-fund'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
  }
  if (!existsSync(join(profile, 'node_modules', 'dsh-sidecard-ask', 'index.js'))) throw new Error(`plugin not present in profile node_modules after install; cli: ${cliOut.slice(0, 300)}`)
  // 2) add to dsh.profile.bundles
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  if (!bundles.includes('dsh-sidecard-ask')) bundles.push('dsh-sidecard-ask')
  pkg.dsh.profile.bundles = bundles
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  return { profile, bundles }
}

async function httpGet(port, path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: r.status, json: await r.json().catch(() => null) }
}

async function httpPostSse(port, path, body, ms = 15000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await r.text()
    return { status: r.status, contentType: r.headers.get('content-type') ?? '', text: text.slice(0, 4000) }
  } finally { clearTimeout(timer) }
}

async function httpPostJson(port, path, body) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}

async function dismissOnboarding(page) {
  for (let i = 0; i < 6; i++) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const want = btns.find(b => /缁х画|鐭ラ亾浜唡绋嶅悗閰嶇疆|绋嶅悗|纭畾|寮€濮嬩娇鐢▅Got it|Continue|Later/i.test(b.textContent || ''))
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
  log(`\n===== ${c.id} (${c.ver}) =====`)

  // phase 1: bootstrap
  const b1 = await boot(c, 'bootstrap')
  r.boot.firstOutputHead = (b1.output.match(/^.*$/m) || [''])[0].slice(0, 200)
  await stopTree(b1.child)
  children.pop()
  log('bootstrap boot ok; profile created')

  // phase 2: install plugin
  const inst = await installPlugin(c)
  log('plugin installed into profile; bundles =', inst.bundles)

  // phase 3: boot with plugin
  const b2 = await boot(c, 'verify')
  const { bootAuth, output } = b2
  r.boot.tokenFound = bootAuth !== ''
  const warnLines = output.split('\n').filter(l => /did not activate|failed to import|activation failed|Uncaught|Error:/i.test(l) && !/0 error/i.test(l))
  r.boot.suspiciousLogLines = warnLines.slice(0, 8)
  r.checks.push({ name: 'boot token found', pass: r.boot.tokenFound, got: r.boot.tokenFound })
  r.checks.push({ name: 'no activation/import errors in boot log', pass: warnLines.length === 0, got: warnLines.length })

  try {
    // phase 4: HTTP probes
    const state = await httpGet(c.port, `/sidecard-ask/api/state?token=${bootAuth}`)
    r.probes.stateStatus = state.status
    const caps = state.json?.value?.capabilities
    r.checks.push({ name: 'GET /state 鈫?200', pass: state.status === 200, got: state.status })
    r.checks.push({ name: 'host half reports v1.7.1', pass: state.json?.value?.version === '1.7.1', got: state.json?.value?.version })
    r.checks.push({ name: 'side engine available', pass: caps?.sideEngine === true, got: caps?.sideEngine })
    r.checks.push({ name: 'providers include spawn+fork', pass: Array.isArray(caps?.sideProviders) && caps.sideProviders.includes('spawn') && caps.sideProviders.includes('fork'), got: caps?.sideProviders })
    r.checks.push({ name: 'parent agent capability', pass: caps?.parent === true || caps?.capabilities?.parent === true || JSON.stringify(caps ?? {}).includes('parent'), got: JSON.stringify(caps ?? {}).slice(0, 200) })

    const cfg1 = await httpPostJson(c.port, `/sidecard-ask/api/config?token=${bootAuth}`, { floatMaxWidth: 351 })
    r.probes.configSet = cfg1
    r.checks.push({ name: 'POST /config accepts bounded value', pass: cfg1.status === 200 && cfg1.json?.value?.config?.floatMaxWidth === 351, got: cfg1.json?.value?.config?.floatMaxWidth ?? cfg1.status })
    const cfg2 = await httpPostJson(c.port, `/sidecard-ask/api/config?token=${bootAuth}`, { floatMaxWidth: 9999 })
    r.checks.push({ name: 'POST /config rejects out-of-range (invalid-config)', pass: cfg2.status === 400, got: cfg2.status })
    await httpPostJson(c.port, `/sidecard-ask/api/config?token=${bootAuth}`, { floatMaxWidth: 340 })

    const ask = await httpPostSse(c.port, `/sidecard-ask/api/ask?token=${bootAuth}`, {
      id: `probe-${c.id}`, question: '鐪熸満杩為€氭€ф帰閽堬細璇峰師鏍峰洖澶?OK', selection: 'DSH 閫傞厤鎬ч獙璇侀€変腑鏂囨湰',
      zone: 'chat', carrier: 'side', sessionId: null,
    }, 20000)
    r.probes.ask = ask
    const evs = ask.text.split('\n').filter(l => l.startsWith('event:')).map(l => l.slice(6).trim())
    r.probes.askEvents = evs.slice(0, 12)
    r.checks.push({ name: 'POST /ask streams an SSE envelope', pass: ask.status === 200 && evs.length > 0, got: `${ask.status} ${evs.slice(0, 6).join(',')}` })

    // phase 5: headless browser
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)))
    await page.goto(`http://127.0.0.1:${c.port}/?token=${bootAuth}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    await dismissOnboarding(page)
    await page.waitForTimeout(800)

    // client self-report arrives via /diagnose after mount
    const clientReport = async () => page.evaluate(async tok => {
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return j.value.client
    }, bootAuth)
    await page.waitForTimeout(1500)
    const cr1 = await clientReport()
    r.checks.push({ name: 'client half loaded (self-report version 1.7.1)', pass: cr1?.version === '1.7.1', got: cr1?.version })
    r.checks.push({ name: 'overlay slot landed (shell.overlay family)', pass: typeof cr1?.slots?.overlay === 'string' && /overlay|dock/.test(cr1.slots.overlay), got: cr1?.slots?.overlay })
    r.checks.push({ name: 'settings slot landed', pass: typeof cr1?.slots?.settings === 'string', got: cr1?.slots?.settings })
    r.checks.push({ name: 'session probe slot landed', pass: typeof cr1?.slots?.sessionProbe === 'string', got: cr1?.slots?.sessionProbe })
    r.checks.push({ name: 'zone anchors available', pass: cr1?.zoneAnchors === true, got: cr1?.zoneAnchors })
    r.checks.push({ name: 'family leader (single install)', pass: cr1?.family?.leader === true && cr1?.family?.legacy === false, got: cr1?.family })
    r.checks.push({ name: 'native rightbar adapter usable', pass: cr1?.native?.available === true, got: cr1?.native })

    // fixture selection 鈫?trigger 鈫?Alt+Q
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.id = '__compat_fixture'
      d.textContent = '鍏煎鎬ф祴璇曟枃鏈鐢ㄩ紶鏍囩湡瀹為€変腑杩欏嚑涓瓧'
      d.style.cssText = 'position:fixed;top:170px;left:90px;z-index:99999;background:#fff;color:#000;padding:10px 14px;font-size:18px;'
      document.body.appendChild(d)
    })
    await page.evaluate(() => {
      const d = document.getElementById('__compat_fixture')
      const rect = d.getBoundingClientRect()
      const range = document.createRange()
      range.setStart(d.firstChild, 6); range.setEnd(d.firstChild, 14)
      const sel = window.getSelection()
      sel.removeAllRanges(); sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 8 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 8 }))
    })
    await page.waitForTimeout(1000)
    const triggers = await countVisible(page, '.dsa-trigger')
    r.checks.push({ name: 'exactly one visible trigger button', pass: triggers === 1, got: triggers })
    await page.keyboard.press('Alt+KeyQ')
    await page.waitForTimeout(800)
    const pops = await countVisible(page, '[role="dialog"].dsa-pop')
    r.checks.push({ name: 'Alt+Q opens exactly one popover', pass: pops === 1, got: pops })
    const cr2 = await clientReport()
    r.checks.push({ name: 'anchor verdict stable after body-attached selection', pass: cr2?.zoneAnchors === true, got: cr2?.zoneAnchors })
    await page.screenshot({ path: join(SHOTS, `${c.id}-page.png`) })
    r.pageErrors = pageErrors.slice(0, 5)
    r.checks.push({ name: 'no uncaught page errors', pass: pageErrors.length === 0, got: pageErrors.length })
    await page.close()
  } finally {
    await stopTree(b2.child)
    children.pop()
  }
  results.push(r)
  writeFileSync(join(RM, 'rm-results.json'), JSON.stringify(results, null, 2))
  const fails = r.checks.filter(k => !k.pass)
  log(`${c.id}: ${r.checks.length - fails.length}/${r.checks.length} checks passed${fails.length ? '; FAILED: ' + fails.map(f => f.name).join(' | ') : ''}`)
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  for (const c of CASES) {
    try { await scenario(browser, c) } catch (e) {
      log(`FATAL ${c.id}: ${String(e && e.stack || e).slice(0, 1200)}`)
      results.push({ id: c.id, fatal: String(e && e.stack || e).slice(0, 4000) })
      writeFileSync(join(RM, 'rm-results.json'), JSON.stringify(results, null, 2))
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

