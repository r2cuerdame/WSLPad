import { randomUUID } from 'crypto'
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { SettingsLoadError } from '@shared/ipc'
import { defaultSettings, parseSettings } from '@shared/schemas'
import type {
  ConsoleSettings,
  ExplorerSettings,
  McpSettings,
  MonitoringSettings,
  Settings,
  SettingsPatch,
  UpdateSettings
} from '@shared/types'

type ChangeListener = (s: Settings) => void

/** Copy only the allowed, defined keys of a patch section onto a base section. */
function mergeSection<T extends object>(
  base: T,
  patch: Partial<T> | undefined,
  keys: (keyof T)[]
): T {
  const out = { ...base }
  if (!patch) return out
  for (const key of keys) {
    const value = patch[key]
    if (value !== undefined) out[key] = value as T[typeof key]
  }
  return out
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmpPath, filePath)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Persistent settings store (goal.md §5.4). Corrupted files never crash the
 * app: the broken file is backed up, defaults take over and the reason is
 * surfaced through loadError. A file that exists but cannot be read (locked by
 * antivirus/backup software, access denied) is a different case: its content
 * is probably fine, so it is left untouched and the next start loads it again.
 * Defaults only live in memory until the user changes something; that first
 * write copies the unread original aside and refuses to overwrite it if the
 * copy fails. The MCP auth token can only change through
 * regenerateMcpToken() — SettingsPatch has no token field and patch() merges
 * an explicit key allowlist, so IPC callers cannot overwrite it.
 */
export class SettingsStore {
  private settings: Settings
  private listeners = new Set<ChangeListener>()
  loadError: SettingsLoadError = { corrupted: false, unreadable: false, message: null }
  /** The file on disk was never read; copy it aside before the first overwrite. */
  private unreadOriginal = false

  constructor(private filePath: string) {
    this.settings = defaultSettings()
    this.load()
  }

  load(): void {
    this.loadError = { corrupted: false, unreadable: false, message: null }
    this.unreadOriginal = false
    let raw: string | null = null
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // The file exists but could not be read: keep it as-is for the next start.
        this.loadError = { corrupted: false, unreadable: true, message: errorMessage(err) }
        this.unreadOriginal = true
      }
      // First run: defaults + fresh token, persisted below. Unreadable file:
      // defaults + a token that stay in memory until the first change.
    }

    if (raw !== null) {
      let parsed: unknown
      let parseFailure: string | null = null
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        parseFailure = errorMessage(err)
      }
      if (
        parseFailure === null &&
        (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      ) {
        parseFailure = 'settings file is not a JSON object'
      }
      if (parseFailure !== null) {
        this.backupCorruptedFile()
        this.loadError = { corrupted: true, unreadable: false, message: parseFailure }
        this.settings = defaultSettings()
      } else {
        this.settings = parseSettings(parsed)
      }
    }

    if (!this.settings.mcp.token) {
      this.settings = { ...this.settings, mcp: { ...this.settings.mcp, token: randomUUID() } }
    }
    if (!this.unreadOriginal) this.persist()
  }

  get(): Settings {
    return this.settings
  }

  patch(p: SettingsPatch): Settings {
    const cur = this.settings
    const candidate: Settings = {
      schemaVersion: cur.schemaVersion,
      language: p.language !== undefined ? p.language : cur.language,
      theme: p.theme !== undefined ? p.theme : cur.theme,
      startWithWindows:
        p.startWithWindows !== undefined ? p.startWithWindows : cur.startWithWindows,
      monitoring: mergeSection<MonitoringSettings>(cur.monitoring, p.monitoring, [
        'paused',
        'fastMs',
        'mediumMs',
        'slowMs'
      ]),
      explorer: mergeSection<ExplorerSettings>(cur.explorer, p.explorer, [
        'showHiddenByDefault',
        'startLocation',
        'lastPath'
      ]),
      console: mergeSection<ConsoleSettings>(cur.console, p.console, [
        'fontSize',
        'fontFamily',
        'scrollback'
      ]),
      // token is intentionally absent from the merge keys (goal.md §16)
      mcp: mergeSection<McpSettings>(cur.mcp, p.mcp, ['enabled', 'port']),
      updates: mergeSection<UpdateSettings>(cur.updates, p.updates, ['autoCheck'])
    }
    this.settings = parseSettings(candidate)
    this.persist()
    this.emit()
    return this.settings
  }

  reset(): Settings {
    const next = defaultSettings()
    // Keep the token: a reset must not silently break registered MCP clients.
    next.mcp.token = this.settings.mcp.token || randomUUID()
    this.settings = next
    this.persist()
    this.emit()
    return this.settings
  }

  regenerateMcpToken(): Settings {
    this.settings = { ...this.settings, mcp: { ...this.settings.mcp, token: randomUUID() } }
    this.persist()
    this.emit()
    return this.settings
  }

  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.settings)
  }

  private persist(): void {
    if (this.unreadOriginal && !this.backupUnreadFile()) return
    try {
      atomicWriteJson(this.filePath, this.settings)
    } catch (err) {
      // Persist failures must not crash the app; keep in-memory settings live.
      this.loadError = { ...this.loadError, message: errorMessage(err) }
    }
  }

  /**
   * Copy the never-read original aside before its first overwrite. Returns
   * false (and records why) when the copy fails, so the original is kept.
   */
  private backupUnreadFile(): boolean {
    try {
      copyFileSync(this.filePath, `${this.filePath}.bak-${Date.now()}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // In-memory settings stay live; the next change tries the copy again.
        this.loadError = {
          ...this.loadError,
          message: `settings file left unchanged: backup of the unread original failed (${errorMessage(err)})`
        }
        return false
      }
      // The original disappeared in the meantime; there is nothing left to keep.
    }
    this.unreadOriginal = false
    return true
  }

  private backupCorruptedFile(): void {
    try {
      renameSync(this.filePath, `${this.filePath}.bak-${Date.now()}`)
    } catch {
      // Backup is best-effort; recovery to defaults proceeds regardless.
    }
  }
}
