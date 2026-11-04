/**
 * verify.mjs — static integrity of the shipped package.
 *
 * Checks the manifest, the bundle patch, both halves' public surface, the
 * locale files and the promise that the plugin declares no runtime
 * dependency. Run: `node test/verify.mjs`.
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, PACKAGE_JSON, HOST_ENTRY, CLIENT_ENTRY, createReporter, loadClientModule, hostModuleUrl } from './harness.mjs'

const report = createReporter('verify')
const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
const hostSource = readFileSync(HOST_ENTRY, 'utf8')
const clientSource = readFileSync(CLIENT_ENTRY, 'utf8')

console.log('manifest')
report.equal(manifest.name, 'dsh-sidecard-ask', 'package name is the plugin id')
report.ok(/^\d+\.\d+\.\d+$/.test(manifest.version), 'version is a plain semver')
report.equal(manifest.type, 'module', 'package is ESM')
report.ok(manifest.dependencies === undefined, 'no runtime dependencies declared')
report.ok(manifest.peerDependencies === undefined, 'no peer dependencies declared')
report.equal(manifest.exports['.'], './index.js', 'root export is the host half')
report.equal(manifest.exports['./client'], './client.js', 'client export is the browser half')
report.equal(manifest.dsh.bundle.patch, './cordis.patch.yml', 'bundle patch declared')
report.equal(manifest.dsh.client.platform, 'web', 'client half targets the web platform')
report.equal(manifest.dsh.client.immediately, true, 'client half loads at boot (global listener)')
report.ok(Array.isArray(manifest.dsh.client.inject), 'client inject list present')
report.equal(manifest.icon, './icon.svg', 'manifest icon declared')
report.ok(typeof manifest.meta?.title === 'string' && manifest.meta.title !== '', 'display title present')
report.ok(typeof manifest.meta?.description === 'string' && manifest.meta.description !== '', 'display description present')
report.ok(
  typeof manifest.repository?.url === 'string' && typeof manifest.homepage === 'string' && typeof manifest.bugs?.url === 'string',
  'repository/homepage/bugs present (npm page metadata)',
)

console.log('\nshipped files')
for (const entry of manifest.files) {
  const literal = entry.includes('*') ? entry.slice(0, entry.indexOf('*')) : entry
  report.ok(existsSync(join(ROOT, literal)), `files[] entry exists: ${entry}`)
}
report.ok(existsSync(join(ROOT, 'index.js')) && statSync(join(ROOT, 'index.js')).size > 0, 'host half is non-empty')
report.ok(existsSync(join(ROOT, 'client.js')) && statSync(join(ROOT, 'client.js')).size > 0, 'client half is non-empty')

console.log('\nbundle patch')
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
report.ok(/^\s*-\s*insert:/m.test(patch), 'patch inserts a row')
report.ok(/id:\s*sidecard-ask\b/.test(patch), 'patch row id is sidecard-ask')
report.ok(/name:\s*dsh-sidecard-ask\b/.test(patch), 'patch row name is the package name')
report.ok(/trigger:\s*selection/.test(patch), 'patch carries the documented defaults')
report.ok(/maxChars:\s*\d+/.test(patch), 'patch carries maxChars')

console.log('\nhost half')
const host = await import(hostModuleUrl('verify'))
report.equal(typeof host.apply, 'function', 'host exports apply(ctx, config)')
report.ok(Array.isArray(host.inject) && host.inject.includes('webServer'), "host injects 'webServer' (mount-order safe)")
report.equal(host.name, manifest.name, 'host name matches the package name')
report.equal(host.PLUGIN_VERSION, manifest.version, 'host PLUGIN_VERSION matches package.json')
report.equal(host.ROUTE_PREFIX, '/sidecard-ask/api', 'host route prefix is stable')
report.ok(host.Config === undefined, 'host deliberately exports no Config schema (no schema dependency)')
const hostImports = [...hostSource.matchAll(/from\s+'([^']+)'/g)].map(match => match[1])
report.ok(
  hostImports.every(specifier => specifier.startsWith('node:')),
  'host imports only node: builtins',
  `imports: ${hostImports.join(', ')}`,
)

console.log('\nbundle patch ↔ DEFAULT_CONFIG parity')
// The bundle patch is a *defaults* layer: it is merged over the code defaults,
// so any key it names OVERRIDES `DEFAULT_CONFIG`. 2.1.10 shipped
// `sideTools: readonly` here while index.js already said `inherit`, and 1981
// green assertions never noticed — the regex checks above only ask whether a
// line exists, never what it says. Pin every shipped default to the code
// default; a deliberate divergence must be listed in PATCH_DEFAULT_EXCEPTIONS
// with a reason, and the exception list itself is checked for staleness.
const PATCH_DEFAULT_EXCEPTIONS = {}
const patchDefaults = (() => {
  const lines = patch.split('\n')
  const start = lines.findIndex(line => /^\s*config:\s*$/.test(line))
  if (start === -1) return {}
  const configIndent = lines[start].match(/^\s*/)[0].length
  const parsed = {}
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= configIndent) break // dedented: the config block ended
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/)
    if (match === null) continue
    const raw = match[2].trim()
    let value = raw
    if (raw === 'true') value = true
    else if (raw === 'false') value = false
    else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw)
    else value = raw.replace(/^['"]|['"]$/g, '')
    parsed[match[1]] = value
  }
  return parsed
})()
const patchKeys = Object.keys(patchDefaults)
report.ok(patchKeys.length >= 8, 'patch defaults parse out of the YAML config block', `parsed: ${patchKeys.join(', ')}`)
const unknownPatchKeys = patchKeys.filter(key => !Object.prototype.hasOwnProperty.call(host.DEFAULT_CONFIG, key))
report.equal(unknownPatchKeys, [], 'every key in the bundle patch is a real DEFAULT_CONFIG key')
const staleExceptions = Object.keys(PATCH_DEFAULT_EXCEPTIONS).filter(
  key => !Object.prototype.hasOwnProperty.call(patchDefaults, key),
)
report.equal(staleExceptions, [], 'no PATCH_DEFAULT_EXCEPTIONS entry is stale (the key left the patch)')
const divergentDefaults = patchKeys
  .filter(key => Object.prototype.hasOwnProperty.call(host.DEFAULT_CONFIG, key))
  .filter(key => !Object.prototype.hasOwnProperty.call(PATCH_DEFAULT_EXCEPTIONS, key))
  .filter(key => JSON.stringify(patchDefaults[key]) !== JSON.stringify(host.DEFAULT_CONFIG[key]))
  .map(key => `${key}: patch=${JSON.stringify(patchDefaults[key])} code=${JSON.stringify(host.DEFAULT_CONFIG[key])}`)
