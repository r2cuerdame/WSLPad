import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DiagnosticsState,
  PerformanceState,
  IncidentEvent,
  LocaleCode,
  NetworkProbeResult,
  NetworkProbeStatus,
  RecoveryStepId
} from '@shared/types'
import { formatDuration, formatPercent } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import { CheckIcon, FileIcon, RefreshIcon, WarningIcon } from '../components/Icons'

const EMPTY: DiagnosticsState = {
  incidents: [],
  lastNetworkCheck: null,
  lastRecoveryCheck: null
}

const EMPTY_PERFORMANCE: PerformanceState = {
  enabled: false, path: null, intervals: [], writeError: false, unsavedSamples: 0
}

const PROBE_KEYS: Record<NetworkProbeResult['id'], string> = {
  distro: 'diagnostics.probe.distro',
  'wsl-dns': 'diagnostics.probe.wslDns',
  'windows-dns': 'diagnostics.probe.windowsDns',
  'default-route': 'diagnostics.probe.defaultRoute',
  'windows-localhost': 'diagnostics.probe.windowsLocalhost'
}

const STEP_KEYS: Record<RecoveryStepId, string> = {
  'reload-window': 'reloadWindow',
  'restart-vscode-server': 'restartServer',
  'terminate-distro': 'terminateDistro',
  'shutdown-wsl': 'shutdownWsl'
}

function statusIcon(status: NetworkProbeStatus): React.JSX.Element {
  return status === 'pass' ? (
    <CheckIcon size={14} className="diag-pass" />
  ) : (
    <WarningIcon size={14} className={status === 'fail' ? 'diag-fail' : 'diag-unknown'} />
  )
}

function incidentIcon(event: IncidentEvent): React.JSX.Element {
  return event.severity === 'warning' ? (
    <WarningIcon size={14} className="diag-fail" />
  ) : (
    <CheckIcon
      size={14}
      className={event.severity === 'recovery' ? 'diag-recovery' : 'diag-info'}
    />
  )
}

