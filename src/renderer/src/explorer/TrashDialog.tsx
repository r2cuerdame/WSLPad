import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleCode, TrashEntry } from '@shared/types'
import { CopyButton } from '../components/CopyButton'
import { Dialog } from '../components/Dialog'
import { RefreshIcon } from '../components/Icons'
import { useApp } from '../store'
import { formatBytes, formatDateTime, parseExplorerError } from './usePane'

interface TrashDialogProps {
  onClose: () => void
  /** The original paths that came back, so the pane can show where they went. */
  onRestored: (paths: string[]) => void
}

const TYPE_LABEL_KEY: Record<
  TrashEntry['type'],
  'explorer.type.file' | 'explorer.type.directory' | 'explorer.type.other'
> = {
  file: 'explorer.type.file',
  directory: 'explorer.type.directory',
  other: 'explorer.type.other'
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
  const { snapshot, pushToast } = useApp()
  const distro = snapshot?.selectedDistro ?? null
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  // Request sequence and distro/mount epoch guards ensure late responses from a
  // superseded refresh, prior distro, or unmounted dialog are discarded.
  const requestIdRef = useRef(0)
  const distroEpochRef = useRef(0)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (expectedEpoch = distroEpochRef.current): Promise<void> => {
      if (distro === null) return
      const requestId = ++requestIdRef.current
      try {
        const list = await window.wslpad.explorer.listTrash()
        if (requestIdRef.current !== requestId || distroEpochRef.current !== expectedEpoch) {
          return
        }
        const restorable = new Set(list.filter((e) => e.present).map((e) => e.trashName))
        setSelected((prev) => {
          if (prev.size === 0) return prev
          const next = new Set<string>()
          for (const name of prev) {
            if (restorable.has(name)) next.add(name)
          }
          return next.size === prev.size ? prev : next
        })
        setEntries(list)
        setError(null)
      } catch (err) {
        if (requestIdRef.current !== requestId || distroEpochRef.current !== expectedEpoch) {
          return
        }
        setError(parseExplorerError(err).message)
      }
    },
    [distro]
  )

  useEffect(() => {
    const epoch = ++distroEpochRef.current
    requestIdRef.current += 1
    setEntries(null)
    setError(null)
    setSelected(new Set())
    setQuery('')
    setBusy(false)
    if (distro !== null) {
      void load(epoch)
    }
    return () => {
      distroEpochRef.current += 1
      requestIdRef.current += 1
    }
  }, [distro, load])

  const list = useMemo(() => entries ?? [], [entries])
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      normalizedQuery.length === 0
        ? list
        : list.filter((entry) => entry.originalPath.toLowerCase().includes(normalizedQuery)),
    [list, normalizedQuery]
  )

  const visibleRestorable = useMemo(
    () => filtered.filter((entry) => entry.present),
    [filtered]
  )
  const selectedVisibleCount = useMemo(
    () => visibleRestorable.filter((entry) => selected.has(entry.trashName)).length,
    [visibleRestorable, selected]
  )
  const allVisibleSelected =
    visibleRestorable.length > 0 && selectedVisibleCount === visibleRestorable.length
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleRestorable.length

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected])

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAllVisible = (): void => {
    if (visibleRestorable.length === 0) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const entry of visibleRestorable) {
          next.delete(entry.trashName)
        }
      } else {
        for (const entry of visibleRestorable) {
          next.add(entry.trashName)
        }
      }
      return next
    })
  }

  const restore = async (): Promise<void> => {
    if (distro === null || selected.size === 0 || busy) return
    const epoch = distroEpochRef.current
    const names = [...selected]
    const restored = list
      .filter((e) => selected.has(e.trashName))
      .map((e) => e.originalPath)
    setBusy(true)
    try {
      await window.wslpad.explorer.restoreTrash(names)
      if (distroEpochRef.current !== epoch) return
      pushToast('success', t('explorer.trashRestored', { count: names.length }))
      setSelected(new Set())
      await load(epoch)
      if (distroEpochRef.current !== epoch) return
      onRestored(restored)
    } catch (err) {
      if (distroEpochRef.current !== epoch) return
      // The reason matters here more than anywhere: "already exists" means the
      // file was not restored and nothing was lost.
      pushToast('error', parseExplorerError(err).message)
      await load(epoch)
    } finally {
      if (distroEpochRef.current === epoch) {
        setBusy(false)
      }
    }
  }

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
            disabled={selected.size === 0 || busy || distro === null}
            onClick={() => void restore()}
          >
            {t('explorer.trashRestore', { defaultValue: 'Restore' })}
          </button>
        </>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          flexWrap: 'wrap'
        }}
      >
        <input
          type="text"
          className="exp-search"
          style={{ flex: 1, minWidth: 160 }}
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          value={query}
          disabled={distro === null}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query.length > 0) {
              e.stopPropagation()
              setQuery('')
            }
          }}
        />
        <span className="dim" data-testid="trash-selected-count">
          {t('explorer.selectedCount', { count: selected.size })}
        </span>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy || distro === null}
          onClick={() => void load()}
        >
          <span aria-hidden="true" style={{ display: 'inline-flex', marginRight: 4 }}>
            <RefreshIcon size={13} />
          </span>
          {t('common.refresh')}
        </button>
      </div>
      {error !== null ? (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8
          }}
        >
          <span className="err-text">{error}</span>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || distro === null}
            onClick={() => void load()}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : null}
      {distro === null ? (
        <div className="dim">{t('explorer.noDistro')}</div>
      ) : entries === null ? (
        error === null ? (
          <div className="dim">{t('common.loading', { defaultValue: 'Loading…' })}</div>
        ) : null
      ) : list.length === 0 ? (
        error === null ? (
          <div className="dim">
            {t('explorer.trashEmpty', { defaultValue: 'The trash is empty.' })}
          </div>
        ) : null
      ) : filtered.length === 0 ? (
        <div className="dim">{t('common.none')}</div>
      ) : (
        <table className="tbl trash-table" data-testid="trash-list">
          <thead>
            <tr>
              <th className="trash-pick">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={visibleRestorable.length === 0 || busy}
                  aria-label={t('explorer.trashSelect')}
                  onChange={toggleAllVisible}
                />
              </th>
              <th>{t('explorer.trashOriginalPath', { defaultValue: 'Original location' })}</th>
              <th>{t('explorer.trashDeletedAt', { defaultValue: 'Deleted' })}</th>
              <th className="num">{t('explorer.trashSize', { defaultValue: 'Size' })}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span className="badge">
                      {t(TYPE_LABEL_KEY[entry.type] ?? 'explorer.type.other')}
                    </span>
                    <span className="truncate" title={entry.originalPath}>
                      {entry.originalPath}
                    </span>
                    <CopyButton text={entry.originalPath} toastKey="toast.copiedPath" />
                    {entry.present ? null : (
                      <span className="badge badge-warn">
                        {t('explorer.trashGone', { defaultValue: 'File gone' })}
                      </span>
                    )}
                  </div>
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
