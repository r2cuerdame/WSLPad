import { MASKED_VALUE, SECRET_NAME_PATTERNS } from './constants'
import type {
  DashboardSnapshot,
  EnvironmentVariableInfo,
  WslConfigInfo,
  WslPadSnapshot,
  WslSettingInfo
} from './types'

/** True when the variable name matches a secret pattern (goal.md §6.7). */
export function isSecretName(name: string): boolean {
  const upper = name.toUpperCase()
  return SECRET_NAME_PATTERNS.some((p) => upper.includes(p))
}

/** Mask a value when its name is secret-like; non-secrets pass through. */
export function maskEnvValue(name: string, value: string): string {
  return isSecretName(name) ? MASKED_VALUE : value
}

const PATH_LIKE_NAMES = ['PATH', 'MANPATH', 'INFOPATH', 'LD_LIBRARY_PATH', 'PYTHONPATH', 'GOPATH', 'CDPATH']

export function isPathLikeName(name: string): boolean {
  const upper = name.toUpperCase()
  return PATH_LIKE_NAMES.includes(upper) || upper.endsWith('_PATH') || upper.endsWith('PATH')
}

/** Heuristic: value looks like it crossed over from Windows via WSLENV / interop. */
export function looksWindowsOriginated(name: string, value: string): boolean {
  if (name === 'WSLENV' || name === 'WSL_DISTRO_NAME' || name === 'WSL_INTEROP') return true
  return /^[A-Za-z]:\\/.test(value) || value.includes('\\Program Files') || value.includes('/mnt/c/')
}

/** True when file content looks like a private key and must never be returned raw (goal.md §11.4). */
export function looksLikePrivateKey(content: string): boolean {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(content)
}

/** True when a path is a well-known secret/credential file (goal.md §11.4). */
export function isSensitivePath(linuxPath: string): boolean {
  const p = linuxPath.replace(/\\/g, '/')
  if (/\/\.ssh\/(id_[^/]+|[^/]*_key|authorized_keys|known_hosts)?$/.test(p) && !p.endsWith('.pub')) {
    if (/\/\.ssh\/?$/.test(p)) return false
    return true
  }
  if (/\.(pem|p12|pfx|key)$/i.test(p)) return true
  if (/\/(\.netrc|\.npmrc|\.pgpass)$/.test(p)) return true
  if (/credentials(\.json)?$/i.test(p)) return true
  return false
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactValueInNote(note: string, raw: string | null): string {
  if (raw === null || raw === '' || raw === MASKED_VALUE) return note
  const left = /^[A-Za-z0-9_]/.test(raw) ? '(?<![A-Za-z0-9_])' : ''
  const right = /[A-Za-z0-9_]$/.test(raw) ? '(?![A-Za-z0-9_])' : ''
  return note.replace(new RegExp(`${left}${escapeRegExp(raw)}${right}`, 'g'), MASKED_VALUE)
}

/** Defense in depth: mask secret env values even if a collector slips. */
export function sanitizeEnvironment(
  env: readonly EnvironmentVariableInfo[]
): EnvironmentVariableInfo[] {
  return env.map((v) =>
    v.isSecret || isSecretName(v.name) ? { ...v, maskedValue: MASKED_VALUE } : v
  )
}

/** Mask declared/effective values and any embedded raw values in notes for secret-named settings. */
export function sanitizeWslSetting(setting: WslSettingInfo): WslSettingInfo {
  if (!isSecretName(setting.key)) return setting
  let note = setting.note
  if (note !== null) {
    note = redactValueInNote(note, setting.declaredValue)
    note = redactValueInNote(note, setting.effectiveValue)
  }
  return {
    ...setting,
    declaredValue: setting.declaredValue === null ? null : MASKED_VALUE,
    effectiveValue: setting.effectiveValue === null ? null : MASKED_VALUE,
    note
  }
}

/** Defense in depth: sanitize secret-named entries in WSL settings. */
export function sanitizeWslSettings(wsl: WslConfigInfo): WslConfigInfo
export function sanitizeWslSettings(wsl: WslConfigInfo | null): WslConfigInfo | null
export function sanitizeWslSettings(wsl: WslConfigInfo | null): WslConfigInfo | null {
  if (wsl === null) return null
  return {
    ...wsl,
    settings: wsl.settings.map(sanitizeWslSetting)
  }
}

/** Defense in depth: sanitize secret fields on a dashboard snapshot before serialization/egress. */
export function sanitizeDashboard(dash: DashboardSnapshot): DashboardSnapshot {
  return {
    ...dash,
    environment: sanitizeEnvironment(dash.environment),
    wslSettings: sanitizeWslSettings(dash.wslSettings)
  }
}

/** Defense in depth: sanitize secret fields on a full snapshot before serialization/egress. */
export function sanitizeSnapshot(snapshot: WslPadSnapshot): WslPadSnapshot {
  if (snapshot.dashboard === null) return snapshot
  return {
    ...snapshot,
    dashboard: sanitizeDashboard(snapshot.dashboard)
  }
}
