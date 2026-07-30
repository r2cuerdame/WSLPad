import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry } from '@shared/types'
import { fileNameSchema } from '@shared/schemas'
import { useApp } from '../store'

export type SortKey = 'name' | 'type' | 'size' | 'mtime' | 'owner' | 'group' | 'permissions'
export type SortDir = 'asc' | 'desc'

export interface ClipboardState {
  paths: string[]
  cut: boolean
}

export interface ExplorerErrorInfo {
  code: string
  path: string | null
  message: string
  detail: {
    stderr?: string
    owner?: string | null
    permissions?: string | null
    user?: string | null
  }
}

/** Sort a listing: directories always group before everything else (goal.md §7.3). */
export function sortEntries(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  const byName = (a: FileEntry, b: FileEntry): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  const cmp = (a: FileEntry, b: FileEntry): number => {
    switch (key) {
      case 'name':
        return byName(a, b)
      case 'type':
        return a.type.localeCompare(b.type) || byName(a, b)
      case 'size':
        return (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1) || byName(a, b)
      case 'mtime':
        return (a.mtime ?? '').localeCompare(b.mtime ?? '') || byName(a, b)
      case 'owner':
        return (a.owner ?? '').localeCompare(b.owner ?? '') || byName(a, b)
      case 'group':
        return (a.group ?? '').localeCompare(b.group ?? '') || byName(a, b)
      case 'permissions':
        return (a.permissions ?? '').localeCompare(b.permissions ?? '') || byName(a, b)
    }
  }
  const rank = (e: FileEntry): number => (e.type === 'directory' ? 0 : 1)
  return [...entries].sort((a, b) => rank(a) - rank(b) || sign * cmp(a, b))
}

