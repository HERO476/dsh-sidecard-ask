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
report.equal(manifest.name, 'dsh-selection-followup', 'package name is the plugin id')
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
report.ok(/id:\s*selection-followup\b/.test(patch), 'patch row id is selection-followup')
report.ok(/name:\s*dsh-selection-followup\b/.test(patch), 'patch row name is the package name')
report.ok(/trigger:\s*selection/.test(patch), 'patch carries the documented defaults')
report.ok(/maxChars:\s*\d+/.test(patch), 'patch carries maxChars')

console.log('\nhost half')
const host = await import(hostModuleUrl('verify'))
report.equal(typeof host.apply, 'function', 'host exports apply(ctx, config)')
report.ok(Array.isArray(host.inject) && host.inject.includes('webServer'), "host injects 'webServer' (mount-order safe)")
report.equal(host.name, manifest.name, 'host name matches the package name')
report.equal(host.PLUGIN_VERSION, manifest.version, 'host PLUGIN_VERSION matches package.json')
report.equal(host.ROUTE_PREFIX, '/selection-followup/api', 'host route prefix is stable')
report.ok(host.Config === undefined, 'host deliberately exports no Config schema (no schema dependency)')
const hostImports = [...hostSource.matchAll(/from\s+'([^']+)'/g)].map(match => match[1])
report.ok(
  hostImports.every(specifier => specifier.startsWith('node:')),
  'host imports only node: builtins',
  `imports: ${hostImports.join(', ')}`,
)

console.log('\nclient half')
const loaded = loadClientModule()
report.equal(loaded.registration.id, 'dsh-selection-followup', 'client registers the package id')
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
const usedKeys = new Set([...clientSource.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/g)].map(match => match[1]))
const missingZh = [...usedKeys].filter(key => dictionary.zh[key] === undefined)
const missingEn = [...usedKeys].filter(key => dictionary.en[key] === undefined)
report.ok(missingZh.length === 0, 'every t() key exists in the zh dictionary', `missing: ${missingZh.join(', ')}`)
report.ok(missingEn.length === 0, 'every t() key exists in the en dictionary', `missing: ${missingEn.join(', ')}`)

console.log('\nunknown-API placeholders')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
report.ok(readme.includes('未知 DSH API'), 'README documents the unknown-API section')
report.ok(readme.includes('替换方式'), 'README documents how to replace a placeholder')

report.summary()
