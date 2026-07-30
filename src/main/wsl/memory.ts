import { readFile } from 'fs/promises'
import { homedir, totalmem } from 'os'
import { join } from 'path'
import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { MemoryReconciliation } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'
import { parseMeminfoKb } from './resources'
import { runHostCommand, type HostCommandRunner } from './windows-ports'

/**
 * Windows-vs-Linux memory reconciliation (microsoft/WSL#4166). Task Manager's
 * vmmemWSL, `free` inside the distro and the .wslconfig ceiling never agree,
 * and nothing in Windows says the difference is Linux page cache. This reads
 * all three sides so the Dashboard can name each number. Read-only: handing
 * the memory back is a prepared command the user runs (goal.md §2.2).
 */

const TASKLIST_TIMEOUT_MS = 8000
const MEMINFO_SCRIPT = 'cat /proc/meminfo 2>/dev/null || true'

/** "Image Name","PID","Session Name","Session#","Mem Usage" — all fields quoted. */
const TASKLIST_ROW_RE = /^"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"/

/** Current builds name the VM process vmmemWSL; older ones just vmmem. */
const VM_PROCESS_NAME = 'vmmemwsl'
const VM_PROCESS_LEGACY_NAME = 'vmmem'

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4
}

export interface GuestMemory {
  totalBytes: number | null
  usedBytes: number | null
  cacheBytes: number | null
  freeBytes: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
}

/**
 * The split `free(1)` prints: buff/cache is Buffers + Cached + SReclaimable and
 * used is what is left after free and that cache, which is exactly the figure
 * users compare against vmmem.
 */
export function parseGuestMemory(text: string): GuestMemory {
  const kb = parseMeminfoKb(text)
  const bytes = (key: string): number | null => {
    const v = kb.get(key)
    return v === undefined ? null : v * 1024
  }
  const total = bytes('MemTotal')
  const free = bytes('MemFree')
  const buffers = bytes('Buffers')
  const cached = bytes('Cached')
  // SReclaimable is missing on very old kernels; free(1) counts it as zero.
  const reclaimableSlab = bytes('SReclaimable') ?? 0
  const swapTotal = bytes('SwapTotal')
  const swapFree = bytes('SwapFree')

  const cache = buffers === null || cached === null ? null : buffers + cached + reclaimableSlab
  const used =
    total === null || free === null || cache === null ? null : Math.max(0, total - free - cache)

  return {
    totalBytes: total,
    usedBytes: used,
    cacheBytes: cache,
    freeBytes: free,
    swapTotalBytes: swapTotal,
    swapUsedBytes:
      swapTotal === null || swapFree === null ? null : Math.max(0, swapTotal - swapFree)
  }
}

/**
 * Working set of the WSL VM process from `tasklist /fo csv /nh`. The Mem Usage
 * column is localized ("7,340,032 K", "7.340.032 K"), so only its digits are
 * read. vmmemWSL wins over a legacy vmmem row, and the largest row wins when a
 * name appears twice — never a sum, which would double-count another VM.
 */
export function parseVmProcessMemory(text: string): number | null {
  let current: number | null = null
  let legacy: number | null = null
  for (const raw of text.split('\n')) {
    const row = TASKLIST_ROW_RE.exec(raw.trim())
    if (row === null) continue
    const name = row[1].toLowerCase().replace(/\.exe$/, '')
    if (name !== VM_PROCESS_NAME && name !== VM_PROCESS_LEGACY_NAME) continue
    const digits = row[3].replace(/\D/g, '')
    if (digits === '') continue
    const value = Number.parseInt(digits, 10) * 1024
    if (name === VM_PROCESS_NAME) current = Math.max(current ?? 0, value)
    else legacy = Math.max(legacy ?? 0, value)
  }
  return current ?? legacy
}

export interface WslConfigMemorySettings {
  /** [wsl2] memory=, in bytes; null when unset or not a documented size. */
  memoryBytes: number | null
  /** [experimental] autoMemoryReclaim=; null when unset. */
  autoMemoryReclaim: string | null
}

/** `8GB`, `512MB`, `2048kb`. A bare number has no documented unit → unknown. */
function parseSize(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]{1,2})$/i.exec(value.trim())
  if (m === null) return null
  const unit = SIZE_UNITS[m[2].toLowerCase()]
  if (unit === undefined) return null
  const size = Number.parseFloat(m[1]) * unit
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : null
}

