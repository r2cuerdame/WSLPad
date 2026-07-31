import {
  MCP_DEFAULT_PORT,
  PROBE_BACKOFF_BASE_MS,
  PROBE_BACKOFF_MAX_MS,
  PROBE_TRUST_MS,
  SNAPSHOT_SCHEMA_VERSION
} from '@shared/constants'
import type {
  ClockInfo,
  ConfigurationFileInfo,
  DashboardSnapshot,
  DiskImageInfo,
  DistroDetails,
  DistroSummary,
  DnsInfo,
  DockerInfo,
  EnvironmentVariableInfo,
  ExplorerContext,
  FirewallInfo,
  PortProxyInfo,
  HermesInfo,
  ImportantPathInfo,
  McpStatus,
  MemoryReconciliation,
  PortInfo,
  ProcessInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  TerminalContext,
  ToolInfo,
  WarningInfo,
  WindowsPortInfo,
  WslConfigInfo,
  WslPadSnapshot
} from '@shared/types'
import type { WslProvider } from '../wsl/contracts'
import { assertValidDistroName } from '../wsl/escape'
import { applyReachability } from '../wsl/reachability'
import { correlatePorts } from '../wsl/windows-ports'
import { computeWarnings } from './warnings'

/** Dashboard data owned per selected distro; snapshot warnings are appended on build. */
interface DashboardSections {
  distro: DistroDetails
  system: SystemInfo
  resources: ResourceInfo
  disk: DiskImageInfo | null
  wslSettings: WslConfigInfo | null
  memoryDetail: MemoryReconciliation | null
  paths: ImportantPathInfo[]
  configuration: ConfigurationFileInfo[]
  tools: ToolInfo[]
  hermes: HermesInfo | null
  docker: DockerInfo | null
  environment: EnvironmentVariableInfo[]
  processes: ProcessInfo[]
  services: ServiceInfo[]
  ports: PortInfo[]
  windowsPorts: WindowsPortInfo[]
  firewall: FirewallInfo | null
  portProxy: PortProxyInfo | null
  clock: ClockInfo | null
  dns: DnsInfo | null
}

/**
 * Liveness state for the selected distro (issue #37). `failures` drives both
 * the warning and the doubling backoff; `until` is the instant before which no
 * probe and no in-distro collection is attempted at all.
 */
interface ProbeState {
  failures: number
  /** epoch ms; while now < until the distro is treated as unresponsive */
  until: number
  /** epoch ms; while now < trustedUntil a recent success is reused */
  trustedUntil: number
}

function freshProbe(): ProbeState {
  return { failures: 0, until: 0, trustedUntil: 0 }
}

function emptySystem(): SystemInfo {
  return {
    kernel: null,
    hostname: null,
    user: null,
    home: null,
    shell: null,
    uptimeSeconds: null,
    systemdEnabled: null,
    ip: null,
    windowsUserProfileLinux: null
  }
}

function emptyResources(): ResourceInfo {
  return {
    cpuPercent: null,
    cpuCount: null,
    memTotalBytes: null,
    memUsedBytes: null,
    memAvailableBytes: null,
    swapTotalBytes: null,
    swapUsedBytes: null,
    disks: [],
    loadAvg: null,
    processCount: null
  }
}

function sectionsFor(summary: DistroSummary): DashboardSections {
  return {
    distro: { ...summary, osName: null, uncPath: `\\\\wsl.localhost\\${summary.name}` },
    system: emptySystem(),
    resources: emptyResources(),
    disk: null,
    wslSettings: null,
    memoryDetail: null,
    paths: [],
    configuration: [],
    tools: [],
    hermes: null,
    docker: null,
    environment: [],
    processes: [],
    services: [],
    ports: [],
    windowsPorts: [],
    firewall: null,
    portProxy: null,
    clock: null,
    dns: null
  }
}

function defaultMcpStatus(): McpStatus {
  return {
    running: false,
    transport: 'http',
    endpoint: null,
    port: MCP_DEFAULT_PORT,
    connectedClients: 0,
    lastRequestAt: null,
    readOnly: true,
    tokenSet: false,
    error: null
  }
}

