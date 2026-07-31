import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HermesInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { ExternalIcon, FolderIcon } from '../components/Icons'

const shQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`

/** Parent directory of a Linux path. */
const dirname = (p: string): string => p.replace(/\/[^/]*$/, '') || '/'

/** `hermes dashboard` binds 127.0.0.1 and opens a browser unless told not to. */
const DASHBOARD_COMMAND = 'hermes dashboard --no-open'

function Kv({
  k,
  mono,
  children
}: {
  k: string
  mono?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className={mono ? 'kv-val mono' : 'kv-val'}>{children}</span>
    </div>
  )
}

export interface HermesCardProps {
  hermes: HermesInfo | null
}

export default function HermesCard({ hermes }: HermesCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { prepareCommand, pushToast, navigateExplorer } = useApp()
  const service = hermes?.services[0]

  // Buttons only prepare the command in the Console input — never run it
  // (goal.md §6.6). Hidden when no systemd user service is known.
  const prepare = (verb: 'start' | 'restart'): void => {
    if (!service) return
    prepareCommand(`systemctl --user ${verb} ${shQuote(service)}`)
    pushToast('info', t('toast.commandPrepared'))
  }

  const prepareDashboard = (): void => {
    prepareCommand(DASHBOARD_COMMAND)
    pushToast('info', t('toast.commandPrepared'))
  }

  /**
   * A path row that can be copied and opened. Every other section offers this
   * for its paths; Hermes printed them as plain text (0.1.9 menu audit).
   */
  const pathRow = (label: string, path: string | null, dir = false): React.JSX.Element => (
    <Kv k={label} mono>
      {path === null ? (
        '—'
      ) : (
        <>
          <span className="truncate" title={path}>
            {path}
          </span>
          <CopyButton text={path} labelKey="dashboard.config.copyPath" />
          <button
            type="button"
            className="icon-btn"
            aria-label={t('dashboard.config.showInExplorer')}
            title={t('dashboard.config.showInExplorer')}
            onClick={() => {
              navigateExplorer(dir ? path : dirname(path), 'linux')
              pushToast('info', t('toast.openedInExplorer'))
            }}
          >
            <FolderIcon size={14} />
          </button>
        </>
      )}
    </Kv>
  )
  const detect = (status: 'running' | 'not-detected'): React.JSX.Element =>
    status === 'running' ? (
      <span className="badge badge-ok">{t('common.running')}</span>
    ) : (
      <span className="badge badge-dim">{t('common.notDetected')}</span>
    )

  const connected = hermes?.platforms.filter((p) => p.configured) ?? []
  const dashboardUrl =
    hermes?.dashboardPort === null || hermes?.dashboardPort === undefined
      ? null
      : `http://127.0.0.1:${hermes.dashboardPort}`

  return (
    <Card
      titleKey="dashboard.hermes.title"
      className="dash-card-hermes"
      actions={
        hermes?.installed ? (
          <>
            {service ? (
              <>
                <button type="button" className="btn btn-small" onClick={() => prepare('start')}>
                  {t('dashboard.hermes.prepareStart')}
                </button>
                <button type="button" className="btn btn-small" onClick={() => prepare('restart')}>
                  {t('dashboard.hermes.prepareRestart')}
                </button>
              </>
            ) : null}
            {/* The dashboard is a server the user starts; WSLPad only writes
                the command into the Console (goal.md §2.2). */}
            {hermes.dashboardStatus === 'running' ? null : (
              <button
                type="button"
                className="btn btn-small"
                title={t('dashboard.hermes.prepareDashboardHint')}
                onClick={prepareDashboard}
              >
                {t('dashboard.hermes.prepareDashboard')}
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {!hermes ? (
        <div className="dim">{t('common.notDetected')}</div>
      ) : (
        <>
          <Kv k={t('common.installed')}>{hermes.installed ? t('common.yes') : t('common.no')}</Kv>
          {pathRow(t('dashboard.hermes.executable'), hermes.executablePath)}
          {pathRow(t('dashboard.hermes.data'), hermes.dataDir, true)}
          {pathRow(t('dashboard.hermes.venv'), hermes.venvPath, true)}
          {pathRow(t('dashboard.hermes.config'), hermes.configPath)}
          <Kv k={t('dashboard.hermes.gateway')}>{detect(hermes.gatewayStatus)}</Kv>

          {/* Which messenger the gateway actually carries. Hermes lists every
              platform it supports, so only the configured ones are named — but
              an empty answer says "none configured", not "unknown". */}
          <Kv k={t('dashboard.hermes.messengers')}>
            {hermes.platforms.length === 0 ? (
              <span className="dim">{t('common.unknown')}</span>
            ) : connected.length === 0 ? (
              <span className="badge badge-dim">{t('dashboard.hermes.noMessenger')}</span>
            ) : (
              <span className="badge-row">
                {connected.map((p) => (
                  <span key={p.name} className="badge badge-ok" title={p.detail ?? undefined}>
                    {p.name}
                  </span>
                ))}
              </span>
            )}
          </Kv>
          {hermes.platforms.length > 0 && connected.length === 0 ? (
            <Kv k={t('dashboard.hermes.supportedMessengers')}>
              <span className="dim truncate" title={hermes.platforms.map((p) => p.name).join(', ')}>
                {hermes.platforms.map((p) => p.name).join(', ')}
              </span>
            </Kv>
          ) : null}

          <Kv k={t('dashboard.hermes.agents')}>
            {hermes.profiles.length === 0 ? (
              <span className="dim">{t('common.unknown')}</span>
            ) : (
              <>
                {hermes.profiles.length}
                <span className="badge-row">
                  {hermes.profiles.map((p) => (
                    <span
                      key={p.name}
                      className={p.isCurrent ? 'badge badge-accent' : 'badge badge-dim'}
                      title={[p.model, p.gatewayState].filter(Boolean).join(' · ') || undefined}
                    >
                      {p.name}
                    </span>
                  ))}
                </span>
              </>
            )}
          </Kv>
          <Kv k={t('dashboard.hermes.sessions')}>{hermes.activeSessions ?? '—'}</Kv>
          <Kv k={t('dashboard.hermes.jobs')}>{hermes.scheduledJobs ?? '—'}</Kv>

          <Kv k={t('dashboard.hermes.dashboard')}>
            {detect(hermes.dashboardStatus)}
            {dashboardUrl === null ? null : (
              <>
                <span className="mono">{dashboardUrl}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.ports.openInBrowser')}
                  title={t('dashboard.ports.openInBrowser')}
                  onClick={() => void window.wslpad.openExternal(dashboardUrl)}
                >
                  <ExternalIcon size={14} />
                </button>
              </>
            )}
          </Kv>
          <Kv k={t('dashboard.hermes.mcpServers')}>{hermes.mcpServerCount ?? '—'}</Kv>
          <Kv k={t('dashboard.hermes.ports')} mono>
            {hermes.ports.length > 0 ? hermes.ports.join(', ') : '—'}
          </Kv>
          <Kv k={t('dashboard.hermes.services')} mono>
            {hermes.services.length > 0 ? hermes.services.join(', ') : '—'}
          </Kv>
          {hermes.logPaths.length === 0
            ? pathRow(t('dashboard.hermes.logs'), null)
            : hermes.logPaths.map((p) => (
                <Fragment key={p}>{pathRow(t('dashboard.hermes.logs'), p, true)}</Fragment>
              ))}
        </>
      )}
    </Card>
  )
}
