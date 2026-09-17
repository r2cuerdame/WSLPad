import type { LlmPreset } from '@shared/ipc'
import type {
  DashboardSnapshot,
  SettingOrigin,
  ToolInfo,
  WslPadSnapshot,
  WslSettingInfo
} from '@shared/types'
import { buildDevEnvContext } from '@shared/dev-env-context'
import { devEnvContextToMarkdown, fmtBytesPlain as fmtBytes } from '@shared/dev-env-context-markdown'
import packageJson from '../../../package.json'
import { maskTextFileContent } from '../mcp/masking'

/**
 * Copy-for-LLM exports (goal.md §12). The snapshot is masked by construction,
 * and the Markdown additionally exposes environment variable NAMES only —
 * values never appear here, secret or not. That holds for every preset, with
 * one deliberate exception: the agent context prints PATH and WSLENV, which
 * are directory lists and variable names, never credentials, and are the
 * facts an agent most needs. No other environment value is ever printed.
 */

const LLM_FOOTER = [
  '위 환경 상태를 기준으로 문제를 분석하라.',
  '시스템을 변경할 명령이 필요하면 자동 실행하지 말고,',
  '사용자가 검토할 수 있도록 명령어와 이유를 함께 제안하라.'
].join('\n')

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no'
}

/** Machine-readable exports are English by construction — no i18n involved. */
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
  const connected = hermes.platforms.filter((p) => p.configured).map((p) => p.name)
  // "unknown" and "none" are different answers: the CLI may simply not have
  // been asked yet, and an LLM must not read that as "nothing is configured".
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

// ---------------------------------------------------------------------------
// Preset 1 — microsoft/WSL bug report (issue #30)
// ---------------------------------------------------------------------------

/** "Other Software" is context, not an inventory: a full catalog buries it. */
const BUG_TOOL_LIMIT = 40

/** A field the form requires that WSLPad does not collect — say so in place. */
function fillIn(instruction: string): string {
  return `_${instruction}_`
}

function heading(lines: string[], label: string): void {
  lines.push(`### ${label}`, '')
}

function pushBugVersions(lines: string[], dash: DashboardSnapshot | null): void {
  // Both are Windows-side facts read by commands WSLPad does not run; an
  // invented build number would be worse than the two-second copy-paste.
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
    lines.push(fillIn('No tools detected inside the distribution.'), '')
    return
  }
  lines.push('Detected inside the distribution:', '')
  for (const tool of installed.slice(0, BUG_TOOL_LIMIT)) lines.push(toolLine(tool))
  if (installed.length > BUG_TOOL_LIMIT) {
    lines.push(`- … and ${installed.length - BUG_TOOL_LIMIT} more`)
  }
  lines.push('')
}

/** The environment facts a maintainer asks for in the first reply. */
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
    // Whether a Windows .exe can be invoked from the shell at all, and whose
    // files anything written here will belong to: both change what a fix that
    // works when pasted looks like.
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

/**
 * The declared keys of one config file, back as ini text. It is a
 * reconstruction from what the parser kept, not the file itself — the heading
 * above each block says so rather than letting a maintainer read a missing
 * comment as an absent line.
 */
function iniFromSettings(settings: WslSettingInfo[], origin: SettingOrigin): string | null {
  const sections = new Map<string, string[]>()
  for (const setting of settings) {
    if (setting.origin !== origin || setting.declaredValue === null) continue
    const entries = sections.get(setting.section) ?? []
    entries.push(`${setting.key}=${setting.declaredValue}`)
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
    lines.push('WSLPad warnings:', '')
    for (const w of s.warnings) lines.push(`- [${w.severity}] ${w.message}`)
    lines.push('')
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

/**
 * microsoft/WSL's issue form (.github/ISSUE_TEMPLATE/Bug_Report.yaml) field by
 * field, in its order and under its exact labels. GitHub renders a submitted
 * form as `### <label>` blocks, so this pastes into the form or straight into
 * an issue body and lands where maintainers read. Four fields are the
 * reporter's own — the repro, the two behaviours, and the Windows-side version
 * strings WSLPad does not run the commands for — so each says what to fill in
 * rather than being quietly dropped or, worse, guessed at.
 */
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

// ---------------------------------------------------------------------------
// Preset 2 — agent context block (issue #30)
// ---------------------------------------------------------------------------

/**
 * The block for a CLAUDE.md / AGENTS.md is the Developer Environment Context
 * rendered as Markdown — the very object the MCP tool of the same name
 * serves, so an agent reading the file and an agent calling the tool see the
 * same facts, the same caps and the same doctor verdicts.
 */
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

/**
 * Copy-for-LLM Markdown. 'default' is the full environment summary and is what
 * every existing caller gets; the other two are shaped by their destination —
 * microsoft/WSL's issue form and an agent's CLAUDE.md / AGENTS.md.
 */
export function snapshotToMarkdown(s: WslPadSnapshot, preset: LlmPreset = 'default'): string {
  if (preset === 'bug-report') return bugReportMarkdown(s)
  if (preset === 'agent-context') return agentContextMarkdown(s)
  return defaultMarkdown(s)
}

/** JSON export button (goal.md §12) — the snapshot is already masked by construction. */
export function snapshotToJson(s: WslPadSnapshot): string {
  return JSON.stringify(s, null, 2)
}
