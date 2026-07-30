import { WINDOWS_ROOT } from '@shared/constants'
import type { ExplorerListOptions } from '@shared/ipc'
import type { FileEntry, FileStat, FsKind, TextFileContent } from '@shared/types'
import { i18n } from '../i18n'

// ---------------------------------------------------------------------------
// Linux path math
// ---------------------------------------------------------------------------

export function parentPath(path: string): string {
  if (path === '/') return '/'
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

export function baseName(path: string): string {
  if (path === '/') return '/'
  const idx = path.lastIndexOf('/')
  return idx < 0 ? path : path.slice(idx + 1)
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

/** Resolve a possibly-relative symlink target against the directory of the link. */
export function resolveLinuxPath(baseDir: string, target: string): string {
  const raw = target.startsWith('/') ? target : `${baseDir}/${target}`
  const out: string[] = []
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return `/${out.join('/')}`
}

/** POSIX single-quote for prepared commands — prepared only, never auto-run (goal.md §2.4). */
export function shQuote(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function normalizeLinuxPath(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/') || trimmed.includes('\0')) return null
  const collapsed = trimmed.replace(/\/{2,}/g, '/')
  return collapsed === '/' ? '/' : collapsed.replace(/\/+$/, '')
}

// ---------------------------------------------------------------------------
// Windows path math — WINDOWS_ROOT ("This PC") is the parent of every drive
// ---------------------------------------------------------------------------

export function isWindowsDriveRoot(path: string): boolean {
  return /^[A-Za-z]:\\$/.test(path)
}

export function windowsParent(path: string): string {
  if (path === WINDOWS_ROOT || isWindowsDriveRoot(path)) return WINDOWS_ROOT
  const unc = path.startsWith('\\\\')
  const body = unc ? path.slice(2) : path
  const idx = body.lastIndexOf('\\')
  if (idx < 0) return WINDOWS_ROOT
  const head = body.slice(0, idx)
  // \\server\share is the shallowest reachable UNC location.
  if (unc) return head.includes('\\') ? `\\\\${head}` : WINDOWS_ROOT
  return /^[A-Za-z]:$/.test(head) ? `${head}\\` : head
}

export function windowsBase(path: string): string {
  if (path === WINDOWS_ROOT) return WINDOWS_ROOT
  if (isWindowsDriveRoot(path)) return path.slice(0, 2)
  const idx = path.lastIndexOf('\\')
  return idx < 0 ? path : path.slice(idx + 1)
}

export function windowsJoin(dir: string, name: string): string {
  if (dir === WINDOWS_ROOT) return normalizeWindowsPath(name) ?? name
  return dir.endsWith('\\') ? `${dir}${name}` : `${dir}\\${name}`
}

export function normalizeWindowsPath(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.includes('\0')) return null
  if (trimmed.toLowerCase() === WINDOWS_ROOT.toLowerCase()) return WINDOWS_ROOT
  const unc = /^[\\/]{2}/.test(trimmed)
  let value = trimmed.replace(/\//g, '\\')
  if (unc) {
    value = `\\\\${value.slice(2).replace(/\\{2,}/g, '\\')}`
    if (!/^\\\\[^\\]+/.test(value)) return null
  } else {
    value = value.replace(/\\{2,}/g, '\\')
    if (/^[A-Za-z]:$/.test(value)) return `${value[0].toUpperCase()}:\\`
    if (!/^[A-Za-z]:\\/.test(value)) return null
    value = `${value[0].toUpperCase()}${value.slice(1)}`
  }
  return isWindowsDriveRoot(value) ? value : value.replace(/\\+$/, '')
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * One filesystem behind an Explorer pane. Both panes render the same UI, so
 * every path rule and IPC call a pane needs lives here (goal.md §7).
 */
export interface FsAdapter {
  kind: FsKind
  sep: '\\' | '/'
  rootPath: string
  join(dir: string, name: string): string
  parent(path: string): string
  base(path: string): string
  isRoot(path: string): boolean
  /** Validate + canonicalize typed input; null when it is not a path of this fs. */
  normalize(input: string): string | null
  /** Human-readable form — WINDOWS_ROOT renders as the localized "This PC". */
  displayPath(path: string): string
  home(): Promise<string>
  list(path: string, opts?: ExplorerListOptions): Promise<FileEntry[]>
  tree(path: string): Promise<FileEntry[]>
  stat(path: string): Promise<FileStat>
  mkdir(path: string): Promise<void>
  createFile(path: string): Promise<void>
  rename(path: string, newName: string): Promise<void>
  /** Copy (or move) inside this filesystem; resolves with the operation id. */
  copyMove(sources: string[], destDir: string, move: boolean): Promise<string>
  trash(paths: string[]): Promise<void>
  remove(paths: string[]): Promise<void>
  readText(path: string): Promise<TextFileContent>
  writeText(path: string, content: string): Promise<void>
  search(path: string, query: string): Promise<FileEntry[]>
  /** Hand the path over to Windows (Explorer / default application). */
  openNative(path: string): Promise<void>
  startDrag(paths: string[]): Promise<void>
}

export function createWindowsAdapter(): FsAdapter {
  return {
    kind: 'windows',
    sep: '\\',
    rootPath: WINDOWS_ROOT,
    join: windowsJoin,
    parent: windowsParent,
    base: windowsBase,
    isRoot: (path) => path === WINDOWS_ROOT,
    normalize: normalizeWindowsPath,
    displayPath: (path) => (path === WINDOWS_ROOT ? i18n.t('explorer.thisPc') : path),
    home: () => window.wslpad.windows.home(),
    list: (path, opts) => window.wslpad.windows.list(path, opts),
    tree: (path) => window.wslpad.windows.tree(path),
    stat: (path) => window.wslpad.windows.stat(path),
    mkdir: (path) => window.wslpad.windows.mkdir(path),
    createFile: (path) => window.wslpad.windows.createFile(path),
    rename: (path, newName) => window.wslpad.windows.rename(path, newName),
    copyMove: (sources, destDir, move) => window.wslpad.windows.copy(sources, destDir, move),
    trash: (paths) => window.wslpad.windows.trash(paths),
    remove: (paths) => window.wslpad.windows.remove(paths),
    readText: (path) => window.wslpad.windows.readText(path),
    writeText: (path, content) => window.wslpad.windows.writeText(path, content),
    search: (path, query) => window.wslpad.windows.search(path, query),
    openNative: (path) => window.wslpad.windows.openPath(path),
    startDrag: (paths) => window.wslpad.windows.startDrag(paths)
  }
}

/**
 * @param home distro HOME from the dashboard snapshot; '/' until it is known so
 *   the pane never guesses a wrong start location (goal.md §7.2).
 */
export function createLinuxAdapter(home?: string | null): FsAdapter {
  return {
    kind: 'linux',
    sep: '/',
    rootPath: '/',
    join: joinPath,
    parent: parentPath,
    base: baseName,
    isRoot: (path) => path === '/',
    normalize: normalizeLinuxPath,
    displayPath: (path) => path,
    home: () => Promise.resolve(home ?? '/'),
    list: (path, opts) => window.wslpad.explorer.list(path, opts),
    tree: (path) => window.wslpad.explorer.tree(path),
    stat: (path) => window.wslpad.explorer.stat(path),
    mkdir: (path) => window.wslpad.explorer.mkdir(path),
    createFile: (path) => window.wslpad.explorer.createFile(path),
    rename: (path, newName) => window.wslpad.explorer.rename(path, newName),
    copyMove: (sources, destDir, move) => window.wslpad.explorer.copy(sources, destDir, move),
    trash: (paths) => window.wslpad.explorer.trash(paths),
    remove: (paths) => window.wslpad.explorer.remove(paths),
    readText: (path) => window.wslpad.explorer.readText(path),
    writeText: (path, content) => window.wslpad.explorer.writeText(path, content),
    search: (path, query) => window.wslpad.explorer.search(path, query),
    openNative: (path) => window.wslpad.openInWindowsExplorer(path),
    startDrag: (paths) => window.wslpad.explorer.startDrag(paths)
  }
}
