import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry } from '@shared/types'
import { fileNameSchema } from '@shared/schemas'
import { VirtualList } from '../components/VirtualList'
import {
  formatBytes,
  formatDateTime,
  parentPath,
  resolveLinuxPath,
  type SortDir,
  type SortKey
} from './useExplorer'

export const INTERNAL_DND_TYPE = 'application/x-wslpad-paths'

export const FILE_ROW_HEIGHT = 28

interface FileListProps {
  entries: FileEntry[]
  currentPath: string | null
  loading: boolean
  error: string | null
  searchActive: boolean
  sortKey: SortKey
  sortDir: SortDir
  selection: Set<string>
  clipboardCutPaths: string[] | null
  creating: 'file' | 'folder' | null
  renamingPath: string | null
  onSort: (key: SortKey) => void
  onSelectionChange: (selection: Set<string>) => void
  onNavigate: (path: string) => void
  onOpenFile: (entry: FileEntry) => void
  onContextMenu: (x: number, y: number, entry: FileEntry | null) => void
  onRenameStart: (path: string) => void
  onRenameCommit: (path: string, newName: string) => void
  onRenameCancel: () => void
  onCreateCommit: (kind: 'file' | 'folder', name: string) => void
  onCreateCancel: () => void
  onCopy: (cut: boolean) => void
  onPaste: () => void
  onTrash: () => void
  onDeletePermanent: () => void
  onDropPaths: (paths: string[], destDir: string, move: boolean) => void
  onDropWindowsFiles: (files: FileList, destDir: string) => void
  onDragOutStart: (paths: string[]) => void
}

