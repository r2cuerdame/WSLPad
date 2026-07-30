import { MCP_DEFAULT_PORT, SNAPSHOT_SCHEMA_VERSION } from '@shared/constants'
import type {
  ConfigurationFileInfo,
  DashboardSnapshot,
  DiskImageInfo,
  DistroDetails,
  DistroSummary,
  EnvironmentVariableInfo,
  ExplorerContext,
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
  environment: EnvironmentVariableInfo[]
  processes: ProcessInfo[]
  services: ServiceInfo[]
  ports: PortInfo[]
  windowsPorts: WindowsPortInfo[]
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
    environment: [],
    processes: [],
    services: [],
    ports: [],
    windowsPorts: []
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
 * keeps updating from the list tier.
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
          this.collectWindowsPorts()
        ])
        const correlated = correlatePorts(s.ports, this.windowsPortTable)
        s.ports = correlated.ports
        s.windowsPorts = correlated.windowsPorts
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
          )
        ])
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
      if (distro && s) {
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
          this.collectWslSettings(distro, s)
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
  }

  private runningSelected(): string | null {
    if (!this.selected) return null
    const d = this.distros.find((x) => x.name === this.selected)
    return d?.state === 'Running' ? this.selected : null
  }

  private recomputeWarnings(): void {
    this.warnings = computeWarnings({
      distros: this.distros,
      selectedDistro: this.selected,
      dashboard: this.sections ? { ...this.sections, warnings: [] } : null,
      runnerFailures: this.runnerFailures,
      mcpError: this.mcp.error
    })
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
