/**
 * Environment Doctor (issue #89).
 *
 * Pure function that derives explicit healthy/warning/error/unknown verdicts
 * from an existing DashboardSnapshot — no new probes, no mutations, no
 * side-effects. Collectors already gather the facts; this module judges them.
 *
 * Security invariants:
 * - Commands are prepared-only (Console pattern, goal.md §2.2, §8.5).
 * - Masked markdown uses the same masking as Copy-for-LLM.
 * - Unknown remains unknown — never guessed.
 */

import type {
  DashboardSnapshot,
  DoctorCheckResult,
  DoctorReport,
  DoctorVerdict
} from './types'
import { MASKED_VALUE } from './constants'

// ---------------------------------------------------------------------------
// Individual checks — each examines one concern from the snapshot
// ---------------------------------------------------------------------------

function checkProjectPath(dash: DashboardSnapshot): DoctorCheckResult {
  const pwd = dash.environment.find((e) => e.name === 'PWD')
  if (!pwd || pwd.isSecret || !pwd.maskedValue) {
    return {
      id: 'project-path',
      title: 'Project path filesystem',
      verdict: 'unknown',
      evidence: 'Current working directory (PWD) was not collected, so workspace filesystem placement is unknown.',
      command: null
    }
  }
  if (pwd.maskedValue.startsWith('/mnt/')) {
    return {
      id: 'project-path',
      title: 'Project path filesystem',
      verdict: 'warning',
      evidence: `Current working directory ${pwd.maskedValue} is on a Windows mount (/mnt). Developer workloads are usually faster on the native WSL filesystem.`,
      command: null
    }
  }
  if (pwd.maskedValue.startsWith('/')) {
    return {
      id: 'project-path',
      title: 'Project path filesystem',
      verdict: 'healthy',
      evidence: `Current working directory ${pwd.maskedValue} is on the Linux filesystem rather than /mnt.`,
      command: null
    }
  }
  return {
    id: 'project-path',
    title: 'Project path filesystem',
    verdict: 'unknown',
    evidence: `Current working directory '${pwd.maskedValue}' could not be classified safely.`,
    command: null
  }
}

function checkBinaryShadowing(dash: DashboardSnapshot): DoctorCheckResult {
  const shadowed = dash.tools.filter((t) => t.installed && t.shadowedByWindows)
  if (shadowed.length === 0) {
    const installed = dash.tools.filter((t) => t.installed)
    if (installed.length === 0) {
      return {
        id: 'binary-shadowing',
        title: 'Windows/WSL binary shadowing',
        verdict: 'unknown',
        evidence: 'No tools are installed; shadowing cannot be assessed.',
        command: null
      }
    }
    return {
      id: 'binary-shadowing',
      title: 'Windows/WSL binary shadowing',
      verdict: 'healthy',
      evidence: `${installed.length} installed tool(s) checked; none are shadowed by a Windows binary on PATH.`,
      command: null
    }
  }
  const names = shadowed.map((t) => t.displayName).join(', ')
  return {
    id: 'binary-shadowing',
    title: 'Windows/WSL binary shadowing',
    verdict: 'warning',
    evidence: `${shadowed.length} tool(s) shadowed by Windows binaries via /mnt: ${names}. The Windows version may differ from the one installed in WSL.`,
    command: null
  }
}

