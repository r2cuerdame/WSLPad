import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { CloseIcon } from './Icons'

/** Toast stack in the bottom-right corner, fed by useApp().toasts. */
function Toasts(): React.JSX.Element | null {
  const { toasts, dismissToast } = useApp()
  const { t } = useTranslation()

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-text">{toast.text}</span>
          <button
            type="button"
            className="icon-btn toast-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={() => dismissToast(toast.id)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export { Toasts }
export default Toasts
