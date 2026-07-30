import { useTranslation } from 'react-i18next'
import type { FsAdapter } from './fsAdapter'

interface BreadcrumbProps {
  adapter: FsAdapter
  path: string
  onNavigate: (path: string) => void
  onEdit: () => void
}

const MAX_DEPTH = 64

/** Walk up with the adapter so Windows and Linux share one crumb renderer. */
function crumbs(adapter: FsAdapter, path: string): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = []
  let current = path
  for (let i = 0; i < MAX_DEPTH && !adapter.isRoot(current); i++) {
    out.unshift({ label: adapter.base(current), path: current })
    const parent = adapter.parent(current)
    if (parent === current) break
    current = parent
  }
  return out
}

/** Clickable path segments; clicking the empty tail switches to text editing. */
export function Breadcrumb({
  adapter,
  path,
  onNavigate,
  onEdit
}: BreadcrumbProps): React.JSX.Element {
  const { t } = useTranslation()
  const parts = crumbs(adapter, path)
  const rootLabel = adapter.displayPath(adapter.rootPath)

  return (
    <div className="breadcrumb">
      <button
        type="button"
        className="breadcrumb-seg"
        title={rootLabel}
        onClick={() => onNavigate(adapter.rootPath)}
      >
        {rootLabel}
      </button>
      {parts.map((part) => (
        <span key={part.path} className="breadcrumb-part">
          <span className="breadcrumb-sep" aria-hidden="true">
            ›
          </span>
          <button
            type="button"
            className="breadcrumb-seg"
            title={part.path}
            onClick={() => onNavigate(part.path)}
          >
            {part.label}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="breadcrumb-edit"
        aria-label={t('explorer.pathPlaceholder')}
        onClick={onEdit}
      />
    </div>
  )
}