export default function DiagnosticsCard(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { snapshot, pushToast, prepareCommand } = useApp()
  const [state, setState] = useState<DiagnosticsState>(EMPTY)
  const [portText, setPortText] = useState('')
  const [running, setRunning] = useState(false)
  const [performanceState, setPerformanceState] = useState<PerformanceState>(EMPTY_PERFORMANCE)
  const [performanceBusy, setPerformanceBusy] = useState(false)

  useEffect(() => {
    let disposed = false
    void window.wslpad.performance.get().then((next) => {
      if (!disposed) setPerformanceState(next)
    })
    const off = window.wslpad.performance.onChange(setPerformanceState)
    return () => { disposed = true; off() }
  }, [])

  const togglePerformance = async (): Promise<void> => {
    setPerformanceBusy(true)
    try {
      setPerformanceState(await window.wslpad.performance.setEnabled(!performanceState.enabled))
    } catch {
      pushToast('error', t('common.error'))
    } finally {
      setPerformanceBusy(false)
    }
  }

  const exportPerformance = async (): Promise<void> => {
    try {
      const path = await window.wslpad.performance.exportLog()
      if (path) pushToast('success', t('diagnostics.exported', { path }))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  useEffect(() => {
    let disposed = false
    void window.wslpad.diagnostics.get().then((next) => {
      if (!disposed) setState(next)
    })
    const off = window.wslpad.diagnostics.onChange(setState)
    return () => {
      disposed = true
      off()
    }
  }, [])

  const parsedPort = portText === '' ? null : Number(portText)
  const portInvalid =
    parsedPort !== null && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)
  const selected = snapshot?.selectedDistro ?? null
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
    [i18n.language]
  )

  const runCheck = async (): Promise<void> => {
    if (portInvalid || selected === null) return
    setRunning(true)
    try {
      const result = await window.wslpad.diagnostics.runRecoveryCheck(parsedPort ?? undefined)
      setState((current) => ({
        ...current,
        lastNetworkCheck: result.network,
        lastRecoveryCheck: result
      }))
      const failed = result.network.probes.filter((probe) => probe.status === 'fail').length
      pushToast(
        failed > 0 ? 'error' : 'success',
        t('diagnostics.checkComplete', {
          failed,
          defaultValue: 'Recovery check complete — {{failed}} failed probes'
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

  const recovery = state.lastRecoveryCheck
  const network = recovery?.network ?? state.lastNetworkCheck
  const locale = i18n.language as LocaleCode

  const exportBundle = async (): Promise<void> => {
    try {
      const path = await window.wslpad.diagnostics.exportBundle()
      if (path)
        pushToast(
          'success',
          t('diagnostics.exported', {
            path,
            defaultValue: 'Diagnostic bundle exported to {{path}}'
          })
        )
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  const actions = (
    <div className="diagnostics-actions">
      <label className="sr-only" htmlFor="diagnostics-port">
        {t('diagnostics.port')}
      </label>
      <input
        id="diagnostics-port"
        className="dash-input dash-input-num"
        inputMode="numeric"
        value={portText}
        placeholder={t('diagnostics.portOptional')}
        aria-invalid={portInvalid}
        onChange={(event) => setPortText(event.target.value.trim())}
      />
      <button
        type="button"
        className="btn btn-accent"
        disabled={running || portInvalid || selected === null}
        onClick={() => void runCheck()}
      >
        <RefreshIcon size={14} />
        {running ? t('diagnostics.checking') : t('diagnostics.runRecovery')}
      </button>
      <button type="button" className="btn" onClick={() => void exportBundle()}>
        <FileIcon size={14} />
        {t('diagnostics.export')}
      </button>
    </div>
  )

  return (
    <Card titleKey="diagnostics.title" actions={actions} className="diagnostics-card">
      <p className="dim diagnostics-intro">{t('diagnostics.intro')}</p>
      <section className="diag-section" aria-labelledby="performance-heading">
        <h3 id="performance-heading" className="diag-heading">
          {t('diagnostics.performance.title', { defaultValue: 'Local slowdown recording' })}
        </h3>
        <p className="dim diagnostics-intro">
          {t('diagnostics.performance.description', { defaultValue: 'Off by default. Records timing and app CPU/memory in a local file only. No data is sent.' })}
        </p>
        <div className="diagnostics-actions">
          <button type="button" className="btn" disabled={performanceBusy || performanceState.writeError} onClick={() => void togglePerformance()}>
            {performanceState.enabled
              ? t('diagnostics.performance.stop', { defaultValue: 'Stop recording' })
              : t('diagnostics.performance.start', { defaultValue: 'Start recording' })}
          </button>
          <button type="button" className="btn" disabled={!performanceState.path || performanceState.enabled} onClick={() => void exportPerformance()}>
            {t('diagnostics.performance.export', { defaultValue: 'Export recording' })}
          </button>
        </div>
        {performanceState.writeError && (
          <p role="alert" className="diag-validation">
            {t('diagnostics.performance.writeError', {
              count: performanceState.unsavedSamples,
              defaultValue: 'Recording stopped: local file write failed. {{count}} samples are still in memory. Keep WSLPad open and choose Export recording to retry.'
            })}
          </p>
        )}
        {performanceState.path && <p className="dim mono diag-performance-path">{performanceState.path}</p>}
        <h4 className="diag-heading">{t('diagnostics.performance.slow', { defaultValue: 'Slow intervals' })}</h4>
        {performanceState.intervals.length === 0 ? (
          <p className="dim">{t('diagnostics.performance.empty', { defaultValue: 'No intervals over the thresholds yet.' })}</p>
        ) : (
          <ol className="diag-timeline">
            {performanceState.intervals.map((interval, index) => (
              <li key={`${interval.start}-${interval.kind}-${index}`} className="diag-incident">
                <time dateTime={interval.start}>{formatter.format(new Date(interval.start))}</time>
                <div className="diag-incident-text">
                  {interval.kind}: {interval.peakMs} ms · {interval.count} samples
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      {portInvalid ? <div className="diag-validation">{t('diagnostics.invalidPort')}</div> : null}

      <section className="diag-section" aria-labelledby="recovery-heading">
        <h3 id="recovery-heading" className="diag-heading">
          {t('diagnostics.recovery.title')}
        </h3>
        {recovery === null ? (
          <div className="dim">{t('diagnostics.recovery.empty')}</div>
        ) : (
          <>
            <div className="diag-recovery-summary">
              <div>
                <span className="dim">{t('diagnostics.recovery.recommended')}</span>{' '}
                <strong>
                  {t(`diagnostics.recovery.steps.${STEP_KEYS[recovery.recommendedStep]}.title`)}
                </strong>
              </div>
              <div className="dim">
                {t('diagnostics.recovery.serverSummary', {
                  count: recovery.vscodeProcesses.length,
                  installed:
                    recovery.vscodeServerInstalled === null
                      ? t('common.unknown')
                      : recovery.vscodeServerInstalled
                        ? t('common.yes')
                        : t('common.no')
                })}
              </div>
            </div>

            {recovery.vscodeProcesses.length > 0 ? (
              <div
                className="diag-editor-processes"
                aria-label={t('diagnostics.recovery.processes')}
              >
                {recovery.vscodeProcesses.map((process) => (
                  <div className="diag-editor-process" key={process.pid}>
                    <span className="badge">{t(`diagnostics.recovery.roles.${process.role}`)}</span>
                    <span className="mono">PID {process.pid}</span>
                    <span className="dim">CPU {formatPercent(locale, process.cpuPercent)}</span>
                    <span className="dim">MEM {formatPercent(locale, process.memPercent)}</span>
                    <span className="dim">{formatDuration(locale, process.elapsedSeconds)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {recovery.resumedAt !== null ? (
              <div className="diag-resume-context">
                <strong>{t('diagnostics.recovery.afterResume')}</strong>{' '}
                {recovery.resumeChanges.length === 0 ? (
                  <span className="dim">{t('diagnostics.recovery.noResumeChanges')}</span>
                ) : (
                  recovery.resumeChanges.map((change) => (
                    <span className="diag-resume-change" key={change.id}>
                      {t(`diagnostics.recovery.resumeChange.${change.id}`)}:{' '}
                      <span className="mono">
                        {change.before} → {change.after}
                      </span>
                    </span>
                  ))
                )}
              </div>
            ) : null}

            <ol className="diag-recovery-steps">
              {recovery.steps.map((step, index) => {
                const key = STEP_KEYS[step.id]
                return (
                  <li className={`diag-recovery-step diag-step-${step.status}`} key={step.id}>
                    <span className="diag-step-number">{index + 1}</span>
                    <div className="diag-step-body">
                      <div className="diag-step-title">
                        <strong>{t(`diagnostics.recovery.steps.${key}.title`)}</strong>
                        <span className={`badge diag-status diag-step-badge-${step.status}`}>
                          {t(`diagnostics.recovery.status.${step.status}`)}
                        </span>
                      </div>
                      <div>{t(`diagnostics.recovery.steps.${key}.reason`)}</div>
                      <div className="dim">{t(`diagnostics.recovery.steps.${key}.impact`)}</div>
                      {step.command ? (
                        <div className="mono diag-step-command">{step.command}</div>
                      ) : null}
                    </div>
                    {step.command && step.status !== 'unavailable' ? (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => prepare(step.command!)}
                      >
                        {t('diagnostics.recovery.prepare')}
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </section>

      <section className="diag-section" aria-labelledby="network-check-heading">
        <h3 id="network-check-heading" className="diag-heading">
          {t('diagnostics.lastCheck')}
        </h3>
        {network === null ? (
          <div className="dim">{t('diagnostics.noCheck')}</div>
        ) : (
          <div className="diag-probes">
            {network.probes.map((probe) => (
              <div className="diag-probe" key={probe.id}>
                {statusIcon(probe.status)}
                <span className="diag-probe-name">{t(PROBE_KEYS[probe.id])}</span>
                <span className={`badge diag-status diag-status-${probe.status}`}>
                  {t(`diagnostics.status.${probe.status}`)}
                </span>
                <span className="dim mono diag-probe-detail">{probe.detail}</span>
                <span className="dim diag-duration">{probe.durationMs} ms</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="diag-section" aria-labelledby="incident-heading">
        <h3 id="incident-heading" className="diag-heading">
          {t('diagnostics.timeline')}
        </h3>
        {state.incidents.length === 0 ? (
          <div className="dim">{t('diagnostics.noIncidents')}</div>
        ) : (
          <ol className="diag-timeline">
            {state.incidents.map((event) => (
              <li key={event.id} className={`diag-incident diag-${event.severity}`}>
                <time dateTime={event.at}>{formatter.format(new Date(event.at))}</time>
                {incidentIcon(event)}
                <div className="diag-incident-text">
                  <div>{t(event.messageKey, { ...event.params, defaultValue: event.message })}</div>
                  {event.detail ? <div className="dim mono">{event.detail}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Card>
  )
}
