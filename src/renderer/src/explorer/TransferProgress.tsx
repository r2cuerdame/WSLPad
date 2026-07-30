import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileOpKind, FileOpProgress } from '@shared/types'
import { formatBytes } from './useExplorer'

const KIND_KEYS: Record<FileOpKind, string> = {
  copy: 'explorer.transfer.copying',
  move: 'explorer.transfer.moving',
  trash: 'explorer.transfer.trashing',
  delete: 'explorer.transfer.deleting',
  import: 'explorer.transfer.importing',
  export: 'explorer.transfer.exporting'
}

const DISMISS_MS = 3000

/** Bottom-right progress for copy/move/import/export operations (goal.md §7.5). */
export function TransferProgress(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [ops, setOps] = useState<Map<string, FileOpProgress>>(new Map())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const off = window.wslpad.onOpProgress((p) => {
      setOps((m) => new Map(m).set(p.opId, p))
      if (p.status === 'done' || p.status === 'cancelled') {
        const existing = timers.current.get(p.opId)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          timers.current.delete(p.opId)
          setOps((m) => {
            const next = new Map(m)
            next.delete(p.opId)
            return next
          })
        }, DISMISS_MS)
        timers.current.set(p.opId, timer)
      }
    })
    const pending = timers.current
    return () => {
      off()
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  if (ops.size === 0) return null

  const dismiss = (opId: string): void => {
    setOps((m) => {
      const next = new Map(m)
      next.delete(opId)
      return next
    })
  }

  const renderOp = (p: FileOpProgress): React.JSX.Element => {
    const percent =
      p.totalBytes && p.totalBytes > 0
        ? Math.min(100, Math.round(((p.doneBytes ?? 0) / p.totalBytes) * 100))
        : p.totalItems && p.totalItems > 0
          ? Math.min(100, Math.round(((p.doneItems ?? 0) / p.totalItems) * 100))
          : null
    const statusText =
      p.status === 'done'
        ? t('explorer.transfer.done')
        : p.status === 'cancelled'
          ? t('explorer.transfer.cancelled')
          : p.status === 'error'
            ? t('explorer.transfer.failed')
            : t(KIND_KEYS[p.kind])
    return (
      <div key={p.opId} className={`transfer-op st-${p.status}`}>
        <div className="transfer-head">
          <span className="transfer-title">{statusText}</span>
          {p.status === 'running' ? (
            <button type="button" className="transfer-btn" onClick={() => void window.wslpad.explorer.cancelOp(p.opId)}>
              {t('explorer.transfer.cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="transfer-btn"
              onClick={() => dismiss(p.opId)}
              aria-label={t('common.close')}
            >
              ✕
            </button>
          )}
        </div>
        {p.currentItem && (
          <div className="transfer-item mono" title={p.currentItem}>
            {p.currentItem}
          </div>
        )}
        <div className={'transfer-bar' + (percent === null ? ' indeterminate' : '')}>
          <div className="transfer-bar-fill" style={{ width: `${percent ?? 100}%` }} />
        </div>
        <div className="transfer-meta">
          {p.totalItems !== null && (
            <span>
              {p.doneItems ?? 0}/{p.totalItems}
            </span>
          )}
          {p.totalBytes !== null && (
            <span>
              {formatBytes(p.doneBytes ?? 0, i18n.language)} / {formatBytes(p.totalBytes, i18n.language)}
            </span>
          )}
          {p.error && <span className="transfer-error">{p.error}</span>}
        </div>
      </div>
    )
  }

  return <div className="transfer-panel">{[...ops.values()].map(renderOp)}</div>
}
