/**
 * The Developer Environment Context as Markdown — the block that goes into a
 * CLAUDE.md / AGENTS.md, and the text half of the MCP tool that serves the
 * same context. Rendered from the built context only, never from the
 * snapshot, so what an agent reads here and what it gets over MCP are the
 * same facts with the same caps.
 *
 * Machine-facing and English by construction: no i18n is involved. A block
 * that bloats a CLAUDE.md gets deleted, so every list here is already bounded
 * by the builder and the whole document stays under AGENT_CONTEXT_MAX_CHARS.
 */
import type {
  DevEnvCheck,
  DevEnvContext,
  DevEnvFilesystem,
  DevEnvTool,
  DevEnvToolGroup,
  DevEnvVerdict,
  PortReachability
} from './types'

/** Locale-free byte formatting for machine-facing exports. */
export function fmtBytesPlain(bytes: number | null): string {
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

function more(lines: string[], omitted: number): void {
  if (omitted > 0) lines.push(`- … and ${omitted} more`)
}

/** Typed by the union so a new reachability value cannot silently print blank. */
const REACHABILITY_TEXT: Record<PortReachability, string> = {
  lan: 'reachable from the LAN',
  'windows-only': 'reachable from Windows',
  'loopback-only': 'only inside the distro',
  unreachable: 'not accepting connections',
  unknown: 'reachability unknown'
}

function header(lines: string[], ctx: DevEnvContext): void {
  const d = ctx.distro
  const name = d.name ?? 'no distro selected'
  lines.push(`## WSL environment — ${name}`, '')
  lines.push(
    `Collected by WSLPad from the Windows side at ${ctx.generatedAt}. ` +
      `Developer environment context v${ctx.schemaVersion}: every reading is a poll, ` +
      'secrets are masked, and the MCP server behind it is read-only.',
    ''
  )
  const os = d.osName === null ? '' : ` (${d.osName})`
  const version = d.wslVersion === null ? '' : `, WSL ${d.wslVersion}`
  const state = d.state === null ? '' : `, ${d.state}`
  const answering =
    d.answering === false ? ' — not answering probes' : d.answering === true ? ', answering' : ''
  lines.push(`- Distro: ${name}${os}${version}${state}${answering}`)
  if (d.systemd !== null) lines.push(`- systemd: ${d.systemd ? 'enabled' : 'disabled'}`)
  if (d.kernel !== null) lines.push(`- Kernel: ${d.kernel}`)
  if (d.shell !== null) lines.push(`- Login shell: ${d.shell}`)
  if (d.user !== null) {
    lines.push(`- User: ${d.user}${d.uid === null ? '' : ` (uid ${d.uid})`}, HOME ${d.home ?? 'unknown'}`)
  }
  if (d.uncPath !== null) lines.push(`- This distro from Windows: ${d.uncPath}`)
  if (d.windowsUserProfileLinux !== null) {
    lines.push(`- Windows user profile from Linux: ${d.windowsUserProfileLinux}`)
  }
  if (d.platform !== null && (d.platform.wsl !== null || d.platform.windows !== null)) {
    lines.push(
      `- WSL ${d.platform.wsl ?? 'version unknown'} on Windows ${d.platform.windows ?? 'build unknown'}` +
        (d.platform.storeBuild === true ? ' (Store build)' : '')
    )
  }
  if (d.otherDistros.length > 0) {
    lines.push(
      `- Other distros: ${d.otherDistros.join(', ')}` +
        (d.otherDistrosOmitted > 0 ? ` and ${d.otherDistrosOmitted} more` : '')
    )
  }
  lines.push('')
}

function workspace(lines: string[], ctx: DevEnvContext): void {
  const w = ctx.workspace
  if (w.cwd === null && w.explorerPath === null) return
  lines.push('### Working directory', '')
  if (w.cwd !== null) {
    const side =
      w.cwdSide === 'windows-mount'
        ? 'Windows drive — slow for builds and git'
        : w.cwdSide === 'ext4'
          ? 'distro disk'
          : w.cwdSide
    const win = w.cwdWindowsPath === null ? '' : `; from Windows: ${w.cwdWindowsPath}`
    const status = w.consoleStatus === null ? '' : ` (console ${w.consoleStatus})`
    lines.push(`- Console cwd: ${w.cwd} — ${side}${win}${status}`)
  }
  if (w.explorerPath !== null) lines.push(`- Explorer: ${w.explorerPath}`)
  for (const note of w.boundaryNotes) lines.push(`- ${note}`)
  lines.push('')
}

function pathsSection(lines: string[], ctx: DevEnvContext): void {
  const mapped = ctx.workspace.paths.filter((p) => p.windowsPath !== null)
  if (mapped.length === 0) return
  lines.push('### Windows ↔ Linux paths', '')
  // Every distro path follows the same UNC rule, so one example carries them
  // all; only the paths that break the rule (drive mounts) are listed one by one.
  const onDistro = mapped.filter((p) => p.side === 'ext4' || p.side === 'unc')
  const elsewhere = mapped.filter((p) => p.side !== 'ext4' && p.side !== 'unc')
  if (onDistro.length > 0) {
    const first = onDistro[0]
    const rest = onDistro.length - 1 + ctx.workspace.pathsOmitted
    lines.push(
      `- ${first.linuxPath} ↔ ${first.windowsPath}` +
        (rest > 0 ? ` (and ${rest} more distro path${rest === 1 ? '' : 's'} by the same rule)` : '')
    )
  }
  for (const p of elsewhere) {
    const mount = p.side === 'windows-mount' ? ' (Windows mount)' : ''
    lines.push(`- ${p.linuxPath} ↔ ${p.windowsPath}${mount}`)
  }
  lines.push('')
}

function toolLine(tool: DevEnvTool): string {
  const version = tool.version === null ? '' : ` ${tool.version}`
  const where = tool.path ?? 'path unknown'
  const via = tool.installMethod === null ? '' : ` (${tool.installMethod})`
  if (tool.shadowedByWindows) return `- ${tool.id}${version} — ${where} (Windows binary wins on PATH)`
  if (tool.side === 'windows-mount') return `- ${tool.id}${version} — ${where} (on a Windows mount)`
  return `- ${tool.id}${version} — ${where}${via}`
}

function toolGroup(lines: string[], title: string, group: DevEnvToolGroup): void {
  if (group.installedCount === 0) return
  lines.push(`### ${title} (${group.installedCount} of ${group.knownCount} known)`, '')
  for (const tool of group.items) lines.push(toolLine(tool))
  more(lines, group.omitted)
  lines.push('')
}

function pathSection(lines: string[], ctx: DevEnvContext): void {
  const p = ctx.path
  const facts: string[] = []
  if (p.entryCount !== null) {
    const win = p.windowsEntryCount === null ? '' : `, ${p.windowsEntryCount} on Windows drives`
    facts.push(
      `- PATH (${p.entryCount} entries${win}): ${p.entries.join(', ')}` +
        (p.omitted > 0 ? `, … and ${p.omitted} more` : '')
    )
  }
  const interop = p.interop
  if (interop !== null && interop.binfmt !== null) {
    const declared =
      interop.declared === null ? '' : `; /etc/wsl.conf declares enabled=${interop.declared}`
    facts.push(`- Windows interop: ${interop.binfmt} (kernel binfmt registration)${declared}`)
  }
  if (p.appendWindowsPath !== null) {
    facts.push(`- appendWindowsPath: ${p.appendWindowsPath}`)
  }
  if (p.windowsBinaryCount !== null && p.windowsBinaryCount > 0) {
    facts.push(
      `- ${p.windowsBinaryCount} command${p.windowsBinaryCount === 1 ? '' : 's'} on PATH ` +
        `${p.windowsBinaryCount === 1 ? 'is a Windows binary' : 'are Windows binaries'}: ` +
        p.windowsBinaries.join(', ') +
        (p.windowsBinaryCount > p.windowsBinaries.length ? ', …' : '')
    )
  }
  if (p.wslenv !== null) facts.push(`- WSLENV: ${p.wslenv}`)
  if (p.environmentVariableCount !== null) {
    facts.push(
      `- Environment: ${p.environmentVariableCount} variables, ${p.secretVariableCount ?? 0} masked ` +
        `as secrets, ${p.windowsOriginatedVariableCount ?? 0} from Windows (values withheld)`
    )
  }
  if (facts.length === 0) return
  lines.push('### PATH & interop', '', ...facts, '')
}

function networkSection(lines: string[], ctx: DevEnvContext): void {
  const n = ctx.network
  const facts: string[] = []
  const declared = n.networkingModeDeclared
  const effective = n.networkingModeEffective
  if (declared !== null || effective !== null) {
    facts.push(
      declared !== null && effective !== null && declared !== effective
        ? `- Networking mode: ${declared} declared, ${effective} in effect`
        : `- Networking mode: ${effective ?? declared}`
    )
  }
  if (n.ip !== null) facts.push(`- Distro IP: ${n.ip}`)
  if (n.localhostForwarding !== null) facts.push(`- localhostForwarding: ${n.localhostForwarding}`)
  const dns = n.dns
  if (dns !== null) {
    if (dns.error !== null) {
      facts.push(`- DNS: could not be read (${dns.error})`)
    } else {
      const servers = dns.nameserverCount === 0 ? 'no nameserver' : dns.nameservers.join(', ')
      const managed =
        dns.handManaged === true
          ? ` via hand-managed ${dns.resolvConfPath} (generateResolvConf=false)`
          : dns.handManaged === false
            ? ' (WSL-managed)'
            : ''
      const tunnel = dns.dnsTunneling === null ? '' : `, dnsTunneling=${dns.dnsTunneling}`
      const adapter =
        dns.windowsAdapterDns.length === 0
          ? ''
          : `; Windows adapter uses ${dns.windowsAdapterDns.join(', ')}`
      facts.push(`- DNS: ${servers}${managed}${tunnel}${adapter}`)
    }
  }
  if (n.firewall !== null && (n.firewall.enabled !== null || n.firewall.defaultInbound !== null)) {
    const state = n.firewall.enabled === null ? 'state unknown' : n.firewall.enabled ? 'on' : 'off'
    const inbound = n.firewall.defaultInbound === null ? '' : `, default inbound ${n.firewall.defaultInbound}`
    facts.push(`- Windows firewall: ${state}${inbound}`)
  }
  if (n.portProxy !== null) {
    facts.push(
      `- Port forwarding rules: ${n.portProxy.ruleCount}` +
        (n.portProxy.stale > 0 ? ` (${n.portProxy.stale} forwarding nowhere)` : '')
    )
  }
  if (facts.length === 0) return
  lines.push('### Network', '', ...facts, '')
}

function dockerSection(lines: string[], ctx: DevEnvContext): void {
  const d = ctx.docker
  if (d.status === 'unknown') return
  lines.push('### Docker', '')
  if (d.status === 'not-installed') {
    lines.push('- Not installed in this distro', '')
    return
  }
  const flavour = d.dockerDesktop ? 'Docker Desktop' : 'Docker'
  const version = d.serverVersion ?? d.clientVersion ?? 'version unknown'
  const state =
    d.status === 'running'
      ? 'daemon running'
      : d.status === 'not-probed'
        ? 'daemon not contacted'
        : d.status === 'error'
          ? `error: ${d.error ?? 'unknown'}`
          : 'daemon not running'
  const ctxName = d.context === null ? '' : `, context ${d.context}`
  const endpoint = d.endpoint === null ? '' : `, ${d.endpoint}`
  lines.push(`- ${flavour} ${version}, ${state}${ctxName}${endpoint}`)
  if (d.imageCount !== null && d.containerCount !== null) {
    const running = d.runningContainerCount === null ? '' : ` (${d.runningContainerCount} running)`
    lines.push(`- ${d.imageCount} images, ${d.containerCount} containers${running}`)
    for (const c of d.runningContainers) {
      lines.push(`- running: ${c.name} — ${c.image}${c.ports === '' ? '' : `, ${c.ports}`}`)
    }
    more(lines, d.runningContainersOmitted)
  }
  if (d.storageDistro !== null && d.storageDistro !== ctx.distro.name) {
    lines.push(`- Images and build cache live in the ${d.storageDistro} distribution's disk, not this one's`)
  }
  if (d.reclaimableBytes !== null) {
    const cache = d.buildCacheBytes === null ? '' : ` (build cache ${fmtBytesPlain(d.buildCacheBytes)})`
    lines.push(`- ${fmtBytesPlain(d.reclaimableBytes)} reclaimable by a prune${cache}`)
  }
  if (d.composeInstalled !== null) lines.push(`- docker compose: ${yesNo(d.composeInstalled)}`)
  lines.push('')
}

function servicesSection(lines: string[], ctx: DevEnvContext): void {
  const s = ctx.services
  if (s.systemd === null && s.total === null) return
  lines.push('### Services (systemd)', '')
  if (s.systemd === false) {
    lines.push('- systemd is disabled; unit-based services do not start on their own', '')
    return
  }
  if (s.total !== null) {
    const failed =
      s.failed === null || s.failed === 0
        ? ''
        : `, ${s.failed} failed (${s.failedUnits.join(', ')}${s.failedUnitsOmitted > 0 ? ', …' : ''})`
    lines.push(`- ${s.total} units: ${s.active ?? 'unknown'} active${failed}`)
    for (const unit of s.notable) {
      lines.push(`- ${unit.name}: ${unit.activeState} (${unit.subState}, ${unit.scope})`)
    }
    more(lines, s.notableOmitted)
  } else {
    lines.push('- Units not read yet')
  }
  lines.push('')
}

function portsSection(lines: string[], ctx: DevEnvContext): void {
  const p = ctx.ports
  if (p.listeningCount === 0 && p.windowsOnlyCount === null) return
  lines.push('### Ports in use', '')
  if (p.listeningCount === 0) {
    lines.push('- Nothing is listening inside the distro')
  }
  for (const port of p.items) {
    const proc = port.process ?? 'unknown process'
    lines.push(`- ${port.port}/${port.protocol} ${proc} — ${REACHABILITY_TEXT[port.reachability]}`)
  }
  more(lines, p.omitted)
  if (p.windowsOnlyCount !== null && p.windowsOnlyCount > 0) {
    const named = p.windowsOnly.map((w) => `${w.process ?? 'unknown'}:${w.port}`).join(', ')
    lines.push(
      `- Windows-only listeners: ${p.windowsOnlyCount} (${named}${p.windowsOnlyOmitted > 0 ? ', …' : ''})`
    )
  }
  lines.push('')
}

function mountLine(fs: DevEnvFilesystem): string {
  if (!fs.exists) return `- ${fs.mountPoint} — not mounted`
  const kind =
    fs.side === 'windows-mount'
      ? 'Windows drive, slow for many small files'
      : fs.side === 'ext4'
        ? 'distro disk'
        : 'mount'
  const used = fs.usePercent === null ? '' : `, ${fs.usePercent}% used`
  const free = fs.availableBytes === null ? '' : `, ${fmtBytesPlain(fs.availableBytes)} free`
  return `- ${fs.mountPoint} — ${kind}${used}${free}`
}

function storageSection(lines: string[], ctx: DevEnvContext): void {
  const s = ctx.storage
  const facts: string[] = []
  for (const fs of s.filesystems) facts.push(mountLine(fs))
  if (s.filesystemsOmitted > 0) facts.push(`- … and ${s.filesystemsOmitted} more`)
  const image = s.image
  if (image !== null && image.vhdxBytes !== null) {
    const used = image.fsUsedBytes === null ? '' : `, ${fmtBytesPlain(image.fsUsedBytes)} used inside`
    const reclaim =
      image.reclaimableBytes === null ? '' : `, ${fmtBytesPlain(image.reclaimableBytes)} reclaimable`
    facts.push(`- Disk image: ${fmtBytesPlain(image.vhdxBytes)} on the Windows disk${used}${reclaim}`)
  }
  if (s.windowsDrives !== null && s.windowsDrives.length > 0) {
    facts.push(
      '- Windows drives: ' +
        s.windowsDrives
          .map((d) => `${d.point} ${d.metadata ? 'with' : 'without'} metadata`)
          .join(', ') +
        (s.windowsDrivesOmitted > 0 ? ', …' : '') +
        (s.drivesWithoutMetadata.length > 0 ? ' (chmod/chown do not persist without it)' : '')
    )
  }
  const m = s.memory
  if (m.totalBytes !== null) {
    const limit =
      m.vmLimitBytes === null
        ? ''
        : ` (VM limit ${fmtBytesPlain(m.vmLimitBytes)}${m.vmLimitSource === 'wslconfig' ? ' from .wslconfig' : ''})`
    const swap = m.swapTotalBytes === null ? '' : `; swap ${fmtBytesPlain(m.swapUsedBytes)} / ${fmtBytesPlain(m.swapTotalBytes)}`
    const cpus = s.cpuCount === null ? '' : `; ${s.cpuCount} CPUs`
    facts.push(`- Memory: ${fmtBytesPlain(m.usedBytes)} used / ${fmtBytesPlain(m.totalBytes)}${limit}${swap}${cpus}`)
  }
  if (s.knownCachesBytes !== null) {
    const top = s.topCaches.map((c) => `${c.id} ${fmtBytesPlain(c.bytes)}`).join(', ')
    facts.push(
      `- Known caches: ${fmtBytesPlain(s.knownCachesBytes)} measured` +
        (s.knownCachesPartial ? ' (partial)' : '') +
        (top === '' ? '' : ` — ${top}`)
    )
  }
  if (facts.length === 0) return
  lines.push('### Mounts & disk', '', ...facts, '')
}

function configsSection(lines: string[], ctx: DevEnvContext): void {
  const c = ctx.configs
  const facts: string[] = []
  if (c.wslconfig.exists !== null || c.wslConf.exists !== null) {
    const exists = (v: boolean | null): string => (v === null ? 'unknown' : v ? 'exists' : 'absent')
    facts.push(
      `- .wslconfig: ${c.wslconfig.path ?? 'path unknown'} (${exists(c.wslconfig.exists)}); ` +
        `/etc/wsl.conf: ${exists(c.wslConf.exists)}` +
        (c.restartPending ? '; a change waits for `wsl --shutdown`' : '')
    )
  }
  if (c.settings.length > 0) {
    facts.push(
      '- Declared: ' +
        c.settings
          .map((s) => `[${s.section}] ${s.key}=${s.declaredValue}` + (s.verdict === 'applied' ? '' : ` (${s.verdict})`))
          .join(', ') +
        (c.settingsOmitted > 0 ? `, … and ${c.settingsOmitted} more` : '')
    )
  }
  if (c.files.length > 0) {
    facts.push(
      `- Files present: ${c.files.map((f) => f.label).join(', ')}` +
        (c.filesOmitted > 0 ? `, … and ${c.filesOmitted} more` : '')
    )
  }
  if (c.toolConfigs.length > 0) {
    facts.push(
      `- Tool configs: ${c.toolConfigs.map((t) => t.path).join(', ')}` +
        (c.toolConfigsOmitted > 0 ? `, … and ${c.toolConfigsOmitted} more` : '')
    )
  }
  if (c.terminalProfile !== null && c.terminalProfile.hasProfile !== null) {
    facts.push(
      c.terminalProfile.hasProfile
        ? `- Windows Terminal profile: ${c.terminalProfile.profileName}`
        : '- Windows Terminal has no profile for this distro'
    )
  }
  if (facts.length === 0) return
  lines.push('### Configuration', '', ...facts, '')
}

const CHECK_ORDER: Record<DevEnvVerdict, number> = { problem: 0, attention: 1, unknown: 2, ok: 3 }

function checkLine(c: DevEnvCheck): string {
  const detail = c.detail === null ? '' : ` ${c.detail}`
  const cmd = c.suggestedCommand === null ? '' : ` Prepared, not run: \`${c.suggestedCommand}\``
  return `- [${c.status}] ${c.summary}${detail}${cmd}`
}

function doctorSection(lines: string[], ctx: DevEnvContext): void {
  const d = ctx.doctor
  const counts = d.counts
  lines.push(
    `### Environment doctor — ${d.overall}` +
      ` (${counts.problem} problem, ${counts.attention} attention, ${counts.unknown} unknown, ${counts.ok} ok)`,
    ''
  )
  // Only what needs a look earns a line; passing checks are a count, and an
  // unknown is named so it is never read as a pass.
  const shown = d.checks
    .filter((c) => c.status !== 'ok')
    .sort((a, b) => CHECK_ORDER[a.status] - CHECK_ORDER[b.status])
  if (shown.length === 0) {
    lines.push('- Nothing needs attention.')
  }
  for (const c of shown) lines.push(checkLine(c))
  lines.push('')
}

function provenanceSection(lines: string[], ctx: DevEnvContext): void {
  const p = ctx.provenance
  const parts: string[] = [`snapshot ${p.collectedAt}`]
  if (p.ageSeconds !== null) parts.push(`${p.ageSeconds}s old when rendered`)
  if (p.appVersion !== null) parts.push(`WSLPad ${p.appVersion}`)
  parts.push(
    p.distroAnswering === null
      ? 'distro liveness unknown'
      : p.distroAnswering
        ? 'distro answering'
        : `distro not answering (last reply ${p.lastAliveAt ?? 'never'})`
  )
  lines.push('### Provenance', '', `- ${parts.join('; ')}`)
  if (p.notCollected.length > 0) {
    lines.push(`- Not collected yet (unknown, not empty): ${p.notCollected.join(', ')}`)
  }
  if (p.staleQueries.length > 0) {
    lines.push(`- Last query failed, last good value kept: ${p.staleQueries.join(', ')}`)
  }
  if (p.truncated.length > 0) {
    lines.push(`- Lists cut to their cap: ${p.truncated.join(', ')}`)
  }
  lines.push('')
}

/**
 * Render the context as the agent block. Sections with nothing known are
 * left out entirely rather than printed as a column of "unknown"; the
 * provenance section names what was left out.
 */
export function devEnvContextToMarkdown(ctx: DevEnvContext): string {
  const lines: string[] = []
  header(lines, ctx)
  workspace(lines, ctx)
  pathsSection(lines, ctx)
  toolGroup(lines, 'Runtimes', ctx.runtimes)
  toolGroup(lines, 'Package managers', ctx.packageManagers)
  toolGroup(lines, 'Tools on PATH', ctx.tools)
  pathSection(lines, ctx)
  networkSection(lines, ctx)
  dockerSection(lines, ctx)
  servicesSection(lines, ctx)
  portsSection(lines, ctx)
  storageSection(lines, ctx)
  configsSection(lines, ctx)
  doctorSection(lines, ctx)
  provenanceSection(lines, ctx)
  return lines.join('\n').trimEnd() + '\n'
}