export function formatBytes(bytes: number | null, locale: string): string {
  if (bytes === null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 })
  return `${nf.format(value)} ${units[unit]}`
}

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** POSIX single-quote for prepared commands — prepared only, never auto-run (goal.md §2.4). */
export function shQuote(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replace(/'/g, `'\\''`)}'`
}

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

/**
 * Recover the structured ExplorerError payload from an IPC rejection.
 * ipcRenderer.invoke flattens rejections into Error messages, so the main
 * process serializes payloads as JSON inside the message.
 */
export function parseExplorerError(err: unknown): ExplorerErrorInfo {
  const raw = err as {
    code?: unknown
    path?: unknown
    message?: unknown
    detail?: ExplorerErrorInfo['detail']
  }
  if (typeof raw?.code === 'string') {
    return {
      code: raw.code,
      path: typeof raw.path === 'string' ? raw.path : null,
      message: typeof raw.message === 'string' ? raw.message : raw.code,
      detail: raw.detail ?? {}
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  const start = message.indexOf('{')
  if (start >= 0) {
    try {
      const parsed = JSON.parse(message.slice(start)) as {
        explorerError?: boolean
        code?: string
        path?: string
        message?: string
        detail?: ExplorerErrorInfo['detail']
      }
      if (parsed && typeof parsed.code === 'string') {
        return {
          code: parsed.code,
          path: parsed.path ?? null,
          message: parsed.message ?? parsed.code,
          detail: parsed.detail ?? {}
        }
      }
    } catch {
      /* not a JSON payload */
    }
  }
  return { code: 'UNKNOWN', path: null, message, detail: {} }
}

/** Best-effort Windows paths from a DataTransfer drop (Electron File.path when exposed). */
export function extractWindowsPaths(files: FileList): string[] {
  const out: string[] = []
  for (const file of Array.from(files)) {
    const p = (file as File & { path?: string }).path
    if (typeof p === 'string' && p.length > 0) out.push(p)
  }
  return out
}

export interface ExplorerApi {
  distro: string | null
  home: string
  path: string | null
  entries: FileEntry[]
  visibleEntries: FileEntry[]
  loading: boolean
  error: string | null
  canBack: boolean
  canForward: boolean
  showHidden: boolean
  sortKey: SortKey
  sortDir: SortDir
  selection: Set<string>
  clipboard: ClipboardState | null
  searchQuery: string
  searchResults: FileEntry[] | null
  refreshToken: number
  navigate: (path: string) => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  goUp: () => Promise<void>
  goHome: () => Promise<void>
  goRoot: () => Promise<void>
  refreshDir: () => Promise<void>
  toggleHidden: () => Promise<void>
  setSort: (key: SortKey) => void
  setSelection: (selection: Set<string>) => void
  copySelection: (cut: boolean) => void
  paste: (destDir?: string) => Promise<void>
  dropPaths: (paths: string[], destDir: string, move: boolean) => Promise<void>
  runSearch: (query: string) => Promise<void>
  clearSearch: () => void
  rename: (path: string, newName: string) => Promise<void>
  createEntry: (kind: 'file' | 'folder', name: string) => Promise<void>
  trashPaths: (paths: string[]) => Promise<void>
  deletePaths: (paths: string[]) => Promise<void>
  importPicked: () => Promise<void>
  importWindows: (windowsPaths: string[], destDir: string) => Promise<void>
  exportSelected: (paths: string[]) => Promise<void>
}

/** Single owner of all Explorer tab state (goal.md §7). */
export function useExplorer(): ExplorerApi {
  const {
    snapshot,
    settings,
    pushToast,
    setConsolePath,
    explorerNavigateRequest,
    consumeExplorerNavigate
  } = useApp()
  const { t } = useTranslation()

  const distro = snapshot?.selectedDistro ?? null
  const home = snapshot?.dashboard?.system.home ?? '/'
  const homeKnown = snapshot?.dashboard?.system.home != null

  const [path, setPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backStack, setBackStack] = useState<string[]>([])
  const [forwardStack, setForwardStack] = useState<string[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const pathRef = useRef<string | null>(null)
  const showHiddenRef = useRef(false)
  const settingsLoadedRef = useRef(false)
  const initializedFor = useRef<string | null>(null)
  const handledNavId = useRef(0)

  useEffect(() => {
    pathRef.current = path
  }, [path])
  useEffect(() => {
    settingsLoadedRef.current = settings !== null
  }, [settings])

  const toastError = useCallback(
    (err: unknown) => {
      pushToast('error', parseExplorerError(err).message)
    },
    [pushToast]
  )

  const navigate = useCallback(
    async (target: string, opts?: { replace?: boolean }): Promise<void> => {
      const trimmed = target.trim()
      if (!trimmed.startsWith('/')) {
        pushToast('error', t('errors.notFound', { path: target }))
        return
      }
      const normalized = trimmed !== '/' ? trimmed.replace(/\/+$/, '') : trimmed
      setLoading(true)
      try {
        const list = await window.wslpad.explorer.list(normalized, {
          showHidden: showHiddenRef.current
        })
        const prev = pathRef.current
        if (!opts?.replace && prev !== null && prev !== normalized) {
          setBackStack((s) => [...s, prev])
          setForwardStack([])
        }
        pathRef.current = normalized
        setPath(normalized)
        setEntries(list)
        setError(null)
        setSearchQuery('')
        setSearchResults(null)
        setSelection(new Set())
        setConsolePath(normalized)
      } catch {
        pushToast('error', t('errors.notFound', { path: normalized }))
      } finally {
        setLoading(false)
      }
    },
    [pushToast, setConsolePath, t]
  )

  const refreshDir = useCallback(async (): Promise<void> => {
    const current = pathRef.current
    if (!current) return
    setRefreshToken((n) => n + 1)
    setLoading(true)
    try {
      const list = await window.wslpad.explorer.list(current, {
        showHidden: showHiddenRef.current
      })
      setEntries(list)
      setError(null)
    } catch (err) {
      setError(parseExplorerError(err).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const goBack = useCallback(async (): Promise<void> => {
    if (backStack.length === 0) return
    const target = backStack[backStack.length - 1]
    const current = pathRef.current
    setBackStack((s) => s.slice(0, -1))
    if (current) setForwardStack((s) => [...s, current])
    await navigate(target, { replace: true })
  }, [backStack, navigate])

  const goForward = useCallback(async (): Promise<void> => {
    if (forwardStack.length === 0) return
    const target = forwardStack[forwardStack.length - 1]
    const current = pathRef.current
    setForwardStack((s) => s.slice(0, -1))
    if (current) setBackStack((s) => [...s, current])
    await navigate(target, { replace: true })
  }, [forwardStack, navigate])

  const goUp = useCallback(async (): Promise<void> => {
    const current = pathRef.current
    if (!current || current === '/') return
    await navigate(parentPath(current))
  }, [navigate])

  const goHome = useCallback(async (): Promise<void> => {
    await navigate(home)
  }, [home, navigate])

  const goRoot = useCallback(async (): Promise<void> => {
    await navigate('/')
  }, [navigate])

  const toggleHidden = useCallback(async (): Promise<void> => {
    const next = !showHiddenRef.current
    showHiddenRef.current = next
    setShowHidden(next)
    const current = pathRef.current
    if (!current) return
    setLoading(true)
    try {
      const list = await window.wslpad.explorer.list(current, { showHidden: next })
      setEntries(list)
      setError(null)
    } catch (err) {
      setError(parseExplorerError(err).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const setSort = useCallback((key: SortKey): void => {
    setSortKey((prevKey) => {
      setSortDir((prevDir) => (prevKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'))
      return key
    })
  }, [])

  const copySelection = useCallback(
    (cut: boolean): void => {
      if (selection.size === 0) return
      setClipboard({ paths: [...selection], cut })
    },
    [selection]
  )

  const paste = useCallback(
    async (destDir?: string): Promise<void> => {
      const dest = destDir ?? pathRef.current
      if (!clipboard || !dest) return
      try {
        await window.wslpad.explorer.copy(clipboard.paths, dest, clipboard.cut)
        if (clipboard.cut) setClipboard(null)
      } catch (err) {
        toastError(err)
      }
    },
    [clipboard, toastError]
  )

  const dropPaths = useCallback(
    async (paths: string[], destDir: string, move: boolean): Promise<void> => {
      if (paths.length === 0) return
      try {
        await window.wslpad.explorer.copy(paths, destDir, move)
      } catch (err) {
        toastError(err)
      }
    },
    [toastError]
  )

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      const trimmed = query.trim()
      const current = pathRef.current
      if (!trimmed || !current) {
        setSearchQuery('')
        setSearchResults(null)
        return
      }
      setSearchQuery(trimmed)
      setLoading(true)
      try {
        const results = await window.wslpad.explorer.search(current, trimmed)
        setSearchResults(results)
        setSelection(new Set())
      } catch (err) {
        toastError(err)
      } finally {
        setLoading(false)
      }
    },
    [toastError]
  )

  const clearSearch = useCallback((): void => {
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const validateName = useCallback(
    (name: string): boolean => {
      if (fileNameSchema.safeParse(name).success) return true
      pushToast('error', t('explorer.invalidName', { defaultValue: 'This name is not allowed' }))
      return false
    },
    [pushToast, t]
  )

  const rename = useCallback(
    async (entryPath: string, newName: string): Promise<void> => {
      if (newName === baseName(entryPath)) return
      if (!validateName(newName)) return
      try {
        await window.wslpad.explorer.rename(entryPath, newName)
        await refreshDir()
      } catch (err) {
        toastError(err)
      }
    },
    [refreshDir, toastError, validateName]
  )

  const createEntry = useCallback(
    async (kind: 'file' | 'folder', name: string): Promise<void> => {
      const current = pathRef.current
      if (!current || !validateName(name)) return
      const target = joinPath(current, name)
      try {
        if (kind === 'folder') await window.wslpad.explorer.mkdir(target)
        else await window.wslpad.explorer.createFile(target)
        await refreshDir()
      } catch (err) {
        toastError(err)
      }
    },
    [refreshDir, toastError, validateName]
  )

  const trashPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      try {
        await window.wslpad.explorer.trash(paths)
        pushToast('success', t('toast.trashDone', { count: paths.length }))
        setSelection(new Set())
        await refreshDir()
      } catch (err) {
        toastError(err)
      }
    },
    [pushToast, refreshDir, t, toastError]
  )

  const deletePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      try {
        await window.wslpad.explorer.remove(paths)
        pushToast('success', t('toast.deleteDone', { count: paths.length }))
        setSelection(new Set())
        await refreshDir()
      } catch (err) {
        toastError(err)
      }
    },
    [pushToast, refreshDir, t, toastError]
  )

  const importWindows = useCallback(
    async (windowsPaths: string[], destDir: string): Promise<void> => {
      if (windowsPaths.length === 0) return
      try {
        await window.wslpad.explorer.importFromWindows(windowsPaths, destDir)
      } catch (err) {
        toastError(err)
      }
    },
    [toastError]
  )

  const importPicked = useCallback(async (): Promise<void> => {
    const current = pathRef.current
    if (!current) return
    try {
      const picked = await window.wslpad.explorer.pickImportPaths()
      if (picked.length > 0) await importWindows(picked, current)
    } catch (err) {
      toastError(err)
    }
  }, [importWindows, toastError])

  const exportSelected = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      try {
        const dir = await window.wslpad.explorer.pickExportDir()
        if (dir) await window.wslpad.explorer.exportToWindows(paths, dir)
      } catch (err) {
        toastError(err)
      }
    },
    [toastError]
  )

  // Initial location per distro (goal.md §7.2): HOME, or the last visited path.
  useEffect(() => {
    if (!distro || !settings) return
    if (initializedFor.current === distro) return
    const hasLast = settings.explorer.startLocation === 'last' && !!settings.explorer.lastPath
    // Starting at HOME requires the real home dir — wait for the first
    // dashboard snapshot instead of falling back to '/' (goal.md §7.2).
    if (!hasLast && !homeKnown) return
    initializedFor.current = distro
    const hidden = settings.explorer.showHiddenByDefault
    showHiddenRef.current = hidden
    setShowHidden(hidden)
    setBackStack([])
    setForwardStack([])
    setClipboard(null)
    setSelection(new Set())
    pathRef.current = null
    setPath(null)
    const start =
      settings.explorer.startLocation === 'last' && settings.explorer.lastPath
        ? settings.explorer.lastPath
        : home
    void navigate(start, { replace: true }).then(() => {
      if (pathRef.current === null && start !== home) {
        void navigate(home, { replace: true })
      }
    })
  }, [distro, settings, home, homeKnown, navigate])

  // Navigation requested from the Dashboard (goal.md §6.3).
  useEffect(() => {
    if (!explorerNavigateRequest) return
    if (explorerNavigateRequest.id === handledNavId.current) return
    handledNavId.current = explorerNavigateRequest.id
    void navigate(explorerNavigateRequest.path)
    consumeExplorerNavigate()
  }, [explorerNavigateRequest, navigate, consumeExplorerNavigate])

  // Persist last visited path, debounced. Deliberately only depends on `path`
  // — settings objects change on every settings:set and would loop.
  useEffect(() => {
    if (!path || !settingsLoadedRef.current) return
    const timer = setTimeout(() => {
      void window.wslpad.settings.set({ explorer: { lastPath: path } })
    }, 800)
    return () => clearTimeout(timer)
  }, [path])

  // Refresh the listing when a file operation completes (paste/import/export).
  useEffect(() => {
    return window.wslpad.onOpProgress((p) => {
      if (p.status === 'done') void refreshDir()
    })
  }, [refreshDir])

  const visibleEntries = useMemo(
    () => sortEntries(searchResults ?? entries, sortKey, sortDir),
    [entries, searchResults, sortKey, sortDir]
  )

  return {
    distro,
    home,
    path,
    entries,
    visibleEntries,
    loading,
    error,
    canBack: backStack.length > 0,
    canForward: forwardStack.length > 0,
    showHidden,
    sortKey,
    sortDir,
    selection,
    clipboard,
    searchQuery,
    searchResults,
    refreshToken,
    navigate,
    goBack,
    goForward,
    goUp,
    goHome,
    goRoot,
    refreshDir,
    toggleHidden,
    setSort,
    setSelection,
    copySelection,
    paste,
    dropPaths,
    runSearch,
    clearSearch,
    rename,
    createEntry,
    trashPaths,
    deletePaths,
    importPicked,
    importWindows,
    exportSelected
  }
}
