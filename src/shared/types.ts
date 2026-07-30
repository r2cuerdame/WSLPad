/**
 * WSLPad shared domain model.
 * Single source of truth consumed by main, preload, renderer, MCP and tests.
 * Everything here must remain JSON-serializable (goal.md §10).
 */

export type DistroState = 'Running' | 'Stopped' | 'Installing' | 'Unknown'

export interface DistroSummary {
  name: string
  state: DistroState
  wslVersion: 1 | 2
  isDefault: boolean
}

export interface DistroDetails extends DistroSummary {
  /** e.g. "Ubuntu 24.04.2 LTS" from /etc/os-release PRETTY_NAME */
  osName: string | null
  /** \\wsl.localhost\<name> */
  uncPath: string
}

export interface SystemInfo {
  kernel: string | null
  hostname: string | null
  user: string | null
  home: string | null
  shell: string | null
  uptimeSeconds: number | null
  systemdEnabled: boolean | null
  ip: string | null
  /** Linux view of the Windows user profile, e.g. /mnt/c/Users/recue */
  windowsUserProfileLinux: string | null
}

export interface DiskUsage {
  mountPoint: string
  exists: boolean
  totalBytes: number | null
  usedBytes: number | null
  availableBytes: number | null
  usePercent: number | null
}

export interface ResourceInfo {
  cpuPercent: number | null
  cpuCount: number | null
  memTotalBytes: number | null
  memUsedBytes: number | null
  memAvailableBytes: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
  disks: DiskUsage[]
  loadAvg: [number, number, number] | null
  processCount: number | null
}

export interface ImportantPathInfo {
  id: string
  /** untranslated path label such as "HOME" or "~/.hermes" */
  label: string
  linuxPath: string
  windowsPath: string | null
  exists: boolean | null
  isDirectory: boolean | null
}

export interface ConfigurationFileInfo {
  id: string
  label: string
  scope: 'windows' | 'linux'
  linuxPath: string | null
  windowsPath: string | null
  exists: boolean | null
  readable: boolean | null
  writable: boolean | null
}

export type ToolId =
  | 'hermes'
  | 'codex'
  | 'claude'
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'python'
  | 'pip'
  | 'uv'
  | 'git'
  | 'docker'
  | 'docker-compose'
  | 'bun'
  | 'ripgrep'
  | 'ffmpeg'
  | 'playwright'
  | 'chromium'

export interface ToolInfo {
  id: ToolId | string
  displayName: string
  installed: boolean
  executablePath: string | null
  version: string | null
  /** apt | snap | npm-global | nvm | pipx | uv | manual | unknown … */
  installMethod: string | null
  configPaths: string[]
  runningProcesses: number
  services: string[]
}

export interface HermesProcessInfo {
  pid: number
  command: string
}

export interface HermesInfo {
  installed: boolean
  executablePath: string | null
  dataDir: string | null
  venvPath: string | null
  configPath: string | null
  gatewayStatus: 'running' | 'not-detected'
  dashboardStatus: 'running' | 'not-detected'
  mcpServerCount: number | null
  processes: HermesProcessInfo[]
  ports: number[]
  services: string[]
  logPaths: string[]
}

export interface EnvironmentVariableInfo {
  name: string
  /** raw value for non-secrets, bullet mask for secrets — never the raw secret */
  maskedValue: string
  valueLength: number
  isSecret: boolean
  isPathLike: boolean
  /** heuristics: WSLENV / Windows-style content */
  fromWindows: boolean
}

export interface ProcessInfo {
  pid: number
  user: string
  cpuPercent: number
  memPercent: number
  elapsedSeconds: number
  command: string
  executablePath: string | null
}

export interface ServiceInfo {
  name: string
  scope: 'system' | 'user'
  loadState: string
  activeState: string
  subState: string
  enabled: string | null
  description: string
}

export type PortProtocol = 'tcp' | 'udp' | 'tcp6' | 'udp6'

export interface PortInfo {
  protocol: PortProtocol
  localAddress: string
  port: number
  pid: number | null
  processName: string | null
  listening: boolean
  /** clickable when it looks like an HTTP service, e.g. http://127.0.0.1:8080 */
  localhostUrl: string | null
  /**
   * Whether the same port is also bound on the Windows side — i.e. actually
   * reachable from Windows, whether through WSL2 localhost forwarding or a
   * native listener. null when the Windows port table could not be read.
   */
  windowsBound: boolean | null
  /** Windows process holding that port (often wslrelay/wslhost under NAT). */
  windowsProcess: string | null
}

/** A listener seen in the Windows TCP/UDP table (goal.md §6.10, extended). */
export interface WindowsPortInfo {
  protocol: PortProtocol
  localAddress: string
  port: number
  pid: number | null
  processName: string | null
  listening: boolean
  localhostUrl: string | null
  /** True when a WSL listener on the same port explains this entry. */
  fromWsl: boolean
}

export type WarningSeverity = 'info' | 'warning' | 'error'

export interface WarningInfo {
  id: string
  severity: WarningSeverity
  /** i18n key under warnings.* — renderer localizes */
  messageKey: string
  params?: Record<string, string | number>
  /** resolved English text so MCP/JSON consumers get a readable message */
  message: string
  detail?: string
}