function checkPathDuplication(dash: DashboardSnapshot): DoctorCheckResult {
  const pathVar = dash.environment.find((e) => e.name === 'PATH')
  if (!pathVar) {
    return {
      id: 'path-duplication',
      title: 'PATH duplication',
      verdict: 'unknown',
      evidence: 'PATH variable was not collected.',
      command: null
    }
  }
  // The masked value for PATH is the actual value (it's not a secret).
  // We check for /mnt entries to detect Windows PATH appended.
  const mntEntries = pathVar.maskedValue.split(':').filter((e) => e.startsWith('/mnt/'))
  if (mntEntries.length === 0) {
    return {
      id: 'path-duplication',
      title: 'PATH duplication',
      verdict: 'healthy',
      evidence: 'No Windows PATH entries (/mnt/) detected in the Linux PATH.',
      command: null
    }
  }
  // Check for duplicate entries
  const entries = pathVar.maskedValue.split(':')
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const e of entries) {
    if (seen.has(e)) dupes.push(e)
    seen.add(e)
  }
  if (dupes.length > 0) {
    return {
      id: 'path-duplication',
      title: 'PATH duplication',
      verdict: 'warning',
      evidence: `PATH has ${mntEntries.length} Windows entry/entries via /mnt and ${dupes.length} duplicate(s). Duplicates slow shell startup.`,
      command: null
    }
  }
  return {
    id: 'path-duplication',
    title: 'PATH duplication',
    verdict: 'healthy',
    evidence: `PATH has ${mntEntries.length} Windows entry/entries via /mnt; no duplicates found.`,
    command: null
  }
}

function checkGitSshConfig(dash: DashboardSnapshot): DoctorCheckResult {
  const git = dash.tools.find((t) => t.id === 'git')
  const gitConfig = dash.configuration.find((c) => c.id === 'gitconfig')
  const sshDir = dash.configuration.find((c) => c.id === 'ssh-config')

  const problems: string[] = []

  if (!git || !git.installed) {
    return {
      id: 'git-ssh-config',
      title: 'Git/SSH/credential configuration',
      verdict: 'unknown',
      evidence: 'Git is not installed; cannot assess Git/SSH configuration.',
      command: null
    }
  }

  if (
    !gitConfig ||
    !sshDir ||
    gitConfig.exists === null ||
    sshDir.exists === null ||
    git.side === 'unknown' ||
    !git.executablePath
  ) {
    return {
      id: 'git-ssh-config',
      title: 'Git/SSH/credential configuration',
      verdict: 'unknown',
      evidence: 'Git is installed, but its side/path or Git/SSH configuration presence was not fully collected.',
      command: null
    }
  }

  if (git.shadowedByWindows) {
    problems.push('Git is a Windows binary reached through /mnt — credentials and SSH keys may be from the Windows side')
  }

  if (gitConfig && gitConfig.exists === false) {
    problems.push('~/.gitconfig does not exist')
  }

  if (sshDir && sshDir.exists === false) {
    problems.push('SSH configuration not found')
  }

  if (problems.length === 0) {
    return {
      id: 'git-ssh-config',
      title: 'Git/SSH/credential configuration',
      verdict: 'healthy',
      evidence: `Git is installed at ${git.executablePath ?? 'unknown path'} on ${git.side}; configuration files present.`,
      command: null
    }
  }

  const verdict: DoctorVerdict = git.shadowedByWindows ? 'error' : 'warning'
  return {
    id: 'git-ssh-config',
    title: 'Git/SSH/credential configuration',
    verdict,
    evidence: problems.join('. ') + '.',
    command: null
  }
}

