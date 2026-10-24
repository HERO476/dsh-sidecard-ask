import { statSync } from 'node:fs'
import { createHash } from 'node:crypto'
const p = 'D:/Users/34332/AI/dsh-sidecard-ask/client.js'
const s = statSync(p)
const LEN = 12
const framedHash = (domain, parts) => {
  const hash = createHash('sha1').update(domain).update('\0')
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part)
  return hash.digest('hex').slice(0, LEN)
}
const rev = framedHash('plugin-artifact', [String(s.mtimeMs), String(s.ctimeMs), String(s.size)])
console.log(JSON.stringify({ rev, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size }))
