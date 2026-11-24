import { MASKED_VALUE } from '@shared/constants'
import type { LlmPreset } from '@shared/ipc'
import type {
  DashboardSnapshot,
  PortInfo,
  SettingOrigin,
  ToolInfo,
  WarningInfo,
  WslPadSnapshot,
  WslSettingInfo
} from '@shared/types'
import { buildDevEnvContext, collectionSucceeded } from '@shared/dev-env-context'
import {
  devEnvContextToMarkdown,
  fmtBytesPlain as fmtBytes
} from '@shared/dev-env-context-markdown'
import { isSecretName, sanitizeSnapshot } from '@shared/masking'
import packageJson from '../../../package.json'
import { maskTextFileContent } from '../mcp/masking'

type Unread = 'failed' | 'pending' | null

type PortRow = Pick<PortInfo, 'protocol' | 'localAddress' | 'port' | 'processName' | 'pid'>

const LLM_FOOTER = [
  '위 환경 상태를 기준으로 문제를 분석하라.',
  '시스템을 변경할 명령이 필요하면 자동 실행하지 말고,',
  '사용자가 검토할 수 있도록 명령어와 이유를 함께 제안하라.'
].join('\n')

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no'
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
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
    if (disk.exists !== true) {
      lines.push(`- Disk ${disk.mountPoint}: ${disk.exists === false ? 'not mounted' : 'unknown'}`)
      continue
    }
    const pct = disk.usePercent === null ? 'unknown' : `${disk.usePercent}%`
    lines.push(`- Disk ${disk.mountPoint}: ${pct} used, ${fmtBytes(disk.availableBytes)} free`)
  }
  lines.push('')
}

function pushSection(
  lines: string[],
  title: string,
  items: readonly string[],
  empty: string,
  after: readonly string[] = []
): void {
  lines.push(`## ${title}`, ...(items.length === 0 ? [empty] : items), ...after, '')
}

function byUnread(
  unread: Unread,
  notes: { failed: string; pending: string; none: string }
): string {
  return unread === null ? notes.none : notes[unread]
}

function toolsUnread(dash: DashboardSnapshot | null): Unread {
  if (collectionSucceeded(dash, 'tools')) return null
  return dash?.toolsCollectionStatus === 'failed' ? 'failed' : 'pending'
}

function portsUnread(dash: DashboardSnapshot): Unread {
  const status = dash.portsCollectionStatus
  return status === 'failed' || status === 'pending' ? status : null
}

function portLine(port: PortRow, suffix = ''): string {
  const proc = port.processName ?? 'unknown'
  const pid = port.pid === null ? '' : ` (pid ${port.pid})`
  return `- ${port.protocol} ${port.localAddress}:${port.port} — ${proc}${pid}${suffix}`
}

function warningLine(w: WarningInfo): string {
  return `- [${w.severity}] ${w.message}`
}

function pushTools(lines: string[], dash: DashboardSnapshot): void {
  const installed = dash.tools.filter((t) => t.installed)
  pushSection(
    lines,
    'Installed tools',
    installed.map((tool) => {
      const version = tool.version ?? 'unknown version'
      const path = tool.executablePath ? ` — ${tool.executablePath}` : ''
      return `- ${tool.displayName} ${version}${path}`
    }),
    byUnread(toolsUnread(dash), {
      failed: '- Unknown (tool query failed)',
      pending: '- Unknown (not collected yet)',
      none: '- None detected'
    })
  )
}