const MAX_TRACKED_RUNNER_FAILURES = 20

/**
 * Single source of truth for the WslPadSnapshot (goal.md §10). Collectors run
 * through the injected WslProvider in three tiers (goal.md §9.3); a failing
 * section keeps its last-good data and surfaces a runner-failure warning
 * instead of throwing (goal.md §9.2). When the selected distro is not running
 * the in-distro tiers are skipped entirely so polling never wakes a stopped
 * distro — cached dashboard data stays visible while the distro state itself
 * keeps updating from the list tier. A running distro that has stopped
 * answering is handled the same way through the liveness gate (issue #37).
 */
export class SnapshotStore {
  private distros: DistroSummary[] = []
  private selected: string | null = null
  private sections: DashboardSections | null = null
  private explorer: ExplorerContext = { distro: null, currentPath: null, showHidden: false }
  private terminal: TerminalContext = { distro: null, cwd: null, status: 'disconnected' }
  private mcp: McpStatus = defaultMcpStatus()
  private warnings: WarningInfo[] = []
  /** Last-good Windows listener table; null until one read succeeded. */
  private windowsPortTable: WindowsPortInfo[] | null = null
  private runnerFailures: string[] = []
  private probe: ProbeState = freshProbe()
  private probeInFlight: Promise<boolean> | null = null
  private subscribers = new Set<(s: WslPadSnapshot) => void>()
  private inFlight = { fast: false, medium: false, slow: false }
  private disposed = false
  private current: WslPadSnapshot

  constructor(private provider: WslProvider) {
    this.current = this.build()
  }

  get(): WslPadSnapshot {
    return this.current
  }

