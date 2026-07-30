import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LlmPreset } from '@shared/ipc'
import { useApp } from '../store'
import { ChevronDownIcon, CopyIcon, FileIcon } from '../components/Icons'
import { ContextMenu, type MenuItem } from '../explorer/ContextMenu'

/** Toast shown after each preset lands on the clipboard. */
const COPIED_KEY: Record<LlmPreset, string> = {
  default: 'dashboard.copiedForLlm',
  'bug-report': 'dashboard.llmPreset.copiedBugReport',
  'agent-context': 'dashboard.llmPreset.copiedAgentContext'
}

const COPIED_FALLBACK: Record<LlmPreset, string> = {
  default: 'Environment summary copied',
  'bug-report': 'Bug report copied — fill in the repro steps before posting',
  'agent-context': 'Agent context copied'
}

/** Copy-for-LLM Markdown + JSON export actions (goal.md §12, issue #30). */
export default function CopyForLlm(): React.JSX.Element {
  const { t } = useTranslation()
  const { pushToast } = useApp()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  const copyMarkdown = async (preset: LlmPreset): Promise<void> => {
    try {
      await window.wslpad.copyLlmMarkdown(preset)
      pushToast('success', t(COPIED_KEY[preset], { defaultValue: COPIED_FALLBACK[preset] }))
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

  // One button, one choice: three side-by-side copy buttons would read as three
  // unrelated actions when they are three shapes of the same export.
  const items: MenuItem[] = [
    {
      id: 'default',
      label: t('dashboard.llmPreset.full', { defaultValue: 'Full environment summary' }),
      onClick: () => void copyMarkdown('default')
    },
    {
      id: 'bug-report',
      label: t('dashboard.llmPreset.bugReport', { defaultValue: 'WSL bug report (GitHub issue)' }),
      onClick: () => void copyMarkdown('bug-report')
    },
    {
      id: 'agent-context',
      label: t('dashboard.llmPreset.agentContext', {
        defaultValue: 'Agent context (CLAUDE.md / AGENTS.md)'
      }),
      onClick: () => void copyMarkdown('agent-context')
    }
  ]

  const openMenu = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    setMenuAt({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 })
  }

  return (
    <div className="llm-actions">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-accent"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        onClick={openMenu}
      >
        <CopyIcon size={14} />
        {t('dashboard.copyForLlm')}
        <ChevronDownIcon size={14} />
      </button>
      <button type="button" className="btn" onClick={() => void exportJson()}>
        <FileIcon size={14} />
        {t('dashboard.exportJson')}
      </button>
      {menuAt !== null && (
        <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} />
      )}
    </div>
  )
}
