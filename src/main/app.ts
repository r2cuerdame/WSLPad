import { BrowserWindow, Notification, app } from 'electron'
import { join } from 'path'
import type { i18n as I18nInstance } from 'i18next'
import { createI18n, detectLocale } from '@shared/i18n'
import { IpcChannels } from '@shared/ipc'
import { updateLabel } from '@shared/update-label'
import type { LocaleCode, Settings, SettingsPatch, UpdateStatus } from '@shared/types'
import { AppTray } from './tray'
import { createMainWindow } from './window'
import { registerIpcHandlers, removeIpcHandlers } from './ipc/handlers'
import { createBackends, type Backends } from './wsl/factory'
import { SnapshotStore } from './state/store'
import { PollingScheduler } from './state/polling'
import { TerminalManager } from './terminal/manager'
import { SettingsStore } from './settings/store'
import { getAutostartEnabled, setAutostartEnabled, shouldStartHidden } from './autostart'
import { AppUpdater, createPendingInstallStore } from './updater'
import { McpServerHost } from './mcp/server'
import { resolveCommand } from './wsl/resolve-command'

/** Composition root: wires settings, backends, store, polling, console, MCP, tray, updater. */
export class WslPadApp {
  private window: BrowserWindow | null = null
  private tray: AppTray | null = null
  private quitting = false
  private i18n: I18nInstance
  private settings!: SettingsStore
  private backends!: Backends
  private store!: SnapshotStore
  private polling!: PollingScheduler
  private terminals!: TerminalManager
  private mcp!: McpServerHost
  private updater!: AppUpdater
  private updateStatus: UpdateStatus = {
    state: 'idle',
    version: null,
    percent: null,
    error: null,
    installFailedVersion: null
  }

  constructor() {
    this.i18n = createI18n('en')
  }

  async start(): Promise<void> {
    this.settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    this.i18n = createI18n(this.resolveLocale(this.settings.get()))

    this.backends = createBackends()
    this.store = new SnapshotStore(this.backends.provider)
    this.store.subscribe((snapshot) => {
      this.send(IpcChannels.evSnapshot, snapshot)
      this.tray?.update()
    })

    this.terminals = new TerminalManager(this.backends.consoleFactory, {
      onData: (ev) => this.send(IpcChannels.evTerminalData, ev),
      onStatus: (ev) => {
        this.store.setTerminalContext({ distro: ev.distro, cwd: ev.cwd, status: ev.status })
        this.send(IpcChannels.evTerminalStatus, ev)
      }
    })

    // Both panes report on one channel so the transfer UI needs no pane logic.
    this.backends.explorer.onProgress((p) => this.send(IpcChannels.evOpProgress, p))
    this.backends.windowsFs.onProgress((p) => this.send(IpcChannels.evOpProgress, p))

    this.mcp = new McpServerHost({
      getSnapshot: () => this.store.get(),
      explorer: this.backends.explorer,
      getSelectedDistro: () => this.store.get().selectedDistro,
      // A live lookup, unlike everything else here — but a bounded, read-only
      // one: the name is validated to be a command name before it can reach a
      // shell, and resolving is never running.
      resolveCommand: async (distro, command) => {
        const runner = this.backends.runner
        // Fixture mode has no runner: reporting "cannot look" is the honest
        // answer, and the tool says so rather than "not installed".
        return runner === null ? null : resolveCommand(runner, distro, command)
      },
      readServiceLog: async (distro, unit, scope) => {
        const read = this.backends.provider.getServiceLog
        if (read === undefined) {
          return { unit, scope, lines: [], truncated: false, error: 'not available here' }
        }
        return read.call(this.backends.provider, distro, unit, scope)
      }
    })
    this.mcp.onStatus((s) => {
      this.store.setMcpStatus(s)
      this.send(IpcChannels.evMcp, s)
      this.tray?.update()
    })

    this.updater = new AppUpdater({
      isPackaged: app.isPackaged,
      autoCheck: this.settings.get().updates.autoCheck,
      currentVersion: app.getVersion(),
      pendingInstall: createPendingInstallStore(
        join(app.getPath('userData'), 'pending-install.json')
      ),
      onStatus: (s) => {
        this.updateStatus = s
        this.send(IpcChannels.evUpdate, s)
        // The tray entry mirrors the state, so it has to be rebuilt with it.
        this.tray?.update()
      }
    })

    registerIpcHandlers({
      store: this.store,
      provider: this.backends.provider,
      explorer: this.backends.explorer,
      windowsFs: this.backends.windowsFs,
      terminals: this.terminals,
      settings: this.settings,
      mcp: this.mcp,
      updater: this.updater,
      runner: this.backends.runner,
      getWindow: () => this.window,
      applySettingsPatch: (patch) => this.applySettingsPatch(patch),
      getUpdateStatus: () => this.updateStatus,
      quit: () => this.quit()
    })

    const startHidden = shouldStartHidden(process.argv)
    this.window = createMainWindow({ isQuitting: () => this.quitting, showOnReady: !startHidden })
    this.createTray()
    // E2E observability: Playwright's main-process evaluate reads this (no UI path).
    ;(globalThis as Record<string, unknown>).__wslpadTest = {
      trayCreated: () => this.tray !== null,
      windowVisible: () => this.window?.isVisible() ?? false,
      windowCount: () => BrowserWindow.getAllWindows().length,
      trayMenuFirstLabel: () => this.tray?.firstMenuLabel() ?? ''
    }

    // First-run default: start with Windows enabled (goal.md §4.1).
    // Dev builds must never register the bare electron.exe as a login item.
    if (app.isPackaged && this.settings.get().startWithWindows !== getAutostartEnabled()) {
      setAutostartEnabled(this.settings.get().startWithWindows)
    }

    await this.store.initialize()
    this.polling = new PollingScheduler(this.store, this.settings.get().monitoring)
    if (!this.settings.get().monitoring.paused) this.polling.start()

    const mcpSettings = this.settings.get().mcp
    if (mcpSettings.enabled) {
      await this.mcp.start(mcpSettings.port, mcpSettings.token).catch(() => {
        /* status carries the error into warnings */
      })
    }

    this.updater.start()
  }

