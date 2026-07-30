import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileStat } from '@shared/types'
import { CopyButton } from '../components/CopyButton'
import { Dialog } from '../components/Dialog'
import { useApp } from '../store'
import { formatBytes, formatDateTime, parseExplorerError, shQuote } from './useExplorer'

interface PropertiesDialogProps {
  path: string
  onClose: () => void
}

/** File/folder properties with prepared chmod/chown/ln commands (goal.md §7.7). */
export function PropertiesDialog({ path, onClose }: PropertiesDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const [stat, setStat] = useState<FileStat | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    setStat(null)
    setError(null)
    void window.wslpad.explorer
      .stat(path)
      .then((res) => {
        if (!disposed) setStat(res)
      })
      .catch((err) => {
        if (!disposed) setError(parseExplorerError(err).message)
      })
    return () => {
      disposed = true
    }
  }, [path])

  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const row = (label: string, value: React.ReactNode, copy?: string): React.JSX.Element => (
    <div className="props-row">
      <span className="props-label">{label}</span>
      <span className="props-value mono">{value}</span>
      {copy && <CopyButton text={copy} toastKey="toast.copiedPath" />}
    </div>
  )

  return (
    <Dialog
      open
      title={t('explorer.properties.title')}
      onClose={onClose}
      actions={
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {error ? (
        <div className="props-error">{error}</div>
      ) : stat === null ? (
        <div>{t('common.loading')}</div>
      ) : (
        <div className="props-body">
          {row(t('explorer.properties.linuxPath'), stat.path, stat.path)}
          {row(
            t('explorer.properties.windowsPath'),
            stat.windowsPath ?? t('common.unknown'),
            stat.windowsPath ?? undefined
          )}
          {row(t('explorer.properties.type'), t(`explorer.type.${stat.type}`))}
          {row(t('explorer.properties.size'), formatBytes(stat.sizeBytes, i18n.language))}
          {row(t('explorer.properties.owner'), stat.owner ?? t('common.unknown'))}
          {row(t('explorer.properties.group'), stat.group ?? t('common.unknown'))}
          {row(
            t('explorer.properties.permissions'),
            `${stat.permissions ?? '—'}${stat.permissionsOctal ? ` (${stat.permissionsOctal})` : ''}`
          )}
          {row(t('explorer.properties.inode'), stat.inode ?? t('common.unknown'))}
          {row(t('explorer.properties.modified'), formatDateTime(stat.mtime, i18n.language))}
          {row(t('explorer.properties.accessed'), formatDateTime(stat.atime, i18n.language))}
          {stat.symlinkTarget && row(t('explorer.properties.linkTarget'), stat.symlinkTarget)}

          <div className="props-actions">
            <button
              type="button"
              onClick={() =>
                prepare(`chmod ${stat.permissionsOctal ?? '755'} ${shQuote(stat.path)}`)
              }
            >
              {t('explorer.menu.prepareChmod')}
            </button>
            <button
              type="button"
              onClick={() =>
                prepare(
                  `chown ${stat.owner ?? 'user'}:${stat.group ?? 'group'} ${shQuote(stat.path)}`
                )
              }
            >
              {t('explorer.menu.prepareChown')}
            </button>
            <button
              type="button"
              onClick={() => prepare(`ln -s ${shQuote(stat.path)} ${shQuote(`${stat.path}-link`)}`)}
            >
              {t('explorer.menu.prepareSymlink')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