function checkDns(dash: DashboardSnapshot): DoctorCheckResult {
  const dns = dash.dns
  if (!dns) {
    return {
      id: 'dns-config',
      title: 'DNS/resolv.conf consistency',
      verdict: 'unknown',
      evidence: 'DNS configuration was not collected.',
      command: null
    }
  }
  if (dns.error) {
    return {
      id: 'dns-config',
      title: 'DNS/resolv.conf consistency',
      verdict: 'error',
      evidence: `DNS collector error: ${dns.error}`,
      command: null
    }
  }

  if (
    dns.isGeneratedSymlink === null ||
    dns.generateResolvConf === null ||
    dns.dnsTunneling === null
  ) {
    return {
      id: 'dns-config',
      title: 'DNS/resolv.conf consistency',
      verdict: 'unknown',
      evidence: 'DNS was collected, but resolver generation/tunneling state is incomplete.',
      command: null
    }
  }

  const problems: string[] = []

  if (dns.generateResolvConf === false && dns.isGeneratedSymlink === false) {
    // Manual resolv.conf — could be stale
    if (dns.nameservers.length === 0) {
      problems.push('/etc/resolv.conf has no nameservers (generateResolvConf=false, manual file)')
    } else if (dns.windowsAdapterDns.length > 0) {
      // Check if the configured nameservers match the Windows adapter DNS
      const mismatch = dns.nameservers.filter((ns) => !dns.windowsAdapterDns.includes(ns))
      if (mismatch.length > 0) {
        problems.push(
          `resolv.conf nameservers [${dns.nameservers.join(', ')}] differ from Windows adapter DNS [${dns.windowsAdapterDns.join(', ')}] — manual resolv.conf may be stale`
        )
      }
    }
  }

  if (problems.length === 0) {
    const mode = dns.dnsTunneling ? 'DNS tunneling enabled' : dns.generateResolvConf ? 'WSL-generated' : 'manual'
    return {
      id: 'dns-config',
      title: 'DNS/resolv.conf consistency',
      verdict: 'healthy',
      evidence: `DNS is ${mode} with ${dns.nameservers.length} nameserver(s).`,
      command: null
    }
  }

  return {
    id: 'dns-config',
    title: 'DNS/resolv.conf consistency',
    verdict: 'warning',
    evidence: problems.join('. ') + '.',
    command: null
  }
}

function checkPortFirewall(dash: DashboardSnapshot): DoctorCheckResult {
  const firewall = dash.firewall
  const listeningPorts = dash.ports.filter((p) => p.listening)

  if (!firewall) {
    return {
      id: 'port-firewall',
      title: 'Port/firewall reachability',
      verdict: 'unknown',
      evidence:
        listeningPorts.length === 0
          ? 'No listening ports and firewall state was not collected.'
          : `${listeningPorts.length} listening port(s) detected but firewall state was not collected.`,
      command: null
    }
  }

  const unreachable = listeningPorts.filter((p) => p.reachability === 'unreachable')
  const loopbackOnly = listeningPorts.filter((p) => p.reachability === 'loopback-only')
  const firewallState =
    firewall.enabled === null ? 'state unknown' : firewall.enabled ? 'enabled' : 'disabled'

  if (unreachable.length > 0) {
    const ports = unreachable.map((p) => p.port).join(', ')
    return {
      id: 'port-firewall',
      title: 'Port/firewall reachability',
      verdict: 'error',
      evidence: `${unreachable.length} port(s) unreachable: ${ports}. Firewall ${firewallState}, default inbound: ${firewall.defaultInbound ?? 'unknown'}.`,
      command: null
    }
  }

  if (loopbackOnly.length > 0) {
    return {
      id: 'port-firewall',
      title: 'Port/firewall reachability',
      verdict: 'warning',
      evidence: `${loopbackOnly.length} port(s) reachable only from loopback. Firewall ${firewallState}, default inbound: ${firewall.defaultInbound ?? 'unknown'}.`,
      command: null
    }
  }

  if (firewall.error || firewall.enabled === null || firewall.defaultInbound === null) {
    return {
      id: 'port-firewall',
      title: 'Port/firewall reachability',
      verdict: 'unknown',
      evidence: firewall.error
        ? `Firewall collector error: ${firewall.error}`
        : `Firewall state is incomplete (${firewallState}, default inbound: ${firewall.defaultInbound ?? 'unknown'}).`,
      command: null
    }
  }

  return {
    id: 'port-firewall',
    title: 'Port/firewall reachability',
    verdict: 'healthy',
    evidence: `Firewall ${firewallState}, default inbound: ${firewall.defaultInbound}. ${listeningPorts.length} listening port(s), none unreachable.`,
    command: null
  }
}

