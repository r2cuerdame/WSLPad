import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WINDOWS_ROOT } from '@shared/constants'
import type { FsKind } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { useApp } from '../store'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { EditorOverlay } from './EditorOverlay'
import { FilePane } from './FilePane'
import { PropertiesDialog } from './PropertiesDialog'
import { TrashDialog } from './TrashDialog'
import { Splitter, loadSplit } from './Splitter'
import { TransferProgress } from './TransferProgress'
import {
  createLinuxAdapter,
  createWindowsAdapter,
  parentPath,
  windowsParent
} from './fsAdapter'
import { parseExplorerError } from './usePane'
import './explorer.css'

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

interface TargetPath {
  path: string
  fs: FsKind
}

const LAST_PATH_DEBOUNCE_MS = 800

export function ExplorerTab(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    snapshot,
    settings,
    pushToast,
    setConsolePath,
    explorerNavigateRequest,
    consumeExplorerNavigate,
    explorerOpenFileRequest,
    consumeExplorerOpenFile
  } = useApp()

  const distro = snapshot?.selectedDistro ?? null
  const home = snapshot?.dashboard?.system.home ?? null

  const windowsAdapter = useMemo(() => createWindowsAdapter(), [])
  const linuxAdapter = useMemo(() => createLinuxAdapter(home), [home])

  const containerRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(loadSplit)
  const [activePane, setActivePane] = useState<FsKind>('linux')
  const [windowsPath, setWindowsPath] = useState<string | null>(null)
  const [linuxPath, setLinuxPath] = useState<string | null>(null)
  const [windowsStart, setWindowsStart] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editor, setEditor] = useState<TargetPath | null>(null)
  const [properties, setProperties] = useState<TargetPath | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ count: number; run: () => void } | null>(null)
  const [navRequest, setNavRequest] = useState<{
    id: number
    path: string
    fs: FsKind
    selectPath?: string
  } | null>(null)

  const settingsLoaded = settings !== null
  const savedExplorerRef = useRef(settings?.explorer ?? null)
  savedExplorerRef.current = settings?.explorer ?? null

  useEffect(() => {
    if (!settingsLoaded) return
    const saved = savedExplorerRef.current
    if (saved?.startLocation === 'last' && saved.windowsLastPath !== null) {
      setWindowsStart(saved.windowsLastPath)
      return
    }
    let disposed = false
    void window.wslpad.windows
      .home()
      .then((h) => {
        if (!disposed) setWindowsStart(h)
      })
      .catch(() => {
        if (!disposed) setWindowsStart(WINDOWS_ROOT)
      })
    return () => {
      disposed = true
    }
  }, [settings])

  const [legacyDistro, setLegacyDistro] = useState<string | null>(null)
  useEffect(() => {
    if (settings && distro !== null && legacyDistro === null) setLegacyDistro(distro)
  }, [settings, distro, legacyDistro])

  const linuxStart = useMemo(() => {
    if (!settings || distro === null) return null
    const { startLocation, lastPaths, lastPath } = settings.explorer
    if (startLocation === 'last') {
      const remembered = lastPaths[distro]
      if (remembered) return remembered
      const legacyApplies =
        lastPath !== null &&
        Object.keys(lastPaths).length === 0 &&
        (legacyDistro === null || legacyDistro === distro)
      if (legacyApplies) return lastPath
    }
    return home
  }, [settings, distro, home, legacyDistro])

  const showHiddenDefault = settings?.explorer.showHiddenByDefault ?? false

  // Updated after FilePane's reset effect so a listing that lands before the
  // reset is still credited to the distro it was read from.
  const distroRef = useRef(distro)
  useEffect(() => {
    distroRef.current = distro
  }, [distro])

  const pendingLastPath = useRef<{ distro: string; path: string; timer: number } | null>(null)
  const flushLastPath = useCallback(() => {
    const pending = pendingLastPath.current
    if (!pending) return
    pendingLastPath.current = null
    window.clearTimeout(pending.timer)
    void window.wslpad.settings.set({
      explorer: { lastPaths: { [pending.distro]: pending.path }, lastPath: null }
    })
  }, [])

  const rememberLastPath = useCallback(
    (path: string) => {
      const owner = distroRef.current
      if (owner === null) return
      const pending = pendingLastPath.current
      if (pending && pending.distro !== owner) flushLastPath()
      else if (pending) window.clearTimeout(pending.timer)
      else {
        const saved = savedExplorerRef.current
        if (saved && saved.lastPath === null && saved.lastPaths[owner] === path) return
      }
      pendingLastPath.current = {
        distro: owner,
        path,
        timer: window.setTimeout(flushLastPath, LAST_PATH_DEBOUNCE_MS)
      }
    },
    [flushLastPath]
  )

  useEffect(() => flushLastPath, [flushLastPath])

  const pendingWindowsPath = useRef<{ path: string; timer: number } | null>(null)
  const flushWindowsPath = useCallback(() => {
    const pending = pendingWindowsPath.current
    if (!pending) return
    pendingWindowsPath.current = null
    window.clearTimeout(pending.timer)
    void window.wslpad.settings.set({ explorer: { windowsLastPath: pending.path } })
  }, [])

  const rememberWindowsPath = useCallback(
    (path: string) => {
      const pending = pendingWindowsPath.current
      if (pending) window.clearTimeout(pending.timer)
      else if (savedExplorerRef.current?.windowsLastPath === path) return
      pendingWindowsPath.current = {
        path,
        timer: window.setTimeout(flushWindowsPath, LAST_PATH_DEBOUNCE_MS)
      }
    },
    [flushWindowsPath]
  )

  useEffect(() => flushWindowsPath, [flushWindowsPath])

  const onWindowsPathChange = useCallback(
    (p: string) => {
      setWindowsPath(p)
      if (settingsLoaded) rememberWindowsPath(p)
    },
    [settingsLoaded, rememberWindowsPath]
  )

  const onLinuxPathChange = useCallback(
    (p: string) => {
      setLinuxPath(p)
      setConsolePath(p)
      if (settingsLoaded) rememberLastPath(p)
    },
    [setConsolePath, settingsLoaded, rememberLastPath]
  )

  useEffect(() => {
    if (!explorerNavigateRequest) return
    setEditor(null)
    setNavRequest(explorerNavigateRequest)
    setActivePane(explorerNavigateRequest.fs)
    consumeExplorerNavigate()
  }, [explorerNavigateRequest, consumeExplorerNavigate])

  useEffect(() => {
    if (!explorerOpenFileRequest) return
    const { id, path, fs } = explorerOpenFileRequest
    const parent = fs === 'windows' ? windowsParent(path) : parentPath(path)
    setEditor({ path, fs })
    setActivePane(fs)
    setNavRequest({ id, path: parent, fs, selectPath: path })
    consumeExplorerOpenFile()
  }, [explorerOpenFileRequest, consumeExplorerOpenFile])

  const runTransfer = useCallback(
    (from: FsKind, paths: string[], destDir: string): void => {
      if (paths.length === 0 || destDir === WINDOWS_ROOT) return
      const started =
        from === 'windows'
          ? window.wslpad.explorer.importFromWindows(paths, destDir)
          : window.wslpad.explorer.exportToWindows(paths, destDir)
      void started
        .then(() => pushToast('info', t('explorer.transferStarted')))
        .catch((err) => pushToast('error', parseExplorerError(err).message))
    },
    [pushToast, t]
  )

  const requestPermanentDelete = useCallback((count: number, run: () => void): void => {
    setConfirmDelete({ count, run })
  }, [])

  const openEditor = useCallback((path: string, fs: FsKind) => setEditor({ path, fs }), [])
  const openProperties = useCallback((path: string, fs: FsKind) => setProperties({ path, fs }), [])
  const openMenu = useCallback(
    (x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }),
    []
  )
  const activateWindows = useCallback(() => setActivePane('windows'), [])
  const activateLinux = useCallback(() => setActivePane('linux'), [])

  const paneNav = (fs: FsKind): { id: number; path: string; selectPath?: string } | null =>
    navRequest && navRequest.fs === fs
      ? navRequest.selectPath === undefined
        ? { id: navRequest.id, path: navRequest.path }
        : { id: navRequest.id, path: navRequest.path, selectPath: navRequest.selectPath }
      : null

  return (
    <div className="explorer-tab">
      <div className="pane-split" ref={containerRef}>
        <div className="pane-slot" style={{ flexBasis: `${split}%` }}>
          <FilePane
            adapter={windowsAdapter}
            title={t('explorer.pane.windows')}
            ariaLabel={t('explorer.pane.windowsAria')}
            testId="pane-windows"
            active={activePane === 'windows'}
            onActivate={activateWindows}
            otherKind="linux"
            otherPath={linuxPath}
            onTransfer={runTransfer}
            onOpenEditor={openEditor}
            onOpenProperties={openProperties}
            onRequestPermanentDelete={requestPermanentDelete}
            onContextMenu={openMenu}
            onPathChange={onWindowsPathChange}
            startPath={windowsStart}
            resetKey="windows"
            showHiddenDefault={showHiddenDefault}
            navRequest={paneNav('windows')}
          />
        </div>

        <Splitter percent={split} onChange={setSplit} containerRef={containerRef} />

        <div className="pane-slot" style={{ flexBasis: `${100 - split}%` }}>
          <FilePane
            adapter={linuxAdapter}
            title={distro ?? t('explorer.noDistro')}
            ariaLabel={t('explorer.pane.wslAria', { distro: distro ?? '' })}
            testId="pane-linux"
            active={activePane === 'linux'}
            onActivate={activateLinux}
            otherKind="windows"
            otherPath={windowsPath}
            onTransfer={runTransfer}
            onOpenEditor={openEditor}
            onOpenProperties={openProperties}
            onRequestPermanentDelete={requestPermanentDelete}
            onContextMenu={openMenu}
            onPathChange={onLinuxPathChange}
            startPath={linuxStart}
            resetKey={distro ?? 'no-distro'}
            onOpenTrash={distro === null ? undefined : () => setTrashOpen(true)}
            showHiddenDefault={showHiddenDefault}
            navRequest={paneNav('linux')}
            unavailableMessage={distro === null ? t('explorer.noDistro') : null}
          />
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {editor && (
        <EditorOverlay path={editor.path} fs={editor.fs} onClose={() => setEditor(null)} />
      )}

      {trashOpen && (
        <TrashDialog
          onClose={() => setTrashOpen(false)}
          onRestored={(paths) => {
            const first = paths[0]
            if (first === undefined) return
            const parent = first.replace(/\/[^/]*$/, '') || '/'
            setNavRequest({ id: Date.now(), path: parent, fs: 'linux' })
            setActivePane('linux')
          }}
        />
      )}

      {properties && (
        <PropertiesDialog
          path={properties.path}
          fs={properties.fs}
          onClose={() => setProperties(null)}
        />
      )}

      <Dialog
        open={confirmDelete !== null}
        title={t('explorer.confirmDeleteTitle')}
        onClose={() => setConfirmDelete(null)}
        actions={
          <>
            <button type="button" onClick={() => setConfirmDelete(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const pending = confirmDelete
                setConfirmDelete(null)
                pending?.run()
              }}
            >
              {t('explorer.menu.deletePermanent')}
            </button>
          </>
        }
      >
        {t('explorer.confirmDeleteBody', { count: confirmDelete?.count ?? 0 })}
      </Dialog>

      <TransferProgress />
    </div>
  )
}

export default ExplorerTab
