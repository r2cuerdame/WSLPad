import { Menu, Tray, app, nativeImage, shell } from 'electron'
import type { i18n as I18nInstance } from 'i18next'
import { PROJECT_URLS } from '@shared/constants'
import { resourcePath } from './resources'

export interface TrayHost {
  showMainWindow(): void
  toggleMainWindow(): void
  refreshAll(): void
  isMonitoringPaused(): boolean
  setMonitoringPaused(paused: boolean): void
  mcpStatusLabel(): string
  isAutostartEnabled(): boolean
  setAutostartEnabled(enabled: boolean): void
  checkForUpdates(): void
  quit(): void
  selectedDistro(): string | null
}

/** Tray icon + context menu (goal.md §4.2). Rebuild the menu on state/locale change. */
export class AppTray {
  private tray: Tray
  private lastFirstLabel = ''

  constructor(
    private host: TrayHost,
    private i18n: I18nInstance
  ) {
    const icon = nativeImage.createFromPath(resourcePath('tray.png'))
    this.tray = new Tray(icon)
    this.tray.on('click', () => this.host.toggleMainWindow())
    this.update()
  }

  setI18n(i18n: I18nInstance): void {
    this.i18n = i18n
    this.update()
  }

  update(): void {
    const t = this.i18n.t.bind(this.i18n)
    const distro = this.host.selectedDistro()
    this.tray.setToolTip(distro ? t('tray.tooltip', { distro }) : t('app.name'))
    this.lastFirstLabel = t('tray.open')
    const menu = Menu.buildFromTemplate([
      { label: t('tray.open'), click: () => this.host.showMainWindow() },
      { label: t('tray.refresh'), click: () => this.host.refreshAll() },
      {
        label: this.host.isMonitoringPaused() ? t('tray.resumeMonitoring') : t('tray.pauseMonitoring'),
        click: () => this.host.setMonitoringPaused(!this.host.isMonitoringPaused())
      },
      { label: this.host.mcpStatusLabel(), enabled: false },
      { type: 'separator' },
      {
        label: t('tray.startWithWindows'),
        type: 'checkbox',
        checked: this.host.isAutostartEnabled(),
        click: (item) => this.host.setAutostartEnabled(item.checked)
      },
      { label: t('tray.checkForUpdates'), click: () => this.host.checkForUpdates() },
      { type: 'separator' },
      {
        label: t('tray.about', { name: t('app.name') }),
        submenu: [
          // The version is the reason most people open an About menu at all.
          { label: t('tray.version', { version: app.getVersion() }), enabled: false },
          { label: t('app.tagline'), enabled: false },
          { type: 'separator' },
          { label: t('tray.github'), click: () => void shell.openExternal(PROJECT_URLS.repository) },
          {
            label: t('tray.releaseNotes'),
            click: () => void shell.openExternal(PROJECT_URLS.releases)
          },
          { label: t('tray.sponsor'), click: () => void shell.openExternal(PROJECT_URLS.sponsor) }
        ]
      },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => this.host.quit() }
    ])
    this.tray.setContextMenu(menu)
  }

  /** E2E hook: first context-menu label in the active locale. */
  firstMenuLabel(): string {
    return this.lastFirstLabel
  }

  dispose(): void {
    this.tray.destroy()
  }
}

export function quitApp(): void {
  app.quit()
}
