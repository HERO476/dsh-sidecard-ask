/**
 * compat-probe.mjs — build the DSH version-compatibility matrix from the
 * PUBLISHED artifacts, not from notes.
 *
 * For every target DSH version the probe downloads the small set of shipped
 * packages that actually carry each API the plugin depends on (`npm pack` into
 * a cache dir), reads the tarball in memory (gzip + a minimal tar reader, no
 * extraction), and records whether each marker string is present.
 *
 * Usage:
 *   node tools/compat-probe.mjs                 # probe every version below
 *   node tools/compat-probe.mjs 0.1.7-rc.2      # probe selected versions
 *   node tools/compat-probe.mjs --json out.json # also write raw results
 *
 * The result is the evidence table in README §7. A marker that is missing in a
 * version is a real adaptation requirement, not a footnote: it is what the
 * plugin's capability probes must degrade on.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.cache', 'tarballs')

/** Versions probed, oldest → newest (`@deepseek-ai/dsh` release line). */
const VERSIONS = [
  '0.1.2-rc.1',
  '0.1.3-alpha.2',
  '0.1.5-alpha.1',
  '0.1.5-alpha.2',
  '0.1.5-rc.1',
  '0.1.5-rc.2',
  '0.1.5-rc.3',
  '0.1.6-alpha.1',
  '0.1.6-alpha.2',
  '0.1.7-alpha.1',
  '0.1.7-alpha.2',
  '0.1.7-rc.1',
  '0.1.7-rc.2',
]

/**
 * One probe: a package plus the markers the plugin needs from it.
 * `markers` maps a plugin capability to the string that must appear in the
 * package's shipped JavaScript.
 */
const PROBES = [
  {
    package: '@deepseek-ai/dsh-client-modules',
    because: '浏览器半的模块协议（window.__ModuleLoader__.load + dsh.client 清单）',
    markers: {
      moduleLoader: '__ModuleLoader__',
      clientManifest: 'immediately',
      externalList: 'external',
    },
  },
  {
    package: '@deepseek-ai/dsh-client-ui-layout',
    because: '外壳帧：root / shell.overlay（浮层与触发按钮的挂载点）',
    markers: {
      slot_shell_overlay: 'shell.overlay',
      slot_root: '"root"',
      slot_rightbar: 'rightbar',
    },
  },
  {
    package: '@deepseek-ai/dsh-client-ui-conversation',
    because: '会话列：conversation.input.right（会话 id 采集）与输入框标记',
    markers: {
      slot_input_right: 'conversation.input.right',
      slot_composer_dock: 'conversation.composer.dock',
      slot_input_left: 'conversation.input.left',
      dataPhase: 'data-phase',
    },
  },
  {
    package: '@deepseek-ai/dsh-client-ui-renderer',
    because: '槽位渲染器：每个出口的 data-slot 锚点（区域归类依赖它）',
    markers: {
      dataSlotAnchor: 'data-slot',
      slotInject: 'inject',
    },
  },
  {
    package: '@deepseek-ai/dsh-client-ui-settings-general',
    because: '设置页挂载点 settings.section（配置界面）',
    markers: {
      slot_settings_section: 'settings.section',
    },
  },
  {
    package: '@deepseek-ai/dsh-client-ui-sidebar-right',
    because: '原生右侧栏（侧边卡片承载面之一）；0.1.5 起才有此包',
    markers: {
      slot_pane_tab: 'sidebar.right.pane.tab',
      service_sidebarRightTabs: 'sidebarRightTabs',
      mountedObservation: 'mounted',
    },
  },
  {
    package: '@deepseek-ai/dsh-api-session-controller',
    because: '客户端 ctx.sessions（主对话发送）与归档会话门',
    markers: {
      clientSessions: '"sessions"',
      sessionsUsing: 'using(target, options, operation)',
      sessionsRetain: 'retain(target, options)',
      sessionsScope: 'scope(',
      archivedSessionIds: 'archivedSessionIds',
      preStepGate: 'agent/pre-step',
    },
  },
  {
    package: '@deepseek-ai/dsh-agent-loop',
    because: '进程内流式帧 agent/assistant-stream（逐字渲染）',
    markers: {
      assistantStream: 'agent/assistant-stream',
      preStepWaterfall: 'agent/pre-step',
    },
  },
  {
    package: '@deepseek-ai/dsh-session',
    because: '会话事件表：0.1.2 只记持久化的 assistant/chunk，没有进程内帧',
    markers: {
      durableChunk: 'assistant/chunk',
      assistantMessage: 'assistant/message',
      assistantAttempt: 'assistant/attempt',
      sessionEvent: 'session/event',
    },
  },
  {
    package: '@deepseek-ai/dsh-subagent',
    because: '子代理服务（独立侧边卡片作答引擎）',
    markers: {
      subagentsService: 'subagents',
      startMethod: 'start(',
      localAgent: 'localAgent',
      toolFilter: 'toolFilter',
      persona: 'persona',
      continuable: 'startContinuable',
    },
  },
  {
    package: '@deepseek-ai/dsh-host-webserver',
    because: '宿主 HTTP 路由（插件自有 JSON + SSE 接口）',
    markers: {
      registerRoute: 'register(',
      prefixKind: 'prefix',
      routeHandler: 'handler',
    },
  },
  {
    package: '@deepseek-ai/dsh-tools',
    because: 'tools.schemas()（只读白名单与真实工具表求交）',
    markers: {
      schemas: 'schemas(',
      restrict: 'restrict(',
    },
  },
  {
    package: '@deepseek-ai/dsh-workspace',
    because: 'workspaceRegistry.archivedSessionIds（跳过已归档父会话）',
    markers: {
      archivedSessionIds: 'archivedSessionIds',
      archiveSession: 'archiveSession',
    },
  },
]

