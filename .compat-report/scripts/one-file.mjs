// Extract one file (or a subtree) from the installed desktop asar for read-only contract checks.
// usage: node one-file.mjs <asar-inner-path> <out-dir>
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('C:/Users/34332/AppData/Local/Temp/asarx/node_modules/@electron/asar/lib/asar.js').href)
const asar = mod.default ?? mod
const inner = process.argv[2]
const out = process.argv[3] ?? 'D:/Users/34332/AI/dsh-sidecard-ask/.compat-report/tmp'
await asar.extractAll(
  'C:/Users/34332/AppData/Local/Programs/DeepSeek Harness/resources/app.asar',
  out,
  inner,
)
console.log('done', inner, '->', out)