function TypeIcon({ entry }: { entry: FileEntry }): React.JSX.Element {
  const broken = entry.type === 'symlink' && entry.targetType === null
  const dirLike =
    entry.type === 'directory' || (entry.type === 'symlink' && entry.targetType === 'directory')
  return (
    <span
      className={
        'fl-typeicon' + (dirLike ? ' is-dir' : '') + (broken ? ' is-broken' : '')
      }
      title={entry.symlinkTarget ?? undefined}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        {dirLike ? (
          <path
            d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.8h5A1.5 1.5 0 0 1 14 6.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"
            fill="currentColor"
          />
        ) : (
          <path
            d="M4 1.5h5L12.5 5v9A.5.5 0 0 1 12 14.5H4A.5.5 0 0 1 3.5 14V2a.5.5 0 0 1 .5-.5zM9 1.5V5h3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        )}
        {entry.type === 'symlink' && (
          <path
            d="M9.5 12.5h4m0 0-1.6-1.6m1.6 1.6-1.6 1.6"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        )}
        {entry.type === 'symlink' && (
          <path
            d="M9.5 12.5h4m0 0-1.6-1.6m1.6 1.6-1.6 1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  )
}

function NameEditor({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const committed = useRef(false)
  const valid = fileNameSchema.safeParse(value).success
  return (
    <input
      type="text"
      className={valid ? 'fl-name-editor' : 'fl-name-editor invalid'}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && valid) {
          committed.current = true
          onCommit(value)
        } else if (e.key === 'Escape') {
          committed.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!committed.current) onCancel()
      }}
    />
  )
}

const COLUMNS: ReadonlyArray<{ key: SortKey; labelKey: string; className: string }> = [
  { key: 'name', labelKey: 'explorer.columns.name', className: 'fl-name' },
  { key: 'size', labelKey: 'explorer.columns.size', className: 'fl-size' },
  { key: 'mtime', labelKey: 'explorer.columns.modified', className: 'fl-mtime' },
  { key: 'owner', labelKey: 'explorer.columns.owner', className: 'fl-owner' },
  { key: 'group', labelKey: 'explorer.columns.group', className: 'fl-group' },
  { key: 'permissions', labelKey: 'explorer.columns.permissions', className: 'fl-perm' }
]

/** Virtualized file listing with selection, inline rename and DnD (goal.md §7.3–7.5). */
export function FileListView(props: FileListProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [anchorIndex, setAnchorIndex] = useState(0)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lang = i18n.language

  const { entries, selection } = props

  const selectSingle = (entry: FileEntry, index: number): void => {
    setAnchorIndex(index)
    props.onSelectionChange(new Set([entry.path]))
  }

  const handleRowClick = (e: React.MouseEvent, entry: FileEntry, index: number): void => {
    if (e.ctrlKey) {
      const next = new Set(selection)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      setAnchorIndex(index)
      props.onSelectionChange(next)
    } else if (e.shiftKey) {
      const lo = Math.min(anchorIndex, index)
      const hi = Math.max(anchorIndex, index)
      props.onSelectionChange(new Set(entries.slice(lo, hi + 1).map((en) => en.path)))
    } else {
      selectSingle(entry, index)
    }
  }

  const openEntry = (entry: FileEntry): void => {
    if (entry.type === 'directory') {
      props.onNavigate(entry.path)
    } else if (entry.type === 'symlink' && entry.targetType === 'directory') {
      props.onNavigate(resolveLinuxPath(parentPath(entry.path), entry.symlinkTarget ?? ''))
    } else if (entry.type === 'file' || entry.type === 'symlink') {
      props.onOpenFile(entry)
    }
  }

  const selectedEntries = (): FileEntry[] => entries.filter((en) => selection.has(en.path))

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'Enter') {
      const first = selectedEntries()[0]
      if (first) openEntry(first)
    } else if (e.key === 'Delete') {
      if (selection.size === 0) return
      if (e.shiftKey) props.onDeletePermanent()
      else props.onTrash()
    } else if (e.key === 'F2') {
      const sel = selectedEntries()
      if (sel.length === 1) props.onRenameStart(sel[0].path)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (entries.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = Math.min(entries.length - 1, Math.max(0, anchorIndex + delta))
      selectSingle(entries[next], next)
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      props.onCopy(false)
    } else if (e.ctrlKey && (e.key === 'x' || e.key === 'X')) {
      props.onCopy(true)
    } else if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
      props.onPaste()
    }
  }

  const handleDragStart = (e: React.DragEvent, entry: FileEntry): void => {
    let paths: string[]
    if (selection.has(entry.path)) {
      paths = [...selection]
    } else {
      paths = [entry.path]
      props.onSelectionChange(new Set(paths))
    }
    e.dataTransfer.setData(INTERNAL_DND_TYPE, JSON.stringify(paths))
    e.dataTransfer.effectAllowed = 'copyMove'
    props.onDragOutStart(paths)
  }

  const handleDrop = (e: React.DragEvent, destDir: string): void => {
    setDropTarget(null)
    const raw = e.dataTransfer.getData(INTERNAL_DND_TYPE)
    if (raw) {
      e.preventDefault()
      e.stopPropagation()
      try {
        const paths = JSON.parse(raw) as string[]
        if (Array.isArray(paths) && paths.length > 0) {
          // Windows convention: default move, Ctrl forces copy (goal.md §7.5)
          props.onDropPaths(
            paths.filter((p) => p !== destDir),
            destDir,
            !e.ctrlKey
          )
        }
      } catch {
        /* not an internal payload */
      }
      return
    }
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      props.onDropWindowsFiles(e.dataTransfer.files, destDir)
    }
  }

  const allowDrop = (e: React.DragEvent, target: string | null): void => {
    if (
      e.dataTransfer.types.includes(INTERNAL_DND_TYPE) ||
      e.dataTransfer.types.includes('Files')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
      setDropTarget(target)
    }
  }

  const renderRow = (entry: FileEntry, index: number): React.ReactNode => {
    const selected = selection.has(entry.path)
    const cut = props.clipboardCutPaths?.includes(entry.path) ?? false
    const isDir = entry.type === 'directory'
    const broken = entry.type === 'symlink' && entry.targetType === null
    return (
      <div
        key={entry.path}
        className={
          'fl-row' +
          (selected ? ' selected' : '') +
          (cut ? ' cut' : '') +
          (entry.isHidden ? ' hidden-entry' : '') +
          (broken ? ' broken-link' : '') +
          (dropTarget === entry.path ? ' drop-target' : '')
        }
        role="row"
        aria-selected={selected}
        draggable={props.renamingPath !== entry.path}
        onClick={(e) => handleRowClick(e, entry, index)}
        onDoubleClick={() => openEntry(entry)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!selected) selectSingle(entry, index)
          props.onContextMenu(e.clientX, e.clientY, entry)
        }}
        onDragStart={(e) => handleDragStart(e, entry)}
        onDragOver={isDir ? (e) => allowDrop(e, entry.path) : undefined}
        onDragLeave={isDir ? () => setDropTarget((d) => (d === entry.path ? null : d)) : undefined}
        onDrop={isDir ? (e) => handleDrop(e, entry.path) : undefined}
      >
        <TypeIcon entry={entry} />
        <span className="fl-name" title={props.searchActive ? entry.path : entry.name}>
          {props.renamingPath === entry.path ? (
            <NameEditor
              initial={entry.name}
              onCommit={(name) => props.onRenameCommit(entry.path, name)}
              onCancel={props.onRenameCancel}
            />
          ) : (
            <>
              {entry.name}
              {entry.symlinkTarget && (
                <span className="fl-linktarget mono"> → {entry.symlinkTarget}</span>
              )}
            </>
          )}
        </span>
        <span className="fl-size">{isDir ? '—' : formatBytes(entry.sizeBytes, lang)}</span>
        <span className="fl-mtime">{formatDateTime(entry.mtime, lang)}</span>
        <span className="fl-owner">{entry.owner ?? ''}</span>
        <span className="fl-group">{entry.group ?? ''}</span>
        <span className="fl-perm mono">{entry.permissions ?? ''}</span>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="file-list"
      tabIndex={0}
      role="grid"
      aria-label={t('tabs.explorer')}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onContextMenu(e.clientX, e.clientY, null)
      }}
      onDragOver={(e) => allowDrop(e, null)}
      onDrop={(e) => {
        if (props.currentPath) handleDrop(e, props.currentPath)
      }}
    >
      <div className="fl-header" role="row">
        <span className="fl-typeicon" />
        {COLUMNS.map((col) => (
          <button
            key={col.className}
            type="button"
            className={'fl-col ' + col.className + (props.sortKey === col.key ? ' sorted' : '')}
            aria-sort={
              props.sortKey === col.key
                ? props.sortDir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }
            onClick={() => props.onSort(col.key)}
          >
            {t(col.labelKey)}
            {props.sortKey === col.key && (
              <span aria-hidden="true">{props.sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
            )}
          </button>
        ))}
      </div>

      {props.creating && (
        <div className="fl-row fl-create-row" role="row">
          <TypeIcon
            entry={{
              name: '',
              path: '',
              type: props.creating === 'folder' ? 'directory' : 'file',
              sizeBytes: null,
              mtime: null,
              owner: null,
              group: null,
              permissions: null,
              permissionsOctal: null,
              isHidden: false,
              symlinkTarget: null,
              targetType: null
            }}
          />
          <span className="fl-name">
            <NameEditor
              initial={
                props.creating === 'folder' ? t('explorer.newFolderName') : t('explorer.newFileName')
              }
              onCommit={(name) => props.onCreateCommit(props.creating as 'file' | 'folder', name)}
              onCancel={props.onCreateCancel}
            />
          </span>
        </div>
      )}

      {props.error ? (
        <div className="fl-message error">
          <div>{t('explorer.loadError')}</div>
          <div className="fl-message-detail mono">{props.error}</div>
        </div>
      ) : entries.length === 0 && !props.loading && !props.creating ? (
        <div className="fl-message">{t('explorer.empty')}</div>
      ) : (
        <VirtualList
          items={entries}
          rowHeight={FILE_ROW_HEIGHT}
          overscan={8}
          className="fl-body"
          render={renderRow}
        />
      )}

      {props.loading && <div className="fl-loading">{t('common.loading')}</div>}
    </div>
  )
}
