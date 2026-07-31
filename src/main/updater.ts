import { readFileSync, rmSync, writeFileSync } from 'fs'
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

/**
 * Remembers the version handed to the installer across a restart, so a failed
 * install can be noticed at all (goal.md §4.3.8).
 */
export interface PendingInstallStore {
  read(): string | null
  write(version: string | null): void
}

export interface AppUpdaterOptions {
  isPackaged: boolean
  autoCheck: boolean
  onStatus: UpdaterEvents
  /** The version running right now — what a completed install must have changed. */
  currentVersion: string
  pendingInstall?: PendingInstallStore
  injectAutoUpdater?: AutoUpdaterLike
  /** Periodic check interval override for tests; production default is 6h. */
  checkIntervalMs?: number
}

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Numeric, field by field: '0.1.10' is newer than '0.1.9', which string
 * comparison gets backwards. Anything unparsable sorts as 0 rather than
 * throwing — this decides whether to show a notice, not whether to install.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/**
 * An install was handed off and the app came back on the same version: the
 * installer did not take. Windows makes this easy to miss — an antivirus or
 * the search indexer holding `app.asar` aborts NSIS, the old app relaunches,
 * and nothing anywhere says the update did not happen.
 */
export function judgeInstallOutcome(
  pendingVersion: string | null,
  currentVersion: string
): 'none' | 'installed' | 'failed' {
  if (pendingVersion === null) return 'none'
  return compareVersions(currentVersion, pendingVersion) >= 0 ? 'installed' : 'failed'
}

const memoryPendingInstall = (): PendingInstallStore => {
  let value: string | null = null
  return { read: () => value, write: (v) => void (value = v) }
}

/**
 * One line of JSON next to settings.json. Every failure here is swallowed: not
 * knowing whether an install took is a worse outcome than a missing file, but
 * it is never worth failing to start over.
 */
export function createPendingInstallStore(filePath: string): PendingInstallStore {
  return {
    read(): string | null {
      try {
        const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
        const version = (parsed as { version?: unknown } | null)?.version
        return typeof version === 'string' && version.length > 0 ? version : null
      } catch {
        return null
      }
    },
    write(version: string | null): void {
      try {
        if (version === null) rmSync(filePath, { force: true })
        else writeFileSync(filePath, JSON.stringify({ version }), 'utf8')
      } catch {
        // An unwritable state file costs a missed notice, nothing more.
      }
    }
  }
}

/**
 * GitHub Releases auto-update wrapper (goal.md §4.3). Downloads happen in the
 * background and install on quit — running Console sessions are never
 * interrupted; the user may opt into an immediate quitAndInstall().
 */
export class AppUpdater {
  private status: UpdateStatus = {
    state: 'idle',
    version: null,
    percent: null,
    error: null,
    installFailedVersion: null
  }
  private updater: AutoUpdaterLike | null = null
  private timer: NodeJS.Timeout | null = null
  private autoCheck: boolean
  private started = false
  private disposed = false
  private pending: PendingInstallStore
  /**
   * Rides alongside every status rather than being one: the state machine keeps
   * moving (checking, downloading, …) and this must stay on screen until the
   * version it names is actually running.
   */
  private installFailedVersion: string | null = null

  constructor(private opts: AppUpdaterOptions) {
    this.autoCheck = opts.autoCheck
    this.pending = opts.pendingInstall ?? memoryPendingInstall()
  }

  start(): void {
    if (this.started || this.disposed) return
    this.started = true

    if (!this.opts.isPackaged) {
      // Dev mode: updates fully disabled — never touch electron-updater.
      this.emit({ state: 'disabled', version: null, percent: null, error: null })
      return
    }

    this.reconcilePendingInstall()
    if (this.installFailedVersion !== null) {
      // Say it even when automatic checks are switched off: the failure has
      // already happened, and nothing else will bring it up.
      this.emit({ state: 'idle', version: null, percent: null, error: null })
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
    this.markInstallHandoff()
    this.updater?.quitAndInstall()
  }

  /**
   * Called on the way out, because autoInstallOnAppQuit means any quit with a
   * downloaded update is an install attempt. Recording it here rather than at
   * download time keeps a crash from being reported as a failed install.
   */
  markInstallHandoff(): void {
    if (this.status.state !== 'downloaded' || this.status.version === null) return
    this.pending.write(this.status.version)
  }

  private reconcilePendingInstall(): void {
    const outcome = judgeInstallOutcome(this.pending.read(), this.opts.currentVersion)
    if (outcome === 'installed') {
      this.pending.write(null)
      this.installFailedVersion = null
      return
    }
    if (outcome === 'failed') {
      // The record stays: the notice has to survive restarts, because so does
      // the problem. It clears itself the first time the app comes up on the
      // version that was supposed to be installed.
      this.installFailedVersion = this.pending.read()
    }
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

  private emit(status: Omit<UpdateStatus, 'installFailedVersion'>): void {
    if (this.disposed) return
    this.status = { ...status, installFailedVersion: this.installFailedVersion }
    this.opts.onStatus(this.status)
  }
}

// Loaded lazily inside start() so dev mode and unit tests never require the
// real module (which expects a packaged Electron environment).
function loadElectronAutoUpdater(): AutoUpdaterLike {
  const mod = createRequire(import.meta.url)('electron-updater') as { autoUpdater: unknown }
  return mod.autoUpdater as AutoUpdaterLike
}
