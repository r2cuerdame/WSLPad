import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from './Icons'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}

/** Modal dialog: focus trap, Escape closes, focus restored on close (goal.md §5.4). */
function Dialog({
  open,
  title,
  onClose,
  children,
  actions
}: DialogProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()
    return () => previous?.focus()
  }, [open])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="dialog"
        onKeyDown={onKeyDown}
      >
        <header className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {actions ? <footer className="dialog-actions">{actions}</footer> : null}
      </div>
    </div>
  )
}

export { Dialog }
export default Dialog
