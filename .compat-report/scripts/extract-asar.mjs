// Extract the @deepseek-ai tree (and dsh/package.json) from the installed desktop asar.
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('C:/Users/34332/AppData/Local/Temp/asarx/node_modules/@electron/asar/lib/asar.js').href)
const asar = mod.default ?? mod
const out = 'D:/Users/34332/AI/dsh-sidecard-ask/.compat-report/evidence/dsh-0.2.1-rc.3'
await asar.extractAll(
  'C:/Users/34332/AppData/Local/Programs/DeepSeek Harness/resources/app.asar',
  out,
  'dsh/node_modules/@deepseek-ai',
)
console.log('done', out)