/**
 * The two .wslconfig keys this section needs. Section membership is enforced:
 * `memory` outside [wsl2] and `autoMemoryReclaim` outside [experimental] are
 * not applied by WSL, so they are not reported as being in effect either.
 */
export function parseWslConfigMemory(text: string): WslConfigMemorySettings {
  let section = ''
  let memoryBytes: number | null = null
  let autoMemoryReclaim: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[([^\]]*)\]$/.exec(line)
    if (header !== null) {
      section = header[1].trim().toLowerCase()
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (section === 'wsl2' && key === 'memory') memoryBytes = parseSize(value)
    if (section === 'experimental' && key === 'automemoryreclaim' && value !== '') {
      autoMemoryReclaim = value.toLowerCase()
    }
  }
  return { memoryBytes, autoMemoryReclaim }
}

/** .wslconfig is hand-edited, so Notepad's UTF-16LE and UTF-8 BOMs both occur. */
function decodeIni(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').slice(1)
  const text = buf.toString('utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export interface MemoryCollector {
  collect(runner: DistroRunner, distro: string): Promise<MemoryReconciliation>
}

export interface MemoryCollectorOptions {
  /** Windows console tool runner; the real spawn by default. */
  run?: HostCommandRunner
  /** Defaults to %USERPROFILE%\.wslconfig. */
  wslconfigPath?: string
  /** Host physical RAM; os.totalmem() costs nothing and needs no dependency. */
  hostTotalBytes?: () => number
}

function ceilingOf(
  declaredBytes: number | null,
  hostTotalBytes: number | null
): Pick<MemoryReconciliation, 'vmLimitBytes' | 'vmLimitSource'> {
  if (declaredBytes !== null) {
    return { vmLimitBytes: declaredBytes, vmLimitSource: 'wslconfig' }
  }
  // Documented WSL2 default on current builds: half of host RAM.
  if (hostTotalBytes !== null) {
    return { vmLimitBytes: Math.floor(hostTotalBytes / 2), vmLimitSource: 'computed-default' }
  }
  return { vmLimitBytes: null, vmLimitSource: 'unknown' }
}

export function createMemoryCollector(options: MemoryCollectorOptions = {}): MemoryCollector {
  const run = options.run ?? runHostCommand
  const wslconfigPath = options.wslconfigPath ?? join(homedir(), '.wslconfig')
  const hostTotal = options.hostTotalBytes ?? totalmem

  const readGuest = async (runner: DistroRunner, distro: string): Promise<string> => {
    try {
      const res = await runner.runInDistro(distro, MEMINFO_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
      return res.stdout
    } catch (err) {
      if (err instanceof WslNotAvailableError) throw err
      return ''
    }
  }

  const readVmProcess = async (): Promise<number | null> => {
    try {
      return parseVmProcessMemory(await run('tasklist', ['/fo', 'csv', '/nh'], TASKLIST_TIMEOUT_MS))
    } catch {
      // No Windows process view — the VM figure stays unknown, never zero.
      return null
    }
  }

  const readConfig = async (): Promise<WslConfigMemorySettings> => {
    try {
      return parseWslConfigMemory(decodeIni(await readFile(wslconfigPath)))
    } catch {
      // Absent .wslconfig is the common case, not a failure.
      return { memoryBytes: null, autoMemoryReclaim: null }
    }
  }

  const readHostTotal = (): number | null => {
    try {
      const total = hostTotal()
      return Number.isFinite(total) && total > 0 ? total : null
    } catch {
      return null
    }
  }

  return {
    async collect(runner: DistroRunner, distro: string): Promise<MemoryReconciliation> {
      const [meminfo, vmmemWorkingSetBytes, config] = await Promise.all([
        readGuest(runner, distro),
        readVmProcess(),
        readConfig()
      ])
      const guest = parseGuestMemory(meminfo)
      const hostTotalBytes = readHostTotal()
      return {
        hostTotalBytes,
        ...ceilingOf(config.memoryBytes, hostTotalBytes),
        vmmemWorkingSetBytes,
        guestTotalBytes: guest.totalBytes,
        guestUsedBytes: guest.usedBytes,
        guestCacheBytes: guest.cacheBytes,
        guestFreeBytes: guest.freeBytes,
        swapTotalBytes: guest.swapTotalBytes,
        swapUsedBytes: guest.swapUsedBytes,
        autoMemoryReclaim: config.autoMemoryReclaim
      }
    }
  }
}