  subscribe(cb: (s: WslPadSnapshot) => void): () => void {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  async initialize(): Promise<void> {
    await this.collect(
      'wsl --list --verbose',
      () => this.provider.listDistros(),
      (list) => this.applyDistroList(list)
    )
    this.recomputeWarnings()
    this.emit()
  }

  async setDistro(name: string): Promise<void> {
    assertValidDistroName(name)
    if (name === this.selected) return
    const summary = this.distros.find((d) => d.name === name)
    if (!summary) throw new Error(`Unknown WSL distro: ${name}`)
    this.selectInternal(summary)
    this.recomputeWarnings()
    this.emit()
    await Promise.all([this.refreshFast(), this.refreshMedium(), this.refreshSlow()])
  }

  async refreshFast(): Promise<void> {
    if (this.disposed || this.inFlight.fast) return
    this.inFlight.fast = true
    try {
      await this.collect(
        'wsl --list --verbose',
        () => this.provider.listDistros(),
        (list) => this.applyDistroList(list)
      )
      const distro = this.runningSelected()
      const s = this.sections
      if (distro && s) {
        // The Windows listener table is a host query: it stays fresh even when
        // the distro itself is wedged, so it runs outside the liveness gate.
        const windowsPorts = this.collectWindowsPorts()
        if (await this.distroResponsive(distro)) {
          await Promise.all([
            this.collect(
              'resources',
              () => this.provider.getResources(distro),
              (v) => {
                s.resources = v
              }
            ),
            this.collect(
              'processes',
              () => this.provider.getProcesses(distro),
              (v) => {
                s.processes = v
              }
            ),
            this.collect(
              'ports',
              () => this.provider.getPorts(distro),
              (v) => {
                s.ports = v
              }
            ),
            this.collectMemoryDetail(distro, s),
            this.collectClock(distro, s)
          ])
        }
        await windowsPorts
        const correlated = correlatePorts(s.ports, this.windowsPortTable)
        s.windowsPorts = correlated.windowsPorts
        // The verdict needs the networking mode and the firewall, both filled
        // by slower tiers: it is recomputed on every fast tick from whatever
        // is known, so an input that has not arrived reads as unknown rather
        // than as an open port.
        s.ports = applyReachability(
          correlated.ports,
          s.wslSettings?.networkingModeEffective ?? null,
          s.firewall
        )
      }
      this.recomputeWarnings()
      this.emit()
    } finally {
      this.inFlight.fast = false
    }
  }

  async refreshMedium(): Promise<void> {
    if (this.disposed || this.inFlight.medium) return
    this.inFlight.medium = true
    try {
      const distro = this.runningSelected()
      const s = this.sections
      if (distro && s) {
        // Firewall is a Windows query — same reasoning as the port table.
        const firewall = this.collectFirewall(s)
        const portProxy = this.collectPortProxy(s)
        if (await this.distroResponsive(distro)) {
          await Promise.all([
            this.collect(
              'services',
              () => this.provider.getServices(distro, s.system.systemdEnabled),
              (v) => {
                s.services = v
              }
            ),
            this.collect(
              'hermes',
              () => this.provider.getHermes(distro),
              (v) => {
                s.hermes = v
              }
            ),
            this.collectDns(distro, s)
          ])
        }
        await firewall
        await portProxy
      }
      this.recomputeWarnings()
      this.emit()
    } finally {
      this.inFlight.medium = false
    }
  }

  async refreshSlow(): Promise<void> {
    if (this.disposed || this.inFlight.slow) return
    this.inFlight.slow = true
    try {
      const distro = this.runningSelected()
      const s = this.sections
      if (distro && s && (await this.distroResponsive(distro))) {
        await Promise.all([
          this.collect(
            'distro details',
            () => this.provider.getDistroDetails(distro),
            (v) => {
              s.distro = v
            }
          ),
          this.collect(
            'system info',
            () => this.provider.getSystemInfo(distro),
            (v) => {
              s.system = v
            }
          ),
          this.collect(
            'tools',
            () => this.provider.getTools(distro),
            (v) => {
              s.tools = v
            }
          ),
          this.collect(
            'environment',
            () => this.provider.getEnvironment(distro),
            (v) => {
              s.environment = v
            }
          ),
          this.collect(
            'important paths',
            () => this.provider.getImportantPaths(distro),
            (v) => {
              s.paths = v
            }
          ),
          this.collect(
            'config files',
            () => this.provider.getConfigFiles(distro),
            (v) => {
              s.configuration = v
            }
          ),
          this.collectDiskImage(distro, s),
          this.collectWslSettings(distro, s),
          this.collectDocker(distro, s)
        ])
      }
      this.recomputeWarnings()
      this.emit()
    } finally {
      this.inFlight.slow = false
    }
  }

  setExplorerContext(ctx: ExplorerContext): void {
    this.explorer = ctx
    this.emit()
  }

  setTerminalContext(ctx: TerminalContext): void {
    this.terminal = ctx
    this.emit()
  }

  setMcpStatus(s: McpStatus): void {
    this.mcp = s
    this.recomputeWarnings()
    this.emit()
  }

  noteRunnerFailure(command: string): void {
    this.runnerFailures = this.runnerFailures.filter((c) => c !== command)
    this.runnerFailures.push(command)
    if (this.runnerFailures.length > MAX_TRACKED_RUNNER_FAILURES) {
      this.runnerFailures = this.runnerFailures.slice(-MAX_TRACKED_RUNNER_FAILURES)
    }
    this.recomputeWarnings()
    this.commit()
  }

  dispose(): void {
    this.disposed = true
    this.subscribers.clear()
  }

  /**
   * Windows-side listeners, polled in the fast tier next to the Linux ports.
   * A provider without a Windows view leaves the table unknown (null) instead
   * of claiming the ports are unbound.
   */
  private async collectWindowsPorts(): Promise<void> {
    const read = this.provider.getWindowsPorts
    if (read === undefined) return
    await this.collect(
      'netstat -ano',
      () => read.call(this.provider),
      (v) => {
        this.windowsPortTable = v
      }
    )
  }

  /**
   * Windows vs Linux memory reconciliation, polled in the fast tier next to
   * the resources it explains. A provider without the method leaves the
   * section null (unknown) rather than implying the two views agree.
   */
  private async collectMemoryDetail(distro: string, s: DashboardSections): Promise<void> {
    const read = this.provider.getMemoryDetail
    if (read === undefined) return
    await this.collect(
      'memory detail',
      () => read.call(this.provider, distro),
      (v) => {
        s.memoryDetail = v
      }
    )
  }

  /** Virtual disk image, slow tier: reading the .vhdx is a Windows file stat. */
  private async collectDiskImage(distro: string, s: DashboardSections): Promise<void> {
    const read = this.provider.getDiskImage
    if (read === undefined) return
    await this.collect(
      'disk image',
      () => read.call(this.provider, distro),
      (v) => {
        s.disk = v
      }
    )
  }

  /**
   * Windows firewall, medium tier: it explains why a listening port is not
   * reachable, so it is polled next to the sections that quote it.
   */
  private async collectFirewall(s: DashboardSections): Promise<void> {
    const read = this.provider.getFirewall
    if (read === undefined) return
    await this.collect(
      'firewall',
      () => read.call(this.provider),
      (v) => {
        s.firewall = v
      }
    )
  }

  /**
   * Docker, slow tier: `docker system df` walks the whole image store and can
   * take seconds, and none of these numbers move by the second.
   */
  private async collectDocker(distro: string, s: DashboardSections): Promise<void> {
    const read = this.provider.getDocker
    if (read === undefined) return
    await this.collect(
      'docker',
      () => read.call(this.provider, distro),
      (v) => {
        s.docker = v
      }
    )
  }

  /**
   * Windows port-forwarding rules, medium tier next to the firewall: both
   * answer "why does this port not reach me". The rules are judged against the
   * distro's current address, which is why the system section is read first.
   */
  private async collectPortProxy(s: DashboardSections): Promise<void> {
    const read = this.provider.getPortProxy
    if (read === undefined) return
    await this.collect(
      'port forwarding',
      () => read.call(this.provider, s.system.ip),
      (v) => {
        s.portProxy = v
      }
    )
  }

  /** Clock skew, fast tier: the value it reports is a live instant. */
  private async collectClock(distro: string, s: DashboardSections): Promise<void> {
    const read = this.provider.getClock
    if (read === undefined) return
    await this.collect(
      'clock',
      () => read.call(this.provider, distro),
      (v) => {
        s.clock = v
      }
    )
  }

  /** Resolver configuration, medium tier: files and adapters change rarely. */
  private async collectDns(distro: string, s: DashboardSections): Promise<void> {
    const read = this.provider.getDns
    if (read === undefined) return
    await this.collect(
      'dns',
      () => read.call(this.provider, distro),
      (v) => {
        s.dns = v
      }
    )
  }

  /**
   * Liveness gate for every in-distro collector (issue #37). A wedged distro
   * accepts the connection and then answers nothing, so without this each tier
   * would sit on its own timeout every tick and the whole app would look
   * frozen. On failure the cycle's in-distro work is skipped — last-good data
   * stays on screen — and the next attempt is pushed out by a doubling backoff
   * so a distro that stays wedged is asked once a minute, not once per tier.
   * Recovery needs nothing but one successful probe.
   */
  private async distroResponsive(distro: string): Promise<boolean> {
    const read = this.provider.probeDistro
    if (read === undefined) return true
    const now = Date.now()
    if (now < this.probe.trustedUntil) return true
    if (now < this.probe.until) return false
    // Tiers overlap; one probe per cycle answers all of them.
    if (this.probeInFlight !== null) return this.probeInFlight
    const pending = this.runProbe(read, distro)
    this.probeInFlight = pending
    try {
      return await pending
    } finally {
      this.probeInFlight = null
    }
  }

  private async runProbe(
    read: NonNullable<WslProvider['probeDistro']>,
    distro: string
  ): Promise<boolean> {
    let alive = false
    try {
      alive = await read.call(this.provider, distro)
    } catch {
      alive = false
    }

    if (alive) {
      const recovered = this.probe.failures > 0
      this.probe = { failures: 0, until: 0, trustedUntil: Date.now() + PROBE_TRUST_MS }
      if (recovered) this.recomputeWarnings()
      return true
    }

    const failures = this.probe.failures + 1
    const backoff = Math.min(
      PROBE_BACKOFF_BASE_MS * 2 ** (failures - 1),
      PROBE_BACKOFF_MAX_MS
    )
    this.probe = { failures, until: Date.now() + backoff, trustedUntil: 0 }
    // Derived from state, so the warning appears once and stays — a wedged
    // distro must not append a new warning on every poll.
    this.recomputeWarnings()
    return false
  }

  /** .wslconfig / wsl.conf reconciliation, slow tier: files change rarely. */
  private async collectWslSettings(distro: string, s: DashboardSections): Promise<void> {
    const read = this.provider.getWslSettings
    if (read === undefined) return
    await this.collect(
      'wsl settings',
      () => read.call(this.provider, distro),
      (v) => {
        s.wslSettings = v
      }
    )
  }

  /** Run one collector; on failure keep the last-good section and record a warning. */
  private async collect<T>(
    command: string,
    fn: () => Promise<T>,
    apply: (value: T) => void
  ): Promise<void> {
    try {
      apply(await fn())
      this.clearRunnerFailure(command)
    } catch {
      this.noteRunnerFailure(command)
    }
  }

  private clearRunnerFailure(command: string): void {
    if (!this.runnerFailures.includes(command)) return
    this.runnerFailures = this.runnerFailures.filter((c) => c !== command)
    this.recomputeWarnings()
  }

  private applyDistroList(list: DistroSummary[]): void {
    this.distros = list
    if (this.selected) {
      const cur = list.find((d) => d.name === this.selected)
      if (cur) {
        if (this.sections) {
          this.sections.distro = {
            ...this.sections.distro,
            state: cur.state,
            wslVersion: cur.wslVersion,
            isDefault: cur.isDefault
          }
        }
        return
      }
    }
    const next = list.find((d) => d.isDefault) ?? list[0]
    if (next) {
      this.selectInternal(next)
    } else {
      this.selected = null
      this.sections = null
    }
  }

  private selectInternal(summary: DistroSummary): void {
    this.selected = summary.name
    this.sections = sectionsFor(summary)
    this.runnerFailures = []
    // Liveness is a property of one distro: a new selection starts clean.
    this.probe = freshProbe()
  }

  private runningSelected(): string | null {
    if (!this.selected) return null
    const d = this.distros.find((x) => x.name === this.selected)
    return d?.state === 'Running' ? this.selected : null
  }

  private recomputeWarnings(): void {
    const warnings = computeWarnings({
      distros: this.distros,
      selectedDistro: this.selected,
      dashboard: this.sections ? { ...this.sections, warnings: [] } : null,
      runnerFailures: this.runnerFailures,
      mcpError: this.mcp.error
    })
    // Liveness is store state, not a fact any collector reported, so it is
    // appended here instead of inside the pure warning rules.
    const distro = this.selected
    if (distro !== null && this.probe.failures > 0) {
      warnings.push({
        id: 'distro-unresponsive',
        severity: 'warning',
        messageKey: 'warnings.distroUnresponsive',
        params: { distro },
        message: `Distribution ${distro} is not answering; live data is paused until it replies`
      })
    }
    this.warnings = warnings
  }

  private build(): WslPadSnapshot {
    const dashboard: DashboardSnapshot | null = this.sections
      ? { ...this.sections, warnings: this.warnings }
      : null
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      selectedDistro: this.selected,
      distros: this.distros,
      dashboard,
      explorer: this.explorer,
      terminal: this.terminal,
      mcp: this.mcp,
      warnings: this.warnings
    }
  }

  private commit(): void {
    this.current = this.build()
  }

  private emit(): void {
    this.commit()
    if (this.disposed) return
    for (const cb of this.subscribers) {
      try {
        cb(this.current)
      } catch {
        // subscriber errors must never break state collection
      }
    }
  }
}
