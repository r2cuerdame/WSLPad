import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServiceLog, ServiceScope } from '@shared/types'
import { Dialog } from '../components/Dialog'
import CopyButton from '../components/CopyButton'

export interface ServiceLogDialogProps {
  unit: string
  scope: ServiceScope
  onClose: () => void
}

/**
 * The tail of one unit's journal, in place (issue #67).
 *
 * The Console is the right place to *follow* a log. It is the wrong place to
 * answer "did it fail, and why", which wants the last twenty lines without
 * leaving the screen you are already on. Read-only: this window only ever
 * reads, and the unit is never started, stopped or restarted from here.
 */
export default function ServiceLogDialog({
  unit,
  scope,
  onClose
}: ServiceLogDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [log, setLog] = useState<ServiceLog | null>(null)

  useEffect(() => {
    let disposed = false
    setLog(null)
    void window.wslpad
      .serviceLog(unit, scope)
      .then((result) => {
        if (!disposed) setLog(result)
      })
      .catch((err: unknown) => {
        if (disposed) return
        setLog({
          unit,
          scope,
          lines: [],
          truncated: false,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      disposed = true
    }
  }, [unit, scope])

  const text = (log?.lines ?? []).join('\n')

  return (
    <Dialog
      open
      title={t('dashboard.services.logTitle', { defaultValue: 'Log — {{unit}}', unit })}
      onClose={onClose}
      actions={
        <>
          {text === '' ? null : (
            <CopyButton text={text} labelKey="dashboard.services.copyLog" toastKey="toast.copied" />
          )}
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {log === null ? (
        <div className="dim">{t('common.loading')}</div>
      ) : log.error !== null ? (
        // The reason, not an empty box: "no systemd here" and "this unit has
        // never logged" are different answers.
        <div className="dim">{log.error}</div>
      ) : log.lines.length === 0 ? (
        <div className="dim">
          {t('dashboard.services.logEmpty', { defaultValue: 'This unit has no journal entries.' })}
        </div>
      ) : (
        <>
          {log.truncated ? (
            <div className="dim">
              {t('dashboard.services.logTruncated', {
                defaultValue: 'The most recent {{count}} lines.',
                count: log.lines.length
              })}
            </div>
          ) : null}
          <pre className="mono code-block service-log" data-testid="service-log">
            {text}
          </pre>
        </>
      )}
    </Dialog>
  )
}
