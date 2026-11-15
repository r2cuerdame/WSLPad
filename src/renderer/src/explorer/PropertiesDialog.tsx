import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DirSizeResult, FileStat, FsKind } from '@shared/types'
import { WINDOWS_ROOT } from '@shared/constants'
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

/** A folder's size is only known once it has been measured on request. */
type FolderSize =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ready'; result: DirSizeResult }
  | { status: 'error'; error: string }

const IDLE_SIZE: FolderSize = { status: 'idle' }

let folderSizeToken = 0

/** File/folder properties with prepared chmod/chown/ln commands (goal.md §7.7). */
export function PropertiesDialog({ path, fs, onClose }: PropertiesDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const [stat, setStat] = useState<FileStat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [folderSize, setFolderSize] = useState<FolderSize>(IDLE_SIZE)
  // The run whose answer may still land here; null once closed or superseded.
  const sizeToken = useRef<string | null>(null)
  const adapter = useMemo(
    () => (fs === 'windows' ? createWindowsAdapter() : createLinuxAdapter()),
    [fs]
  )

  useEffect(() => {
    let disposed = false
    setStat(null)
    setError(null)
    setFolderSize(IDLE_SIZE)
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
      // A du walk can outlive the dialog by seconds; stop it rather than let
      // its answer arrive for a path nobody is looking at.
      const token = sizeToken.current
      sizeToken.current = null
      if (token !== null) void adapter.cancelDirSizes?.(token).catch(() => undefined)
    }
  }, [adapter, path, reloadKey])

  const measureFolder = async (target: string): Promise<void> => {
    if (!adapter.dirSizes) return
    const token = `props-dirsize-${++folderSizeToken}`
    sizeToken.current = token
    setFolderSize({ status: 'running' })
    try {
      const result = await adapter.dirSizes(target, token)
      if (sizeToken.current !== token) return
      sizeToken.current = null
      setFolderSize(result.cancelled ? IDLE_SIZE : { status: 'ready', result })
    } catch (err) {
      if (sizeToken.current !== token) return
      sizeToken.current = null
      setFolderSize({ status: 'error', error: parseExplorerError(err).message })
    }
  }

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

  const measureButton = (target: string): React.JSX.Element => (
    <button type="button" className="btn btn-small" onClick={() => void measureFolder(target)}>
      {t('explorer.dirSizes.action')}
    </button>
  )

  /**
   * A directory's own stat size is the size of its directory record, not of
   * what it holds — showing it would make every folder look nearly empty.
   */
  const folderSizeValue = (target: string): React.ReactNode => {
    if (!adapter.dirSizes || target === WINDOWS_ROOT) return t('common.unknown')
    switch (folderSize.status) {
      case 'idle':
        return measureButton(target)
      case 'running':
        return <span role="status">{t('explorer.dirSizes.running')}</span>
      case 'error':
        return (
          <>
            <span className="props-size-failed" title={folderSize.error}>
              {t('explorer.dirSizes.failed')}: {folderSize.error}
            </span>{' '}
            {measureButton(target)}
          </>
        )
      case 'ready': {
        const result = folderSize.result
        if (result.error !== null) {
          return (
            <>
              <span className="props-size-failed" title={result.error}>
                {t('explorer.dirSizes.failed')}: {result.error}
              </span>{' '}
              {measureButton(target)}
            </>
          )
        }
        // Nothing measurable is "not measured", never a confident 0 B.
        if (result.totalBytes === null) {
          return <span className="props-note">{t('explorer.dirSizes.unmeasured')}</span>
        }
        // Same rule as DirSizesPanel: anything left out makes the sum a floor.
        const isFloor =
          result.skipped > 0 || result.entries.some((e) => e.partial || e.sizeBytes === null)
        const partialHint = t('explorer.dirSizes.partial')
        return (
          <span title={isFloor ? partialHint : undefined}>
            {(isFloor ? '≥ ' : '') + formatBytes(result.totalBytes, i18n.language)}
            {isFloor && <span className="props-note"> {partialHint}</span>}
          </span>
        )
      }
    }
  }

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
        <div className="props-error-box">
          <div className="props-error">{error}</div>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setReloadKey((n) => n + 1)}
          >
            {t('common.retry')}
          </button>
        </div>
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
          {row(
            t('explorer.properties.size'),
            stat.type === 'directory'
              ? folderSizeValue(stat.path)
              : formatBytes(stat.sizeBytes, i18n.language)
          )}
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
          {stat.symlinkTarget &&
            row(t('explorer.properties.linkTarget'), stat.symlinkTarget, stat.symlinkTarget)}

          {fs === 'linux' && (
            <div className="props-actions">
              {/* An unknown mode or owner is never filled in with a guess: the
                  prepared command would then change the file to values nobody read. */}
              <button
                type="button"
                disabled={stat.permissionsOctal === null}
                onClick={() =>
                  stat.permissionsOctal !== null &&
                  prepare(`chmod ${stat.permissionsOctal} ${shQuote(stat.path)}`)
                }
              >
                {t('explorer.menu.prepareChmod')}
              </button>
              <button
                type="button"
                disabled={stat.owner === null || stat.group === null}
                onClick={() =>
                  stat.owner !== null &&
                  stat.group !== null &&
                  prepare(`chown ${stat.owner}:${stat.group} ${shQuote(stat.path)}`)
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
