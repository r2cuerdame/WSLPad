import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleCode, WarningInfo } from '@shared/types'
import { formatNumber } from '@shared/format'
import { useApp } from '../store'
import { WarningIcon } from '../components/Icons'
import DashboardNav, {
  DASHBOARD_SECTIONS,
  isDashboardSectionId,
  type DashboardSectionId
} from './DashboardNav'
import OverviewCard from './OverviewCard'
import ResourceCard from './ResourceCard'
import PathsCard from './PathsCard'
import ConfigCard from './ConfigCard'
import ToolsCard from './ToolsCard'
import HermesCard from './HermesCard'
import EnvironmentCard from './EnvironmentCard'
import ProcessesCard from './ProcessesCard'
import ServicesCard from './ServicesCard'
import PortsCard from './PortsCard'
import WarningsCard from './WarningsCard'
import CopyForLlm from './CopyForLlm'
import './dashboard.css'

const STORAGE_KEY = 'wslpad.dashboard.section'

/** Stale ids such as the retired 'mcp' section resolve to overview, never a blank detail. */
function readStoredSection(): DashboardSectionId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null && isDashboardSectionId(stored)) return stored
  } catch {
    // localStorage may be unavailable; the default section is always valid.
  }
  return 'overview'
}

export default function DashboardTab(): React.JSX.Element {
  const { snapshot, focusPid } = useApp()
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const [section, setSection] = useState<DashboardSectionId>(readStoredSection)

  const selectSection = useCallback((id: DashboardSectionId) => {
    setSection(id)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Persistence is best effort — selection still applies for this session.
    }
  }, [])

  // "Show process" on the Ports section targets the Processes section.
  useEffect(() => {
    if (focusPid !== null) setSection('processes')
  }, [focusPid])

  // WSL missing entirely: guidance screen instead of an empty layout (goal.md §15).
  if (snapshot && snapshot.distros.length === 0) {
    return (
      <div className="wsl-missing" role="alert">
        <WarningIcon size={40} className="wsl-missing-icon" />
        <h2>{t('wsl.notInstalledTitle')}</h2>
        <p>{t('wsl.notInstalledBody')}</p>
        <p className="dim mono">{t('wsl.notInstalledHint')}</p>
      </div>
    )
  }

  const dash = snapshot?.dashboard
  if (!snapshot || !dash) {
    return (
      <div className="dashboard" aria-busy="true" aria-label={t('common.loading')}>
        <div className="dashboard-toolbar" />
        <div className="dashboard-split">
          <div className="dash-nav">
            <div className="dash-nav-list">
              {DASHBOARD_SECTIONS.map((s) => (
                <div key={s.id} className="dash-skeleton dash-skeleton-row" />
              ))}
            </div>
          </div>
          <div className="dashboard-detail">
            <div className="dash-skeleton dash-skeleton-detail" />
          </div>
        </div>
      </div>
    )
  }

  // Snapshot-level and dashboard-level warnings are one deduped list (goal.md §6.11).
  const seen = new Set<string>()
  const warnings: WarningInfo[] = [...snapshot.warnings, ...dash.warnings].filter((w) => {
    if (seen.has(w.id)) return false
    seen.add(w.id)
    return true
  })

  const installedTools = dash.tools.filter((tool) => tool.installed).length
  const count = (n: number, tone?: 'err'): ReactNode => (
    <span className={tone === 'err' ? 'badge badge-err dash-nav-badge' : 'badge dash-nav-badge'}>
      {formatNumber(locale, n)}
    </span>
  )
  const dot = (kind: 'ok' | 'err' | 'unknown', label: string): ReactNode => (
    <span className="dash-nav-badge">
      <span className={`dot dot-${kind}`} />
      <span className="sr-only">{label}</span>
    </span>
  )

  const gatewayRunning = dash.hermes?.gatewayStatus === 'running'
  const badges: Partial<Record<DashboardSectionId, ReactNode>> = {
    tools: count(installedTools),
    hermes: dot(
      gatewayRunning ? 'ok' : 'unknown',
      gatewayRunning ? t('common.running') : t('common.notDetected')
    ),
    environment: count(dash.environment.length),
    processes: count(dash.processes.length),
    services: count(dash.services.length),
    ports: count(dash.ports.length),
    warnings: count(warnings.length, warnings.length > 0 ? 'err' : undefined)
  }

  const items = (n: number): string =>
    t('dashboard.detail.itemCount', { count: n, defaultValue: '{{count}} items' })

  const subtitles: Partial<Record<DashboardSectionId, string>> = {
    paths: items(dash.paths.length),
    configuration: items(dash.configuration.length),
    tools: t('dashboard.detail.toolsInstalled', {
      installed: formatNumber(locale, installedTools),
      total: formatNumber(locale, dash.tools.length),
      defaultValue: '{{installed}} of {{total}} installed'
    }),
    environment: items(dash.environment.length),
    processes: items(dash.processes.length),
    services: items(dash.services.length),
    ports: items(dash.ports.length),
    warnings: warnings.length > 0 ? items(warnings.length) : t('dashboard.warnings.empty')
  }

  const detail = (): React.JSX.Element => {
    switch (section) {
      case 'overview':
        return <OverviewCard distro={dash.distro} system={dash.system} />
      case 'resources':
        return <ResourceCard resources={dash.resources} />
      case 'paths':
        return <PathsCard paths={dash.paths} />
      case 'configuration':
        return <ConfigCard files={dash.configuration} />
      case 'tools':
        return <ToolsCard tools={dash.tools} />
      case 'hermes':
        return <HermesCard hermes={dash.hermes} />
      case 'environment':
        return <EnvironmentCard env={dash.environment} />
      case 'processes':
        return <ProcessesCard processes={dash.processes} />
      case 'services':
        return <ServicesCard services={dash.services} systemdEnabled={dash.system.systemdEnabled} />
      case 'ports':
        return <PortsCard ports={dash.ports} />
      case 'warnings':
        return <WarningsCard warnings={warnings} />
    }
  }

  const titleKey =
    DASHBOARD_SECTIONS.find((s) => s.id === section)?.titleKey ?? 'dashboard.overview.title'
  const subtitle = subtitles[section]

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <CopyForLlm />
      </div>
      <div className="dashboard-split">
        <DashboardNav selected={section} onSelect={selectSection} badges={badges} />
        <section
          className="dashboard-detail"
          data-testid="dashboard-detail"
          aria-label={t(titleKey)}
        >
          <header className="dashboard-detail-header">
            <h2 className="dashboard-detail-title">{t(titleKey)}</h2>
            {subtitle ? <span className="dim dashboard-detail-subtitle">{subtitle}</span> : null}
          </header>
          <div className="dashboard-detail-body">{detail()}</div>
        </section>
      </div>
    </div>
  )
}
