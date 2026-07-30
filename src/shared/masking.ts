import { MASKED_VALUE, SECRET_NAME_PATTERNS } from './constants'

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
