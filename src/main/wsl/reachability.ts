import type { FirewallInfo, PortInfo, PortReachability } from '@shared/types'

/**
 * Why a listener that Linux happily reports is still refused (issue #24).
 * Three independent facts decide it: where the socket is bound inside the
 * distro, which networking mode WSL really ended up in — microsoft/WSL#13454
 * is the thread about mirrored silently falling back to NAT — and whether the
 * Hyper-V firewall lets inbound traffic into the VM at all.
 *
 * This is a pure function on purpose. It reads no files and spawns nothing, so
 * the whole matrix is unit-testable, and any input it was not given makes the
 * verdict 'unknown' rather than a confident wrong answer.
 */

export interface ReachabilityVerdict {
  reachability: PortReachability
  /** Short English explanation; null only when there is nothing to explain. */
  reason: string | null
}

/** Where the socket is bound inside the distro. */
export type BindScope = 'loopback' | 'wildcard' | 'address'

export type NetworkingMode = 'nat' | 'mirrored' | 'unknown'

/** What the Hyper-V firewall does with inbound traffic to the WSL VM. */
export type InboundPolicy = 'blocked' | 'allowed' | 'unknown'

const LOOPBACK_RE = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i
const WILDCARD = new Set(['0.0.0.0', '::', '*', '', '::ffff:0.0.0.0'])

const NOT_LISTENING = 'The socket is not accepting connections, so nothing can reach it.'

const MODE_UNKNOWN =
  'The effective WSL networking mode could not be read, so how far this port carries is unknown.'

const FIREWALL_UNKNOWN =
  'The Hyper-V firewall state could not be read, so whether inbound traffic reaches the ' +
  'distribution is unknown.'

const WINDOWS_TABLE_UNKNOWN =
  'The Windows listener table could not be read, so whether Windows forwards this port is unknown.'

/**
 * `ss` prints v6 hosts in brackets, sometimes a bare `*` for "any", and can
 * append a zone index; both spellings of the same socket must classify alike.
 */
export function classifyBindAddress(address: string): BindScope {
  const host = address.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/%.*$/, '')
  if (WILDCARD.has(host)) return 'wildcard'
  return LOOPBACK_RE.test(host) ? 'loopback' : 'address'
}

/** Anything that is not plainly nat or mirrored decides nothing. */
export function normalizeNetworkingMode(mode: string | null): NetworkingMode {
  const value = (mode ?? '').trim().toLowerCase()
  if (value === 'nat') return 'nat'
  return value === 'mirrored' ? 'mirrored' : 'unknown'
}

/**
 * A layer that is switched off filters nothing, so that reads as allowed. A
 * layer whose own enablement is unreadable decides nothing either way, even
 * when the default action itself came back — an unenforced Block is not a
 * block, and pretending otherwise would invent a reason for a working port.
 */
export function inboundPolicy(firewall: FirewallInfo | null): InboundPolicy {
  if (firewall === null) return 'unknown'
  if (firewall.enabled === false) return 'allowed'
  if (firewall.enabled === null) return 'unknown'
  const action = firewall.defaultInbound ?? ''
  if (/^block/i.test(action)) return 'blocked'
  return /^allow/i.test(action) ? 'allowed' : 'unknown'
}

const unknown = (reason: string): ReachabilityVerdict => ({ reachability: 'unknown', reason })

/**
 * Mirrored networking: the distro shares the host's own interfaces, so a
 * listener is on the host addresses directly and the Windows listener table
 * says nothing about it — only the firewall decides. Host-to-VM localhost
 * traffic rides the loopback exemption, which is on by default; only a read
 * that comes back explicitly off is treated as off.
 */
function mirroredVerdict(
  port: PortInfo,
  scope: BindScope,
  firewall: FirewallInfo | null
): ReachabilityVerdict {
  const loopbackOff = firewall?.loopbackEnabled === false
  if (scope === 'loopback') {
    return loopbackOff
      ? {
          reachability: 'loopback-only',
          reason:
            `Bound to ${port.localAddress} inside the distribution, and the Hyper-V ` +
            'firewall has loopback traffic to the WSL virtual machine turned off, so ' +
            'not even this PC can connect.'
        }
      : {
          reachability: 'windows-only',
          reason:
            'Mirrored networking shares the host loopback, so this PC reaches it on localhost; a ' +
            'loopback address is never visible from the network.'
        }
  }
  const inbound = inboundPolicy(firewall)
  if (inbound === 'allowed') {
    return {
      reachability: 'lan',
      reason:
        'Mirrored networking puts it straight on the host network interfaces and the Hyper-V ' +
        'firewall allows inbound traffic, so other machines can reach it.'
    }
  }
  if (inbound === 'blocked') {
    return loopbackOff
      ? {
          reachability: 'loopback-only',
          reason:
            'The Hyper-V firewall blocks inbound traffic to the WSL virtual machine and loopback ' +
            'traffic is turned off too, so only processes inside the distribution can connect.'
        }
      : {
          reachability: 'windows-only',
          reason:
            'Mirrored networking puts it on the host network interfaces, but the ' +
            'Hyper-V firewall blocks inbound traffic by default, so only this PC ' +
            `reaches port ${port.port}.`
        }
  }
  return unknown(FIREWALL_UNKNOWN)
}