export interface DashboardSnapshot {
  distro: DistroDetails
  system: SystemInfo
  resources: ResourceInfo
  paths: ImportantPathInfo[]
  configuration: ConfigurationFileInfo[]
  tools: ToolInfo[]
  hermes: HermesInfo | null
  environment: EnvironmentVariableInfo[]
  processes: ProcessInfo[]
  services: ServiceInfo[]
  ports: PortInfo[]
  /** Listeners on the Windows host, so both sides of a port are visible. */
  windowsPorts: WindowsPortInfo[]
  warnings: WarningInfo[]
}

export type FileEntryType = 'file' | 'directory' | 'symlink' | 'other'

export interface FileEntry {
  name: string
  path: string
  type: FileEntryType
  sizeBytes: number | null
  /** ISO 8601 */
  mtime: string | null
  owner: string | null
  group: string | null
  /** e.g. rwxr-xr-x */
  permissions: string | null
  permissionsOctal: string | null
  isHidden: boolean
  symlinkTarget: string | null
  /** resolved type of the symlink target when known */
  targetType: 'file' | 'directory' | null
}

export interface FileStat extends FileEntry {
  inode: number | null
  atime: string | null
  windowsPath: string | null
}

export interface ExplorerContext {
  distro: string | null
  currentPath: string | null
  showHidden: boolean
}

/** Which filesystem an Explorer pane is browsing (goal.md §7 dual pane). */
export type FsKind = 'windows' | 'linux'

/** Quick-access entry in the Windows pane: a drive or a known user folder. */
export interface WindowsPlace {
  id: string
  /** Drive letters and volume labels are shown verbatim, never translated. */
  label: string
  path: string
  kind: 'drive' | 'folder'
  totalBytes: number | null
  freeBytes: number | null
}

export type ConsoleStatus =
  | 'ready'
  | 'running'
  | 'waiting-input'
  | 'waiting-sudo'
  | 'path-sync-pending'
  | 'disconnected'
  | 'distro-stopped'

export interface TerminalContext {
  distro: string | null
  cwd: string | null
  status: ConsoleStatus
}

export interface McpStatus {
  running: boolean
  transport: 'http'
  endpoint: string | null
  port: number
  connectedClients: number
  lastRequestAt: string | null
  readOnly: true
  tokenSet: boolean
  error: string | null
}

export interface WslPadSnapshot {
  schemaVersion: 1
  generatedAt: string
  selectedDistro: string | null
  distros: DistroSummary[]
  dashboard: DashboardSnapshot | null
  explorer: ExplorerContext
  terminal: TerminalContext
  mcp: McpStatus
  warnings: WarningInfo[]
}

// ---------------------------------------------------------------------------
// Settings (goal.md §5.4)
// ---------------------------------------------------------------------------

export type ThemeSetting = 'system' | 'light' | 'dark'

export const SUPPORTED_LOCALES = [
  'ko',
  'en',
  'ja',
  'zh-CN',
  'zh-TW',
  'es',
  'fr',
  'de',
  'pt-BR'
] as const

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]

export interface MonitoringSettings {
  paused: boolean
  fastMs: number
  mediumMs: number
  slowMs: number
}

export interface ExplorerSettings {
  showHiddenByDefault: boolean
  startLocation: 'home' | 'last'
  lastPath: string | null
}

export interface ConsoleSettings {
  fontSize: number
  fontFamily: string
  scrollback: number
}

export interface McpSettings {
  enabled: boolean
  port: number
  token: string
}

export interface UpdateSettings {
  autoCheck: boolean
}

export interface Settings {
  schemaVersion: 1
  /** 'auto' = follow Windows UI language with English fallback */
  language: LocaleCode | 'auto'
  theme: ThemeSetting
  startWithWindows: boolean
  monitoring: MonitoringSettings
  explorer: ExplorerSettings
  console: ConsoleSettings
  mcp: McpSettings
  updates: UpdateSettings
}

/** Deep partial patch applied via settings:set */
export type SettingsPatch = {
  language?: LocaleCode | 'auto'
  theme?: ThemeSetting
  startWithWindows?: boolean
  monitoring?: Partial<MonitoringSettings>
  explorer?: Partial<ExplorerSettings>
  console?: Partial<ConsoleSettings>
  mcp?: Partial<Pick<McpSettings, 'enabled' | 'port'>>
  updates?: Partial<UpdateSettings>
}

// ---------------------------------------------------------------------------
// File operations / transfers
// ---------------------------------------------------------------------------

export type FileOpKind =
  | 'copy'
  | 'move'
  | 'trash'
  | 'delete'
  | 'import'
  | 'export'

export type FileOpStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface FileOpProgress {
  opId: string
  kind: FileOpKind
  status: FileOpStatus
  totalItems: number | null
  doneItems: number | null
  totalBytes: number | null
  doneBytes: number | null
  currentItem: string | null
  error: string | null
}

export interface TextFileContent {
  content: string
  encoding: 'utf-8' | 'latin1'
  truncated: boolean
  sizeBytes: number
  writable: boolean
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export type UpdateState =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  version: string | null
  percent: number | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface TerminalSessionInfo {
  sessionId: string
  distro: string
  status: ConsoleStatus
  cwd: string | null
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalStatusEvent {
  sessionId: string
  distro: string
  status: ConsoleStatus
  cwd: string | null
}

// ---------------------------------------------------------------------------
// MCP client registration
// ---------------------------------------------------------------------------

export type McpClientKind = 'claude-desktop' | 'codex' | 'hermes'

export interface McpRegisterResult {
  ok: boolean
  configPath: string | null
  error: string | null
}
