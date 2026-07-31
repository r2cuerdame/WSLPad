import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleCode, TrashEntry } from '@shared/types'
import { Dialog } from '../components/Dialog'
import { useApp } from '../store'
import { formatBytes, formatDateTime, parseExplorerError } from './usePane'

interface TrashDialogProps {
  onClose: () => void
  /** The original paths that came back, so the pane can show where they went. */
  onRestored: (paths: string[]) => void
}

/**
 * What Explorer sent to the trash, and putting it back (issue #23).
 *
 * The gap this closes: WSLPad deletes into the freedesktop trash — the right
 * thing — but until now nothing in the app could see what was in there. The
 * restore refuses to overwrite: an undo that destroyed the file at the
 * destination would be worse than not undoing at all.
 */
export function TrashDialog({ onClose, onRestored }: TrashDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { pushToast } = useApp()
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.wslpad.explorer.listTrash()
      setEntries(list)
      setError(null)
    } catch (err) {
      setEntries([])
      setError(parseExplorerError(err).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const restore = async (): Promise<void> => {
    if (selected.size === 0) return
    setBusy(true)
    const restored = list
      .filter((e) => selected.has(e.trashName))
      .map((e) => e.originalPath)
    try {
      await window.wslpad.explorer.restoreTrash([...selected])
      pushToast('success', t('explorer.trashRestored', { count: selected.size }))
      setSelected(new Set())
      await load()
      onRestored(restored)
    } catch (err) {
      // The reason matters here more than anywhere: "already exists" means the
      // file was not restored and nothing was lost.
      pushToast('error', parseExplorerError(err).message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const list = entries ?? []

  return (
    <Dialog
      open
      title={t('explorer.trashTitle', { defaultValue: 'Trash' })}
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={selected.size === 0 || busy}
            onClick={() => void restore()}
          >
            {t('explorer.trashRestore', { defaultValue: 'Restore' })}
          </button>
        </>
      }
    >
      {error !== null ? <div className="err-text">{error}</div> : null}
      {entries === null ? (
        <div className="dim">{t('common.loading', { defaultValue: 'Loading…' })}</div>
      ) : list.length === 0 ? (
        <div className="dim">{t('explorer.trashEmpty', { defaultValue: 'The trash is empty.' })}</div>
      ) : (
        <table className="tbl trash-table" data-testid="trash-list">
          <thead>
            <tr>
              <th className="trash-pick" aria-label={t('explorer.trashSelect')} />
              <th>{t('explorer.trashOriginalPath', { defaultValue: 'Original location' })}</th>
              <th>{t('explorer.trashDeletedAt', { defaultValue: 'Deleted' })}</th>
              <th className="num">{t('explorer.trashSize', { defaultValue: 'Size' })}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => (
              <tr key={entry.trashName} className={entry.present ? undefined : 'dim'}>
                <td className="trash-pick">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.trashName)}
                    // A record whose file is gone cannot be put back; it is
                    // still listed, because its presence is a fact.
                    disabled={!entry.present || busy}
                    aria-label={entry.originalPath}
                    onChange={() => toggle(entry.trashName)}
                  />
                </td>
                <td className="mono">
                  <span className="truncate" title={entry.originalPath}>
                    {entry.originalPath}
                  </span>
                  {entry.present ? null : (
                    <span className="badge badge-warn">
                      {t('explorer.trashGone', { defaultValue: 'File gone' })}
                    </span>
                  )}
                </td>
                <td>
                  {entry.deletedAt === null
                    ? t('common.unknown')
                    : formatDateTime(entry.deletedAt, locale)}
                </td>
                <td className="num">
                  {entry.sizeBytes === null
                    ? t('common.unknown')
                    : formatBytes(entry.sizeBytes, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dim">
        {t('explorer.trashHint', {
          defaultValue:
            'Restoring puts a file back where it was deleted from. If something is already there, the restore stops and nothing is overwritten.'
        })}
      </div>
    </Dialog>
  )
}

export default TrashDialog
