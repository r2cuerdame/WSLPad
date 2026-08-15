import { useTranslation } from 'react-i18next'
import type { DriveMountsInfo, ImportantPathInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { FolderIcon, TerminalIcon } from '../components/Icons'
import { SideBadge } from '../components/SideBadge'

const dotClass = (exists: boolean | null): string =>
  exists === true ? 'dot dot-ok' : exists === false ? 'dot dot-err' : 'dot dot-unknown'

import DriveMountsBlock from './DriveMountsBlock'

export interface PathsCardProps {
  paths: ImportantPathInfo[]
  /** How the Windows drives these paths may sit on are really mounted. */
  mounts?: DriveMountsInfo | null
}

export default function PathsCard({ paths, mounts = null }: PathsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { navigateExplorer, setConsolePath, pushToast } = useApp()

  const applyConsolePath = (path: string): void => {
    setConsolePath(path)
    pushToast('info', t('toast.consolePathSet', { path }))
  }

  return (
    <Card titleKey="dashboard.paths.title">
      {/* What the drives below are mounted with decides whether a permission
          set on any of these paths survives, so it frames the list. */}
      <DriveMountsBlock mounts={mounts} />
      {paths.map((p) => {
        const wp = p.windowsPath
        return (
          <div key={p.id} className="path-row">
            <span className={dotClass(p.exists)} />
            <div className="row-main">
              <div className="path-line">
                <span className="path-label">{p.label}</span>
                {p.exists === false ? (
                  <span className="badge badge-dim">{t('dashboard.paths.missing')}</span>
                ) : null}
                {/* Silent on ext4: the badge is here to explain the slow ones. */}
                <SideBadge side={p.side} withLabel />
              </div>
              <div className="mono dim truncate" title={p.linuxPath}>
                {p.linuxPath}
              </div>
            </div>
            <span className="row-actions">
              <CopyButton text={p.linuxPath} labelKey="dashboard.paths.copyLinux" />
              {wp ? <CopyButton text={wp} labelKey="dashboard.paths.copyWindows" /> : null}
              <button
                type="button"
                className="icon-btn"
                aria-label={t('dashboard.paths.openInExplorer')}
                title={t('dashboard.paths.openInExplorer')}
                disabled={p.exists === false}
                onClick={() => navigateExplorer(p.linuxPath)}
              >
                <FolderIcon size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('dashboard.paths.setConsolePath')}
                title={t('dashboard.paths.setConsolePath')}
                disabled={p.exists === false}
                onClick={() => applyConsolePath(p.linuxPath)}
              >
                <TerminalIcon size={14} />
              </button>
            </span>
          </div>
        )
      })}
    </Card>
  )
}
