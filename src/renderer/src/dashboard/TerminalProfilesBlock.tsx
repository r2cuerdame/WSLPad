import { useTranslation } from 'react-i18next'
import type { TerminalProfilesInfo } from '@shared/types'
import { terminalProfileSnippet } from '@shared/terminal-profile'
import CopyButton from '../components/CopyButton'

export interface TerminalProfilesBlockProps {
  profiles: TerminalProfilesInfo | null
  /** The distro the rest of the dashboard is describing. */
  distro: string
}

/**
 * Whether Windows Terminal can open this distro (issue #65).
 *
 * Terminal generates a profile per distro, but only for the ones it saw when
 * it last generated, and only while the WSL generator is enabled. A distro
 * imported afterwards is simply absent from the dropdown, with nothing on
 * screen anywhere to say why. Nothing here writes settings.json: the profile
 * to add is offered as text to paste.
 */
export default function TerminalProfilesBlock({
  profiles,
  distro
}: TerminalProfilesBlockProps): React.JSX.Element | null {
  const { t } = useTranslation()

  // Not read yet is not the same as not installed.
  if (profiles === null) return null

  const title = (
    <div className="path-label">
      {t('dashboard.config.terminalTitle', { defaultValue: 'Windows Terminal' })}
    </div>
  )

  if (profiles.installed === false) {
    return (
      <>
        {title}
        <div className="dim">
          {t('dashboard.config.terminalNotInstalled', {
            defaultValue: 'Windows Terminal is not installed, so it has no profiles to check.'
          })}
        </div>
      </>
    )
  }

  if (profiles.error !== null) {
    return (
      <>
        {title}
        <div className="dim">{profiles.error}</div>
      </>
    )
  }

  const mine = profiles.profiles.find((p) => p.distro === distro) ?? null
  const snippet = terminalProfileSnippet(distro)

  return (
    <>
      {title}
      <div className="path-row">
        <span
          className={
            mine === null ? 'dot dot-err' : mine.hidden ? 'dot dot-unknown' : 'dot dot-ok'
          }
        />
        <div className="row-main">
          <div className="path-line">
            <span className="path-label">{distro}</span>
            {mine === null ? (
              <span className="badge badge-err">
                {t('dashboard.config.terminalMissing', { defaultValue: 'No profile' })}
              </span>
            ) : (
              <>
                {mine.isDefault ? (
                  <span className="badge badge-ok">
                    {t('dashboard.config.terminalDefault', { defaultValue: 'Default profile' })}
                  </span>
                ) : null}
                {mine.hidden ? (
                  <span className="badge badge-warn">
                    {t('dashboard.config.terminalHidden', {
                      defaultValue: 'Hidden from the dropdown'
                    })}
                  </span>
                ) : null}
                {mine.source === null ? (
                  <span className="badge badge-dim">
                    {t('dashboard.config.terminalCustom', { defaultValue: 'Added by hand' })}
                  </span>
                ) : null}
              </>
            )}
          </div>
          <div className="mono dim truncate" title={profiles.settingsPath ?? undefined}>
            {profiles.settingsPath ?? '—'}
          </div>
        </div>
        <span className="row-actions">
          {profiles.settingsPath !== null ? (
            <CopyButton text={profiles.settingsPath} labelKey="dashboard.config.copyPath" />
          ) : null}
        </span>
      </div>
      {mine === null ? (
        <div className="path-row">
          <div className="row-main">
            <div className="path-line">
              <span className="path-label">
                {t('dashboard.config.terminalAddLabel', {
                  defaultValue: 'Paste this into profiles.list to add one'
                })}
              </span>
            </div>
            <pre className="mono dim code-block">{snippet}</pre>
          </div>
          <span className="row-actions">
            <CopyButton text={snippet} labelKey="dashboard.config.copyPath" />
          </span>
        </div>
      ) : null}
      {profiles.profiles.length > 0 ? (
        <div className="dim">
          {t('dashboard.config.terminalCount', {
            defaultValue: '{{count}} profiles in total, {{wsl}} of them WSL distributions.',
            count: profiles.profiles.length,
            wsl: profiles.profiles.filter((p) => p.distro !== null).length
          })}
        </div>
      ) : null}
    </>
  )
}
