import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DoctorCheckResult, DoctorReport, DoctorVerdict } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import { CheckIcon, CopyIcon, RefreshIcon, WarningIcon } from '../components/Icons'

const VERDICT_ICONS: Record<DoctorVerdict, (size: number) => React.JSX.Element> = {
  healthy: (size) => <CheckIcon size={size} className="diag-pass" />,
  warning: (size) => <WarningIcon size={size} className="diag-unknown" />,
  error: (size) => <WarningIcon size={size} className="diag-fail" />,
  unknown: (size) => <WarningIcon size={size} className="diag-unknown" />
}

function verdictBadge(verdict: DoctorVerdict, t: (k: string) => string): React.JSX.Element {
  return (
    <span className={`badge diag-status diag-status-${verdict === 'healthy' ? 'pass' : verdict === 'error' ? 'fail' : 'unknown'}`}>
      {t(`doctor.verdict.${verdict}`)}
    </span>
  )
}

export default function DoctorCard(): React.JSX.Element {
  const { t } = useTranslation()
  const { pushToast, prepareCommand } = useApp()
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [running, setRunning] = useState(false)

  const runDoctor = async (): Promise<void> => {
    setRunning(true)
    try {
      const result = await window.wslpad.doctor.run()
      setReport(result)
      const errors = result.checks.filter((c) => c.verdict === 'error').length
      const warnings = result.checks.filter((c) => c.verdict === 'warning').length
      pushToast(
        errors > 0 ? 'error' : warnings > 0 ? 'info' : 'success',
        t('doctor.complete', {
          errors,
          warnings,
          defaultValue: 'Doctor complete — {{errors}} error(s), {{warnings}} warning(s)'
        })
      )
    } catch {
      pushToast('error', t('common.error'))
    } finally {
      setRunning(false)
    }
  }

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const copyReport = async (): Promise<void> => {
    if (!report) return
    try {
      await window.wslpad.copyToClipboard(report.maskedMarkdown)
      pushToast('success', t('doctor.reportCopied', { defaultValue: 'Doctor report copied for LLM' }))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  const counts = report
    ? {
        healthy: report.checks.filter((c) => c.verdict === 'healthy').length,
        warning: report.checks.filter((c) => c.verdict === 'warning').length,
        error: report.checks.filter((c) => c.verdict === 'error').length,
        unknown: report.checks.filter((c) => c.verdict === 'unknown').length
      }
    : null

  const actions = (
    <div className="diagnostics-actions">
      <button
        type="button"
        className="btn btn-accent"
        disabled={running}
        onClick={() => void runDoctor()}
        data-testid="doctor-run-btn"
      >
        <RefreshIcon size={14} />
        {running ? t('doctor.running', { defaultValue: 'Running…' }) : t('doctor.run', { defaultValue: 'Run Doctor' })}
      </button>
      {report !== null && (
        <button type="button" className="btn" onClick={() => void copyReport()}>
          <CopyIcon size={14} />
          {t('doctor.copyReport', { defaultValue: 'Copy for LLM' })}
        </button>
      )}
    </div>
  )

  return (
    <Card titleKey="doctor.title" actions={actions} className="doctor-card">
      <p className="dim">{t('doctor.intro')}</p>

      {report === null ? (
        <div className="dim" data-testid="doctor-empty">
          {t('doctor.empty')}
        </div>
      ) : (
        <>
          {counts !== null && (
            <div className="doctor-summary" data-testid="doctor-summary">
              <span className="diag-pass">✅ {counts.healthy}</span>
              <span className="diag-unknown">⚠️ {counts.warning}</span>
              <span className="diag-fail">❌ {counts.error}</span>
              <span className="diag-unknown">❓ {counts.unknown}</span>
            </div>
          )}

          <div className="doctor-checks" data-testid="doctor-checks">
            {report.checks.map((check: DoctorCheckResult) => (
              <div
                className={`doctor-check doctor-check-${check.verdict}`}
                key={check.id}
                data-testid={`doctor-check-${check.id}`}
              >
                <div className="doctor-check-header">
                  {VERDICT_ICONS[check.verdict](14)}
                  <span className="doctor-check-title">{check.title}</span>
                  {verdictBadge(check.verdict, t)}
                </div>
                <div className="dim doctor-check-evidence">{check.evidence}</div>
                {check.command !== null && (
                  <div className="doctor-check-command">
                    <code className="mono">{check.command}</code>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => prepare(check.command!)}
                    >
                      {t('diagnostics.recovery.prepare')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
