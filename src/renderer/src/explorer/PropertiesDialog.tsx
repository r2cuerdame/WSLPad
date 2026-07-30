import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileStat, FsKind } from '@shared/types'
import { CopyButton } from '../components/CopyButton'
import { Dialog } from '../components/Dialog'
import { useApp } from '../store'
import { createLinuxAdapter, createWindowsAdapter, shQuote } from './fsAdapter'
import { formatBytes, formatDateTime, parseExplorerError } from './usePane'

interface PropertiesDialogProps {
  path: string
  /** Windows entries have no owner/group/permission model to show or change. */
  fs: FsKind
  onClose: () => void
}

/** File/folder properties with prepared chmod/chown/ln commands (goal.md §7.7). */
export function PropertiesDialog({ path, fs, onClose }: PropertiesDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const [stat, setStat] = useState<FileStat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const adapter = useMemo(
    () => (fs === 'windows' ? createWindowsAdapter() : createLinuxAdapter()),
    [fs]
  )

  useEffect(() => {
    let disposed = false
    setStat(null)
    setError(null)
    void adapter
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
  }, [adapter, path])

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
          {fs === 'linux'
            ? row(t('explorer.properties.linuxPath'), stat.path, stat.path)
            : row(t('explorer.properties.windowsPath'), stat.path, stat.path)}
          {fs === 'linux' &&
            row(
              t('explorer.properties.windowsPath'),
              stat.windowsPath ?? t('common.unknown'),
              stat.windowsPath ?? undefined
            )}
          {row(t('explorer.properties.type'), t(`explorer.type.${stat.type}`))}
          {row(t('explorer.properties.size'), formatBytes(stat.sizeBytes, i18n.language))}
          {fs === 'linux' && row(t('explorer.properties.owner'), stat.owner ?? t('common.unknown'))}
          {fs === 'linux' && row(t('explorer.properties.group'), stat.group ?? t('common.unknown'))}
          {fs === 'linux' &&
            row(
              t('explorer.properties.permissions'),
              `${stat.permissions ?? '—'}${stat.permissionsOctal ? ` (${stat.permissionsOctal})` : ''}`
            )}
          {fs === 'linux' && row(t('explorer.properties.inode'), stat.inode ?? t('common.unknown'))}
          {row(t('explorer.properties.modified'), formatDateTime(stat.mtime, i18n.language))}
          {row(t('explorer.properties.accessed'), formatDateTime(stat.atime, i18n.language))}
          {stat.symlinkTarget && row(t('explorer.properties.linkTarget'), stat.symlinkTarget)}

          {fs === 'linux' && (
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
                onClick={() =>
                  prepare(`ln -s ${shQuote(stat.path)} ${shQuote(`${stat.path}-link`)}`)
                }
              >
                {t('explorer.menu.prepareSymlink')}
              </button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
