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
import { createLinuxAdapter, createWindowsAdapter } from './fsAdapter'
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

/** Debounce for persisting the last visited WSL path (goal.md §5.4). */
const LAST_PATH_DEBOUNCE_MS = 800

/**
 * Dual-pane Explorer (goal.md §7): Windows on the left, the selected WSL
 * distro on the right, with cross-filesystem copy between them.
 */
export function ExplorerTab(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    snapshot,
    settings,
    pushToast,
    setConsolePath,
    explorerNavigateRequest,
    consumeExplorerNavigate
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
  const [navRequest, setNavRequest] = useState<{ id: number; path: string; fs: FsKind } | null>(null)

  // The Windows pane ignores the Explorer start-location setting: it always
  // opens at the Windows user profile.
  useEffect(() => {
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
  }, [])

  // WSL pane start location (goal.md §7.2): last path, or the distro HOME once
  // the first snapshot knows it — never a guessed '/'.
  const linuxStart = useMemo(() => {
    if (!settings || distro === null) return null
    if (settings.explorer.startLocation === 'last' && settings.explorer.lastPath) {
      return settings.explorer.lastPath
    }
    return home
  }, [settings, distro, home])

  const showHiddenDefault = settings?.explorer.showHiddenByDefault ?? false
  const settingsLoaded = settings !== null

  const onLinuxPathChange = useCallback(
    (p: string) => {
      setLinuxPath(p)
      setConsolePath(p)
    },
    [setConsolePath]
  )

  // Persist the last visited WSL path, debounced. The Windows pane never
  // writes it — only the WSL side is restored on restart.
  useEffect(() => {
    if (!linuxPath || !settingsLoaded) return
    const timer = setTimeout(() => {
      void window.wslpad.settings.set({ explorer: { lastPath: linuxPath } })
    }, LAST_PATH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [linuxPath, settingsLoaded])

  // Navigation requested from the Dashboard, routed to the matching pane.
  useEffect(() => {
    if (!explorerNavigateRequest) return
    setNavRequest(explorerNavigateRequest)
    setActivePane(explorerNavigateRequest.fs)
    consumeExplorerNavigate()
  }, [explorerNavigateRequest, consumeExplorerNavigate])

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

  const paneNav = (fs: FsKind): { id: number; path: string } | null =>
    navRequest && navRequest.fs === fs ? { id: navRequest.id, path: navRequest.path } : null

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
            onPathChange={setWindowsPath}
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
            // The folder a file came back to is where someone wants to be
            // looking; navigating there also reloads the listing it rejoined.
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
