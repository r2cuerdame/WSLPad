import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WINDOWS_ROOT } from '@shared/constants'
import type { FileEntry, FsKind, WindowsPlace } from '@shared/types'
import { useApp } from '../store'
import { CopyIcon, LinuxIcon, RetroCopyIcon, WindowsIcon } from '../components/Icons'
import type { MenuItem } from './ContextMenu'
import { FileListView, LINUX_COLUMNS, WINDOWS_COLUMNS } from './FileList'
import { FolderTree } from './FolderTree'
import { Toolbar } from './Toolbar'
import { shQuote, type FsAdapter } from './fsAdapter'
import { extractWindowsPaths, formatBytes, parseExplorerError, usePane } from './usePane'

const TREE_STORAGE_PREFIX = 'wslpad.explorer.tree.'

export interface FilePaneProps {
  adapter: FsAdapter
  /** Header label: t('explorer.pane.windows') or the distro name (never translated). */
  title: string
  ariaLabel: string
  testId: string
  active: boolean
  onActivate: () => void
  otherKind: FsKind
  /** Directory currently open in the other pane — the transfer destination. */
  otherPath: string | null
  onTransfer: (from: FsKind, paths: string[], destDir: string) => void
  onOpenEditor: (path: string, fs: FsKind) => void
  onOpenProperties: (path: string, fs: FsKind) => void
  /** Shift+Delete / menu: ExplorerTab confirms, then runs the pane's delete. */
  onRequestPermanentDelete: (count: number, run: () => void) => void
  onContextMenu: (x: number, y: number, items: MenuItem[]) => void
  onPathChange: (path: string) => void
  startPath: string | null
  resetKey: string
  showHiddenDefault: boolean
  navRequest: { id: number; path: string } | null
  /** Rendered instead of the browser when the filesystem is unavailable. */
  unavailableMessage?: string | null
}

function PaneIcon({ kind }: { kind: FsKind }): React.JSX.Element {
  return kind === 'windows' ? (
    <WindowsIcon size={14} className="pane-icon" />
  ) : (
    <LinuxIcon size={14} className="pane-icon" />
  )
}