// ── a minimal tar reader (enough for npm tarballs: ustar + pax long names) ──

/** Read a npm `.tgz` into `Map<path, Buffer>` without touching the disk. */
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

/**
 * Run `npm pack` for one exact version.
 *
 * `execFileSync('npm.cmd', …)` is rejected on Windows by recent Node versions
 * (a `.cmd` needs a shell), so the npm CLI script is invoked through the very
 * node binary running this probe — the layout every npm install of this
 * harness already uses.
 */
function runNpmPack(spec) {
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const args = ['pack', spec, '--pack-destination', CACHE]
  if (existsSync(npmCli)) {
    execFileSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return
  }
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

/** Download one package version into the cache (idempotent). */
function ensureTarball(pkg, version) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true })
  const slug = `${pkg.replace('@', '').replace('/', '__')}@${version}.tgz`
  const target = join(CACHE, slug)
  if (existsSync(target)) return { path: target, cached: true }
  // npm drops the scope's `@` and joins name/version with `-`.
  const npmName = `${pkg.replace('@', '').replace('/', '-')}-${version}.tgz`
  const npmPath = join(CACHE, npmName)
  if (existsSync(npmPath)) {
    writeFileSync(target, readFileSync(npmPath))
    return { path: target, cached: true }
  }
  try {
    runNpmPack(`${pkg}@${version}`)
  } catch (error) {
    const stderr = String(error.stderr ?? error.message).replace(/\s+/g, ' ').slice(0, 200)
    return { path: target, cached: false, error: stderr }
  }
  if (!existsSync(npmPath)) return { path: target, cached: false, error: `npm pack produced no ${npmName}` }
  writeFileSync(target, readFileSync(npmPath))
  return { path: target, cached: false }
}

