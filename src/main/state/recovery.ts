import type {
  NetworkCheckResult,
  ProcessInfo,
  RecoveryCheckResult,
  RecoveryResumeChange,
  RecoveryStep,
  RecoveryStepId,
  VsCodeServerProcess,
  VsCodeServerRole,
  WslPadSnapshot
} from '@shared/types'
import { shellQuote } from '../wsl/escape'

const VSCODE_ROOT_RE = /(?:^|\/)\.vscode-server(?:-insiders)?(?:\/|$)/i

function vscodeRole(command: string): VsCodeServerRole {
  if (/--type=extensionHost\b|extensionHost/i.test(command)) return 'extension-host'
  if (/--type=ptyHost\b|ptyHost/i.test(command)) return 'pty-host'
  if (/--type=fileWatcher\b|fileWatcher/i.test(command)) return 'file-watcher'
  if (/server-main\.js|remote-cli\/code/i.test(command)) return 'server-main'
  if (/languageServer|typescript-language-features|tsserver/i.test(command))
    return 'language-server'
  return 'other'
}

/** Never classify a generic node process: the VS Code Server root must be present. */
export function findVsCodeServerProcesses(processes: ProcessInfo[]): VsCodeServerProcess[] {
  return processes
    .filter((process) => VSCODE_ROOT_RE.test(process.command))
    .map((process) => ({
      pid: process.pid,
      role: vscodeRole(process.command),
      cpuPercent: process.cpuPercent,
      memPercent: process.memPercent,
      elapsedSeconds: process.elapsedSeconds
    }))
    .sort((a, b) => a.pid - b.pid)
}

function serverInstalled(
  snapshot: WslPadSnapshot,
  processes: VsCodeServerProcess[]
): boolean | null {
  if (processes.length > 0) return true
  const tools = snapshot.dashboard?.tools
  if (tools === undefined) return null
  const code = tools.find((tool) => tool.id === 'code')
  if (code === undefined) return null
  return code.configPaths.some((path) => VSCODE_ROOT_RE.test(path))
}

function statusFor(
  id: RecoveryStepId,
  recommended: RecoveryStepId,
  available: boolean
): RecoveryStep['status'] {
  if (!available) return 'unavailable'
  if (id === recommended) return 'recommended'
  return id === 'shutdown-wsl' ? 'last-resort' : 'available'
}

export interface RecoveryContext {
  resumedAt?: string | null
  resumeChanges?: RecoveryResumeChange[]
}

export function buildRecoveryCheck(
  snapshot: WslPadSnapshot,
  network: NetworkCheckResult,
  context: RecoveryContext = {}
): RecoveryCheckResult {
  const distro = network.distro
  const vscodeProcesses = findVsCodeServerProcesses(snapshot.dashboard?.processes ?? [])
  const distroProbe = network.probes.find((probe) => probe.id === 'distro')
  const wslNetworkFailed = network.probes.some(
    (probe) => (probe.id === 'wsl-dns' || probe.id === 'default-route') && probe.status === 'fail'
  )
  const distroState = snapshot.distros.find((item) => item.name === distro)?.state ?? 'Unknown'
  const orphanedVsCodeChildren =
    vscodeProcesses.length > 0 && !vscodeProcesses.some((process) => process.role === 'server-main')

  const recommendedStep: RecoveryStepId =
    distroState !== 'Running' ||
    snapshot.liveness?.answering === false ||
    distroProbe?.status === 'fail' ||
    wslNetworkFailed
      ? 'terminate-distro'
      : orphanedVsCodeChildren
        ? 'restart-vscode-server'
        : 'reload-window'

  const serverMainPids = vscodeProcesses
    .filter((process) => process.role === 'server-main')
    .map((process) => process.pid)
  // A live parent owns the remote session and is the narrowest useful target.
  // With no parent, clean up only the proven orphan children that remain.
  const vscodePids =
    serverMainPids.length > 0 ? serverMainPids : vscodeProcesses.map((process) => process.pid)
  const steps: RecoveryStep[] = [
    {
      id: 'reload-window',
      status: statusFor('reload-window', recommendedStep, true),
      command: null,
      reason: 'Reload the editor window first when WSL itself still answers.',
      impact: 'Only the current editor window reconnects.'
    },
    {
      id: 'restart-vscode-server',
      status: statusFor('restart-vscode-server', recommendedStep, vscodePids.length > 0),
      command: vscodePids.length > 0 ? `kill ${vscodePids.join(' ')}` : null,
      reason:
        vscodePids.length > 0
          ? `Only the ${vscodePids.length} measured VS Code Server processes are targeted.`
          : 'No process with a proven VS Code Server path was measured.',
      impact: 'VS Code remote windows for this distribution reconnect; other WSL jobs keep running.'
    },
    {
      id: 'terminate-distro',
      status: statusFor('terminate-distro', recommendedStep, true),
      command: `wsl.exe --terminate ${shellQuote(distro)}`,
      reason: 'Use only when the selected distribution or its WSL network path is not answering.',
      impact: 'Stops terminals, tmux, services, containers and jobs in this distribution.'
    },
    {
      id: 'shutdown-wsl',
      status: statusFor('shutdown-wsl', recommendedStep, true),
      command: 'wsl.exe --shutdown',
      reason: 'Global VM restart is reserved for failures that survive a selected-distro restart.',
      impact: 'Stops every distribution and may interrupt Docker Desktop and background sessions.'
    }
  ]

  return {
    distro,
    startedAt: network.startedAt,
    completedAt: network.completedAt,
    network,
    vscodeServerInstalled: serverInstalled(snapshot, vscodeProcesses),
    vscodeProcesses,
    recommendedStep,
    steps,
    resumedAt: context.resumedAt ?? null,
    resumeChanges: context.resumeChanges ?? []
  }
}
