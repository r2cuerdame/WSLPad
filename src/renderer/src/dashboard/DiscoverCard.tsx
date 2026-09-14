import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PackageDiscoverResult } from '@shared/types'
import Card from '../components/Card'
import { SearchIcon } from '../components/Icons'
import { useApp } from '../store'
import PackageProviderStatusStrip from './PackageProviderStatus'

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; value: PackageDiscoverResult }
  | { kind: 'error'; message: string }

export interface DiscoverCardProps {
  distro: string
  /**
   * A search another section asked for (Developer Profiles hand over a missing
   * tool). The id makes a repeated identical query a new request; the card
   * runs it once when it arrives, which is still one explicit user click.
   */
  request?: { id: number; query: string } | null
}

export default function DiscoverCard({
  distro,
  request = null
}: DiscoverCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const [query, setQuery] = useState(request?.query ?? '')
  const [view, setView] = useState<ViewState>({ kind: 'idle' })
  const requestId = useRef(0)
  const servedRequest = useRef<number | null>(null)

  const run = async (raw: string): Promise<void> => {
    const value = raw.trim()
    if (value.length < 2) return
    const id = ++requestId.current
    setView({ kind: 'loading' })
    try {
      const result = await window.wslpad.tools.search(value)
      if (requestId.current === id) setView({ kind: 'done', value: result })
    } catch (error) {
      if (requestId.current === id) {
        setView({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const search = (event: FormEvent): void => {
    event.preventDefault()
    void run(query)
  }

  useEffect(() => {
    if (request === null || servedRequest.current === request.id) return
    servedRequest.current = request.id
    setQuery(request.query)
    void run(request.query)
  }, [request])

  return (
    <Card
      titleKey="dashboard.discover.title"
      actions={
        <form className="package-search" onSubmit={search}>
          <input
            className="dash-input"
            type="search"
            value={query}
            minLength={2}
            maxLength={80}
            aria-label={t('dashboard.discover.searchLabel')}
            placeholder={t('dashboard.discover.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn btn-small" type="submit" disabled={view.kind === 'loading'}>
            <SearchIcon size={13} />
            {t('dashboard.discover.search')}
          </button>
        </form>
      }
    >
      <p className="package-intro">{t('dashboard.discover.intro', { distro })}</p>
      <p className="dim package-safety">{t('dashboard.packages.safety')}</p>
      {view.kind === 'idle' ? <div className="dim">{t('dashboard.discover.idle')}</div> : null}
      {view.kind === 'loading' ? (
        <div role="status" className="dim">
          {t('dashboard.discover.loading')}
        </div>
      ) : null}
      {view.kind === 'error' ? (
        <div role="alert" className="notice-warn">
          {t('dashboard.discover.failed')}: {view.message}
        </div>
      ) : null}
      {view.kind === 'done' ? (
        <>
          <PackageProviderStatusStrip providers={view.value.providers} />
          {view.value.results.length === 0 ? (
            <div className="dim">{t('dashboard.discover.empty')}</div>
          ) : (
            <div className="dash-table-wrap dash-scroll">
              <table className="dash-table package-table">
                <thead>
                  <tr>
                    <th scope="col">{t('common.name')}</th>
                    <th scope="col">{t('dashboard.packages.provider')}</th>
                    <th scope="col">{t('dashboard.packages.version')}</th>
                    <th scope="col">{t('dashboard.packages.target')}</th>
                    <th scope="col">{t('common.details')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('common.details')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.value.results.map((item) => (
                    <tr key={`${item.provider}:${item.name}`}>
                      <td className="mono">{item.name}</td>
                      <td>{item.provider}</td>
                      <td className="mono">{item.version ?? '—'}</td>
                      <td>{t(`dashboard.packages.side.${item.target}`)}</td>
                      <td title={item.description ?? undefined}>{item.description ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-small"
                          aria-label={t('dashboard.discover.prepareNamed', { name: item.name })}
                          onClick={() => {
                            prepareCommand(item.installCommand)
                            pushToast('info', t('toast.commandPrepared'))
                          }}
                        >
                          {t('dashboard.discover.prepare')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Card>
  )
}
