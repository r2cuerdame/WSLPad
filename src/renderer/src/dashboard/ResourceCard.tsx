import { useTranslation } from 'react-i18next'
import type { DiskUsage, LocaleCode, MemoryReconciliation, ResourceInfo } from '@shared/types'
import { formatBytes, formatNumber, formatPercent } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'

/** Never executed — it only lands in the Console input (goal.md §2.2). */
const RECLAIM_COMMAND = 'wsl.exe --shutdown'

function Bar({ percent }: { percent: number | null }): React.JSX.Element | null {
  if (percent === null || Number.isNaN(percent)) return null
  const pct = Math.min(100, Math.max(0, percent))
  return (
    <div className="bar">
      <div className={pct > 90 ? 'bar-fill warn' : 'bar-fill'} style={{ width: `${pct}%` }} />
    </div>
  )
}

export interface ResourceCardProps {
  resources: ResourceInfo
  /** Windows-vs-Linux memory view; null until both sides have been sampled. */
  memoryDetail?: MemoryReconciliation | null
}

export default function ResourceCard({
  resources,
  memoryDetail = null
}: ResourceCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const locale = i18n.language as LocaleCode

  const ofText = (used: number | null, total: number | null): string =>
    used === null || total === null
      ? '—'
      : t('dashboard.resources.of', {
          used: formatBytes(locale, used),
          total: formatBytes(locale, total)
        })

  const pctOf = (used: number | null, total: number | null): number | null =>
    used === null || total === null || total === 0 ? null : (used / total) * 100

  const diskLabel = (mountPoint: string): string =>
    mountPoint === '/'
      ? t('dashboard.resources.rootFs')
      : mountPoint === '/home'
        ? t('dashboard.resources.homeFs')
        : mountPoint === '/mnt/c'
          ? t('dashboard.resources.mntC')
          : mountPoint

  const diskRow = (disk: DiskUsage): React.JSX.Element => (
    <div key={disk.mountPoint} className="res-row">
      <span className="res-label" title={disk.mountPoint}>
        {diskLabel(disk.mountPoint)}
      </span>
      {disk.exists ? (
        <>
          <Bar percent={disk.usePercent} />
          <span className="res-value">{ofText(disk.usedBytes, disk.totalBytes)}</span>
        </>
      ) : (
        <span className="res-value dim">{t('dashboard.resources.notMounted')}</span>
      )}
    </div>
  )

  // The whole point of the section: how much of what Windows holds for the VM
  // is Linux page cache. Stated in words only when both numbers are real.
  const cacheShare =
    memoryDetail !== null &&
    memoryDetail.guestCacheBytes !== null &&
    memoryDetail.vmmemWorkingSetBytes !== null &&
    memoryDetail.vmmemWorkingSetBytes > 0
      ? memoryDetail.guestCacheBytes / memoryDetail.vmmemWorkingSetBytes
      : null

  const cacheStory =
    memoryDetail === null || cacheShare === null
      ? null
      : t(
          cacheShare >= 0.5
            ? 'dashboard.resources.cacheStoryMost'
            : 'dashboard.resources.cacheStorySome',
          {
            defaultValue:
              cacheShare >= 0.5
                ? 'Most of the {{held}} Windows holds for this VM — {{cache}}, {{percent}} — is Linux page cache, not leaked memory. Linux gives it back as programs ask for it.'
                : '{{cache}} of the {{held}} Windows holds for this VM ({{percent}}) is Linux page cache, which Linux reclaims when programs ask for memory.',
            held: formatBytes(locale, memoryDetail.vmmemWorkingSetBytes),
            cache: formatBytes(locale, memoryDetail.guestCacheBytes),
            percent: formatPercent(locale, Math.min(100, cacheShare * 100))
          }
        )

  const prepareShutdown = (): void => {
    prepareCommand(RECLAIM_COMMAND)
    pushToast('info', t('toast.commandPrepared'))
  }

  return (
    <Card titleKey="dashboard.resources.title">
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.cpu')}</span>
        <Bar percent={resources.cpuPercent} />
        <span className="res-value">{formatPercent(locale, resources.cpuPercent)}</span>
      </div>
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.memory')}</span>
        <Bar percent={pctOf(resources.memUsedBytes, resources.memTotalBytes)} />
        <span className="res-value">{ofText(resources.memUsedBytes, resources.memTotalBytes)}</span>
      </div>
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.swap')}</span>
        <Bar percent={pctOf(resources.swapUsedBytes, resources.swapTotalBytes)} />
        <span className="res-value">
          {ofText(resources.swapUsedBytes, resources.swapTotalBytes)}
        </span>
      </div>
      {memoryDetail ? (
        <>
          {/* Read top to bottom: host RAM → VM ceiling → what Windows keeps →
              how Linux itself splits that memory. */}
          <div className="res-row">
            <span className="res-label">{t('dashboard.resources.hostMemory')}</span>
            <span className="res-value">{formatBytes(locale, memoryDetail.hostTotalBytes)}</span>
          </div>
          <div className="res-row">
            <span className="res-label">{t('dashboard.resources.vmLimit')}</span>
            <Bar percent={pctOf(memoryDetail.vmLimitBytes, memoryDetail.hostTotalBytes)} />
            <span className="res-value">
              {formatBytes(locale, memoryDetail.vmLimitBytes)}
              <span className="dim">
                {' '}
                {t(`dashboard.resources.vmLimitSource.${memoryDetail.vmLimitSource}`)}
              </span>
            </span>
          </div>
          {/* The number that confuses everyone: what Windows keeps for the VM. */}
          <div className="res-row">
            <span className="res-label" title={t('dashboard.resources.vmmemHint')}>
              {t('dashboard.resources.vmmem')}
            </span>
            <Bar percent={pctOf(memoryDetail.vmmemWorkingSetBytes, memoryDetail.vmLimitBytes)} />
            <span className="res-value">
              {formatBytes(locale, memoryDetail.vmmemWorkingSetBytes)}
            </span>
          </div>
          <div className="res-row">
            <span className="res-label">
              {t('dashboard.resources.guestUsed', { defaultValue: 'Used in Linux' })}
            </span>
            <Bar percent={pctOf(memoryDetail.guestUsedBytes, memoryDetail.guestTotalBytes)} />
            <span className="res-value">
              {ofText(memoryDetail.guestUsedBytes, memoryDetail.guestTotalBytes)}
            </span>
          </div>
          <div className="res-row">
            <span className="res-label">{t('dashboard.resources.guestCache')}</span>
            <Bar percent={pctOf(memoryDetail.guestCacheBytes, memoryDetail.guestTotalBytes)} />
            <span className="res-value">{formatBytes(locale, memoryDetail.guestCacheBytes)}</span>
          </div>
          <div className="res-row">
            <span className="res-label">{t('dashboard.resources.guestFree')}</span>
            <Bar percent={pctOf(memoryDetail.guestFreeBytes, memoryDetail.guestTotalBytes)} />
            <span className="res-value">{formatBytes(locale, memoryDetail.guestFreeBytes)}</span>
          </div>
          <div className="res-row">
            <span className="res-label">
              {t('dashboard.resources.guestSwap', { defaultValue: 'Swap in Linux' })}
            </span>
            <Bar percent={pctOf(memoryDetail.swapUsedBytes, memoryDetail.swapTotalBytes)} />
            <span className="res-value">
              {ofText(memoryDetail.swapUsedBytes, memoryDetail.swapTotalBytes)}
            </span>
          </div>
          <div className="res-row">
            <span className="res-label">{t('dashboard.resources.autoMemoryReclaim')}</span>
            {/* null means unset or unreadable — neither is an honest "off". */}
            <span className="res-value mono">{memoryDetail.autoMemoryReclaim ?? '—'}</span>
          </div>
          {cacheStory === null ? null : <div className="res-row dim">{cacheStory}</div>}
          <div className="res-row">
            <span className="res-label">
              {t('dashboard.resources.reclaim', { defaultValue: 'Get the memory back' })}
            </span>
            <span className="res-value">
              <button type="button" className="btn btn-small" onClick={prepareShutdown}>
                {t('dashboard.resources.prepareShutdown', {
                  defaultValue: 'Prepare {{command}}',
                  command: RECLAIM_COMMAND
                })}
              </button>
            </span>
          </div>
          <div className="res-row dim">
            {t('dashboard.resources.reclaimHint', {
              defaultValue:
                'Windows keeps this memory until the WSL VM stops. The command is only placed in the Console — nothing runs until you press Enter.'
            })}
          </div>
        </>
      ) : null}
      {resources.disks.map(diskRow)}
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.loadAvg')}</span>
        <span className="res-value mono">
          {resources.loadAvg
            ? resources.loadAvg.map((n) => formatNumber(locale, n, 2)).join('  ')
            : '—'}
        </span>
      </div>
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.processes')}</span>
        <span className="res-value">{formatNumber(locale, resources.processCount)}</span>
      </div>
    </Card>
  )
}