report.equal(divergentDefaults, [], 'the bundle patch never silently overrides a code default')

console.log('\nclient half')
const loaded = loadClientModule()
report.equal(loaded.registration.id, 'dsh-sidecard-ask', 'client registers the package id')
report.ok(Array.isArray(loaded.module.inject) && loaded.module.inject.includes('slots'), "client injects 'slots'")
report.equal(typeof loaded.module.apply, 'function', 'client exports apply(ctx)')
report.equal(loaded.module.api.version, manifest.version, 'client api.version matches package.json')
const clientRequires = [...new Set([...clientSource.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1]))]
report.equal(clientRequires, ['react'], 'client requires react and nothing else')
report.ok(!clientSource.includes('dsh-client-ui-primitives'), 'client does not import harness client packages')
report.ok(/window\.__ModuleLoader__\.load\(/.test(clientSource), 'client uses the documented module-loader format')
report.ok(!/document\.body\.(append|insert|prepend)/.test(clientSource), 'client never writes DOM into document.body')
report.ok(!/createRoot\(/.test(clientSource), 'client never mounts a second React application')
report.ok(
  !/dangerouslySetInnerHTML\s*:/.test(clientSource) && !/\.innerHTML\s*=/.test(clientSource),
  'client never injects HTML',
)

console.log('\nlocale dictionaries')
for (const file of ['zh.json', 'en.json']) {
  const path = join(ROOT, 'locale', file)
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  report.ok(Object.keys(parsed).length >= 8, `${file} parses and carries keys`)
}
const dictionary = loaded.module.api.pure.dict
// The shipped locale files are a curated SUBSET of the embedded dictionary.
// They may be incomplete, but they must never contradict it: a stale string in
// a published file is what a consumer integrating `./locale/*.json` would show.
for (const [file, lang] of [['zh.json', 'zh'], ['en.json', 'en']]) {
  const parsed = JSON.parse(readFileSync(join(ROOT, 'locale', file), 'utf8'))
  const mismatched = Object.entries(parsed)
    .filter(([key, value]) => dictionary[lang][key] !== value)
    .map(([key]) => key)
  report.ok(mismatched.length === 0, `${file} agrees with the embedded ${lang} dictionary`, `mismatched: ${mismatched.join(', ')}`)
}
// 1.8.0's new UI strings must be reachable through the published locale files
// too, not only through the inlined dictionary.
const P2_LOCALE_KEYS = [
  'setAnswerStyle', 'setCustomPersona', 'setFollowUps', 'locate', 'locateNotFound',
  'exportMd', 'exportAllMd', 'insertToComposer', 'insertDone', 'versionsLabel', 'suggestionsLabel',
]
for (const file of ['zh.json', 'en.json']) {
  const parsed = JSON.parse(readFileSync(join(ROOT, 'locale', file), 'utf8'))
  const missing = P2_LOCALE_KEYS.filter(key => typeof parsed[key] !== 'string' || parsed[key] === '')
  report.ok(missing.length === 0, `${file} carries the 1.8.0 UI strings`, `missing: ${missing.join(', ')}`)
}
const usedKeys = new Set([...clientSource.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/g)].map(match => match[1]))
const missingZh = [...usedKeys].filter(key => dictionary.zh[key] === undefined)
const missingEn = [...usedKeys].filter(key => dictionary.en[key] === undefined)
report.ok(missingZh.length === 0, 'every t() key exists in the zh dictionary', `missing: ${missingZh.join(', ')}`)
report.ok(missingEn.length === 0, 'every t() key exists in the en dictionary', `missing: ${missingEn.join(', ')}`)

console.log('\nunknown-API placeholders')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
report.ok(readme.includes('未知 DSH API'), 'README documents the unknown-API section')
report.ok(readme.includes('替换方式'), 'README documents how to replace a placeholder')

// NODE-HOST-CONTRACT.md pins named symbols to exact source lines — the one
// thing a non-Node host implementer cannot guess. Code moves, and those
// anchors rot silently: 2.1.9 shifted 23 of them without a single test going
// red. Guard the citations the doc itself declares as `symbol`（`file.js:NNN`）;
// anchor-first citations are out of scope here because their symbol is not
// mechanically extractable.
console.log('\ncontract doc anchors')
const contractDoc = readFileSync(join(ROOT, 'NODE-HOST-CONTRACT.md'), 'utf8')
const docSources = { 'index.js': hostSource.split('\n'), 'client.js': clientSource.split('\n') }
// Two citation shapes the doc actually uses: `symbol(args)`（`file.js:NNN`） and
// `file.js:NNN` `symbol`. Prose-only citations have no extractable symbol and
// are out of scope.
const DOC_ANCHOR_FORMS = [
  { pattern: /`([A-Za-z_$][\w$.]*)(?:\([^`()]*\))?`[，,、]?\s*[（(]?`(index|client)\.js:(\d+)/g, pick: m => ({ symbol: m[1], file: `${m[2]}.js`, line: Number(m[3]) }) },
  { pattern: /`(index|client)\.js:(\d+)`\s+`([A-Za-z_$][\w$.]*)/g, pick: m => ({ symbol: m[3], file: `${m[1]}.js`, line: Number(m[2]) }) },
]
const anchored = DOC_ANCHOR_FORMS.flatMap(form => [...contractDoc.matchAll(form.pattern)].map(form.pick))
report.ok(anchored.length >= 12, 'contract doc pins named symbols to source lines', `found ${anchored.length}`)
const vanished = anchored.filter(anchor => docSources[anchor.file][anchor.line - 1] === undefined)
report.ok(
  vanished.length === 0,
  'every pinned line still exists in the shipped source',
  `gone: ${vanished.map(a => `${a.symbol} ${a.file}:${a.line}`).join(', ')}`,
)
const drifted = anchored.filter(anchor => {
  // a declaration may sit under a JSDoc header or a multi-line signature
  const window = docSources[anchor.file].slice(Math.max(0, anchor.line - 3), anchor.line + 2).join('\n')
  return !window.includes(anchor.symbol)
})
report.ok(
  drifted.length === 0,
  'every pinned line still names its symbol',
  `drifted: ${drifted.map(a => `${a.symbol} @ ${a.file}:${a.line}`).join(', ')}`,
)

report.summary()
