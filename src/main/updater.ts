import { createRequire } from 'module'
import type { UpdateStatus } from '@shared/types'

export type UpdaterEvents = (s: UpdateStatus) => void

/**
 * Structural subset of electron-updater's autoUpdater so unit tests can inject
 * a fake and dev mode never has to load the real module (goal.md §4.3.7).
 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  forceDevUpdateConfig: boolean
  on(event: string, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export interface AppUpdaterOptions {
  isPackaged: boolean
  autoCheck: boolean
  onStatus: UpdaterEvents
  injectAutoUpdater?: AutoUpdaterLike
  /** Periodic check interval override for tests; production default is 6h. */
  checkIntervalMs?: number
}

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * GitHub Releases auto-update wrapper (goal.md §4.3). Downloads happen in the
 * background and install on quit — running Console sessions are never
 * interrupted; the user may opt into an immediate quitAndInstall().
 */
export class AppUpdater {
  private status: UpdateStatus = { state: 'idle', version: null, percent: null, error: null }
  private updater: AutoUpdaterLike | null = null
  private timer: NodeJS.Timeout | null = null
  private autoCheck: boolean
  private started = false
  private disposed = false

  constructor(private opts: AppUpdaterOptions) {
    this.autoCheck = opts.autoCheck
  }

  start(): void {
    if (this.started || this.disposed) return
    this.started = true

    if (!this.opts.isPackaged) {
      // Dev mode: updates fully disabled — never touch electron-updater.
      this.emit({ state: 'disabled', version: null, percent: null, error: null })
      return
    }

    this.updater = this.opts.injectAutoUpdater ?? loadElectronAutoUpdater()
    this.updater.autoDownload = true
    this.updater.autoInstallOnAppQuit = true
    this.updater.forceDevUpdateConfig = false
    this.wireEvents(this.updater)

    if (this.autoCheck) {
      void this.checkNow()
      this.startTimer()
    }
  }

  async checkNow(): Promise<UpdateStatus> {
    if (!this.updater || this.disposed) return this.status
    try {
      await this.updater.checkForUpdates()
    } catch (err) {
      this.emit({
        state: 'error',
        version: this.status.version,
        percent: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
    return this.status
  }

  quitAndInstall(): void {
    this.updater?.quitAndInstall()
  }

  setAutoCheck(enabled: boolean): void {
    this.autoCheck = enabled
    this.stopTimer()
    if (enabled && this.started && this.updater && !this.disposed) this.startTimer()
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer()
    this.updater = null
  }

  private wireEvents(updater: AutoUpdaterLike): void {
    updater.on('checking-for-update', () => {
      this.emit({ state: 'checking', version: null, percent: null, error: null })
    })
    updater.on('update-available', (info: { version?: string }) => {
      this.emit({ state: 'available', version: info?.version ?? null, percent: null, error: null })
    })
    updater.on('update-not-available', () => {
      this.emit({ state: 'not-available', version: null, percent: null, error: null })
    })
    updater.on('download-progress', (progress: { percent?: number }) => {
      this.emit({
        state: 'downloading',
        version: this.status.version,
        percent: typeof progress?.percent === 'number' ? progress.percent : null,
        error: null
      })
    })
    updater.on('update-downloaded', (info: { version?: string }) => {
      this.emit({
        state: 'downloaded',
        version: info?.version ?? this.status.version,
        percent: 100,
        error: null
      })
    })
    updater.on('error', (err: Error) => {
      // Update failure keeps the current version running (goal.md §4.3.6).
      this.emit({
        state: 'error',
        version: this.status.version,
        percent: null,
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  private startTimer(): void {
    this.stopTimer()
    const interval = this.opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.timer = setInterval(() => {
      void this.checkNow()
    }, interval)
    this.timer.unref?.()
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private emit(status: UpdateStatus): void {
    if (this.disposed) return
    this.status = status
    this.opts.onStatus(status)
  }
}

// Loaded lazily inside start() so dev mode and unit tests never require the
// real module (which expects a packaged Electron environment).
function loadElectronAutoUpdater(): AutoUpdaterLike {
  const mod = createRequire(import.meta.url)('electron-updater') as { autoUpdater: unknown }
  return mod.autoUpdater as AutoUpdaterLike
}