function checkVsCodeServer(dash: DashboardSnapshot): DoctorCheckResult {
  // VS Code Server processes are detectable from the process list
  const vscodeProcs = dash.processes.filter(
    (p) =>
      p.command.includes('.vscode-server') ||
      p.command.includes('vscode-server') ||
      p.command.includes('code-server')
  )

  if (vscodeProcs.length === 0) {
    return {
      id: 'vscode-server',
      title: 'VS Code Server state',
      verdict: 'unknown',
      evidence: 'No VS Code Server processes detected in the process list.',
      command: null
    }
  }

  // Check for stale/unhealthy processes — high CPU or very long-running
  const highCpu = vscodeProcs.filter((p) => p.cpuPercent > 80)
  const veryOld = vscodeProcs.filter((p) => p.elapsedSeconds > 7 * 86400) // 7 days

  if (highCpu.length > 0) {
    const pids = highCpu.map((p) => `PID ${p.pid} (${p.cpuPercent.toFixed(1)}% CPU)`).join(', ')
    return {
      id: 'vscode-server',
      title: 'VS Code Server state',
      verdict: 'warning',
      evidence: `${vscodeProcs.length} VS Code Server process(es) running; ${highCpu.length} with high CPU: ${pids}.`,
      command: null
    }
  }

  if (veryOld.length > 0) {
    return {
      id: 'vscode-server',
      title: 'VS Code Server state',
      verdict: 'warning',
      evidence: `${vscodeProcs.length} VS Code Server process(es) running; ${veryOld.length} older than 7 days. Consider restarting the server.`,
      command: null
    }
  }

  return {
    id: 'vscode-server',
    title: 'VS Code Server state',
    verdict: 'healthy',
    evidence: `${vscodeProcs.length} VS Code Server process(es) running normally.`,
    command: null
  }
}

function checkClockSkew(dash: DashboardSnapshot): DoctorCheckResult {
  const clock = dash.clock
  if (!clock) {
    return {
      id: 'clock-skew',
      title: 'WSL clock skew',
      verdict: 'unknown',
      evidence: 'Clock comparison was not collected.',
      command: null
    }
  }
  if (clock.skewSeconds === null) {
    return {
      id: 'clock-skew',
      title: 'WSL clock skew',
      verdict: 'unknown',
      evidence: 'Both clocks must be readable to calculate skew; one was null.',
      command: null
    }
  }

  const abs = Math.abs(clock.skewSeconds)
  if (abs <= 2) {
    return {
      id: 'clock-skew',
      title: 'WSL clock skew',
      verdict: 'healthy',
      evidence: `WSL clock is within 2 s of Windows (skew: ${clock.skewSeconds} s).`,
      command: null
    }
  }
  if (abs <= 30) {
    return {
      id: 'clock-skew',
      title: 'WSL clock skew',
      verdict: 'warning',
      evidence: `WSL clock differs from Windows by ${clock.skewSeconds} s. May cause TLS or certificate issues.`,
      command: 'wsl.exe --shutdown'
    }
  }
  return {
    id: 'clock-skew',
    title: 'WSL clock skew',
    verdict: 'error',
    evidence: `WSL clock differs from Windows by ${clock.skewSeconds} s. Will break TLS handshakes and package signature verification.`,
    command: 'wsl.exe --shutdown'
  }
}

