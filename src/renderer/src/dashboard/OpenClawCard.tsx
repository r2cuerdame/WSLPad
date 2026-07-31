import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { FolderIcon, WarningIcon } from '../components/Icons'
import { dirOf } from './ToolsCard'

/** The id OpenClaw is detected under in the tool catalog. */
export const OPENCLAW_TOOL_ID = 'openclaw'

export function findOpenClaw(tools: readonly ToolInfo[]): ToolInfo | null {
  return tools.find((tool) => tool.id === OPENCLAW_TOOL_ID) ?? null
}

function Kv({ k, children }: { k: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{children}</span>
    </div>
  )
}

export interface OpenClawCardProps {
  /** null when the tool catalog has not been collected for this distro yet. */
  openclaw: ToolInfo | null
}

/**
 * OpenClaw, given the same section Hermes has (goal.md §6.6.1). Everything here
 * comes from the detector that already walks the tool catalog — WSLPad does not
 * run OpenClaw to ask it about itself, so a section is never a reason to start
 * a process the user did not start.
 */
export default function OpenClawCard({ openclaw }: OpenClawCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { navigateExplorer, pushToast } = useApp()

  if (openclaw === null || !openclaw.installed) {
    return (
      <Card titleKey="dashboard.openclaw.title">
        <div className="dim">{t('dashboard.openclaw.notInstalled')}</div>
        <div className="dim">{t('dashboard.openclaw.notInstalledHint')}</div>
      </Card>
    )
  }

  const pathRow = (label: string, path: string, isDir = false): React.JSX.Element => (
    <Kv k={label}>
      <span className="mono truncate" title={path}>
        {path}
      </span>
      <CopyButton text={path} labelKey="dashboard.config.copyPath" />
      <button
        type="button"
        className="icon-btn"
        aria-label={t('dashboard.config.showInExplorer')}
        title={t('dashboard.config.showInExplorer')}
        onClick={() => {
          navigateExplorer(
            isDir ? path : dirOf(path),
            openclaw.side === 'windows-mount' ? 'windows' : 'linux'
          )
          pushToast('info', t('toast.openedInExplorer'))
        }}
      >
        <FolderIcon size={14} />
      </button>
    </Kv>
  )

  return (
    <Card titleKey="dashboard.openclaw.title">
      {/* Same trap the Tools section reports: the command may be a Windows
          executable reached over /mnt/c rather than a build in this distro. */}
      {openclaw.shadowedByWindows ? (
        <div className="notice-warn" role="status">
          <WarningIcon size={14} />
          <span>{t('dashboard.tools.shadowedHint')}</span>
        </div>
      ) : null}

      <Kv k={t('common.installed')}>{t('common.yes')}</Kv>
      <Kv k={t('dashboard.tools.version')}>
        <span className="mono">{openclaw.version ?? t('common.unknown')}</span>
      </Kv>
      {openclaw.executablePath === null
        ? null
        : pathRow(t('dashboard.openclaw.executable'), openclaw.executablePath)}
      {openclaw.configPaths.map((path) => (
        <div key={path}>{pathRow(t('dashboard.openclaw.data'), path, true)}</div>
      ))}
      <Kv k={t('dashboard.tools.installMethod')}>{openclaw.installMethod ?? '—'}</Kv>
      <Kv k={t('dashboard.tools.sideLabel')}>
        <span className="dim">{t(`dashboard.paths.side.${openclaw.side}`)}</span>
      </Kv>
      <Kv k={t('dashboard.openclaw.processes')}>
        {openclaw.runningProcesses > 0 ? (
          <span className="badge badge-ok">{openclaw.runningProcesses}</span>
        ) : (
          <span className="badge badge-dim">{t('common.notDetected')}</span>
        )}
      </Kv>
      <Kv k={t('dashboard.hermes.services')}>
        <span className="mono">
          {openclaw.services.length > 0 ? openclaw.services.join(', ') : '—'}
        </span>
      </Kv>
    </Card>
  )
}
