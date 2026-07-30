import { useTranslation } from 'react-i18next'
import type { DirSizeEntry } from '@shared/types'
import { CloseIcon } from '../components/Icons'
import type { DirSizeState } from './usePane'
import { formatBytes } from './usePane'

export interface DirSizesPanelProps {
  state: DirSizeState
  onCancel: () => void
  onClose: () => void
}

/** Widest measured entry, so the bars compare children to each other. */
function largest(entries: DirSizeEntry[]): number {
  let max = 0
  for (const entry of entries) if (entry.sizeBytes !== null && entry.sizeBytes > max) max = entry.sizeBytes
  return max
}

/**
 * Per-directory sizes, largest first, inside the pane (issue #31).
 *
 * It answers "where did the 40 GB go" without installing ncdu in the distro
 * and without opening a second window. Nothing here deletes anything: the
 * Trash flow in the listing stays the only way to remove a file, so reading
 * the numbers never becomes a mutation surface.
 */
export function DirSizesPanel(props: DirSizesPanelProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { state } = props
  if (state.status === 'closed') return null

  const lang = i18n.language
  const result = state.result
  const max = result === null ? 0 : largest(result.entries)

  const size = (entry: DirSizeEntry): string =>
    entry.sizeBytes === null
      ? t('explorer.dirSizes.unmeasured', { defaultValue: 'Not measured' })
      : (entry.partial ? '≥ ' : '') + formatBytes(entry.sizeBytes, lang)

  return (
    <section
      className="dir-sizes"
      aria-label={t('explorer.dirSizes.title', { defaultValue: 'Directory sizes' })}
      aria-busy={state.status === 'running'}
    >
      <header className="dir-sizes-head">
        <span className="dir-sizes-title">
          {t('explorer.dirSizes.title', { defaultValue: 'Directory sizes' })}
        </span>
        <span className="dir-sizes-path mono truncate" title={state.path ?? undefined}>
          {state.path}
        </span>
        {state.status === 'running' && (
          <button type="button" className="btn btn-small" onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={props.onClose}
        >
          <CloseIcon size={13} />
        </button>
      </header>

      {state.status === 'running' && (
        // du walks the whole subtree, so this can take seconds — say so rather
        // than leave the panel looking empty.
        <div className="dir-sizes-progress" role="status">
          <span className="dir-sizes-bar-indeterminate" aria-hidden="true" />
          <span>
            {t('explorer.dirSizes.running', {
              defaultValue: 'Measuring this folder — this can take a few seconds…'
            })}
          </span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="dir-sizes-message error">
          <div>{t('explorer.dirSizes.failed', { defaultValue: 'Could not measure this folder' })}</div>
          <div className="mono dim">{state.error}</div>
        </div>
      )}

      {state.status === 'ready' && result !== null && (
        <>
          {result.error !== null && (
            <div className="dir-sizes-message error">
              <div>
                {t('explorer.dirSizes.failed', { defaultValue: 'Could not measure this folder' })}
              </div>
              <div className="mono dim">{result.error}</div>
            </div>
          )}
          {result.entries.length === 0 && result.error === null ? (
            <div className="dir-sizes-message">{t('explorer.empty')}</div>
          ) : (
            <ol className="dir-sizes-list">
              {result.entries.map((entry) => (
                <li key={entry.path} className="dir-sizes-row">
                  <span className="dir-sizes-name truncate" title={entry.path}>
                    {entry.name}
                    {entry.isDirectory ? '/' : ''}
                  </span>
                  <span className="dir-sizes-track" aria-hidden="true">
                    <span
                      className={'dir-sizes-fill' + (entry.sizeBytes === null ? ' is-unknown' : '')}
                      style={{
                        width:
                          max > 0 && entry.sizeBytes !== null
                            ? `${Math.max(1, Math.round((entry.sizeBytes / max) * 100))}%`
                            : '0%'
                      }}
                    />
                  </span>
                  <span
                    className={'dir-sizes-size mono' + (entry.sizeBytes === null ? ' dim' : '')}
                    title={
                      entry.partial
                        ? t('explorer.dirSizes.partial', {
                            defaultValue: 'At least this much — part of it could not be read'
                          })
                        : undefined
                    }
                  >
                    {size(entry)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <footer className="dir-sizes-foot dim">
            <span>
              {t('explorer.dirSizes.total', {
                defaultValue: 'Total {{size}}',
                size:
                  result.totalBytes === null
                    ? t('common.unknown')
                    : formatBytes(result.totalBytes, lang)
              })}
            </span>
            {result.skipped > 0 && (
              <span>
                {t('explorer.dirSizes.skipped', {
                  defaultValue: '{{count}} further items were not measured',
                  count: result.skipped
                })}
              </span>
            )}
          </footer>
        </>
      )}
    </section>
  )
}

export default DirSizesPanel
