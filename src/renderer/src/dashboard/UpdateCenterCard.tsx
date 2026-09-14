import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PackageUpdateCenterResult } from '@shared/types'
import Card from '../components/Card'
import { RefreshIcon } from '../components/Icons'
import { useApp } from '../store'
import PackageProviderStatusStrip from './PackageProviderStatus'

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; value: PackageUpdateCenterResult }
  | { kind: 'error'; message: string }

export default function UpdateCenterCard(): React.JSX.Element {
  const { t } = useTranslation()
  const { prepareCommand, pushToast } = useApp()
  const [view, setView] = useState<ViewState>({ kind: 'idle' })
  const requestId = useRef(0)
  const check = async (): Promise<void> => {
    const id = ++requestId.current
    setView({ kind: 'loading' })
    try {
      const value = await window.wslpad.tools.checkUpdates()
      if (requestId.current === id) setView({ kind: 'done', value })
    } catch (error) {
      if (requestId.current === id)
        setView({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <Card
      titleKey="dashboard.updateCenter.title"
      actions={
        <button
          className="btn btn-small"
          type="button"
          disabled={view.kind === 'loading'}
          onClick={() => void check()}
        >
          <RefreshIcon size={13} />
          {view.kind === 'done'
            ? t('dashboard.updateCenter.refresh')
            : t('dashboard.updateCenter.check')}
        </button>
      }
    >
      <p className="package-intro">{t('dashboard.updateCenter.intro')}</p>
      <p className="dim package-safety">{t('dashboard.packages.safety')}</p>
      {view.kind === 'idle' ? <div className="dim">{t('dashboard.updateCenter.idle')}</div> : null}
      {view.kind === 'loading' ? (
        <div role="status" className="dim">
          {t('dashboard.updateCenter.loading')}
        </div>
      ) : null}
      {view.kind === 'error' ? (
        <div role="alert" className="notice-warn">
          {t('dashboard.updateCenter.failed')}: {view.message}
        </div>
      ) : null}
      {view.kind === 'done' ? (
        <>
          <PackageProviderStatusStrip providers={view.value.providers} />
          {view.value.updates.length === 0 ? (
            <div className="dim">{t('dashboard.updateCenter.empty')}</div>
          ) : (
            <div className="dash-table-wrap dash-scroll">
              <table className="dash-table package-table">
                <thead>
                  <tr>
                    <th scope="col">{t('common.name')}</th>
                    <th scope="col">{t('dashboard.packages.provider')}</th>
                    <th scope="col">{t('dashboard.updateCenter.installed')}</th>
                    <th scope="col">{t('dashboard.updateCenter.available')}</th>
                    <th scope="col">{t('dashboard.packages.target')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('common.details')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.value.updates.map((item) => (
                    <tr key={`${item.provider}:${item.name}`}>
                      <td className="mono">{item.name}</td>
                      <td>{item.provider}</td>
                      <td className="mono">{item.installedVersion ?? '—'}</td>
                      <td className="mono">{item.availableVersion ?? '—'}</td>
                      <td>{t(`dashboard.packages.side.${item.target}`)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-small"
                          aria-label={t('dashboard.updateCenter.prepareNamed', { name: item.name })}
                          onClick={() => {
                            prepareCommand(item.updateCommand)
                            pushToast('info', t('toast.commandPrepared'))
                          }}
                        >
                          {t('dashboard.updateCenter.prepare')}
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
