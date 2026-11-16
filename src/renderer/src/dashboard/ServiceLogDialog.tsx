import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServiceLog, ServiceScope } from '@shared/types'
import { useApp } from '../store'
import { Dialog } from '../components/Dialog'
import CopyButton from '../components/CopyButton'
import { WarningIcon } from '../components/Icons'

const shQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`

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
  const { prepareCommand, pushToast } = useApp()
  const [log, setLog] = useState<ServiceLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)
  const inFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      inFlightRef.current = false
    }
  }, [])

  const loadLog = useCallback(
    (reset: boolean) => {
      if (!reset && inFlightRef.current) return
      const requestId = ++requestIdRef.current
      inFlightRef.current = true
      setLoading(true)
      if (reset) {
        setLog(null)
        setQuery('')
      }
      void window.wslpad
        .serviceLog(unit, scope)
        .then((result) => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return
          inFlightRef.current = false
          setLog(result)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return
          inFlightRef.current = false
          setLog({
            unit,
            scope,
            lines: [],
            truncated: false,
            error: err instanceof Error ? err.message : String(err)
          })
          setLoading(false)
        })
    },
    [unit, scope]
  )

  useEffect(() => {
    loadLog(true)
    return () => {
      requestIdRef.current += 1
      inFlightRef.current = false
    }
  }, [loadLog])

  const visibleLines = useMemo(() => {
    if (!log || log.lines.length === 0) return []
    const q = query.trim().toLowerCase()
    if (!q) return log.lines
    return log.lines.filter((line) => line.toLowerCase().includes(q))
  }, [log, query])

  const visibleText = visibleLines.join('\n')
  const isErrorState = log !== null && log.lines.length === 0 && log.error !== null

  const logsCommand =
    scope === 'user' ? `journalctl --user -u ${shQuote(unit)}` : `journalctl -u ${shQuote(unit)}`

  const handlePrepareLogs = (): void => {
    // Only place the command in the Console input — never run it automatically
    // (.github/CONTRIBUTING.md rule 1).
    prepareCommand(logsCommand)
    pushToast('info', t('toast.commandPrepared'))
    onClose()
  }

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape' && query !== '') {
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
    }
  }

  return (
    <Dialog
      open
      title={t('dashboard.services.logTitle', { defaultValue: 'Log — {{unit}}', unit })}
      onClose={onClose}
      actions={
        <>
          {visibleText === '' ? null : (
            <CopyButton text={visibleText} labelKey="dashboard.services.copyLog" toastKey="common.copied" />
          )}
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => loadLog(false)}
          >
            {isErrorState ? t('common.retry') : t('common.refresh')}
          </button>
          <button type="button" className="btn" onClick={handlePrepareLogs}>
            {t('dashboard.services.prepareLogs')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {log === null ? (
        <div className="dim">{t('common.loading')}</div>
      ) : log.lines.length === 0 ? (
        log.error !== null ? (
          // The reason, not an empty box: "no systemd here" and "this unit has
          // never logged" are different answers.
          <div className="notice-warn" role="alert">
            <WarningIcon size={14} />
            <span>{log.error}</span>
          </div>
        ) : (
          <div className="dim">
            {t('dashboard.services.logEmpty', { defaultValue: 'This unit has no journal entries.' })}
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {log.error !== null ? (
            // Entries arrived, but journalctl also emitted a privilege hint — keep
            // both visible rather than hiding the lines behind the warning.
            <div className="notice-warn" role="status">
              <WarningIcon size={14} />
              <span>{log.error}</span>
            </div>
          ) : null}
          <input
            type="search"
            className="dash-input"
            style={{ width: '100%' }}
            value={query}
            aria-label={t('common.search')}
            placeholder={t('common.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {log.truncated ? (
            <div className="dim">
              {t('dashboard.services.logTruncated', {
                defaultValue: 'The most recent {{count}} lines.',
                count: log.lines.length
              })}
            </div>
          ) : null}
          {visibleLines.length === 0 ? (
            <div className="dim">{t('common.none')}</div>
          ) : (
            <pre className="mono code-block service-log" data-testid="service-log">
              {visibleText}
            </pre>
          )}
        </div>
      )}
    </Dialog>
  )
}
