import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClockInfo, DistroDetails, LocaleCode, SystemInfo } from '@shared/types'
import { CLOCK_SKEW_WARN_SECONDS } from '@shared/constants'
import { formatDuration, formatNumber } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'

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

/** Reads the Windows RTC — which is where a WSL distro takes its time from. */
const HWCLOCK_COMMAND = 'sudo hwclock -s'
const TIMESYNCD_COMMAND = 'sudo systemctl restart systemd-timesyncd'

export interface OverviewCardProps {
  distro: DistroDetails
  system: SystemInfo
  /** null until both clocks have been sampled; never assumed to agree. */
  clock: ClockInfo | null
}

export default function OverviewCard({
  distro,
  system,
  clock
}: OverviewCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const locale = i18n.language as LocaleCode
  const v = (x: string | null): string => x ?? '—'

  // Seconds are the point of these two rows, so the shared short-time format
  // (hours and minutes only) would hide exactly what is being compared.
  const time = (iso: string | null): string => {
    if (iso === null) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(d)
  }

  const skew = clock?.skewSeconds ?? null
  const drifted = skew !== null && Math.abs(skew) >= CLOCK_SKEW_WARN_SECONDS

  // Nothing is executed here: the text only lands in the Console input for the
  // user to read and press Enter on (goal.md §2.2).
  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const skewValue = (): ReactNode => {
    if (skew === null) return <span className="dim">{t('dashboard.overview.clockUnknown')}</span>
    if (skew === 0)
      return <span className="badge badge-ok">{t('dashboard.overview.clockInSync')}</span>
    const seconds = formatNumber(locale, Math.abs(skew))
    const text =
      skew < 0
        ? t('dashboard.overview.clockBehind', { seconds })
        : t('dashboard.overview.clockAhead', { seconds })
    return drifted ? <span className="badge badge-warn">{text}</span> : <span>{text}</span>
  }

  const fixRow = (command: string): React.JSX.Element => (
    <Kv k={t('dashboard.overview.clockFix', { defaultValue: 'Put the clock back in step' })}>
      <button type="button" className="btn btn-small" onClick={() => prepare(command)}>
        {t('dashboard.overview.clockPrepare', { defaultValue: 'Prepare {{command}}', command })}
      </button>
    </Kv>
  )

  return (
    <Card titleKey="dashboard.overview.title">
      <div className="overview-head">
        <span className="overview-name">{distro.name}</span>
        <span className={distro.state === 'Running' ? 'badge badge-ok' : 'badge badge-dim'}>
          {t(`wsl.state${distro.state}`)}
        </span>
        <span className="badge badge-dim">
          {t('wsl.wslVersion', { version: distro.wslVersion })}
        </span>
        {distro.isDefault ? (
          <span className="badge badge-accent">{t('topbar.defaultBadge')}</span>
        ) : null}
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

      {/* Issue #28: the drift itself is invisible in every error it causes. */}
      {clock === null ? null : (
        <>
          <div className="path-label">{t('dashboard.overview.clock')}</div>
          <Kv k={t('dashboard.overview.clockWindows')} mono>
            <span title={clock.windowsIso ?? undefined}>{time(clock.windowsIso)}</span>
          </Kv>
          <Kv k={t('dashboard.overview.clockDistro')} mono>
            <span title={clock.distroIso ?? undefined}>{time(clock.distroIso)}</span>
          </Kv>
          <Kv k={t('dashboard.overview.clockSkew')}>{skewValue()}</Kv>
          {skew === null ? null : (
            <div className="kv-row dim">
              {t('dashboard.overview.clockApprox', {
                defaultValue:
                  'The two clocks are read a moment apart, so this difference is approximate.'
              })}
            </div>
          )}
          {drifted ? (
            <>
              <div className="kv-row dim">{t('dashboard.overview.clockHint')}</div>
              {fixRow(HWCLOCK_COMMAND)}
              {/* Only offered where a time daemon exists to restart. */}
              {system.systemdEnabled === true ? fixRow(TIMESYNCD_COMMAND) : null}
              <div className="kv-row dim">
                {t('dashboard.overview.clockPrepareHint', {
                  defaultValue:
                    'The command is only placed in the Console — nothing runs until you press Enter.'
                })}
              </div>
            </>
          ) : null}
        </>
      )}
    </Card>
  )
}
