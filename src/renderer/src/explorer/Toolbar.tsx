import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyIcon, RetroCopyIcon } from '../components/Icons'
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
  transferDirection: 'left' | 'right'
  transferDisabled: boolean
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onRefresh: () => void
  onHome: () => void
  onRoot: () => void
  onNavigate: (path: string) => void
  onToggleHidden: () => void
  onToggleTree: () => void
  onTransfer: () => void
  onSearch: (query: string) => void
  onClearSearch: () => void
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
  chevronLeft: 'M10 3.5 5.5 8 10 12.5'
} as const

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [pathText, setPathText] = useState(props.path ?? '')
  const [searchText, setSearchText] = useState(props.searchQuery)

  useEffect(() => {
    setPathText(props.path ?? '')
  }, [props.path])
  useEffect(() => {
    setSearchText(props.searchQuery)
  }, [props.searchQuery])

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

  const atRoot = props.path === null || props.adapter.isRoot(props.path)
  const sep = <span className="exp-toolsep" aria-hidden="true" />

  return (
    <div className="exp-toolbar">
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

      <div className="exp-pathbox">
        {editing || props.path === null ? (
          <input
            type="text"
            className="exp-pathinput mono"
            placeholder={t('explorer.pathPlaceholder')}
            aria-label={t('explorer.pathPlaceholder')}
            value={pathText}
            autoFocus={editing}
            onChange={(e) => setPathText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                props.onNavigate(pathText)
                setEditing(false)
              } else if (e.key === 'Escape') {
                setPathText(props.path ?? '')
                setEditing(false)
              }
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <Breadcrumb
            adapter={props.adapter}
            path={props.path}
            onNavigate={props.onNavigate}
            onEdit={() => setEditing(true)}
          />
        )}
      </div>

      <input
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

      {sep}

      {/* Each pane gets its own copy silhouette — modern sheets going right on
          Windows, the retro duplicate mark coming left on WSL — so the two
          cross-pane copies are never confused at 16px. */}
      <button
        type="button"
        className="exp-toolbtn transfer"
        title={t('explorer.copyToOther')}
        aria-label={t('explorer.copyToOther')}
        disabled={props.transferDisabled}
        onClick={props.onTransfer}
      >
        {props.transferDirection === 'right' ? (
          <>
            <CopyIcon size={14} />
            <Glyph d={GLYPHS.chevronRight} size={10} />
          </>
        ) : (
          <>
            <Glyph d={GLYPHS.chevronLeft} size={10} />
            <RetroCopyIcon size={14} />
          </>
        )}
      </button>
    </div>
  )
}
