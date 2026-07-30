import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DistroDetails, LocaleCode, SystemInfo } from '@shared/types'
import { formatDuration } from '@shared/format'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'

function Kv({ k, mono, children }: { k: string; mono?: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className={mono ? 'kv-val mono' : 'kv-val'}>{children}</span>
    </div>
  )
}

export interface OverviewCardProps {
  distro: DistroDetails
  system: SystemInfo
}

export default function OverviewCard({ distro, system }: OverviewCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const v = (x: string | null): string => x ?? '—'

  return (
    <Card titleKey="dashboard.overview.title">
      <div className="overview-head">
        <span className="overview-name">{distro.name}</span>
        <span className={distro.state === 'Running' ? 'badge badge-ok' : 'badge badge-dim'}>
          {t(`wsl.state${distro.state}`)}
        </span>
        <span className="badge badge-dim">{t('wsl.wslVersion', { version: distro.wslVersion })}</span>
        {distro.isDefault ? <span className="badge badge-accent">{t('topbar.defaultBadge')}</span> : null}
      </div>
      <Kv k={t('dashboard.overview.os')}>{v(distro.osName)}</Kv>
      <Kv k={t('dashboard.overview.kernel')} mono>
        {v(system.kernel)}
      </Kv>
      <Kv k={t('dashboard.overview.hostname')} mono>
        {v(system.hostname)}
      </Kv>
      <Kv k={t('dashboard.overview.user')} mono>
        {v(system.user)}
      </Kv>
      <Kv k={t('dashboard.overview.home')} mono>
        {v(system.home)}
      </Kv>
      <Kv k={t('dashboard.overview.shell')} mono>
        {v(system.shell)}
      </Kv>
      <Kv k={t('dashboard.overview.uptime')}>{formatDuration(locale, system.uptimeSeconds)}</Kv>
      <Kv k={t('dashboard.overview.systemd')}>
        {system.systemdEnabled === true ? (
          <span className="badge badge-ok">{t('common.enabled')}</span>
        ) : system.systemdEnabled === false ? (
          <span className="badge badge-dim">{t('common.disabled')}</span>
        ) : (
          <span className="badge badge-dim">{t('common.unknown')}</span>
        )}
      </Kv>
      <Kv k={t('dashboard.overview.ip')} mono>
        {v(system.ip)}
      </Kv>
      <Kv k={t('dashboard.overview.uncPath')} mono>
        <span className="truncate" title={distro.uncPath}>
          {distro.uncPath}
        </span>
        <CopyButton text={distro.uncPath} size={13} />
      </Kv>
    </Card>
  )
}
