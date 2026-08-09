import type {
  ConsoleStatus,
  DirSizeResult,
  DistroSummary,
  FileEntry,
  FileOpProgress,
  FileStat,
  McpClientKind,
  McpRegisterResult,
  McpStatus,
  DiagnosticsState,
  NetworkCheckResult,
  Settings,
  SettingsPatch,
  TerminalDataEvent,
  TerminalSessionInfo,
  TerminalStatusEvent,
  ServiceLog,
  ServiceScope,
  TextFileContent,
  TrashEntry,
  UpdateStatus,
  WindowsPlace,
  WslPadSnapshot
} from './types'

/**
 * Every IPC channel WSLPad uses. The preload bridge and the main-process
 * registrar both import this map — nothing else may register channels
 * (explicit allowlist, goal.md §16).
 */
export const IpcChannels = {
  // distro / snapshot
  distrosList: 'wslpad:distros:list',
  distroSelect: 'wslpad:distros:select',
  snapshotGet: 'wslpad:snapshot:get',
  snapshotRefresh: 'wslpad:snapshot:refresh',
  monitoringSetPaused: 'wslpad:monitoring:set-paused',
  envReveal: 'wslpad:env:reveal',
  serviceLog: 'wslpad:service:log',
  llmCopyMarkdown: 'wslpad:llm:copy-markdown',
  llmExportJson: 'wslpad:llm:export-json',
  diagnosticsGet: 'wslpad:diagnostics:get',
  diagnosticsNetworkCheck: 'wslpad:diagnostics:network-check',
  diagnosticsExport: 'wslpad:diagnostics:export',

  // explorer
  explorerList: 'wslpad:explorer:list',
  explorerTree: 'wslpad:explorer:tree',
  explorerStat: 'wslpad:explorer:stat',
  explorerMkdir: 'wslpad:explorer:mkdir',
  explorerCreateFile: 'wslpad:explorer:create-file',
  explorerRename: 'wslpad:explorer:rename',
  explorerCopy: 'wslpad:explorer:copy',
  explorerTrash: 'wslpad:explorer:trash',
  explorerTrashList: 'wslpad:explorer:trash-list',
  explorerTrashRestore: 'wslpad:explorer:trash-restore',
  explorerDelete: 'wslpad:explorer:delete',
  explorerReadText: 'wslpad:explorer:read-text',
  explorerWriteText: 'wslpad:explorer:write-text',
  explorerImport: 'wslpad:explorer:import',
  explorerExport: 'wslpad:explorer:export',
  explorerCancelOp: 'wslpad:explorer:cancel-op',
  explorerDirSizes: 'wslpad:explorer:dir-sizes',
  explorerSearch: 'wslpad:explorer:search',
  explorerPickImport: 'wslpad:explorer:pick-import',
  explorerPickExport: 'wslpad:explorer:pick-export',
  explorerStartDrag: 'wslpad:explorer:start-drag',

  // windows filesystem (left Explorer pane)
  windowsPlaces: 'wslpad:windows:places',
  windowsHome: 'wslpad:windows:home',
  windowsList: 'wslpad:windows:list',
  windowsTree: 'wslpad:windows:tree',
  windowsStat: 'wslpad:windows:stat',
  windowsMkdir: 'wslpad:windows:mkdir',
  windowsCreateFile: 'wslpad:windows:create-file',
  windowsRename: 'wslpad:windows:rename',
  windowsCopy: 'wslpad:windows:copy',
  windowsTrash: 'wslpad:windows:trash',
  windowsDelete: 'wslpad:windows:delete',
  windowsReadText: 'wslpad:windows:read-text',
  windowsWriteText: 'wslpad:windows:write-text',
  windowsSearch: 'wslpad:windows:search',
  windowsOpenPath: 'wslpad:windows:open-path',
  windowsStartDrag: 'wslpad:windows:start-drag',

  // paths / shell
  pathConvert: 'wslpad:path:convert',
  openInWindowsExplorer: 'wslpad:shell:open-in-windows',
  openExternal: 'wslpad:shell:open-external',
  clipboardWrite: 'wslpad:clipboard:write',
  clipboardRead: 'wslpad:clipboard:read',

  // terminal
  terminalEnsure: 'wslpad:terminal:ensure',
  terminalInput: 'wslpad:terminal:input',
  terminalResize: 'wslpad:terminal:resize',
  terminalSetCwd: 'wslpad:terminal:set-cwd',
  terminalGetState: 'wslpad:terminal:get-state',

  // settings
  settingsGet: 'wslpad:settings:get',
  settingsSet: 'wslpad:settings:set',
  settingsReset: 'wslpad:settings:reset',
  settingsLoadError: 'wslpad:settings:load-error',

  // mcp
  mcpStatus: 'wslpad:mcp:status',
  mcpRegenerateToken: 'wslpad:mcp:regenerate-token',
  mcpRegisterClient: 'wslpad:mcp:register-client',
  mcpTest: 'wslpad:mcp:test',
  mcpConfigJson: 'wslpad:mcp:config-json',

  // updates / app
  updateCheck: 'wslpad:update:check',
  updateInstall: 'wslpad:update:install',
  updateStatusGet: 'wslpad:update:status',
  appVersion: 'wslpad:app:version',
  appQuit: 'wslpad:app:quit',

  // events (main → renderer)
  evSnapshot: 'wslpad:ev:snapshot',
  evTerminalData: 'wslpad:ev:terminal-data',
  evTerminalStatus: 'wslpad:ev:terminal-status',
  evOpProgress: 'wslpad:ev:op-progress',
  evSettings: 'wslpad:ev:settings',
  evUpdate: 'wslpad:ev:update',
  evMcp: 'wslpad:ev:mcp',
  evDiagnostics: 'wslpad:ev:diagnostics',
  evNavigateSettings: 'wslpad:ev:navigate-settings'
} as const

