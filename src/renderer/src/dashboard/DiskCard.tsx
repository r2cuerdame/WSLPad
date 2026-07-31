import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DiskConsumersInfo,
  DiskImageInfo,
  LocaleCode,
  ZoneIdentifierInfo
} from '@shared/types'
import { formatBytes } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { FolderIcon, TerminalIcon } from '../components/Icons'
import DiskConsumersBlock from './DiskConsumersBlock'
import ZoneIdentifierBlock from './ZoneIdentifierBlock'

function Kv({
  k,
  mono,
  children
}: {
  k: string
  mono?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className={mono ? 'kv-val mono' : 'kv-val'}>{children}</span>
    </div>
  )
}

/** Same meter as the Resources card — a second chart style would not help. */
function Bar({ percent }: { percent: number | null }): React.JSX.Element | null {
  if (percent === null || Number.isNaN(percent)) return null
  const pct = Math.min(100, Math.max(0, percent))
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** PowerShell literal: only the single quote needs doubling inside '…'. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** wsl.exe argument: quote only what needs it, so the line stays readable. */
function wslArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

export interface DiskCardProps {
  disk: DiskImageInfo | null
  /** Independent of the image: it is counted even when the vhdx cannot be found. */
  zone: ZoneIdentifierInfo | null
  /** What is inside the gap the numbers above describe. */
  consumers: DiskConsumersInfo | null
}

/**
 * The virtual disk behind the distro (goal.md §6.2): how large ext4.vhdx grew
 * on Windows versus how much of it Linux still uses. Nothing here mutates the
 * image — compacting it is a Windows-side operation the user runs themselves.
 */
export default function DiskCard({ disk, zone, consumers }: DiskCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { prepareCommand, pushToast } = useApp()

  if (disk === null) {
    return (
      <Card titleKey="dashboard.disk.title">
        <div className="dim">{t('dashboard.disk.unavailable')}</div>
        <DiskConsumersBlock consumers={consumers} />
        <ZoneIdentifierBlock zone={zone} />
      </Card>
    )
  }

  const bytes = (v: number | null): string => formatBytes(locale, v)
  const yesNoUnknown = (v: boolean | null): string =>
    v === null ? t('common.unknown') : v ? t('common.yes') : t('common.no')

  const vhdxPath = disk.vhdxPath
  // What Windows really keeps: the allocated blocks when they are known, the
  // logical size otherwise. Never both averaged into one confident number.
  const onDiskBytes = disk.allocatedBytes ?? disk.vhdxBytes
  const usedPercent =
    onDiskBytes !== null && onDiskBytes > 0 && disk.fsUsedBytes !== null
      ? (disk.fsUsedBytes / onDiskBytes) * 100
      : null

  const errorRow =
    disk.error === null ? null : (
      <div className="kv-row">
        <span className="badge badge-warn">{t('common.warning')}</span>
        <span className="kv-val dim">{disk.error}</span>
      </div>
    )

  if (vhdxPath === null) {
    return (
      <Card titleKey="dashboard.disk.title">
        <div className="overview-head">
          <span>
            {t('dashboard.disk.notLocated', {
              defaultValue: 'The disk image for this distribution could not be located.'
            })}
          </span>
        </div>
        {errorRow}
        {disk.basePath !== null ? (
          <Kv k={t('dashboard.disk.location')} mono>
            <span className="truncate" title={disk.basePath}>
              {disk.basePath}
            </span>
            <CopyButton text={disk.basePath} labelKey="dashboard.paths.copyWindows" size={13} />
          </Kv>
        ) : null}
        {disk.fsSizeBytes !== null ? (
          <Kv k={t('dashboard.disk.fsSize')}>{bytes(disk.fsSizeBytes)}</Kv>
        ) : null}
        {disk.fsUsedBytes !== null ? (
          <Kv k={t('dashboard.disk.fsUsed')}>{bytes(disk.fsUsedBytes)}</Kv>
        ) : null}
        <DiskConsumersBlock consumers={consumers} />
        <ZoneIdentifierBlock zone={zone} />
      </Card>
    )
  }

  const reveal = async (): Promise<void> => {
    try {
      await window.wslpad.windows.openPath(vhdxPath)
      pushToast('success', t('toast.openedInExplorer'))
    } catch {
      pushToast('error', t('common.error'))
    }
  }

  // Nothing is executed here: the text only lands in the Console input for the
  // user to read and press Enter on (goal.md §2.2), exactly like kill does.
  const prepare = (command: string): void => {
    prepareCommand(command)
    pushToast('info', t('toast.commandPrepared'))
  }

  const suggestion = (labelKey: string, label: string, command: string): React.JSX.Element => (
    <div className="path-row">
      <div className="row-main">
        <div className="path-line">
          <span className="path-label">{t(labelKey, { defaultValue: label })}</span>
        </div>
        <div className="mono dim truncate" title={command}>
          {command}
        </div>
      </div>
      <span className="row-actions">
        <CopyButton
          text={command}
          toastKey="toast.copiedCommand"
          labelKey="dashboard.processes.copyCommand"
          size={13}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={t('dashboard.disk.prepare', { defaultValue: 'Prepare in Console' })}
          title={t('dashboard.disk.prepare', { defaultValue: 'Prepare in Console' })}
          onClick={() => prepare(command)}
        >
          <TerminalIcon size={13} />
        </button>
      </span>
    </div>
  )

  // Both are offered only while the numbers behind them are known: a suggestion
  // built on an unknown size would be a guess dressed as advice.
  const compactCommand = `wsl --shutdown; Optimize-VHD -Path ${psLiteral(vhdxPath)} -Mode Full`
  const showCompact = disk.reclaimableBytes !== null
  const sparseCommand = `wsl --manage ${wslArg(disk.distro)} --set-sparse true`
  const showSparse = disk.sparse === false

  return (
    <Card titleKey="dashboard.disk.title">
      <div className="overview-head">
        <span>
          {onDiskBytes === null
            ? t('dashboard.disk.headlineUnsized', {
                defaultValue: 'The image was found, but its size on the Windows disk is unknown.'
              })
            : disk.fsUsedBytes === null
              ? t('dashboard.disk.headlineOnDisk', {
                  defaultValue: 'This image is holding {{onDisk}} on the Windows disk.',
                  onDisk: bytes(onDiskBytes)
                })
              : t('dashboard.disk.headline', {
                  defaultValue:
                    'This image is holding {{onDisk}} on the Windows disk while {{distro}} only uses {{inside}} inside.',
                  onDisk: bytes(onDiskBytes),
                  inside: bytes(disk.fsUsedBytes),
                  distro: disk.distro
                })}
        </span>
      </div>
      {errorRow}
      {usedPercent !== null ? (
        <div className="res-row">
          <span className="res-label">
            {t('dashboard.disk.usedOfImage', { defaultValue: 'Used inside vs image' })}
          </span>
          <Bar percent={usedPercent} />
          <span className="res-value">
            {t('dashboard.resources.of', {
              used: bytes(disk.fsUsedBytes),
              total: bytes(onDiskBytes)
            })}
          </span>
        </div>
      ) : null}
      <Kv k={t('dashboard.disk.imagePath')} mono>
        <span className="truncate" title={vhdxPath}>
          {vhdxPath}
        </span>
        <CopyButton text={vhdxPath} labelKey="dashboard.disk.copyPath" size={13} />
        <button
          type="button"
          className="icon-btn"
          aria-label={t('dashboard.disk.reveal', { defaultValue: 'Show in Windows Explorer' })}
          title={t('dashboard.disk.reveal', { defaultValue: 'Show in Windows Explorer' })}
          onClick={() => void reveal()}
        >
          <FolderIcon size={13} />
        </button>
      </Kv>
      <Kv k={t('dashboard.disk.location')} mono>
        {disk.basePath === null ? (
          '—'
        ) : (
          <span className="truncate" title={disk.basePath}>
            {disk.basePath}
          </span>
        )}
      </Kv>
      <Kv k={t('dashboard.disk.imageSize')}>{bytes(disk.vhdxBytes)}</Kv>
      <Kv k={t('dashboard.disk.allocated')}>{bytes(disk.allocatedBytes)}</Kv>
      <Kv k={t('dashboard.disk.sparse')}>{yesNoUnknown(disk.sparse)}</Kv>
      <Kv k={t('dashboard.disk.fsSize')}>{bytes(disk.fsSizeBytes)}</Kv>
      <Kv k={t('dashboard.disk.fsUsed')}>{bytes(disk.fsUsedBytes)}</Kv>
      <Kv k={t('dashboard.disk.reclaimable')}>
        {bytes(disk.reclaimableBytes)}
        {disk.reclaimableBytes !== null ? (
          <span className="dim">{t('dashboard.disk.reclaimableHint')}</span>
        ) : null}
      </Kv>
      {showCompact || showSparse ? (
        <>
          <div className="path-label">
            {t('dashboard.disk.suggestionsTitle', { defaultValue: 'Suggested commands' })}
          </div>
          <div className="dim">
            {t('dashboard.disk.suggestionsHint', {
              defaultValue:
                'WSLPad never runs these. The command is only placed in the Console input for you to review and run.'
            })}
          </div>
          {showCompact
            ? suggestion(
                'dashboard.disk.compactLabel',
                'Compact the image (elevated Windows PowerShell)',
                compactCommand
              )
            : null}
          {showSparse
            ? suggestion(
                'dashboard.disk.setSparseLabel',
                'Let the image shrink by itself (sparse mode)',
                sparseCommand
              )
            : null}
        </>
      ) : null}
      <DiskConsumersBlock consumers={consumers} />
        <ZoneIdentifierBlock zone={zone} />
    </Card>
  )
}
