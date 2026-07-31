import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SUPPORTED_LOCALES,
  type LocaleCode,
  type McpClientKind,
  type SettingsPatch
} from '@shared/types'
import type { SettingsLoadError } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'
import { updateLabel } from '@shared/update-label'
import {
  CONSOLE_DEFAULTS,
  CONSOLE_FONT_SIZE_BOUNDS,
  CONSOLE_SCROLLBACK_BOUNDS,
  MCP_PORT_BOUNDS,
  POLL_BOUNDS
} from '@shared/constants'
import { formatDateTime, formatNumber } from '@shared/format'
import { detectLocale } from '@shared/i18n'
import { Dialog } from '../components/Dialog'
import CopyButton from '../components/CopyButton'
import { useApp } from '../store'
import './settings.css'

/** Language autonyms — proper nouns, deliberately not translated (goal.md §5.4). */
const LOCALE_LABELS: Record<LocaleCode, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  hint?: string
  onCommit: (value: number) => void
}

/** Numeric input that clamps into [min, max] before persisting (goal.md §5.4). */
function NumberField({
  label,
  value,
  min,
  max,
  hint,
  onCommit
}: NumberFieldProps): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(String(value))
  }, [value])
  const commit = (): void => {
    const parsed = text.trim() === '' ? Number.NaN : Number(text)
    const next = Number.isFinite(parsed) ? clamp(Math.round(parsed), min, max) : value
    setText(String(next))
    if (next !== value) onCommit(next)
  }
  return (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      <span className="settings-field">
        <input
          type="number"
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
        {hint && <span className="settings-hint">{hint}</span>}
      </span>
    </label>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  hint?: string
  onChange: (checked: boolean) => void
}

