import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleCode, ProcessInfo } from '@shared/types'
import { formatDuration, formatPercent } from '@shared/format'
import { useApp } from '../store'
import Card from '../components/Card'
import CopyButton from '../components/CopyButton'
import VirtualList from '../components/VirtualList'
import { CloseIcon, FolderIcon } from '../components/Icons'

const ROW_HEIGHT = 30
const FOCUS_CLEAR_MS = 3000

type SortKey = 'cpu' | 'mem' | 'pid'

const dirname = (p: string): string => p.replace(/\/[^/]*$/, '') || '/'

export interface ProcessesCardProps {
  processes: ProcessInfo[]
}

export default function ProcessesCard({ processes }: ProcessesCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleCode
  const { prepareCommand, pushToast, navigateExplorer, focusPid, setFocusPid } = useApp()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [desc, setDesc] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Ports card "Show process" sets focusPid; highlight the row briefly.
  useEffect(() => {
    if (focusPid === null) return
    bodyRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const timer = setTimeout(() => setFocusPid(null), FOCUS_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [focusPid, setFocusPid])

  const clickSort = (key: SortKey): void => {
    if (key === sortKey) {
      setDesc(!desc)
    } else {
      setSortKey(key)
      setDesc(key !== 'pid')
    }
  }

  const arrow = (key: SortKey): string => (key === sortKey ? (desc ? ' ▼' : ' ▲') : '')

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? processes.filter(
          (p) =>
            p.command.toLowerCase().includes(q) ||
            p.user.toLowerCase().includes(q) ||
            String(p.pid).includes(q)
        )
      : processes
    const dir = desc ? -1 : 1
    return [...filtered].sort((a, b) => {
      const va = sortKey === 'cpu' ? a.cpuPercent : sortKey === 'mem' ? a.memPercent : a.pid
      const vb = sortKey === 'cpu' ? b.cpuPercent : sortKey === 'mem' ? b.memPercent : b.pid
      return (va - vb) * dir
    })
  }, [processes, query, sortKey, desc])

  const focusIndex = focusPid === null ? undefined : sorted.findIndex((p) => p.pid === focusPid)

  // Kill is never executed here — the command is only prepared in the Console
  // input for the user to review (goal.md §6.8).
  const prepareKill = (pid: number): void => {
    prepareCommand(`kill ${pid}`)
    pushToast('info', t('toast.commandPrepared'))
  }

  return (
    <Card
      titleKey="dashboard.processes.title"
      actions={
        <input
          type="search"
          className="dash-input"
          value={query}
          placeholder={t('dashboard.processes.searchPlaceholder')}
          aria-label={t('common.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
    >
      <div ref={bodyRef}>
        <div className="proc-row proc-head">
          <button type="button" className="th-btn" onClick={() => clickSort('pid')}>
            {t('dashboard.processes.pid')}
            {arrow('pid')}
          </button>
          <span>{t('dashboard.processes.user')}</span>
          <button type="button" className="th-btn" onClick={() => clickSort('cpu')}>
            {t('dashboard.processes.cpu')}
            {arrow('cpu')}
          </button>
          <button type="button" className="th-btn" onClick={() => clickSort('mem')}>
            {t('dashboard.processes.memory')}
            {arrow('mem')}
          </button>
          <span>{t('dashboard.processes.time')}</span>
          <span>{t('dashboard.processes.command')}</span>
          <span />
        </div>
        <VirtualList
          items={sorted}
          rowHeight={ROW_HEIGHT}
          scrollToIndex={focusIndex !== undefined && focusIndex >= 0 ? focusIndex : undefined}
          render={(p) => {
            const exe = p.executablePath
            return (
              <div
                key={p.pid}
                className={p.pid === focusPid ? 'proc-row focused' : 'proc-row'}
                style={{ height: ROW_HEIGHT }}
              >
                <span className="mono">{p.pid}</span>
                <span className="truncate">{p.user}</span>
                <span>{formatPercent(locale, p.cpuPercent)}</span>
                <span>{formatPercent(locale, p.memPercent)}</span>
                <span>{formatDuration(locale, p.elapsedSeconds)}</span>
                <span className="mono truncate" title={p.command}>
                  {p.command}
                </span>
                <span className="row-actions">
                  <CopyButton
                    text={p.command}
                    toastKey="toast.copiedCommand"
                    labelKey="dashboard.processes.copyCommand"
                    size={13}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('dashboard.processes.prepareKill')}
                    title={t('dashboard.processes.prepareKill')}
                    onClick={() => prepareKill(p.pid)}
                  >
                    <CloseIcon size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('dashboard.processes.findExecutable')}
                    title={t('dashboard.processes.findExecutable')}
                    disabled={!exe}
                    onClick={() => exe && navigateExplorer(dirname(exe))}
                  >
                    <FolderIcon size={13} />
                  </button>
                </span>
              </div>
            )
          }}
        />
      </div>
    </Card>
  )
}
