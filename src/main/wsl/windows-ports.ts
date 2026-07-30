import { spawn, type ChildProcess } from 'child_process'
import type { PortInfo, PortProtocol, WindowsPortInfo } from '@shared/types'

/**
 * Windows-side listener table (goal.md §6.10, extended). This is a HOST query:
 * it deliberately does not go through the hidden runner's distro path, so the
 * Windows view stays readable even when no distro is running.
 */

const NETSTAT_TIMEOUT_MS = 8000
const TASKLIST_TIMEOUT_MS = 8000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/** "Name","PID",... — tasklist quotes every field, including the image name. */
const TASKLIST_ROW_RE = /^"([^"]*)","(\d+)"/

interface Endpoint {
  host: string
  port: number
  v6: boolean
}

/** `127.0.0.1:8080`, `[::]:8080`, `[fe80::1%12]:5353`; `*:*` yields null. */
function parseEndpoint(text: string): Endpoint | null {
  const bracket = /^\[(.*)\]:(\d+)$/.exec(text)
  if (bracket !== null) {
    const port = Number.parseInt(bracket[2], 10)
    return port > 65535 ? null : { host: `[${bracket[1]}]`, port, v6: true }
  }
  const sep = text.lastIndexOf(':')
  if (sep <= 0) return null
  const portText = text.slice(sep + 1)
  if (!/^\d+$/.test(portText)) return null
  const port = Number.parseInt(portText, 10)
  return port > 65535 ? null : { host: text.slice(0, sep), port, v6: false }
}

/**
 * A listening socket has no peer: `0.0.0.0:0`, `[::]:0` or `*:*`. netstat
 * translates the STATE word on localized Windows, so the peer address — not
 * the word "LISTENING" — is the reliable signal.
 */
function hasNoPeer(foreign: string): boolean {
  const ep = parseEndpoint(foreign)
  return ep === null ? foreign.endsWith(':*') : ep.port === 0
}

/**
 * Parse `netstat -ano` positionally: PROTO, local, foreign, [STATE], [PID].
 * Header and state words are localized, so nothing is matched by text; only
 * listeners are returned.
 */
export function parseNetstat(text: string): WindowsPortInfo[] {
  const out: WindowsPortInfo[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const tokens = line.split(/\s+/)
    if (tokens.length < 3) continue
    const proto = tokens[0].toUpperCase()
    const isTcp = proto === 'TCP'
    if (!isTcp && proto !== 'UDP') continue
    const local = parseEndpoint(tokens[1])
    if (local === null) continue
    // UDP rows carry no STATE column and are always treated as listening.
    const state = isTcp && tokens.length >= 5 ? tokens[3] : null
    if (isTcp && !/^listen/i.test(state ?? '') && !hasNoPeer(tokens[2])) continue
    const last = tokens[tokens.length - 1]
    const pid = tokens.length > 3 && /^\d+$/.test(last) ? Number.parseInt(last, 10) : null
    const protocol: PortProtocol = isTcp ? (local.v6 ? 'tcp6' : 'tcp') : local.v6 ? 'udp6' : 'udp'
    out.push({
      protocol,
      localAddress: local.host,
      port: local.port,
      pid,
      processName: null,
      listening: true,
      // Same rule as the Linux collector (src/main/wsl/ports.ts).
      localhostUrl: isTcp && local.port >= 80 ? `http://localhost:${local.port}` : null,
      fromWsl: false
    })
  }
  return out
}

/** Parse `tasklist /fo csv /nh` into pid → image name. */
export function parseTasklistCsv(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const raw of text.split('\n')) {
    const row = TASKLIST_ROW_RE.exec(raw.trim())
    if (row === null || row[1] === '') continue
    const pid = Number.parseInt(row[2], 10)
    if (!out.has(pid)) out.set(pid, row[1])
  }
  return out
}

const family = (protocol: PortProtocol): 'tcp' | 'udp' =>
  protocol === 'tcp' || protocol === 'tcp6' ? 'tcp' : 'udp'

const key = (protocol: PortProtocol, port: number): string => `${family(protocol)}:${port}`

export interface CorrelatedPorts {
  ports: PortInfo[]
  windowsPorts: WindowsPortInfo[]
}

