import type { DashboardSnapshot, WslPadSnapshot } from '@shared/types'

/**
 * Copy-for-LLM exports (goal.md §12). The snapshot is masked by construction,
 * and the Markdown additionally exposes environment variable NAMES only —
 * values never appear here, secret or not.
 */

const LLM_FOOTER = [
  '위 환경 상태를 기준으로 문제를 분석하라.',
  '시스템을 변경할 명령이 필요하면 자동 실행하지 말고,',
  '사용자가 검토할 수 있도록 명령어와 이유를 함께 제안하라.'
].join('\n')

function fmtBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`
}

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no'
}

function pushSystem(lines: string[], dash: DashboardSnapshot): void {
  const sys = dash.system
  lines.push(
    '## System',
    `- User: ${sys.user ?? 'unknown'}`,
    `- HOME: ${sys.home ?? 'unknown'}`,
    `- Kernel: ${sys.kernel ?? 'unknown'}`,
    `- Hostname: ${sys.hostname ?? 'unknown'}`,
    `- Shell: ${sys.shell ?? 'unknown'}`,
    `- Systemd: ${sys.systemdEnabled === null ? 'unknown' : sys.systemdEnabled ? 'enabled' : 'disabled'}`,
    `- IP: ${sys.ip ?? 'unknown'}`,
    ''
  )
}

function pushResources(lines: string[], dash: DashboardSnapshot): void {
  const res = dash.resources
  lines.push('## Resources')
  const cores = res.cpuCount === null ? '' : ` (${res.cpuCount} cores)`
  lines.push(`- CPU: ${res.cpuPercent === null ? 'unknown' : `${res.cpuPercent}%`}${cores}`)
  lines.push(`- Memory: ${fmtBytes(res.memUsedBytes)} used / ${fmtBytes(res.memTotalBytes)} total`)
  lines.push(`- Swap: ${fmtBytes(res.swapUsedBytes)} used / ${fmtBytes(res.swapTotalBytes)} total`)
  if (res.loadAvg) lines.push(`- Load average: ${res.loadAvg.join(', ')}`)
  if (res.processCount !== null) lines.push(`- Processes: ${res.processCount}`)
  for (const disk of res.disks) {
    if (!disk.exists) {
      lines.push(`- Disk ${disk.mountPoint}: not mounted`)
      continue
    }
    const pct = disk.usePercent === null ? 'unknown' : `${disk.usePercent}%`
    lines.push(`- Disk ${disk.mountPoint}: ${pct} used, ${fmtBytes(disk.availableBytes)} free`)
  }
  lines.push('')
}

function pushTools(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Installed tools')
  const installed = dash.tools.filter((t) => t.installed)
  if (installed.length === 0) {
    lines.push('- None detected')
  } else {
    for (const tool of installed) {
      const version = tool.version ?? 'unknown version'
      const path = tool.executablePath ? ` — ${tool.executablePath}` : ''
      lines.push(`- ${tool.displayName} ${version}${path}`)
    }
  }
  lines.push('')
}

function pushHermes(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Hermes')
  const hermes = dash.hermes
  if (!hermes) {
    lines.push('- Not detected', '')
    return
  }
  lines.push(
    `- Installed: ${hermes.installed ? 'yes' : 'no'}`,
    `- Executable: ${hermes.executablePath ?? 'not found'}`,
    `- Data: ${hermes.dataDir ?? 'not found'}`,
    `- Gateway: ${hermes.gatewayStatus}`,
    `- Dashboard: ${hermes.dashboardStatus}`,
    `- MCP servers: ${hermes.mcpServerCount ?? 'unknown'}`,
    ''
  )
}

function pushServices(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Services')
  const failed = dash.services.filter((s) => s.activeState === 'failed')
  const active = dash.services.filter((s) => s.activeState === 'active')
  const failedNames = failed.length > 0 ? ` (${failed.map((s) => s.name).join(', ')})` : ''
  lines.push(`- Failed: ${failed.length}${failedNames}`)
  lines.push(`- Active: ${active.length}`)
  for (const svc of active.slice(0, 10)) {
    lines.push(`- ${svc.name}: ${svc.description}`)
  }
  lines.push('')
}

function windowsSide(bound: boolean | null, process: string | null): string {
  if (bound === null) return ' — Windows: unknown'
  if (!bound) return ' — Windows: not bound'
  return process === null ? ' — Windows: bound' : ` — Windows: bound by ${process}`
}

function pushPorts(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Listening ports')
  const listening = dash.ports.filter((p) => p.listening)
  if (listening.length === 0) {
    lines.push('- None')
  } else {
    for (const port of listening.slice(0, 30)) {
      const proc = port.processName ?? 'unknown'
      const pid = port.pid === null ? '' : ` (pid ${port.pid})`
      const win = windowsSide(port.windowsBound ?? null, port.windowsProcess ?? null)
      lines.push(`- ${port.protocol} ${port.localAddress}:${port.port} — ${proc}${pid}${win}`)
    }
  }
  lines.push('')
}

function pushWindowsPorts(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Windows-only listening ports')
  // Older snapshots (and MCP payloads predating the field) carry no table.
  const own = (dash.windowsPorts ?? []).filter((p) => !p.fromWsl)
  if (own.length === 0) {
    lines.push('- None')
  } else {
    for (const port of own.slice(0, 30)) {
      const proc = port.processName ?? 'unknown'
      const pid = port.pid === null ? '' : ` (pid ${port.pid})`
      lines.push(`- ${port.protocol} ${port.localAddress}:${port.port} — ${proc}${pid}`)
    }
  }
  lines.push('')
}

function pushEnvironment(lines: string[], dash: DashboardSnapshot): void {
  // Names only — even non-secret values stay out of the LLM export (goal.md §12).
  lines.push('## Environment variable names')
  if (dash.environment.length === 0) {
    lines.push('- None')
  } else {
    const names = dash.environment.map((e) => e.name).sort()
    lines.push(names.join(', '))
  }
  lines.push('')
}

function pushPaths(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Important paths')
  if (dash.paths.length === 0) {
    lines.push('- None detected')
  } else {
    for (const p of dash.paths) {
      const exists = p.exists === null ? 'unknown' : p.exists ? 'exists' : 'missing'
      lines.push(`- ${p.label}: ${p.linuxPath} (${exists})`)
    }
  }
  lines.push('')
}

function pushWarnings(lines: string[], snapshot: WslPadSnapshot): void {
  lines.push('## Warnings')
  if (snapshot.warnings.length === 0) {
    lines.push('- None')
  } else {
    for (const w of snapshot.warnings) {
      lines.push(`- [${w.severity}] ${w.message}`)
    }
  }
  lines.push('')
}

export function snapshotToMarkdown(s: WslPadSnapshot): string {
  const lines: string[] = []
  const dash = s.dashboard

  lines.push('# WSLPad environment snapshot', '', `Generated at: ${s.generatedAt}`, '')
  lines.push('## Distro')
  if (dash) {
    const d = dash.distro
    lines.push(
      `- Name: ${d.name}`,
      `- State: ${d.state}`,
      `- WSL version: ${d.wslVersion}`,
      `- Default distro: ${yesNo(d.isDefault)}`,
      `- OS: ${d.osName ?? 'unknown'}`
    )
  } else {
    lines.push(`- Selected: ${s.selectedDistro ?? 'none'}`, '- No dashboard data collected')
  }
  lines.push('')

  if (dash) {
    pushSystem(lines, dash)
    pushResources(lines, dash)
    pushTools(lines, dash)
    pushHermes(lines, dash)
    pushServices(lines, dash)
    pushPorts(lines, dash)
    pushWindowsPorts(lines, dash)
    pushEnvironment(lines, dash)
    pushPaths(lines, dash)
  }

  pushWarnings(lines, s)
  lines.push('## Explorer', `- Selected path: ${s.explorer.currentPath ?? 'none'}`, '')
  lines.push(LLM_FOOTER)
  return lines.join('\n') + '\n'
}

/** JSON export button (goal.md §12) — the snapshot is already masked by construction. */
export function snapshotToJson(s: WslPadSnapshot): string {
  return JSON.stringify(s, null, 2)
}
