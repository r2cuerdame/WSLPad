import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { CopyIcon, FileIcon } from '../components/Icons'

/** Copy-for-LLM Markdown + JSON export actions (goal.md §12). */
export default function CopyForLlm(): React.JSX.Element {
  const { t } = useTranslation()
  const { pushToast } = useApp()

  const copyMarkdown = async (): Promise<void> => {
    try {
      await window.wslpad.copyLlmMarkdown()
      pushToast('success', t('dashboard.copiedForLlm'))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  const exportJson = async (): Promise<void> => {
    try {
      const path = await window.wslpad.exportLlmJson()
      if (path !== null) pushToast('success', t('dashboard.exportedJson', { path }))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  return (
    <div className="llm-actions">
      <button type="button" className="btn btn-accent" onClick={() => void copyMarkdown()}>
        <CopyIcon size={14} />
        {t('dashboard.copyForLlm')}
      </button>
      <button type="button" className="btn" onClick={() => void exportJson()}>
        <FileIcon size={14} />
        {t('dashboard.exportJson')}
      </button>
    </div>
  )
}
