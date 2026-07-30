import { useState } from 'react'

/**
 * Task A boot skeleton. Real layout (TopBar, Dashboard, Explorer, Console,
 * SettingsDrawer, i18n provider) is assembled during integration.
 */
export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<'dashboard' | 'explorer'>('dashboard')

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-logo">WSLPad</span>
      </header>
      <nav className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'dashboard'}
          className={tab === 'dashboard' ? 'tab active' : 'tab'}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          role="tab"
          aria-selected={tab === 'explorer'}
          className={tab === 'explorer' ? 'tab active' : 'tab'}
          onClick={() => setTab('explorer')}
        >
          Explorer
        </button>
      </nav>
      <main className="tab-content">{tab === 'dashboard' ? <div /> : <div />}</main>
      <footer className="console-panel" />
    </div>
  )
}
