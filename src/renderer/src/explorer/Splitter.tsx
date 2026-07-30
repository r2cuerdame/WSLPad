import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PANE_SPLIT_BOUNDS, PANE_SPLIT_DEFAULT } from '@shared/constants'

export const SPLIT_STORAGE_KEY = 'wslpad.explorer.split'

/** Arrow keys nudge the divider by this many percent. */
const KEY_STEP = 2

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return PANE_SPLIT_DEFAULT
  return Math.min(PANE_SPLIT_BOUNDS.max, Math.max(PANE_SPLIT_BOUNDS.min, Math.round(value)))
}

export function loadSplit(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY)
    return raw === null ? PANE_SPLIT_DEFAULT : clampSplit(Number(raw))
  } catch {
    return PANE_SPLIT_DEFAULT
  }
}

export function saveSplit(value: number): void {
  try {
    localStorage.setItem(SPLIT_STORAGE_KEY, String(value))
  } catch {
    /* storage unavailable — the split simply does not persist */
  }
}

interface SplitterProps {
  percent: number
  onChange: (percent: number) => void
  /** Element the percentage is measured against. */
  containerRef: React.RefObject<HTMLElement>
}

/** Draggable divider between the two Explorer panes (goal.md §7.1). */
export function Splitter({ percent, onChange, containerRef }: SplitterProps): React.JSX.Element {
  const { t } = useTranslation()
  const dragging = useRef(false)

  const commit = useCallback(
    (next: number): void => {
      const clamped = clampSplit(next)
      saveSplit(clamped)
      onChange(clamped)
    },
    [onChange]
  )

  const fromClientX = (clientX: number): number | null => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return ((clientX - rect.left) / rect.width) * 100
  }

  return (
    <div
      className={dragging.current ? 'pane-splitter dragging' : 'pane-splitter'}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('explorer.pane.splitter')}
      aria-valuenow={percent}
      aria-valuemin={PANE_SPLIT_BOUNDS.min}
      aria-valuemax={PANE_SPLIT_BOUNDS.max}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const next = fromClientX(e.clientX)
        if (next !== null) commit(next)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onDoubleClick={() => commit(PANE_SPLIT_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          commit(percent - KEY_STEP)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          commit(percent + KEY_STEP)
        } else if (e.key === 'Home') {
          e.preventDefault()
          commit(PANE_SPLIT_BOUNDS.min)
        } else if (e.key === 'End') {
          e.preventDefault()
          commit(PANE_SPLIT_BOUNDS.max)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          commit(PANE_SPLIT_DEFAULT)
        }
      }}
    />
  )
}
