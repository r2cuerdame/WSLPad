import { useTranslation } from 'react-i18next'
import type { DefenderInfo, DiskImageInfo } from '@shared/types'
import {
  addExclusionCommand,
  defenderCoverage,
  suggestedExclusion
} from '@shared/defender-coverage'
import CopyButton from '../components/CopyButton'
import { WarningIcon } from '../components/Icons'

export interface DefenderBlockProps {
  defender: DefenderInfo | null
  disk: DiskImageInfo | null
}

/**
 * Whether Defender is scanning the distro image (issue #77).
 *
 * Real-time protection reads every block WSL touches inside ext4.vhdx, and it
 * is the most common reason a WSL filesystem feels slow with nothing visibly
 * wrong. The exclusion list needs an elevated token, which this app does not
 * have and must not acquire — so when it cannot be read, this block says so
 * rather than reporting "no exclusion", which is what a naive read returns.
 */
export default function DefenderBlock({
  defender,
  disk
}: DefenderBlockProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (defender === null || !defender.available) return null

  const coverage = defenderCoverage(defender, disk)
  const suggestion = suggestedExclusion(disk)
  const command = suggestion === null ? null : addExclusionCommand(suggestion)
  // Only a scanner that is actually running can be slowing anything down.
  const scanning = defender.realtimeEnabled === true && coverage !== 'covered'

  return (
    <>
      <div className="path-label">{t('dashboard.disk.defenderTitle')}</div>

      <div className="kv-row">
        <span className="kv-key">{t('dashboard.disk.defenderRealtime')}</span>
        <span className="kv-val">
          {defender.realtimeEnabled === null ? (
            <span className="badge badge-dim">{t('common.unknown')}</span>
          ) : (
            <span className={defender.realtimeEnabled ? 'badge badge-warn' : 'badge badge-dim'}>
              {defender.realtimeEnabled ? t('common.enabled') : t('common.disabled')}
            </span>
          )}
        </span>
      </div>

      <div className="kv-row">
        <span className="kv-key">{t('dashboard.disk.defenderExcluded')}</span>
        <span className="kv-val">
          {coverage === 'covered' ? (
            <span className="badge badge-ok">{t('dashboard.disk.defenderCovered')}</span>
          ) : coverage === 'not-covered' ? (
            <span className="badge badge-warn">{t('dashboard.disk.defenderNotCovered')}</span>
          ) : (
            <span className="badge badge-dim">{t('common.unknown')}</span>
          )}
        </span>
      </div>

      {/* Saying why it is unknown matters more than the word: the user can act
          on "needs an elevated PowerShell", not on a shrug. */}
      {coverage === 'unknown' && !defender.elevated ? (
        <div className="kv-row dim">{t('dashboard.disk.defenderNeedsAdmin')}</div>
      ) : null}

      {scanning ? (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>{t('dashboard.disk.defenderScanning')}</span>
        </div>
      ) : null}

      {/* Not prepared in the Console: the Console is a shell inside the distro
          and this needs an elevated Windows PowerShell, which WSLPad has no
          way to obtain. Offering it as text is the honest version. */}
      {command === null || coverage === 'covered' ? null : (
        <div className="kv-row">
          <span className="kv-key">{t('dashboard.disk.defenderExclude')}</span>
          <span className="kv-val">
            <span className="mono truncate" title={command}>
              {command}
            </span>
            <CopyButton text={command} />
          </span>
        </div>
      )}
      {command === null || coverage === 'covered' ? null : (
        <div className="kv-row dim">{t('dashboard.disk.defenderElevatedHint')}</div>
      )}
    </>
  )
}
