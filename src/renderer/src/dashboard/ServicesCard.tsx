import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServiceInfo } from '@shared/types'
import {
  findServiceCatalogEntry,
  type ServiceCatalogEntry,
  type ServiceExpectation
} from '@shared/service-catalog'
import { useApp } from '../store'
import Card from '../components/Card'
import InfoHint from '../components/InfoHint'
import { FileIcon, PauseIcon, PlayIcon, RefreshIcon } from '../components/Icons'

const shQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`

const EXPECTED_KEYS: Record<ServiceExpectation, string> = {
  running: 'dashboard.services.hint.expectedRunning',
  'on-demand': 'dashboard.services.hint.expectedOnDemand',
  varies: 'dashboard.services.hint.expectedVaries'
}

const activeBadge = (activeState: string): string =>
  activeState === 'active'
    ? 'badge badge-ok'
    : activeState === 'failed'
      ? 'badge badge-err'
      : 'badge badge-dim'

export interface ServicesCardProps {
  services: ServiceInfo[]
  systemdEnabled: boolean | null
}

export default function ServicesCard({
  services,
  systemdEnabled
}: ServicesCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { prepareCommand, pushToast, refresh } = useApp()
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    )
  }, [services, query])

  // All service actions only prepare a command for review — never execute
  // (goal.md §2.2, §6.9).
  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const ctl = (verb: string, s: ServiceInfo): string =>
    s.scope === 'user'
      ? `systemctl --user ${verb} ${shQuote(s.name)}`
      : `systemctl ${verb} ${shQuote(s.name)}`

  const logsCmd = (s: ServiceInfo): string =>
    s.scope === 'user'
      ? `journalctl --user -u ${shQuote(s.name)}`
      : `journalctl -u ${shQuote(s.name)}`

  // Vendor and expectation only appear when the catalog actually knows them.
  const hintMeta = (entry: ServiceCatalogEntry): string[] => {
    const lines: string[] = []
    if (entry.vendor) lines.push(t('dashboard.services.hint.vendor', { vendor: entry.vendor }))
    if (entry.expected) lines.push(t(EXPECTED_KEYS[entry.expected]))
    return lines
  }

  return (
    <Card
      titleKey="dashboard.services.title"
      actions={
        <>
          <input
            type="search"
            className="dash-input"
            value={query}
            placeholder={t('dashboard.services.searchPlaceholder')}
            aria-label={t('common.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            onClick={() => void refresh()}
          >
            <RefreshIcon size={14} />
          </button>
        </>
      }
    >
      {systemdEnabled === false ? (
        <div className="notice-warn">{t('dashboard.services.systemdDisabled')}</div>
      ) : null}
      {shown.length === 0 && systemdEnabled !== false ? (
        <div className="dim">{t('common.none')}</div>
      ) : null}
      <div className="dash-scroll">
        {shown.map((s) => {
          const known = findServiceCatalogEntry(s.name)
          return (
            <div key={`${s.scope}:${s.name}`} className="svc-row">
              <div className="row-main">
                <div className="path-line">
                  <span className="mono truncate" title={s.name}>
                    {s.name}
                  </span>
                  {known ? (
                    <InfoHint
                      label={t('dashboard.services.hint.label', { name: s.name })}
                      description={t(known.descriptionKey)}
                      meta={hintMeta(known)}
                    />
                  ) : null}
                  <span className="badge badge-dim">
                    {s.scope === 'user'
                      ? t('dashboard.services.scopeUser')
                      : t('dashboard.services.scopeSystem')}
                  </span>
                  <span className={activeBadge(s.activeState)}>{s.activeState}</span>
                  <span className="dim">{s.subState}</span>
                  {s.enabled ? <span className="dim">{s.enabled}</span> : null}
                </div>
                <div className="dim truncate" title={s.description}>
                  {s.description}
                </div>
              </div>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.services.prepareLogs')}
                  title={t('dashboard.services.prepareLogs')}
                  onClick={() => prepare(logsCmd(s))}
                >
                  <FileIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.services.prepareStart')}
                  title={t('dashboard.services.prepareStart')}
                  onClick={() => prepare(ctl('start', s))}
                >
                  <PlayIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.services.prepareStop')}
                  title={t('dashboard.services.prepareStop')}
                  onClick={() => prepare(ctl('stop', s))}
                >
                  <PauseIcon size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.services.prepareRestart')}
                  title={t('dashboard.services.prepareRestart')}
                  onClick={() => prepare(ctl('restart', s))}
                >
                  <RefreshIcon size={14} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