/** Probe one package version: `{marker: boolean}` plus the files searched. */
function probePackage(pkg, version, markers) {
  const fetched = ensureTarball(pkg, version)
  if (fetched.error !== undefined || !existsSync(fetched.path)) {
    return { available: false, reason: 'package/version not published', markers: {}, bytes: 0 }
  }
  const files = readTarGz(fetched.path)
  const scripts = [...files.entries()].filter(([name]) => /\.(js|mjs|cjs|json)$/.test(name))
  const haystack = scripts.map(([, body]) => body.toString('utf8')).join('\n')
  const result = {}
  for (const [key, needle] of Object.entries(markers)) result[key] = haystack.includes(needle)
  return {
    available: true,
    markers: result,
    bytes: haystack.length,
    files: scripts.length,
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const jsonFlag = args.indexOf('--json')
const jsonPath = jsonFlag === -1 ? undefined : args[jsonFlag + 1]
const requested = args.filter(arg => /^\d/.test(arg))
const versions = requested.length > 0 ? requested : VERSIONS

const matrix = {}
for (const version of versions) {
  matrix[version] = {}
  for (const probe of PROBES) {
    const result = probePackage(probe.package, version, probe.markers)
    matrix[version][probe.package] = result
    const label = result.available
      ? Object.entries(result.markers).map(([key, ok]) => `${ok ? '+' : '−'}${key}`).join(' ')
      : 'ABSENT'
    console.log(`${version.padEnd(15)} ${probe.package.padEnd(44)} ${label}`)
  }
  console.log('')
}

/** A capability is supported when every listed marker is present. */
const CAPABILITIES = [
  ['clientBundle', '@deepseek-ai/dsh-client-modules', ['moduleLoader']],
  ['overlaySlot', '@deepseek-ai/dsh-client-ui-layout', ['slot_shell_overlay']],
  ['composerSlot', '@deepseek-ai/dsh-client-ui-conversation', ['slot_input_right']],
  ['settingsPage', '@deepseek-ai/dsh-client-ui-settings-general', ['slot_settings_section']],
  ['zoneAnchor', '@deepseek-ai/dsh-client-ui-renderer', ['dataSlotAnchor']],
  ['nativeRightbar', '@deepseek-ai/dsh-client-ui-sidebar-right', ['slot_pane_tab', 'service_sidebarRightTabs']],
  ['submitUsing', '@deepseek-ai/dsh-api-session-controller', ['clientSessions', 'sessionsUsing']],
  ['submitRetain', '@deepseek-ai/dsh-api-session-controller', ['clientSessions', 'sessionsRetain']],
  ['archiveGate', '@deepseek-ai/dsh-api-session-controller', ['archivedSessionIds', 'preStepGate']],
  ['streamFrames', '@deepseek-ai/dsh-agent-loop', ['assistantStream']],
  ['durableChunks', '@deepseek-ai/dsh-session', ['durableChunk']],
  ['sideEngine', '@deepseek-ai/dsh-subagent', ['subagentsService', 'startMethod']],
  ['liveChild', '@deepseek-ai/dsh-subagent', ['localAgent']],
  ['providerCaps', '@deepseek-ai/dsh-subagent', ['toolFilter', 'persona']],
  ['toolRegistry', '@deepseek-ai/dsh-tools', ['schemas', 'restrict']],
  ['pluginRoutes', '@deepseek-ai/dsh-host-webserver', ['registerRoute', 'prefixKind']],
]

console.log('\n=== capability matrix ===\n')
const header = ['capability', ...versions]
console.log(`| ${header.join(' | ')} |`)
console.log(`|${header.map(() => '---').join('|')}|`)
const caps = {}
for (const [label, pkg, keys] of CAPABILITIES) {
  const row = [label]
  caps[label] = {}
  for (const version of versions) {
    const entry = matrix[version][pkg]
    const ok = entry.available && keys.every(key => entry.markers[key] === true)
    caps[label][version] = ok
    row.push(ok ? '✅' : '❌')
  }
  console.log(`| ${row.join(' | ')} |`)
}

if (jsonPath !== undefined) {
  writeFileSync(jsonPath, JSON.stringify({ versions, matrix, capabilities: caps }, null, 2))
  console.log(`\nraw results → ${jsonPath}`)
}
