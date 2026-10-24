// Extract the rc.3 CLIENT_SLOT_API catalog from dsh-cordis-client-runner.
const fs = require('fs')

const file = process.argv[2]
const want = process.argv.slice(3)
if (!file) {
  console.error('usage: node slotcatalog.cjs <client.js> [slotKey...]')
  process.exit(2)
}
const src = fs.readFileSync(file, 'utf8')
const marker = 'const CLIENT_SLOT_API = ['
const start = src.indexOf(marker)
if (start < 0) {
  console.error('catalog not found')
  process.exit(1)
}
let i = src.indexOf('[', start)
let depth = 0
let quote = null
let esc = false
let endIdx = -1
for (; i < src.length; i += 1) {
  const ch = src[i]
  if (quote !== null) {
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === quote) quote = null
    continue
  }
  if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
  if (ch === '[') { depth += 1; continue }
  if (ch === ']') {
    depth -= 1
    if (depth === 0) { endIdx = i; break }
  }
}
if (endIdx < 0) {
  console.error('unterminated array')
  process.exit(1)
}
const literal = src.slice(src.indexOf('[', start), endIdx + 1)
const list = new Function('return ' + literal)()
console.log('TOTAL SLOTS: ' + list.length)

const keys = want.length > 0 ? want : list.map((s) => s.key)
for (const key of keys) {
  const s = list.find((x) => x.key === key)
  if (!s) {
    console.log('\n## ' + key + ' => NOT DECLARED IN SHIPPED BUNDLE')
    continue
  }
  console.log('\n## ' + s.key + '   kind=' + s.kind + '  scope=' + s.scope)
  console.log('   registerOptions: ' + JSON.stringify(s.registerOptions))
  console.log('   standardProps: ' + JSON.stringify(s.standardProps))
  console.log('   slotInject: ' + JSON.stringify(s.slotInject))
  console.log('   hookContext: ' + JSON.stringify(s.hookContext))
  console.log('   declaredBy: ' + s.declaredBy)
  console.log('   occupants: ' + JSON.stringify(s.occupants))
  const owner = (s.ownerProps || []).map((p) => String(p).split('\n')[1] || String(p).split('\n')[0])
  console.log('   ownerProps: ' + JSON.stringify(owner))
}