function Toggle({ label, checked, hint, onChange }: ToggleProps): React.JSX.Element {
  return (
    <label className="settings-row">
      <span className="settings-label">
        {label}
        {hint && <span className="settings-hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

interface StatusRowProps {
  label: string
  mono?: boolean
  children: React.ReactNode
}

function StatusRow({ label, mono, children }: StatusRowProps): React.JSX.Element {
  return (
    <div className="settings-status-row">
      <span className="settings-status-key">{label}</span>
      <span className={mono ? 'settings-status-val settings-mono' : 'settings-status-val'}>
        {children}
      </span>
    </div>
  )
}

/** Right-side settings drawer — never a third main tab (goal.md §5.4). */
export function SettingsDrawer(): React.JSX.Element | null {
  const { settingsOpen, closeSettings, settings, snapshot, pushToast } = useApp()
  const { t, i18n } = useTranslation()
  const [loadError, setLoadError] = useState<SettingsLoadError | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [portAtOpen, setPortAtOpen] = useState<number | null>(null)
  const [fontFamilyText, setFontFamilyText] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusedOnce = useRef(false)

  useEffect(() => {
    if (!settingsOpen) return
    void window.wslpad.settings.getLoadError().then(setLoadError)
    void window.wslpad.app.version().then(setVersion)
    void window.wslpad.updates.getStatus().then(setUpdate)
  }, [settingsOpen])

  // A toast said the result once and then took it away, leaving the section
  // showing nothing at all — download progress and a ready update had no home
  // in the UI (user feedback). The state now lives in the section itself.
  useEffect(() => window.wslpad.updates.onStatus(setUpdate), [])

  useEffect(() => {
    if (!settingsOpen) {
      setPortAtOpen(null)
      setConfirmReset(false)
      setFontFamilyText(null)
      focusedOnce.current = false
      return
    }
    if (settings && portAtOpen === null) setPortAtOpen(settings.mcp.port)
    if (settings && !focusedOnce.current) {
      focusedOnce.current = true
      panelRef.current?.focus()
    }
  }, [settingsOpen, settings, portAtOpen])

  if (!settingsOpen || !settings) return null

  const patch = (p: SettingsPatch): void => {
    void window.wslpad.settings.set(p)
  }

  const changeLanguage = (value: LocaleCode | 'auto'): void => {
    patch({ language: value })
    const target = value === 'auto' ? detectLocale([...navigator.languages]) : value
    void i18n.changeLanguage(target)
  }

  const commitFontFamily = (): void => {
    if (fontFamilyText !== null && fontFamilyText.trim().length > 0) {
      patch({ console: { fontFamily: fontFamilyText.trim() } })
    }
    setFontFamilyText(null)
  }

  // Same mapping the tray uses, so the two never word the same state differently.
  const updateMessage = (st: UpdateStatus): string => {
    const { key, vars } = updateLabel(st)
    return t(key, vars ?? {})
  }

  const checkUpdates = async (): Promise<void> => {
    try {
      const st = await window.wslpad.updates.check()
      setUpdate(st)
      pushToast(st.state === 'error' ? 'error' : 'info', updateMessage(st))
    } catch {
      pushToast('error', t('update.error'))
    }
  }

  const copyConfigJson = async (): Promise<void> => {
    try {
      const json = await window.wslpad.mcp.getConfigJson()
      await window.wslpad.copyToClipboard(json)
      pushToast('success', t('common.copied'))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  // Client config files are only ever written on an explicit click (goal.md §11.5).
  const registerClient = async (kind: McpClientKind, client: string): Promise<void> => {
    try {
      const res = await window.wslpad.mcp.registerClient(kind)
      if (res.ok) pushToast('success', t('dashboard.mcp.registered', { client }))
      else pushToast('error', t('dashboard.mcp.registerFailed', { client }))
    } catch {
      pushToast('error', t('dashboard.mcp.registerFailed', { client }))
    }
  }

  const testConnection = async (): Promise<void> => {
    try {
      const res = await window.wslpad.mcp.test()
      if (res.ok) pushToast('success', t('dashboard.mcp.testOk'))
      else pushToast('error', t('dashboard.mcp.testFailed'))
    } catch {
      pushToast('error', t('dashboard.mcp.testFailed'))
    }
  }

  const regenerateToken = async (): Promise<void> => {
    try {
      await window.wslpad.mcp.regenerateToken()
      pushToast('success', t('settings.mcp.tokenRegenerated'))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (confirmReset) setConfirmReset(false)
      else closeSettings()
      return
    }
    if (e.key !== 'Tab') return
    // Focus trap (goal.md §5.4)
    const panel = panelRef.current
    if (!panel) return
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const portChanged = portAtOpen !== null && settings.mcp.port !== portAtOpen
  const mcp = snapshot?.mcp ?? null
  const locale = i18n.language as LocaleCode
  const secondsHint = (min: number, max: number): string =>
    `${t('settings.monitoring.seconds', { count: min / 1000 })} – ${t('settings.monitoring.seconds', { count: max / 1000 })}`

  return (
    <div className="settings-overlay" onMouseDown={closeSettings}>
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button
            type="button"
            className="settings-close"
            aria-label={t('common.close')}
            onClick={closeSettings}
          >
            ✕
          </button>
        </header>

        <div className="settings-scroll">
          {loadError?.corrupted && (
            <div className="settings-corrupted" role="alert">
              {t('settings.corruptedNotice')}
            </div>
          )}

          <section>
            <h3>{t('settings.language.title')}</h3>
            <label className="settings-row">
              <span className="settings-label">{t('settings.language.title')}</span>
              <select
                data-testid="language-select"
                value={settings.language}
                onChange={(e) => changeLanguage(e.target.value as LocaleCode | 'auto')}
              >
                <option value="auto">{t('settings.language.auto')}</option>
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_LABELS[locale]}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section>
            <h3>{t('settings.theme.title')}</h3>
            <div
              className="settings-radios"
              role="radiogroup"
              aria-label={t('settings.theme.title')}
            >
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <label key={theme} className="settings-radio">
                  <input
                    type="radio"
                    name="wslpad-theme"
                    checked={settings.theme === theme}
                    onChange={() => patch({ theme })}
                  />
                  {t(`settings.theme.${theme}`)}
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>{t('settings.general.title')}</h3>
            <Toggle
              label={t('settings.general.startWithWindows')}
              hint={t('settings.general.startWithWindowsHint')}
              checked={settings.startWithWindows}
              onChange={(checked) => patch({ startWithWindows: checked })}
            />
          </section>

          <section>
            <h3>{t('settings.monitoring.title')}</h3>
            <Toggle
              label={t('settings.monitoring.paused')}
              checked={settings.monitoring.paused}
              onChange={(checked) => patch({ monitoring: { paused: checked } })}
            />
            <NumberField
              label={t('settings.monitoring.fast')}
              value={Math.round(settings.monitoring.fastMs / 1000)}
              min={POLL_BOUNDS.fastMs.min / 1000}
              max={POLL_BOUNDS.fastMs.max / 1000}
              hint={secondsHint(POLL_BOUNDS.fastMs.min, POLL_BOUNDS.fastMs.max)}
              onCommit={(sec) => patch({ monitoring: { fastMs: sec * 1000 } })}
            />
            <NumberField
              label={t('settings.monitoring.medium')}
              value={Math.round(settings.monitoring.mediumMs / 1000)}
              min={POLL_BOUNDS.mediumMs.min / 1000}
              max={POLL_BOUNDS.mediumMs.max / 1000}
              hint={secondsHint(POLL_BOUNDS.mediumMs.min, POLL_BOUNDS.mediumMs.max)}
              onCommit={(sec) => patch({ monitoring: { mediumMs: sec * 1000 } })}
            />
            <NumberField
              label={t('settings.monitoring.slow')}
              value={Math.round(settings.monitoring.slowMs / 1000)}
              min={POLL_BOUNDS.slowMs.min / 1000}
              max={POLL_BOUNDS.slowMs.max / 1000}
              hint={secondsHint(POLL_BOUNDS.slowMs.min, POLL_BOUNDS.slowMs.max)}
              onCommit={(sec) => patch({ monitoring: { slowMs: sec * 1000 } })}
            />
          </section>

          <section>
            <h3>{t('settings.explorer.title')}</h3>
            <Toggle
              label={t('settings.explorer.showHidden')}
              checked={settings.explorer.showHiddenByDefault}
              onChange={(checked) => patch({ explorer: { showHiddenByDefault: checked } })}
            />
            <div
              className="settings-radios"
              role="radiogroup"
              aria-label={t('settings.explorer.startLocation')}
            >
              <span className="settings-label">{t('settings.explorer.startLocation')}</span>
              <label className="settings-radio">
                <input
                  type="radio"
                  name="wslpad-start-location"
                  checked={settings.explorer.startLocation === 'home'}
                  onChange={() => patch({ explorer: { startLocation: 'home' } })}
                />
                {t('settings.explorer.startHome')}
              </label>
              <label className="settings-radio">
                <input
                  type="radio"
                  name="wslpad-start-location"
                  checked={settings.explorer.startLocation === 'last'}
                  onChange={() => patch({ explorer: { startLocation: 'last' } })}
                />
                {t('settings.explorer.startLast')}
              </label>
            </div>
          </section>

          <section>
            <h3>{t('settings.console.title')}</h3>
            <NumberField
              label={t('settings.console.fontSize')}
              value={settings.console.fontSize}
              min={CONSOLE_FONT_SIZE_BOUNDS.min}
              max={CONSOLE_FONT_SIZE_BOUNDS.max}
              onCommit={(value) => patch({ console: { fontSize: value } })}
            />
            <label className="settings-row">
              <span className="settings-label">{t('settings.console.fontFamily')}</span>
              <input
                type="text"
                value={fontFamilyText ?? settings.console.fontFamily}
                onChange={(e) => setFontFamilyText(e.target.value)}
                onBlur={commitFontFamily}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitFontFamily()
                }}
              />
            </label>
            <NumberField
              label={t('settings.console.scrollback')}
              value={settings.console.scrollback}
              min={CONSOLE_SCROLLBACK_BOUNDS.min}
              max={CONSOLE_SCROLLBACK_BOUNDS.max}
              onCommit={(value) => patch({ console: { scrollback: value } })}
            />
            <button
              type="button"
              className="settings-btn"
              onClick={() => patch({ console: { ...CONSOLE_DEFAULTS } })}
            >
              {t('settings.console.restoreDefaults')}
            </button>
          </section>

          <section>
            <h3>{t('settings.mcp.title')}</h3>
            <Toggle
              label={t('settings.mcp.enabled')}
              checked={settings.mcp.enabled}
              onChange={(checked) => patch({ mcp: { enabled: checked } })}
            />
            <NumberField
              label={t('settings.mcp.port')}
              value={settings.mcp.port}
              min={MCP_PORT_BOUNDS.min}
              max={MCP_PORT_BOUNDS.max}
              hint={t('settings.mcp.portHint')}
              onCommit={(value) => patch({ mcp: { port: value } })}
            />
            {portChanged && <div className="settings-note">{t('settings.mcp.restartNote')}</div>}
            {mcp && (
              <div className="settings-status">
                <StatusRow label={t('dashboard.mcp.status')}>
                  <span className={mcp.running ? 'settings-badge ok' : 'settings-badge'}>
                    {mcp.running ? t('common.running') : t('common.stopped')}
                  </span>
                  <span className="settings-badge accent">{t('dashboard.mcp.readOnlyBadge')}</span>
                </StatusRow>
                <StatusRow label={t('dashboard.mcp.transport')} mono>
                  {mcp.transport.toUpperCase()}
                </StatusRow>
                <StatusRow label={t('dashboard.mcp.endpoint')} mono>
                  <span className="settings-status-endpoint" title={mcp.endpoint ?? undefined}>
                    {mcp.endpoint ?? '—'}
                  </span>
                </StatusRow>
                <StatusRow label={t('dashboard.mcp.clients')}>
                  {formatNumber(locale, mcp.connectedClients)}
                </StatusRow>
                <StatusRow label={t('dashboard.mcp.lastRequest')}>
                  {formatDateTime(locale, mcp.lastRequestAt)}
                </StatusRow>
                <StatusRow label={t('dashboard.mcp.authToken')}>
                  {mcp.tokenSet ? t('dashboard.mcp.tokenSet') : t('common.no')}
                </StatusRow>
                {mcp.error ? (
                  <StatusRow label={t('common.error')}>
                    <span className="settings-status-err">{mcp.error}</span>
                  </StatusRow>
                ) : null}
              </div>
            )}
            <div className="settings-actions">
              {mcp?.endpoint ? (
                <CopyButton
                  text={mcp.endpoint}
                  toastKey="common.copied"
                  labelKey="dashboard.mcp.copyEndpoint"
                  className="settings-btn"
                >
                  {t('dashboard.mcp.copyEndpoint')}
                </CopyButton>
              ) : null}
              <button type="button" className="settings-btn" onClick={() => void copyConfigJson()}>
                {t('dashboard.mcp.copyConfig')}
              </button>
              <button
                type="button"
                className="settings-btn"
                onClick={() => void registerClient('codex', 'Codex')}
              >
                {t('dashboard.mcp.registerCodex')}
              </button>
              <button
                type="button"
                className="settings-btn"
                onClick={() => void registerClient('claude-desktop', 'Claude Desktop')}
              >
                {t('dashboard.mcp.registerClaude')}
              </button>
              <button
                type="button"
                className="settings-btn"
                onClick={() => void registerClient('hermes', 'Hermes')}
              >
                {t('dashboard.mcp.registerHermes')}
              </button>
              <button type="button" className="settings-btn" onClick={() => void testConnection()}>
                {t('dashboard.mcp.test')}
              </button>
              <button type="button" className="settings-btn" onClick={() => void regenerateToken()}>
                {t('settings.mcp.regenerateToken')}
              </button>
            </div>
          </section>

          <section>
            <h3>{t('settings.updates.title')}</h3>
            <Toggle
              label={t('settings.updates.autoCheck')}
              checked={settings.updates.autoCheck}
              onChange={(checked) => patch({ updates: { autoCheck: checked } })}
            />
            <div className="settings-row">
              <span className="settings-label">
                {version !== null ? t('settings.updates.version', { version }) : ''}
              </span>
              <button
                type="button"
                className="settings-btn"
                disabled={update?.state === 'checking'}
                onClick={() => void checkUpdates()}
              >
                {t('settings.updates.check')}
              </button>
            </div>
            {/* Shown whatever the state machine is doing, including idle: after a
                failed install the app comes back on the old version with nothing
                in flight, which is exactly when nobody would ask. */}
            {update?.installFailedVersion != null ? (
              <div
                className="settings-update-failed"
                role="alert"
                data-testid="update-install-failed"
              >
                <span className="err-text">
                  {t('update.installFailed', { version: update.installFailedVersion })}
                </span>
                <span className="dim">{t('update.installFailedHint')}</span>
                <button
                  type="button"
                  className="settings-btn"
                  disabled={update.state === 'checking' || update.state === 'downloading'}
                  onClick={() => void checkUpdates()}
                >
                  {t('update.installFailedRetry')}
                </button>
              </div>
            ) : null}
            {update === null || update.state === 'idle' ? null : (
              <div className="settings-update-state" role="status" data-testid="update-state">
                <span className={update.state === 'error' ? 'err-text' : 'dim'}>
                  {updateMessage(update)}
                </span>
                {update.state === 'error' && update.error !== null ? (
                  <span className="dim">{update.error}</span>
                ) : null}
                {update.state === 'downloaded' ? (
                  <>
                    <span className="dim">{t('update.installOnQuit')}</span>
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => void window.wslpad.updates.install()}
                    >
                      {t('update.restartInstall')}
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </section>

          <section>
            <button
              type="button"
              className="settings-btn danger"
              onClick={() => setConfirmReset(true)}
            >
              {t('settings.resetAll')}
            </button>
          </section>
        </div>

        <Dialog
          open={confirmReset}
          title={t('settings.resetAllConfirmTitle')}
          onClose={() => setConfirmReset(false)}
          actions={
            <>
              <button type="button" onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  void window.wslpad.settings.reset().then(() => {
                    setConfirmReset(false)
                    pushToast('success', t('toast.settingsSaved'))
                  })
                }}
              >
                {t('common.reset')}
              </button>
            </>
          }
        >
          {t('settings.resetAllConfirmBody')}
        </Dialog>
      </div>
    </div>
  )
}

export default SettingsDrawer