export type IpcChannelKey = keyof typeof IpcChannels
export type IpcChannelName = (typeof IpcChannels)[IpcChannelKey]

export interface ExplorerListOptions {
  showHidden?: boolean
}

/**
 * Which Copy-for-LLM document to produce. 'default' is the full environment
 * summary; 'bug-report' answers microsoft/WSL's issue form field by field and
 * 'agent-context' is the compact block that goes in CLAUDE.md / AGENTS.md.
 */
export type LlmPreset = 'default' | 'bug-report' | 'agent-context'

export interface SettingsLoadError {
  corrupted: boolean
  message: string | null
}

/**
 * The API exposed on `window.wslpad` by the preload script.
 * All methods proxy to typed, allowlisted ipcRenderer.invoke calls.
 */
export interface WslPadApi {
  listDistros(): Promise<DistroSummary[]>
  selectDistro(name: string): Promise<void>
  getSnapshot(): Promise<WslPadSnapshot>
  refresh(tier: 'fast' | 'medium' | 'slow' | 'all'): Promise<void>
  setMonitoringPaused(paused: boolean): Promise<void>
  revealEnv(name: string): Promise<string | null>
  /** The tail of one unit journal, read on demand and never polled. */
  serviceLog(unit: string, scope: ServiceScope, lines?: number): Promise<ServiceLog>
  copyLlmMarkdown(preset?: LlmPreset): Promise<string>
  exportLlmJson(): Promise<string | null>

  diagnostics: {
    get(): Promise<DiagnosticsState>
    /** Port is optional; when present Windows localhost is tested too. */
    runNetworkCheck(port?: number): Promise<NetworkCheckResult>
    /** Privacy-previewed JSON bundle containing the masked snapshot and session diagnostics. */
    exportBundle(): Promise<string | null>
    onChange(cb: (state: DiagnosticsState) => void): () => void
  }

