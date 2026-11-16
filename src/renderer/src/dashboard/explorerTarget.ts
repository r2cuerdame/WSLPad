import { windowsPathFor } from '@shared/dev-env-context'
import { automountRootFromSettings, classifyPathSide } from '@shared/path-boundary'
import type { FsKind, WslConfigInfo } from '@shared/types'
import { normalizeWindowsPath, parentPath, windowsParent } from '../explorer/fsAdapter'

export interface ExplorerLocationTarget {
  path: string
  fs: FsKind
  selectPath?: string
}

/** Parent directory of a POSIX path, returning `'/'` at root. */
export const posixDirname = (path: string): string => parentPath(path.replace(/\\/g, '/'))

/**
 * Resolve a Dashboard path row into the target Explorer directory, pane
 * (`'windows'` or `'linux'`), and optional visible entry to select.
 * Windows-mount paths respect `[automount] root` from WSL settings and fall
 * back cleanly to the `'linux'` pane directory if Windows conversion yields `null`.
 */
export function resolveDashboardExplorerTarget(
  rawPath: string,
  opts: { isDir: boolean; settings?: WslConfigInfo | null; forceLinux?: boolean }
): ExplorerLocationTarget {
  if (!opts.forceLinux && (/^[A-Za-z]:(?:[\\/]|$)/.test(rawPath) || /^[\\/]{2}/.test(rawPath))) {
    const winNorm = normalizeWindowsPath(rawPath) ?? rawPath
    if (opts.isDir) return { path: winNorm, fs: 'windows' }
    return { path: windowsParent(winNorm), fs: 'windows', selectPath: winNorm }
  }

  const normalizedPosix = rawPath.replace(/\\/g, '/')
  const dirPosix = opts.isDir ? normalizedPosix : posixDirname(normalizedPosix)

  if (!opts.forceLinux) {
    const automountRoot = automountRootFromSettings(opts.settings?.settings)
    if (classifyPathSide(dirPosix, automountRoot) === 'windows-mount') {
      const winDir = windowsPathFor(dirPosix, null, automountRoot)
      if (winDir !== null) {
        if (opts.isDir) return { path: winDir, fs: 'windows' }
        const winSelect = windowsPathFor(normalizedPosix, null, automountRoot) ?? undefined
        return winSelect === undefined
          ? { path: winDir, fs: 'windows' }
          : { path: winDir, fs: 'windows', selectPath: winSelect }
      }
    }
  }

  return opts.isDir
    ? { path: dirPosix, fs: 'linux' }
    : { path: dirPosix, fs: 'linux', selectPath: normalizedPosix }
}
