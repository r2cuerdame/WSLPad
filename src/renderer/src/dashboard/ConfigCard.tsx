import { useTranslation } from 'react-i18next'
import type { ConfigurationFileInfo, TerminalProfilesInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { FileIcon, FolderIcon, TerminalIcon } from '../components/Icons'
import TerminalProfilesBlock from './TerminalProfilesBlock'

const shQuote = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`
const dirname = (p: string): string => p.replace(/\/[^/]*$/, '') || '/'

const dotClass = (exists: boolean | null): string =>
  exists === true ? 'dot dot-ok' : exists === false ? 'dot dot-err' : 'dot dot-unknown'

export interface ConfigCardProps {
  files: ConfigurationFileInfo[]
  /** Host-wide, but judged against the distro this dashboard describes. */
  terminalProfiles: TerminalProfilesInfo | null
  distro: string
}

export default function ConfigCard({
  files,
  terminalProfiles,
  distro
}: ConfigCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { navigateExplorer, prepareCommand, pushToast } = useApp()

  // Windows-scoped files (.wslconfig) open the Windows pane at the file itself;
  // Linux-scoped files open the WSL pane at the parent directory (goal.md §7.1).
  const showInExplorer = (file: ConfigurationFileInfo): void => {
    if (file.scope === 'windows' && file.windowsPath !== null) {
      navigateExplorer(file.windowsPath, 'windows')
    } else if (file.linuxPath !== null) {
      navigateExplorer(dirname(file.linuxPath))
    } else {
      return
    }
    pushToast('info', t('toast.openedInExplorer', { defaultValue: 'Opened in Explorer' }))
  }

  // Never auto-edits config files — read-only files get a prepared sudoedit
  // command in the Console input instead (goal.md §6.4).
  const prepareSudoedit = (linuxPath: string): void => {
    prepareCommand(`sudoedit ${shQuote(linuxPath)}`)
    pushToast('info', t('toast.commandPrepared'))
  }

  return (
    <Card titleKey="dashboard.config.title">
      {files.map((f) => {
        const path = f.linuxPath ?? f.windowsPath
        const lp = f.linuxPath
        const explorerTarget = f.scope === 'windows' ? f.windowsPath : f.linuxPath
        return (
          <div key={f.id} className="path-row">
            <span className={dotClass(f.exists)} />
            <div className="row-main">
              <div className="path-line">
                <span className="path-label">{f.label}</span>
                {f.exists === false ? (
                  <span className="badge badge-dim">{t('dashboard.paths.missing')}</span>
                ) : null}
                {f.readable === false ? (
                  <span className="badge badge-err">{t('dashboard.config.notReadable')}</span>
                ) : null}
                {f.exists !== false && f.readable !== false && f.writable === false ? (
                  <span className="badge badge-warn">{t('dashboard.config.readOnly')}</span>
                ) : null}
              </div>
              <div className="mono dim truncate" title={path ?? undefined}>
                {path ?? '—'}
              </div>
            </div>
            <span className="row-actions">
              {path ? <CopyButton text={path} labelKey="dashboard.config.copyPath" /> : null}
              {explorerTarget ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.config.showInExplorer')}
                  title={t('dashboard.config.showInExplorer')}
                  disabled={f.exists === false}
                  onClick={() => showInExplorer(f)}
                >
                  <FolderIcon size={14} />
                </button>
              ) : null}
              {lp ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.config.openInEditor')}
                  title={t('dashboard.config.openInEditor')}
                  disabled={f.exists === false || f.readable === false}
                  onClick={() => showInExplorer(f)}
                >
                  <FileIcon size={14} />
                </button>
              ) : null}
              {lp && f.exists !== false && f.writable === false ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dashboard.config.prepareSudoedit')}
                  title={t('dashboard.config.prepareSudoedit')}
                  onClick={() => prepareSudoedit(lp)}
                >
                  <TerminalIcon size={14} />
                </button>
              ) : null}
            </span>
          </div>
        )
      })}
      <TerminalProfilesBlock profiles={terminalProfiles} distro={distro} />
    </Card>
  )
}