  explorer: {
    list(path: string, opts?: ExplorerListOptions): Promise<FileEntry[]>
    tree(path: string): Promise<FileEntry[]>
    stat(path: string): Promise<FileStat>
    mkdir(path: string): Promise<void>
    createFile(path: string): Promise<void>
    rename(path: string, newName: string): Promise<void>
    /** copy or move sources into destDir; returns opId */
    copy(sources: string[], destDir: string, move: boolean): Promise<string>
    trash(paths: string[]): Promise<void>
    /** What is in the distro trash right now, newest first (issue #23). */
    listTrash(): Promise<TrashEntry[]>
    /** Put entries back; never overwrites what is already at the destination. */
    restoreTrash(trashNames: string[]): Promise<void>
    remove(paths: string[]): Promise<void>
    readText(path: string): Promise<TextFileContent>
    writeText(path: string, content: string): Promise<void>
    /** returns opId */
    importFromWindows(windowsPaths: string[], destDir: string): Promise<string>
    /** returns opId */
    exportToWindows(paths: string[], windowsDir: string): Promise<string>
    cancelOp(opId: string): Promise<void>
    /**
     * Sizes of the current directory's immediate children (issue #31). The
     * token is a caller-generated op id: pass it to cancelOp() to stop a run
     * that is taking seconds on a large tree.
     */
    dirSizes(path: string, token: string): Promise<DirSizeResult>
    search(path: string, query: string): Promise<FileEntry[]>
    pickImportPaths(): Promise<string[]>
    pickExportDir(): Promise<string | null>
    startDrag(paths: string[]): Promise<void>
  }

  /**
   * Windows-side filesystem for the left Explorer pane. Mirrors `explorer`
   * so both panes can share one UI component; `list(WINDOWS_ROOT)` returns the
   * drives instead of a directory listing.
   */
  windows: {
    places(): Promise<WindowsPlace[]>
    home(): Promise<string>
    list(path: string, opts?: ExplorerListOptions): Promise<FileEntry[]>
    tree(path: string): Promise<FileEntry[]>
    stat(path: string): Promise<FileStat>
    mkdir(path: string): Promise<void>
    createFile(path: string): Promise<void>
    rename(path: string, newName: string): Promise<void>
    /** copy or move within Windows; returns opId */
    copy(sources: string[], destDir: string, move: boolean): Promise<string>
    trash(paths: string[]): Promise<void>
    remove(paths: string[]): Promise<void>
    readText(path: string): Promise<TextFileContent>
    writeText(path: string, content: string): Promise<void>
    search(path: string, query: string): Promise<FileEntry[]>
    /** Reveal in Windows Explorer (directories open, files are selected). */
    openPath(path: string): Promise<void>
    startDrag(paths: string[]): Promise<void>
  }

  convertPath(input: string, to: 'windows' | 'linux'): Promise<string>
  openInWindowsExplorer(linuxPath: string): Promise<void>
  openExternal(url: string): Promise<void>
  copyToClipboard(text: string): Promise<void>
  /** Console right-click paste reads the clipboard on explicit user action. */
  readClipboard(): Promise<string>

  terminal: {
    ensure(distro: string): Promise<TerminalSessionInfo>
    input(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    setCwd(sessionId: string, path: string): Promise<void>
    getState(sessionId: string): Promise<{ status: ConsoleStatus; cwd: string | null }>
    onData(cb: (ev: TerminalDataEvent) => void): () => void
    onStatus(cb: (ev: TerminalStatusEvent) => void): () => void
  }

  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
    reset(): Promise<Settings>
    getLoadError(): Promise<SettingsLoadError>
    onChange(cb: (s: Settings) => void): () => void
  }

  mcp: {
    status(): Promise<McpStatus>
    regenerateToken(): Promise<McpStatus>
    registerClient(kind: McpClientKind): Promise<McpRegisterResult>
    test(): Promise<{ ok: boolean; error: string | null }>
    getConfigJson(): Promise<string>
    onStatus(cb: (s: McpStatus) => void): () => void
  }

  updates: {
    check(): Promise<UpdateStatus>
    install(): Promise<void>
    getStatus(): Promise<UpdateStatus>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }

  app: {
    version(): Promise<string>
    quit(): Promise<void>
  }

  onSnapshot(cb: (s: WslPadSnapshot) => void): () => void
  onOpProgress(cb: (p: FileOpProgress) => void): () => void
  onNavigateSettings(cb: () => void): () => void
}
