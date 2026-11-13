import type { CollectionStatus, DashboardSnapshot, PortOwnership } from './types'

/**
 * Everything known about one port, gathered from the four places that each
 * hold a piece of it (issue #62): the distro's listeners, the Windows port
 * table, the process list, and the Windows forwarding rules.
 *
 * Pure, and reads only what has already been collected — asking "who owns
 * 3000?" must never start a process. Nothing here guesses: a port with no
 * listener answers "nothing is listening", and a port whose Windows side could
 * not be read answers unknown rather than unreachable.
 */
export function portOwnership(dash: DashboardSnapshot, port: number): PortOwnership {
  const listening = dash.ports.filter((p) => p.port === port)
  // Prefer an actually-listening entry; a socket in another state still says
  // who holds the port, so it is the fallback rather than nothing.
  const linux = listening.find((p) => p.listening) ?? listening[0] ?? null

  const windows = dash.windowsPorts.find((p) => p.port === port) ?? null

  const process =
    linux?.pid === null || linux === null
      ? null
      : (dash.processes.find((p) => p.pid === linux.pid) ?? null)

  const forwarding =
    dash.portProxy?.rules.filter((r) => r.listenPort === port || r.connectPort === port) ?? []

  return {
    port,
    linux,
    windows,
    process,
    forwarding,
    // Only the distro's own listener can be "reachable from Windows"; with no
    // listener there is nothing to reach, which is not the same as blocked.
    reachableFromWindows: linux === null ? null : linux.windowsBound
  }
}

/** One sentence for a reader who wanted the answer, not the four tables. */
export function describeOwnership(
  own: PortOwnership,
  context?: { portsStatus?: CollectionStatus }
): string {
  const { port } = own
  const portsStatus = context?.portsStatus
  const portsUncollected = portsStatus === 'pending' || portsStatus === 'failed'
  if (own.linux === null && own.windows === null) {
    if (portsUncollected) {
      return portsStatus === 'failed'
        ? `Listening ports query failed inside the distribution, and nothing is listening on port ${port} on Windows; whether a distribution process holds this port is unknown.`
        : `Listening ports inside the distribution have not been read yet, and nothing is listening on port ${port} on Windows; whether a distribution process holds this port is unknown.`
    }
    return `Nothing is listening on port ${port}, in the distribution or on Windows.`
  }
  if (own.linux === null && own.windows !== null) {
    const tail = portsUncollected
      ? portsStatus === 'failed'
        ? 'distribution listening ports query failed, so whether anything inside the distribution also holds it is unknown.'
        : 'distribution listening ports have not been read yet, so whether anything inside the distribution also holds it is unknown.'
      : 'not by anything inside the distribution.'
    return (
      `Port ${port} is held on the Windows side by ` +
      `${own.windows.processName ?? 'an unidentified process'}` +
      `${own.windows.pid === null ? '' : ` (pid ${own.windows.pid})`}${portsUncollected ? '; ' : ', '}` +
      tail
    )
  }
  const linux = own.linux
  if (linux === null) return `Port ${port} could not be attributed.`

  const who =
    own.process?.command ??
    linux.processName ??
    (linux.pid === null ? 'an unidentified process' : `pid ${linux.pid}`)
  const reach =
    own.reachableFromWindows === null
      ? 'whether Windows can reach it is unknown'
      : own.reachableFromWindows
        ? 'and Windows can reach it'
        : 'but Windows cannot reach it'
  const forwarded =
    own.forwarding.length === 0
      ? ''
      : ` ${own.forwarding.length} Windows forwarding rule(s) mention this port.`

  return `Port ${port} is held inside the distribution by ${who}, ${reach}.${forwarded}`
}
