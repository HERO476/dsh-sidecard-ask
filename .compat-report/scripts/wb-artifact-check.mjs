/**
 * a34-artifact-check.mjs — independent artifact-level verification of the
 * claims in .compat-report/COMPATIBILITY-REPORT-alpha3-alpha4.md §3.
 *
 * Reads cached npm tarballs (.tgz) in memory (same minimal tar approach as
 * tools/compat-probe.mjs) and re-derives, from the PUBLISHED artifacts:
 *   1. per-file SHA256 diff alpha.3 vs alpha.4 for the 13 probed packages;
 *   2. subagent capability-negotiation change alpha.2 -> alpha.3;
 *   3. sidebar-right client.js rewrite size/counts;
 *   4. conversation / renderer consumed-surface counts;
 *   5. alpha.4 client-side increments (release gate, command chip, ...);
 *   6. api-session-controller typert.host.js line change.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '..', 'tools', '.cache', 'tarballs')

function readTarGz(path) {
  const raw = gunzipSync(readFileSync(path))
  const files = new Map()
  let offset = 0
  let longName
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = Number.parseInt(sizeText, 8) || 0
    const type = String.fromCharCode(header[156])
    const body = raw.subarray(offset + 512, offset + 512 + size)
    const full = longName ?? name
    longName = undefined
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/, '')
    else if (type === '0' || type === '') files.set(full, Buffer.from(body))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

function tarball(pkg, ver) {
  for (const name of [
    `${pkg.replace('@', '').replace('/', '__')}@${ver}.tgz`,
    `${pkg.replace('@', '').replace('/', '-')}-${ver}.tgz`,
  ]) {
    const p = join(CACHE, name)
    if (existsSync(p)) return p
  }
  return null
}

const PKGS = [
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-workspace',
]

const sha = buf => createHash('sha256').update(buf).digest('hex')
const filesOf = (pkg, ver) => {
  const p = tarball(pkg, ver)
  if (!p) return null
  const files = readTarGz(p)
  const out = new Map()
  for (const [name, body] of files) out.set(name, { sha: sha(body), len: body.length, body })
  return out
}
const count = (text, needle) => text.split(needle).length - 1
const jshow = o => JSON.stringify(o)

console.log('## A. alpha.3 vs alpha.4 per-file SHA256 diff (13 packages)')
for (const pkg of PKGS) {
  const a = filesOf(pkg, '0.2.1-alpha.3')
  const b = filesOf(pkg, '0.2.1-alpha.4')
  if (!a || !b) { console.log(`  ${pkg}: MISSING TARBALL`); continue }
  const names = new Set([...a.keys(), ...b.keys()])
  const changed = []
  for (const n of names) {
    const x = a.get(n), y = b.get(n)
    if (!x || !y || x.sha !== y.sha) changed.push({ file: n, a: x ? `${x.len}B` : 'ABSENT', b: y ? `${y.len}B` : 'ABSENT' })
  }
  const pkgJsonOnly = changed.length > 0 && changed.every(c => c.file.endsWith('/package.json') || c.file === 'package.json')
  console.log(`  ${pkg}: ${changed.length === 0 ? 'identical' : changed.map(c => `${c.file} ${c.a}->${c.b}`).join(' | ')}${pkgJsonOnly ? '   [only package.json]' : ''}`)
}

console.log('\n## B. subagent: alpha.2 -> alpha.3 change + alpha.3 vs alpha.4 identity')
{
  const ver = {}
  for (const v of ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4']) {
    const f = filesOf('@deepseek-ai/dsh-subagent', v)
    const lib = f.get('package/lib/index.js')
    ver[v] = { len: lib.len, sha: sha(lib.body).slice(0, 16), text: lib.body.toString('utf8') }
  }
  const [v2, v3, v4] = ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4'].map(v => ver[v])
  console.log(`  lib/index.js: alpha.2 ${v2.len}B / alpha.3 ${v3.len}B / alpha.4 ${v4.len}B`)
  console.log(`  alpha.3 == alpha.4 byte-identical: ${v3.sha === v4.sha}`)
  for (const mk of ['startActivation', 'delivery', 'toolFilter', 'persona', 'agentPreset', 'assertCapabilities', 'startLocal', 'startExternal', 'localAgent', 'NO_START_CAPABILITIES']) {
    console.log(`  count ${mk}: a2=${count(v2.text, mk)} a3=${count(v3.text, mk)} a4=${count(v4.text, mk)}`)
  }
  const list = t => (t.match(/assertCapabilities[^\n]{0,220}/) || [''])[0]
  console.log(`  a2 assertCapabilities ctx: ${list(v2.text).slice(0, 200)}`)
  console.log(`  a3 assertCapabilities ctx: ${list(v3.text).slice(0, 200)}`)
  const comp = t => (t.match(/composition[^\n]{0,160}/) || [''])[0]
  console.log(`  a2 composition ctx: ${comp(v2.text).slice(0, 150)}`)
  console.log(`  a3 composition ctx: ${comp(v3.text).slice(0, 150)}`)
}

console.log('\n## C. sidebar-right client.js size + consumed-surface counts')
{
  for (const v of ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4']) {
    const f = filesOf('@deepseek-ai/dsh-client-ui-sidebar-right', v)
    const c = f.get('package/lib/client.js')
    const t = c.body.toString('utf8')
    console.log(`  ${v}: client.js ${c.len}B | sidebarRightTabs=${count(t, 'sidebarRightTabs')} sidebarRight=${count(t, 'sidebarRight')} pane.tab=${count(t, 'sidebar.right.pane.tab')} pane.tab.title=${count(t, 'sidebar.right.pane.tab.title')} openTab=${count(t, 'openTab')} revealIfOpened=${count(t, 'revealIfOpened')} preferNewPane=${count(t, 'preferNewPane')} guide=${count(t, 'guide')}`)
  }
}

console.log('\n## D. conversation / renderer / layout counts')
{
  const conv = {}
  for (const v of ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4']) {
    const f = filesOf('@deepseek-ai/dsh-client-ui-conversation', v)
    const t = [...f.entries()].filter(([n]) => /\.(js|json)$/.test(n)).map(([, b]) => b.body.toString('utf8')).join('\n')
    conv[v] = t
    console.log(`  conversation ${v}: input.right=${count(t, 'conversation.input.right')} input.left=${count(t, 'conversation.input.left')} composer.dock=${count(t, 'conversation.composer.dock')} inputActions=${count(t, 'inputActions')} setDraft=${count(t, 'setDraft')}`)
  }
  const ren = filesOf('@deepseek-ai/dsh-client-ui-renderer', '0.2.1-alpha.3')
  const ren4 = filesOf('@deepseek-ai/dsh-client-ui-renderer', '0.2.1-alpha.4')
  const r3t = [...ren.values()].map(x => x.body.toString('utf8')).join('\n')
  const r4t = [...ren4.values()].map(x => x.body.toString('utf8')).join('\n')
  console.log(`  renderer data-slot: a3=${count(r3t, 'data-slot')} a4=${count(r4t, 'data-slot')}`)
  const lay = filesOf('@deepseek-ai/dsh-client-ui-layout', '0.2.1-alpha.4')
  const lt = [...lay.values()].map(x => x.body.toString('utf8')).join('\n')
  console.log(`  layout shell.overlay=${count(lt, 'shell.overlay')}`)
}

console.log('\n## E. alpha.4 client-side increments')
{
  for (const [pkg, markers] of [
    ['@deepseek-ai/dsh-client-modules', ['release-change', 'ReleaseChangeGate', 'decodeRelease', 'notify']],
    ['@deepseek-ai/dsh-client-ui-settings-general', ['HostReleasePrompt']],
    ['@deepseek-ai/dsh-client-ui-conversation', ['CommandChip', 'claim-decor']],
  ]) {
    const a3 = filesOf(pkg, '0.2.1-alpha.3'), a4 = filesOf(pkg, '0.2.1-alpha.4')
    const tx = f => [...f.values()].map(x => x.body.toString('utf8')).join('\n')
    const t3 = tx(a3), t4 = tx(a4)
    console.log(`  ${pkg}: ${markers.map(m => `${m} a3=${count(t3, m)} a4=${count(t4, m)}`).join(' | ')}`)
  }
}

console.log('\n## F. api-session-controller typert.host.js line diff alpha.3 -> alpha.4')
{
  const a3 = filesOf('@deepseek-ai/dsh-api-session-controller', '0.2.1-alpha.3')
  const a4 = filesOf('@deepseek-ai/dsh-api-session-controller', '0.2.1-alpha.4')
  const target = [...a3.keys()].filter(n => n.includes('typert.host'))
  console.log(`  typert.host files: ${target.join(', ')}`)
  for (const n of target) {
    const l3 = a3.get(n).body.toString('utf8').split('\n')
    const l4 = a4.get(n).body.toString('utf8').split('\n')
    const diff = []
    for (let i = 0; i < Math.max(l3.length, l4.length); i++) if (l3[i] !== l4[i]) diff.push({ i: i + 1, a3: l3[i], a4: l4[i] })
    console.log(`  ${n}: ${l3.length} vs ${l4.length} lines, ${diff.length} differing line(s)`)
    for (const d of diff.slice(0, 10)) console.log(`    L${d.i}\n      a3: ${String(d.a3).slice(0, 220)}\n      a4: ${String(d.a4).slice(0, 220)}`)
    const pm3 = count(l3.join('\n'), 'plugin-market'), pm4 = count(l4.join('\n'), 'plugin-market')
    console.log(`  plugin-market occurrences: a3=${pm3} a4=${pm4}`)
  }
}
console.log('\nDONE')