/**
 * NAT: the distro sits behind its own virtual switch. Guest loopback reaches
 * Windows only through localhost forwarding, and the Windows listener table is
 * the evidence that the forwarding actually happened. Nothing on the NAT
 * network is routable from another machine unless Windows forwards the port
 * and the firewall lets the inbound connection in.
 */
function natVerdict(
  port: PortInfo,
  scope: BindScope,
  firewall: FirewallInfo | null
): ReachabilityVerdict {
  const inbound = inboundPolicy(firewall)

  if (scope === 'loopback') {
    if (port.windowsBound === null) return unknown(WINDOWS_TABLE_UNKNOWN)
    return port.windowsBound
      ? {
          reachability: 'windows-only',
          reason:
            `Bound to ${port.localAddress} inside the distribution; WSL localhost forwarding ` +
            'carries it to this PC, and NAT never exposes it to other machines.'
        }
      : {
          reachability: 'loopback-only',
          reason:
            `Bound to ${port.localAddress} inside the distribution and nothing on the Windows ` +
            `side forwards port ${port.port}, so only processes inside it can connect.`
        }
  }

  if (scope === 'address') {
    if (inbound === 'blocked') {
      return {
        reachability: 'loopback-only',
        reason:
          `Bound to ${port.localAddress}, an address on the WSL NAT network, and the Hyper-V ` +
          'firewall blocks inbound traffic to the virtual machine.'
      }
    }
    if (inbound === 'allowed') {
      return {
        reachability: 'windows-only',
        reason:
          `Bound to ${port.localAddress}, an address on the WSL NAT network: this PC ` +
          'can reach it there, other machines have no route to it.'
      }
    }
    return unknown(FIREWALL_UNKNOWN)
  }

  if (port.windowsBound === null) return unknown(WINDOWS_TABLE_UNKNOWN)
  if (port.windowsBound) {
    if (inbound === 'allowed') {
      return {
        reachability: 'lan',
        reason:
          `Windows forwards port ${port.port} and the Hyper-V firewall allows inbound ` +
          'traffic, so other machines on the network can reach it.'
      }
    }
    if (inbound === 'blocked') {
      return {
        reachability: 'windows-only',
        reason:
          `Windows forwards port ${port.port} to this PC, but the Hyper-V firewall ` +
          'blocks inbound traffic by default, so other machines are dropped unless a rule opens it.'
      }
    }
    return unknown(FIREWALL_UNKNOWN)
  }
  if (inbound === 'blocked') {
    return {
      reachability: 'loopback-only',
      reason:
        'Listening on every interface inside the distribution, but nothing on the Windows side ' +
        `forwards port ${port.port} and the Hyper-V firewall blocks inbound traffic to it.`
    }
  }
  if (inbound === 'allowed') {
    return {
      reachability: 'windows-only',
      reason:
        `Nothing forwards port ${port.port} to localhost, but this PC can still reach it on the ` +
        "distribution's own NAT address, which other machines cannot route to."
    }
  }
  return unknown(FIREWALL_UNKNOWN)
}

/**
 * The verdict for one listener. `networkingMode` is
 * WslConfigInfo.networkingModeEffective — the mode WSL really booted with, not
 * the one .wslconfig asked for.
 */
export function classifyReachability(
  port: PortInfo,
  networkingMode: string | null,
  firewall: FirewallInfo | null
): ReachabilityVerdict {
  if (!port.listening) return { reachability: 'unreachable', reason: NOT_LISTENING }
  const mode = normalizeNetworkingMode(networkingMode)
  if (mode === 'unknown') return unknown(MODE_UNKNOWN)
  const scope = classifyBindAddress(port.localAddress)
  return mode === 'mirrored'
    ? mirroredVerdict(port, scope, firewall)
    : natVerdict(port, scope, firewall)
}

/** Stamp the verdict onto every port; the previous verdict is never an input. */
export function applyReachability(
  ports: PortInfo[],
  networkingMode: string | null,
  firewall: FirewallInfo | null
): PortInfo[] {
  return ports.map((port) => {
    const verdict = classifyReachability(port, networkingMode, firewall)
    return { ...port, reachability: verdict.reachability, reachabilityReason: verdict.reason }
  })
}
