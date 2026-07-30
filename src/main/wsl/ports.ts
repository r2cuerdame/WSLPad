import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { PortInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'

const SS_SCRIPT = 'ss -tulnpH 2>/dev/null || true'

// users:(("name",pid=123,fd=4),...) — only the first owner is surfaced.
const USERS_RE = /users:\(\("([^"]*)",pid=(\d+)/

/** Parse `ss -tulnpH` output into PortInfo entries. */
export function parseSs(text: string): PortInfo[] {
  const out: PortInfo[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 6) continue
    const netid = tokens[0]
    if (netid !== 'tcp' && netid !== 'udp') continue
    const state = tokens[1]
    const local = tokens[4]
    const sep = local.lastIndexOf(':')
    if (sep <= 0) continue
    const portStr = local.slice(sep + 1)
    if (!/^\d+$/.test(portStr)) continue
    const port = Number.parseInt(portStr, 10)
    if (port < 0 || port > 65535) continue
    const localAddress = local.slice(0, sep)
    const isV6 = localAddress.includes('[')
    const protocol: PortInfo['protocol'] =
      netid === 'tcp' ? (isV6 ? 'tcp6' : 'tcp') : isV6 ? 'udp6' : 'udp'
    const listening = netid === 'tcp' ? state === 'LISTEN' : state === 'UNCONN'
    const users = USERS_RE.exec(line)
    const isTcp = protocol === 'tcp' || protocol === 'tcp6'
    out.push({
      protocol,
      localAddress,
      port,
      pid: users === null ? null : Number.parseInt(users[2], 10),
      processName: users === null || users[1] === '' ? null : users[1],
      listening,
      localhostUrl: listening && isTcp && port >= 80 ? `http://localhost:${port}` : null,
      // Correlated against the Windows port table later; unknown until then.
      windowsBound: null,
      windowsProcess: null,
      // Reachability needs the Windows table and the firewall, neither of which
      // this parser sees: it stays unknown rather than claiming a scope.
      reachability: 'unknown',
      reachabilityReason: null
    })
  }
  return out
}

export async function collectPorts(runner: DistroRunner, distro: string): Promise<PortInfo[]> {
  try {
    const res = await runner.runInDistro(distro, SS_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
    return parseSs(res.stdout)
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    return []
  }
}
