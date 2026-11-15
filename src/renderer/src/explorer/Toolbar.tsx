import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CopyButton from '../components/CopyButton'
import { Breadcrumb } from './Breadcrumb'
import type { FsAdapter } from './fsAdapter'

interface ToolbarProps {
  adapter: FsAdapter
  path: string | null
  canBack: boolean
  canForward: boolean
  showHidden: boolean
  searchQuery: string
  treeOpen: boolean
  /** 'right' on the Windows pane, 'left' on the WSL pane. */
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onRefresh: () => void
  onHome: () => void
  onRoot: () => void
  onNavigate: (path: string) => void
  onToggleHidden: () => void
  onToggleTree: () => void
  onSearch: (query: string) => void
  onClearSearch: () => void
  /** Absent on a filesystem whose sizes cannot be measured. */
  onMeasure?: () => void
  measureActive?: boolean
  /** Only the WSL pane has a trash to open — Windows has the Recycle Bin. */
  onOpenTrash?: () => void
}

function Glyph({ d, size = 14 }: { d: string; size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const GLYPHS = {
  back: 'M10 3 5 8l5 5',
  forward: 'M6 3l5 5-5 5',
  up: 'M8 13V3M4 7l4-4 4 4',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V6H10',
  home: 'M2.5 8 8 2.5 13.5 8M4.5 7v6.5h7V7',
  root: 'M10 2.5 6 13.5',
  eye: 'M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8zM8 6.3A1.7 1.7 0 1 0 8 9.7 1.7 1.7 0 0 0 8 6.3z',
  tree: 'M2.5 4h11M5.5 8h8M5.5 12h8M2.5 4v8',
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronLeft: 'M10 3.5 5.5 8 10 12.5',
  // Three bars of falling length: the sorted result the action produces.
  sizes: 'M2.5 4h11M2.5 8h7M2.5 12h3.5',
  // A bin with a lid, which is what every file manager draws here.
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v3.5M9.2 7v3.5',
  clear: 'M4.5 4.5l7 7M11.5 4.5l-7 7'
} as const

/** Anything open on top of the panes owns the keyboard until it closes. */
const OVERLAY_SELECTOR =
  '.dialog-overlay, .editor-overlay, .ctx-overlay, .settings-overlay, .drawer-overlay'

function isEditable(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

/**
 * Whether this toolbar should answer window-level shortcuts: its tab is shown,
 * nothing modal is open, and it belongs to the active pane (or is the only one).
 */
function shortcutsLive(root: HTMLElement): boolean {
  for (let el: HTMLElement | null = root; el; el = el.parentElement) {
    if (el.hidden || el.style.display === 'none') return false
  }
  if (document.querySelector(OVERLAY_SELECTOR)) return false
  const pane = root.closest('.file-pane')
  if (pane && !pane.classList.contains('is-active')) {
    return document.querySelectorAll('.file-pane').length === 1
  }
  return true
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  // "This PC" is a virtual location: its internal id is never something to edit or copy.
  const editablePath =
    props.path === null || (props.adapter.kind === 'windows' && props.adapter.isRoot(props.path))
      ? ''
      : props.path
  const [editing, setEditing] = useState(false)
  const [pathText, setPathText] = useState(editablePath)
  const [searchText, setSearchText] = useState(props.searchQuery)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPathText(editablePath)
  }, [editablePath])
  useEffect(() => {
    setSearchText(props.searchQuery)
  }, [props.searchQuery])
  useEffect(() => {
    if (!editing) return
    pathInputRef.current?.focus()
    pathInputRef.current?.select()
  }, [editing])

  const atRoot = props.path === null || props.adapter.isRoot(props.path)
  const pathInputShown = editing || props.path === null

  const startEditing = (): void => {
    if (pathInputShown) {
      pathInputRef.current?.focus()
      pathInputRef.current?.select()
      return
    }
    setPathText(editablePath)
    setEditing(true)
  }

  const submitPath = async (raw: string): Promise<void> => {
    const text = raw.trim()
    const { adapter } = props
    let target = text
    if (adapter.kind === 'windows') {
      if (text === '' || text === adapter.displayPath(adapter.rootPath)) target = adapter.rootPath
    } else if (text === '~' || text.startsWith('~/')) {
      const home = await adapter.home()
      const suffix = text.slice(1)
      target = suffix === '' ? home : home === '/' ? suffix : home + suffix
    }
    props.onNavigate(target)
  }

  const clearSearch = (): void => {
    setSearchText('')
    props.onClearSearch()
    searchInputRef.current?.focus()
  }

  // The handler reads the latest render through a ref, so it binds only once.
  const shortcutState = useRef({ props, atRoot, startEditing })
  shortcutState.current = { props, atRoot, startEditing }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const root = toolbarRef.current
      if (e.defaultPrevented || e.metaKey || !root || !shortcutsLive(root)) return
      const { props: p, atRoot: rootNow, startEditing: edit } = shortcutState.current
      const focused = document.activeElement
      const typing = isEditable(focused)
      // A rename box or the console keeps its own Ctrl+L / Ctrl+F / Alt+D.
      if (typing && !(focused instanceof Node && root.contains(focused))) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const ctrlOnly = e.ctrlKey && !e.altKey && !e.shiftKey
      const altOnly = e.altKey && !e.ctrlKey && !e.shiftKey

      if ((ctrlOnly && key === 'l') || (altOnly && key === 'd')) {
        e.preventDefault()
        edit()
      } else if (ctrlOnly && key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if (typing || e.ctrlKey || e.shiftKey) {
        return
      } else if (e.altKey && key === 'ArrowLeft') {
        e.preventDefault()
        if (p.canBack) p.onBack()
      } else if (e.altKey && key === 'ArrowRight') {
        e.preventDefault()
        if (p.canForward) p.onForward()
      } else if (e.altKey && key === 'ArrowUp') {
        e.preventDefault()
        if (!rootNow) p.onUp()
      } else if (!e.altKey && key === 'F5') {
        e.preventDefault()
        p.onRefresh()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navButton = (
    label: string,
    glyph: string,
    onClick: () => void,
    disabled = false
  ): React.JSX.Element => (
    <button
      type="button"
      className="exp-toolbtn"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Glyph d={glyph} />
    </button>
  )

  const sep = <span className="exp-toolsep" aria-hidden="true" />
  const measureLabel = t('explorer.dirSizes.action', { defaultValue: 'Measure directory sizes' })
  const clearLabel = t('common.close')

  return (
    <div className="exp-toolbar" ref={toolbarRef}>
      {navButton(t('explorer.back'), GLYPHS.back, props.onBack, !props.canBack)}
      {navButton(t('explorer.forward'), GLYPHS.forward, props.onForward, !props.canForward)}
      {navButton(t('explorer.up'), GLYPHS.up, props.onUp, atRoot)}
      {sep}
      {navButton(t('explorer.refresh'), GLYPHS.refresh, props.onRefresh)}
      {navButton(t('explorer.home'), GLYPHS.home, props.onHome)}
      {navButton(t('explorer.root'), GLYPHS.root, props.onRoot)}

      <button
        type="button"
        className={props.treeOpen ? 'exp-toolbtn active' : 'exp-toolbtn'}
        title={t('explorer.toggleTree')}
        aria-label={t('explorer.toggleTree')}
        aria-pressed={props.treeOpen}
        onClick={props.onToggleTree}
      >
        <Glyph d={GLYPHS.tree} />
      </button>

      {props.onOpenTrash && (
        <button
          type="button"
          className="exp-toolbtn"
          title={t('explorer.trashTitle', { defaultValue: 'Trash' })}
          aria-label={t('explorer.trashTitle', { defaultValue: 'Trash' })}
          onClick={props.onOpenTrash}
        >
          <Glyph d={GLYPHS.trash} />
        </button>
      )}

      {props.onMeasure && (
        <button
          type="button"
          className={props.measureActive ? 'exp-toolbtn active' : 'exp-toolbtn'}
          title={measureLabel}
          aria-label={measureLabel}
          aria-pressed={props.measureActive ?? false}
          disabled={props.path === null}
          onClick={props.onMeasure}
        >
          <Glyph d={GLYPHS.sizes} />
        </button>
      )}

      <div className="exp-pathbox">
        {pathInputShown ? (
          <input
            ref={pathInputRef}
            type="text"
            className="exp-pathinput mono"
            placeholder={t('explorer.pathPlaceholder')}
            aria-label={t('explorer.pathPlaceholder')}
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEditing(false)
                void submitPath(pathText)
              } else if (e.key === 'Escape') {
                setPathText(editablePath)
                setEditing(false)
              }
            }}
            onBlur={() => {
              // Leaving the box abandons a half-typed path instead of keeping it for next time.
              setPathText(editablePath)
              setEditing(false)
            }}
          />
        ) : (
          <Breadcrumb
            adapter={props.adapter}
            path={props.path as string}
            onNavigate={props.onNavigate}
            onEdit={startEditing}
          />
        )}
        {!pathInputShown && editablePath.length > 0 && (
          <CopyButton
            text={editablePath}
            labelKey="explorer.copyPath"
            toastKey="toast.copiedPath"
            className="exp-toolbtn"
            size={13}
          />
        )}
      </div>

      <input
        ref={searchInputRef}
        type="text"
        className="exp-search"
        placeholder={t('explorer.searchPlaceholder')}
        aria-label={t('explorer.searchPlaceholder')}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            props.onSearch(searchText)
          } else if (e.key === 'Escape') {
            setSearchText('')
            props.onClearSearch()
          }
        }}
      />
      {(searchText.length > 0 || props.searchQuery.length > 0) && (
        <button
          type="button"
          className="exp-toolbtn"
          title={clearLabel}
          aria-label={clearLabel}
          onClick={clearSearch}
        >
          <Glyph d={GLYPHS.clear} size={12} />
        </button>
      )}

      <button
        type="button"
        className={props.showHidden ? 'exp-toolbtn active' : 'exp-toolbtn'}
        title={props.showHidden ? t('explorer.hideHidden') : t('explorer.showHidden')}
        aria-label={props.showHidden ? t('explorer.hideHidden') : t('explorer.showHidden')}
        aria-pressed={props.showHidden}
        onClick={props.onToggleHidden}
      >
        <Glyph d={GLYPHS.eye} />
      </button>

    </div>
  )
}
