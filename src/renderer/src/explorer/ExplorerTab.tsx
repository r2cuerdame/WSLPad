import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { useApp } from '../store'
import { Toolbar } from './Toolbar'
import { FolderTree } from './FolderTree'
import { FileListView } from './FileList'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { EditorOverlay } from './EditorOverlay'
import { PropertiesDialog } from './PropertiesDialog'
import { TransferProgress } from './TransferProgress'
import {
  baseName,
  extractWindowsPaths,
  parentPath,
  shQuote,
  useExplorer
} from './useExplorer'
import './explorer.css'

interface MenuState {
  x: number
  y: number
  entry: FileEntry | null
}

/** Explorer main tab (goal.md §7): tree + list + editor overlay + transfers. */
export function ExplorerTab(): React.JSX.Element {
  const { t } = useTranslation()
  const { pushToast, prepareCommand } = useApp()
  const ex = useExplorer()

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editorPath, setEditorPath] = useState<string | null>(null)
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

  const selectedPaths = (): string[] => [...ex.selection]

  const copyLinuxPath = (p: string): void => {
    void window.wslpad.copyToClipboard(p).then(() => pushToast('success', t('toast.copiedPath')))
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

  const copyText = (text: string): void => {
    void window.wslpad.copyToClipboard(text).then(() => pushToast('success', t('toast.copiedPath')))
  }

  const openInWindows = (p: string): void => {
    void window.wslpad.openInWindowsExplorer(p).catch(() => pushToast('error', t('errors.pathConversionFailed')))
  }

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const openEntry = (entry: FileEntry): void => {
    if (entry.type === 'directory') void ex.navigate(entry.path)
    else setEditorPath(entry.path)
  }

  const onDropWindowsFiles = (files: FileList, destDir: string): void => {
    const winPaths = extractWindowsPaths(files)
    if (winPaths.length > 0) {
      void ex.importWindows(winPaths, destDir)
    } else {
      // Electron no longer exposes File.path in the renderer for every drop
      pushToast(
        'info',
        t('explorer.dropUseImport', {
          defaultValue: 'Use "Import from Windows…" in the context menu to copy these files'
        })
      )
    }
  }

  const buildEntryMenu = (entry: FileEntry): MenuItem[] => {
    const paths = selectedPaths()
    const single = paths.length === 1
    return [
      { id: 'open', label: t('explorer.menu.open'), onClick: () => openEntry(entry) },
      {
        id: 'open-windows',
        label: t('explorer.menu.openInWindows'),
        onClick: () => openInWindows(entry.path)
      },
      { id: 's1', separator: true },
      { id: 'new-file', label: t('explorer.menu.newFile'), onClick: () => setCreating('file') },
      { id: 'new-folder', label: t('explorer.menu.newFolder'), onClick: () => setCreating('folder') },
      {
        id: 'rename',
        label: t('explorer.menu.rename'),
        disabled: !single,
        onClick: () => setRenamingPath(entry.path)
      },
      { id: 's2', separator: true },
      { id: 'cut', label: t('explorer.menu.cut'), onClick: () => ex.copySelection(true) },
      { id: 'copy', label: t('explorer.menu.copy'), onClick: () => ex.copySelection(false) },
      {
        id: 'paste',
        label: t('explorer.menu.paste'),
        disabled: ex.clipboard === null,
        onClick: () => void ex.paste()
      },
      { id: 's3', separator: true },
      {
        id: 'trash',
        label: t('explorer.menu.delete'),
        onClick: () => void ex.trashPaths(paths)
      },
      {
        id: 'delete',
        label: t('explorer.menu.deletePermanent'),
        danger: true,
        onClick: () => setConfirmDelete(paths)
      },
      { id: 's4', separator: true },
      {
        id: 'copy-linux',
        label: t('explorer.menu.copyLinuxPath'),
        onClick: () => copyLinuxPath(entry.path)
      },
      {
        id: 'copy-windows',
        label: t('explorer.menu.copyWindowsPath'),
        onClick: () => copyWindowsPath(entry.path)
      },
      {
        id: 'copy-name',
        label: t('explorer.menu.copyFileName'),
        onClick: () => copyText(entry.name)
      },
      {
        id: 'copy-parent',
        label: t('explorer.menu.copyParentPath'),
        onClick: () => copyText(parentPath(entry.path))
      },
      { id: 's5', separator: true },
      {
        id: 'export',
        label: t('explorer.menu.exportToWindows'),
        onClick: () => void ex.exportSelected(paths)
      },
      {
        id: 'import',
        label: t('explorer.menu.importFromWindows'),
        onClick: () => void ex.importPicked()
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
        onClick: () => setPropertiesPath(entry.path)
      }
    ]
  }

  const buildBackgroundMenu = (): MenuItem[] => {
    const dir = ex.path
    return [
      { id: 'new-file', label: t('explorer.menu.newFile'), onClick: () => setCreating('file') },
      { id: 'new-folder', label: t('explorer.menu.newFolder'), onClick: () => setCreating('folder') },
      { id: 's1', separator: true },
      {
        id: 'paste',
        label: t('explorer.menu.paste'),
        disabled: ex.clipboard === null,
        onClick: () => void ex.paste()
      },
      {
        id: 'import',
        label: t('explorer.menu.importFromWindows'),
        onClick: () => void ex.importPicked()
      },
      { id: 's2', separator: true },
      {
        id: 'copy-linux',
        label: t('explorer.menu.copyLinuxPath'),
        disabled: dir === null,
        onClick: () => dir && copyLinuxPath(dir)
      },
      {
        id: 'copy-windows',
        label: t('explorer.menu.copyWindowsPath'),
        disabled: dir === null,
        onClick: () => dir && copyWindowsPath(dir)
      },
      { id: 's3', separator: true },
      {
        id: 'properties',
        label: t('explorer.properties.title'),
        disabled: dir === null,
        onClick: () => dir && setPropertiesPath(dir)
      }
    ]
  }

  const selectionSummary = (): string | null => {
    if (ex.selection.size === 1) {
      const p = [...ex.selection][0]
      return t('explorer.selected', { name: baseName(p), path: p })
    }
    if (ex.selection.size > 1) return t('explorer.selectedCount', { count: ex.selection.size })
    return ex.path
  }

  return (
    <div className="explorer-tab">
      <Toolbar
        path={ex.path}
        canBack={ex.canBack}
        canForward={ex.canForward}
        showHidden={ex.showHidden}
        searchQuery={ex.searchQuery}
        onBack={() => void ex.goBack()}
        onForward={() => void ex.goForward()}
        onUp={() => void ex.goUp()}
        onRefresh={() => void ex.refreshDir()}
        onHome={() => void ex.goHome()}
        onRoot={() => void ex.goRoot()}
        onNavigate={(p) => void ex.navigate(p)}
        onToggleHidden={() => void ex.toggleHidden()}
        onSearch={(q) => void ex.runSearch(q)}
        onClearSearch={ex.clearSearch}
      />

      <div className="explorer-body">
        <FolderTree
          currentPath={ex.path}
          refreshToken={ex.refreshToken}
          onNavigate={(p) => void ex.navigate(p)}
          onDropPaths={(paths, dest, move) => void ex.dropPaths(paths, dest, move)}
        />
        <FileListView
          entries={ex.visibleEntries}
          currentPath={ex.path}
          loading={ex.loading}
          error={ex.error}
          searchActive={ex.searchResults !== null}
          sortKey={ex.sortKey}
          sortDir={ex.sortDir}
          selection={ex.selection}
          clipboardCutPaths={ex.clipboard?.cut ? ex.clipboard.paths : null}
          creating={creating}
          renamingPath={renamingPath}
          onSort={ex.setSort}
          onSelectionChange={ex.setSelection}
          onNavigate={(p) => void ex.navigate(p)}
          onOpenFile={(entry) => setEditorPath(entry.path)}
          onContextMenu={(x, y, entry) =>
            setMenu({ x, y, entry })
          }
          onRenameStart={setRenamingPath}
          onRenameCommit={(p, newName) => {
            setRenamingPath(null)
            void ex.rename(p, newName)
          }}
          onRenameCancel={() => setRenamingPath(null)}
          onCreateCommit={(kind, name) => {
            setCreating(null)
            void ex.createEntry(kind, name)
          }}
          onCreateCancel={() => setCreating(null)}
          onCopy={ex.copySelection}
          onPaste={() => void ex.paste()}
          onTrash={() => void ex.trashPaths(selectedPaths())}
          onDeletePermanent={() => setConfirmDelete(selectedPaths())}
          onDropPaths={(paths, dest, move) => void ex.dropPaths(paths, dest, move)}
          onDropWindowsFiles={onDropWindowsFiles}
          onDragOutStart={(paths) => {
            void window.wslpad.explorer.startDrag(paths).catch(() => undefined)
          }}
        />
      </div>

      <footer className="explorer-status mono">{selectionSummary()}</footer>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.entry ? buildEntryMenu(menu.entry) : buildBackgroundMenu()}
          onClose={() => setMenu(null)}
        />
      )}

      {editorPath && <EditorOverlay path={editorPath} onClose={() => setEditorPath(null)} />}

      {propertiesPath && (
        <PropertiesDialog path={propertiesPath} onClose={() => setPropertiesPath(null)} />
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
                const paths = confirmDelete ?? []
                setConfirmDelete(null)
                void ex.deletePaths(paths)
              }}
            >
              {t('explorer.menu.deletePermanent')}
            </button>
          </>
        }
      >
        {t('explorer.confirmDeleteBody', { count: confirmDelete?.length ?? 0 })}
      </Dialog>

      <TransferProgress />
    </div>
  )
}

export default ExplorerTab
