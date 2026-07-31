import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PortInfo, PortProtocol, PortReachability, WindowsPortInfo } from '@shared/types'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import { ExternalIcon, SearchIcon } from '../components/Icons'

const STORAGE_KEY = 'wslpad.dashboard.ports.windowsOnly'

type SortKey = 'source' | 'protocol' | 'port'
type Source = 'wsl' | 'both' | 'windows'

const SOURCE_ORDER: Record<Source, number> = { both: 0, wsl: 1, windows: 2 }

/** Only 'lan' is a scope worth noticing; a failed read is dim, never green. */
const REACHABILITY_CLASS: Record<PortReachability, string> = {
  lan: 'badge badge-accent',
  'windows-only': 'badge',
  'loopback-only': 'badge',
  unreachable: 'badge badge-err',
  unknown: 'badge badge-dim'
}

interface PortRow {
  id: string
  source: Source
  protocol: PortProtocol
  localAddress: string
  port: number
  pid: number | null
  processName: string | null
  url: string | null
  /** WSL row whose Windows counterpart could not be read at all. */
  unknownWindows: boolean
  windowsProcess: string | null
  /** null on a Windows-only row: the WSL reachability rules do not apply. */
  reachability: PortReachability | null
  reachabilityReason: string | null
}

/** '' means "no bound"; anything unparsable is treated the same way. */
function parseBound(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(n) ? n : null
}

export function matchesPortFilters(
  row: { port: number; processName: string | null; windowsProcess: string | null },
  from: number | null,
  to: number | null,
  name: string
): boolean {
  if (from !== null && row.port < from) return false
  if (to !== null && row.port > to) return false
  if (name === '') return true
  const needle = name.toLowerCase()
  return [row.processName, row.windowsProcess].some(
    (v) => v !== null && v.toLowerCase().includes(needle)
  )
}

