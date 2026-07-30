import { CLOCK_SKEW_WARN_SECONDS } from '@shared/constants'
import { isCrossBoundary } from '@shared/path-boundary'
import type { DashboardSnapshot, DistroSummary, WarningInfo } from '@shared/types'

export interface WarningComputeInput {
  distros: DistroSummary[]
  selectedDistro: string | null
  dashboard: DashboardSnapshot | null
  runnerFailures: string[]
  mcpError: string | null
  /** PATH entries known to be missing — provided by a caller that scanned them. */
  missingPathEntries?: string[]
}

/** At most this many hidden-runner failures become warnings (dedupe first). */
const MAX_RUNNER_WARNINGS = 3

/** Names listed inline before the cross-boundary warning switches to "+N". */
const MAX_CROSS_BOUNDARY_NAMES = 6

function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return cleaned || 'unknown'
}

/**
 * Pure warning rules for the Warnings card (goal.md §6.11). Facts only — no
 * automatic diagnosis. messageKey points into warnings.* of the locale
 * bundles; message carries resolved English for MCP/JSON consumers.
 */
export function computeWarnings(input: WarningComputeInput): WarningInfo[] {
  const out: WarningInfo[] = []
  const selected = input.selectedDistro
    ? (input.distros.find((d) => d.name === input.selectedDistro) ?? null)
    : null
  const running = selected?.state === 'Running'
  const dash = input.dashboard

  if (selected && selected.state === 'Stopped') {
    out.push({
      id: 'distro-stopped',
      severity: 'warning',
      messageKey: 'warnings.distroStopped',
      params: { distro: selected.name },
      message: `Distribution ${selected.name} is stopped`
    })
  }

  if (dash) {
    if (dash.system.systemdEnabled === false) {
      out.push({
        id: 'systemd-disabled',
        severity: 'info',
        messageKey: 'warnings.systemdDisabled',
        params: {},
        message: 'systemd is not enabled'
      })
    }

    // Only meaningful once system info was actually collected (user is set),
    // otherwise a not-yet-polled distro would always look broken.
    if (running && dash.system.user !== null && dash.system.home === null) {
      out.push({
        id: 'home-inaccessible',
        severity: 'warning',
        messageKey: 'warnings.homeInaccessible',
        params: {},
        message: 'Home directory is not accessible'
      })
    }

    // Issue #28: the failures a drifted clock causes never mention the clock,
    // so the drift itself has to be said out loud. Sub-threshold values are
    // measurement noise and stay off the list.
    const skew = dash.clock?.skewSeconds ?? null
    if (running && skew !== null && Math.abs(skew) >= CLOCK_SKEW_WARN_SECONDS) {
      const seconds = Math.abs(skew)
      out.push({
        id: 'clock-skew',
        severity: 'warning',
        messageKey: 'warnings.clockSkew',
        params: { seconds },
        message: `WSL clock differs from Windows by ${seconds}s`
      })
    }

    for (const disk of dash.resources.disks) {
      if (disk.exists && disk.usePercent !== null && disk.usePercent >= 90) {
        out.push({
          id: `disk-low-${disk.mountPoint === '/' ? 'root' : slug(disk.mountPoint)}`,
          severity: 'warning',
          messageKey: 'warnings.diskLow',
          params: { mount: disk.mountPoint, percent: disk.usePercent },
          message: `Low disk space on ${disk.mountPoint}: ${disk.usePercent}% used`
        })
      }
    }

    const hermes = dash.hermes
    if (hermes) {
      if (hermes.executablePath !== null && hermes.dataDir === null) {
        out.push({
          id: 'hermes-no-config',
          severity: 'warning',
          messageKey: 'warnings.hermesNoConfig',
          params: {},
          message: 'Hermes executable found but ~/.hermes is missing'
        })
      }
      if (hermes.dataDir !== null && hermes.executablePath === null) {
        out.push({
          id: 'hermes-no-exec',
          severity: 'warning',
          messageKey: 'warnings.hermesNoExec',
          params: {},
          message: 'Hermes data found but executable is missing'
        })
      }
    }

    for (const svc of dash.services) {
      if (svc.activeState === 'failed') {
        out.push({
          id: `service-failed-${slug(svc.name)}`,
          severity: 'error',
          messageKey: 'warnings.serviceFailed',
          params: { service: svc.name },
          message: `Service ${svc.name} is in failed state`
        })
      }
    }

    const byPort = new Map<string, { protocol: string; port: number; pids: Set<number> }>()
    for (const p of dash.ports) {
      if (!p.listening || p.pid === null) continue
      const key = `${p.protocol}:${p.port}`
      const entry = byPort.get(key) ?? { protocol: p.protocol, port: p.port, pids: new Set() }
      entry.pids.add(p.pid)
      byPort.set(key, entry)
    }
    for (const entry of byPort.values()) {
      if (entry.pids.size > 1) {
        out.push({
          id: `port-conflict-${entry.protocol}-${entry.port}`,
          severity: 'warning',
          messageKey: 'warnings.portConflict',
          params: { port: entry.port, protocol: entry.protocol },
          message: `Possible port conflict on ${entry.port} (${entry.protocol})`
        })
      }
    }

    // Work under /mnt crosses the 9P/DrvFs boundary and runs up to ten times
    // slower with no error and no warning (microsoft/WSL#4197). Nothing in the
    // distro says so, so the fact is stated here — informational, because a
    // path on the Windows drive can be exactly where the user wants it.
    const crossing = [
      ...dash.paths.filter((p) => p.exists !== false && isCrossBoundary(p.side)).map((p) => p.label),
      ...dash.tools.filter((t) => t.installed && isCrossBoundary(t.side)).map((t) => t.displayName)
    ]
    if (crossing.length > 0) {
      const shown = crossing.slice(0, MAX_CROSS_BOUNDARY_NAMES)
      const items =
        shown.join(', ') + (crossing.length > shown.length ? `, +${crossing.length - shown.length}` : '')
      out.push({
        id: 'cross-boundary-paths',
        severity: 'info',
        messageKey: 'warnings.crossBoundaryPaths',
        params: { count: crossing.length, items },
        message:
          `${crossing.length} item(s) live on the Windows filesystem, where WSL file ` +
          `access is far slower than on the Linux disk: ${items}`
      })
    }
  }

  for (const entry of input.missingPathEntries ?? []) {
    out.push({
      id: `path-missing-${slug(entry)}`,
      severity: 'warning',
      messageKey: 'warnings.pathMissing',
      params: { path: entry },
      message: `PATH entry does not exist: ${entry}`
    })
  }

  const distinct: string[] = []
  for (let i = input.runnerFailures.length - 1; i >= 0; i--) {
    const cmd = input.runnerFailures[i]
    if (!distinct.includes(cmd)) distinct.push(cmd)
    if (distinct.length >= MAX_RUNNER_WARNINGS) break
  }
  for (const cmd of distinct.reverse()) {
    out.push({
      id: `runner-failed-${slug(cmd)}`,
      severity: 'warning',
      messageKey: 'warnings.runnerFailed',
      params: { command: cmd },
      message: `A background query failed: ${cmd}`
    })
  }

  if (input.mcpError !== null && input.mcpError.length > 0) {
    out.push({
      id: 'mcp-start-failed',
      severity: 'error',
      messageKey: 'warnings.mcpStartFailed',
      params: { error: input.mcpError },
      message: `MCP server failed to start: ${input.mcpError}`
    })
  }

  return out
}
