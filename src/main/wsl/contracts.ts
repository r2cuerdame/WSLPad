import type {
  ClockInfo,
  ConfigurationFileInfo,
  DirSizeResult,
  DiskImageInfo,
  DistroDetails,
  DistroSummary,
  DnsInfo,
  DockerInfo,
  EnvironmentVariableInfo,
  FileEntry,
  FileStat,
  FirewallInfo,
  PortProxyInfo,
  HermesInfo,
  ImportantPathInfo,
  MemoryReconciliation,
  ProcessInfo,
  PortInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  TextFileContent,
  ToolInfo,
  WindowsPortInfo,
  WslConfigInfo
} from '@shared/types'

// ---------------------------------------------------------------------------
// Hidden Runner (goal.md §9)
// ---------------------------------------------------------------------------

export interface RunOptions {
  timeoutMs?: number
  maxOutputBytes?: number
  /** 'utf16le' for wsl.exe management output, 'utf8' for in-distro output */
  encoding?: 'utf8' | 'utf16le' | 'auto'
  stdin?: Buffer | string
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

/** Thrown when wsl.exe itself is missing (WSL not installed). */
export class WslNotAvailableError extends Error {
  constructor() {
    super('wsl.exe is not available on this system')
    this.name = 'WslNotAvailableError'
  }
}

/** Re-exported so existing collectors keep one import site for the classifier. */
export { classifyPathSide } from '@shared/path-boundary'

export interface DistroRunner {
  /** Run `wsl.exe <args>` (management commands; UTF-16LE output). */
  runWsl(args: string[], opts?: RunOptions): Promise<RunResult>
  /** Run a POSIX sh script inside a distro via `wsl.exe -d <d> --exec /bin/sh -c <script>`. */
  runInDistro(distro: string, script: string, opts?: RunOptions): Promise<RunResult>
  /** Kill every child process this runner still tracks. */
  disposeAll(): Promise<void>
}

// ---------------------------------------------------------------------------
// Dashboard data provider — real impl backed by collectors, fixture impl for
// WSLPAD_FIXTURE_MODE=1 (goal.md §18.4). The snapshot store only sees this.
// ---------------------------------------------------------------------------

export interface WslProvider {
  isAvailable(): Promise<boolean>
  listDistros(): Promise<DistroSummary[]>
  /**
   * Cheap liveness check: one trivial command with a short timeout (issue #37).
   * A wedged distro answers nothing, and without this gate every collector in
   * every tier would sit on its own timeout each poll. Resolves false — never
   * throws — when the distro did not answer in time. Optional: a provider
   * without it is simply never gated, which is the pre-0.1.3 behaviour.
   */
  probeDistro?(distro: string): Promise<boolean>
  getDistroDetails(distro: string): Promise<DistroDetails>
  getSystemInfo(distro: string): Promise<SystemInfo>
  getResources(distro: string): Promise<ResourceInfo>
  getProcesses(distro: string): Promise<ProcessInfo[]>
  getServices(distro: string, systemdEnabled: boolean | null): Promise<ServiceInfo[]>
  getPorts(distro: string): Promise<PortInfo[]>
  /**
   * Listeners on the Windows host — a host query, not a distro one, so it takes
   * no distro name. Optional: a provider with no view of the Windows side
   * simply omits it and every port stays windowsBound = null (unknown).
   */
  getWindowsPorts?(): Promise<WindowsPortInfo[]>
  /**
   * The three sections below are optional so a provider that cannot see the
   * Windows side of a distro — or a test fake — simply leaves them out and the
   * matching snapshot section stays null (unknown) instead of wrong.
   */
  getDiskImage?(distro: string): Promise<DiskImageInfo>
  getWslSettings?(distro: string): Promise<WslConfigInfo>
  getMemoryDetail?(distro: string): Promise<MemoryReconciliation>
  /**
   * Windows Defender Firewall — a host query like getWindowsPorts, so it takes
   * no distro name. Optional for the same reason as the three above: a missing
   * method leaves the section null (unknown) instead of implying "all open".
   */
  getFirewall?(): Promise<FirewallInfo>
  /**
   * Windows port-forwarding rules judged against the address the distro has
   * right now. Optional for the same reason: a missing method leaves the
   * section null rather than implying there are no rules.
   */
  getPortProxy?(distroIp: string | null): Promise<PortProxyInfo>
  /** Windows vs distro wall clock; needs the distro to answer, so it is gated. */
  getClock?(distro: string): Promise<ClockInfo>
  /** Resolver configuration on both sides of the boundary. */
  getDns?(distro: string): Promise<DnsInfo>
  getEnvironment(distro: string): Promise<EnvironmentVariableInfo[]>
  /** Raw value for explicit GUI reveal — never crosses MCP (goal.md §6.7). */
  revealEnv(distro: string, name: string): Promise<string | null>
  getImportantPaths(distro: string): Promise<ImportantPathInfo[]>
  getConfigFiles(distro: string): Promise<ConfigurationFileInfo[]>
  getTools(distro: string): Promise<ToolInfo[]>
  getHermes(distro: string): Promise<HermesInfo | null>
  /**
   * Docker as this distribution sees it. Optional so a provider without it
   * leaves the section null (unknown) rather than implying Docker is absent.
   */
  getDocker?(distro: string): Promise<DockerInfo | null>
}

// ---------------------------------------------------------------------------
// Explorer backend (goal.md §7) — real impl over the runner, fixture in-memory.
// ---------------------------------------------------------------------------

export interface ExplorerListOpts {
  showHidden?: boolean
}

export type ExplorerErrorCode =
  | 'EACCES'
  | 'ENOENT'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BINARY'
  | 'CANCELLED'
  | 'UNKNOWN'

/** Structured explorer failure surfaced to the renderer (goal.md §14). */
export class ExplorerError extends Error {
  constructor(
    public code: ExplorerErrorCode,
    public path: string,
    message: string,
    public detail: {
      stderr?: string
      owner?: string | null
      permissions?: string | null
      user?: string | null
    } = {}
  ) {
    super(message)
    this.name = 'ExplorerError'
  }

