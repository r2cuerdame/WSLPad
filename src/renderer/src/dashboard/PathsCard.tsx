import { useTranslation } from 'react-i18next'
import type { ImportantPathInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { FolderIcon, TerminalIcon } from '../components/Icons'

const dotClass = (exists: boolean | null): string =>
  exists === true ? 'dot dot-ok' : exists === false ? 'dot dot-err' : 'dot dot-unknown'

export interface PathsCardProps {
  paths: ImportantPathInfo[]
}

export default function PathsCard({ paths }: PathsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { navigateExplorer, setConsolePath, pushToast } = useApp()

  const applyConsolePath = (path: string): void => {
    setConsolePath(path)
    pushToast('info', t('toast.consolePathSet', { path }))
  }

  return (
    <Card titleKey="dashboard.paths.title">
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