/**
 * Join both sides on protocol family + port. Under WSL2 NAT the Windows owner
 * is wslrelay/wslhost/svchost, so process names are never part of the match.
 * `windowsPorts === null` means the Windows table is unknown (not empty) and
 * every WSL port keeps windowsBound = null.
 */
export function correlatePorts(
  wslPorts: PortInfo[],
  windowsPorts: WindowsPortInfo[] | null
): CorrelatedPorts {
  if (windowsPorts === null) {
    return {
      ports: wslPorts.map((p) => ({ ...p, windowsBound: null, windowsProcess: null })),
      windowsPorts: []
    }
  }
  const byPort = new Map<string, WindowsPortInfo>()
  for (const w of windowsPorts) {
    const existing = byPort.get(key(w.protocol, w.port))
    if (existing === undefined || (existing.processName === null && w.processName !== null)) {
      byPort.set(key(w.protocol, w.port), w)
    }
  }
  const wslKeys = new Set(wslPorts.filter((p) => p.listening).map((p) => key(p.protocol, p.port)))
  return {
    ports: wslPorts.map((p) => {
      const match = byPort.get(key(p.protocol, p.port))
      return {
        ...p,
        windowsBound: match !== undefined,
        windowsProcess: match?.processName ?? null
      }
    }),
    windowsPorts: windowsPorts.map((w) => ({
      ...w,
      fromWsl: wslKeys.has(key(w.protocol, w.port))
    }))
  }
}

/** Runs a Windows console tool and returns its stdout; rejects on failure. */
export type HostCommandRunner = (file: string, args: string[], timeoutMs: number) => Promise<string>

function decodeOutput(buf: Buffer): string {
  // Localized netstat text may be OEM-encoded; only the ASCII columns are
  // parsed, and invalid sequences degrade to U+FFFD without shifting bytes.
  const text = buf.toString('utf8').replace(/\0/g, '').replace(/\r\n/g, '\n')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export const runHostCommand: HostCommandRunner = (file, args, timeoutMs) =>
  new Promise<string>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const chunks: Buffer[] = []
    let bytes = 0
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (bytes >= MAX_OUTPUT_BYTES) return
      bytes += chunk.length
      chunks.push(chunk)
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`${file} timed out after ${timeoutMs}ms`))
        return
      }
      const text = decodeOutput(Buffer.concat(chunks))
      if (code !== 0 && text.trim() === '') {
        reject(new Error(`${file} exited with code ${code}`))
        return
      }
      resolve(text)
    })
  })

export interface WindowsPortCollector {
  /** Rejects when the Windows port table cannot be read at all. */
  collect(): Promise<WindowsPortInfo[]>
}

export function createWindowsPortCollector(
  run: HostCommandRunner = runHostCommand
): WindowsPortCollector {
  // pid → image name for the life of the collector; an unknown pid triggers
  // exactly one refresh, since Windows reuses pids over time.
  const nameByPid = new Map<number, string>()
  // Pids a refresh could not name — remembered so every poll does not re-run
  // tasklist for a process that simply is not listed.
  const unnamedPids = new Set<number>()

  const refreshNames = async (): Promise<void> => {
    const args = ['/fo', 'csv', '/nh']
    try {
      const parsed = parseTasklistCsv(await run('tasklist', args, TASKLIST_TIMEOUT_MS))
      if (parsed.size === 0) return
      nameByPid.clear()
      unnamedPids.clear()
      for (const [pid, name] of parsed) nameByPid.set(pid, name)
    } catch {
      // Names are optional — ports stay visible without them.
    }
  }

  return {
    async collect(): Promise<WindowsPortInfo[]> {
      const ports = parseNetstat(await run('netstat', ['-ano'], NETSTAT_TIMEOUT_MS))
      const pids = ports.map((p) => p.pid).filter((pid): pid is number => pid !== null)
      if (pids.some((pid) => !nameByPid.has(pid) && !unnamedPids.has(pid))) {
        await refreshNames()
        for (const pid of pids) if (!nameByPid.has(pid)) unnamedPids.add(pid)
      }
      return ports.map((p) => ({
        ...p,
        processName: p.pid === null ? null : (nameByPid.get(p.pid) ?? null)
      }))
    }
  }
}
