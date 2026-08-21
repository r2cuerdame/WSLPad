import type {
  DiagnosticsState,
  IncidentEvent,
  IncidentKind,
  IncidentSeverity,
  NetworkCheckResult,
  RecoveryCheckResult,
  RecoveryResumeChange,
  WslPadSnapshot
} from '@shared/types'
import type { DistroRunner } from '../wsl/contracts'
import { runNetworkCheck, type NetworkCheckDeps } from '../wsl/network-check'
import { buildRecoveryCheck } from './recovery'

interface ObservedState {
  selectedDistro: string | null
  distroState: string | null
  answering: boolean | null
  networkMode: string | null
  dnsFingerprint: string | null
  dnsDetail: string | null
  consoleStatus: string
}

const MAX_INCIDENTS = 100
const CONSOLE_FAILURES = new Set(['start-failed', 'distro-stopped'])

function observeState(snapshot: WslPadSnapshot): ObservedState {
  const distro = snapshot.selectedDistro
  const dash = snapshot.dashboard
  const dns = dash?.dns
  const dnsDetail = dns
    ? `WSL: ${dns.nameservers.join(', ') || 'none'}; Windows: ${dns.windowsAdapterDns.join(', ') || 'none'}`
    : null
  return {
    selectedDistro: distro,
    distroState: distro
      ? (snapshot.distros.find((item) => item.name === distro)?.state ?? null)
      : null,
    answering: snapshot.liveness?.answering ?? null,
    networkMode: dash?.wslSettings?.networkingModeEffective ?? null,
    dnsFingerprint: dns
      ? JSON.stringify([dns.nameservers, dns.windowsAdapterDns, dns.error])
      : null,
    dnsDetail,
    consoleStatus: snapshot.terminal.status
  }
}

export class DiagnosticsService {
  private incidents: IncidentEvent[] = []
  private lastNetworkCheck: NetworkCheckResult | null = null
  private lastRecoveryCheck: RecoveryCheckResult | null = null
  private previous: ObservedState | null = null
  private suspendedState: ObservedState | null = null
  private resumedAt: string | null = null
  private subscribers = new Set<(state: DiagnosticsState) => void>()
  private nextId = 1
  private checkInFlight: Promise<NetworkCheckResult> | null = null
  private recoveryInFlight: Promise<RecoveryCheckResult> | null = null

  constructor(
    private runner: DistroRunner | null,
    private getSnapshot: () => WslPadSnapshot,
    private networkDeps: Omit<NetworkCheckDeps, 'runner'> = {}
  ) {}

  get(): DiagnosticsState {
    return {
      incidents: [...this.incidents],
      lastNetworkCheck: this.lastNetworkCheck,
      lastRecoveryCheck: this.lastRecoveryCheck
    }
  }

