/**
 * anchor-probe.mjs — focused headless check of the zoneAnchors verdict:
 * select text on a body-mounted fixture while the real frame (full of
 * data-slot outlets) is mounted, then read the client's own self-report
 * twice. Pre-fix the second selection flipped the verdict to false even
 * though the build obviously carries anchors.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(join(process.env.TEMP, 'dsh-compat', 'probe-pw', 'package.json'))
const { chromium } = require('playwright')
const ROOT = join(process.env.TEMP, 'dsh-compat')
const SHOTS = join(ROOT, 'shots')
mkdirSync(SHOTS, { recursive: true })

function boot(ver, home, port) {
  const bin = join(ROOT, 'v', ver, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], {
    env: { ...process.env, DSH_HOME: home }, cwd: ROOT,
  })
  let out = ''
  child.stdout.on('data', d => { out += d }); child.stderr.on('data', d => { out += d })
  return new Promise((resolve, reject) => {
    const end = Date.now() + 45_000
    const go = () => {
      const s = net.connect(port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); setTimeout(() => resolve({ child, token: (out.match(/token=([^\s"'&]+)/) || [])[1] }), 1200) })
      s.once('error', () => { s.destroy(); Date.now() > end ? reject(new Error('port timeout')) : setTimeout(go, 400) })
    }
    setTimeout(go, 300)
  })
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const verdicts = []
for (const [id, ver, port] of [['rc2', '0.2.0-rc.2', 18501], ['alpha2', '0.2.1-alpha.2', 18502]]) {
  const home = join(ROOT, 'home', ver)
  const { child, token } = await boot(ver, home, port)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const diagPosts = []
  page.on('request', req => {
    if (req.url().includes('/api/diagnose') && req.method() === 'POST') {
      try { diagPosts.push(JSON.parse(req.postData() || '{}')) } catch { diagPosts.push({ _raw: req.postData()?.slice(0, 80) }) }
    }
  })
  page.on('console', msg => { if (/sidecard|data-slot/.test(msg.text())) console.log('PAGE', id, msg.type(), msg.text().slice(0, 160)) })
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  for (let i = 0; i < 6; i++) {
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /继续|知道了|稍后配置|稍后|确定|Continue|Later/i.test(x.textContent))
      if (b) { b.click(); return true } return false
    })
    if (!clicked) break
    await page.waitForTimeout(400)
  }

  // How many anchors does the REAL build carry? (build-level truth)
  const anchorCount = await page.evaluate(() => document.querySelectorAll('[data-slot]').length)

  // Body-mounted fixture (unanchored node, like the original repro).
  await page.evaluate(() => {
    const d = document.createElement('div')
    d.id = '__anchor_fixture'
    d.textContent = '锚点稳定性测试文本请选中这几个字'
    d.style.cssText = 'position:fixed;top:170px;left:90px;z-index:99999;background:#fff;color:#000;padding:10px 14px;font-size:18px;'
    document.body.appendChild(d)
    const range = document.createRange()
    range.setStart(d.firstChild, 7); range.setEnd(d.firstChild, 15)
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.waitForTimeout(1500)

  const dbg1 = await page.evaluate(() => ({
    sel: window.getSelection().toString(),
    rangeCount: window.getSelection().rangeCount,
    collapsed: window.getSelection().isCollapsed,
    triggers: [...document.querySelectorAll('.dsa-trigger')].map(el => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      return { w: r.width, h: r.height, display: cs.display, text: el.textContent }
    }),
  }))
  console.log('DBG', id, JSON.stringify(dbg1))

  const read = async () => {
    await page.waitForTimeout(800)
    return page.evaluate(async tok => {
      const j = await (await fetch(`/sidecard-ask/api/state?token=${tok}`)).json()
      return { zoneAnchors: j.value.client?.zoneAnchors, family: j.value.client?.family, version: j.value.client?.version }
    }, token)
  }
  const v1 = await read()
  // Second unrelated selection on the same unanchored fixture, then read again.
  await page.evaluate(() => {
    const d = document.getElementById('__anchor_fixture')
    const range = document.createRange()
    range.setStart(d.firstChild, 2); range.setEnd(d.firstChild, 9)
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.waitForTimeout(1200)
  const v2 = await read()
  await page.screenshot({ path: join(SHOTS, `anchor-${id}.png`) })
  verdicts.push({ id, anchorCount, v1, v2, diagPosts: diagPosts.map(p => ({ zoneAnchors: p.zoneAnchors, family: p.family, surface: p.surface })) })
  await page.close()
  try { process.kill(child.pid) } catch {}
}
await browser.close()
for (const v of verdicts) {
  const stable = v.v1.zoneAnchors === true && v.v2.zoneAnchors === true
  console.log(`${v.id}: data-slot nodes=${v.anchorCount} client=${v.v1.version} anchors r1=${v.v1.zoneAnchors} r2=${v.v2.zoneAnchors} family=${JSON.stringify(v.v2.family)} => ${stable ? 'PASS stable' : 'FAIL'}`)
  console.log('  diagnose posts:', JSON.stringify(v.diagPosts))
}