function readStoredWindowsOnly(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export interface PortsCardProps {
  ports: PortInfo[]
  /** Windows host listeners; absent when the snapshot has no Windows view. */
  windowsPorts?: WindowsPortInfo[]
}

export default function PortsCard({ ports, windowsPorts = [] }: PortsCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { setFocusPid } = useApp()
  const [showWindowsOnly, setShowWindowsOnly] = useState(readStoredWindowsOnly)
  const [sortKey, setSortKey] = useState<SortKey>('port')
  const [desc, setDesc] = useState(false)
  const [portFrom, setPortFrom] = useState('')
  const [portTo, setPortTo] = useState('')
  const [nameQuery, setNameQuery] = useState('')

  const windowsOnly = useMemo(() => windowsPorts.filter((w) => !w.fromWsl), [windowsPorts])

  const rows = useMemo<PortRow[]>(() => {
    const wslRows: PortRow[] = ports.map((p) => ({
      id: `wsl:${p.protocol}:${p.localAddress}:${p.port}`,
      source: p.windowsBound === true ? 'both' : 'wsl',
      protocol: p.protocol,
      localAddress: p.localAddress,
      port: p.port,
      pid: p.pid,
      processName: p.processName,
      url: p.localhostUrl,
      unknownWindows: (p.windowsBound ?? null) === null,
      windowsProcess: p.windowsProcess ?? null,
      reachability: p.reachability,
      reachabilityReason: p.reachabilityReason
    }))
    const winRows: PortRow[] = showWindowsOnly
      ? windowsOnly.map((w) => ({
          id: `win:${w.protocol}:${w.localAddress}:${w.port}`,
          source: 'windows',
          protocol: w.protocol,
          localAddress: w.localAddress,
          port: w.port,
          pid: w.pid,
          processName: w.processName,
          url: w.localhostUrl,
          unknownWindows: false,
          windowsProcess: w.processName,
          reachability: null,
          reachabilityReason: null
        }))
      : []
    const dir = desc ? -1 : 1
    const bySource = (a: PortRow, b: PortRow): number =>
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
    // A busy machine lists a couple of hundred listeners; "which process holds
    // 5173" should not be a scrolling exercise.
    const from = parseBound(portFrom)
    const to = parseBound(portTo)
    const name = nameQuery.trim().toLowerCase()
    return [...wslRows, ...winRows]
      .filter((r) => matchesPortFilters(r, from, to, name))
      .sort((a, b) => {
        if (sortKey === 'protocol') {
          return a.protocol.localeCompare(b.protocol) * dir || a.port - b.port
        }
        if (sortKey === 'source') return bySource(a, b) * dir || a.port - b.port
        return (a.port - b.port) * dir || bySource(a, b)
      })
  }, [ports, windowsOnly, showWindowsOnly, sortKey, desc, portFrom, portTo, nameQuery])

  const filtering = portFrom !== '' || portTo !== '' || nameQuery.trim() !== ''

  const toggleWindowsOnly = (next: boolean): void => {
    setShowWindowsOnly(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable — the choice simply does not persist */
    }
  }

  const clickSort = (clicked: SortKey): void => {
    if (clicked === sortKey) {
      setDesc(!desc)
    } else {
      setSortKey(clicked)
      setDesc(false)
    }
  }

  const arrow = (clicked: SortKey): string => (clicked === sortKey ? (desc ? ' ▼' : ' ▲') : '')

  const sourceLabel = (row: PortRow): string =>
    row.source === 'both'
      ? t('dashboard.ports.sourceBoth')
      : row.source === 'windows'
        ? t('dashboard.ports.sourceWindows')
        : t('dashboard.ports.sourceWsl')

  const sourceTitle = (row: PortRow): string => {
    if (row.source === 'windows') return t('dashboard.ports.sourceWindows')
    if (row.source === 'both') {
      return row.windowsProcess === null
        ? t('dashboard.ports.reachableFromWindows')
        : `${t('dashboard.ports.windowsProcess')}: ${row.windowsProcess}`
    }
    return row.unknownWindows
      ? t('dashboard.ports.windowsUnknown')
      : t('dashboard.ports.notReachable')
  }

  /**
   * The verdict is computed in the main process, where the networking mode and
   * the firewall are known; the row only renders it. Its reason is English
   * from the collector — hovering is the whole point of the column.
   */
  const reachabilityTitle = (row: PortRow): string => {
    if (row.reachability === null) {
      return t('dashboard.ports.reachabilityWindowsRow', {
        defaultValue: 'A Windows listener: the WSL reachability rules do not apply to it.'
      })
    }
    if (row.reachabilityReason !== null) return row.reachabilityReason
    return row.reachability === 'unknown'
      ? t('dashboard.ports.reachabilityUnknownHint')
      : t(`dashboard.ports.reachability.${row.reachability}`)
  }

  return (
    <Card
      titleKey="dashboard.ports.title"
      actions={
        <>
          <span className="port-range">
            <input
              type="number"
              className="dash-input dash-input-num"
              value={portFrom}
              min={0}
              max={65535}
              placeholder="0"
              aria-label={t('dashboard.ports.portFrom')}
              onChange={(e) => setPortFrom(e.target.value)}
            />
            <span className="dim" aria-hidden="true">
              ~
            </span>
            <input
              type="number"
              className="dash-input dash-input-num"
              value={portTo}
              min={0}
              max={65535}
              placeholder="65535"
              aria-label={t('dashboard.ports.portTo')}
              onChange={(e) => setPortTo(e.target.value)}
            />
          </span>
          <input
            type="search"
            className="dash-input"
            value={nameQuery}
            placeholder={t('dashboard.ports.filterProcess')}
            aria-label={t('dashboard.ports.filterProcess')}
            onChange={(e) => setNameQuery(e.target.value)}
          />
          {windowsOnly.length > 0 ? (
            <label className="dim">
              <input
                type="checkbox"
                checked={showWindowsOnly}
                onChange={(e) => toggleWindowsOnly(e.target.checked)}
              />{' '}
              {t('dashboard.ports.showWindowsOnly')}
            </label>
          ) : null}
        </>
      }
    >
      {rows.length === 0 ? (
        <div className="dim">{filtering ? t('dashboard.ports.noMatches') : t('common.none')}</div>
      ) : (
        <div className="dash-table-wrap dash-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">
                  <button type="button" className="th-btn" onClick={() => clickSort('source')}>
                    {t('dashboard.ports.source')}
                    {arrow('source')}
                  </button>
                </th>
                <th scope="col">
                  <button type="button" className="th-btn" onClick={() => clickSort('protocol')}>
                    {t('dashboard.ports.protocol')}
                    {arrow('protocol')}
                  </button>
                </th>
                <th scope="col">{t('dashboard.ports.address')}</th>
                <th scope="col">
                  <button type="button" className="th-btn" onClick={() => clickSort('port')}>
                    {t('dashboard.ports.port')}
                    {arrow('port')}
                  </button>
                </th>
                <th scope="col">{t('dashboard.processes.pid')}</th>
                <th scope="col">{t('dashboard.ports.process')}</th>
                <th scope="col">{t('dashboard.ports.reachabilityLabel')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.details')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const url = row.url
                const pid = row.pid
                const isWindows = row.source === 'windows'
                return (
                  <tr key={row.id}>
                    <td className={row.unknownWindows ? 'dim' : undefined} title={sourceTitle(row)}>
                      {sourceLabel(row)}
                    </td>
                    <td className="mono">{row.protocol}</td>
                    <td className="mono">{row.localAddress}</td>
                    <td className="mono">{row.port}</td>
                    <td className="mono">{pid ?? '—'}</td>
                    <td className="truncate" title={row.processName ?? undefined}>
                      {row.processName ?? '—'}
                    </td>
                    <td title={reachabilityTitle(row)}>
                      {row.reachability === null ? (
                        <span className="dim">—</span>
                      ) : (
                        <span className={REACHABILITY_CLASS[row.reachability]}>
                          {t(`dashboard.ports.reachability.${row.reachability}`)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="row-actions">
                        {url ? (
                          <>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t('dashboard.ports.openInBrowser')}
                              title={t('dashboard.ports.openInBrowser')}
                              onClick={() => void window.wslpad.openExternal(url)}
                            >
                              <ExternalIcon size={14} />
                            </button>
                            <CopyButton
                              text={url}
                              toastKey="toast.copiedUrl"
                              labelKey="dashboard.ports.copyUrl"
                              size={14}
                            />
                          </>
                        ) : null}
                        {pid !== null ? (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={t('dashboard.ports.showProcess')}
                            // Windows pids are not in the WSL process table.
                            title={
                              isWindows
                                ? t('dashboard.ports.windowsProcessNotListed', {
                                    defaultValue: 'Windows processes are not listed here'
                                  })
                                : t('dashboard.ports.showProcess')
                            }
                            disabled={isWindows}
                            onClick={() => setFocusPid(pid)}
                          >
                            <SearchIcon size={14} />
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
