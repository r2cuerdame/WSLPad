/**
 * Which side of the WSL filesystem boundary a path lives on.
 *
 * One module for the whole app so the Paths card, the Tools card, the Explorer
 * and the fixture world can never disagree about the same path: a binary under
 * /mnt/<drive> has to look like a Windows binary wherever it is reported.
 * A path that is absent or not absolute is 'unknown' rather than assumed to be
 * ext4 — guessing here would turn a Windows executable into a Linux one.
 *
 * Why it matters at all: work under /mnt/c crosses the 9P/DrvFs boundary and
 * runs up to ten times slower than the same work on ext4, with no error and no
 * warning anywhere (microsoft/WSL#4197). The reverse crossing —
 * \\wsl.localhost read from Windows — is just as quiet.
 */
import type { PathSide, WslSettingInfo } from './types'

/** WSL's own default for [automount] root. */
export const DEFAULT_AUTOMOUNT_ROOT = '/mnt/'

/** UNC hosts that reach into a distro from Windows; compared lower-cased. */
const WSL_UNC_HOSTS = ['wsl.localhost', 'wsl$']

/** `\\host\share…` or `//host/share…`, either separator, share optional. */
const UNC_RE = /^[\\/]{2}([^\\/]+)(?:[\\/]+([^\\/]+))?/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Make an [automount] root usable as a prefix: absolute, no duplicate
 * separators, exactly one trailing slash. An unusable value falls back to
 * WSL's default instead of to a prefix that would match nothing.
 */
export function normalizeAutomountRoot(root: string | null | undefined): string {
  if (typeof root !== 'string') return DEFAULT_AUTOMOUNT_ROOT
  const trimmed = root.trim()
  if (trimmed.length === 0 || !trimmed.startsWith('/')) return DEFAULT_AUTOMOUNT_ROOT
  const collapsed = trimmed.replace(/\/{2,}/g, '/')
  return collapsed.endsWith('/') ? collapsed : `${collapsed}/`
}

/**
 * The distro a Windows-side UNC path reaches into, e.g. 'Ubuntu-24.04' for
 * \\wsl.localhost\Ubuntu-24.04\home. null when the path is not a WSL share:
 * an ordinary \\server\share is somebody else's filesystem, not a boundary
 * WSLPad knows anything about.
 */
export function wslUncDistro(path: string): string | null {
  const match = UNC_RE.exec(path)
  if (match === null) return null
  if (!WSL_UNC_HOSTS.includes(match[1].toLowerCase())) return null
  return match[2] ?? null
}

/** True for a \\wsl.localhost / \\wsl$ location, with or without a share. */
function isWslUnc(path: string): boolean {
  const match = UNC_RE.exec(path)
  return match !== null && WSL_UNC_HOSTS.includes(match[1].toLowerCase())
}

/**
 * Which filesystem a path really lives on.
 *
 * @param automountRoot [automount] root from /etc/wsl.conf. A parameter and
 *   not a constant on purpose: a distro that sets `root=/` mounts C: at /c,
 *   and a classifier that hardcoded /mnt would call every one of those paths
 *   ext4 — a confident wrong answer about the exact thing being asked.
 *
 * A native Windows path such as C:\Users is 'unknown': the four sides say
 * where a path sits relative to the WSL boundary, and a plain drive letter
 * read from Windows sits on neither side of it.
 */
export function classifyPathSide(
  path: string | null | undefined,
  automountRoot?: string | null
): PathSide {
  if (typeof path !== 'string' || path.length === 0) return 'unknown'
  if (/^[\\/]{2}/.test(path)) return isWslUnc(path) ? 'unc' : 'unknown'
  if (!path.startsWith('/')) return 'unknown'
  const root = normalizeAutomountRoot(automountRoot)
  // Drive mounts are one letter under the root: /mnt/c, /mnt/c/Users.
  return new RegExp(`^${escapeRegExp(root)}[a-z](/|$)`, 'i').test(path)
    ? 'windows-mount'
    : 'ext4'
}

/**
 * Sides where a file operation crosses the boundary and pays for it. Callers
 * ask this instead of testing for 'ext4', so 'unknown' never quietly counts as
 * either fast or slow.
 */
export function isCrossBoundary(side: PathSide): boolean {
  return side === 'windows-mount' || side === 'unc'
}

/**
 * The automount root actually in force, read off the reconciled WSL settings.
 * The observed value wins over the declared one: a root the user declared but
 * WSL never applied would misclassify every path under the real mounts.
 */
export function automountRootFromSettings(
  settings: readonly WslSettingInfo[] | null | undefined
): string {
  const entry = settings?.find((s) => s.section === 'automount' && s.key.toLowerCase() === 'root')
  if (entry === undefined) return DEFAULT_AUTOMOUNT_ROOT
  return normalizeAutomountRoot(entry.effectiveValue ?? entry.declaredValue)
}
