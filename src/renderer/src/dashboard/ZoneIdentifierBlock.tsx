import { useTranslation } from 'react-i18next'
import type { LocaleCode, ZoneIdentifierInfo } from '@shared/types'
import { formatBytes } from '@shared/format'
import { useApp } from '../store'
import CopyButton from '../components/CopyButton'
import { TerminalIcon } from '../components/Icons'

export interface ZoneIdentifierBlockProps {
  zone: ZoneIdentifierInfo | null
}

/**
 * The `:Zone.Identifier` files Windows leaves in the distro (issue #64).
 *
 * Every file copied in from Windows brings its mark-of-the-web stream, and on
 * ext4 that stream becomes a visible file of its own. They are harmless and
 * permanent, `ls` shows them forever, and nothing counts them — which is why
 * this block exists at all.
 */
export default function ZoneIdentifierBlock({
  zone
}: ZoneIdentifierBlockProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { prepareCommand, pushToast } = useApp()

  // Nothing known yet is not the same as nothing there: stay silent rather
  // than report a clean tree that was never looked at.
  if (zone === null) return null

  const prepare = (): void => {
    prepareCommand(zone.cleanupCommand)
    pushToast('info', t('toast.commandPrepared'))
  }

  const headline =
    zone.count === null
      ? t('dashboard.disk.zoneUnknown', {
          defaultValue: 'The home directory could not be searched for Windows download markers.'
        })
      : zone.count === 0
        ? t('dashboard.disk.zoneNone', {
            defaultValue: 'No Windows download markers under {{root}}.',
            root: zone.root
          })
        : t('dashboard.disk.zoneHeadline', {
            defaultValue:
              '{{count}} Windows download markers under {{root}} — one per file ever copied in from Windows.',
            count: zone.count,
            root: zone.root
          })

  return (
    <>
      <div className="path-label">
        {t('dashboard.disk.zoneTitle', { defaultValue: 'Windows download markers' })}
      </div>
      <div className="dim">{headline}</div>
      {zone.error !== null ? <div className="dim">{zone.error}</div> : null}
      {zone.truncated ? (
        <div className="dim">
          {t('dashboard.disk.zoneTruncated', {
            defaultValue: 'Counting stopped at {{count}} — there are at least this many.',
            count: zone.count ?? 0
          })}
        </div>
      ) : null}
      {zone.count !== null && zone.count > 0 ? (
        <>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('dashboard.disk.zoneDirectory', { defaultValue: 'Directory' })}</th>
                <th className="num">{t('dashboard.disk.zoneCount', { defaultValue: 'Markers' })}</th>
                <th className="num">{t('dashboard.disk.zoneSize', { defaultValue: 'Size' })}</th>
              </tr>
            </thead>
            <tbody>
              {zone.groups.map((group) => (
                <tr key={group.directory}>
                  <td className="mono">
                    <span className="truncate" title={group.directory}>
                      {group.directory}
                    </span>
                  </td>
                  <td className="num">{group.count}</td>
                  {/* Docker's own words elsewhere, our own bytes here: these
                      come from find, so they are ours to format. */}
                  <td className="num">
                    {group.bytes === null ? t('common.unknown') : formatBytes(locale, group.bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="path-row">
            <div className="row-main">
              <div className="path-line">
                <span className="path-label">
                  {t('dashboard.disk.zoneCleanupLabel', { defaultValue: 'Remove them all' })}
                </span>
              </div>
              <div className="mono dim truncate" title={zone.cleanupCommand}>
                {zone.cleanupCommand}
              </div>
            </div>
            <span className="row-actions">
              <CopyButton
                text={zone.cleanupCommand}
                toastKey="toast.copiedCommand"
                labelKey="dashboard.processes.copyCommand"
                size={13}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t('dashboard.disk.prepare', { defaultValue: 'Prepare in Console' })}
                title={t('dashboard.disk.prepare', { defaultValue: 'Prepare in Console' })}
                onClick={prepare}
              >
                <TerminalIcon size={13} />
              </button>
            </span>
          </div>
        </>
      ) : null}
    </>
  )
}
