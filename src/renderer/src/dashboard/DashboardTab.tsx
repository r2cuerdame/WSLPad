import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { WarningIcon } from '../components/Icons'
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
import McpCard from './McpCard'
import CopyForLlm from './CopyForLlm'
import './dashboard.css'

const SKELETON_CARD_COUNT = 12

export default function DashboardTab(): React.JSX.Element {
  const { snapshot } = useApp()
  const { t } = useTranslation()

  // WSL missing entirely: guidance screen instead of empty cards (goal.md §15).
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
        <div className="dashboard-grid">
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
            <div key={i} className="dash-skeleton" />
          ))}
        </div>
      </div>
    )
  }

  const seen = new Set<string>()
  const warnings = [...snapshot.warnings, ...dash.warnings].filter((w) => {
    if (seen.has(w.id)) return false
    seen.add(w.id)
    return true
  })

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <CopyForLlm />
      </div>
      <div className="dashboard-grid">
        <OverviewCard distro={dash.distro} system={dash.system} />
        <ResourceCard resources={dash.resources} />
        <HermesCard hermes={dash.hermes} />
        <McpCard mcp={snapshot.mcp} />
        <PathsCard paths={dash.paths} />
        <ConfigCard files={dash.configuration} />
        <ToolsCard tools={dash.tools} />
        <EnvironmentCard env={dash.environment} />
        <ProcessesCard processes={dash.processes} />
        <ServicesCard services={dash.services} systemdEnabled={dash.system.systemdEnabled} />
        <PortsCard ports={dash.ports} />
        <WarningsCard warnings={warnings} />
      </div>
    </div>
  )
}
