import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type WslPadApi } from '@shared/ipc'
import type {
  FileOpProgress,
  McpStatus,
  Settings,
  TerminalDataEvent,
  TerminalStatusEvent,
  UpdateStatus,
  WslPadSnapshot
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: WslPadApi = {
  listDistros: () => ipcRenderer.invoke(IpcChannels.distrosList),
  selectDistro: (name) => ipcRenderer.invoke(IpcChannels.distroSelect, name),
  getSnapshot: () => ipcRenderer.invoke(IpcChannels.snapshotGet),
  refresh: (tier) => ipcRenderer.invoke(IpcChannels.snapshotRefresh, tier),
  setMonitoringPaused: (paused) => ipcRenderer.invoke(IpcChannels.monitoringSetPaused, paused),
  revealEnv: (name) => ipcRenderer.invoke(IpcChannels.envReveal, name),
  copyLlmMarkdown: (preset) => ipcRenderer.invoke(IpcChannels.llmCopyMarkdown, preset),
  exportLlmJson: () => ipcRenderer.invoke(IpcChannels.llmExportJson),

  explorer: {
    list: (path, opts) => ipcRenderer.invoke(IpcChannels.explorerList, path, opts),
    tree: (path) => ipcRenderer.invoke(IpcChannels.explorerTree, path),
    stat: (path) => ipcRenderer.invoke(IpcChannels.explorerStat, path),
    mkdir: (path) => ipcRenderer.invoke(IpcChannels.explorerMkdir, path),
    createFile: (path) => ipcRenderer.invoke(IpcChannels.explorerCreateFile, path),
    rename: (path, newName) => ipcRenderer.invoke(IpcChannels.explorerRename, path, newName),
    copy: (sources, destDir, move) => ipcRenderer.invoke(IpcChannels.explorerCopy, sources, destDir, move),
    trash: (paths) => ipcRenderer.invoke(IpcChannels.explorerTrash, paths),
    listTrash: () => ipcRenderer.invoke(IpcChannels.explorerTrashList),
    restoreTrash: (trashNames) => ipcRenderer.invoke(IpcChannels.explorerTrashRestore, trashNames),
    remove: (paths) => ipcRenderer.invoke(IpcChannels.explorerDelete, paths),
    readText: (path) => ipcRenderer.invoke(IpcChannels.explorerReadText, path),
    writeText: (path, content) => ipcRenderer.invoke(IpcChannels.explorerWriteText, path, content),
    importFromWindows: (windowsPaths, destDir) =>
      ipcRenderer.invoke(IpcChannels.explorerImport, windowsPaths, destDir),
    exportToWindows: (paths, windowsDir) =>
      ipcRenderer.invoke(IpcChannels.explorerExport, paths, windowsDir),
    cancelOp: (opId) => ipcRenderer.invoke(IpcChannels.explorerCancelOp, opId),
    dirSizes: (path, token) => ipcRenderer.invoke(IpcChannels.explorerDirSizes, path, token),
    search: (path, query) => ipcRenderer.invoke(IpcChannels.explorerSearch, path, query),
    pickImportPaths: () => ipcRenderer.invoke(IpcChannels.explorerPickImport),
    pickExportDir: () => ipcRenderer.invoke(IpcChannels.explorerPickExport),
    startDrag: (paths) => ipcRenderer.invoke(IpcChannels.explorerStartDrag, paths)
  },

  windows: {
    places: () => ipcRenderer.invoke(IpcChannels.windowsPlaces),
    home: () => ipcRenderer.invoke(IpcChannels.windowsHome),
    list: (path, opts) => ipcRenderer.invoke(IpcChannels.windowsList, path, opts),
    tree: (path) => ipcRenderer.invoke(IpcChannels.windowsTree, path),
    stat: (path) => ipcRenderer.invoke(IpcChannels.windowsStat, path),
    mkdir: (path) => ipcRenderer.invoke(IpcChannels.windowsMkdir, path),
    createFile: (path) => ipcRenderer.invoke(IpcChannels.windowsCreateFile, path),
    rename: (path, newName) => ipcRenderer.invoke(IpcChannels.windowsRename, path, newName),
    copy: (sources, destDir, move) =>
      ipcRenderer.invoke(IpcChannels.windowsCopy, sources, destDir, move),
    trash: (paths) => ipcRenderer.invoke(IpcChannels.windowsTrash, paths),
    remove: (paths) => ipcRenderer.invoke(IpcChannels.windowsDelete, paths),
    readText: (path) => ipcRenderer.invoke(IpcChannels.windowsReadText, path),
    writeText: (path, content) => ipcRenderer.invoke(IpcChannels.windowsWriteText, path, content),
    search: (path, query) => ipcRenderer.invoke(IpcChannels.windowsSearch, path, query),
    openPath: (path) => ipcRenderer.invoke(IpcChannels.windowsOpenPath, path),
    startDrag: (paths) => ipcRenderer.invoke(IpcChannels.windowsStartDrag, paths)
  },

  convertPath: (input, to) => ipcRenderer.invoke(IpcChannels.pathConvert, input, to),
  openInWindowsExplorer: (linuxPath) => ipcRenderer.invoke(IpcChannels.openInWindowsExplorer, linuxPath),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  copyToClipboard: (text) => ipcRenderer.invoke(IpcChannels.clipboardWrite, text),
  readClipboard: () => ipcRenderer.invoke(IpcChannels.clipboardRead),

  terminal: {
    ensure: (distro) => ipcRenderer.invoke(IpcChannels.terminalEnsure, distro),
    input: (sessionId, data) => ipcRenderer.invoke(IpcChannels.terminalInput, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke(IpcChannels.terminalResize, sessionId, cols, rows),
    setCwd: (sessionId, path) => ipcRenderer.invoke(IpcChannels.terminalSetCwd, sessionId, path),
    getState: (sessionId) => ipcRenderer.invoke(IpcChannels.terminalGetState, sessionId),
    onData: (cb) => subscribe<TerminalDataEvent>(IpcChannels.evTerminalData, cb),
    onStatus: (cb) => subscribe<TerminalStatusEvent>(IpcChannels.evTerminalStatus, cb)
  },

  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (patch) => ipcRenderer.invoke(IpcChannels.settingsSet, patch),
    reset: () => ipcRenderer.invoke(IpcChannels.settingsReset),
    getLoadError: () => ipcRenderer.invoke(IpcChannels.settingsLoadError),
    onChange: (cb) => subscribe<Settings>(IpcChannels.evSettings, cb)
  },

  mcp: {
    status: () => ipcRenderer.invoke(IpcChannels.mcpStatus),
    regenerateToken: () => ipcRenderer.invoke(IpcChannels.mcpRegenerateToken),
    registerClient: (kind) => ipcRenderer.invoke(IpcChannels.mcpRegisterClient, kind),
    test: () => ipcRenderer.invoke(IpcChannels.mcpTest),
    getConfigJson: () => ipcRenderer.invoke(IpcChannels.mcpConfigJson),
    onStatus: (cb) => subscribe<McpStatus>(IpcChannels.evMcp, cb)
  },

  updates: {
    check: () => ipcRenderer.invoke(IpcChannels.updateCheck),
    install: () => ipcRenderer.invoke(IpcChannels.updateInstall),
    getStatus: () => ipcRenderer.invoke(IpcChannels.updateStatusGet),
    onStatus: (cb) => subscribe<UpdateStatus>(IpcChannels.evUpdate, cb)
  },

  app: {
    version: () => ipcRenderer.invoke(IpcChannels.appVersion),
    quit: () => ipcRenderer.invoke(IpcChannels.appQuit)
  },

  onSnapshot: (cb) => subscribe<WslPadSnapshot>(IpcChannels.evSnapshot, cb),
  onOpProgress: (cb) => subscribe<FileOpProgress>(IpcChannels.evOpProgress, cb),
  onNavigateSettings: (cb) => subscribe<void>(IpcChannels.evNavigateSettings, () => cb())
}

contextBridge.exposeInMainWorld('wslpad', api)