/** Drives and known folders for quick access in the Windows pane. */
function PlacesStrip({
  onNavigate
}: {
  onNavigate: (path: string) => void
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [places, setPlaces] = useState<WindowsPlace[]>([])

  useEffect(() => {
    let disposed = false
    void window.wslpad.windows
      .places()
      .then((list) => {
        if (!disposed) setPlaces(list)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [])

  if (places.length === 0) return null
  return (
    <div className="pane-places">
      <div className="places-header">{t('explorer.places')}</div>
      {places.map((place) => (
        <button
          key={place.id}
          type="button"
          className="places-item"
          title={place.path}
          onClick={() => onNavigate(place.path)}
        >
          <span className="places-label">{place.label}</span>
          {place.kind === 'drive' && place.freeBytes !== null && place.totalBytes !== null && (
            <span className="places-free">
              {t('explorer.driveFree', {
                free: formatBytes(place.freeBytes, i18n.language),
                total: formatBytes(place.totalBytes, i18n.language)
              })}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** One complete Explorer pane: header, toolbar, optional tree, list, status. */
export function FilePane(props: FilePaneProps): React.JSX.Element {
  const { adapter } = props
  const { t } = useTranslation()
  const { pushToast, prepareCommand } = useApp()
  const pane = usePane(adapter, {
    resetKey: props.resetKey,
    startPath: props.startPath,
    showHiddenDefault: props.showHiddenDefault,
    onPathChange: props.onPathChange
  })

  const [treeOpen, setTreeOpen] = useState(() => {
    try {
      return localStorage.getItem(TREE_STORAGE_PREFIX + adapter.kind) === '1'
    } catch {
      return false
    }
  })
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const handledNavId = useRef(0)

  const { navigate } = pane
  const { navRequest } = props
  useEffect(() => {
    if (!navRequest || navRequest.id === handledNavId.current) return
    handledNavId.current = navRequest.id
    void navigate(navRequest.path)
  }, [navRequest, navigate])

  const toggleTree = useCallback((): void => {
    setTreeOpen((open) => {
      const next = !open
      try {
        localStorage.setItem(TREE_STORAGE_PREFIX + adapter.kind, next ? '1' : '0')
      } catch {
        /* storage unavailable — the tree state simply does not persist */
      }
      return next
    })
  }, [adapter.kind])

  const selectedPaths = (): string[] => [...pane.selection]

  const copyText = (text: string): void => {
    void window.wslpad
      .copyToClipboard(text)
      .then(() => pushToast('success', t('toast.copiedPath')))
      .catch(() => undefined)
  }

  const copyWindowsPath = (p: string): void => {
    void window.wslpad
      .convertPath(p, 'windows')
      .then(async (win) => {
        await window.wslpad.copyToClipboard(win)
        pushToast('success', t('toast.copiedPath'))
      })
      .catch(() => pushToast('error', t('errors.pathConversionFailed')))
  }

  const openNative = (p: string): void => {
    void adapter.openNative(p).catch((err) => pushToast('error', parseExplorerError(err).message))
  }

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const openEntry = (entry: FileEntry): void => {
    if (entry.type === 'directory') void pane.navigate(entry.path)
    else props.onOpenEditor(entry.path, adapter.kind)
  }

  const transferTarget = (): string | null => {
    if (props.otherPath === null) return null
    if (props.otherKind === 'windows' && props.otherPath === WINDOWS_ROOT) return null
    return props.otherPath
  }

  const copyToOther = (paths: string[]): void => {
    const dest = transferTarget()
    if (!dest || paths.length === 0) return
    props.onTransfer(adapter.kind, paths, dest)
  }

  const pickImport = (): void => {
    const dest = pane.path
    if (!dest) return
    void window.wslpad.explorer
      .pickImportPaths()
      .then((picked) => {
        if (picked.length > 0) props.onTransfer('windows', picked, dest)
      })
      .catch((err) => pushToast('error', parseExplorerError(err).message))
  }

  const pickExport = (paths: string[]): void => {
    if (paths.length === 0) return
    void window.wslpad.explorer
      .pickExportDir()
      .then((dir) => {
        if (dir) props.onTransfer('linux', paths, dir)
      })
      .catch((err) => pushToast('error', parseExplorerError(err).message))
  }

  const requestDelete = (paths: string[]): void => {
    if (paths.length === 0) return
    props.onRequestPermanentDelete(paths.length, () => void pane.deletePaths(paths))
  }

  const onDropExternalFiles = (files: FileList, destDir: string): void => {
    const winPaths = extractWindowsPaths(files)
    if (winPaths.length > 0) props.onTransfer('windows', winPaths, destDir)
    else pushToast('info', t('explorer.dropUseImport'))
  }

  const commonEntryItems = (entry: FileEntry, paths: string[]): MenuItem[] => {
    const single = paths.length === 1
    return [
      { id: 'new-file', label: t('explorer.menu.newFile'), onClick: () => setCreating('file') },
      {
        id: 'new-folder',
        label: t('explorer.menu.newFolder'),
        onClick: () => setCreating('folder')
      },
      {
        id: 'rename',
        label: t('explorer.menu.rename'),
        disabled: !single,
        onClick: () => setRenamingPath(entry.path)
      },
      { id: 's2', separator: true },
      { id: 'cut', label: t('explorer.menu.cut'), onClick: () => pane.copySelection(true) },
      { id: 'copy', label: t('explorer.menu.copy'), onClick: () => pane.copySelection(false) },
      {
        id: 'paste',
        label: t('explorer.menu.paste'),
        disabled: pane.clipboard === null,
        onClick: () => void pane.paste()
      },
      { id: 's3', separator: true },
      { id: 'trash', label: t('explorer.menu.delete'), onClick: () => void pane.trashPaths(paths) },
      {
        id: 'delete',
        label: t('explorer.menu.deletePermanent'),
        danger: true,
        onClick: () => requestDelete(paths)
      }
    ]
  }

  const buildWindowsEntryMenu = (entry: FileEntry, paths: string[]): MenuItem[] => [
    { id: 'open', label: t('explorer.menu.open'), onClick: () => openEntry(entry) },
    {
      id: 'open-with-windows',
      label: t('explorer.menu.openWithWindows'),
      onClick: () => openNative(entry.path)
    },
    {
      id: 'reveal-windows',
      label: t('explorer.menu.revealInWindows'),
      onClick: () => openNative(adapter.parent(entry.path))
    },
    { id: 's1', separator: true },
    ...commonEntryItems(entry, paths),
    { id: 's4', separator: true },
    { id: 'copy-path', label: t('explorer.copyPath'), onClick: () => copyText(entry.path) },
    { id: 'copy-name', label: t('explorer.menu.copyFileName'), onClick: () => copyText(entry.name) },
    {
      id: 'copy-parent',
      label: t('explorer.menu.copyParentPath'),
      onClick: () => copyText(adapter.parent(entry.path))
    },
    { id: 's5', separator: true },
    {
      id: 'copy-to-other',
      label: t('explorer.copyToOther'),
      // Distinct silhouettes so the two panes' copy actions never look alike.
      icon: adapter.kind === 'linux' ? <RetroCopyIcon /> : <CopyIcon />,
      disabled: transferTarget() === null,
      onClick: () => copyToOther(paths)
    },
    { id: 's6', separator: true },
    {
      id: 'properties',
      label: t('explorer.properties.title'),
      onClick: () => props.onOpenProperties(entry.path, adapter.kind)
    }
  ]

  const buildLinuxEntryMenu = (entry: FileEntry, paths: string[]): MenuItem[] => [
    { id: 'open', label: t('explorer.menu.open'), onClick: () => openEntry(entry) },
    {
      id: 'open-windows',
      label: t('explorer.menu.openInWindows'),
      onClick: () => openNative(entry.path)
    },
    { id: 's1', separator: true },
    ...commonEntryItems(entry, paths),
    { id: 's4', separator: true },
    {
      id: 'copy-linux',
      label: t('explorer.menu.copyLinuxPath'),
      onClick: () => copyText(entry.path)
    },
    {
      id: 'copy-windows',
      label: t('explorer.menu.copyWindowsPath'),
      onClick: () => copyWindowsPath(entry.path)
    },
    { id: 'copy-name', label: t('explorer.menu.copyFileName'), onClick: () => copyText(entry.name) },
    {
      id: 'copy-parent',
      label: t('explorer.menu.copyParentPath'),
      onClick: () => copyText(adapter.parent(entry.path))
    },
    { id: 's5', separator: true },
    {
      id: 'copy-to-other',
      label: t('explorer.copyToOther'),
      // Distinct silhouettes so the two panes' copy actions never look alike.
      icon: adapter.kind === 'linux' ? <RetroCopyIcon /> : <CopyIcon />,
      disabled: transferTarget() === null,
      onClick: () => copyToOther(paths)
    },
    {
      id: 'export',
      label: t('explorer.menu.exportToWindows'),
      onClick: () => pickExport(paths)
    },
    {
      id: 'import',
      label: t('explorer.menu.importFromWindows'),
      onClick: () => pickImport()
    },
    { id: 's6', separator: true },
    {
      id: 'chmod',
      label: t('explorer.menu.prepareChmod'),
      onClick: () => prepare(`chmod ${entry.permissionsOctal ?? '755'} ${shQuote(entry.path)}`)
    },
    {
      id: 'chown',
      label: t('explorer.menu.prepareChown'),
      onClick: () =>
        prepare(`chown ${entry.owner ?? 'user'}:${entry.group ?? 'group'} ${shQuote(entry.path)}`)
    },
    {
      id: 'symlink',
      label: t('explorer.menu.prepareSymlink'),
      onClick: () => prepare(`ln -s ${shQuote(entry.path)} ${shQuote(`${entry.path}-link`)}`)
    },
    { id: 's7', separator: true },
    {
      id: 'properties',
      label: t('explorer.properties.title'),
      onClick: () => props.onOpenProperties(entry.path, adapter.kind)
    }
  ]

  const buildBackgroundMenu = (): MenuItem[] => {
    const dir = pane.path
    const atRoot = dir !== null && adapter.isRoot(dir)
    const items: MenuItem[] = [
      {
        id: 'new-file',
        label: t('explorer.menu.newFile'),
        disabled: dir === null || atRoot,
        onClick: () => setCreating('file')
      },
      {
        id: 'new-folder',
        label: t('explorer.menu.newFolder'),
        disabled: dir === null || atRoot,
        onClick: () => setCreating('folder')
      },
      { id: 's1', separator: true },
      {
        id: 'paste',
        label: t('explorer.menu.paste'),
        disabled: pane.clipboard === null || dir === null,
        onClick: () => void pane.paste()
      }
    ]
    if (adapter.kind === 'linux') {
      items.push({
        id: 'import',
        label: t('explorer.menu.importFromWindows'),
        disabled: dir === null,
        onClick: () => pickImport()
      })
      items.push({ id: 's2', separator: true })
      items.push({
        id: 'copy-linux',
        label: t('explorer.menu.copyLinuxPath'),
        disabled: dir === null,
        onClick: () => dir && copyText(dir)
      })
      items.push({
        id: 'copy-windows',
        label: t('explorer.menu.copyWindowsPath'),
        disabled: dir === null,
        onClick: () => dir && copyWindowsPath(dir)
      })
    } else {
      items.push({ id: 's2', separator: true })
      items.push({
        id: 'copy-path',
        label: t('explorer.copyPath'),
        disabled: dir === null || atRoot,
        onClick: () => dir && copyText(dir)
      })
      items.push({
        id: 'reveal-windows',
        label: t('explorer.menu.revealInWindows'),
        disabled: dir === null || atRoot,
        onClick: () => dir && openNative(dir)
      })
    }
    items.push({ id: 's3', separator: true })
    items.push({
      id: 'properties',
      label: t('explorer.properties.title'),
      disabled: dir === null || atRoot,
      onClick: () => dir && props.onOpenProperties(dir, adapter.kind)
    })
    return items
  }

  const statusText = (): string => {
    if (pane.selection.size === 1) {
      const p = [...pane.selection][0]
      return t('explorer.selected', { name: adapter.base(p), path: p })
    }
    if (pane.selection.size > 1) return t('explorer.selectedCount', { count: pane.selection.size })
    return pane.path === null ? '' : adapter.displayPath(pane.path)
  }

  // Only a bare path stays monospaced; the selection sentences are prose.
  const statusClass = pane.selection.size === 0 ? 'pane-status mono' : 'pane-status'

  const unavailable = props.unavailableMessage ?? null

  return (
    <section
      className={'file-pane' + (props.active ? ' is-active' : '')}
      data-testid={props.testId}
      aria-label={props.title}
      onMouseDownCapture={props.onActivate}
      onFocusCapture={props.onActivate}
    >
      <header className="pane-header">
        <PaneIcon kind={adapter.kind} />
        <span className="pane-title">{props.title}</span>
        {props.active && (
          <span className="pane-active-dot" title={t('explorer.pane.activeHint')} aria-hidden="true" />
        )}
        {/* Copying across the panes is the primary interaction, so it sits in
            the header rather than competing for room in the toolbar row. Each
            side keeps its own copy silhouette (modern vs retro) plus the
            direction chevron, so the two are never confused. */}
        <button
          type="button"
          className="pane-transfer"
          title={t('explorer.copyToOther')}
          aria-label={t('explorer.copyToOther')}
          disabled={pane.selection.size === 0 || transferTarget() === null}
          onClick={() => copyToOther(selectedPaths())}
        >
          {adapter.kind === 'windows' ? (
            <>
              <CopyIcon size={14} />
              <span aria-hidden="true">&#8250;</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">&#8249;</span>
              <RetroCopyIcon size={14} />
            </>
          )}
        </button>
      </header>

      {unavailable !== null ? (
        <div className="pane-unavailable">{unavailable}</div>
      ) : (
        <>
          <Toolbar
            adapter={adapter}
            path={pane.path}
            canBack={pane.canBack}
            canForward={pane.canForward}
            showHidden={pane.showHidden}
            searchQuery={pane.searchQuery}
            treeOpen={treeOpen}
            onBack={() => void pane.goBack()}
            onForward={() => void pane.goForward()}
            onUp={() => void pane.goUp()}
            onRefresh={() => void pane.refreshDir()}
            onHome={() => void pane.goHome()}
            onRoot={() => void pane.goRoot()}
            onNavigate={(p) => void pane.navigate(p)}
            onToggleHidden={() => void pane.toggleHidden()}
            onToggleTree={toggleTree}
            onSearch={(q) => void pane.runSearch(q)}
            onClearSearch={pane.clearSearch}
          />

          <div className="pane-body">
            {treeOpen && (
              <div className="pane-sidebar">
                {adapter.kind === 'windows' && (
                  <PlacesStrip onNavigate={(p) => void pane.navigate(p)} />
                )}
                <FolderTree
                  adapter={adapter}
                  currentPath={pane.path}
                  refreshToken={pane.refreshToken}
                  onNavigate={(p) => void pane.navigate(p)}
                  onDropPaths={(paths, dest, move) => void pane.dropPaths(paths, dest, move)}
                  onCrossDrop={props.onTransfer}
                />
              </div>
            )}
            <FileListView
              adapter={adapter}
              columns={adapter.kind === 'windows' ? WINDOWS_COLUMNS : LINUX_COLUMNS}
              ariaLabel={props.ariaLabel}
              entries={pane.visibleEntries}
              currentPath={pane.path}
              loading={pane.loading}
              error={pane.error}
              searchActive={pane.searchResults !== null}
              sortKey={pane.sortKey}
              sortDir={pane.sortDir}
              selection={pane.selection}
              clipboardCutPaths={pane.clipboard?.cut ? pane.clipboard.paths : null}
              creating={creating}
              renamingPath={renamingPath}
              onSort={pane.setSort}
              onSelectionChange={pane.setSelection}
              onNavigate={(p) => void pane.navigate(p)}
              onOpenFile={(entry) => props.onOpenEditor(entry.path, adapter.kind)}
              onContextMenu={(x, y, entry) => {
                const paths = entry
                  ? pane.selection.has(entry.path)
                    ? [...pane.selection]
                    : [entry.path]
                  : []
                props.onContextMenu(
                  x,
                  y,
                  entry
                    ? adapter.kind === 'windows'
                      ? buildWindowsEntryMenu(entry, paths)
                      : buildLinuxEntryMenu(entry, paths)
                    : buildBackgroundMenu()
                )
              }}
              onRenameStart={setRenamingPath}
              onRenameCommit={(p, newName) => {
                setRenamingPath(null)
                void pane.rename(p, newName)
              }}
              onRenameCancel={() => setRenamingPath(null)}
              onCreateCommit={(kind, name) => {
                setCreating(null)
                void pane.createEntry(kind, name)
              }}
              onCreateCancel={() => setCreating(null)}
              onCopy={pane.copySelection}
              onPaste={() => void pane.paste()}
              onTrash={() => void pane.trashPaths(selectedPaths())}
              onDeletePermanent={() => requestDelete(selectedPaths())}
              onDropPaths={(paths, dest, move) => void pane.dropPaths(paths, dest, move)}
              onCrossDrop={props.onTransfer}
              onDropExternalFiles={adapter.kind === 'linux' ? onDropExternalFiles : undefined}
              onDragOutStart={(paths) => {
                void adapter.startDrag(paths).catch(() => undefined)
              }}
            />
          </div>

          <footer className={statusClass}>{statusText()}</footer>
        </>
      )}
    </section>
  )
}
