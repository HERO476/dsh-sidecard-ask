// List every @deepseek-ai package versioned inside the installed DSH desktop asar.
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('C:/Users/34332/AppData/Local/Temp/asarx/node_modules/@electron/asar/lib/asar.js').href)
const asar = mod.default ?? mod
const l = asar.listPackage('C:/Users/34332/AppData/Local/Programs/DeepSeek Harness/resources/app.asar')
const pkgs = new Set()
const re = /^\\dsh\\node_modules\\@deepseek-ai\\([^\\]+)\\/ 
for (const p of l) {
  const m = p.match(re)
  if (m) pkgs.add(m[1])
}
console.log([...pkgs].sort().join('\n'))
