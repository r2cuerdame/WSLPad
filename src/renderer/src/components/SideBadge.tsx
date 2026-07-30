import { useTranslation } from 'react-i18next'
import { isCrossBoundary } from '@shared/path-boundary'
import type { PathSide } from '@shared/types'
import { LinuxIcon, WindowsIcon } from './Icons'

export interface SideBadgeProps {
  side: PathSide
  /** Adds the visible side name; icon-only otherwise, for dense lists. */
  withLabel?: boolean
  className?: string
}

const HINT_KEY: Partial<Record<PathSide, string>> = {
  'windows-mount': 'dashboard.paths.sideHintWindowsMount',
  unc: 'dashboard.paths.sideHintUnc'
}

/**
 * Marks a path that sits on the far side of the WSL filesystem boundary.
 *
 * It renders nothing for ext4 and for unknown: the badge appears on many rows
 * at once, so it has to earn its place by only showing up where the boundary
 * is actually being crossed. The mark is a silhouette plus text — a Windows
 * flag for a Windows drive, a Linux one for a \\wsl.localhost share — never
 * hue alone, and the full explanation rides along as the accessible name.
 */
export function SideBadge({ side, withLabel, className }: SideBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!isCrossBoundary(side)) return null

  const name = t(`dashboard.paths.side.${side}`)
  const hintKey = HINT_KEY[side]
  const hint = hintKey === undefined ? name : t(hintKey)
  return (
    <span
      className={'side-badge' + (withLabel ? ' with-label' : '') + (className ? ` ${className}` : '')}
      data-side={side}
      title={hint}
    >
      {side === 'windows-mount' ? <WindowsIcon size={11} /> : <LinuxIcon size={11} />}
      {withLabel ? <span className="side-badge-text">{name}</span> : null}
      <span className="sr-only">
        {t('dashboard.paths.sideLabel')}: {name}
        {withLabel ? null : `. ${hint}`}
      </span>
    </span>
  )
}

export default SideBadge
