import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DiagnosticsState,
  IncidentEvent,
  NetworkProbeResult,
  NetworkProbeStatus
} from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import { CheckIcon, FileIcon, RefreshIcon, WarningIcon } from '../components/Icons'

const EMPTY: DiagnosticsState = { incidents: [], lastNetworkCheck: null }

const PROBE_KEYS: Record<NetworkProbeResult['id'], string> = {
  distro: 'diagnostics.probe.distro',
  'wsl-dns': 'diagnostics.probe.wslDns',
  'windows-dns': 'diagnostics.probe.windowsDns',
  'default-route': 'diagnostics.probe.defaultRoute',
  'windows-localhost': 'diagnostics.probe.windowsLocalhost'
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
  const { snapshot, pushToast } = useApp()
  const [state, setState] = useState<DiagnosticsState>(EMPTY)
  const [portText, setPortText] = useState('')
  const [running, setRunning] = useState(false)

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
      const result = await window.wslpad.diagnostics.runNetworkCheck(parsedPort ?? undefined)
      setState((current) => ({ ...current, lastNetworkCheck: result }))
      const failed = result.probes.filter((probe) => probe.status === 'fail').length
      pushToast(
        failed > 0 ? 'error' : 'success',
        t('diagnostics.checkComplete', {
          failed,
          defaultValue: 'Network check complete — {{failed}} failed'
        })
      )
    } catch {
      pushToast('error', t('common.error'))
    } finally {
      setRunning(false)
    }
  }

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
        {running ? t('diagnostics.checking') : t('diagnostics.runCheck')}
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
      {portInvalid ? <div className="diag-validation">{t('diagnostics.invalidPort')}</div> : null}

      <section className="diag-section" aria-labelledby="network-check-heading">
        <h3 id="network-check-heading" className="diag-heading">
          {t('diagnostics.lastCheck')}
        </h3>
        {state.lastNetworkCheck === null ? (
          <div className="dim">{t('diagnostics.noCheck')}</div>
        ) : (
          <div className="diag-probes">
            {state.lastNetworkCheck.probes.map((probe) => (
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
