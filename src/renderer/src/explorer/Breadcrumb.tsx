import { useTranslation } from 'react-i18next'

interface BreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
  onEdit: () => void
}

/** Clickable path segments; clicking the empty tail switches to text editing. */
export function Breadcrumb({ path, onNavigate, onEdit }: BreadcrumbProps): React.JSX.Element {
  const { t } = useTranslation()
  const segments = path.split('/').filter(Boolean)
  const prefixes: string[] = []
  let acc = ''
  for (const seg of segments) {
    acc += `/${seg}`
    prefixes.push(acc)
  }

  return (
    <div className="breadcrumb">
      <button
        type="button"
        className="breadcrumb-seg"
        title="/"
        onClick={() => onNavigate('/')}
      >
        /
      </button>
      {segments.map((seg, i) => (
        <span key={prefixes[i]} className="breadcrumb-part">
          {i > 0 && (
            <span className="breadcrumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          <button
            type="button"
            className="breadcrumb-seg"
            title={prefixes[i]}
            onClick={() => onNavigate(prefixes[i])}
          >
            {seg}
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
