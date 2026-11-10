/**
 * Windows-side filesystem for the left Explorer pane (goal.md §7).
 *
 * Node fs only, path.win32 semantics. WINDOWS_ROOT is the "This PC" sentinel:
 * listing it yields one entry per drive instead of a directory listing.
 * Electron is imported lazily inside places()/trash() so this module stays
 * loadable (and unit-testable) outside an Electron runtime.
 */
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { constants as FS } from 'fs'
import {
  access,
  cp,
  opendir,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from 'fs/promises'
import { homedir } from 'os'
import { win32 as win } from 'path'
import { WINDOWS_ROOT } from '@shared/constants'
import type {
  FileEntry,
  FileEntryType,
  DirSizeEntry,
  DirSizeResult,
  FileOpKind,
  FileOpProgress,
  FileOpStatus,
  FileStat,
  TextFileContent,
  WindowsPlace
} from '@shared/types'
import { ExplorerError, type ExplorerErrorCode, type ExplorerListOpts } from '../wsl/contracts'

const BINARY_SNIFF_BYTES = 8000
const HIDDEN_CACHE_MS = 2000
const HIDDEN_CACHE_MAX_DIRS = 64
const HIDDEN_QUERY_TIMEOUT_MS = 5000
const HIDDEN_QUERY_MAX_BYTES = 8 * 1024 * 1024
const SEARCH_MAX_DEPTH = 4
const SEARCH_MAX_RESULTS = 200
const DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Known Windows folders surfaced as quick-access places. */
type KnownFolder = 'home' | 'desktop' | 'documents' | 'downloads'

const FOLDER_PLACES: ReadonlyArray<{ id: string; folder: KnownFolder }> = [
  { id: 'profile', folder: 'home' },
  { id: 'desktop', folder: 'desktop' },
  { id: 'documents', folder: 'documents' },
  { id: 'downloads', folder: 'downloads' }
]

/** Injection seam for tests: without it the electron module is loaded lazily. */
export interface WindowsFsDeps {
  getPath?: (name: KnownFolder) => string
  trashItem?: (path: string) => Promise<void>
}

export interface WindowsFs {
  places(): Promise<WindowsPlace[]>
  home(): Promise<string>
  list(path: string, opts?: ExplorerListOpts): Promise<FileEntry[]>
  /** Immediate subdirectories only (lazy folder tree, goal.md §15). */
  tree(path: string): Promise<FileEntry[]>
  stat(path: string): Promise<FileStat>
  mkdir(path: string): Promise<void>
  createFile(path: string): Promise<void>
  rename(path: string, newName: string): Promise<void>
  /** Returns opId; progress arrives through onProgress. */
  copyMove(sources: string[], destDir: string, move: boolean): Promise<string>
  trash(paths: string[]): Promise<void>
  remove(paths: string[]): Promise<void>
  readText(path: string, maxBytes: number): Promise<TextFileContent>
  writeText(path: string, content: string): Promise<void>
  search(path: string, query: string): Promise<FileEntry[]>
  dirSizes(path: string, token: string): Promise<DirSizeResult>
  cancelDirSizes(token: string): Promise<void>
  cancelOp(opId: string): Promise<void>
  onProgress(cb: (p: FileOpProgress) => void): () => void
  dispose(): void
}

// ---------------------------------------------------------------------------
// Errors — mapped so the renderer's parseExplorerError keeps working (§14)
// ---------------------------------------------------------------------------

const ERRNO_MAP: Record<string, ExplorerErrorCode> = {
  EACCES: 'EACCES',
  // Windows reports both denied ACLs and locked/read-only files this way.
  EPERM: 'EACCES',
  EBUSY: 'EACCES',
  ENOENT: 'ENOENT',
  EEXIST: 'EEXIST',
  EISDIR: 'EISDIR',
  ENOTDIR: 'ENOTDIR'
}

export function toExplorerError(path: string, err: unknown): ExplorerError {
  if (err instanceof ExplorerError) return err
  const errno = (err as NodeJS.ErrnoException | undefined)?.code
  const code: ExplorerErrorCode = (errno ? ERRNO_MAP[errno] : undefined) ?? 'UNKNOWN'
  return new ExplorerError(code, path, `${code}: ${path}`, {
    stderr: err instanceof Error ? err.message : undefined
  })
}

// ---------------------------------------------------------------------------
// Path helpers (path.win32 semantics only)
// ---------------------------------------------------------------------------

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/** Validate + normalize a real Windows path; WINDOWS_ROOT is rejected here. */
function normalizePath(path: string): string {
  if (path.includes('\0') || path.includes('\n') || !isWindowsPath(path)) {
    throw new ExplorerError('UNKNOWN', path, `Not a Windows path: ${JSON.stringify(path)}`)
  }
  const normalized = win.normalize(path)
  const root = win.parse(normalized).root
  return normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized
}

function isDriveRoot(path: string): boolean {
  return win.parse(path).root.length === path.length
}

function sameVolume(a: string, b: string): boolean {
  return win.parse(a).root.toLowerCase() === win.parse(b).root.toLowerCase()
}

/** Windows compares paths case-insensitively, so containment checks must too. */
function isInside(child: string, parent: string): boolean {
  const c = child.toLowerCase()
  const p = parent.toLowerCase()
  return c === p || c.startsWith(p.endsWith('\\') ? p : p + '\\')
}

function isValidFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !/[/\\\0\n]/.test(name) &&
    name !== '.' &&
    name !== '..'
  )
}

