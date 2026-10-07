import { useEffect, useState } from 'react'
import { detectLocale } from '@shared/i18n'
import type { LocaleCode } from '@shared/types'
import { AppStoreProvider, useApp } from './store'
import { i18n, initRendererI18n } from './i18n'
import TopBar from './TopBar'
import DashboardTab from './dashboard/DashboardTab'
import ExplorerTab from './explorer/ExplorerTab'
import RecoveryTab from './recovery/RecoveryTab'
import ConsolePanel from './console/ConsolePanel'
import SettingsDrawer from './settings/SettingsDrawer'
import { Toasts } from './components/Toasts'

initRendererI18n(detectLocale([...navigator.languages]))

function resolveTheme(theme: string): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function Shell(): React.JSX.Element {
  const { settings, tab } = useApp()
  const [recordingPerformance, setRecordingPerformance] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.wslpad.performance.get().then((state) => {
      if (mounted) setRecordingPerformance(state.enabled)
    })
    const off = window.wslpad.performance.onChange((state) => setRecordingPerformance(state.enabled))
    return () => { mounted = false; off() }
  }, [])

  useEffect(() => {
    if (!recordingPerformance) return
    let frame = 0
    let last = 0
    const measure = (now: number): void => {
      if (document.visibilityState === 'visible' && last > 0 && now - last >= 100) {
        void window.wslpad.performance.record('render', now - last).catch(() => {})
      }
      last = document.visibilityState === 'visible' ? now : 0
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [recordingPerformance])

  useEffect(() => {
    if (!settings) return
    const locale: LocaleCode =
      settings.language === 'auto' ? detectLocale([...navigator.languages]) : settings.language
    if (i18n.language !== locale) void i18n.changeLanguage(locale)
  }, [settings])

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(settings?.theme ?? 'system')
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  // Both tabs stay mounted so Explorer/Console state survives tab switches (goal.md §5.3)
  return (
    <div className="app-shell">
      <TopBar />
      <main className="tab-content" style={{ display: tab === 'dashboard' ? undefined : 'none' }}>
        <DashboardTab />
      </main>
      <main className="tab-content" style={{ display: tab === 'explorer' ? undefined : 'none' }}>
        <ExplorerTab />
      </main>
      <main className="tab-content" style={{ display: tab === 'migration' ? undefined : 'none' }}>
        <RecoveryTab />
      </main>
      <ConsolePanel />
      <SettingsDrawer />
      <Toasts />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppStoreProvider>
      <Shell />
    </AppStoreProvider>
  )
}
