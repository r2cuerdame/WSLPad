import { useTranslation } from 'react-i18next'
import { useApp } from './store'
import { GearIcon, PauseIcon, PlayIcon, RefreshIcon } from './components/Icons'

/** Top bar: distro selector + state, MCP badge, refresh, pause, settings (goal.md §5.1). */
export default function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { snapshot, settings, tab, setTab, selectDistro, refresh, openSettings } = useApp()

  const distros = snapshot?.distros ?? []
  const selected = snapshot?.selectedDistro ?? ''
  const selectedInfo = distros.find((d) => d.name === selected)
  const mcp = snapshot?.mcp
  const paused = settings?.monitoring.paused ?? false

  const mcpLabel = mcp?.running
    ? t('topbar.mcpReady')
    : mcp?.error
      ? t('topbar.mcpError')
      : t('topbar.mcpOff')
  const mcpClass = mcp?.running ? 'ok' : mcp?.error ? 'err' : 'dim'

  return (
    // The window title bar already carries the product name — repeating it here
    // just duplicates it (user feedback), so the distro selector leads instead.
    <header className="topbar">
      <div className="topbar-distro">
        <select
          aria-label={t('topbar.distroSelector')}
          value={selected}
          onChange={(e) => void selectDistro(e.target.value)}
          disabled={distros.length === 0}
        >
          {distros.length === 0 && <option value="">{t('topbar.noDistros')}</option>}
          {distros.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
              {d.isDefault ? ` (${t('topbar.defaultBadge')})` : ''}
            </option>
          ))}
        </select>
        {selectedInfo && (
          // The dot alone would encode the state in hue only, so it always
          // carries the state word next to it (goal.md §16).
          <span className="topbar-state" title={t(`wsl.state${selectedInfo.state}`)}>
            <span
              className={`state-dot ${selectedInfo.state === 'Running' ? 'ok' : 'dim'}`}
              aria-hidden="true"
            />
            {t(`wsl.state${selectedInfo.state}`)}
          </span>
        )}
      </div>

      <nav className="tabs-inline" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'dashboard'}
          className={tab === 'dashboard' ? 'tab active' : 'tab'}
          onClick={() => setTab('dashboard')}
        >
          {t('tabs.dashboard')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'explorer'}
          className={tab === 'explorer' ? 'tab active' : 'tab'}
          onClick={() => setTab('explorer')}
        >
          {t('tabs.explorer')}
        </button>
      </nav>

      <div className="topbar-right">
        <span className={`mcp-badge ${mcpClass}`} title={mcp?.endpoint ?? ''}>
          <span className="dot" aria-hidden="true" />
          <span>{mcpLabel}</span>
        </span>
        {paused && <span className="paused-badge">{t('topbar.monitoringPaused')}</span>}
        <span className="topbar-divider" aria-hidden="true" />
        <div className="topbar-actions">
          <button
            className="icon-btn"
            aria-label={t('topbar.refresh')}
            title={t('topbar.refresh')}
            onClick={() => void refresh()}
          >
            <RefreshIcon />
          </button>
          <button
            className="icon-btn"
            aria-label={paused ? t('topbar.resumeMonitoring') : t('topbar.pauseMonitoring')}
            title={paused ? t('topbar.resumeMonitoring') : t('topbar.pauseMonitoring')}
            onClick={() => void window.wslpad.setMonitoringPaused(!paused)}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            className="icon-btn"
            aria-label={t('topbar.settings')}
            title={t('topbar.settings')}
            onClick={openSettings}
            data-testid="settings-button"
          >
            <GearIcon />
          </button>
        </div>
      </div>
    </header>
  )
}
