import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileEntry, FsKind, PathSide } from '@shared/types'
import { fileNameSchema } from '@shared/schemas'
import { VirtualList } from '../components/VirtualList'
import { SideBadge } from '../components/SideBadge'
import { entrySide, resolveLinuxPath, type FsAdapter } from './fsAdapter'
import { formatBytes, formatDateTime, type SortDir, type SortKey } from './usePane'

export const INTERNAL_DND_TYPE = 'application/x-wslpad-paths'

export const FILE_ROW_HEIGHT = 28

/** Payload carried by an internal drag so the drop side knows the source fs. */
export interface DragPayload {
  fs: FsKind
  paths: string[]
}

export function encodeDragPayload(fs: FsKind, paths: string[]): string {
  return JSON.stringify({ fs, paths } satisfies DragPayload)
}

export function decodeDragPayload(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DragPayload>
    if (parsed?.fs !== 'windows' && parsed?.fs !== 'linux') return null
    if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) return null
    return { fs: parsed.fs, paths: parsed.paths.filter((p) => typeof p === 'string') }
  } catch {
    return null
  }
}

export interface ColumnSpec {
  key: SortKey
  labelKey: string
  className: string
  width: string
}

/** Windows has no POSIX ownership columns (goal.md §7.3 applies to the WSL side). */
export const WINDOWS_COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', labelKey: 'explorer.columns.name', className: 'fl-name', width: 'minmax(120px, 1fr)' },
  { key: 'size', labelKey: 'explorer.columns.size', className: 'fl-size', width: '80px' },
  { key: 'mtime', labelKey: 'explorer.columns.modified', className: 'fl-mtime', width: '140px' }
]

export const LINUX_COLUMNS: readonly ColumnSpec[] = [
  ...WINDOWS_COLUMNS,
  { key: 'owner', labelKey: 'explorer.columns.owner', className: 'fl-owner', width: '80px' },
  { key: 'group', labelKey: 'explorer.columns.group', className: 'fl-group', width: '80px' },
  {
    key: 'permissions',
    labelKey: 'explorer.columns.permissions',
    className: 'fl-perm',
    width: '100px'
  }
]

interface FileListProps {
  adapter: FsAdapter
  columns: readonly ColumnSpec[]
  ariaLabel: string
  entries: FileEntry[]
  currentPath: string | null
  loading: boolean
  error: string | null
  searchActive: boolean
  sortKey: SortKey
  sortDir: SortDir
  selection: Set<string>
  /** [automount] root in force, so /mnt is not assumed (see path-boundary). */
  automountRoot: string
  /** Side of the directory being listed; rows that match it stay unmarked. */
  paneSide: PathSide
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
  /** Drop coming from the other pane: always a cross-filesystem copy. */
  onCrossDrop: (from: FsKind, paths: string[], destDir: string) => void
  /** Windows Explorer drop (WSL pane only). */
  onDropExternalFiles?: (files: FileList, destDir: string) => void
  onDragOutStart: (paths: string[]) => void
}

function TypeIcon({ entry }: { entry: FileEntry }): React.JSX.Element {
  const broken = entry.type === 'symlink' && entry.targetType === null
  const dirLike =
    entry.type === 'directory' || (entry.type === 'symlink' && entry.targetType === 'directory')
  return (
    <span
      className={'fl-typeicon' + (dirLike ? ' is-dir' : '') + (broken ? ' is-broken' : '')}
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

/** Virtualized file listing with selection, inline rename and DnD (goal.md §7.3–7.5). */
export function FileListView(props: FileListProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [anchorIndex, setAnchorIndex] = useState(0)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const lang = i18n.language

  const { adapter, columns, entries, selection } = props
  const gridTemplate = `26px ${columns.map((c) => c.width).join(' ')}`

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
      const target = entry.symlinkTarget ?? ''
      props.onNavigate(
        adapter.kind === 'linux' ? resolveLinuxPath(adapter.parent(entry.path), target) : target
      )
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
    e.dataTransfer.setData(INTERNAL_DND_TYPE, encodeDragPayload(adapter.kind, paths))
    e.dataTransfer.effectAllowed = 'copyMove'
    props.onDragOutStart(paths)
  }

  const handleDrop = (e: React.DragEvent, destDir: string): void => {
    setDropTarget(null)
    const raw = e.dataTransfer.getData(INTERNAL_DND_TYPE)
    if (raw) {
      e.preventDefault()
      e.stopPropagation()
      const payload = decodeDragPayload(raw)
      if (!payload) return
      if (payload.fs !== adapter.kind) {
        // Cross-filesystem drops always copy — a transfer never deletes the source.
        props.onCrossDrop(payload.fs, payload.paths, destDir)
        return
      }
      // Windows convention inside one filesystem: move by default, Ctrl copies.
      props.onDropPaths(
        payload.paths.filter((p) => p !== destDir),
        destDir,
        !e.ctrlKey
      )
      return
    }
    if (props.onDropExternalFiles && e.dataTransfer.files.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      props.onDropExternalFiles(e.dataTransfer.files, destDir)
    }
  }

  const allowDrop = (e: React.DragEvent, target: string | null): void => {
    const types = e.dataTransfer.types
    if (types.includes(INTERNAL_DND_TYPE) || (props.onDropExternalFiles && types.includes('Files'))) {
      e.preventDefault()
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
      setDropTarget(target)
    }
  }

  const cellValue = (entry: FileEntry, col: ColumnSpec): React.ReactNode => {
    switch (col.key) {
      case 'size':
        return entry.type === 'directory' ? '—' : formatBytes(entry.sizeBytes, lang)
      case 'mtime':
        return formatDateTime(entry.mtime, lang)
      case 'owner':
        return entry.owner ?? ''
      case 'group':
        return entry.group ?? ''
      case 'permissions':
        return entry.permissions ?? ''
      default:
        return ''
    }
  }

  const renderRow = (entry: FileEntry, index: number): React.ReactNode => {
    const selected = selection.has(entry.path)
    const cut = props.clipboardCutPaths?.includes(entry.path) ?? false
    const isDir = entry.type === 'directory'
    const broken = entry.type === 'symlink' && entry.targetType === null
    // Only rows that differ from the directory itself are marked: inside
    // /mnt/c every row crosses the boundary, and a badge on all of them would
    // say nothing the pane's own chip has not already said.
    const side = entrySide(entry, props.automountRoot)
    const marked = side !== props.paneSide
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
        style={{ gridTemplateColumns: gridTemplate }}
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
              {marked && <SideBadge side={side} />}
            </>
          )}
        </span>
        {columns.slice(1).map((col) => (
          <span key={col.key} className={col.className + (col.key === 'permissions' ? ' mono' : '')}>
            {cellValue(entry, col)}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div
      className="file-list"
      tabIndex={0}
      role="grid"
      aria-label={props.ariaLabel}
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
      <div className="fl-header" role="row" style={{ gridTemplateColumns: gridTemplate }}>
        <span className="fl-typeicon" />
        {columns.map((col) => (
          <button
            key={col.key}
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
        <div className="fl-row fl-create-row" role="row" style={{ gridTemplateColumns: gridTemplate }}>
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