  /** Serializable shape for IPC transport. */
  toPayload(): Record<string, unknown> {
    return {
      explorerError: true,
      code: this.code,
      path: this.path,
      message: this.message,
      detail: this.detail
    }
  }
}

export interface ExplorerBackend {
  homeDir(distro: string): Promise<string>
  list(distro: string, path: string, opts?: ExplorerListOpts): Promise<FileEntry[]>
  /** Immediate subdirectories only (lazy folder tree). */
  tree(distro: string, path: string): Promise<FileEntry[]>
  stat(distro: string, path: string): Promise<FileStat>
  mkdir(distro: string, path: string): Promise<void>
  createFile(distro: string, path: string): Promise<void>
  rename(distro: string, path: string, newName: string): Promise<void>
  /** Returns opId; progress via onProgress callback registered by caller. */
  copyMove(distro: string, sources: string[], destDir: string, move: boolean): Promise<string>
  trash(distro: string, paths: string[]): Promise<void>
  remove(distro: string, paths: string[]): Promise<void>
  readText(distro: string, path: string, maxBytes: number): Promise<TextFileContent>
  writeText(distro: string, path: string, content: string): Promise<void>
  importFromWindows(distro: string, windowsPaths: string[], destDir: string): Promise<string>
  exportToWindows(distro: string, paths: string[], windowsDir: string): Promise<string>
  cancelOp(opId: string): Promise<void>
  /**
   * Sizes of one directory's immediate children (issue #31). The token is an
   * ordinary op id, so cancelOp() stops it like any other long operation.
   */
  dirSizes(distro: string, path: string, token: string): Promise<DirSizeResult>
  search(distro: string, path: string, query: string): Promise<FileEntry[]>
  convertPath(distro: string, input: string, to: 'windows' | 'linux'): Promise<string>
  /** Subscribe to progress for copyMove/import/export ops. Returns unsubscribe. */
  onProgress(cb: (p: import('@shared/types').FileOpProgress) => void): () => void
}

// ---------------------------------------------------------------------------
// Console backend (goal.md §8) — real node-pty wsl.exe session, fixture fake
// shell that emits the same OSC 133/7 markers.
// ---------------------------------------------------------------------------

export interface PtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
  /**
   * Whether this shell emits the WSLPad OSC markers. A shell launched without
   * the rc — an unsupported login shell, or a distro too busy to install it —
   * never reports a prompt, so readiness must not be inferred from markers
   * that will not arrive. Undefined means "yes", the normal case.
   */
  supportsMarkers?: boolean
}

export interface ConsoleBackendFactory {
  /** Spawn an interactive shell for the distro with WSLPad rc injection. */
  spawn(distro: string, cols: number, rows: number): Promise<PtyHandle>
  /** Write the pending-cwd sync file consumed by the injected PROMPT_COMMAND. */
  writeCwdSyncFile(distro: string, sessionId: string, path: string): Promise<void>
  /** Shell kind detected for the distro user (sync support: bash/zsh only). */
  shellKind(distro: string): Promise<'bash' | 'zsh' | 'other'>
}
