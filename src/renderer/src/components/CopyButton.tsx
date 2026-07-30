import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { CopyIcon } from './Icons'

export interface CopyButtonProps {
  text: string
  /** Toast i18n key shown after a successful copy. */
  toastKey?: string
  /** aria-label / tooltip i18n key. */
  labelKey?: string
  size?: number
  className?: string
  children?: ReactNode
}

function CopyButton({
  text,
  toastKey = 'toast.copiedPath',
  labelKey = 'common.copy',
  size = 14,
  className = 'icon-btn',
  children
}: CopyButtonProps): React.JSX.Element {
  const { pushToast } = useApp()
  const { t } = useTranslation()

  const copy = async (): Promise<void> => {
    try {
      await window.wslpad.copyToClipboard(text)
      pushToast('success', t(toastKey))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={t(labelKey)}
      title={t(labelKey)}
      onClick={() => void copy()}
    >
      {children ?? <CopyIcon size={size} />}
    </button>
  )
}

export { CopyButton }
export default CopyButton
