/**
 * fix-anchors.mjs — re-point the `NODE-HOST-CONTRACT.md` line citations.
 *
 * The contract doc pins named symbols to exact source lines (`symbol`（`index.js:NNN`）
 * and `index.js:NNN` `symbol`). Code moves and the citations rot silently; the
 * verify suite catches a rotted citation but offers no repair, so every refactor
 * meant hand-editing a dozen numbers.
 *
 * This rewrites a citation ONLY when the current line no longer names its symbol
 * (the same predicate `test/verify.mjs` uses), and picks the nearest occurrence of
 * that symbol in the file so multiple citations of one file keep their relative
 * order. It prints every change; it never invents a symbol.
 *
 *   node tools/fix-anchors.mjs            rewrite the doc
 *   node tools/fix-anchors.mjs --check     report only, exit 1 when stale
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../test/harness.mjs'

const DOC = join(ROOT, 'NODE-HOST-CONTRACT.md')
const checkOnly = process.argv.includes('--check')
// `--defs` re-points EVERY citation at its symbol's declaration, even when the
// current line happens to contain the name. Needed after a bad pass (a call site
// one line above a declaration satisfies the verify window while pointing at the
// wrong thing) and safe to re-run: it is a pure function of the source.
const forceDefs = process.argv.includes('--defs')

const sources = {
  'index.js': readFileSync(join(ROOT, 'index.js'), 'utf8').split('\n'),
  'client.js': readFileSync(join(ROOT, 'client.js'), 'utf8').split('\n'),
}

const FORMS = [
  {
    pattern: /`([A-Za-z_$][\w$.]*)(?:\([^`()]*\))?`[，,、]?\s*[（(]?`(index|client)\.js:(\d+)/g,
    build: (match, line) => ({
      symbol: match[1],
      file: `${match[2]}.js`,
      oldLine: Number(match[3]),
      newLine: line,
      raw: `${match[2]}.js:${match[3]}`,
    }),
  },
  {
    pattern: /`(index|client)\.js:(\d+)`\s+`([A-Za-z_$][\w$.]*)`?/g,
    build: (match, line) => ({
      symbol: match[3],
      file: `${match[1]}.js`,
      oldLine: Number(match[2]),
      newLine: line,
      raw: `${match[1]}.js:${match[2]}`,
    }),
  },
]

/** Whether `line` still names `symbol` under the verify suite's own window rule. */
function stillNames(file, line, symbol) {
  const lines = sources[file]
  const window = lines.slice(Math.max(0, line - 3), line + 2).join('\n')
  return window.includes(symbol)
}

/** Every 1-based line that mentions the symbol, nearest to `near` first. */
function candidates(file, symbol, near) {
  const lines = sources[file]
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(^|[^\\w$.])${escaped}(?![\\w$])`)
  const hits = []
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) hits.push(index + 1)
  }
  return hits.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b)
}

/**
 * Lines that DECLARE the symbol, nearest to `near` first.
 *
 * "Nearest mention" alone is wrong: `fenceVerdict` is mentioned inside
 * `isTrustedRequest()`'s body one line above its own declaration, and `apply`
 * is mentioned in a dozen doc comments — pointing a contract citation at a call
 * site still passes the verify window (it contains the name) while sending a
 * host implementer to the wrong function. A declaration is what a citation means.
 */
function declarationLines(file, symbol, near) {
  const lines = sources[file]
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const last = escaped.includes('.') ? escaped.split('.').pop() : escaped
  const patterns = [
    // A JSDoc close tag can share the line with the declaration
    // (`*/export function fenceVerdict(...)`), which is how several helpers in
    // index.js are written — without this prefix those citations never resolve.
    new RegExp(`^\\s*(?:\\*/\\s*)?(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${last}\\b`),
    new RegExp(`^\\s*(?:\\*/\\s*)?(?:export\\s+)?(?:const|let|var)\\s+${last}\\b`),
    new RegExp(`^\\s*(?:export\\s+)?(?:class)\\s+${last}\\b`),
  ]
  const hits = []
  for (let index = 0; index < lines.length; index += 1) {
    if (patterns.some(pattern => pattern.test(lines[index]))) hits.push(index + 1)
  }
  return hits.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b)
}

let doc = readFileSync(DOC, 'utf8')
const planned = []
for (const form of FORMS) {
  for (const match of [...doc.matchAll(form.pattern)]) {
    const anchor = form.build(match, match.index)
    if (anchor.symbol === undefined) continue
    if (anchor.oldLine < 1 || anchor.oldLine > sources[anchor.file].length) {
      planned.push({ ...anchor, missing: true })
      continue
    }
    if (forceDefs) {
      const declared = declarationLines(anchor.file, anchor.symbol, anchor.oldLine)[0]
      if (declared === undefined || declared === anchor.oldLine) continue
      planned.push({ ...anchor, target: declared })
      continue
    }
    if (stillNames(anchor.file, anchor.oldLine, anchor.symbol)) continue
    // Prefer the declaration; fall back to the nearest mention only when the
    // symbol is never declared in that file (a re-export, an object key).
    const declared = declarationLines(anchor.file, anchor.symbol, anchor.oldLine)[0]
    const nearest = declared ?? candidates(anchor.file, anchor.symbol, anchor.oldLine)[0]
    if (nearest === undefined) {
      planned.push({ ...anchor, missing: true })
      continue
    }
    planned.push({ ...anchor, target: nearest })
  }
}

const missing = planned.filter(item => item.missing === true)
const fixes = planned.filter(item => item.target !== undefined)

for (const fix of fixes) {
  console.log(`${fix.symbol}  ${fix.raw} → ${fix.file}:${fix.target}  (was ${fix.oldLine})`)
}
for (const item of missing) {
  console.log(`✖ ${item.symbol}  ${item.raw}: symbol not found in ${item.file}`)
}

if (fixes.length === 0) {
  console.log('anchors: all citations still name their symbol')
} else if (checkOnly) {
  console.log(`\nanchors: ${fixes.length} citation(s) would move`)
} else {
  // Replace once per citation, longest raw string first so `index.js:123` never
  // rewrites the first four characters of `index.js:1234`.
  for (const fix of [...fixes].sort((a, b) => b.raw.length - a.raw.length)) {
    doc = doc.split(`\`${fix.raw}\``).join(`\`${fix.file}:${fix.target}\``)
  }
  writeFileSync(DOC, doc, 'utf8')
  console.log(`\nanchors: rewrote ${fixes.length} citation(s) in NODE-HOST-CONTRACT.md`)
}

if (missing.length > 0) process.exit(1)
if (checkOnly && fixes.length > 0) process.exit(1)
