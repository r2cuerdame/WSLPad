import type { PortProxyInfo, PortProxyRule } from '@shared/types'
import { runHostCommand, type HostCommandRunner } from './windows-ports'

/**
 * Windows port-forwarding rules, judged against the address the distro
 * actually has right now (issue #53).
 *
 * Under the default NAT networking mode WSL hands the VM a new IP on every
 * restart. The standard recipe for reaching a dev server from another machine
 * — `netsh interface portproxy add v4tov4 … connectaddress=<WSL IP>` — is
 * therefore correct for exactly one boot. After the next one the rule still
 * exists, still looks right, and forwards into nothing. Windows reports no
 * error and no tool puts the rule next to the current address.
 *
 * This is a HOST read and strictly read-only: WSLPad never adds, edits or
 * deletes a portproxy rule (goal.md §2.2). Changing one needs an elevated
 * shell, so the corrective command is offered as copyable text, never run.
 */

/**
 * Absolute path: a bare image name is resolved against the process working
 * directory before System32, so a netsh.exe dropped next to the app would win.
 * SystemRoot is used when set, with the conventional path as the fallback.
 */
const NETSH = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\netsh.exe`
const NETSH_ARGS = ['interface', 'portproxy', 'show', 'v4tov4']
const PORTPROXY_TIMEOUT_MS = 6000

/**
 * Forwarding rules are edited by hand, never by the second, and each read is a
 * process start. One answer serves this long so the medium tier does not spawn
 * a netsh every poll.
 */
const DEFAULT_TTL_MS = 60000

export const UNREADABLE = 'The Windows port forwarding table could not be read'

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null
  const port = Number.parseInt(text, 10)
  return port > 0 && port <= 65535 ? port : null
}

/**
 * `netsh interface portproxy show v4tov4` prints a localized two-line heading,
 * a rule of dashes, then one row per rule with four positional columns:
 * listen address, listen port, connect address, connect port. Only the heading
 * is translated, so rows are recognised by their shape — two addresses and two
 * ports — and never by a column name.
 */
export function parsePortProxy(text: string): PortProxyRule[] {
  const rules: PortProxyRule[] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const cells = raw.trim().split(/\s+/)
    if (cells.length !== 4) continue
    const listenPort = parsePort(cells[1])
    const connectPort = parsePort(cells[3])
    // '*' is a legal listen address in netsh output and means every address.
    const listenAddress = cells[0] === '*' ? '0.0.0.0' : cells[0]
    if (listenPort === null || connectPort === null) continue
    if (!IPV4.test(listenAddress) || !IPV4.test(cells[2])) continue
    rules.push({
      listenAddress,
      listenPort,
      connectAddress: cells[2],
      connectPort,
      verdict: 'unknown'
    })
  }
  return rules
}

/** Loopback and the unspecified address forward to Windows itself, not to WSL. */
function isLocalAddress(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '0.0.0.0'
}

/**
 * A rule is only called stale when the distro's address is known and differs.
 * With no address to compare against, every rule stays unknown — a forwarding
 * rule reported as dead when it is merely unverifiable would send the user to
 * fix something that works.
 */
export function judgeRules(
  rules: readonly PortProxyRule[],
  distroIp: string | null
): PortProxyRule[] {
  return rules.map((rule) => {
    if (distroIp === null) return { ...rule, verdict: 'unknown' as const }
    if (rule.connectAddress === distroIp) return { ...rule, verdict: 'live' as const }
    // Forwarding to Windows itself is a deliberate, still-working setup.
    if (isLocalAddress(rule.connectAddress)) return { ...rule, verdict: 'elsewhere' as const }
    // A private address that is not this distro is the classic stale rule: it
    // was this distro's IP, one WSL restart ago.
    return { ...rule, verdict: 'stale' as const }
  })
}

/** The elevated command that would replace a stale rule — copied, never run. */
export function repairCommand(rule: PortProxyRule, distroIp: string): string {
  return (
    `netsh interface portproxy set v4tov4 listenaddress=${rule.listenAddress} ` +
    `listenport=${rule.listenPort} connectaddress=${distroIp} connectport=${rule.connectPort}`
  )
}

export interface PortProxyCollector {
  /** Never rejects: an unreadable table is a PortProxyInfo carrying the reason. */
  collect(distroIp: string | null): Promise<PortProxyInfo>
}

export interface PortProxyCollectorOptions {
  run?: HostCommandRunner
  ttlMs?: number
  now?: () => number
}

export function createPortProxyCollector(
  options: PortProxyCollectorOptions = {}
): PortProxyCollector {
  const run = options.run ?? runHostCommand
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? Date.now
  let cached: { at: number; rules: PortProxyRule[]; error: string | null } | null = null

  return {
    async collect(distroIp: string | null): Promise<PortProxyInfo> {
      if (cached === null || now() - cached.at >= ttlMs) {
        try {
          const out = await run(NETSH, NETSH_ARGS, PORTPROXY_TIMEOUT_MS)
          cached = { at: now(), rules: parsePortProxy(out), error: null }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          // Keep the rules that were read last time: a transient netsh failure
          // must not turn into "there are no forwarding rules" for a whole
          // minute. The error rides alongside so the reader knows the table is
          // not fresh.
          cached = {
            at: now(),
            rules: cached?.rules ?? [],
            error: `${UNREADABLE}: ${message}`.slice(0, 400)
          }
        }
      }
      // The verdicts are recomputed every call: the rules change rarely, the
      // distro's address changes on every WSL restart.
      return {
        rules: judgeRules(cached.rules, distroIp),
        distroIp,
        error: cached.error
      }
    }
  }
}
