import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { IpcChannels } from '@shared/ipc'
import {
  distroNameSchema,
  fileNameSchema,
  linuxPathSchema,
  windowsPathSchema
} from '@shared/schemas'
import { MAX_EDITOR_FILE_BYTES, WINDOWS_ROOT } from '@shared/constants'
import type { McpClientKind, SettingsPatch } from '@shared/types'
import { ExplorerError, type DistroRunner, type ExplorerBackend, type WslProvider } from '../wsl/contracts'
import type { WindowsFs } from '../explorer/windows'
import type { SnapshotStore } from '../state/store'
import { snapshotToJson, snapshotToMarkdown } from '../state/llm-markdown'
import type { TerminalManager } from '../terminal/manager'
import type { SettingsStore } from '../settings/store'
import type { McpServerHost } from '../mcp/server'
import { buildMcpConfigJson, registerClient, testMcpConnection } from '../mcp/register-clients'
import type { AppUpdater } from '../updater'
import { resourcePath } from '../resources'

export interface IpcDeps {
  store: SnapshotStore
  provider: WslProvider
  explorer: ExplorerBackend
  windowsFs: WindowsFs
  terminals: TerminalManager
  settings: SettingsStore
  mcp: McpServerHost
  updater: AppUpdater
  runner: DistroRunner | null
  getWindow(): BrowserWindow | null
  applySettingsPatch(patch: SettingsPatch): Promise<void>
  getUpdateStatus(): import('@shared/types').UpdateStatus
  quit(): void
}

const tierSchema = z.enum(['fast', 'medium', 'slow', 'all'])
const boolSchema = z.boolean()
const stringSchema = z.string().min(1).max(65536)
const clientKindSchema = z.enum(['claude-desktop', 'codex', 'hermes'])
const llmPresetSchema = z.enum(['default', 'bug-report', 'agent-context'])
const listOptsSchema = z.object({ showHidden: z.boolean().optional() }).optional()
const pathsSchema = z.array(linuxPathSchema).min(1).max(1000)
const winPathsSchema = z.array(windowsPathSchema).min(1).max(1000)
/** The Windows pane also accepts the "This PC" sentinel wherever a dir is taken. */
const winRootOrPathSchema = z.union([z.literal(WINDOWS_ROOT), windowsPathSchema])
const sessionIdSchema = z.string().regex(/^term-[A-Za-z0-9._-]+$/)
/** Renderer-generated op id for a cancellable directory-size run. */
const opTokenSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/)

/** Wrap ExplorerError into a message the renderer can parse back (goal.md §14). */
function rethrow(err: unknown): never {
  if (err instanceof ExplorerError) {
    throw new Error(`WSLPAD_EXPLORER_ERROR:${JSON.stringify(err.toPayload())}`)
  }
  throw err instanceof Error ? err : new Error(String(err))
}

function selectedDistroOf(deps: IpcDeps): string {
  const distro = deps.store.get().selectedDistro
  if (!distro) throw new Error('No WSL distribution selected')
  return distro
}

