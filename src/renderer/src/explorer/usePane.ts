import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DirSizeResult, FileEntry, FsKind } from '@shared/types'
import { roundTo } from '@shared/format'
import { fileNameSchema } from '@shared/schemas'
import { useApp } from '../store'
import type { FsAdapter } from './fsAdapter'

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
  if (unit < units.length - 1 && roundTo(value, unit === 0 ? 0 : 1) >= 1024) {
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

// ipcRenderer.invoke flattens rejections into Error messages, so the payload arrives as JSON text.
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

export function extractWindowsPaths(files: FileList): string[] {
  const out: string[] = []
  for (const file of Array.from(files)) {
    const p = (file as File & { path?: string }).path
    if (typeof p === 'string' && p.length > 0) out.push(p)
  }
  return out
}

export interface DirSizeState {
  status: 'closed' | 'running' | 'ready' | 'error'
  path: string | null
  result: DirSizeResult | null
  error: string | null
}

const CLOSED_DIR_SIZES: DirSizeState = { status: 'closed', path: null, result: null, error: null }

let dirSizeToken = 0

export interface UsePaneOptions {
  resetKey: string
  startPath: string | null
  showHiddenDefault: boolean
  onPathChange?: (path: string) => void
}

export interface PaneApi {
  kind: FsKind
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
  dirSizes: DirSizeState
  canMeasure: boolean
  measureDirSizes: () => Promise<void>
  cancelDirSizes: () => void
  closeDirSizes: () => void
  navigate: (path: string, navOpts?: { replace?: boolean; selectPath?: string }) => Promise<void>
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
}

export function usePane(adapter: FsAdapter, opts: UsePaneOptions): PaneApi {
  const { pushToast } = useApp()
  const { t } = useTranslation()

  const [path, setPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backStack, setBackStack] = useState<string[]>([])
  const [forwardStack, setForwardStack] = useState<string[]>([])
  const [showHidden, setShowHidden] = useState(opts.showHiddenDefault)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [dirSizes, setDirSizes] = useState<DirSizeState>(CLOSED_DIR_SIZES)

  const dirSizeCache = useRef(new Map<string, DirSizeResult>())
  const activeDirSizeToken = useRef<string | null>(null)

  const activeSearchRef = useRef<string | null>(null)
  const searchSeq = useRef(0)

  const pathRef = useRef<string | null>(null)
  const showHiddenRef = useRef(opts.showHiddenDefault)
  const adapterRef = useRef(adapter)
  const optsRef = useRef(opts)
  const initializedFor = useRef<string | null>(null)
  const navSeqRef = useRef(0)
  const manualBeforeFirstInitRef = useRef(false)
  adapterRef.current = adapter
  optsRef.current = opts

  const toastError = useCallback(
    (err: unknown) => {
      pushToast('error', parseExplorerError(err).message)
    },
    [pushToast]
  )

  const navigate = useCallback(
    async (
      target: string,
      navOpts?: {
        replace?: boolean
        selectPath?: string
        quiet?: boolean
        history?: 'back' | 'forward'
      }
    ): Promise<void> => {
      const fs = adapterRef.current
      const normalized = fs.normalize(target)
      if (normalized === null) {
        if (!navOpts?.quiet) pushToast('error', t('errors.notFound', { path: target }))
        return
      }
      if (!navOpts?.replace && initializedFor.current === null) {
        manualBeforeFirstInitRef.current = true
      }
      const seq = ++navSeqRef.current
      setLoading(true)
      try {
        const list = await fs.list(normalized, { showHidden: showHiddenRef.current })
        if (seq !== navSeqRef.current) return
        const prev = pathRef.current
        if (navOpts?.history === 'back') {
          setBackStack((s) => s.slice(0, -1))
          if (prev !== null) setForwardStack((s) => [...s, prev])
        } else if (navOpts?.history === 'forward') {
          setForwardStack((s) => s.slice(0, -1))
          if (prev !== null) setBackStack((s) => [...s, prev])
        } else if (!navOpts?.replace && prev !== null && prev !== normalized) {
          setBackStack((s) => [...s, prev])
          setForwardStack([])
        }
        pathRef.current = normalized
        setPath(normalized)
        setEntries(list)
        setError(null)
        activeSearchRef.current = null
        searchSeq.current++
        setSearchQuery('')
        setSearchResults(null)
        let nextSelection = new Set<string>()
        if (navOpts?.selectPath) {
          const selectNorm = fs.normalize(navOpts.selectPath) ?? navOpts.selectPath
          const match =
            fs.kind === 'windows'
              ? list.find((entry) => entry.path.toLowerCase() === selectNorm.toLowerCase())
              : list.find((entry) => entry.path === selectNorm)
          if (match) nextSelection = new Set([match.path])
        }
        setSelection(nextSelection)
        activeDirSizeToken.current = null
        setDirSizes(CLOSED_DIR_SIZES)
        optsRef.current.onPathChange?.(normalized)
      } catch {
        if (seq === navSeqRef.current && !navOpts?.quiet) {
          pushToast('error', t('errors.notFound', { path: normalized }))
        }
      } finally {
        if (seq === navSeqRef.current) {
          setLoading(false)
        }
      }
    },
    [pushToast, t]
  )

  const closeDirSizes = useCallback((): void => {
    activeDirSizeToken.current = null
    setDirSizes(CLOSED_DIR_SIZES)
  }, [])

  const cancelDirSizes = useCallback((): void => {
    const token = activeDirSizeToken.current
    if (token !== null) void adapterRef.current.cancelDirSizes?.(token).catch(() => undefined)
    closeDirSizes()
  }, [closeDirSizes])

  const measureDirSizes = useCallback(async (): Promise<void> => {
    const fs = adapterRef.current
    const current = pathRef.current
    if (!fs.dirSizes || current === null) return
    const cached = dirSizeCache.current.get(current)
    if (cached) {
      activeDirSizeToken.current = null
      setDirSizes({ status: 'ready', path: current, result: cached, error: null })
      return
    }
    const token = `dirsize-${++dirSizeToken}`
    activeDirSizeToken.current = token
    setDirSizes({ status: 'running', path: current, result: null, error: null })
    try {
      const result = await fs.dirSizes(current, token)
      if (activeDirSizeToken.current !== token) return
      activeDirSizeToken.current = null
      if (result.cancelled) {
        setDirSizes(CLOSED_DIR_SIZES)
        return
      }
      if (result.error === null) dirSizeCache.current.set(current, result)
      setDirSizes({ status: 'ready', path: current, result, error: null })
    } catch (err) {
      if (activeDirSizeToken.current !== token) return
      activeDirSizeToken.current = null
      setDirSizes({
        status: 'error',
        path: current,
        result: null,
        error: parseExplorerError(err).message
      })
    }
  }, [])

  const refreshDir = useCallback(async (): Promise<void> => {
    const current = pathRef.current
    if (!current) return
    dirSizeCache.current.delete(current)
    closeDirSizes()
    setRefreshToken((n) => n + 1)
    setLoading(true)
    try {
      try {
        const list = await adapterRef.current.list(current, { showHidden: showHiddenRef.current })
        setEntries(list)
        setError(null)
      } catch (err) {
        setError(parseExplorerError(err).message)
      }
      const query = activeSearchRef.current
      if (query === null) return
      const seq = ++searchSeq.current
      try {
        const results = await adapterRef.current.search(current, query)
        if (seq === searchSeq.current) setSearchResults(results)
      } catch (err) {
        if (seq !== searchSeq.current) return
        activeSearchRef.current = null
        setSearchQuery('')
        setSearchResults(null)
        toastError(err)
      }
    } finally {
      setLoading(false)
    }
  }, [closeDirSizes, toastError])

  const goBack = useCallback(async (): Promise<void> => {
    if (backStack.length === 0) return
    await navigate(backStack[backStack.length - 1], { replace: true, history: 'back' })
  }, [backStack, navigate])

  const goForward = useCallback(async (): Promise<void> => {
    if (forwardStack.length === 0) return
    await navigate(forwardStack[forwardStack.length - 1], { replace: true, history: 'forward' })
  }, [forwardStack, navigate])

  const goUp = useCallback(async (): Promise<void> => {
    const fs = adapterRef.current
    const current = pathRef.current
    if (!current || fs.isRoot(current)) return
    await navigate(fs.parent(current))
  }, [navigate])

  const goHome = useCallback(async (): Promise<void> => {
    try {
      await navigate(await adapterRef.current.home())
    } catch (err) {
      toastError(err)
    }
  }, [navigate, toastError])

  const goRoot = useCallback(async (): Promise<void> => {
    await navigate(adapterRef.current.rootPath)
  }, [navigate])

  const toggleHidden = useCallback(async (): Promise<void> => {
    const next = !showHiddenRef.current
    showHiddenRef.current = next
    setShowHidden(next)
    const current = pathRef.current
    if (!current) return
    setLoading(true)
    try {
      const list = await adapterRef.current.list(current, { showHidden: next })
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
        await adapterRef.current.copyMove(clipboard.paths, dest, clipboard.cut)
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
        await adapterRef.current.copyMove(paths, destDir, move)
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
      const seq = ++searchSeq.current
      if (!trimmed || !current) {
        activeSearchRef.current = null
        setSearchQuery('')
        setSearchResults(null)
        return
      }
      activeSearchRef.current = trimmed
      setSearchQuery(trimmed)
      setLoading(true)
      try {
        const results = await adapterRef.current.search(current, trimmed)
        if (seq !== searchSeq.current) return
        setSearchResults(results)
        setSelection(new Set())
      } catch (err) {
        if (seq === searchSeq.current) toastError(err)
      } finally {
        setLoading(false)
      }
    },
    [toastError]
  )

  const clearSearch = useCallback((): void => {
    activeSearchRef.current = null
    searchSeq.current++
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const validateName = useCallback(
    (name: string): boolean => {
      if (fileNameSchema.safeParse(name).success) return true
      pushToast('error', t('explorer.invalidName'))
      return false
    },
    [pushToast, t]
  )

  const rename = useCallback(
    async (entryPath: string, newName: string): Promise<void> => {
      if (newName === adapterRef.current.base(entryPath)) return
      if (!validateName(newName)) return
      try {
        await adapterRef.current.rename(entryPath, newName)
        await refreshDir()
      } catch (err) {
        toastError(err)
      }
    },
    [refreshDir, toastError, validateName]
  )

  const createEntry = useCallback(
    async (kind: 'file' | 'folder', name: string): Promise<void> => {
      const fs = adapterRef.current
      const current = pathRef.current
      if (!current || !validateName(name)) return
      const target = fs.join(current, name)
      try {
        if (kind === 'folder') await fs.mkdir(target)
        else await fs.createFile(target)
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
        await adapterRef.current.trash(paths)
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
        await adapterRef.current.remove(paths)
        pushToast('success', t('toast.deleteDone', { count: paths.length }))
        setSelection(new Set())
        await refreshDir()
      } catch (err) {
        toastError(err)
      }
    },
    [pushToast, refreshDir, t, toastError]
  )

  const { resetKey, startPath, showHiddenDefault } = opts
  useEffect(() => {
    if (startPath === null) return
    if (initializedFor.current === resetKey) return
    const firstInit = initializedFor.current === null
    initializedFor.current = resetKey
    if (firstInit && manualBeforeFirstInitRef.current) {
      manualBeforeFirstInitRef.current = false
      return
    }
    showHiddenRef.current = showHiddenDefault
    setShowHidden(showHiddenDefault)
    setBackStack([])
    setForwardStack([])
    setClipboard(null)
    setSelection(new Set())
    dirSizeCache.current.clear()
    activeDirSizeToken.current = null
    setDirSizes(CLOSED_DIR_SIZES)
    pathRef.current = null
    setPath(null)
    const navPromise = navigate(startPath, { replace: true, quiet: true })
    const initSeq = navSeqRef.current
    const stillWaiting = (): boolean => initSeq === navSeqRef.current && pathRef.current === null
    const reportStartMissing = (): void => {
      if (stillWaiting()) pushToast('error', t('errors.notFound', { path: startPath }))
    }
    void navPromise.then(() => {
      if (!stillWaiting()) return
      void adapterRef.current.home().then((h) => {
        if (!stillWaiting()) return
        if (h !== startPath) void navigate(h, { replace: true })
        else reportStartMissing()
      }, reportStartMissing)
    })
  }, [resetKey, startPath, showHiddenDefault, navigate, pushToast, t])

  useEffect(() => {
    return window.wslpad.onOpProgress((p) => {
      if (
        p.status === 'done' ||
        ((p.status === 'error' || p.status === 'cancelled') && (p.doneItems ?? 0) > 0)
      ) {
        void refreshDir()
      }
    })
  }, [refreshDir])

  const visibleEntries = useMemo(
    () => sortEntries(searchResults ?? entries, sortKey, sortDir),
    [entries, searchResults, sortKey, sortDir]
  )

  return {
    kind: adapter.kind,
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
    dirSizes,
    canMeasure:
      adapter.dirSizes !== undefined &&
      !(adapter.kind === 'windows' && path === adapter.rootPath),
    measureDirSizes,
    cancelDirSizes,
    closeDirSizes,
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
    deletePaths
  }
}