function pushHermes(lines: string[], dash: DashboardSnapshot): void {
  lines.push('## Hermes')
  const hermes = dash.hermes
  if (!hermes) {
    lines.push('- Not detected', '')
    return
  }
  const connected = hermes.platforms.filter((p) => p.configured).map((p) => p.name)
  const messengers =
    hermes.platforms.length === 0
      ? 'unknown'
      : connected.length === 0
        ? 'none'
        : connected.join(', ')
  lines.push(
    `- Installed: ${hermes.installed ? 'yes' : 'no'}`,
    `- Executable: ${hermes.executablePath ?? 'not found'}`,
    `- Data: ${hermes.dataDir ?? 'not found'}`,
    `- Gateway: ${hermes.gatewayStatus}`,
    `- Messengers connected: ${messengers}`,
    `- Profiles (agents): ${
      hermes.profiles.length === 0
        ? 'unknown'
        : hermes.profiles.map((p) => (p.isCurrent ? `${p.name} (current)` : p.name)).join(', ')
    }`,
    `- Active sessions: ${hermes.activeSessions ?? 'unknown'}`,
    `- Scheduled jobs: ${hermes.scheduledJobs ?? 'unknown'}`,
    `- Dashboard: ${hermes.dashboardStatus}${
      hermes.dashboardPort === null ? '' : ` (http://127.0.0.1:${hermes.dashboardPort})`
    }`,
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

function pushPorts(
  lines: string[],
  dash: DashboardSnapshot,
  warnings: readonly { id: string }[] = []
): void {
  const listening = dash.ports.filter((p) => p.listening).slice(0, 30)
  const refreshFailed = [...warnings, ...dash.warnings].some((w) => w.id === 'runner-failed-ports')
  pushSection(
    lines,
    'Listening ports',
    listening.map((port) =>
      portLine(port, windowsSide(port.windowsBound ?? null, port.windowsProcess ?? null))
    ),
    byUnread(portsUnread(dash), {
      failed: '- Unknown (listening port query failed)',
      pending: '- Unknown (not collected yet)',
      none: '- None'
    }),
    refreshFailed ? ['- Note: latest listening-port refresh failed; showing previous results'] : []
  )
}

function pushWindowsPorts(lines: string[], dash: DashboardSnapshot): void {
  const own = (dash.windowsPorts ?? []).filter((p) => !p.fromWsl).slice(0, 30)
  pushSection(
    lines,
    'Windows-only listening ports',
    own.map((port) => portLine(port)),
    '- None'
  )
}

function pushEnvironment(lines: string[], dash: DashboardSnapshot): void {
  const names = dash.environment.map((e) => e.name).sort()
  pushSection(
    lines,
    'Environment variable names',
    names.length === 0 ? [] : [names.join(', ')],
    '- None'
  )
}

function pushPaths(lines: string[], dash: DashboardSnapshot): void {
  const items = dash.paths.map((p) => {
    const exists = p.exists === null ? 'unknown' : p.exists ? 'exists' : 'missing'
    return `- ${p.label}: ${p.linuxPath} (${exists})`
  })
  pushSection(lines, 'Important paths', items, '- None detected')
}

function pushWarnings(lines: string[], snapshot: WslPadSnapshot): void {
  pushSection(lines, 'Warnings', snapshot.warnings.map(warningLine), '- None')
}

function defaultMarkdown(s: WslPadSnapshot): string {
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
    pushPorts(lines, dash, s.warnings)
    pushWindowsPorts(lines, dash)
    pushEnvironment(lines, dash)
    pushPaths(lines, dash)
  }

  pushWarnings(lines, s)
  const explorerPath =
    s.selectedDistro === null || s.explorer.distro === s.selectedDistro
      ? s.explorer.currentPath
      : null
  lines.push('## Explorer', `- Selected path: ${explorerPath ?? 'none'}`, '')
  lines.push(LLM_FOOTER)
  return lines.join('\n') + '\n'
}

const BUG_TOOL_LIMIT = 40

function fillIn(instruction: string): string {
  return `_${instruction}_`
}

function heading(lines: string[], label: string): void {
  lines.push(`### ${label}`, '')
}

function pushBugVersions(lines: string[], dash: DashboardSnapshot | null): void {
  heading(lines, 'Windows Version')
  lines.push(fillIn('Run `cmd.exe /c ver` and paste the output here.'), '')
  heading(lines, 'WSL Version')
  lines.push(fillIn('Run `wsl.exe --version` and paste the output here.'), '')
  heading(lines, 'Are you using WSL 1 or WSL 2?')
  const version = dash?.distro.wslVersion ?? null
  lines.push(`- [${version === 2 ? 'x' : ' '}] WSL 2`, `- [${version === 1 ? 'x' : ' '}] WSL 1`, '')
}

function pushBugKernel(lines: string[], dash: DashboardSnapshot | null): void {
  heading(lines, 'Kernel Version')
  const kernel = dash?.system.kernel ?? null
  lines.push(
    kernel ?? fillIn('Run `cat /proc/version` in the distro and paste the output here.'),
    ''
  )
}

function pushBugDistroVersion(
  lines: string[],
  s: WslPadSnapshot,
  dash: DashboardSnapshot | null
): void {
  heading(lines, 'Distro Version')
  const distro = dash?.distro ?? null
  if (distro === null) {
    const name = s.selectedDistro
    lines.push(name ?? fillIn('No distribution was selected when this report was generated.'), '')
    return
  }
  lines.push(distro.osName === null ? distro.name : `${distro.osName} (${distro.name})`, '')
}

function toolLine(tool: ToolInfo): string {
  const version = tool.version ?? 'version unknown'
  if (tool.shadowedByWindows) return `- ${tool.displayName} ${version} (Windows binary on PATH)`
  return `- ${tool.displayName} ${version}`
}

function pushBugOtherSoftware(lines: string[], dash: DashboardSnapshot | null): void {
  heading(lines, 'Other Software')
  const installed = (dash?.tools ?? []).filter((t) => t.installed)
  if (installed.length === 0) {
    const note = byUnread(toolsUnread(dash), {
      failed:
        'WSLPad could not read the installed tools. List the relevant software and versions here.',
      pending:
        'WSLPad has not read the installed tools yet. List the relevant software and versions here.',
      none: 'No tools detected inside the distribution.'
    })
    lines.push(fillIn(note), '')
    return
  }
  lines.push('Detected inside the distribution:', '')
  for (const tool of installed.slice(0, BUG_TOOL_LIMIT)) lines.push(toolLine(tool))
  if (installed.length > BUG_TOOL_LIMIT) {
    lines.push(`- … and ${installed.length - BUG_TOOL_LIMIT} more`)
  }
  lines.push('')
}

function reproFacts(dash: DashboardSnapshot): string[] {
  const facts: string[] = []
  const d = dash.distro
  facts.push(`- Distribution: ${d.name} — ${d.state}${d.isDefault ? ', default distro' : ''}`)
  if (dash.system.systemdEnabled !== null) {
    facts.push(`- systemd: ${dash.system.systemdEnabled ? 'enabled' : 'disabled'}`)
  }
  const wsl = dash.wslSettings
  if (wsl !== null) {
    const declared = wsl.networkingModeDeclared
    const effective = wsl.networkingModeEffective
    if (declared !== null || effective !== null) {
      const same = declared === effective
      facts.push(
        same
          ? `- Networking mode: ${effective ?? declared}`
          : `- Networking mode: ${declared ?? 'not declared'} declared, ` +
              `${effective ?? 'unknown'} in effect`
      )
    }
    if (wsl.restartPending) {
      facts.push(
        '- A declared setting is not the one the running VM uses (`wsl --shutdown` pending)'
      )
    }
    if (wsl.vmStartedAt !== null) facts.push(`- Utility VM started at: ${wsl.vmStartedAt}`)
    if (wsl.interop?.binfmt != null) {
      facts.push(`- Windows interop: ${wsl.interop.binfmt} (kernel binfmt registration)`)
    }
    const who = wsl.defaultUser
    if (who != null && (who.effectiveName !== null || who.effectiveUid !== null)) {
      const uid = who.effectiveUid === null ? '' : ` (uid ${who.effectiveUid})`
      facts.push(`- Starts as: ${who.effectiveName ?? 'unknown'}${uid}`)
    }
  }
  const skew = dash.clock?.skewSeconds ?? null
  if (skew !== null) facts.push(`- Clock skew (distro − Windows): ${skew}s`)
  const dns = dash.dns
  if (dns !== null) {
    const parts = [`${plural(dns.nameservers.length, 'nameserver')} in ${dns.resolvConfPath}`]
    if (dns.generateResolvConf !== null) parts.push(`generateResolvConf=${dns.generateResolvConf}`)
    if (dns.dnsTunneling !== null) parts.push(`dnsTunneling=${dns.dnsTunneling}`)
    facts.push(`- DNS: ${parts.join(', ')}`)
  }
  const fw = dash.firewall
  if (fw !== null && (fw.enabled !== null || fw.defaultInbound !== null)) {
    const state = fw.enabled === null ? 'state unknown' : fw.enabled ? 'on' : 'off'
    const inbound = fw.defaultInbound === null ? '' : `, default inbound ${fw.defaultInbound}`
    facts.push(`- Windows firewall: ${state}${inbound}`)
  }
  const root = dash.resources.disks.find((disk) => disk.mountPoint === '/')
  if (root?.exists === true && root.availableBytes !== null) {
    facts.push(`- Free space on /: ${fmtBytes(root.availableBytes)}`)
  }
  return facts
}

function pushBugRepro(lines: string[], dash: DashboardSnapshot | null): void {
  heading(lines, 'Repro Steps')
  lines.push(fillIn('Fill in the steps that reproduce the problem.'), '')
  if (dash === null) {
    lines.push('WSLPad collected no environment data for this report.', '')
    return
  }
  lines.push('Environment when this report was generated (collected by WSLPad):', '')
  lines.push(...reproFacts(dash), '')
}

function iniFromSettings(settings: WslSettingInfo[], origin: SettingOrigin): string | null {
  const sections = new Map<string, string[]>()
  for (const setting of settings) {
    if (setting.origin !== origin || setting.declaredValue === null) continue
    const entries = sections.get(setting.section) ?? []
    const value = isSecretName(setting.key) ? MASKED_VALUE : setting.declaredValue
    entries.push(`${setting.key}=${value}`)
    sections.set(setting.section, entries)
  }
  if (sections.size === 0) return null
  const out: string[] = []
  for (const [section, entries] of sections) out.push(`[${section}]`, ...entries, '')
  return out.join('\n').trimEnd()
}

function pushConfigBlock(
  lines: string[],
  label: string,
  path: string | null,
  exists: boolean,
  ini: string | null
): void {
  const where = path === null || path === label ? label : `${label} (${path})`
  if (!exists) {
    lines.push(`${where}: does not exist.`, '')
    return
  }
  if (ini === null) {
    lines.push(`${where}: exists, no keys parsed.`, '')
    return
  }
  lines.push(`${where} — keys WSLPad parsed, comments and layout not preserved:`, '')
  lines.push('```ini', maskTextFileContent(path ?? label, ini).content, '```', '')
}

function pushBugDiagnostics(
  lines: string[],
  s: WslPadSnapshot,
  dash: DashboardSnapshot | null
): void {
  heading(lines, 'Diagnostic Logs')
  lines.push(
    fillIn(
      'Attach logs if you have them — the WSL CONTRIBUTING guide explains how to gather them.'
    ),
    ''
  )
  if (s.warnings.length === 0) {
    lines.push('WSLPad reported no warnings for this environment.', '')
  } else {
    lines.push('WSLPad warnings:', '', ...s.warnings.map(warningLine), '')
  }
  const wsl = dash?.wslSettings ?? null
  if (wsl === null) {
    lines.push('WSLPad has not read `.wslconfig` or `/etc/wsl.conf` for this distribution.', '')
    return
  }
  pushConfigBlock(
    lines,
    '.wslconfig',
    wsl.wslconfigPath,
    wsl.wslconfigExists,
    iniFromSettings(wsl.settings, 'wslconfig')
  )
  pushConfigBlock(
    lines,
    '/etc/wsl.conf',
    wsl.wslConfPath,
    wsl.wslConfExists,
    iniFromSettings(wsl.settings, 'wsl-conf')
  )
}

function bugReportMarkdown(s: WslPadSnapshot): string {
  const lines: string[] = []
  const dash = s.dashboard
  pushBugVersions(lines, dash)
  pushBugKernel(lines, dash)
  pushBugDistroVersion(lines, s, dash)
  pushBugOtherSoftware(lines, dash)
  pushBugRepro(lines, dash)
  heading(lines, 'Expected Behavior')
  lines.push(fillIn('Fill in what you expected to happen.'), '')
  heading(lines, 'Actual Behavior')
  lines.push(fillIn('Fill in what happened instead, with the terminal output.'), '')
  pushBugDiagnostics(lines, s, dash)
  return lines.join('\n').trimEnd() + '\n'
}

function agentContextMarkdown(s: WslPadSnapshot): string {
  if (s.dashboard === null) {
    const name = s.selectedDistro ?? 'none selected'
    return (
      `## WSL environment — ${name}\n\n` +
      'WSLPad collected no environment data, so there is nothing here an agent could rely on.\n'
    )
  }
  return devEnvContextToMarkdown(buildDevEnvContext(s, { appVersion: packageJson.version }))
}

export function snapshotToMarkdown(s: WslPadSnapshot, preset: LlmPreset = 'default'): string {
  if (preset === 'bug-report') return bugReportMarkdown(s)
  if (preset === 'agent-context') return agentContextMarkdown(s)
  return defaultMarkdown(s)
}

export function snapshotToJson(s: WslPadSnapshot): string {
  return JSON.stringify(sanitizeSnapshot(s), null, 2)
}