function toIso(date: Date): string | null {
  const ms = date.getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

async function exists(path: string): Promise<boolean> {
  try {
    // lstat, not stat: a broken symlink still occupies the name (mirrors `-e || -L`).
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function canWrite(path: string): Promise<boolean> {
  try {
    await access(path, FS.W_OK)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// FILE_ATTRIBUTE_HIDDEN — Node cannot read it, so one `dir /a:h` per listing
// ---------------------------------------------------------------------------

/**
 * `%` and `!` would be expanded by cmd even inside quotes and `"` would break
 * out of them; such directories simply fall back to the dot rule.
 */
const HIDDEN_QUERY_UNSAFE_RE = /["%!]/

function queryHiddenNames(dir: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || HIDDEN_QUERY_UNSAFE_RE.test(dir)) {
      resolve(new Set())
      return
    }
    execFile(
      'cmd.exe',
      // /s keeps the inner quotes intact after cmd strips the outer pair.
      ['/d', '/s', '/c', `"chcp 65001 >nul & dir /a:h /b "${dir}""`],
      {
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: HIDDEN_QUERY_TIMEOUT_MS,
        maxBuffer: HIDDEN_QUERY_MAX_BYTES,
        encoding: 'utf8'
      },
      (err, stdout) => {
        // `dir` exits non-zero when nothing is hidden — an empty set either way.
        if (err) {
          resolve(new Set())
          return
        }
        const names = new Set<string>()
        for (const line of stdout.split(/\r?\n/)) {
          const name = line.trim()
          if (name) names.add(name.toLowerCase())
        }
        resolve(names)
      }
    )
  })
}

// ---------------------------------------------------------------------------
// Entry mapping — Windows has no POSIX mode, so owner/group/permissions stay null
// ---------------------------------------------------------------------------

const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>()

async function describeChild(
  dir: string,
  name: string,
  hidden: ReadonlySet<string>
): Promise<FileEntry> {
  const full = win.join(dir, name)
  let type: FileEntryType = 'other'
  let sizeBytes: number | null = null
  let mtime: string | null = null
  let symlinkTarget: string | null = null
  let targetType: 'file' | 'directory' | null = null
  try {
    const st = await lstat(full)
    if (st.isSymbolicLink()) {
      type = 'symlink'
      try {
        symlinkTarget = await readlink(full)
      } catch {
        // junction without a readable reparse target — target stays unknown
      }
      try {
        const target = await stat(full)
        targetType = target.isDirectory() ? 'directory' : target.isFile() ? 'file' : null
      } catch {
        // broken link: resolving it is not worth a second syscall round
      }
    } else if (st.isDirectory()) {
      type = 'directory'
    } else if (st.isFile()) {
      type = 'file'
    }
    sizeBytes = type === 'directory' ? null : st.size
    mtime = toIso(st.mtime)
  } catch {
    // Unreadable children still appear in the listing, exactly like `find`.
  }
  return {
    name,
    path: full,
    type,
    sizeBytes,
    mtime,
    owner: null,
    group: null,
    permissions: null,
    permissionsOctal: null,
    isHidden: name.startsWith('.') || hidden.has(name.toLowerCase()),
    symlinkTarget,
    targetType
  }
}

function driveEntry(letter: string, mtime: string | null): FileEntry {
  return {
    name: `${letter}:`,
    path: `${letter}:\\`,
    type: 'directory',
    sizeBytes: null,
    mtime,
    owner: null,
    group: null,
    permissions: null,
    permissionsOctal: null,
    isHidden: false,
    symlinkTarget: null,
    targetType: null
  }
}

function thisPcStat(): FileStat {
  return {
    name: WINDOWS_ROOT,
    path: WINDOWS_ROOT,
    type: 'directory',
    sizeBytes: null,
    mtime: null,
    owner: null,
    group: null,
    permissions: null,
    permissionsOctal: null,
    isHidden: false,
    symlinkTarget: null,
    targetType: null,
    inode: null,
    atime: null,
    windowsPath: null
  }
}

async function presentDrives(): Promise<string[]> {
  const letters: string[] = []
  for (const letter of DRIVE_LETTERS) {
    try {
      await access(`${letter}:\\`)
      letters.push(letter)
    } catch {
      // letter not mounted, or removable drive with no media
    }
  }
  return letters
}

// ---------------------------------------------------------------------------

export function createWindowsFs(deps: WindowsFsDeps = {}): WindowsFs {
  const emitter = new EventEmitter()
  const ops = new Map<string, { cancelled: boolean }>()
  const sizeOps = new Map<string, { cancelled: boolean }>()
  const hiddenCache = new Map<string, { at: number; names: Set<string> }>()
  let disposed = false

  const hiddenFor = async (dir: string): Promise<ReadonlySet<string>> => {
    const key = dir.toLowerCase()
    const now = Date.now()
    const cached = hiddenCache.get(key)
    if (cached && now - cached.at < HIDDEN_CACHE_MS) return cached.names
    const names = await queryHiddenNames(dir)
    if (hiddenCache.size >= HIDDEN_CACHE_MAX_DIRS) hiddenCache.clear()
    hiddenCache.set(key, { at: now, names })
    return names
  }

  const knownFolder = async (folder: KnownFolder): Promise<string | null> => {
    if (deps.getPath) {
      try {
        return deps.getPath(folder)
      } catch {
        return null
      }
    }
    try {
      const { app } = await import('electron')
      return app.getPath(folder)
    } catch {
      return null
    }
  }

  const readDirectory = async (dir: string): Promise<FileEntry[]> => {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (err) {
      throw toExplorerError(dir, err)
    }
    const hidden = await hiddenFor(dir)
    const entries: FileEntry[] = []
    for (const name of names) entries.push(await describeChild(dir, name, hidden))
    return entries
  }

  const driveEntries = async (): Promise<FileEntry[]> => {
    const entries: FileEntry[] = []
    for (const letter of await presentDrives()) {
      let mtime: string | null = null
      try {
        mtime = toIso((await stat(`${letter}:\\`)).mtime)
      } catch {
        // volume roots may refuse stat (empty removable media) — mtime unknown
      }
      entries.push(driveEntry(letter, mtime))
    }
    return entries
  }

  const emitProgress = (p: FileOpProgress): void => {
    emitter.emit('progress', p)
  }

  const startOp = (
    kind: FileOpKind,
    run: (opId: string, isCancelled: () => boolean) => Promise<void>
  ): string => {
    const opId = randomUUID()
    ops.set(opId, { cancelled: false })
    const isCancelled = () => disposed || (ops.get(opId)?.cancelled ?? false)
    void run(opId, isCancelled)
      .catch((err: unknown) => {
        emitProgress({
          opId,
          kind,
          status: 'error',
          totalItems: null,
          doneItems: null,
          totalBytes: null,
          doneBytes: null,
          currentItem: null,
          error: err instanceof Error ? err.message : String(err)
        })
      })
      .finally(() => {
        ops.delete(opId)
      })
    return opId
  }

  /** Byte size only when it costs a single lstat — directories are not walked. */
  const cheapSize = async (path: string): Promise<number | null> => {
    try {
      const st = await lstat(path)
      return st.isDirectory() ? null : st.size
    } catch {
      return null
    }
  }

  const runCopyMove = async (
    opId: string,
    sources: string[],
    destDir: string,
    move: boolean,
    isCancelled: () => boolean
  ): Promise<void> => {
    const kind: FileOpKind = move ? 'move' : 'copy'
    const totalItems = sources.length
    let doneItems = 0
    let totalBytes = 0
    let doneBytes = 0
    const errors: string[] = []
    const emit = (status: FileOpStatus, currentItem: string | null, error: string | null = null) =>
      emitProgress({
        opId,
        kind,
        status,
        totalItems,
        doneItems,
        totalBytes,
        doneBytes,
        currentItem,
        error
      })
    for (const source of sources) {
      if (isCancelled()) {
        emit('cancelled', null)
        return
      }
      emit('running', source)
      try {
        const dest = win.join(destDir, win.basename(source))
        // Never overwrite silently: the renderer confirms and retries (§7.5).
        if (await exists(dest)) {
          throw new ExplorerError('EEXIST', dest, `EEXIST: ${dest}`)
        }
        const size = await cheapSize(source)
        if (size !== null) {
          totalBytes += size
          emit('running', source)
        }
        if (move && sameVolume(source, destDir)) {
          await rename(source, dest)
        } else {
          await cp(source, dest, {
            recursive: true,
            force: false,
            errorOnExist: true,
            preserveTimestamps: true
          })
          if (move) await rm(source, { recursive: true, force: true })
        }
        if (size !== null) doneBytes += size
      } catch (err) {
        errors.push(toExplorerError(source, err).message)
      }
      doneItems++
      emit('running', source)
    }
    emit(errors.length > 0 ? 'error' : 'done', null, errors.length > 0 ? errors.join('; ') : null)
  }

  const dirSizes = async (path: string, token: string): Promise<DirSizeResult> => {
    const root = normalizePath(path)
    const op = { cancelled: false }
    sizeOps.set(token, op)
    const result: DirSizeResult = {
      path: root,
      entries: [],
      totalBytes: 0,
      skipped: 0,
      cancelled: false,
      error: null
    }
    const children = new Map<string, DirSizeEntry>()
    let sinceYield = 0
    const yieldToLoop = async (): Promise<void> => {
      if (++sinceYield >= 64) {
        sinceYield = 0
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    const walk = async (dir: string, owner: string): Promise<void> => {
      if (op.cancelled || disposed) return
      let handle: Awaited<ReturnType<typeof opendir>>
      try {
        handle = await opendir(dir)
      } catch (err) {
        if (owner === root) throw err
        const entry = children.get(owner)
        if (entry) entry.partial = true
        return
      }
      try {
        for await (const item of handle) {
          if (op.cancelled || disposed) return
          await yieldToLoop()
          if (op.cancelled || disposed) return
          const full = win.join(dir, item.name)
          try {
            // Dirent directory checks avoid following symlinks and NTFS junctions.
            if (item.isDirectory()) {
              const st = await lstat(full)
              if (st.isDirectory() && !st.isSymbolicLink()) {
                const child = children.get(owner)
                if (child) child.sizeBytes = (child.sizeBytes ?? 0) + st.size
                await walk(full, owner)
              }
            } else if (item.isFile()) {
              const st = await lstat(full)
              if (st.isFile()) {
                const child = children.get(owner)
                if (child) child.sizeBytes = (child.sizeBytes ?? 0) + st.size
              }
            }
          } catch (err) {
            const child = children.get(owner)
            if (child) child.partial = true
            const code = (err as NodeJS.ErrnoException).code
            if (code !== 'ENOENT' && code !== 'EACCES' && code !== 'EPERM') throw err
          }
        }
      } catch (err) {
        const child = children.get(owner)
        if (child) child.partial = true
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'EACCES' && code !== 'EPERM') throw err
      } finally {
        await handle.close().catch(() => undefined)
      }
    }
    try {
      const rootStat = await lstat(root)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new ExplorerError('ENOTDIR', root, `ENOTDIR: ${root}`)
      }
      let handle: Awaited<ReturnType<typeof opendir>>
      try {
        handle = await opendir(root)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM') {
          result.totalBytes = null
          result.error = toExplorerError(root, err).message
          return result
        }
        throw err
      }
      try {
        for await (const item of handle) {
          if (op.cancelled || disposed) break
          await yieldToLoop()
          if (op.cancelled || disposed) break
          const full = win.join(root, item.name)
          try {
            const st = await lstat(full)
            if (st.isSymbolicLink()) continue
            const isDirectory = st.isDirectory()
            if (!isDirectory && !st.isFile()) continue
            children.set(full, {
              name: item.name,
              path: full,
              isDirectory,
              sizeBytes: isDirectory ? 0 : st.size,
              partial: false
            })
            if (isDirectory) await walk(full, full)
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            if (code === 'EACCES' || code === 'EPERM') {
              children.set(full, { name: item.name, path: full, isDirectory: item.isDirectory(), sizeBytes: 0, partial: true })
            } else if (code !== 'ENOENT') throw err
          }
        }
      } finally {
        await handle.close().catch(() => undefined)
      }
      const entries = [...children.values()].sort((a, b) =>
        a.sizeBytes === b.sizeBytes ? a.name.localeCompare(b.name) : (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
      )
      result.entries = entries
      result.totalBytes = entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0)
      result.cancelled = op.cancelled || disposed
      return result
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        result.totalBytes = null
        result.error = toExplorerError(root, err).message
        return result
      }
      throw toExplorerError(root, err)
    } finally {
      sizeOps.delete(token)
    }
  }

  const trashOne = async (path: string): Promise<void> => {
    if (deps.trashItem) {
      await deps.trashItem(path)
      return
    }
    const { shell } = await import('electron')
    await shell.trashItem(path)
  }

  const statEntry = async (path: string): Promise<FileStat> => {
    const name = win.basename(path) || path
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(path)
    } catch (err) {
      throw toExplorerError(path, err)
    }
    let type: FileEntryType = 'other'
    let symlinkTarget: string | null = null
    let targetType: 'file' | 'directory' | null = null
    if (st.isSymbolicLink()) {
      type = 'symlink'
      try {
        symlinkTarget = await readlink(path)
      } catch {
        // reparse point we cannot read — target stays unknown
      }
      try {
        const target = await stat(path)
        targetType = target.isDirectory() ? 'directory' : target.isFile() ? 'file' : null
      } catch {
        // broken link
      }
    } else if (st.isDirectory()) {
      type = 'directory'
    } else if (st.isFile()) {
      type = 'file'
    }
    const hidden = isDriveRoot(path) ? EMPTY_HIDDEN : await hiddenFor(win.dirname(path))
    return {
      name,
      path,
      type,
      sizeBytes: type === 'directory' ? null : st.size,
      mtime: toIso(st.mtime),
      owner: null,
      group: null,
      permissions: null,
      permissionsOctal: null,
      isHidden: name.startsWith('.') || hidden.has(name.toLowerCase()),
      symlinkTarget,
      targetType,
      inode: Number.isFinite(st.ino) && st.ino > 0 ? st.ino : null,
      atime: toIso(st.atime),
      windowsPath: path
    }
  }

  return {
    places: async () => {
      const out: WindowsPlace[] = []
      for (const letter of await presentDrives()) {
        const root = `${letter}:\\`
        let totalBytes: number | null = null
        let freeBytes: number | null = null
        try {
          const info = await statfs(root)
          const blockSize = Number(info.bsize)
          totalBytes = Number(info.blocks) * blockSize
          freeBytes = Number(info.bavail) * blockSize
        } catch {
          // network/removable volumes may not report sizes — shown as unknown
        }
        out.push({
          id: `drive-${letter}`,
          // Drive letters and folder names are shown verbatim, never translated.
          label: `${letter}:`,
          path: root,
          kind: 'drive',
          totalBytes,
          freeBytes
        })
      }
      for (const place of FOLDER_PLACES) {
        const path = await knownFolder(place.folder)
        if (!path || !isWindowsPath(path)) continue
        if (!(await exists(path))) continue
        out.push({
          id: place.id,
          label: win.basename(path) || path,
          path,
          kind: 'folder',
          totalBytes: null,
          freeBytes: null
        })
      }
      return out
    },

    home: async () => (deps.getPath ? deps.getPath('home') : homedir()),

    list: async (path, opts?: ExplorerListOpts) => {
      if (path === WINDOWS_ROOT) return driveEntries()
      const entries = await readDirectory(normalizePath(path))
      // Mirrors the Linux pane: the option defaults to showing everything and
      // only an explicit `false` filters hidden entries out.
      return (opts?.showHidden ?? true) ? entries : entries.filter((e) => !e.isHidden)
    },

    tree: async (path) => {
      if (path === WINDOWS_ROOT) return driveEntries()
      const entries = await readDirectory(normalizePath(path))
      return entries.filter((e) => e.type === 'directory' || (e.type === 'symlink' && e.targetType === 'directory'))
    },

    stat: async (path) => (path === WINDOWS_ROOT ? thisPcStat() : statEntry(normalizePath(path))),

    mkdir: async (path) => {
      const p = normalizePath(path)
      if (await exists(p)) throw new ExplorerError('EEXIST', p, `EEXIST: ${p}`)
      try {
        await mkdir(p, { recursive: true })
      } catch (err) {
        throw toExplorerError(p, err)
      }
    },

    createFile: async (path) => {
      const p = normalizePath(path)
      try {
        const handle = await open(p, 'wx')
        await handle.close()
      } catch (err) {
        throw toExplorerError(p, err)
      }
    },

    rename: async (path, newName) => {
      const p = normalizePath(path)
      if (!isValidFileName(newName)) {
        throw new ExplorerError('UNKNOWN', p, `Invalid file name: ${JSON.stringify(newName)}`)
      }
      const target = win.join(win.dirname(p), newName)
      if (target.toLowerCase() !== p.toLowerCase() && (await exists(target))) {
        throw new ExplorerError('EEXIST', target, `EEXIST: ${target}`)
      }
      try {
        await rename(p, target)
      } catch (err) {
        throw toExplorerError(p, err)
      }
    },

    copyMove: async (sources, destDir, move) => {
      const dest = normalizePath(destDir)
      const srcs = sources.map(normalizePath)
      try {
        const destStat = await stat(dest)
        if (!destStat.isDirectory()) {
          throw new ExplorerError('ENOTDIR', dest, `ENOTDIR: ${dest}`)
        }
      } catch (err) {
        throw toExplorerError(dest, err)
      }
      for (const source of srcs) {
        if (isInside(dest, source)) {
          throw new ExplorerError('UNKNOWN', source, `Cannot copy ${source} into itself`)
        }
      }
      return startOp(move ? 'move' : 'copy', (opId, isCancelled) =>
        runCopyMove(opId, srcs, dest, move, isCancelled)
      )
    },

    trash: async (paths) => {
      for (const path of paths) {
        const p = normalizePath(path)
        try {
          await trashOne(p)
        } catch (err) {
          throw toExplorerError(p, err)
        }
      }
    },

    remove: async (paths) => {
      for (const path of paths) {
        const p = normalizePath(path)
        if (isDriveRoot(p)) throw new ExplorerError('UNKNOWN', p, `Refusing to remove ${p}`)
        try {
          await rm(p, { recursive: true, force: true })
        } catch (err) {
          throw toExplorerError(p, err)
        }
      }
    },

    readText: async (path, maxBytes) => {
      const p = normalizePath(path)
      let sizeBytes: number
      try {
        const st = await stat(p)
        if (st.isDirectory()) throw new ExplorerError('EISDIR', p, `EISDIR: ${p}`)
        sizeBytes = st.size
      } catch (err) {
        throw toExplorerError(p, err)
      }
      const wanted = Math.max(0, Math.min(sizeBytes, maxBytes))
      let buf = Buffer.alloc(0)
      try {
        const handle = await open(p, 'r')
        try {
          if (wanted > 0) {
            const target = Buffer.alloc(wanted)
            const { bytesRead } = await handle.read(target, 0, wanted, 0)
            buf = target.subarray(0, bytesRead)
          }
        } finally {
          await handle.close()
        }
      } catch (err) {
        throw toExplorerError(p, err)
      }
      if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        throw new ExplorerError('BINARY', p, `Not a text file: ${p}`)
      }
      let content: string
      let encoding: TextFileContent['encoding'] = 'utf-8'
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      } catch {
        content = buf.toString('latin1')
        encoding = 'latin1'
      }
      return {
        content,
        encoding,
        truncated: sizeBytes > maxBytes,
        sizeBytes,
        writable: await canWrite(p)
      }
    },

    writeText: async (path, content) => {
      const p = normalizePath(path)
      let link: Awaited<ReturnType<typeof lstat>> | null = null
      try {
        link = await lstat(p)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw toExplorerError(p, err)
      }
      // Swapping the temp file in over a symlink would replace the link with a
      // plain file and leave its target stale, so a link is written through to
      // the file it resolves to — the Linux pane's `readlink -f`. A broken link
      // has no such file: ENOENT, never a target created behind the user's back.
      let target = p
      if (link) {
        let st = link
        try {
          if (link.isSymbolicLink()) {
            target = await realpath(p)
            st = await stat(target)
          }
        } catch (err) {
          throw toExplorerError(p, err)
        }
        // lstat calls a directory link or junction a link, never a directory.
        if (st.isDirectory()) throw new ExplorerError('EISDIR', p, `EISDIR: ${p}`)
        if (!(await canWrite(target))) throw new ExplorerError('EACCES', p, `EACCES: ${p}`)
      } else if (!(await canWrite(win.dirname(p)))) {
        throw new ExplorerError('EACCES', p, `EACCES: ${p}`)
      }
      // Write beside the target and swap it in, so a failure never leaves the
      // destination partially written (goal.md §7.6). ACL denials only show up
      // here, as EPERM, because access(W_OK) on Windows sees only the read-only bit.
      const temp = win.join(win.dirname(target), `.wslpad-${randomUUID()}.tmp`)
      try {
        await writeFile(temp, content, 'utf8')
        await rename(temp, target)
      } catch (err) {
        await rm(temp, { force: true }).catch(() => undefined)
        throw toExplorerError(p, err)
      }
    },

    search: async (path, query) => {
      const needle = query.trim().toLowerCase()
      // "This PC" is not a directory: there is nothing to walk from there.
      if (!needle || path === WINDOWS_ROOT) return []
      const root = normalizePath(path)
      const results: FileEntry[] = []
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (results.length >= SEARCH_MAX_RESULTS) return
        let names: string[]
        try {
          names = await readdir(dir)
        } catch {
          // unreadable directories are skipped silently
          return
        }
        for (const name of names) {
          if (results.length >= SEARCH_MAX_RESULTS) return
          if (name.toLowerCase().includes(needle)) {
            // A `dir /a:h` per visited directory would dominate the walk cost,
            // so search results fall back to the dot rule for isHidden.
            results.push(await describeChild(dir, name, EMPTY_HIDDEN))
          }
          if (depth >= SEARCH_MAX_DEPTH) continue
          const full = win.join(dir, name)
          try {
            if ((await lstat(full)).isDirectory()) await walk(full, depth + 1)
          } catch {
            // vanished or unreadable between readdir and lstat
          }
        }
      }
      await walk(root, 1)
      return results
    },

    dirSizes,

    cancelDirSizes: async (token) => {
      const op = sizeOps.get(token)
      if (op) op.cancelled = true
    },

    cancelOp: async (opId) => {
      const op = ops.get(opId)
      if (op) op.cancelled = true
    },

    onProgress: (cb) => {
      emitter.on('progress', cb)
      return () => {
        emitter.off('progress', cb)
      }
    },

    dispose: () => {
      disposed = true
      for (const op of ops.values()) op.cancelled = true
      for (const op of sizeOps.values()) op.cancelled = true
      hiddenCache.clear()
      emitter.removeAllListeners()
    }
  }
}
