import { RUNNER_SLOW_TIMEOUT_MS, RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { DiskUsage, ResourceInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'
import { SECTION_MARKER, splitSections } from './system'

const DISK_MOUNT_POINTS = ['/', '/home', '/mnt/c'] as const

const FAST_SCRIPT = [
  'cat /proc/stat 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'cat /proc/meminfo 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'cat /proc/loadavg 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  "ls /proc 2>/dev/null | grep -c '^[0-9][0-9]*$' || true"
].join('\n')

// df can stall on slow /mnt/c metadata, so it runs separately with the slow
// timeout. Each requested mount gets its own marker; a missing mount simply
// produces an empty block.
const DF_SCRIPT =
  `for m in ${DISK_MOUNT_POINTS.join(' ')}; do ` +
  `printf '${SECTION_MARKER} %s\\n' "$m"; df -P -B1 "$m" 2>/dev/null || true; done`

export interface ProcStatSample {
  totalTicks: number
  idleTicks: number
  cpuCount: number
}

/** Parse /proc/stat: aggregate cpu line ticks plus per-core line count. */
export function parseProcStat(text: string): ProcStatSample | null {
  let agg: { totalTicks: number; idleTicks: number } | null = null
  let cpuCount = 0
  for (const line of text.split('\n')) {
    if (/^cpu\d+\s/.test(line)) {
      cpuCount++
      continue
    }
    if (!/^cpu\s/.test(line)) continue
    const fields = line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((t) => Number.parseInt(t, 10))
    if (fields.length < 4 || fields.slice(0, 4).some((n) => !Number.isFinite(n))) continue
    // user nice system idle iowait irq softirq steal — idle time includes iowait
    const counted = fields.slice(0, 8).filter((n) => Number.isFinite(n))
    const totalTicks = counted.reduce((a, b) => a + b, 0)
    const idleTicks = fields[3] + (Number.isFinite(fields[4]) ? fields[4] : 0)
    agg = { totalTicks, idleTicks }
  }
  return agg === null ? null : { ...agg, cpuCount }
}

export interface MeminfoResult {
  memTotalBytes: number | null
  memAvailableBytes: number | null
  swapTotalBytes: number | null
  swapFreeBytes: number | null
}

/** Parse /proc/meminfo (values reported in kB). */
export function parseMeminfo(text: string): MeminfoResult {
  const kb = new Map<string, number>()
  for (const line of text.split('\n')) {
    const m = /^(\w+):\s+(\d+)\s*kB\s*$/.exec(line)
    if (m) kb.set(m[1], Number.parseInt(m[2], 10))
  }
  const bytes = (key: string): number | null => {
    const v = kb.get(key)
    return v === undefined ? null : v * 1024
  }
  return {
    memTotalBytes: bytes('MemTotal'),
    memAvailableBytes: bytes('MemAvailable'),
    swapTotalBytes: bytes('SwapTotal'),
    swapFreeBytes: bytes('SwapFree')
  }
}

/** Parse /proc/loadavg into its three load figures. */
export function parseLoadavg(text: string): [number, number, number] | null {
  const tokens = text.trim().split(/\s+/)
  if (tokens.length < 3) return null
  const values = tokens.slice(0, 3).map((t) => Number.parseFloat(t))
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return null
  return [values[0], values[1], values[2]]
}

export interface DfRow {
  filesystem: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usePercent: number
  mountedOn: string
}

/** Parse `df -P -B1` output rows (header and malformed lines are skipped). */
export function parseDfP(text: string): DfRow[] {
  const rows: DfRow[] = []
  for (const line of text.split('\n')) {
    const m = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line)
    if (!m) continue
    rows.push({
      filesystem: m[1].trim(),
      totalBytes: Number.parseInt(m[2], 10),
      usedBytes: Number.parseInt(m[3], 10),
      availableBytes: Number.parseInt(m[4], 10),
      usePercent: Number.parseInt(m[5], 10),
      mountedOn: m[6].trim()
    })
  }
  return rows
}

/** Parse the per-mount DF_SCRIPT output into DiskUsage entries. */
export function parseDfBlocks(text: string): DiskUsage[] {
  const blocks = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith(`${SECTION_MARKER} `)) {
      current = []
      blocks.set(t.slice(SECTION_MARKER.length + 1), current)
    } else if (current !== null) {
      current.push(line)
    }
  }
  return DISK_MOUNT_POINTS.map((mountPoint) => {
    const block = blocks.get(mountPoint)
    const row = block === undefined ? undefined : parseDfP(block.join('\n'))[0]
    if (row === undefined) {
      return {
        mountPoint,
        exists: false,
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        usePercent: null
      }
    }
    return {
      mountPoint,
      exists: true,
      totalBytes: row.totalBytes,
      usedBytes: row.usedBytes,
      availableBytes: row.availableBytes,
      usePercent: row.usePercent
    }
  })
}

