import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
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

/**
 * Persistent settings store (goal.md §5.4). Corrupted files never crash the
 * app: the broken file is backed up, defaults take over and the reason is
 * surfaced through loadError. The MCP auth token can only change through
 * regenerateMcpToken() — SettingsPatch has no token field and patch() merges
 * an explicit key allowlist, so IPC callers cannot overwrite it.
 */
export class SettingsStore {
  private settings: Settings
  private listeners = new Set<ChangeListener>()
  loadError: SettingsLoadError = { corrupted: false, message: null }

  constructor(private filePath: string) {
    this.settings = defaultSettings()
    this.load()
  }

  load(): void {
    this.loadError = { corrupted: false, message: null }
    let raw: string | null = null
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        this.loadError = {
          corrupted: true,
          message: err instanceof Error ? err.message : String(err)
        }
      }
      // First run (or unreadable file): defaults + fresh token, persisted below.
    }

    if (raw !== null) {
      let parsed: unknown
      let parseFailure: string | null = null
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        parseFailure = err instanceof Error ? err.message : String(err)
      }
      if (
        parseFailure === null &&
        (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      ) {
        parseFailure = 'settings file is not a JSON object'
      }
      if (parseFailure !== null) {
        this.backupCorruptedFile()
        this.loadError = { corrupted: true, message: parseFailure }
        this.settings = defaultSettings()
      } else {
        this.settings = parseSettings(parsed)
      }
    }

    if (!this.settings.mcp.token) {
      this.settings = { ...this.settings, mcp: { ...this.settings.mcp, token: randomUUID() } }
    }
    this.persist()
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
    try {
      atomicWriteJson(this.filePath, this.settings)
    } catch (err) {
      // Persist failures must not crash the app; keep in-memory settings live.
      this.loadError = {
        corrupted: this.loadError.corrupted,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }

  private backupCorruptedFile(): void {
    try {
      renameSync(this.filePath, `${this.filePath}.bak-${Date.now()}`)
    } catch {
      // Backup is best-effort; recovery to defaults proceeds regardless.
    }
  }
}
