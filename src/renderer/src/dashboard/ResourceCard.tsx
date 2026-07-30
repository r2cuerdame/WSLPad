import { useTranslation } from 'react-i18next'
import type { DiskUsage, LocaleCode, ResourceInfo } from '@shared/types'
import { formatBytes, formatNumber, formatPercent } from '@shared/format'
import Card from '../components/Card'

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
}

export default function ResourceCard({ resources }: ResourceCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
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
        <span className="res-value">{ofText(resources.swapUsedBytes, resources.swapTotalBytes)}</span>
      </div>
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
