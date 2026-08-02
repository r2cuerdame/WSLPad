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
import DiskCard from './DiskCard'
import WslSettingsCard, { settingNeedsAttention } from './WslSettingsCard'
import NetworkCard, { networkNeedsAttention } from './NetworkCard'
import PathsCard from './PathsCard'
import ConfigCard from './ConfigCard'
import ToolsCard, { effectiveAppendWindowsPath } from './ToolsCard'
import HermesCard from './HermesCard'
import DockerCard from './DockerCard'
import OpenClawCard, { findOpenClaw } from './OpenClawCard'
import EnvironmentCard from './EnvironmentCard'
import ProcessesCard from './ProcessesCard'
import ServicesCard from './ServicesCard'
import PortsCard from './PortsCard'
import WarningsCard from './WarningsCard'
import CopyForLlm from './CopyForLlm'
import { CardActionsSlot } from './actionsSlot'
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
  // The title row hosts the active section's controls; a ref callback in state
  // so the first render after mount actually has the node to portal into.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)

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

  // Windows-only listeners are rows too, so the badge and the subtitle count
  // what the section actually shows, not just the WSL side.
  const portRowCount = dash.ports.length + dash.windowsPorts.filter((p) => !p.fromWsl).length

  // Only settings the user can act on are badged: applied and default values
  // are the healthy majority and would drown the signal.
  const settingIssues = (dash.wslSettings?.settings ?? []).filter(settingNeedsAttention).length

  // One dot, error-toned, only when something in the section actually explains
  // a failure: a blocked inbound default or a resolver Windows no longer feeds.
  const networkIssue = networkNeedsAttention(dash.firewall, dash.dns)

  const gatewayRunning = dash.hermes?.gatewayStatus === 'running'
  const openclawRunning = (findOpenClaw(dash.tools)?.runningProcesses ?? 0) > 0
  const dockerRunning = dash.docker?.daemonRunning === true
  const dockerContainers = dash.docker?.containers.filter((c) => c.state === 'running').length ?? 0
  const badges: Partial<Record<DashboardSectionId, ReactNode>> = {
    wslconfig: settingIssues > 0 ? count(settingIssues, 'err') : undefined,
    network: networkIssue ? dot('err', t('common.warning')) : undefined,
    tools: count(installedTools),
    docker:
      dash.docker === null || !dash.docker.cliInstalled
        ? undefined
        : dockerContainers > 0
          ? count(dockerContainers)
          : dot(
              dockerRunning ? 'ok' : 'unknown',
              dockerRunning ? t('common.running') : t('common.stopped')
            ),
    hermes: dot(
      gatewayRunning ? 'ok' : 'unknown',
      gatewayRunning ? t('common.running') : t('common.notDetected')
    ),
    openclaw: dot(
      openclawRunning ? 'ok' : 'unknown',
      openclawRunning ? t('common.running') : t('common.notDetected')
    ),
    environment: count(dash.environment.length),
    processes: count(dash.processes.length),
    services: count(dash.services.length),
    ports: count(portRowCount),
    warnings: count(warnings.length, warnings.length > 0 ? 'err' : undefined)
  }

  const items = (n: number): string =>
    t('dashboard.detail.itemCount', { count: n, defaultValue: '{{count}} items' })

  const subtitles: Partial<Record<DashboardSectionId, string>> = {
    wslconfig: dash.wslSettings ? items(dash.wslSettings.settings.length) : undefined,
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
    ports: items(portRowCount),
    warnings: warnings.length > 0 ? items(warnings.length) : t('dashboard.warnings.empty')
  }

  const detail = (): React.JSX.Element => {
    switch (section) {
      case 'overview':
        return (
          <OverviewCard
            distro={dash.distro}
            liveness={snapshot.liveness}
            system={dash.system}
            clock={dash.clock}
          />
        )
      case 'resources':
        return <ResourceCard resources={dash.resources} memoryDetail={dash.memoryDetail} />
      case 'disk':
        return <DiskCard disk={dash.disk} zone={dash.zoneIdentifier} consumers={dash.diskConsumers} />
      case 'wslconfig':
        return <WslSettingsCard settings={dash.wslSettings} />
      case 'network':
        return (
          <NetworkCard
            firewall={dash.firewall}
            dns={dash.dns}
            portProxy={dash.portProxy}
            onShowPorts={() => selectSection('ports')}
          />
        )
      case 'paths':
        return <PathsCard paths={dash.paths} />
      case 'configuration':
        return (
          <ConfigCard
            files={dash.configuration}
            terminalProfiles={dash.terminalProfiles}
            distro={dash.distro.name}
          />
        )
      case 'tools':
        return (
          <ToolsCard
            tools={dash.tools}
            appendWindowsPath={effectiveAppendWindowsPath(dash.wslSettings)}
          />
        )
      case 'openclaw':
        return <OpenClawCard openclaw={findOpenClaw(dash.tools)} />
      case 'docker':
        return <DockerCard docker={dash.docker} />
      case 'hermes':
        return <HermesCard hermes={dash.hermes} />
      case 'environment':
        return <EnvironmentCard env={dash.environment} />
      case 'processes':
        return <ProcessesCard processes={dash.processes} />
      case 'services':
        return <ServicesCard services={dash.services} systemdEnabled={dash.system.systemdEnabled} />
      case 'ports':
        return <PortsCard ports={dash.ports} windowsPorts={dash.windowsPorts} />
      case 'warnings':
        return <WarningsCard warnings={warnings} />
    }
  }

  const titleKey =
    DASHBOARD_SECTIONS.find((s) => s.id === section)?.titleKey ?? 'dashboard.overview.title'
  const subtitle = subtitles[section]

  return (
    <div className="dashboard">
      <div className="dashboard-split">
        <DashboardNav selected={section} onSelect={selectSection} badges={badges} />
        <section
          className="dashboard-detail"
          data-testid="dashboard-detail"
          aria-label={t(titleKey)}
        >
          {/* The export actions ride the title row: a toolbar of its own cost a
              full row of the panel and left this corner empty (user feedback). */}
          <header className="dashboard-detail-header">
            <h2 className="dashboard-detail-title">{t(titleKey)}</h2>
            {subtitle ? <span className="dim dashboard-detail-subtitle">{subtitle}</span> : null}
            <span className="dashboard-detail-spacer" />
            <div className="dashboard-detail-actions" ref={setActionsSlot} />
            {/* Both exports act on the whole snapshot, not on the section being
                read. Sitting in every section's title row they looked like that
                section's own action, and competed with its filters for the
                line — so they live where "the whole machine" already lives. */}
            {section === 'overview' ? <CopyForLlm /> : null}
          </header>
          <CardActionsSlot.Provider value={actionsSlot}>
            <div className="dashboard-detail-body">{detail()}</div>
          </CardActionsSlot.Provider>
        </section>
      </div>
    </div>
  )
}
