import { BrowserWindow, app } from 'electron'
import type { i18n as I18nInstance } from 'i18next'
import { createI18n, detectLocale } from '@shared/i18n'
import { AppTray } from './tray'
import { createMainWindow } from './window'

/**
 * Composition root. Task A boot skeleton — services (runner, store, polling,
 * console sessions, MCP, settings, updater) are wired in as they land.
 */
export class WslPadApp {
  private window: BrowserWindow | null = null
  private tray: AppTray | null = null
  private quitting = false
  private monitoringPaused = false
  i18n: I18nInstance

  constructor() {
    this.i18n = createI18n(detectLocale(['en']))
  }

  async start(): Promise<void> {
    this.i18n = createI18n(detectLocale(app.getPreferredSystemLanguages()))
    this.window = createMainWindow({ isQuitting: () => this.quitting })
    this.tray = new AppTray(
      {
        showMainWindow: () => this.showMainWindow(),
        toggleMainWindow: () => this.toggleMainWindow(),
        refreshAll: () => {},
        isMonitoringPaused: () => this.monitoringPaused,
        setMonitoringPaused: (paused) => {
          this.monitoringPaused = paused
          this.tray?.update()
        },
        mcpStatusLabel: () => this.i18n.t('tray.mcpStatusStopped'),
        isAutostartEnabled: () => app.getLoginItemSettings().openAtLogin,
        setAutostartEnabled: (enabled) =>
          app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] }),
        checkForUpdates: () => {},
        quit: () => this.quit(),
        selectedDistro: () => null
      },
      this.i18n
    )
  }

  showMainWindow(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.window = createMainWindow({ isQuitting: () => this.quitting })
      return
    }
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
  }

  quit(): void {
    this.quitting = true
    app.quit()
  }

  dispose(): void {
    this.tray?.dispose()
    this.tray = null
  }
}
