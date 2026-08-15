import { useTranslation } from 'react-i18next'
import type { DriveMountInfo, DriveMountsInfo } from '@shared/types'
import { WarningIcon } from '../components/Icons'

export interface DriveMountsBlockProps {
  mounts: DriveMountsInfo | null
}

/** The options worth naming, in the order they matter when something is wrong. */
function summary(d: DriveMountInfo): string[] {
  const parts: string[] = []
  if (d.uid !== null) parts.push(`uid=${d.uid}`)
  if (d.gid !== null) parts.push(`gid=${d.gid}`)
  if (d.caseSensitivity !== null) parts.push(`case=${d.caseSensitivity}`)
  if (d.umask !== null) parts.push(`umask=${d.umask}`)
  if (d.fmask !== null) parts.push(`fmask=${d.fmask}`)
  if (d.dmask !== null) parts.push(`dmask=${d.dmask}`)
  return parts
}

/**
 * How the Windows drives are really mounted (issue #76).
 *
 * One option carries almost all of the surprise. Without `metadata`, `chmod`
 * and `chown` under /mnt/c return success and store nothing — the mode is
 * synthesised from umask on every read, so the change is gone before the next
 * `ls`. Scripts stay non-executable, `git` records a permission that never
 * lands, and nothing anywhere reports an error.
 */
export default function DriveMountsBlock({
  mounts
}: DriveMountsBlockProps): React.JSX.Element | null {
  const { t } = useTranslation()

  // Never looked is not the same as no drives mounted.
  if (mounts === null) return null

  const withoutMetadata = mounts.drives.filter((d) => !d.metadata)
  const declaresMetadata =
    mounts.declaredOptions !== null &&
    mounts.declaredOptions
      .split(',')
      .map((o) => o.trim())
      .includes('metadata')

  return (
    <>
      <div className="path-label">{t('dashboard.paths.drivesTitle')}</div>

      {mounts.drives.length === 0 ? (
        <div className="dim">
          {mounts.declaredEnabled === false
            ? t('dashboard.paths.drivesDisabled')
            : t('dashboard.paths.drivesNone')}
        </div>
      ) : (
        mounts.drives.map((d) => (
          <div className="kv-row" key={d.point}>
            <span className="kv-key mono">{d.point}</span>
            <span className="kv-val">
              {d.source === null ? null : <span className="mono dim">{d.source}</span>}
              <span className={d.metadata ? 'badge badge-ok' : 'badge badge-warn'}>
                {d.metadata
                  ? t('dashboard.paths.driveMetadata')
                  : t('dashboard.paths.driveNoMetadata')}
              </span>
              {summary(d).map((part) => (
                <span key={part} className="badge badge-dim mono">
                  {part}
                </span>
              ))}
            </span>
          </div>
        ))
      )}

      {withoutMetadata.length === 0 ? null : (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>
            {t('dashboard.paths.metadataWarning', {
              drives: withoutMetadata.map((d) => d.point).join(', ')
            })}
          </span>
        </div>
      )}

      {/* The file was edited but the mount predates it — the same "declared vs
          in force" gap the WSL settings section exists for, and the reason a
          correct-looking wsl.conf still gives you a mount without metadata. */}
      {withoutMetadata.length > 0 && declaresMetadata ? (
        <div className="kv-row dim">{t('dashboard.paths.metadataDeclaredNotInForce')}</div>
      ) : null}

      {mounts.declaredOptions === null ? null : (
        <div className="kv-row">
          <span className="kv-key">{t('dashboard.paths.drivesDeclared')}</span>
          <span className="kv-val mono">{mounts.declaredOptions}</span>
        </div>
      )}
    </>
  )
}