// CPU% needs two /proc/stat samples; the previous one is kept per distro.
const cpuSamples = new Map<string, { totalTicks: number; idleTicks: number }>()

export function _resetCpuSamples(): void {
  cpuSamples.clear()
}

function cpuPercentFrom(distro: string, sample: ProcStatSample | null): number | null {
  if (sample === null) return null
  const prev = cpuSamples.get(distro)
  cpuSamples.set(distro, { totalTicks: sample.totalTicks, idleTicks: sample.idleTicks })
  if (prev === undefined) return null
  const dTotal = sample.totalTicks - prev.totalTicks
  const dIdle = sample.idleTicks - prev.idleTicks
  // Counters reset (distro restart) or no elapsed ticks — no meaningful delta.
  if (dTotal <= 0 || dIdle < 0 || dIdle > dTotal) return null
  const percent = (100 * (dTotal - dIdle)) / dTotal
  return Math.min(100, Math.max(0, Math.round(percent * 10) / 10))
}

async function runOrNull(
  runner: DistroRunner,
  distro: string,
  script: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    const res = await runner.runInDistro(distro, script, { timeoutMs })
    return res.stdout
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    return null
  }
}

export async function collectResources(
  runner: DistroRunner,
  distro: string
): Promise<ResourceInfo> {
  const [fastOut, dfOut] = await Promise.all([
    runOrNull(runner, distro, FAST_SCRIPT, RUNNER_TIMEOUT_MS),
    runOrNull(runner, distro, DF_SCRIPT, RUNNER_SLOW_TIMEOUT_MS)
  ])

  const sections = splitSections(fastOut ?? '')
  const stat = parseProcStat(sections[0] ?? '')
  const mem = parseMeminfo(sections[1] ?? '')
  const loadAvg = parseLoadavg(sections[2] ?? '')

  let processCount: number | null = null
  const countLine = (sections[3] ?? '').trim().split('\n')[0]?.trim() ?? ''
  if (/^\d+$/.test(countLine)) processCount = Number.parseInt(countLine, 10)

  const memUsedBytes =
    mem.memTotalBytes !== null && mem.memAvailableBytes !== null
      ? Math.max(0, mem.memTotalBytes - mem.memAvailableBytes)
      : null
  const swapUsedBytes =
    mem.swapTotalBytes !== null && mem.swapFreeBytes !== null
      ? Math.max(0, mem.swapTotalBytes - mem.swapFreeBytes)
      : null

  return {
    cpuPercent: cpuPercentFrom(distro, stat),
    cpuCount: stat !== null && stat.cpuCount > 0 ? stat.cpuCount : null,
    memTotalBytes: mem.memTotalBytes,
    memUsedBytes,
    memAvailableBytes: mem.memAvailableBytes,
    swapTotalBytes: mem.swapTotalBytes,
    swapUsedBytes,
    disks: parseDfBlocks(dfOut ?? ''),
    loadAvg,
    processCount
  }
}
