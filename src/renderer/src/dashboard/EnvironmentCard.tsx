import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnvironmentVariableInfo } from '@shared/types'
import { useApp } from '../store'
import CopyButton from '../components/CopyButton'
import Card from '../components/Card'
import VirtualList from '../components/VirtualList'

const ROW_HEIGHT = 30
const REVEAL_MS = 10000

export interface EnvironmentCardProps {
  env: EnvironmentVariableInfo[]
  /** Distro the values belong to; switching it re-masks every revealed value. */
  distro: string
}

export default function EnvironmentCard({ env, distro }: EnvironmentCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { pushToast } = useApp()
  const [query, setQuery] = useState('')
  const [asc, setAsc] = useState(true)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // Latest reveal request per name. A reply counts only while its number is
  // still here: hiding, a distro switch or the variable leaving drops it.
  const requests = useRef(new Map<string, number>())
  const nextRequest = useRef(0)

  const forget = (name: string): void => {
    const timer = timers.current.get(name)
    if (timer) clearTimeout(timer)
    timers.current.delete(name)
    requests.current.delete(name)
  }

  // A value revealed in one distro must never sit in another distro's row with
  // the same name. Layout effect: the stale value is cleared before paint.
  useLayoutEffect(() => {
    const map = timers.current
    const pending = requests.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
      pending.clear()
      setRevealed({})
    }
  }, [distro])

  // A variable that disappears on refresh takes its revealed value with it.
  useEffect(() => {
    const names = new Set(env.map((e) => e.name))
    for (const [name, timer] of timers.current) {
      if (names.has(name)) continue
      clearTimeout(timer)
      timers.current.delete(name)
    }
    for (const name of requests.current.keys()) {
      if (!names.has(name)) requests.current.delete(name)
    }
    setRevealed((r) => {
      const gone = Object.keys(r).filter((name) => !names.has(name))
      if (gone.length === 0) return r
      const next = { ...r }
      for (const name of gone) delete next[name]
      return next
    })
  }, [env])

  const hide = (name: string): void => {
    forget(name)
    setRevealed((r) => {
      const next = { ...r }
      delete next[name]
      return next
    })
  }

  // Explicit GUI reveal only; raw value re-masks after 10 s (goal.md §6.7).
  const reveal = async (name: string): Promise<void> => {
    const request = ++nextRequest.current
    requests.current.set(name, request)
    const current = (): boolean => requests.current.get(name) === request
    try {
      const raw = await window.wslpad.revealEnv(name)
      if (raw === null || !current()) return
      setRevealed((r) => ({ ...r, [name]: raw }))
      const existing = timers.current.get(name)
      if (existing) clearTimeout(existing)
      timers.current.set(
        name,
        setTimeout(() => hide(name), REVEAL_MS)
      )
    } catch {
      if (current()) pushToast('error', t('common.error'))
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? env.filter((e) => e.name.toLowerCase().includes(q)) : env
    return [...filtered].sort((a, b) =>
      asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    )
  }, [env, query, asc])

  return (
    <Card
      titleKey="dashboard.environment.title"
      actions={
        <>
          <input
            type="search"
            className="dash-input"
            value={query}
            placeholder={t('dashboard.environment.searchPlaceholder')}
            aria-label={t('common.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-small"
            aria-label={t('common.name')}
            onClick={() => setAsc(!asc)}
          >
            {t('common.name')} {asc ? '▲' : '▼'}
          </button>
        </>
      }
    >
      {shown.length === 0 ? (
        <div className="dim" role="status">
          {t('common.none')}
        </div>
      ) : (
        <VirtualList
          items={shown}
          rowHeight={ROW_HEIGHT}
          render={(e) => (
            <div key={e.name} className="env-row" style={{ height: ROW_HEIGHT }}>
              <span className="mono truncate env-name" title={e.name}>
                {e.name}
              </span>
              <span
                className="mono truncate env-value"
                title={e.isSecret ? t('dashboard.environment.maskedHint') : e.maskedValue}
              >
                {revealed[e.name] ?? e.maskedValue}
              </span>
              {/* A secret is copyable only once the user has revealed it; the
                  mask itself is worthless on a clipboard (0.1.9 menu audit). */}
              {!e.isSecret || revealed[e.name] !== undefined ? (
                <CopyButton
                  text={revealed[e.name] ?? e.maskedValue}
                  toastKey="common.copied"
                  labelKey="dashboard.environment.copyValue"
                />
              ) : (
                <span className="env-copy-gap" aria-hidden="true" />
              )}
              <span className="dim env-len">{e.valueLength}</span>
              <span className="env-badges">
                {e.isPathLike ? (
                  <span className="badge badge-dim">{t('dashboard.environment.pathLike')}</span>
                ) : null}
                {e.fromWindows ? (
                  <span className="badge badge-dim">{t('dashboard.environment.fromWindows')}</span>
                ) : null}
              </span>
              {e.isSecret ? (
                revealed[e.name] !== undefined ? (
                  <button type="button" className="btn btn-small" onClick={() => hide(e.name)}>
                    {t('dashboard.environment.hide')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-small"
                    title={t('dashboard.environment.maskedHint')}
                    onClick={() => void reveal(e.name)}
                  >
                    {t('dashboard.environment.reveal')}
                  </button>
                )
              ) : null}
            </div>
          )}
        />
      )}
    </Card>
  )
}
