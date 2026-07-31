import { useTranslation } from 'react-i18next'
import type { DiskConsumersInfo, LocaleCode } from '@shared/types'
import { formatBytes } from '@shared/format'
import { useApp } from '../store'
import CopyButton from '../components/CopyButton'
import { TerminalIcon } from '../components/Icons'

export interface DiskConsumersBlockProps {
  consumers: DiskConsumersInfo | null
}

/** English fallbacks; the locale bundles carry the real wording. */
const LABELS: Record<string, string> = {
  'apt-cache': 'Downloaded packages (apt)',
  'dnf-cache': 'Downloaded packages (dnf)',
  journal: 'systemd journal',
  logs: 'Logs',
  'user-cache': 'Build and tool caches',
  snap: 'Snap packages',
  docker: "Docker's store",
  trash: 'Trash',
  tmp: 'Temporary files'
}

/**
 * What is filling the image (issue #66).
 *
 * The card above says how much the image holds and how much Linux still uses.
 * This says what the difference is made of, by name — because `df` reports the
 * virtual maximum and `du /` walks for minutes, so nobody ever finds out.
 */
export default function DiskConsumersBlock({
  consumers
}: DiskConsumersBlockProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { prepareCommand, pushToast } = useApp()

  // Not measured yet is not the same as nothing there.
  if (consumers === null) return null

  const rows = consumers.consumers.filter((c) => c.exists)
  if (rows.length === 0) return null

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  return (
    <>
      <div className="path-label">
        {t('dashboard.disk.consumersTitle', { defaultValue: 'Where the space went' })}
      </div>
      <div className="dim">
        {t(
          consumers.partial
            ? 'dashboard.disk.consumersHeadlinePartial'
            : 'dashboard.disk.consumersHeadline',
          {
            defaultValue: consumers.partial
              ? 'At least {{total}} across the caches below — something could not be measured.'
              : '{{total}} across the caches below.',
            total: formatBytes(locale, consumers.measuredBytes)
          }
        )}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('dashboard.disk.consumersWhat', { defaultValue: 'What' })}</th>
            <th className="num">{t('dashboard.disk.zoneSize', { defaultValue: 'Size' })}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="path-line">
                  <span>
                    {t(`dashboard.disk.consumerLabel_${row.id}`, {
                      defaultValue: LABELS[row.id] ?? row.id
                    })}
                  </span>
                  {/* Both rows are worth seeing, but only the outer one is in
                      the total — saying so beats an arithmetic that looks wrong. */}
                  {row.containedIn !== null ? (
                    <span className="badge badge-dim">
                      {t('dashboard.disk.consumerIncluded', {
                        defaultValue: 'part of the row above'
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="mono dim truncate" title={row.path}>
                  {row.path}
                </div>
              </td>
              <td className="num">
                {row.bytes === null ? t('common.unknown') : formatBytes(locale, row.bytes)}
              </td>
              <td className="num">
                {row.cleanup === null ? null : (
                  <span className="row-actions">
                    {row.needsRoot ? (
                      <span className="badge badge-warn">
                        {t('dashboard.disk.consumerNeedsRoot', { defaultValue: 'root' })}
                      </span>
                    ) : null}
                    <CopyButton
                      text={row.cleanup}
                      toastKey="toast.copiedCommand"
                      labelKey="dashboard.processes.copyCommand"
                      size={13}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('dashboard.disk.prepare', { defaultValue: 'Prepare in Console' })}
                      title={t('dashboard.disk.prepare', { defaultValue: 'Prepare in Console' })}
                      onClick={() => prepare(row.cleanup as string)}
                    >
                      <TerminalIcon size={13} />
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dim">
        {t('dashboard.disk.consumersHint', {
          defaultValue:
            'Known caches only, not a full accounting — the Explorer measures any directory on demand. Nothing here is ever removed for you.'
        })}
      </div>
    </>
  )
}