function checkSystemdDocker(dash: DashboardSnapshot): DoctorCheckResult {
  const systemdEnabled = dash.system.systemdEnabled
  const docker = dash.docker
  const checks: string[] = []
  const failed = dash.services.filter((s) => s.activeState === 'failed')

  if (systemdEnabled === null) {
    return {
      id: 'systemd-docker',
      title: 'systemd/Docker/runtime readiness',
      verdict: 'unknown',
      evidence: 'systemd state was not collected.',
      command: null
    }
  }

  let verdict: DoctorVerdict = systemdEnabled ? 'healthy' : 'warning'
  checks.push(systemdEnabled ? 'systemd is enabled' : 'systemd is not enabled')

  if (docker === null) {
    checks.push('Docker state was not collected')
    if (verdict === 'healthy') verdict = 'unknown'
  } else if (docker.error) {
    checks.push(`Docker collector error: ${docker.error}`)
    if (verdict === 'healthy') verdict = 'unknown'
  } else if (docker.cliInstalled) {
    if (docker.daemonRunning) {
      checks.push(`Docker daemon running (server ${docker.serverVersion ?? 'unknown'})`)
    } else {
      checks.push(
        `Docker CLI installed but daemon not running${docker.notProbed ? ` (${docker.notProbed})` : ''}`
      )
      verdict = 'warning'
    }
  } else {
    checks.push('Docker CLI not installed (not applicable)')
  }

  if (failed.length > 0) {
    const names = failed.map((s) => s.name).join(', ')
    checks.push(`${failed.length} failed service(s): ${names}`)
    verdict = 'error'
  }

  return {
    id: 'systemd-docker',
    title: 'systemd/Docker/runtime readiness',
    verdict,
    evidence: checks.join('. ') + '.',
    command: null
  }
}

// ---------------------------------------------------------------------------
// Masked markdown report for LLM troubleshooting
// ---------------------------------------------------------------------------

function buildMaskedMarkdown(checks: DoctorCheckResult[], distroName: string): string {
  const lines: string[] = [
    `# WSLPad Environment Doctor Report`,
    ``,
    `**Distribution:** ${distroName}`,
    `**Generated:** ${new Date().toISOString()}`,
    ``
  ]

  const verdictIcon: Record<DoctorVerdict, string> = {
    healthy: '✅',
    warning: '⚠️',
    error: '❌',
    unknown: '❓'
  }

  for (const check of checks) {
    lines.push(`## ${verdictIcon[check.verdict]} ${check.title}`)
    lines.push(``)
    lines.push(`**Verdict:** ${check.verdict}`)
    // Mask any potential secret values or full paths in evidence
    const maskedEvidence = check.evidence
      .replace(/\/home\/[^ /]+/g, `/home/${MASKED_VALUE}`)
      .replace(/C:\\\\Users\\\\[^ \\]+/g, `C:\\\\Users\\\\${MASKED_VALUE}`)
      .replace(/\\\\wsl\.localhost\\\\[^ \\]+/g, `\\\\wsl.localhost\\\\${MASKED_VALUE}`)
    lines.push(`**Evidence:** ${maskedEvidence}`)
    if (check.command) {
      lines.push(`**Suggested command:** \`${check.command}\``)
    }
    lines.push(``)
  }

  const counts = {
    healthy: checks.filter((c) => c.verdict === 'healthy').length,
    warning: checks.filter((c) => c.verdict === 'warning').length,
    error: checks.filter((c) => c.verdict === 'error').length,
    unknown: checks.filter((c) => c.verdict === 'unknown').length
  }

  lines.push(`## Summary`)
  lines.push(``)
  lines.push(
    `✅ ${counts.healthy} healthy · ⚠️ ${counts.warning} warning · ❌ ${counts.error} error · ❓ ${counts.unknown} unknown`
  )

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the full Environment Doctor report from existing snapshot data.
 * Pure function — no I/O, no side-effects, no mutations.
 */
export function runDoctor(dash: DashboardSnapshot): DoctorReport {
  const checks: DoctorCheckResult[] = [
    checkProjectPath(dash),
    checkBinaryShadowing(dash),
    checkPathDuplication(dash),
    checkGitSshConfig(dash),
    checkDns(dash),
    checkPortFirewall(dash),
    checkVsCodeServer(dash),
    checkClockSkew(dash),
    checkSystemdDocker(dash)
  ]

  return {
    generatedAt: new Date().toISOString(),
    checks,
    maskedMarkdown: buildMaskedMarkdown(checks, dash.distro.name)
  }
}
