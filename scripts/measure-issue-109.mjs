// Run the two real Windows host collectors from either the base or current
// source without switching branches or launching/stopping a user's WSLPad.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const variant = process.argv[2]
const seconds = Number(process.argv[3] ?? 60)
if (!['base', 'head'].includes(variant) || !Number.isFinite(seconds) || seconds < 60) {
  throw new Error('Usage: node scripts/measure-issue-109.mjs base|head [seconds >= 60]')
}

const root = resolve(import.meta.dirname, '..')
const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
  cwd: root,
  encoding: 'utf8'
}).trim()
const collectorPaths = ['src/main/wsl/memory.ts', 'src/main/wsl/windows-ports.ts']
const sources = new Map(
  collectorPaths.map((path) => [
    resolve(root, path),
    variant === 'base'
      ? execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8' })
      : readFileSync(resolve(root, path), 'utf8')
  ])
)

const result = await build({
  stdin: {
    contents: `export { createMemoryCollector } from './src/main/wsl/memory';
export { createWindowsPortCollector, runHostCommand } from './src/main/wsl/windows-ports';`,
    resolveDir: root,
    sourcefile: 'issue-109-entry.ts',
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'issue-109-source',
      setup(plugin) {
        plugin.onResolve({ filter: /^@shared\// }, ({ path }) => ({
          path: resolve(root, 'src/shared', `${path.slice('@shared/'.length)}.ts`)
        }))
        plugin.onLoad({ filter: /src[\\/]main[\\/]wsl[\\/](memory|windows-ports)\.ts$/ },
          ({ path }) => ({ contents: sources.get(path), loader: 'ts' }))
      }
    }
  ]
})
const localModule = { exports: {} }
new Function('module', 'exports', 'require', result.outputFiles[0].text)(
  localModule,
  localModule.exports,
  createRequire(import.meta.url)
)
const { createMemoryCollector, createWindowsPortCollector, runHostCommand } = localModule.exports

const calls = { netstat: 0, tasklist: 0 }
const childWallMs = { netstat: 0, tasklist: 0 }
const hostProcess = () => {
  const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}'; $g = Get-Process -Id ${process.pid}; [pscustomobject]@{ ProcessId = $p.ProcessId; ThreadCount = $p.ThreadCount; ReadTransferCount = $p.ReadTransferCount; WriteTransferCount = $p.WriteTransferCount; PeakWorkingSetBytes = $g.PeakWorkingSet64 } | ConvertTo-Json -Compress`
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8'
  }))
}
const run = async (file, args, timeout) => {
  const start = performance.now()
  calls[file]++
  try {
    return await runHostCommand(file, args, timeout)
  } finally {
    childWallMs[file] += performance.now() - start
  }
}
const ports = createWindowsPortCollector(run)
const memory = createMemoryCollector({ run })
const guest = { runInDistro: async () => ({ stdout: '' }) }
const firstProcess = hostProcess()
const start = performance.now()
const cpuStart = process.cpuUsage()
let ticks = 0
for (let tick = 0; tick * 3000 <= seconds * 1000; tick++) {
  const delay = start + tick * 3000 - performance.now()
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  await Promise.all([ports.collect(), memory.collect(guest, 'synthetic')])
  ticks++
}
const cpu = process.cpuUsage(cpuStart)
const lastProcess = hostProcess()
console.log(JSON.stringify({
  variant,
  base,
  durationMs: Math.round(performance.now() - start),
  ticks,
  calls,
  childWallMs: Object.fromEntries(Object.entries(childWallMs).map(([k, v]) => [k, Math.round(v)])),
  nodeCpuMs: Math.round((cpu.user + cpu.system) / 1000),
  peakWorkingSetBytes: Number(lastProcess.PeakWorkingSetBytes),
  nodeThreadCount: { start: firstProcess.ThreadCount, end: lastProcess.ThreadCount },
  nodeIoBytes: {
    read: Number(lastProcess.ReadTransferCount) - Number(firstProcess.ReadTransferCount),
    write: Number(lastProcess.WriteTransferCount) - Number(firstProcess.WriteTransferCount)
  }
}))
