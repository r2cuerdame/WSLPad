import { useTranslation } from 'react-i18next'
import type {
  DiskUsage,
  LocaleCode,
  InotifyInfo,
  MemoryReconciliation,
  ResourceInfo
} from '@shared/types'
import { formatBytes, formatNumber, formatPercent } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import Sparkline from '../components/Sparkline'
import { useMetricHistory } from '../hooks/useMetricHistory'

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

import InotifyBlock from './InotifyBlock'

export interface ResourceCardProps {
  resources: ResourceInfo
  /** Windows-vs-Linux memory view; null until both sides have been sampled. */
  memoryDetail?: MemoryReconciliation | null
  /** The kernel watch ceiling — a resource limit like the ones above it. */
  inotify?: InotifyInfo | null
}

export default function ResourceCard({
  resources,
  memoryDetail = null,
  inotify = null
}: ResourceCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { snapshot, prepareCommand, pushToast } = useApp()
  const locale = i18n.language as LocaleCode

  // A single value cannot answer "is this climbing?". The history lives in
  // renderer memory for this session only — nothing is written anywhere.
  const history = useMetricHistory({
    distro: snapshot?.selectedDistro ?? null,
    at: snapshot?.generatedAt ?? null,
    cpuPercent: resources.cpuPercent,
    memUsedBytes: resources.memUsedBytes
  })

  // Measured, never assumed: the poll interval is a setting and can be paused.
  // A window shorter than one default tick would only round to "0 min".
  const spanMinutes = ((): number | null => {
    if (history.length < 2) return null
    const from = Date.parse(history[0].at)
    const to = Date.parse(history[history.length - 1].at)
    if (Number.isNaN(from) || Number.isNaN(to) || to - from < 3000) return null
    return (to - from) / 60000
  })()

  const trendLabel = (windowKey: string, nameKey: string): string =>
    spanMinutes === null
      ? t(nameKey)
      : t(windowKey, { minutes: formatNumber(locale, spanMinutes, spanMinutes < 10 ? 1 : 0) })

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
        <Sparkline
          values={history.map((sample) => sample.cpuPercent)}
          label={trendLabel('dashboard.resources.trendCpu', 'dashboard.resources.cpu')}
          format={(value) => formatPercent(locale, value)}
        />
        <span className="res-value">{formatPercent(locale, resources.cpuPercent)}</span>
      </div>
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.memory')}</span>
        <Bar percent={pctOf(resources.memUsedBytes, resources.memTotalBytes)} />
        <Sparkline
          values={history.map((sample) => sample.memUsedBytes)}
          label={trendLabel('dashboard.resources.trendMemory', 'dashboard.resources.memory')}
          format={(value) => formatBytes(locale, value)}
        />
        <span className="res-value">{ofText(resources.memUsedBytes, resources.memTotalBytes)}</span>
      </div>
      <div className="res-row">
        <span className="res-label">{t('dashboard.resources.swap')}</span>
        <Bar percent={pctOf(resources.swapUsedBytes, resources.swapTotalBytes)} />
        <span className="res-value">
          {ofText(resources.swapUsedBytes, resources.swapTotalBytes)}
        </span>
      </div>
      {spanMinutes === null ? null : (
        <div className="res-row dim">
          <span className="res-label">{t('dashboard.resources.trend')}</span>
          <span>{t('dashboard.resources.trendHint')}</span>
        </div>
      )}
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
      <InotifyBlock inotify={inotify} />
    </Card>
  )
}
