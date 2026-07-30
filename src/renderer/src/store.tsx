import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { Settings, WslPadSnapshot } from '@shared/types'

export type MainTab = 'dashboard' | 'explorer'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface PreparedCommand {
  id: number
  text: string
}

export interface AppStore {
  snapshot: WslPadSnapshot | null
  settings: Settings | null
  tab: MainTab
  setTab: (tab: MainTab) => void
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  /**
   * Dashboard/Explorer put a command into the Console INPUT — never executed
   * automatically (goal.md §2.2, §8.5). ConsolePanel consumes it.
   */
  preparedCommand: PreparedCommand | null
  prepareCommand: (text: string) => void
  consumePreparedCommand: () => void
  /** Explorer navigation → Console cwd sync request (goal.md §8.4). */
  pendingConsolePath: string | null
  setConsolePath: (path: string) => void
  consumeConsolePath: () => void
  toasts: Toast[]
  pushToast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
  selectDistro: (name: string) => Promise<void>
  refresh: () => Promise<void>
  /** Explorer asks Dashboard tab to highlight a PID (Ports card → process). */
  focusPid: number | null
  setFocusPid: (pid: number | null) => void
  /** Explorer path requested from outside (Dashboard path cards). */
  explorerNavigateRequest: { id: number; path: string } | null
  navigateExplorer: (path: string) => void
  consumeExplorerNavigate: () => void
}

const Ctx = createContext<AppStore | null>(null)

let nextId = 1

export function AppStoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WslPadSnapshot | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<MainTab>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preparedCommand, setPreparedCommand] = useState<PreparedCommand | null>(null)
  const [pendingConsolePath, setPendingConsolePath] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [focusPid, setFocusPid] = useState<number | null>(null)
  const [explorerNavigateRequest, setExplorerNavigateRequest] = useState<{
    id: number
    path: string
  } | null>(null)
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    let disposed = false
    void window.wslpad.getSnapshot().then((s) => {
      if (!disposed) setSnapshot(s)
    })
    void window.wslpad.settings.get().then((s) => {
      if (!disposed) setSettings(s)
    })
    const offSnap = window.wslpad.onSnapshot((s) => setSnapshot(s))
    const offSettings = window.wslpad.settings.onChange((s) => setSettings(s))
    const offNav = window.wslpad.onNavigateSettings(() => setSettingsOpen(true))
    return () => {
      disposed = true
      offSnap()
      offSettings()
      offNav()
    }
  }, [])

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = nextId++
    setToasts((t) => [...t.slice(-4), { id, kind, text }])
    const timer = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      toastTimers.current.delete(id)
    }, 4500)
    toastTimers.current.set(id, timer)
  }, [])

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id)
    if (timer) clearTimeout(timer)
    toastTimers.current.delete(id)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const store = useMemo<AppStore>(
    () => ({
      snapshot,
      settings,
      tab,
      setTab,
      settingsOpen,
      openSettings: () => setSettingsOpen(true),
      closeSettings: () => setSettingsOpen(false),
      preparedCommand,
      prepareCommand: (text: string) => setPreparedCommand({ id: nextId++, text }),
      consumePreparedCommand: () => setPreparedCommand(null),
      pendingConsolePath,
      setConsolePath: (path: string) => setPendingConsolePath(path),
      consumeConsolePath: () => setPendingConsolePath(null),
      toasts,
      pushToast,
      dismissToast,
      selectDistro: async (name: string) => {
        await window.wslpad.selectDistro(name)
      },
      refresh: async () => {
        await window.wslpad.refresh('all')
      },
      focusPid,
      setFocusPid,
      explorerNavigateRequest,
      navigateExplorer: (path: string) => {
        setExplorerNavigateRequest({ id: nextId++, path })
        setTab('explorer')
      },
      consumeExplorerNavigate: () => setExplorerNavigateRequest(null)
    }),
    [
      snapshot,
      settings,
      tab,
      settingsOpen,
      preparedCommand,
      pendingConsolePath,
      toasts,
      pushToast,
      dismissToast,
      focusPid,
      explorerNavigateRequest
    ]
  )

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useApp(): AppStore {
  const store = useContext(Ctx)
  if (!store) throw new Error('useApp must be used inside AppStoreProvider')
  return store
}
