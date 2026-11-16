import { useCallback, useEffect, useRef, useState } from 'react'
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

function mergeProgress(prev: FileOpProgress | undefined, next: FileOpProgress): FileOpProgress {
  if (!prev) return next
  return {
    ...next,
    totalItems: next.totalItems ?? prev.totalItems,
    doneItems: next.doneItems ?? prev.doneItems,
    totalBytes: next.totalBytes ?? prev.totalBytes,
    doneBytes: next.doneBytes ?? prev.doneBytes,
    currentItem: next.currentItem ?? prev.currentItem
  }
}

function computePercent(p: FileOpProgress): number | null {
  if (p.totalBytes !== null && p.totalBytes > 0 && p.doneBytes !== null) {
    return Math.max(0, Math.min(100, Math.round((p.doneBytes / p.totalBytes) * 100)))
  }
  if (p.totalItems !== null && p.totalItems > 0 && p.doneItems !== null) {
    return Math.max(0, Math.min(100, Math.round((p.doneItems / p.totalItems) * 100)))
  }
  return null
}

/** Bottom-right progress for copy/move/import/export operations (goal.md §7.5). */
export function TransferProgress(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const [ops, setOps] = useState<Map<string, FileOpProgress>>(new Map())
  const [cancelling, setCancelling] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const cancellingRef = useRef(new Set<string>())
  const cancelTokens = useRef(new Map<string, number>())

  const clearCancelling = useCallback((opId: string): void => {
    cancelTokens.current.delete(opId)
    cancellingRef.current.delete(opId)
    setCancelling((prev) => {
      if (!prev.has(opId)) return prev
      const next = new Set(prev)
      next.delete(opId)
      return next
    })
  }, [])

  useEffect(() => {
    const off = window.wslpad.onOpProgress((p) => {
      setOps((m) => {
        const next = new Map(m)
        next.set(p.opId, mergeProgress(m.get(p.opId), p))
        return next
      })
      if (p.status !== 'running') {
        clearCancelling(p.opId)
      }
      if (p.status === 'done' || p.status === 'cancelled') {
        const existing = timers.current.get(p.opId)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          timers.current.delete(p.opId)
          clearCancelling(p.opId)
          setOps((m) => {
            const next = new Map(m)
            next.delete(p.opId)
            return next
          })
        }, DISMISS_MS)
        timers.current.set(p.opId, timer)
      } else {
        const existing = timers.current.get(p.opId)
        if (existing) {
          clearTimeout(existing)
          timers.current.delete(p.opId)
        }
      }
    })
    const pending = timers.current
    const activeTokens = cancelTokens.current
    const activeCancelling = cancellingRef.current
    return () => {
      off()
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
      activeTokens.clear()
      activeCancelling.clear()
    }
  }, [clearCancelling])

  if (ops.size === 0) return null

  const dismiss = (opId: string): void => {
    const existing = timers.current.get(opId)
    if (existing) {
      clearTimeout(existing)
      timers.current.delete(opId)
    }
    clearCancelling(opId)
    setOps((m) => {
      const next = new Map(m)
      next.delete(opId)
      return next
    })
  }

  const cancel = (opId: string): void => {
    if (cancellingRef.current.has(opId)) return
    cancellingRef.current.add(opId)
    const token = (cancelTokens.current.get(opId) ?? 0) + 1
    cancelTokens.current.set(opId, token)
    setCancelling((prev) => new Set(prev).add(opId))
    try {
      void Promise.resolve(window.wslpad.explorer.cancelOp(opId)).catch(() => {
        if (cancelTokens.current.get(opId) !== token) return
        clearCancelling(opId)
      })
    } catch {
      if (cancelTokens.current.get(opId) === token) clearCancelling(opId)
    }
  }

  const renderOp = (p: FileOpProgress): React.JSX.Element => {
    const percent = computePercent(p)
    const isIndeterminate = p.status === 'running' && percent === null
    const barWidth = isIndeterminate
      ? undefined
      : p.status === 'done'
        ? '100%'
        : `${percent ?? 0}%`
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
            <button
              type="button"
              className="transfer-btn"
              disabled={cancelling.has(p.opId)}
              onClick={() => cancel(p.opId)}
            >
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
        <div className={'transfer-bar' + (isIndeterminate ? ' indeterminate' : '')}>
          <div
            className="transfer-bar-fill"
            style={barWidth !== undefined ? { width: barWidth } : undefined}
          />
        </div>
        <div className="transfer-meta">
          {p.totalItems !== null && p.doneItems !== null && (
            <span>
              {p.doneItems}/{p.totalItems}
            </span>
          )}
          {p.totalBytes !== null && p.doneBytes !== null && (
            <span>
              {formatBytes(p.doneBytes, i18n.language)} / {formatBytes(p.totalBytes, i18n.language)}
            </span>
          )}
          {p.error && (
            <span className="transfer-error" role="alert">
              {p.error}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="transfer-panel" role="status" aria-live="polite">
      {[...ops.values()].map(renderOp)}
    </div>
  )
}
