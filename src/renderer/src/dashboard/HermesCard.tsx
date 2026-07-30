import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HermesInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'

const shQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`

function Kv({ k, mono, children }: { k: string; mono?: boolean; children: ReactNode }): React.JSX.Element {
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
  const { prepareCommand, pushToast } = useApp()
  const service = hermes?.services[0]

  // Buttons only prepare the command in the Console input — never run it
  // (goal.md §6.6). Hidden when no systemd user service is known.
  const prepare = (verb: 'start' | 'restart'): void => {
    if (!service) return
    prepareCommand(`systemctl --user ${verb} ${shQuote(service)}`)
    pushToast('info', t('toast.commandPrepared'))
  }

  const v = (x: string | null): string => x ?? '—'
  const detect = (status: 'running' | 'not-detected'): React.JSX.Element =>
    status === 'running' ? (
      <span className="badge badge-ok">{t('common.running')}</span>
    ) : (
      <span className="badge badge-dim">{t('common.notDetected')}</span>
    )

  return (
    <Card
      titleKey="dashboard.hermes.title"
      className="dash-card-hermes"
      actions={
        service ? (
          <>
            <button type="button" className="btn btn-small" onClick={() => prepare('start')}>
              {t('dashboard.hermes.prepareStart')}
            </button>
            <button type="button" className="btn btn-small" onClick={() => prepare('restart')}>
              {t('dashboard.hermes.prepareRestart')}
            </button>
          </>
        ) : undefined
      }
    >
      {!hermes ? (
        <div className="dim">{t('common.notDetected')}</div>
      ) : (
        <>
          <Kv k={t('common.installed')}>
            {hermes.installed ? t('common.yes') : t('common.no')}
          </Kv>
          <Kv k={t('dashboard.hermes.executable')} mono>
            {v(hermes.executablePath)}
          </Kv>
          <Kv k={t('dashboard.hermes.data')} mono>
            {v(hermes.dataDir)}
          </Kv>
          <Kv k={t('dashboard.hermes.venv')} mono>
            {v(hermes.venvPath)}
          </Kv>
          <Kv k={t('dashboard.hermes.config')} mono>
            {v(hermes.configPath)}
          </Kv>
          <Kv k={t('dashboard.hermes.gateway')}>{detect(hermes.gatewayStatus)}</Kv>
          <Kv k={t('dashboard.hermes.dashboard')}>{detect(hermes.dashboardStatus)}</Kv>
          <Kv k={t('dashboard.hermes.mcpServers')}>{hermes.mcpServerCount ?? '—'}</Kv>
          <Kv k={t('dashboard.hermes.ports')} mono>
            {hermes.ports.length > 0 ? hermes.ports.join(', ') : '—'}
          </Kv>
          <Kv k={t('dashboard.hermes.services')} mono>
            {hermes.services.length > 0 ? hermes.services.join(', ') : '—'}
          </Kv>
          <Kv k={t('dashboard.hermes.logs')} mono>
            {hermes.logPaths.length > 0 ? hermes.logPaths.join(', ') : '—'}
          </Kv>
        </>
      )}
    </Card>
  )
}