  private resolveLocale(s: Settings): LocaleCode {
    return s.language === 'auto' ? detectLocale(app.getPreferredSystemLanguages()) : s.language
  }

  private createTray(): void {
    this.tray = new AppTray(
      {
        showMainWindow: () => this.showMainWindow(),
        toggleMainWindow: () => this.toggleMainWindow(),
        refreshAll: () => {
          void this.store.refreshFast()
          void this.store.refreshMedium()
          void this.store.refreshSlow()
        },
        isMonitoringPaused: () => this.settings.get().monitoring.paused,
        setMonitoringPaused: (paused) => {
          void this.applySettingsPatch({ monitoring: { paused } })
        },
        mcpStatusLabel: () => {
          const s = this.mcp.status()
          return s.running
            ? this.i18n.t('tray.mcpStatusRunning', { endpoint: s.endpoint ?? '' })
            : this.i18n.t('tray.mcpStatusStopped')
        },
        isAutostartEnabled: () => this.settings.get().startWithWindows,
        setAutostartEnabled: (enabled) => {
          void this.applySettingsPatch({ startWithWindows: enabled })
        },
        // Asked from the tray, answered in the tray: stealing focus with the
        // main window told the user nothing (the update state is not on it).
        checkForUpdates: () => {
          void this.updater.checkNow().then((status) => this.notifyUpdate(status))
        },
        updateStatus: () => this.updateStatus,
        installUpdate: () => this.updater.quitAndInstall(),
        quit: () => this.quit(),
        selectedDistro: () => this.store.get().selectedDistro
      },
      this.i18n
    )
  }

  /**
   * Result of a check the user asked for, as a desktop notification. Automatic
   * background checks stay silent — a six-hourly "you are up to date" would be
   * noise, not information.
   */
  private notifyUpdate(status: UpdateStatus): void {
    if (!Notification.isSupported()) return
    const { key, vars } = updateLabel(status)
    new Notification({
      title: this.i18n.t('app.name'),
      body: this.i18n.t(key, vars ?? {})
    }).show()
  }

  /** Single place where settings changes take effect immediately (goal.md §5.4). */
  async applySettingsPatch(patch: SettingsPatch): Promise<void> {
    const prev = this.settings.get()
    const next = this.settings.patch(patch)

    if (this.resolveLocale(prev) !== this.resolveLocale(next)) {
      this.i18n = createI18n(this.resolveLocale(next))
      this.tray?.setI18n(this.i18n)
    }
    if (prev.startWithWindows !== next.startWithWindows && app.isPackaged) {
      setAutostartEnabled(next.startWithWindows)
    }
    if (
      prev.monitoring.paused !== next.monitoring.paused ||
      prev.monitoring.fastMs !== next.monitoring.fastMs ||
      prev.monitoring.mediumMs !== next.monitoring.mediumMs ||
      prev.monitoring.slowMs !== next.monitoring.slowMs
    ) {
      this.polling?.setIntervals(next.monitoring)
      this.polling?.setPaused(next.monitoring.paused)
    }
    if (prev.updates.autoCheck !== next.updates.autoCheck) {
      this.updater.setAutoCheck(next.updates.autoCheck)
    }
    if (prev.mcp.enabled !== next.mcp.enabled || prev.mcp.port !== next.mcp.port) {
      if (next.mcp.enabled) {
        await this.mcp.restart(next.mcp.port, next.mcp.token).catch(() => {})
      } else {
        await this.mcp.stop()
      }
    }
    this.send(IpcChannels.evSettings, next)
    this.tray?.update()
  }

  private send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  showMainWindow(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.window = createMainWindow({ isQuitting: () => this.quitting, showOnReady: true })
      return
    }
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  toggleMainWindow(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.showMainWindow()
      return
    }
    if (this.window.isVisible() && !this.window.isMinimized()) {
      this.window.hide()
    } else {
      this.showMainWindow()
    }
  }

  markQuitting(): void {
    this.quitting = true
    // A downloaded update installs on quit, so this is the handoff: record the
    // version now, and the next start can tell whether the installer took.
    this.updater?.markInstallHandoff()
  }

  quit(): void {
    this.quitting = true
    app.quit()
  }

  dispose(): void {
    removeIpcHandlers()
    this.polling?.stop()
    this.terminals?.disposeAll()
    void this.mcp?.stop()
    this.backends?.windowsFs?.dispose()
    void this.backends?.runner?.disposeAll()
    this.updater?.dispose()
    this.tray?.dispose()
    this.tray = null
  }
}