  subscribe(cb: (state: DiagnosticsState) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  observe(snapshot: WslPadSnapshot): void {
    const next = observeState(snapshot)
    const prev = this.previous
    if (prev === null) {
      this.add(
        'monitoring-started',
        'info',
        null,
        'diagnostics.incident.monitoringStarted',
        {},
        'Session monitoring started'
      )
      if (next.selectedDistro) this.selected(next.selectedDistro)
      this.previous = next
      return
    }

    if (prev.selectedDistro !== next.selectedDistro) {
      if (next.selectedDistro) this.selected(next.selectedDistro)
      this.previous = next
      return
    }

    const distro = next.selectedDistro
    if (
      distro &&
      prev.distroState !== next.distroState &&
      prev.distroState !== null &&
      next.distroState !== null
    ) {
      this.add(
        'distro-state',
        next.distroState === 'Running' ? 'recovery' : 'warning',
        distro,
        'diagnostics.incident.distroState',
        { distro, from: prev.distroState, to: next.distroState },
        `Distribution ${distro}: ${prev.distroState} → ${next.distroState}`
      )
    }
    if (distro && prev.answering === true && next.answering === false) {
      this.add(
        'distro-unresponsive',
        'warning',
        distro,
        'diagnostics.incident.unresponsive',
        { distro },
        `Distribution ${distro} stopped answering`
      )
    } else if (distro && prev.answering === false && next.answering === true) {
      this.add(
        'distro-recovered',
        'recovery',
        distro,
        'diagnostics.incident.recovered',
        { distro },
        `Distribution ${distro} is answering again`
      )
    }
    if (distro && prev.networkMode && next.networkMode && prev.networkMode !== next.networkMode) {
      this.add(
        'network-mode',
        'warning',
        distro,
        'diagnostics.incident.networkMode',
        { from: prev.networkMode, to: next.networkMode },
        `Effective networking mode changed: ${prev.networkMode} → ${next.networkMode}`
      )
    }
    if (
      distro &&
      prev.dnsFingerprint &&
      next.dnsFingerprint &&
      prev.dnsFingerprint !== next.dnsFingerprint
    ) {
      this.add(
        'dns-changed',
        'warning',
        distro,
        'diagnostics.incident.dnsChanged',
        {},
        'DNS configuration changed',
        next.dnsDetail
      )
    }
    const wasFailed = CONSOLE_FAILURES.has(prev.consoleStatus)
    const isFailed = CONSOLE_FAILURES.has(next.consoleStatus)
    if (distro && !wasFailed && isFailed) {
      this.add(
        'console-failed',
        'warning',
        distro,
        'diagnostics.incident.consoleFailed',
        { status: next.consoleStatus },
        `Console failed: ${next.consoleStatus}`
      )
    } else if (distro && wasFailed && next.consoleStatus === 'ready') {
      this.add(
        'console-recovered',
        'recovery',
        distro,
        'diagnostics.incident.consoleRecovered',
        {},
        'Console recovered'
      )
    }
    this.previous = next
  }

  recordPower(kind: 'suspend' | 'resume'): void {
    const snapshot = this.getSnapshot()
    const distro = snapshot.selectedDistro
    if (kind === 'suspend') this.suspendedState = observeState(snapshot)
    else this.resumedAt = new Date().toISOString()
    this.add(
      kind === 'suspend' ? 'power-suspend' : 'power-resume',
      'info',
      distro,
      kind === 'suspend' ? 'diagnostics.incident.suspend' : 'diagnostics.incident.resume',
      {},
      kind === 'suspend' ? 'Windows is suspending' : 'Windows resumed from sleep'
    )
  }

  runNetworkCheck(port: number | null): Promise<NetworkCheckResult> {
    if (this.checkInFlight !== null) return this.checkInFlight
    const pending = runNetworkCheck(this.getSnapshot(), port, {
      runner: this.runner,
      ...this.networkDeps
    }).then((result) => {
      this.lastNetworkCheck = result
      const failed = result.probes.filter((probe) => probe.status === 'fail').length
      const unknown = result.probes.filter((probe) => probe.status === 'unknown').length
      this.add(
        'network-check',
        failed > 0 ? 'warning' : 'info',
        result.distro,
        'diagnostics.incident.networkCheck',
        { failed, unknown },
        `Network check completed: ${failed} failed, ${unknown} unknown`
      )
      return result
    })
    this.checkInFlight = pending
    void pending.then(
      () => {
        this.checkInFlight = null
      },
      () => {
        this.checkInFlight = null
      }
    )
    return pending
  }

  runRecoveryCheck(port: number | null): Promise<RecoveryCheckResult> {
    if (this.recoveryInFlight !== null) return this.recoveryInFlight
    const snapshot = this.getSnapshot()
    const pending = runNetworkCheck(snapshot, port, {
      runner: this.runner,
      ...this.networkDeps
    }).then((network) => {
      this.lastNetworkCheck = network
      const result = buildRecoveryCheck(snapshot, network, {
        resumedAt: this.resumedAt,
        resumeChanges: this.resumeChanges(snapshot)
      })
      this.lastRecoveryCheck = result
      const failed = network.probes.filter((probe) => probe.status === 'fail').length
      this.add(
        'recovery-check',
        failed > 0 ? 'warning' : 'info',
        result.distro,
        'diagnostics.incident.recoveryCheck',
        { step: result.recommendedStep, failed },
        `Recovery check completed: ${result.recommendedStep} (${failed} failed probes)`
      )
      return result
    })
    this.recoveryInFlight = pending
    void pending.then(
      () => {
        this.recoveryInFlight = null
      },
      () => {
        this.recoveryInFlight = null
      }
    )
    return pending
  }

  private resumeChanges(snapshot: WslPadSnapshot): RecoveryResumeChange[] {
    const before = this.suspendedState
    if (before === null || this.resumedAt === null) return []
    const after = observeState(snapshot)
    if (before.selectedDistro !== after.selectedDistro) return []
    const changes: RecoveryResumeChange[] = []
    const add = (
      id: RecoveryResumeChange['id'],
      previous: string | boolean | null,
      current: string | boolean | null
    ): void => {
      if (previous === current) return
      changes.push({
        id,
        before: previous === null ? 'unknown' : String(previous),
        after: current === null ? 'unknown' : String(current)
      })
    }
    add('distro-state', before.distroState, after.distroState)
    add('liveness', before.answering, after.answering)
    add('network-mode', before.networkMode, after.networkMode)
    if (before.dnsFingerprint !== after.dnsFingerprint)
      add('dns', before.dnsDetail, after.dnsDetail)
    add('console', before.consoleStatus, after.consoleStatus)
    return changes
  }

  private selected(distro: string): void {
    this.add(
      'distro-selected',
      'info',
      distro,
      'diagnostics.incident.distroSelected',
      { distro },
      `Selected distribution ${distro}`
    )
  }

  private add(
    kind: IncidentKind,
    severity: IncidentSeverity,
    distro: string | null,
    messageKey: string,
    params: Record<string, string | number>,
    message: string,
    detail: string | null = null
  ): void {
    const event: IncidentEvent = {
      id: `incident-${this.nextId++}`,
      at: new Date().toISOString(),
      kind,
      severity,
      distro,
      messageKey,
      params,
      message,
      detail
    }
    this.incidents = [event, ...this.incidents].slice(0, MAX_INCIDENTS)
    this.emit()
  }

  private emit(): void {
    const state = this.get()
    for (const cb of this.subscribers) {
      try {
        cb(state)
      } catch {
        // Diagnostics must never break snapshot collection.
      }
    }
  }
}