/**
 * The complete, explicit IPC allowlist (goal.md §16). Every handler
 * re-validates its inputs at the boundary with zod.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args)
      } catch (err) {
        rethrow(err)
      }
    })
  }

  // --- distros / snapshot -------------------------------------------------
  handle(IpcChannels.distrosList, () => deps.provider.listDistros())
  handle(IpcChannels.distroSelect, (name) => deps.store.setDistro(distroNameSchema.parse(name)))
  handle(IpcChannels.snapshotGet, () => deps.store.get())
  handle(IpcChannels.snapshotRefresh, async (tier) => {
    const t = tierSchema.parse(tier ?? 'all')
    if (t === 'fast' || t === 'all') await deps.store.refreshFast()
    if (t === 'medium' || t === 'all') await deps.store.refreshMedium()
    if (t === 'slow' || t === 'all') await deps.store.refreshSlow()
  })
  handle(IpcChannels.monitoringSetPaused, (paused) =>
    deps.applySettingsPatch({ monitoring: { paused: boolSchema.parse(paused) } })
  )
  handle(IpcChannels.envReveal, (name) =>
    deps.provider.revealEnv(selectedDistroOf(deps), stringSchema.max(256).parse(name))
  )

  // --- LLM export (goal.md §12) ------------------------------------------
  handle(IpcChannels.llmCopyMarkdown, (preset) => {
    const md = snapshotToMarkdown(deps.store.get(), llmPresetSchema.parse(preset ?? 'default'))
    clipboard.writeText(md)
    return md
  })
  handle(IpcChannels.llmExportJson, async () => {
    const win = deps.getWindow()
    const result = await dialog.showSaveDialog(win ?? new BrowserWindow({ show: false }), {
      defaultPath: join(app.getPath('documents'), 'wslpad-snapshot.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, snapshotToJson(deps.store.get()), 'utf8')
    return result.filePath
  })

  // --- explorer -----------------------------------------------------------
  const distro = () => selectedDistroOf(deps)
  handle(IpcChannels.explorerList, async (path, opts) => {
    const p = linuxPathSchema.parse(path)
    const o = listOptsSchema.parse(opts)
    const entries = await deps.explorer.list(distro(), p, o)
    deps.store.setExplorerContext({
      distro: deps.store.get().selectedDistro,
      currentPath: p,
      showHidden: o?.showHidden ?? false
    })
    return entries
  })
  handle(IpcChannels.explorerTree, (path) => deps.explorer.tree(distro(), linuxPathSchema.parse(path)))
  handle(IpcChannels.explorerStat, (path) => deps.explorer.stat(distro(), linuxPathSchema.parse(path)))
  handle(IpcChannels.explorerMkdir, (path) => deps.explorer.mkdir(distro(), linuxPathSchema.parse(path)))
  handle(IpcChannels.explorerCreateFile, (path) =>
    deps.explorer.createFile(distro(), linuxPathSchema.parse(path))
  )
  handle(IpcChannels.explorerRename, (path, newName) =>
    deps.explorer.rename(distro(), linuxPathSchema.parse(path), fileNameSchema.parse(newName))
  )
  handle(IpcChannels.explorerCopy, (sources, destDir, move) =>
    deps.explorer.copyMove(distro(), pathsSchema.parse(sources), linuxPathSchema.parse(destDir), boolSchema.parse(move))
  )
  handle(IpcChannels.explorerTrash, (paths) => deps.explorer.trash(distro(), pathsSchema.parse(paths)))
  handle(IpcChannels.explorerDelete, (paths) => deps.explorer.remove(distro(), pathsSchema.parse(paths)))
  handle(IpcChannels.explorerReadText, (path) =>
    deps.explorer.readText(distro(), linuxPathSchema.parse(path), MAX_EDITOR_FILE_BYTES)
  )
  handle(IpcChannels.explorerWriteText, (path, content) =>
    deps.explorer.writeText(distro(), linuxPathSchema.parse(path), z.string().max(MAX_EDITOR_FILE_BYTES).parse(content))
  )
  handle(IpcChannels.explorerImport, (windowsPaths, destDir) =>
    deps.explorer.importFromWindows(distro(), winPathsSchema.parse(windowsPaths), linuxPathSchema.parse(destDir))
  )
  handle(IpcChannels.explorerExport, (paths, windowsDir) =>
    deps.explorer.exportToWindows(distro(), pathsSchema.parse(paths), windowsPathSchema.parse(windowsDir))
  )
  handle(IpcChannels.explorerCancelOp, (opId) => deps.explorer.cancelOp(stringSchema.max(128).parse(opId)))
  handle(IpcChannels.explorerDirSizes, (path, token) =>
    deps.explorer.dirSizes(distro(), linuxPathSchema.parse(path), opTokenSchema.parse(token))
  )
  handle(IpcChannels.explorerSearch, (path, query) =>
    deps.explorer.search(distro(), linuxPathSchema.parse(path), stringSchema.max(256).parse(query))
  )
  handle(IpcChannels.explorerPickImport, async () => {
    const win = deps.getWindow()
    if (!win) return []
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections', 'dontAddToRecent']
    })
    return res.canceled ? [] : res.filePaths
  })
  handle(IpcChannels.explorerPickExport, async () => {
    const win = deps.getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  handle(IpcChannels.explorerStartDrag, async (paths) => {
    const win = deps.getWindow()
    if (!win) return
    const linuxPaths = pathsSchema.parse(paths)
    const winPaths: string[] = []
    for (const p of linuxPaths) {
      winPaths.push(await deps.explorer.convertPath(distro(), p, 'windows'))
    }
    win.webContents.startDrag({
      file: winPaths[0],
      files: winPaths,
      icon: resourcePath('icon-32.png')
    })
  })

  // --- windows filesystem (left Explorer pane, goal.md §7) ----------------
  handle(IpcChannels.windowsPlaces, () => deps.windowsFs.places())
  handle(IpcChannels.windowsHome, () => deps.windowsFs.home())
  handle(IpcChannels.windowsList, (path, opts) =>
    deps.windowsFs.list(winRootOrPathSchema.parse(path), listOptsSchema.parse(opts))
  )
  handle(IpcChannels.windowsTree, (path) => deps.windowsFs.tree(winRootOrPathSchema.parse(path)))
  handle(IpcChannels.windowsStat, (path) => deps.windowsFs.stat(winRootOrPathSchema.parse(path)))
  handle(IpcChannels.windowsMkdir, (path) => deps.windowsFs.mkdir(windowsPathSchema.parse(path)))
  handle(IpcChannels.windowsCreateFile, (path) =>
    deps.windowsFs.createFile(windowsPathSchema.parse(path))
  )
  handle(IpcChannels.windowsRename, (path, newName) =>
    deps.windowsFs.rename(windowsPathSchema.parse(path), fileNameSchema.parse(newName))
  )
  handle(IpcChannels.windowsCopy, (sources, destDir, move) =>
    deps.windowsFs.copyMove(
      winPathsSchema.parse(sources),
      windowsPathSchema.parse(destDir),
      boolSchema.parse(move)
    )
  )
  handle(IpcChannels.windowsTrash, (paths) => deps.windowsFs.trash(winPathsSchema.parse(paths)))
  handle(IpcChannels.windowsDelete, (paths) => deps.windowsFs.remove(winPathsSchema.parse(paths)))
  handle(IpcChannels.windowsReadText, (path) =>
    deps.windowsFs.readText(windowsPathSchema.parse(path), MAX_EDITOR_FILE_BYTES)
  )
  handle(IpcChannels.windowsWriteText, (path, content) =>
    deps.windowsFs.writeText(
      windowsPathSchema.parse(path),
      z.string().max(MAX_EDITOR_FILE_BYTES).parse(content)
    )
  )
  handle(IpcChannels.windowsSearch, (path, query) =>
    deps.windowsFs.search(winRootOrPathSchema.parse(path), stringSchema.max(256).parse(query))
  )
  handle(IpcChannels.windowsOpenPath, async (path) => {
    const p = windowsPathSchema.parse(path)
    const info = await deps.windowsFs.stat(p)
    if (info.type === 'directory' || info.targetType === 'directory') {
      await shell.openPath(p)
    } else {
      shell.showItemInFolder(p)
    }
  })
  handle(IpcChannels.windowsStartDrag, (paths) => {
    const win = deps.getWindow()
    if (!win) return
    // Windows paths drag out verbatim — no conversion layer is involved.
    const files = winPathsSchema.parse(paths)
    win.webContents.startDrag({
      file: files[0],
      files,
      icon: resourcePath('icon-32.png')
    })
  })

  // --- paths / shell ------------------------------------------------------
  handle(IpcChannels.pathConvert, (input, to) =>
    deps.explorer.convertPath(
      distro(),
      stringSchema.max(4096).parse(input),
      z.enum(['windows', 'linux']).parse(to)
    )
  )
  handle(IpcChannels.openInWindowsExplorer, async (linuxPath) => {
    const winPath = await deps.explorer.convertPath(distro(), linuxPathSchema.parse(linuxPath), 'windows')
    shell.showItemInFolder(winPath)
  })
  handle(IpcChannels.openExternal, (url) => {
    const u = z.string().url().max(2048).parse(url)
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      throw new Error('Only http(s) URLs can be opened')
    }
    return shell.openExternal(u)
  })
  handle(IpcChannels.clipboardWrite, (text) => clipboard.writeText(z.string().max(1_000_000).parse(text)))
  handle(IpcChannels.clipboardRead, () => clipboard.readText().slice(0, 1_000_000))

  // --- terminal -----------------------------------------------------------
  handle(IpcChannels.terminalEnsure, async (name) => {
    const info = await deps.terminals.ensure(distroNameSchema.parse(name))
    return { sessionId: info.sessionId, status: info.status, cwd: info.cwd }
  })
  handle(IpcChannels.terminalInput, (sessionId, data) =>
    deps.terminals.input(sessionIdSchema.parse(sessionId), z.string().max(65536).parse(data))
  )
  handle(IpcChannels.terminalResize, (sessionId, cols, rows) =>
    deps.terminals.resize(
      sessionIdSchema.parse(sessionId),
      z.number().int().min(2).max(1000).parse(cols),
      z.number().int().min(2).max(500).parse(rows)
    )
  )
  handle(IpcChannels.terminalSetCwd, (sessionId, path) =>
    deps.terminals.setCwd(sessionIdSchema.parse(sessionId), linuxPathSchema.parse(path))
  )
  handle(IpcChannels.terminalGetState, (sessionId) =>
    deps.terminals.getState(sessionIdSchema.parse(sessionId))
  )

  // --- settings -----------------------------------------------------------
  handle(IpcChannels.settingsGet, () => deps.settings.get())
  handle(IpcChannels.settingsSet, async (patch) => {
    await deps.applySettingsPatch((patch ?? {}) as SettingsPatch)
    return deps.settings.get()
  })
  handle(IpcChannels.settingsReset, async () => {
    deps.settings.reset()
    await deps.applySettingsPatch({})
    return deps.settings.get()
  })
  handle(IpcChannels.settingsLoadError, () => deps.settings.loadError)

  // --- mcp ----------------------------------------------------------------
  handle(IpcChannels.mcpStatus, () => deps.mcp.status())
  handle(IpcChannels.mcpRegenerateToken, async () => {
    const next = deps.settings.regenerateMcpToken()
    await deps.mcp.restart(next.mcp.port, next.mcp.token)
    return deps.mcp.status()
  })
  handle(IpcChannels.mcpRegisterClient, (kind) => {
    const k = clientKindSchema.parse(kind) as McpClientKind
    const s = deps.settings.get()
    return registerClient(k, {
      port: s.mcp.port,
      token: s.mcp.token,
      runner: deps.runner,
      selectedDistro: deps.store.get().selectedDistro,
      appExePath: process.execPath,
      homeDir: app.getPath('home'),
      appData: app.getPath('appData')
    })
  })
  handle(IpcChannels.mcpTest, () => {
    const s = deps.settings.get()
    return testMcpConnection(s.mcp.port, s.mcp.token)
  })
  handle(IpcChannels.mcpConfigJson, () => {
    const s = deps.settings.get()
    return buildMcpConfigJson(s.mcp.port, s.mcp.token)
  })

  // --- updates / app ------------------------------------------------------
  handle(IpcChannels.updateCheck, () => deps.updater.checkNow())
  handle(IpcChannels.updateInstall, () => deps.updater.quitAndInstall())
  handle(IpcChannels.updateStatusGet, () => deps.getUpdateStatus())
  handle(IpcChannels.appVersion, () => app.getVersion())
  handle(IpcChannels.appQuit, () => deps.quit())
}

export function removeIpcHandlers(): void {
  for (const channel of Object.values(IpcChannels)) {
    ipcMain.removeHandler(channel)
  }
}
