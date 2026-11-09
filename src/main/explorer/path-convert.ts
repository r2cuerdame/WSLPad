import { DEFAULT_AUTOMOUNT_ROOT, normalizeAutomountRoot } from '@shared/path-boundary'
import { assertValidLinuxPath } from '../wsl/escape'

/**
 * Pure Linux ↔ Windows path mapping (goal.md §13). No filesystem access and no
 * guessing: Windows paths that cannot be mapped return null so callers fall
 * back to `wslpath` or fail explicitly.
 */

const WIN_DRIVE_RE = /^([A-Za-z]):([\\/].*)?$/
const WSL_UNC_RE = /^[\\/]{2}(wsl\.localhost|wsl\$)[\\/]([^\\/]+)([\\/].*)?$/i

export function convertLinuxToWindows(
  distro: string,
  linuxPath: string,
  automountRoot: string = DEFAULT_AUTOMOUNT_ROOT
): string {
  assertValidLinuxPath(linuxPath)
  const root = normalizeAutomountRoot(automountRoot)
  const drive = new RegExp(`^${escapeRegExp(root)}([A-Za-z])(/.*)?$`).exec(linuxPath)
  if (drive) {
    const rest = (drive[2] ?? '').replace(/\//g, '\\')
    return `${drive[1].toUpperCase()}:${rest || '\\'}`
  }
  return `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, '\\')}`
}

export function convertWindowsToLinux(
  distro: string,
  windowsPath: string,
  automountRoot: string = DEFAULT_AUTOMOUNT_ROOT
): string | null {
  if (windowsPath.includes('\0') || windowsPath.includes('\n')) return null
  const drive = WIN_DRIVE_RE.exec(windowsPath)
  if (drive) {
    const rest = (drive[2] ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '')
    return `${normalizeAutomountRoot(automountRoot)}${drive[1].toLowerCase()}${rest}`
  }
  const unc = WSL_UNC_RE.exec(windowsPath)
  if (unc) {
    if (unc[2].toLowerCase() !== distro.toLowerCase()) return null
    const rest = (unc[3] ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '')
    return rest || '/'
  }
  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function joinLinuxPath(dir: string, name: string): string {
  const base = dir.replace(/\/+$/, '')
  return `${base}/${name}`
}

export function parentLinuxPath(linuxPath: string): string {
  const trimmed = linuxPath.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx)
}

export function linuxBasename(linuxPath: string): string {
  const trimmed = linuxPath.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || '/'
}

export function windowsBasename(windowsPath: string): string {
  const trimmed = windowsPath.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return trimmed.slice(idx + 1)
}
