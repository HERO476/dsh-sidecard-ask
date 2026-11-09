/**
 * gen-locale.mjs — regenerate `locale/*.json` from the client's embedded DICT.
 *
 * Why this exists: the two shipped locale files are a curated SUBSET of the
 * dictionary inlined in `client.js` (`api.pure.dict` — 279 keys per language),
 * and before this script every one of those 47 published keys existed twice:
 * once in `client.js`, once in the JSON. `test/verify.mjs` guards the two
 * against *contradicting* each other, so a stale string fails the suite — but
 * the guard cannot stop the maintenance tax of editing the same string twice,
 * and it never noticed a value that was simply retyped identically by hand.
 *
 * `client.js` is now the single source of truth. Run this after changing a
 * string that also ships in the published subset.
 *
 *   node tools/gen-locale.mjs           rewrite both files
 *   node tools/gen-locale.mjs --check    exit 1 if either file is stale (CI)
 *
 * Deliberate limits:
 *   - the SUBSET and its key ORDER stay owned by the tracked JSON: this script
 *     syncs values, it does not decide what a consumer sees. A key that left
 *     the dictionary is reported as an error instead of being dropped silently,
 *     because dropping it would delete a published string.
 *   - output is `JSON.stringify(..., 2)` plus a trailing newline, which is the
 *     shape both files already had; `.gitattributes` keeps them LF.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadClientModule } from '../test/harness.mjs'

const LANGS = ['zh', 'en']
const checkOnly = process.argv.includes('--check')

const { module } = loadClientModule()
const dictionary = module.api.pure.dict
if (dictionary === undefined || dictionary === null) {
  console.error('gen-locale: the client module exposes no api.pure.dict — did §2 move?')
  process.exit(1)
}

let problems = 0
let stale = 0
const report = []

for (const lang of LANGS) {
  const file = join(ROOT, 'locale', `${lang}.json`)
  const current = JSON.parse(readFileSync(file, 'utf8'))
  const source = dictionary[lang]
  if (source === undefined || source === null) {
    console.error(`gen-locale: no ${lang} dictionary in client.js`)
    process.exit(1)
  }

  const out = {}
  for (const key of Object.keys(current)) {
    const value = source[key]
    if (typeof value !== 'string') {
      // A published key with no dictionary entry is a broken consumer contract,
      // not something this script should paper over.
      report.push(`  ✖ ${lang}.json: "${key}" is not in the ${lang} dictionary`)
      problems++
      continue
    }
    out[key] = value
  }

  const rendered = `${JSON.stringify(out, null, 2)}\n`
  const before = readFileSync(file, 'utf8')
  if (before === rendered) {
    report.push(`  ✔ ${lang}.json in sync (${Object.keys(out).length} keys)`)
    continue
  }
  stale++
  const changed = Object.keys(out).filter(key => before !== rendered && current[key] !== out[key])
  report.push(`  ${checkOnly ? '✖' : '↻'} ${lang}.json ${checkOnly ? 'is stale' : 'updated'} (${Object.keys(out).length} keys)`
    + (changed.length > 0 ? ` — values from DICT: ${changed.join(', ')}` : ' — formatting only'))
  if (!checkOnly) writeFileSync(file, rendered, 'utf8')
}

console.log(report.join('\n'))

if (problems > 0) {
  console.error(`\ngen-locale: ${problems} key(s) have no dictionary entry; fix client.js DICT or the locale subset.`)
  process.exit(1)
}
if (checkOnly && stale > 0) {
  console.error('\ngen-locale: run `node tools/gen-locale.mjs` and commit the result.')
  process.exit(1)
}
if (!checkOnly && stale > 0) console.log('\ngen-locale: files rewritten from the embedded DICT.')
