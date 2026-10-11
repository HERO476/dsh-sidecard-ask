/**
 * headless-verify.mjs — invisible (headless Edge) real-browser verification
 * of dsh-sidecard-ask 1.6.0 across four booted profiles.
 *
 *  18210 0.2.1-alpha.2 : startActivation adaptation (was: engine dead)
 *  18208 0.2.0-rc.2    : regression + anchor verdict stability
 *  18302 co-load       : legacy 1.0.1 + 1.6.0 -> single visible surface
 *  18401 better-0.25.0 : better-sidebar carrier detection
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'
const require = createRequire(join(process.env.TEMP, 'dsh-compat', 'probe-pw', 'package.json'))
const { chromium } = require('playwright')

const ROOT = join(process.env.TEMP, 'dsh-compat')
const SHOTS = join(ROOT, 'shots')
mkdirSync(SHOTS, { recursive: true })
const results = []
const children = []

const CASES = [
  { id: 'alpha2', ver: '0.2.1-alpha.2', home: join(ROOT, 'home', '0.2.1-alpha.2'), port: 18210 },
  { id: 'rc2', ver: '0.2.0-rc.2', home: join(ROOT, 'home', '0.2.0-rc.2'), port: 18208 },
  { id: 'coload', ver: '0.2.0-rc.2', home: join(ROOT, 'coload', 'p2-selection'), port: 18302 },
  { id: 'better025', ver: '0.2.0-rc.2', home: join(ROOT, 'sidecoload', 's1-better025'), port: 18401 },
]

function boot(c) {
  const bin = join(ROOT, 'v', c.ver, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(c.port), '--host', '127.0.0.1'], {
    env: { ...process.env, DSH_HOME: c.home },
    cwd: ROOT,
  })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  const waitPort = ms => new Promise((resolve, reject) => {
    const end = Date.now() + ms
    const go = () => {
      const s = net.connect(c.port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); resolve() })
      s.once('error', () => { s.destroy(); Date.now() > end ? reject(new Error('port timeout')) : setTimeout(go, 400) })
    }
    go()
  })
  return waitPort(45_000).then(() => new Promise(r => setTimeout(() => r((out.match(/token=([^\s"'&]+)/) || [])[1] || ''), 1500)))
}

async function dismissOnboarding(page) {
  for (let i = 0; i < 6; i++) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const want = btns.find(b => /继续|知道了|稍后配置|稍后|确定|Got it|Continue|Later/i.test(b.textContent))
      if (want) { want.click(); return true }
      return false
    })
    if (!clicked) break
    await page.waitForTimeout(500)
  }
}

async function diagText(page, token) {
  return await page.evaluate(async (tok) => {
    const r = await fetch(`/sidecard-ask/api/state?token=${tok}`)
    const j = await r.json()
    return j.value.capabilities
  }, token)
}

async function openSelfCheck(page) {
  // settings gear → sidecard group → run self-check; resilient to label drift
  return await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const clickByText = (sel, re) => {
      const el = [...document.querySelectorAll(sel)].find(n => re.test((n.textContent || '').trim()))
      if (el) { el.click(); return true }
      return false
    }
    clickByText('button,[role=button]', /设置|Settings/)
    await sleep(700)
    clickByText('*', /^划词追问$|sidecard/i)
    await sleep(700)
    clickByText('button', /运行自检|Self-check|Diagnostics/)
    await sleep(1500)
    const diag = [...document.querySelectorAll('.dsa-diag, .dsa-settings *')]
      .map(n => (n.textContent || '').trim()).filter(t => /宿主接口|侧边作答引擎|区域锚点|侧边卡片插件/.test(t))
    return [...new Set(diag)]
  })
}

async function injectFixture(page) {
  await page.evaluate(() => {
    const d = document.createElement('div')
    d.id = '__compat_fixture'
    d.textContent = '兼容性测试文本请用鼠标真实选中这几个字'
    d.style.cssText = 'position:fixed;top:170px;left:90px;z-index:99999;background:#fff;color:#000;padding:10px 14px;font-size:18px;'
    document.body.appendChild(d)
  })
}

async function realSelectFixture(page) {
  const box = await page.evaluate(() => {
    const d = document.getElementById('__compat_fixture')
    const r = d.getBoundingClientRect()
    const range = document.createRange()
    const tn = d.firstChild
    range.setStart(tn, 6); range.setEnd(tn, 14)
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(range)
    // synthesise the same event shape the plugin listens to (headless selection)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 8 }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 8 }))
    return { x: r.left + 30, y: r.top + 8 }
  })
  await page.waitForTimeout(900)
  return box
}

async function countVisible(page, selector) {
  return await page.evaluate(sel => [...document.querySelectorAll(sel)].filter(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'
  }).length, selector)
}

async function scenario(browser, c) {
  const token = await boot(c)
  const r = { id: c.id, version: c.ver, port: c.port, checks: [], shots: [] }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.goto(`http://127.0.0.1:${c.port}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismissOnboarding(page)
  await page.waitForTimeout(800)

  const caps = await diagText(page, token)
  r.checks.push({ name: 'side engine usable', pass: caps.sideEngine === true, got: caps.sideEngine })
  r.checks.push({ name: 'providers spawn,fork', pass: JSON.stringify(caps.sideProviders) === '["spawn","fork"]', got: caps.sideProviders })

  if (c.id === 'rc2') {
    // anchor verdict stability: a body-mounted selection must not flip the
    // build-wide data-slot verdict to "missing"; read the client's own
    // self-report (what the self-check UI renders).
    await injectFixture(page); await realSelectFixture(page)
    const clientReport = async () => page.evaluate(async tok => {
      await new Promise(r => setTimeout(r, 700))
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return j.value.client
    }, token)
    const cr1 = await clientReport()
    await page.evaluate(() => {
      const d = document.getElementById('__compat_fixture')
      const range = document.createRange()
      range.setStart(d.firstChild, 1); range.setEnd(d.firstChild, 8)
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    const cr2 = await clientReport()
    r.checks.push({ name: 'anchor verdict run1 = available', pass: cr1?.zoneAnchors === true, got: cr1?.zoneAnchors })
    r.checks.push({ name: 'anchor verdict run2 = available (no flip)', pass: cr2?.zoneAnchors === true, got: cr2?.zoneAnchors })
    r.checks.push({ name: 'family leader on single install', pass: cr2?.family?.leader === true && cr2?.family?.legacy === false, got: cr2?.family })
    await page.screenshot({ path: join(SHOTS, 'rc2-anchors.png') }); r.shots.push('rc2-anchors.png')
  }

  if (c.id === 'coload') {
    await injectFixture(page); await realSelectFixture(page)
    const triggers = await countVisible(page, '.dsa-trigger')
    const legacyHidden = await page.evaluate(() =>
      [...document.querySelectorAll('.dsa-layer:not([data-dsa-owner])')]
        .every(el => getComputedStyle(el).display === 'none'))
    const legacyCount = await page.evaluate(() => document.querySelectorAll('.dsa-layer:not([data-dsa-owner])').length)
    r.checks.push({ name: 'legacy layers exist in DOM', pass: legacyCount >= 1, got: legacyCount })
    r.checks.push({ name: 'legacy layer hidden by leader', pass: legacyHidden, got: legacyHidden })
    r.checks.push({ name: 'exactly one visible trigger button', pass: triggers === 1, got: triggers })
    await page.keyboard.press('Alt+KeyQ')
    await page.waitForTimeout(700)
    const dialogs = await countVisible(page, '[role="dialog"].dsa-pop')
    r.checks.push({ name: 'Alt+Q opens exactly one popover', pass: dialogs === 1, got: dialogs })
    const family = await page.evaluate(async tok => {
      await new Promise(r => setTimeout(r, 200))
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return j.value.client?.family
    }, token)
    r.checks.push({ name: 'leader reports family takeover', pass: family?.legacy === true, got: family })
    await page.screenshot({ path: join(SHOTS, 'coload-single.png') }); r.shots.push('coload-single.png')
  }

  if (c.id === 'better025') {
    const state = await page.evaluate(async tok => {
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return j.value.client?.better
    }, token)
    r.checks.push({ name: 'better adapter detects 0.25.0', pass: state?.available === true && /^0\.25/.test(state.version || ''), got: state })
    await page.screenshot({ path: join(SHOTS, 'better025.png') }); r.shots.push('better025.png')
  }

  if (c.id === 'alpha2') {
    // API-level evidence (the UI self-check reads the same capabilities()).
    const state = await page.evaluate(async tok => {
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return j.value
    }, token)
    r.checks.push({ name: 'self-check data: engine available', pass: state.capabilities.sideEngine === true, got: state.capabilities.sideEngine })
    r.checks.push({ name: 'client reports v' + state.client?.version, pass: state.client?.version === '1.6.0', got: state.client?.version })
    await page.screenshot({ path: join(SHOTS, 'alpha2-engine.png') }); r.shots.push('alpha2-engine.png')
  }

  r.pageErrors = errors.slice(0, 5)
  await page.close()
  results.push(r)
  writeFileSync(join(ROOT, 'headless-results.json'), JSON.stringify(results, null, 2))
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  for (const c of CASES) {
    try { await scenario(browser, c) } catch (e) { results.push({ id: c.id, fatal: String(e && e.stack || e) }); writeFileSync(join(ROOT, 'headless-results.json'), JSON.stringify(results, null, 2)) }
  }
} finally {
  await browser.close()
  for (const ch of children) { try { process.kill(ch.pid) } catch {} }
}
for (const r of results) {
  console.log(`\n=== ${r.id} (${r.version}) ===`)
  if (r.fatal) { console.log('FATAL', r.fatal.slice(0, 300)); continue }
  for (const k of r.checks) console.log(`${k.pass ? 'PASS' : 'FAIL'}  ${k.name}${k.pass ? '' : '  got=' + JSON.stringify(k.got)}`)
  if (r.pageErrors?.length) console.log('pageErrors:', r.pageErrors)
}
