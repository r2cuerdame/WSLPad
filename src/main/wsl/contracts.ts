import type {
  ConfigurationFileInfo,
  DistroDetails,
  DistroSummary,
  EnvironmentVariableInfo,
  FileEntry,
  FileStat,
  HermesInfo,
  ImportantPathInfo,
  ProcessInfo,
  PortInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  TextFileContent,
  ToolInfo
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
  getDistroDetails(distro: string): Promise<DistroDetails>
  getSystemInfo(distro: string): Promise<SystemInfo>
  getResources(distro: string): Promise<ResourceInfo>
  getProcesses(distro: string): Promise<ProcessInfo[]>
  getServices(distro: string, systemdEnabled: boolean | null): Promise<ServiceInfo[]>
  getPorts(distro: string): Promise<PortInfo[]>
  getEnvironment(distro: string): Promise<EnvironmentVariableInfo[]>
  /** Raw value for explicit GUI reveal — never crosses MCP (goal.md §6.7). */
  revealEnv(distro: string, name: string): Promise<string | null>
  getImportantPaths(distro: string): Promise<ImportantPathInfo[]>
  getConfigFiles(distro: string): Promise<ConfigurationFileInfo[]>
  getTools(distro: string): Promise<ToolInfo[]>
  getHermes(distro: string): Promise<HermesInfo | null>
}

// ---------------------------------------------------------------------------
// Explorer backend (goal.md §7) — real impl over the runner, fixture in-memory.
// ---------------------------------------------------------------------------

export interface ExplorerListOpts {
  showHidden?: boolean
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
  search(distro: string, path: string, query: string): Promise<FileEntry[]>
  convertPath(distro: string, input: string, to: 'windows' | 'linux'): Promise<string>
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
}

export interface ConsoleBackendFactory {
  /** Spawn an interactive shell for the distro with WSLPad rc injection. */
  spawn(distro: string, cols: number, rows: number): Promise<PtyHandle>
  /** Write the pending-cwd sync file consumed by the injected PROMPT_COMMAND. */
  writeCwdSyncFile(distro: string, sessionId: string, path: string): Promise<void>
  /** Shell kind detected for the distro user (sync support: bash/zsh only). */
  shellKind(distro: string): Promise<'bash' | 'zsh' | 'other'>
}
